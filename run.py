import uvicorn
import multiprocessing
import signal
import sys
import logging
import platform
from app.main import app
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    logger.info(f"Received signal {signum}. Shutting down gracefully...")
    sys.exit(0)

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    logger.info("Starting Enterprise Knowledge Base API Server")
    logger.info(f"Configuration:")
    logger.info(f"  Host: {settings.HOST}")
    logger.info(f"  Port: {settings.PORT}")
    logger.info(f"  Workers: {settings.WORKERS}")
    logger.info(f"  Document Processing Workers: {settings.DOC_PROCESSING_WORKERS}")
    logger.info(f"  Max Concurrent Connections: {settings.MAX_CONCURRENT_CONNECTIONS}")
    
    is_windows = platform.system() == "Windows"
    
    if is_windows:
        loop_type = "asyncio"
        logger.info("Windows detected - using asyncio event loop")
    else:
        try:
            import uvloop
            loop_type = "uvloop"
            logger.info("Unix/Linux detected - using uvloop for better performance")
        except ImportError:
            loop_type = "asyncio"
            logger.info("uvloop not available, falling back to asyncio")
    
    try:
        import httptools
        http_parser = "httptools"
        logger.info("Using httptools for faster HTTP parsing")
    except ImportError:
        http_parser = "h11"
        logger.info("httptools not available, using h11 HTTP parser")
    
    uvicorn_config = uvicorn.Config(
        app=app,
        host=settings.HOST,
        port=settings.PORT,
        workers=settings.WORKERS,
        
        ws_max_size=settings.WS_MAX_SIZE,
        ws_ping_interval=settings.WS_PING_INTERVAL,
        ws_ping_timeout=settings.WS_PING_TIMEOUT,
        
        loop=loop_type,
        http=http_parser,
        
        limit_concurrency=settings.MAX_CONCURRENT_CONNECTIONS,
        limit_max_requests=10000, 
        timeout_keep_alive=30,
        timeout_graceful_shutdown=30,
        
        # Logging
        log_level="info",
        access_log=True,
        
        use_colors=True,
        reload=False, 
        
        backlog=2048,  
    )
    
    try:
        server = uvicorn.Server(uvicorn_config)
        
        if settings.WORKERS > 1:
            logger.info(f"Starting {settings.WORKERS} worker processes")
            logger.warning("Note: In multi-worker mode, background document processing will run in the master process")
        else:
            logger.info("Starting single worker process")
        
        server.run()
        
    except KeyboardInterrupt:
        logger.info("Server shutdown requested by user")
    except Exception as e:
        logger.error(f"Server startup failed: {str(e)}")
        sys.exit(1)
    finally:
        logger.info("Server shutdown complete")