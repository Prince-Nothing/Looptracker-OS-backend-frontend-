from typing import Optional, List
from datetime import datetime, timezone
from sqlmodel import Field, SQLModel, Relationship
from enum import Enum
from pydantic import BaseModel  # NEW: Import BaseModel for non-table models

from sqlalchemy import Column
from sqlalchemy.types import JSON
from pgvector.sqlalchemy import Vector
from sqlalchemy_json import NestedMutableJson

# New Enum for File Status
class FileStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"

# --- User Model ---
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    chat_sessions: List["ChatSession"] = Relationship(back_populates="user")
    files: List["File"] = Relationship(back_populates="user")
    memories: List["UserMemory"] = Relationship(back_populates="user")
    feedback_entries: List["Feedback"] = Relationship(back_populates="user")


# --- ChatSession Model ---
class ChatSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    title: str = Field(default="New Chat Session")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user: Optional[User] = Relationship(back_populates="chat_sessions")
    messages: List["ChatMessage"] = Relationship(back_populates="chat_session")


# --- ChatMessage Model ---
class ChatMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chat_session_id: int = Field(foreign_key="chatsession.id", index=True)
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)
    properties: Optional[dict] = Field(default=None, sa_column=Column(JSON))

    # Relationships
    chat_session: Optional[ChatSession] = Relationship(back_populates="messages")
    feedback_entry: Optional["Feedback"] = Relationship(back_populates="chat_message")


# --- File Model ---
class File(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    filename: str
    s3_key: str = Field(unique=True, index=True)
    file_mime_type: str
    status: FileStatus = Field(default=FileStatus.UPLOADED)
    upload_timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)
    error_message: Optional[str] = None

    # Relationship
    user: Optional[User] = Relationship(back_populates="files")
    chunks: List["DocumentChunk"] = Relationship(back_populates="file")


# --- UserMemory Model (for global context) ---
class UserMemory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    content: str = Field(max_length=4096)
    embedding: List[float] = Field(sa_column=Column(Vector(1536)))
    properties: dict = Field(default_factory=dict, sa_column=Column(NestedMutableJson))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

    user: Optional[User] = Relationship(back_populates="memories")

# --- DocumentChunk Model ---
class DocumentChunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    file_id: int = Field(foreign_key="file.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    chunk_content: str = Field(max_length=8192)
    embedding: List[float] = Field(sa_column=Column(Vector(1536)))
    properties: dict = Field(default_factory=dict, sa_column=Column(NestedMutableJson))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

    file: Optional[File] = Relationship(back_populates="chunks")


# --- Feedback Model ---
class Feedback(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    chat_message_id: int = Field(foreign_key="chatmessage.id", index=True)
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user: Optional[User] = Relationship(back_populates="feedback_entries")
    chat_message: Optional[ChatMessage] = Relationship(back_populates="feedback_entry")


# --- NEW: Interaction Metrics Model (for latency/streaming telemetry) ---
class InteractionMetric(SQLModel, table=True):
    """
    One row per assistant response (or stream) capturing latency & transport stats.

    We keep it independent (no Relationship/back_populates) to avoid touching
    existing models and migrations; foreign keys are still enforced.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    chat_session_id: int = Field(foreign_key="chatsession.id", index=True)
    chat_message_id: Optional[int] = Field(default=None, foreign_key="chatmessage.id", index=True)

    # What produced the reply
    model: Optional[str] = Field(default=None, index=True)
    cache_backend: Optional[str] = Field(default=None, index=True)

    # Timing in ms (populated by stream)
    t_stream_open_ms: Optional[int] = None
    t_first_chunk_ms: Optional[int] = None
    t_first_text_ms: Optional[int] = None
    t_total_ms: Optional[int] = None

    # Stream characteristics
    chunks: Optional[int] = None
    bytes_streamed: Optional[int] = None

    # Anything extra we want to stash (e.g., prompt hash, flags)
    extra: dict = Field(default_factory=dict, sa_column=Column(NestedMutableJson))

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)


# --- NEW: TriageDecision (logs SE/ACT/IFS routing, privacy-safe) ---
class TriageDecision(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    chat_session_id: Optional[int] = Field(default=None, foreign_key="chatsession.id", index=True)
    chat_message_id: Optional[int] = Field(default=None, foreign_key="chatmessage.id", index=True)

    label: str = Field(index=True)  # "SE" | "ACT" | "IFS"
    confidence: float
    second_choice: Optional[str] = None
    rationale: str

    prompts: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    tags: Optional[List[str]] = Field(default=None, sa_column=Column(JSON))
    distress_0_10: Optional[float] = None

    # Privacy-safe capture info (no full text)
    capture_preview: Optional[str] = Field(default=None, max_length=256)
    capture_len: Optional[int] = None
    capture_sha256: Optional[str] = Field(default=None, max_length=64)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), nullable=False)


# --- Pydantic Models (for API responses, not database tables) ---
class DiagnosticDataPoint(BaseModel):
    timestamp: datetime
    diagnostics: dict
