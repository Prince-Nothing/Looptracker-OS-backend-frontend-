# looptracker_backend/database.py
from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy import text
from dotenv import load_dotenv
import os

load_dotenv()  # Load environment variables from .env

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL not found in environment variables. Please set it in your .env file.")

engine = create_engine(DATABASE_URL, echo=True)

def create_db_and_tables():
    """
    Create all tables defined in SQLModel models and set useful indexes.
    """
    # Import models so SQLModel.metadata is populated
    from models import User, ChatSession, ChatMessage, UserMemory
    from loop_models import Loop, Habit, HabitEvent

    SQLModel.metadata.create_all(engine)

    # Optional: fast JSONB containment on usermemory.properties
    try:
        with engine.connect() as conn:
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS usermemory_props_gin ON usermemory USING GIN ((properties::jsonb));")
            )
            conn.commit()
    except Exception as _e:
        # Index creation is best-effort; log if you prefer
        pass

def get_session():
    with Session(engine) as session:
        yield session
