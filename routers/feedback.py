# routers/feedback.py
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from database import get_session
from models import User
from schemas import FeedbackRequest
from crud import (
    get_chat_message_by_id, get_chat_session_by_id,
    get_feedback_by_message_id, update_feedback_entry, create_feedback_entry
)
from auth import get_current_user

router = APIRouter()

@router.post("/feedback", response_model=dict, tags=["Feedback"])
async def submit_feedback(
    feedback_data: FeedbackRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    message = get_chat_message_by_id(session, feedback_data.chat_message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Chat message not found.")

    chat_session_of_message = get_chat_session_by_id(session, message.chat_session_id)
    if not chat_session_of_message or chat_session_of_message.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to give feedback on this message.")

    existing_feedback = get_feedback_by_message_id(session, feedback_data.chat_message_id)
    if existing_feedback:
        updated_feedback = update_feedback_entry(
            session, existing_feedback.id, rating=feedback_data.rating, comment=feedback_data.comment
        )
        return {"message": "Feedback updated successfully", "feedback_id": updated_feedback.id}
    else:
        feedback_entry = create_feedback_entry(
            session=session, user_id=current_user.id, chat_message_id=feedback_data.chat_message_id,
            rating=feedback_data.rating, comment=feedback_data.comment
        )
        return {"message": "Feedback submitted successfully", "feedback_id": feedback_entry.id}
