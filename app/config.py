import os
import psutil
import multiprocessing
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseSettings):
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "123"
    DB_HOST: str = "localhost"
    DB_PORT: str = "5432"
    DB_NAME: str = "knowledge_base_db"
    
    # JWT
    SECRET_KEY: str = "your-very-long-and-secure-secret-key-here-at-least-32-characters"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 300
    
    # Ollama settings
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # Model settings for gemma3:12b
    MODEL_NAME: str = "qwen2.5:7b"
    TEMPERATURE: float = 0.0
    TOP_P: float = 0.95
    REPETITION_PENALTY: float = 1.15
    
    # Data settings
    SPLIT_CHUNK_SIZE: int = 500
    SPLIT_OVERLAP: int = 50
    EMBEDDINGS_MODEL: str = "BAAI/bge-base-en-v1.5"
    SIMILAR_DOCS_COUNT: int = 6
    OUTPUT_FOLDER: str = "./rag-vectordb"
    
    # File Upload
    MAX_FILE_SIZE: int = 10485760
    ALLOWED_EXTENSIONS: str = "pdf,docx,txt,xlsx"
    UPLOAD_DIR: str = "uploads"
    
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 7201
    
    # Hardware-optimized settings
    WORKERS: int = 1
    DOC_PROCESSING_WORKERS: int = 1
    MAX_CONCURRENT_CONNECTIONS: int = 100
    WS_MAX_SIZE: int = 16777216
    WS_PING_INTERVAL: int = 30
    WS_PING_TIMEOUT: int = 10
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    EMBEDDING_CACHE_SIZE: int = 1000
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._calculate_hardware_settings()
    
    def _calculate_hardware_settings(self):
        cpu_count = multiprocessing.cpu_count()
        memory_gb = psutil.virtual_memory().total / (1024**3)
        
        if cpu_count <= 2:
            self.WORKERS = max(2, cpu_count)
        elif cpu_count <= 4:
            self.WORKERS = cpu_count * 2
        elif cpu_count <= 8:
            self.WORKERS = int(cpu_count * 1.5)
        else:
            self.WORKERS = min(16, cpu_count)
        
        self.DOC_PROCESSING_WORKERS = max(1, cpu_count // 2)

        available_memory_mb = memory_gb * 1024 * 0.7
        self.MAX_CONCURRENT_CONNECTIONS = int(available_memory_mb / 10)
        
        self.WS_MAX_SIZE = 16777216
        self.WS_PING_INTERVAL = 30
        self.WS_PING_TIMEOUT = 10
        
        self.DB_POOL_SIZE = min(20, self.WORKERS * 2)
        self.DB_MAX_OVERFLOW = min(30, self.WORKERS * 3)
        
        self.EMBEDDING_CACHE_SIZE = min(1000, int(memory_gb * 100))
        
        print(f"Hardware Configuration Detected:")
        print(f"CPU Cores: {cpu_count}")
        print(f"Memory: {memory_gb:.1f} GB")
        print(f"Optimized Settings:")
        print(f"Web Workers: {self.WORKERS}")
        print(f"Document Processing Workers: {self.DOC_PROCESSING_WORKERS}")
        print(f"Max Concurrent Connections: {self.MAX_CONCURRENT_CONNECTIONS}")
        print(f"Database Pool Size: {self.DB_POOL_SIZE}")
        print(f"Embedding Cache Size: {self.EMBEDDING_CACHE_SIZE}")
        print(f"Using Ollama Model: {self.MODEL_NAME} at {self.OLLAMA_BASE_URL}")
    
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
    
    @property
    def DATABASE_URL_WITH_POOL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?pool_size={self.DB_POOL_SIZE}&max_overflow={self.DB_MAX_OVERFLOW}"
    
    @property
    def ALLOWED_EXTENSIONS_LIST(self) -> list:
        return self.ALLOWED_EXTENSIONS.split(",")
    
    @property
    def POSTGRES_USER(self) -> str:
        return self.DB_USER
    
    @property
    def POSTGRES_PASSWORD(self) -> str:
        return self.DB_PASSWORD
    
    @property
    def POSTGRES_SERVER(self) -> str:
        return self.DB_HOST
    
    @property
    def POSTGRES_PORT(self) -> str:
        return self.DB_PORT
    
    @property
    def POSTGRES_DB(self) -> str:
        return self.DB_NAME
    
    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()