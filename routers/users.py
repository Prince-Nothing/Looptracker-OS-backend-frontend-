# routers/users.py

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from typing import Annotated
from sqlmodel import Session
from datetime import timedelta
import os

from database import get_session
from models import User
from schemas import UserCreate, Token, UserUpdateEmail, UserUpdatePassword
from crud import get_user_by_email, verify_password, create_user, update_user_email, update_user_password
from auth import create_access_token, get_current_user # Note: We import from the original auth.py

# Create an APIRouter instance
router = APIRouter()

# --- User & Auth Endpoints ---

@router.post("/register", response_model=User, tags=["Authentication"])
def register_user(user_create: UserCreate, session: Annotated[Session, Depends(get_session)]):
    db_user = get_user_by_email(session, email=user_create.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = create_user(session, email=user_create.email, password=user_create.password)
    return user

@router.post("/login", response_model=Token, tags=["Authentication"])
def login_user(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], session: Annotated[Session, Depends(get_session)]):
    user = get_user_by_email(session, email=form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    
    expire_minutes = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
    access_token_expires = timedelta(minutes=expire_minutes)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=access_token_expires)
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/users/me", response_model=User, tags=["Users"])
def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user

@router.put("/users/me/email", response_model=User, tags=["Users"])
def update_users_me_email(
    user_update: UserUpdateEmail, 
    session: Annotated[Session, Depends(get_session)], 
    current_user: Annotated[User, Depends(get_current_user)]
):
    if not verify_password(user_update.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid current password.")
    
    existing_user_with_new_email = get_user_by_email(session, email=user_update.new_email)
    if existing_user_with_new_email and existing_user_with_new_email.id != current_user.id:
        raise HTTPException(status_code=400, detail="New email is already registered.")
    
    updated_user = update_user_email(session, current_user, user_update.new_email)
    return updated_user

@router.put("/users/me/password", response_model=User, tags=["Users"])
def update_users_me_password(
    user_update: UserUpdatePassword, 
    session: Annotated[Session, Depends(get_session)], 
    current_user: Annotated[User, Depends(get_current_user)]
):
    if not verify_password(user_update.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid current password.")
    
    updated_user = update_user_password(session, current_user, user_update.new_password)
    return updated_user