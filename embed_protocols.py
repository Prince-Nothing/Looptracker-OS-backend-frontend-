import os
import asyncio
from typing import List
from dotenv import find_dotenv, dotenv_values
from openai import OpenAI
from sqlmodel import Session
import re

from utils import PROTOCOL_DIR, load_protocol
from database import engine, get_session, create_db_and_tables
from crud import create_user_memory, create_user, get_user_by_email
from models import UserMemory

# --- 0. Load Environment Variables ---
dotenv_path = find_dotenv(usecwd=True)
if dotenv_path:
    env_vars = dotenv_values(dotenv_path=dotenv_path)
    for key, value in env_vars.items():
        os.environ[key] = value
else:
    print("WARNING: .env file not found by dotenv. Ensure environment variables are set.")

# --- 1. Initialize OpenAI Client ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY not found in environment variables. Please set it in your .env file.")
openai_client = OpenAI(api_key=OPENAI_API_KEY)

# --- 2. Embedding Function ---
async def embed_text(text: str) -> List[float]:
    """Generates an OpenAI embedding for the given text."""
    if not text.strip():
        print("Warning: Attempted to embed empty string. Returning empty list.")
        return []
    try:
        response = openai_client.embeddings.create(
            input=text,
            model="text-embedding-ada-002"
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding for text (first 100 chars): '{text[:100]}...'")
        print(f"Detailed error: {e}")
        raise

# --- 3. MODIFIED & IMPROVED Markdown Chunking Function ---
MAX_CHUNK_SIZE = 4000

def chunk_markdown_by_heading(markdown_content: str) -> List[str]:
    """
    Chunks markdown content first by major headings, and then further subdivides
    any chunk that exceeds the MAX_CHUNK_SIZE. This prevents database errors.
    """
    initial_chunks = re.split(r'(\n## .*|\n### .*)', markdown_content)
    
    processed_chunks = []
    current_chunk = ""
    for section in initial_chunks:
        if not section.strip():
            continue
        if section.startswith('\n## ') or section.startswith('\n### '):
            if current_chunk.strip():
                processed_chunks.append(current_chunk.strip())
            current_chunk = section.strip() + "\n"
        else:
            current_chunk += section.strip() + "\n"
    if current_chunk.strip():
        processed_chunks.append(current_chunk.strip())

    if not processed_chunks and markdown_content.strip():
        processed_chunks.append(markdown_content.strip())
        
    final_chunks = []
    for chunk in processed_chunks:
        if len(chunk) <= MAX_CHUNK_SIZE:
            final_chunks.append(chunk)
        else:
            print(f"  --> Subdividing a large chunk of {len(chunk)} characters...")
            for i in range(0, len(chunk), MAX_CHUNK_SIZE):
                final_chunks.append(chunk[i:i + MAX_CHUNK_SIZE])
    
    return [chunk for chunk in final_chunks if chunk.strip()]


# --- 4. Main Embedding Logic ---
async def embed_system_protocols():
    print("--- Starting system protocol embedding process ---")
    
    print("Ensuring database tables are created...")
    create_db_and_tables() 
    print("Database tables checked/created.")

    with next(get_session()) as session:
        system_email = "system_ai@looptracker.os"
        system_user = get_user_by_email(session, email=system_email)
        if not system_user:
            print(f"System user '{system_email}' not found. Creating a new one.")
            system_user = create_user(session, email=system_email, password=os.urandom(16).hex())
            session.commit()
            session.refresh(system_user)
            print(f"System user created with ID: {system_user.id}")
        else:
            print(f"Using existing System User ID: {system_user.id}")
        
        system_user_id = system_user.id

        protocol_files = [f for f in os.listdir(PROTOCOL_DIR) if f.endswith('.md')]

        if not protocol_files:
            print(f"No .md protocol files found in directory: {PROTOCOL_DIR}. Please check the path and file extensions.")
            return

        for filename in protocol_files:
            print(f"\n--- Processing protocol file: {filename} ---")
            try:
                content = load_protocol(filename)
                if not content:
                    print(f"  Warning: No content loaded for {filename}. Skipping this file.")
                    continue

                chunks = chunk_markdown_by_heading(content)
                if not chunks:
                    print(f"  Warning: No meaningful chunks extracted from {filename}. Skipping this file.")
                    continue

                for i, chunk_content in enumerate(chunks):
                    # CORRECTED CODE BLOCK TO FIX SYNTAX ERROR
                    preview_content = chunk_content[:70].replace('\n', ' ')
                    print(f"  Embedding chunk {i+1} of {len(chunks)} from '{filename}' (Content preview: '{preview_content}...')")
                    
                    embedding = await embed_text(chunk_content)
                    
                    if not embedding:
                        print(f"    Skipping chunk {i+1} due to empty or failed embedding.")
                        continue

                    create_user_memory(
                        session=session,
                        user_id=system_user_id,
                        content=chunk_content,
                        embedding=embedding,
                        properties={
                            "source": "system_protocol",
                            "protocol_name": filename,
                            "chunk_index": i,
                            "is_system_ai_knowledge": True
                        }
                    )
                    session.commit()

                print(f"--- Finished processing '{filename}', stored {len(chunks)} chunks. ---")
            except Exception as e:
                print(f"\n  CRITICAL ERROR during processing of '{filename}': {e}\n")
                session.rollback()
                
    print("\n--- System protocol embedding process complete ---")

if __name__ == "__main__":
    asyncio.run(embed_system_protocols())