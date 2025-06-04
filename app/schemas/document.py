from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class DocumentBase(BaseModel):
    filename: str
    original_filename: str
    file_type: str

class DocumentResponse(BaseModel):
    document_id: str
    message: str

class DocumentStatus(BaseModel):
    document_id: str
    status: str
    error: Optional[str] = None
    created_at: Optional[str] = None
    chunks_count: int = 0

class Document(BaseModel):
    id: int
    document_id: str
    filename: str
    original_filename: str
    file_size: int
    status: str
    chunks_count: int
    uploaded_by: int
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True