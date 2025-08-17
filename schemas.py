from pydantic import BaseModel, EmailStr, Field
from pydantic.config import ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

# --- User & Auth Schemas ---
class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserUpdateEmail(BaseModel):
    new_email: EmailStr
    current_password: str

class UserUpdatePassword(BaseModel):
    current_password: str
    new_password: str

# --- Chat Schemas ---
class ChatRequest(BaseModel):
    message: str
    chat_session_id: Optional[int] = None

# --- Memory Schemas ---
class UserMemoryCreate(BaseModel):
    content: str
    properties: Optional[Dict[str, Any]] = None

class UserMemoryResponse(BaseModel):
    # Pydantic v2: allow ORM objects
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    content: str
    timestamp: datetime
    properties: Optional[Dict[str, Any]] = None

# --- Feedback Schemas ---
class FeedbackRequest(BaseModel):
    chat_message_id: int
    rating: int
    comment: Optional[str] = None

# --- Diagnostics ---
class DiagnosticDataPoint(BaseModel):
    timestamp: datetime
    diagnostics: Dict[str, Any]

# --- Reasoning Engine Schemas ---
class RiskTolerance(str, Enum):
    LOW = "low"
    MEDIUM = "med"
    HIGH = "high"

class TaskSpec(BaseModel):
    """
    Structured output of the Intent Compiler agent.
    """
    task: str
    constraints: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    risk_tolerance: RiskTolerance = RiskTolerance.MEDIUM
    latency_budget_ms: int = 5000

# --- ChatMessage Response (needed by routers/chat.py) ---
class ChatMessageResponse(BaseModel):
    # Pydantic v2: allow ORM objects
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_session_id: int
    role: str
    content: str
    timestamp: datetime
    properties: Optional[Dict[str, Any]] = None


# ===============================
# Metrics / Telemetry Schemas
# ===============================

class TimeWindow(BaseModel):
    start: Optional[str] = None  # ISO8601 string
    end: Optional[str] = None    # ISO8601 string

class SummaryStats(BaseModel):
    count: int
    avg: Optional[float] = None
    p50: Optional[float] = None
    p95: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None

class BytesSummary(BaseModel):
    total: int
    avg: Optional[float] = None

class MetricsSummary(BaseModel):
    """
    Matches the shape returned by:
      - crud.get_session_metrics_summary(...)
      - crud.get_global_metrics_summary(...)
    """
    count: int
    window: TimeWindow
    models: Dict[str, int]
    cache_backends: Dict[str, int]
    t_total_ms: SummaryStats
    t_first_text_ms: SummaryStats
    t_first_chunk_ms: SummaryStats
    t_stream_open_ms: SummaryStats
    bytes_streamed: BytesSummary

class InteractionMetricResponse(BaseModel):
    """
    ORM response for individual metric rows (if we expose a row listing).
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_session_id: int
    chat_message_id: Optional[int] = None
    model: Optional[str] = None
    cache_backend: Optional[str] = None
    t_stream_open_ms: Optional[int] = None
    t_first_chunk_ms: Optional[int] = None
    t_first_text_ms: Optional[int] = None
    t_total_ms: Optional[int] = None
    chunks: Optional[int] = None
    bytes_streamed: Optional[int] = None
    extra: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
