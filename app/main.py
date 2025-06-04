import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from app.database import Base, engine
from app.api import auth, admin, chat, users
from app.api.chat import websocket_heartbeat
from app.config import settings

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Enterprise Knowledge Base API with FAISS",
    description="A comprehensive knowledge base system with JWT authentication, FAISS vector database, and WebSocket streaming",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Include routers
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(chat.router)
app.include_router(users.router)

@app.on_event("startup")
async def startup_event():
    """Start background tasks"""
    asyncio.create_task(websocket_heartbeat())

@app.get("/")
def root():
    return {
        "message": "Enterprise Knowledge Base API with FAISS", 
        "version": "1.0.0",
        "features": [
            "JWT Authentication",
            "FAISS Vector Database",
            "WebSocket Streaming Chat",
            "Document Processing",
            "Admin Management"
        ]
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# Serve user panel
@app.get("/app")
async def serve_user_app():
    return FileResponse("static/index.html")

# Serve admin panel  
@app.get("/admin")
async def serve_admin_panel():
    return FileResponse("static/admin.html")

# Serve chat interface
@app.get("/chat")
async def serve_chat():
    return FileResponse("static/chat.html")

# Public document status endpoint
@app.get("/api/documents/{document_id}/status")
async def get_document_status_public(document_id: str):
    """Get document processing status (public endpoint for checking upload progress)"""
    from app.services.document_store import DocumentStore
    document_store = DocumentStore(settings.OUTPUT_FOLDER)
    
    status = document_store.get_document_status(document_id)
    if not status:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "document_id": document_id,
        "status": status['status'],
        "error": status.get('error'),
        "created_at": status.get('created_at'),
        "chunks_count": len(status.get('chunks', []))
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)