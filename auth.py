from datetime import datetime, timedelta, timezone
from typing import Optional, Annotated

from jose import jwt, JWTError
from jose.exceptions import ExpiredSignatureError
from fastapi import Depends, HTTPException, status, Query
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from dotenv import load_dotenv, find_dotenv
import os

# Database session and model imports
from sqlmodel import Session
from database import get_session
from crud import get_user_by_email
from models import User

# --- Configuration Loading ---
load_dotenv(find_dotenv(usecwd=True))

raw_secret_key = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
try:
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
except (ValueError, TypeError):
    ACCESS_TOKEN_EXPIRE_MINUTES = 30

# --- Key Sanitization ---
if raw_secret_key:
    SECRET_KEY = raw_secret_key.strip().strip('"').strip("'")
else:
    raise ValueError("SECRET_KEY not found in environment variables. Please set it in your .env file.")

# OAuth2PasswordBearer for standard header-based auth
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)  # allow None for SSE helper

# --- Pydantic Models for Tokens ---
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    email: Optional[str] = None  # We store email in the token subject (sub)

# --- Helpers ---
def _normalize_token(token: str) -> str:
    """Trim quotes/whitespace and strip an optional 'Bearer ' prefix."""
    t = (token or "").strip().strip('"').strip("'")
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    return t

# --- JWT Encode/Decode ---
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_access_token(token: str, credentials_exception):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: Optional[str] = payload.get("sub")
        if email is None:
            raise credentials_exception
        return TokenData(email=email)
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise credentials_exception

# --- Dependency: strict header-based user (for normal APIs) ---
async def get_current_user(
    token: Annotated[str, Depends(OAuth2PasswordBearer(tokenUrl="login"))],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token_data = verify_access_token(_normalize_token(token), credentials_exception)
    if token_data.email is None:
        raise credentials_exception

    user = get_user_by_email(session, email=token_data.email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user

# --- Flexible dependency for Server-Sent Events (header OR query token) ---
async def get_current_user_sse(
    session: Annotated[Session, Depends(get_session)],
    header_token: Annotated[Optional[str], Depends(oauth2_scheme)] = None,
    query_token: Annotated[Optional[str], Query(alias="token")] = None,
    query_access_token: Annotated[Optional[str], Query(alias="access_token")] = None,
) -> User:
    """
    Accepts:
      - Authorization: Bearer <jwt>
      - ?token=<jwt>
      - ?access_token=<jwt>
    Normalizes optional 'Bearer ' prefix and gives clearer errors for expired vs invalid.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials for event stream",
    )

    candidate = header_token or query_token or query_access_token
    if not candidate:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    token = _normalize_token(candidate)
    token_data = verify_access_token(token, credentials_exception)
    if token_data.email is None:
        raise credentials_exception

    user = get_user_by_email(session, email=token_data.email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user
