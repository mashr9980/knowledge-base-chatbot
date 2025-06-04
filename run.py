import uvicorn
from app.main import app
from app.config import settings

if __name__ == "__main__":
    uvicorn_config = uvicorn.Config(
        app=app,
        host=settings.HOST,
        port=settings.PORT,
        workers=settings.WORKERS,
        ws_max_size=16777216,
        ws_ping_interval=None,
        ws_ping_timeout=None,
        loop="auto",
        ws="websockets",
        log_level="info"
    )
    
    server = uvicorn.Server(uvicorn_config)
    server.run()