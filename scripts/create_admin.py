import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models.user import User, UserRole
from app.core.security import get_password_hash
from app.database import Base

def create_admin_user():
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    
    try:
        # Check if admin already exists
        existing_admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
        if existing_admin:
            print(f"Admin user already exists: {existing_admin.username}")
            return
        
        # Get admin details
        email = input("Enter admin email: ")
        username = input("Enter admin username: ")
        full_name = input("Enter admin full name: ")
        password = input("Enter admin password: ")
        
        # Validate input
        if not all([email, username, full_name, password]):
            print("All fields are required!")
            return
        
        # Check if user already exists
        existing_user = db.query(User).filter(
            (User.email == email) | (User.username == username)
        ).first()
        
        if existing_user:
            print("User with this email or username already exists!")
            return
        
        # Create admin user
        hashed_password = get_password_hash(password)
        admin_user = User(
            email=email,
            username=username,
            full_name=full_name,
            hashed_password=hashed_password,
            role=UserRole.ADMIN,
            is_active=True
        )
        
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
        
        print(f"Admin user created successfully!")
        print(f"Username: {admin_user.username}")
        print(f"Email: {admin_user.email}")
        print(f"Role: {admin_user.role.value}")
        
    except Exception as e:
        db.rollback()
        print(f"Error creating admin user: {str(e)}")
    
    finally:
        db.close()

if __name__ == "__main__":
    create_admin_user()