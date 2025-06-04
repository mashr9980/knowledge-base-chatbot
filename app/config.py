import os
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
    
    # OpenAI
    OPENAI_API_KEY: str = ""
    
    # Model settings
    MODEL_NAME: str = "gpt-4o"
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
    PORT: int = 7200
    WORKERS: int = 1
    
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
    
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

settings = Settings()