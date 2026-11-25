import re

import bcrypt
from fastapi import Body, Depends, HTTPException
from pymysql.err import DataError, IntegrityError

from ..apirouter import ApiRouter
from ..db import conn, q, tx, x
from ..security import require_hod
from ..services.settings import bump_version

cards = ApiRouter(prefix="/api/cards", dependencies=[Depends(require_hod)])
users = ApiRouter(prefix="/api/users")


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(10)).decode()


# ---------- Cards (FR9) ----------
@cards.get("")
def list_cards():
    with conn() as c:
        return q(c, """SELECT c.id, c.card_uid, c.status, c.issued_at, u.id AS user_id, u.name AS holder, u.email
                         FROM rfid_cards c JOIN users u ON u.id = c.user_id ORDER BY c.issued_at DESC""")


@cards.get("/recent-unknown")
def recent_unknown():
    """Unknown cards tapped recently: register a card by tapping it at any terminal."""
    with conn() as c:
        return q(c, """SELECT card_uid, MAX(event_time) AS last_seen FROM event_logs
                        WHERE event_type = 'CARD_REJECTED' AND user_id IS NULL AND card_uid IS NOT NULL
                          AND card_uid NOT IN (SELECT card_uid FROM rfid_cards)
                        GROUP BY card_uid ORDER BY last_seen DESC LIMIT 10""")


@cards.post("", status_code=201)
def register_card(body: dict = Body(default={})):
    uid = str(body.get("card_uid") or "").strip().upper()
    if not re.fullmatch(r"[0-9A-F]{8,20}", uid):
        raise HTTPException(400, "Card UID must be 8-20 hex characters")
    try:
        with tx() as c:
            x(c, "INSERT INTO rfid_cards (card_uid, user_id) VALUES (%s, %s)", (uid, body.get("user_id")))
            bump_version(c)
    except DataError:
        raise HTTPException(400, "Choose a valid lecturer")
    except IntegrityError as e:
        if e.args and e.args[0] == 1062:
            raise HTTPException(409, "That card is already registered")
        raise HTTPException(400, "Choose a valid lecturer")
    return {"ok": True}


@cards.patch("/{card_id}")
def update_card(card_id: int, body: dict = Body(default={})):
    """{ status?: ACTIVE|DEACTIVATED, user_id? }: deactivate, reactivate, reassign."""
    sets, vals = [], []
    if body.get("status"):
        if body["status"] not in ("ACTIVE", "DEACTIVATED"):
            raise HTTPException(400, "Invalid status")
        sets.append("status = %s"); vals.append(body["status"])
    if body.get("user_id"):
        sets.append("user_id = %s"); vals.append(body["user_id"])
    if not sets:
        raise HTTPException(400, "Nothing to update")
    with tx() as c:
        x(c, f"UPDATE rfid_cards SET {', '.join(sets)} WHERE id = %s", (*vals, card_id))
        bump_version(c)
    return {"ok": True}


# ---------- Accounts ----------
@users.get("")
def list_users(_: dict = Depends(require_hod)):
    with conn() as c:
        return q(c, "SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name")


@users.post("", status_code=201)
def create_user(body: dict = Body(default={}), _: dict = Depends(require_hod)):
    name, email, pw = str(body.get("name") or "").strip(), str(body.get("email") or "").strip().lower(), str(body.get("password") or "")
    role = body.get("role") or "LECTURER"
    if not name or not email or not pw:
        raise HTTPException(400, "Name, email and password are required")
    if len(pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if role not in ("HOD", "LECTURER"):
        raise HTTPException(400, "Invalid role")
    try:
        with conn() as c:
            _n, new_id = x(c, "INSERT INTO users (name, email, password_hash, role) VALUES (%s,%s,%s,%s)", (name, email, _hash(pw), role))
    except IntegrityError:
        raise HTTPException(409, "That email is already in use")
    return {"id": new_id}


@users.patch("/{user_id}")
def update_user(user_id: int, body: dict = Body(default={}), me: dict = Depends(require_hod)):
    sets, vals = [], []
    if "name" in body: sets.append("name = %s"); vals.append(str(body["name"]))
    if "active" in body:
        if not body["active"] and user_id == me["id"]:
            raise HTTPException(400, "You cannot deactivate your own account")
        sets.append("active = %s"); vals.append(int(bool(body["active"])))
    if "password" in body:
        if len(str(body["password"])) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        sets.append("password_hash = %s"); vals.append(_hash(str(body["password"])))
    if not sets:
        raise HTTPException(400, "Nothing to update")
    with tx() as c:
        x(c, f"UPDATE users SET {', '.join(sets)} WHERE id = %s", (*vals, user_id))
        bump_version(c)
    return {"ok": True}
