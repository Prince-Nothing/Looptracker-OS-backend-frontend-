# looptracker_backend/database.py
from sqlmodel import create_engine, Session, SQLModel # Import SQLModel directly here
from dotenv import load_dotenv
import os

load_dotenv() # Load environment variables from .env

# Retrieve the database URL from environment variables
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL not found in environment variables. Please set it in your .env file.")

# Create the database engine
engine = create_engine(DATABASE_URL, echo=True)

def create_db_and_tables():
    """
    Function to create all tables defined in your SQLModel models.
    This should be called once when the application starts or for migrations.
    """
    # IMPORT YOUR MODELS HERE so SQLModel.metadata.create_all() can discover them.
    # This import needs to happen inside the function to prevent circular import issues
    # if models.py were to indirectly import something from database.py.
    from models import User, ChatSession, ChatMessage
    SQLModel.metadata.create_all(engine)

def get_session():
    """
    Dependency that provides a database session.
    This will be used by FastAPI endpoints to get a database connection.
    """
    with Session(engine) as session:
        yield session