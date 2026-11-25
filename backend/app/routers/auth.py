import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from ..apirouter import ApiRouter
from .. import config
from ..db import conn, q1, x
from ..security import current_user

router = ApiRouter(prefix="/api/auth")
_DUMMY = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt()).decode()   # keeps timing equal for unknown emails
_attempts = defaultdict(list)


class Login(BaseModel):
    email: str = ""
    password: str = ""


@router.post("/login")
def login(body: Login, request: Request):
    # Simple in-memory limiter: 20 attempts per 15 minutes per address
    ip = request.client.host if request.client else "?"
    now = time.time()
    _attempts[ip] = [t for t in _attempts[ip] if now - t < 900]
    if len(_attempts[ip]) >= 20:
        raise HTTPException(429, "Too many login attempts. Try again in 15 minutes.")
    _attempts[ip].append(now)

    with conn() as c:
        user = q1(c, "SELECT * FROM users WHERE email = %s", (body.email.strip().lower(),))
    stored = user["password_hash"] if user else _DUMMY
    ok = bcrypt.checkpw(body.password.encode(), stored.encode())    # also verifies hashes made by the Node version
    if not user or not user["active"] or not ok:
        raise HTTPException(401, "Wrong email or password")
    token = jwt.encode({"sub": str(user["id"]), "role": user["role"],
                        "exp": datetime.now(timezone.utc) + timedelta(hours=config.JWT_EXPIRES_HOURS)},
                       config.JWT_SECRET, algorithm="HS256")
    return {"token": token, "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}}


class ChangePassword(BaseModel):
    current_password: str = ""
    new_password: str = ""


@router.post("/change-password")
def change_password(body: ChangePassword, me: dict = Depends(current_user)):
    """Any signed-in person can change their own password; the current one must be right."""
    key = f"pw:{me['id']}"
    now = time.time()
    _attempts[key] = [t for t in _attempts[key] if now - t < 900]
    if len(_attempts[key]) >= 10:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    _attempts[key].append(now)
    if len(body.new_password) < 8:
        raise HTTPException(400, "The new password must be at least 8 characters")
    if body.new_password == body.current_password:
        raise HTTPException(400, "The new password must be different from the current one")
    with conn() as c:
        row = q1(c, "SELECT password_hash FROM users WHERE id = %s", (me["id"],))
        if not row or not bcrypt.checkpw(body.current_password.encode(), row["password_hash"].encode()):
            raise HTTPException(400, "The current password is not correct")
        x(c, "UPDATE users SET password_hash = %s WHERE id = %s",
          (bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt(10)).decode(), me["id"]))
    return {"ok": True}
