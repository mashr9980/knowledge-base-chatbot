import asyncio
import atexit
import signal
import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from app.database import Base, engine, check_db_connection
from app.api import auth, admin, chat, users
from app.api.chat import websocket_heartbeat
from app.services.document_processor import start_document_processor, stop_document_processor
from app.services.document_store import DocumentStore
from app.config import settings
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Enterprise Knowledge Base API with FAISS - Multi-User",
    description="A high-performance knowledge base system optimized for multiple concurrent users with background document processing",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(chat.router)
app.include_router(users.router)

_startup_complete = False

@app.on_event("startup")
async def startup_event():
    global _startup_complete
    
    logger.info("Starting Enterprise Knowledge Base API...")
    
    if not check_db_connection():
        logger.error("Database connection failed!")
        sys.exit(1)
    else:
        logger.info("Database connection successful")
    
    try:
        start_document_processor()
        logger.info("Document processing service started")
    except Exception as e:
        logger.error(f"Failed to start document processor: {str(e)}")
        sys.exit(1)
    
    try:
        asyncio.create_task(websocket_heartbeat())
        logger.info("WebSocket heartbeat service started")
    except Exception as e:
        logger.error(f"Failed to start WebSocket heartbeat: {str(e)}")
    
    atexit.register(cleanup_on_exit)
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    _startup_complete = True
    logger.info("Startup complete! System ready for multiple users")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down services...")
    await cleanup_services()
    logger.info("Shutdown complete")

def signal_handler(signum, frame):
    logger.info(f"Received signal {signum}. Initiating graceful shutdown...")
    asyncio.create_task(cleanup_services())
    sys.exit(0)

def cleanup_on_exit():
    if _startup_complete:
        asyncio.run(cleanup_services())

async def cleanup_services():
    try:
        stop_document_processor()
        logger.info("Document processor stopped")
    except Exception as e:
        logger.error(f"Error stopping document processor: {str(e)}")

@app.get("/")
def root():
    return {
        "message": "Enterprise Knowledge Base API with FAISS - Multi-User Edition", 
        "version": "2.0.0",
        "features": [
            "JWT Authentication",
            "FAISS Vector Database",
            "WebSocket Streaming Chat",
            "Background Document Processing",
            "Multi-User Support",
            "Auto-Scaling Workers",
            "Connection Pooling",
            "Admin Management"
        ],
        "system_info": {
            "web_workers": settings.WORKERS,
            "doc_processing_workers": settings.DOC_PROCESSING_WORKERS,
            "max_concurrent_connections": settings.MAX_CONCURRENT_CONNECTIONS
        }
    }

@app.get("/health")
def health_check():
    from app.database import get_pool_status
    import time
    
    try:
        db_healthy = check_db_connection()
        
        try:
            import psutil
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            system_info = {
                "cpu_usage_percent": cpu_percent,
                "memory_usage_percent": memory.percent,
                "available_memory_gb": round(memory.available / (1024**3), 2)
            }
        except ImportError:
            system_info = {
                "cpu_usage_percent": 0,
                "memory_usage_percent": 0,
                "available_memory_gb": 0,
                "note": "psutil not available"
            }
        
        pool_status = get_pool_status()
        
        health_status = "healthy" if db_healthy else "unhealthy"
        
        return {
            "status": health_status,
            "timestamp": time.time(),
            "database": {
                "connected": db_healthy,
                "pool": pool_status
            },
            "system": system_info,
            "services": {
                "document_processor": "running" if _startup_complete else "starting",
                "websocket_heartbeat": "running" if _startup_complete else "starting"
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "timestamp": time.time()
        }

@app.get("/app")
async def serve_user_app():
    return FileResponse("static/index.html")

@app.get("/admin")
async def serve_admin_panel():
    return FileResponse("static/admin.html")

@app.get("/chat")
async def serve_chat():
    return FileResponse("static/chat.html")

@app.get("/api/documents/{document_id}/status")
async def get_document_status_public(document_id: str):
    from app.services.document_processor import get_document_processing_status
    
    document_store = DocumentStore(settings.OUTPUT_FOLDER)
    
    faiss_status = document_store.get_document_status(document_id)
    
    processing_status = get_document_processing_status(document_id)
    
    if not faiss_status and not processing_status:
        raise HTTPException(status_code=404, detail="Document not found")
    
    combined_status = {
        "document_id": document_id,
        "status": faiss_status.get('status', 'unknown') if faiss_status else 'unknown',
        "created_at": faiss_status.get('created_at') if faiss_status else None,
        "chunks_count": len(faiss_status.get('chunks', [])) if faiss_status else 0
    }
    
    if processing_status:
        combined_status.update({
            "processing_status": processing_status.get('status'),
            "processing_worker": processing_status.get('worker'),
            "retry_count": processing_status.get('retry_count', 0)
        })
    
    if faiss_status and 'error' in faiss_status:
        combined_status['error'] = faiss_status['error']
    elif processing_status and 'error' in processing_status:
        combined_status['error'] = processing_status['error']
    
    return combined_status

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)