# routers/loops.py
import os, re, json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from openai import AsyncOpenAI

from database import get_session
from models import User, UserMemory
from loop_models import Loop, Habit, HabitEvent, HabitEventType

from .users import get_current_user
from .memory import embed_text_for_memory
from crud import create_user_memory

# NEW: for proper JSONB containment
from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import JSONB

router = APIRouter(prefix="/loops", tags=["Loops"])
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ---------- Safety guard ----------
_CRISIS = re.compile(
    r"(suicid|kill myself|end my life|self[-\s]?harm|i(?:'m| am) going to (?:hurt|harm) myself|overdose|no reason to live)",
    re.I,
)
def crisis_guard(text: str) -> Optional[Dict[str, Any]]:
    if _CRISIS.search(text or ""):
        return {
            "safe": True,
            "message": (
                "I’m not a clinical service, but I care about your safety. "
                "If you’re in immediate danger, contact your local emergency number. "
                "You can find local resources via findahelpline.com. "
                "If you’d like, we can pause this topic and focus on grounding."
            )
        }
    return None

# ---------- Schemas ----------
class LoopCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    trigger: Optional[str] = None
    description: Optional[str] = None

class LoopOut(BaseModel):
    id: int
    title: str
    trigger: Optional[str] = None
    description: Optional[str] = None
    ifs: Dict[str, Any] = {}
    cbt: Dict[str, Any] = {}
    metrics: Dict[str, Any] = {}
    status: str
    class Config:
        from_attributes = True

class BefriendIn(BaseModel):
    entry: str = Field(min_length=1)

class AnalyzeIn(BaseModel):
    entry: str = Field(min_length=1)

class ChunkIn(BaseModel):
    goal_or_insight: str = Field(min_length=1)

class HabitOut(BaseModel):
    id: int
    loop_id: int
    name: str
    cue: Optional[str] = None
    routine: Optional[str] = None
    reward: Optional[str] = None
    perceived_automaticity: int
    status: str
    class Config:
        from_attributes = True

class HabitUpdate(BaseModel):
    name: Optional[str] = None
    cue: Optional[str] = None
    routine: Optional[str] = None
    reward: Optional[str] = None
    perceived_automaticity: Optional[int] = Field(None, ge=0, le=100)
    status: Optional[str] = Field(None, description="active | paused | archived")

class MemoryItemOut(BaseModel):
    id: int
    content: str
    properties: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    class Config:
        from_attributes = True

# --- Habit events ---
class HabitEventIn(BaseModel):
    type: str = Field(pattern="^(complete|skip)$")  # pydantic v2
    value: Optional[int] = None
    note: Optional[str] = None

class HabitEventOut(BaseModel):
    id: int
    habit_id: int
    user_id: int
    ts: datetime
    event_type: str
    value: Optional[int] = None
    note: Optional[str] = None
    class Config:
        from_attributes = True

class HabitSummaryOut(BaseModel):
    habit_id: int
    name: str
    streak_current: int
    streak_best: int
    completion_rate_7: float
    completion_rate_30: float
    last_done: Optional[datetime] = None

# ---------- Helpers ----------
def _awaitable_embed(text: str) -> List[float]:
    import anyio
    try:
        return anyio.run(embed_text_for_memory, text)
    except Exception:
        return []

def _date_key(dt: datetime) -> str:
    d = dt.astimezone(timezone.utc).date()
    return d.isoformat()

def _streaks_from_days(completed_days: List[str]) -> Dict[str, int]:
    if not completed_days:
        return {"current": 0, "best": 0}
    days = sorted(set(completed_days))  # ascending
    best = cur = 1
    for i in range(1, len(days)):
        prev = datetime.fromisoformat(days[i - 1]).date()
        curd = datetime.fromisoformat(days[i]).date()
        if (curd - prev).days == 1:
            cur += 1
            best = max(best, cur)
        else:
            cur = 1
    today = datetime.now(timezone.utc).date()
    cur_streak = 0
    s = set(days)
    d = today
    while d.isoformat() in s:
        cur_streak += 1
        d = d - timedelta(days=1)
    return {"current": cur_streak, "best": best}

# ---------- Routes (order matters!) ----------

# 1) Collections
@router.post("", response_model=LoopOut)
def create_loop(
    payload: LoopCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    loop = Loop(
        user_id=current_user.id,
        title=payload.title,
        trigger=payload.trigger,
        description=payload.description,
    )
    session.add(loop)
    session.commit()
    session.refresh(loop)

    text = f"[Loop Capture] Title: {loop.title}\nTrigger: {loop.trigger or '-'}\nDescription: {loop.description or '-'}"
    embedding = _awaitable_embed(text)
    create_user_memory(
        session=session,
        user_id=current_user.id,
        content=text,
        embedding=embedding,
        properties={"source": "loops.capture", "loop_id": loop.id},
    )
    return loop

@router.get("", response_model=List[LoopOut])
def list_loops(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = 50,
):
    stmt = select(Loop).where(Loop.user_id == current_user.id).order_by(Loop.id.desc()).limit(limit)
    return session.exec(stmt).all()

# 2) HABITS
@router.get("/habits", response_model=List[HabitOut])
def list_habits(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = 50,
):
    stmt = (
        select(Habit)
        .where(Habit.user_id == current_user.id)
        .order_by(Habit.id.desc())
        .limit(limit)
    )
    return session.exec(stmt).all()

@router.patch("/habits/{habit_id}", response_model=HabitOut)
def update_habit(
    habit_id: int,
    payload: HabitUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    habit = session.get(Habit, habit_id)
    if not habit or habit.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Habit not found")

    updates = payload.dict(exclude_unset=True)
    if "status" in updates and updates["status"] not in {"active", "paused", "archived"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    for k, v in updates.items():
        setattr(habit, k, v)

    session.add(habit)
    session.commit()
    session.refresh(habit)
    return habit

# 2a) HABIT EVENTS
@router.post("/habits/{habit_id}/events", response_model=HabitEventOut)
def create_habit_event(
    habit_id: int,
    payload: HabitEventIn,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    habit = session.get(Habit, habit_id)
    if not habit or habit.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Habit not found")

    ev = HabitEvent(
        user_id=current_user.id,
        habit_id=habit_id,
        event_type=HabitEventType(payload.type),
        value=payload.value,
        note=payload.note,
    )
    session.add(ev)
    session.commit()
    session.refresh(ev)

    summary = f"[Habit {ev.event_type}] Habit #{habit_id} ({habit.name})"
    create_user_memory(
        session=session,
        user_id=current_user.id,
        content=summary,
        embedding=_awaitable_embed(summary),
        properties={"source": "habit.event", "habit_id": habit_id, "event_id": ev.id},
    )
    return ev

@router.get("/habits/{habit_id}/events", response_model=List[HabitEventOut])
def list_habit_events(
    habit_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    days: int = 30,
):
    habit = session.get(Habit, habit_id)
    if not habit or habit.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Habit not found")

    since = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    stmt = (
        select(HabitEvent)
        .where(HabitEvent.user_id == current_user.id)
        .where(HabitEvent.habit_id == habit_id)
        .where(HabitEvent.ts >= since)
        .order_by(HabitEvent.ts.desc())
    )
    return session.exec(stmt).all()

@router.get("/habits/summary", response_model=List[HabitSummaryOut])
def habit_summary(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    days: int = 30,
):
    days = max(7, min(365, days))
    since = datetime.now(timezone.utc) - timedelta(days=days)

    habits = session.exec(
        select(Habit).where(Habit.user_id == current_user.id)
    ).all()
    if not habits:
        return []

    ev_rows = session.exec(
        select(HabitEvent)
        .where(HabitEvent.user_id == current_user.id)
        .where(HabitEvent.ts >= since)
    ).all()

    by_habit: Dict[int, List[HabitEvent]] = {}
    for ev in ev_rows:
        by_habit.setdefault(ev.habit_id, []).append(ev)

    out: List[HabitSummaryOut] = []
    now = datetime.now(timezone.utc)
    day7 = now - timedelta(days=7)
    day30 = now - timedelta(days=30)

    for h in habits:
        events = by_habit.get(h.id, [])
        completes = [e for e in events if e.event_type == HabitEventType.complete]
        last_done = max((e.ts for e in completes), default=None)

        c7 = sum(1 for e in completes if e.ts >= day7)
        c30 = sum(1 for e in completes if e.ts >= day30)
        rate7 = c7 / 7.0
        rate30 = c30 / 30.0

        completed_days = [e.ts.astimezone(timezone.utc).date().isoformat() for e in completes]
        # compute streaks
        if not completed_days:
            cur_streak, best_streak = 0, 0
        else:
            days_sorted = sorted(set(completed_days))
            best_streak = cur = 1
            from datetime import date
            for i in range(1, len(days_sorted)):
                prev = datetime.fromisoformat(days_sorted[i - 1]).date()
                curd = datetime.fromisoformat(days_sorted[i]).date()
                if (curd - prev).days == 1:
                    cur += 1
                    best_streak = max(best_streak, cur)
                else:
                    cur = 1
            today = datetime.now(timezone.utc).date()
            cur_streak = 0
            s = set(days_sorted)
            d = today
            while d.isoformat() in s:
                cur_streak += 1
                d = d - timedelta(days=1)

        out.append(
            HabitSummaryOut(
                habit_id=h.id,
                name=h.name,
                streak_current=cur_streak,
                streak_best=best_streak,
                completion_rate_7=rate7,
                completion_rate_30=rate30,
                last_done=last_done,
            )
        )
    return out

# 3) Loop-scoped extras
@router.get("/{loop_id}/memories", response_model=List[MemoryItemOut])
def list_loop_memories(
    loop_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = 20,
):
    # FIX: use JSONB containment instead of LIKE-on-JSON
    stmt = (
        select(UserMemory)
        .where(UserMemory.user_id == current_user.id)
        .where(cast(UserMemory.properties, JSONB).contains({"loop_id": loop_id}))
        .order_by(UserMemory.id.desc())
        .limit(limit)
    )
    return session.exec(stmt).all()

@router.post("/{loop_id}/befriend", response_model=LoopOut)
async def befriend_loop(
    loop_id: int,
    payload: BefriendIn,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    loop = session.get(Loop, loop_id)
    if not loop or loop.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Loop not found")

    guard = crisis_guard(payload.entry)
    if guard:
        loop.ifs = {"safety_intercepted": True, "note": guard["message"]}
        session.add(loop); session.commit(); session.refresh(loop)
        summary = f"[IFS Befriend] Loop #{loop.id} (safety intercepted)\nNote: {guard['message']}"
    else:
        sys = (
            "You are an IFS-informed guide. Extract a concise JSON object from the user's text. "
            "Keys: part_name, emotions (array), fears (array), needs (array), gratitude_statement (string), short_reflection (string). "
            "No commentary; JSON only."
        )
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": payload.entry}],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=400,
        )
        loop.ifs = json.loads(resp.choices[0].message.content or "{}")
        session.add(loop); session.commit(); session.refresh(loop)
        summary = f"[IFS Befriend] Loop #{loop.id}\nInput: {payload.entry}\nExtracted: {json.dumps(loop.ifs, ensure_ascii=False)}"

    emb = await embed_text_for_memory(summary)
    create_user_memory(
        session=session,
        user_id=current_user.id,
        content=summary,
        embedding=emb,
        properties={"source": "loops.befriend", "loop_id": loop.id},
    )
    return loop

@router.post("/{loop_id}/analyze", response_model=LoopOut)
async def analyze_loop(
    loop_id: int,
    payload: AnalyzeIn,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    loop = session.get(Loop, loop_id)
    if not loop or loop.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Loop not found")

    guard = crisis_guard(payload.entry)
    if guard:
        loop.cbt = {"safety_intercepted": True, "note": guard["message"]}
        session.add(loop); session.commit(); session.refresh(loop)
        summary = f"[CBT Analyze] Loop #{loop.id} (safety intercepted)\nNote: {guard['message']}"
    else:
        sys = (
            "You are a CBT analyst. From the user's text, produce JSON with keys: "
            "automatic_thoughts (array), distortions (array of strings), evidence_for (array), evidence_against (array), "
            'balanced_alternative (string), one_question (string). Return JSON only.'
        )
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": payload.entry}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=450,
        )
        loop.cbt = json.loads(resp.choices[0].message.content or "{}")
        session.add(loop); session.commit(); session.refresh(loop)
        summary = f"[CBT Analyze] Loop #{loop.id}\nInput: {payload.entry}\nExtracted: {json.dumps(loop.cbt, ensure_ascii=False)}"

    emb = await embed_text_for_memory(summary)
    create_user_memory(
        session=session,
        user_id=current_user.id,
        content=summary,
        embedding=emb,
        properties={"source": "loops.analyze", "loop_id": loop.id},
    )
    return loop

@router.post("/{loop_id}/chunk", response_model=HabitOut)
async def chunk_loop_into_habit(
    loop_id: int,
    payload: ChunkIn,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    loop = session.get(Loop, loop_id)
    if not loop or loop.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Loop not found")

    sys = (
        "You design one tiny habit from a goal/insight. Return JSON only: "
        '{ "name": str, "cue": str, "routine": str, "reward": str }. Keep it specific and 1–3 minutes long.'
    )
    resp = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": sys}, {"role": "user", "content": payload.goal_or_insight}],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=300,
    )
    plan = json.loads(resp.choices[0].message.content or "{}")
    habit = Habit(
        user_id=current_user.id,
        loop_id=loop.id,
        name=plan.get("name") or "Micro-action",
        cue=plan.get("cue"),
        routine=plan.get("routine"),
        reward=plan.get("reward"),
        perceived_automaticity=0,
        status="active",
    )
    session.add(habit)
    session.commit()
    session.refresh(habit)

    summary = (
        f"[Chunk → Habit] Loop #{loop.id}\n"
        f"Insight: {payload.goal_or_insight}\n"
        f"Habit: {habit.name} | Cue: {habit.cue} | Routine: {habit.routine} | Reward: {habit.reward}"
    )
    emb = await embed_text_for_memory(summary)
    create_user_memory(
        session=session,
        user_id=current_user.id,
        content=summary,
        embedding=emb,
        properties={"source": "loops.chunk", "loop_id": loop.id, "habit_id": habit.id},
    )
    return habit

# 4) Single loop (dynamic path LAST)
@router.get("/{loop_id}", response_model=LoopOut)
def get_loop(
    loop_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    loop = session.get(Loop, loop_id)
    if not loop or loop.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Loop not found")
    return loop
