from datetime import datetime

from pydantic import BaseModel


class FileResponse(BaseModel):
    id: str
    user_id: str
    filename: str | None
    content_type: str
    size_bytes: int
    url: str
    storage_path: str
    created_at: datetime


class FileListResponse(BaseModel):
    files: list[FileResponse]
    total: int = 0

    def model_post_init(self, __context) -> None:
        self.total = len(self.files)
