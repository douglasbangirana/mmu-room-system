import hashlib
import hmac
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException

from . import config
from .db import conn, q1


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Dashboard users: verify the JWT, then confirm the account is still active."""
    token = authorization[7:] if authorization and authorization.startswith("Bearer ") else None
    if not token:
        raise HTTPException(401, "Authentication required")
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])
        uid = int(payload["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    with conn() as c:
        user = q1(c, "SELECT id, name, email, role, active FROM users WHERE id = %s", (uid,))
    if not user or not user["active"]:
        raise HTTPException(401, "Account disabled")
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}


def require_hod(user: dict = Depends(current_user)) -> dict:
    """Role check enforced on the server (never only in the UI)."""
    if user["role"] != "HOD":
        raise HTTPException(403, "Not allowed for your role")
    return user


def require_device(x_room_code: Optional[str] = Header(None), x_device_key: Optional[str] = Header(None)) -> dict:
    """Terminals: headers X-Room-Code + X-Device-Key."""
    if not x_room_code or not x_device_key:
        raise HTTPException(401, "Device credentials required")
    with conn() as c:
        room = q1(c, "SELECT * FROM rooms WHERE code = %s AND active = 1", (x_room_code,))
    stored = room["device_key_hash"] if room else "0" * 64
    if not room or not hmac.compare_digest(sha256(x_device_key), stored):
        raise HTTPException(401, "Invalid device credentials")
    return room
