import secrets

from fastapi import Body, Depends, HTTPException
from pymysql.err import IntegrityError

from ..apirouter import ApiRouter
from ..db import conn, q, q1, x
from ..security import current_user, require_hod, sha256
from ..services.settings import get_settings
from ..services.verification import compute_room_status
from ..util import now_local

router = ApiRouter(prefix="/api/rooms")


@router.get("")
def list_rooms(user: dict = Depends(current_user)):
    """Live status, capacity, projector (FR6, FR8, FR13). Read-only for lecturers."""
    with conn() as c:
        cfg = get_settings(c)
        rows = q(c, """SELECT r.id, r.code, r.name, r.capacity, r.has_projector, r.last_heartbeat,
                              s.auth_status, s.opened_at, u.name AS occupant
                         FROM rooms r
                         LEFT JOIN room_sessions s ON s.room_id = r.id AND s.closed_at IS NULL
                         LEFT JOIN users u ON u.id = s.user_id
                        WHERE r.active = 1 ORDER BY r.code""")
    now = now_local()
    is_hod = user["role"] == "HOD"
    out = []
    for r in rows:
        item = {"id": r["id"], "code": r["code"], "name": r["name"], "capacity": r["capacity"],
                "has_projector": bool(r["has_projector"]),
                "status": compute_room_status(r["last_heartbeat"], now, cfg["heartbeat_timeout_seconds"],
                                              {"auth_status": r["auth_status"]} if r["auth_status"] else None),
                "last_heartbeat": r["last_heartbeat"]}
        if is_hod and r["auth_status"]:                 # who is inside is audit information: H.O.D only
            item.update(occupant=r["occupant"], since=r["opened_at"])
        out.append(item)
    return {"server_time": now, "rooms": out}


@router.get("/manage")
def manage_rooms(_: dict = Depends(require_hod)):
    with conn() as c:
        return q(c, "SELECT id, code, name, capacity, has_projector, active, last_heartbeat FROM rooms ORDER BY code")


@router.post("", status_code=201)
def create_room(body: dict = Body(default={}), _: dict = Depends(require_hod)):
    code, name = str(body.get("code") or "").strip(), str(body.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(400, "Room code and name are required")
    try:
        capacity = int(body.get("capacity") or 0)
    except (TypeError, ValueError):
        capacity = 0
    key = secrets.token_hex(24)
    try:
        with conn() as c:
            _n, new_id = x(c, "INSERT INTO rooms (code, name, capacity, has_projector, device_key_hash) VALUES (%s,%s,%s,%s,%s)",
                           (code, name, capacity, int(bool(body.get("has_projector"))), sha256(key)))
    except IntegrityError:
        raise HTTPException(409, "A room with that code already exists")
    return {"id": new_id, "code": code, "device_key": key}      # shown ONCE; only the hash is stored


@router.patch("/{room_id}")
def update_room(room_id: int, body: dict = Body(default={}), _: dict = Depends(require_hod)):
    sets, vals = [], []
    if "name" in body: sets.append("name = %s"); vals.append(str(body["name"]))
    if "capacity" in body:
        try: cap = int(body["capacity"] or 0)
        except (TypeError, ValueError): cap = 0
        sets.append("capacity = %s"); vals.append(cap)
    if "has_projector" in body: sets.append("has_projector = %s"); vals.append(int(bool(body["has_projector"])))
    if "active" in body: sets.append("active = %s"); vals.append(int(bool(body["active"])))
    if not sets:
        raise HTTPException(400, "Nothing to update")
    with conn() as c:
        x(c, f"UPDATE rooms SET {', '.join(sets)} WHERE id = %s", (*vals, room_id))
    return {"ok": True}


@router.post("/{room_id}/rotate-key")
def rotate_key(room_id: int, _: dict = Depends(require_hod)):
    key = secrets.token_hex(24)
    with conn() as c:
        x(c, "UPDATE rooms SET device_key_hash = %s WHERE id = %s", (sha256(key), room_id))
    return {"device_key": key}
