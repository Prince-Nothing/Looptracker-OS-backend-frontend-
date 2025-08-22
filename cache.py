# cache.py
import os
import json
import time
from typing import Optional, Tuple

try:
    import redis  # type: ignore
except Exception:
    redis = None

_DEFAULT_TTL = 7200  # 2 hours

class _MemoryCache:
    """Simple in-process cache with TTL, used when Redis is unavailable."""
    def __init__(self):
        self._store: dict[str, Tuple[str, float]] = {}

    def set(self, key: str, value: str, ex: Optional[int] = None):
        ttl = ex if ex is not None else _DEFAULT_TTL
        self._store[key] = (value, time.time() + ttl)

    def get(self, key: str) -> Optional[str]:
        item = self._store.get(key)
        if not item:
            return None
        value, exp = item
        if time.time() > exp:
            self._store.pop(key, None)
            return None
        return value

# Choose backend
_REDIS_URL = os.getenv("REDIS_URL") or os.getenv("CELERY_BROKER_URL")
_backend = "memory"
_client = _MemoryCache()

if _REDIS_URL and redis is not None:
    try:
        _redis_client = redis.Redis.from_url(_REDIS_URL, decode_responses=True)
        # sanity check
        _redis_client.ping()
        _client = _redis_client
        _backend = "redis"
    except Exception as e:
        print(f"[cache] Redis unavailable ({e}); falling back to in-memory cache.")

def cache_backend() -> str:
    """Returns 'redis' or 'memory'."""
    return _backend

def _set(key: str, payload: dict, ttl: int = _DEFAULT_TTL):
    try:
        _client.set(key, json.dumps(payload), ex=ttl)
    except Exception as e:
        print(f"Error setting cache key {key}: {e}")

def _get(key: str) -> Optional[dict]:
    try:
        raw = _client.get(key)
        return json.loads(raw) if raw else None
    except Exception as e:
        print(f"Error getting cache key {key}: {e}")
        return None

def set_session_state(session_id: int, state: dict):
    """
    Saves a user's session state (diagnostics, etc.) to cache with TTL.
    """
    _set(f"session_state:{session_id}", state, ttl=_DEFAULT_TTL)

def get_session_state(session_id: int) -> dict:
    """
    Retrieves a user's session state from cache. Returns {} if not found.
    """
    obj = _get(f"session_state:{session_id}")
    return obj or {}
