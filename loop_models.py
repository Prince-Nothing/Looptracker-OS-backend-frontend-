# loop_models.py
from typing import Optional
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON, Enum as SAEnum


class Loop(SQLModel, table=True):
    __tablename__ = "loops"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")

    title: str = Field(max_length=200)
    trigger: Optional[str] = Field(default=None)
    description: Optional[str] = Field(default=None)

    # Structured stage outputs
    ifs: dict = Field(default_factory=dict, sa_column=Column(JSON))
    cbt: dict = Field(default_factory=dict, sa_column=Column(JSON))
    metrics: dict = Field(default_factory=dict, sa_column=Column(JSON))

    status: str = Field(default="active")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), nullable=False
    )


class Habit(SQLModel, table=True):
    __tablename__ = "habits"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    loop_id: int = Field(index=True, foreign_key="loops.id")

    name: str
    cue: Optional[str] = Field(default=None)
    routine: Optional[str] = Field(default=None)
    reward: Optional[str] = Field(default=None)

    perceived_automaticity: int = Field(default=0, ge=0, le=100)
    status: str = Field(default="active")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), nullable=False
    )


# --- Use a real Enum so SAEnum works cleanly ---
class HabitEventType(str, PyEnum):
    complete = "complete"
    skip = "skip"


class HabitEvent(SQLModel, table=True):
    """
    One row per completion/skip/note for a habit.
    """
    __tablename__ = "habit_events"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    habit_id: int = Field(index=True, foreign_key="habits.id")

    ts: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        index=True,
        nullable=False,
    )

    # Stored as proper SQL Enum in Postgres
    event_type: HabitEventType = Field(
        default=HabitEventType.complete,
        sa_column=Column(SAEnum(HabitEventType, name="habit_event_type"), nullable=False),
    )

    # optional quantitative value / note
    value: Optional[int] = Field(default=None)
    note: Optional[str] = Field(default=None)
