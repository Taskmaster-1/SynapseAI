import asyncio
import uuid
from datetime import UTC, datetime

from fastapi import UploadFile

from app.api.v1.files.schemas import FileListResponse, FileResponse
from app.core.config import settings
from app.core.exceptions import (
    FileTooLargeException,
    ForbiddenException,
    NotFoundException,
    UnsupportedFileTypeException,
)
from app.services.ai.rag_service import RAGService
from app.utils.logger import logger
from supabase import AsyncClient

MAX_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


class FileService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    async def upload(self, file: UploadFile, *, user_id: str) -> FileResponse:
        # Validate MIME type
        if file.content_type not in settings.ALLOWED_MIME_TYPES.split(","):
            raise UnsupportedFileTypeException(file.content_type)

        contents = await file.read()

        # Validate size
        if len(contents) > MAX_BYTES:
            raise FileTooLargeException(settings.MAX_UPLOAD_SIZE_MB)

        file_id = str(uuid.uuid4())
        extension = (file.filename or "").rsplit(".", 1)[-1]
        storage_path = f"{user_id}/{file_id}.{extension}"

        # Upload to Supabase Storage
        await self._db.storage.from_(settings.SUPABASE_STORAGE_BUCKET).upload(
            path=storage_path,
            file=contents,
            file_options={"content-type": file.content_type},
        )

        # Generate public URL
        url_response = self._db.storage.from_(settings.SUPABASE_STORAGE_BUCKET).get_public_url(storage_path)

        # Persist metadata to DB
        record = {
            "id": file_id,
            "user_id": user_id,
            "filename": file.filename,
            "content_type": file.content_type,
            "size_bytes": len(contents),
            "storage_path": storage_path,
            "url": url_response,
        }
        await self._db.table("files").insert(record).execute()

        # 🚀 Trigger RAG Processing in background
        rag = RAGService(user_id)
        asyncio.create_task(rag.process_file(
            file_id=file_id,
            filename=file.filename or "unknown",
            content=contents,
            content_type=file.content_type
        ))

        logger.info("File uploaded and RAG task triggered", file_id=file_id, user_id=user_id)
        return FileResponse(**record, created_at=datetime.now(UTC))

    async def list_user_files(self, *, user_id: str) -> FileListResponse:
        result = await self._db.table("files").select("*").eq("user_id", user_id).execute()
        return FileListResponse(files=[FileResponse(**r) for r in (result.data or [])])

    async def delete(self, *, file_id: str, user_id: str) -> None:
        result = await self._db.table("files").select("*").eq("id", file_id).execute()
        if not result.data:
            raise NotFoundException("File")
        record = result.data[0]
        if record["user_id"] != user_id:
            raise ForbiddenException("You do not own this file")

        await self._db.storage.from_(settings.SUPABASE_STORAGE_BUCKET).remove([record["storage_path"]])
        await self._db.table("files").delete().eq("id", file_id).execute()
        logger.info("File deleted", file_id=file_id)
