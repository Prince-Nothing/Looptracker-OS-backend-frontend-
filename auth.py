from datetime import datetime, timedelta, timezone
from typing import Optional, Annotated

from jose import JWTError, jwt
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
# Load environment variables from .env file into the environment
load_dotenv(find_dotenv(usecwd=True))

# Read critical values directly from the environment
raw_secret_key = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
try:
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
except (ValueError, TypeError):
    ACCESS_TOKEN_EXPIRE_MINUTES = 30

# --- Key Sanitization (The Fix) ---
# This is the critical change. We strip whitespace and any surrounding quotes.
if raw_secret_key:
    SECRET_KEY = raw_secret_key.strip().strip('"').strip("'")
else:
    # This will cause a clear failure if the key is missing entirely.
    raise ValueError("SECRET_KEY not found in environment variables. Please set it in your .env file.")

# OAuth2PasswordBearer tells FastAPI where to find the token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False) # Set auto_error=False for our new dependency

# --- Pydantic Models for Tokens ---
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    email: Optional[str] = None # We store email in the token subject

# --- JWT Encoding/Decoding Functions ---
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """
    Creates a new JWT access token using the sanitized SECRET_KEY.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_access_token(token: str, credentials_exception):
    """
    Verifies a JWT access token using the sanitized SECRET_KEY.
    Raises the provided exception if the token is invalid or expired.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: Optional[str] = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except JWTError:
        raise credentials_exception
    return token_data

# --- Dependency to Get Current Authenticated User ---
async def get_current_user(
    token: Annotated[str, Depends(OAuth2PasswordBearer(tokenUrl="login"))], # Use a strict dependency here
    session: Annotated[Session, Depends(get_session)]
) -> User:
    """
    The dependency that protected endpoints will use.
    1. Verifies JWT token from Authorization header.
    2. Retrieves user from database.
    3. Returns the full User object.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token_data = verify_access_token(token, credentials_exception)
    
    if token_data.email is None:
         raise credentials_exception

    user = get_user_by_email(session, email=token_data.email)
    
    if user is None:
        # Note: This raises a 404, not a 401. This is good for security.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        
    return user

# --- NEW: Flexible dependency for Server-Sent Events ---
async def get_current_user_sse(
    session: Annotated[Session, Depends(get_session)],
    header_token: Annotated[Optional[str], Depends(oauth2_scheme)] = None,
    query_token: Annotated[Optional[str], Query(alias="token")] = None,
) -> User:
    """
    A flexible dependency for SSE that gets the user from a token
    in either the Authorization header or a query parameter.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials for event stream",
    )
    
    # Prioritize header token, but fall back to query token
    token = header_token or query_token
    
    if token is None:
        raise credentials_exception
        
    token_data = verify_access_token(token, credentials_exception)
    
    if token_data.email is None:
         raise credentials_exception

    user = get_user_by_email(session, email=token_data.email)
    
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        
    return user