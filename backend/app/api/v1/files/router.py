from fastapi import APIRouter, File, UploadFile, status

from app.api.v1.files.schemas import FileResponse, FileListResponse
from app.api.v1.files.service import FileService
from app.core.dependencies import CurrentUserDep, DBDep

router = APIRouter(prefix="/files", tags=["Files"])


@router.post("/upload", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUserDep = None,
    db: DBDep = None,
):
    """Upload a file to Supabase Storage."""
    return await FileService(db).upload(file, user_id=current_user["id"])


@router.get("/", response_model=FileListResponse)
async def list_files(current_user: CurrentUserDep, db: DBDep):
    """List all files uploaded by the current user."""
    return await FileService(db).list_user_files(user_id=current_user["id"])


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(file_id: str, current_user: CurrentUserDep, db: DBDep):
    """Delete a file (owner only)."""
    await FileService(db).delete(file_id=file_id, user_id=current_user["id"])
