import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

TZ_NAME = os.getenv("TZ", "Africa/Kampala")          # all timetable times are campus-local
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "8"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",")]
DB = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "mmu_rooms"),
}

if len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET must be set in .env and be at least 32 characters long.")
