import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine, Base

def setup_database():
    """Create all database tables."""
    try:
        print("Creating database tables...")
        
        # Import all models to ensure they are registered
        from app.models.user import User
        from app.models.document import Document
        from app.models.chat import ChatSession, ChatMessage
        
        Base.metadata.create_all(bind=engine)
        print("Database tables created successfully!")
        print("\nCreated tables:")
        print("- users")
        print("- documents") 
        print("- chat_sessions")
        print("- chat_messages")
    except Exception as e:
        print(f"Error creating database tables: {str(e)}")

if __name__ == "__main__":
    setup_database()