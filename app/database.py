from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from app.config import settings

# Create engine with optimized connection pooling for multiple users
engine = create_engine(
    settings.DATABASE_URL,
    poolclass=QueuePool,
    pool_size=settings.DB_POOL_SIZE,  # Number of connections to maintain in the pool
    max_overflow=settings.DB_MAX_OVERFLOW,  # Maximum number of connections beyond pool_size
    pool_pre_ping=True,  # Validate connections before use
    pool_recycle=3600,  # Recycle connections after 1 hour
    echo=False,  # Set to True for SQL query logging (disable in production)
    connect_args={
        "application_name": "knowledge_base",
        "connect_timeout": 10,
        # "command_timeout": 30
    }
)

# Create sessionmaker with optimized settings
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False  # Prevent lazy loading issues in async contexts
)

Base = declarative_base()

def get_db():
    """
    Database dependency with proper session management for multiple users
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()

def get_db_for_background_task():
    """
    Get database session for background tasks (like document processing)
    This creates a new session that should be manually closed
    """
    return SessionLocal()

def check_db_connection():
    """
    Check database connection health
    """
    try:
        db = SessionLocal()
        # Use text() for raw SQL queries in SQLAlchemy 2.0+
        db.execute(text("SELECT 1"))
        db.close()
        return True
    except Exception as e:
        print(f"Database connection failed: {str(e)}")
        return False

# Connection pool status monitoring
def get_pool_status():
    """
    Get current connection pool status for monitoring
    """
    try:
        pool = engine.pool
        return {
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "invalid": getattr(pool, 'invalid', lambda: 0)()  # Some pool types don't have invalid()
        }
    except Exception as e:
        return {
            "size": 0,
            "checked_in": 0,
            "checked_out": 0,
            "overflow": 0,
            "invalid": 0,
            "error": str(e)
        }