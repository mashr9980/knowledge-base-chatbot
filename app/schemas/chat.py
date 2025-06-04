from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ChatMessageCreate(BaseModel):
    message: str
    session_id: Optional[str] = None
    document_id: str

class ChatMessage(BaseModel):
    id: int
    message: str
    response: str
    processing_time: int
    used_latest_data: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class ChatSessionCreate(BaseModel):
    document_id: str
    session_name: str = "New Chat"

class ChatSession(BaseModel):
    id: int
    session_id: str
    document_id: str
    session_name: str
    created_at: datetime
    updated_at: Optional[datetime]
    messages: List[ChatMessage] = []
    
    class Config:
        from_attributes = True