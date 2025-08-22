# main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from dotenv import load_dotenv, find_dotenv
import os

# Internal module imports for application setup
from database import create_db_and_tables
from routers import users, chat, files, memory, feedback, diagnostics, loops, triage  # ⬅️ added triage

# --- Environment and App Initialization ---
load_dotenv(find_dotenv(usecwd=True))

app = FastAPI(
    title="Looptracker OS Backend",
    description="The core API for the Metacognitive Operating System.",
    version="0.1.0"
)

# --- CORS Middleware ---
origins = ["http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- App Startup Event ---
@app.on_event("startup")
def on_startup():
    """
    Creates database tables on application startup.
    """
    create_db_and_tables()

# --- Include Routers ---
app.include_router(users.router)
app.include_router(chat.router)
app.include_router(files.router)
app.include_router(memory.router)
app.include_router(feedback.router)
app.include_router(diagnostics.router)
app.include_router(loops.router)   # Open Loops
app.include_router(triage.router)  # Dynamic Triage (SE/ACT/IFS)

# --- Optional: quiet the favicon 404 when you hit the backend in a browser ---
@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)

# --- Health Endpoint ---
@app.get("/health", tags=["Default"])
def health():
    cache_backend = "memory"
    redis_url = os.getenv("REDIS_URL")
    info = {"redis_url_set": bool(redis_url)}

    if redis_url:
        try:
            import redis
            client = redis.from_url(redis_url, decode_responses=True)
            client.ping()
            cache_backend = "redis"
        except Exception:
            cache_backend = "memory"

    return JSONResponse(
        {
            "status": "ok",
            "version": app.version,
            "cache_backend": cache_backend,
            "env": info,
        }
    )

# --- Root Endpoint ---
@app.get("/", tags=["Default"])
def read_root():
    return {"message": "Looptracker Backend is running!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
