# scripts/migrate_jsonb_usermemory.py
import os
from sqlmodel import create_engine
from dotenv import load_dotenv

load_dotenv()
url = os.getenv("DATABASE_URL")
if not url:
    raise SystemExit("DATABASE_URL not set")

engine = create_engine(url)

ALTER_JSONB = """
ALTER TABLE IF EXISTS usermemory
  ALTER COLUMN properties TYPE jsonb
  USING properties::jsonb;
"""

CREATE_GIN = """
CREATE INDEX IF NOT EXISTS idx_usermemory_properties_gin
  ON usermemory USING GIN (properties);
"""

with engine.connect() as conn:
    print("→ Converting usermemory.properties to JSONB…")
    conn.exec_driver_sql(ALTER_JSONB)
    conn.commit()
    print("✓ Column is JSONB.")

    print("→ Creating GIN index on properties…")
    conn.exec_driver_sql(CREATE_GIN)
    conn.commit()
    print("✓ GIN index ensured.")

print("Done.")
