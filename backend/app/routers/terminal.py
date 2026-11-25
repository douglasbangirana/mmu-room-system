import time
from typing import Optional

from fastapi import Body, Depends, HTTPException, Request
from pydantic import BaseModel

from ..apirouter import ApiRouter
from ..db import conn, x
from ..security import require_device
from ..services.audit import log_event
from ..services.settings import get_settings
from ..services.swipe import process_swipe
from ..services.terminals import UPSERT_SQL, heartbeat_params
from ..services.timetable import build_terminal_cache
from ..util import from_epoch, local_date, now_local, to_epoch

router = ApiRouter(prefix="/api")


class Swipe(BaseModel):
    card_uid: str = ""
    queued: bool = False
    timestamp: Optional[float] = None


@router.post("/swipe")
def swipe(body: Swipe, room: dict = Depends(require_device)):
    """{ card_uid, queued?, timestamp? } -> verified result (FR3, FR4, FR5)."""
    uid = body.card_uid.upper()
    if not (8 <= len(uid) <= 20 and all(ch in "0123456789ABCDEF" for ch in uid)):
        raise HTTPException(400, "card_uid must be 8-20 hex characters")
    when = now_local()
    if body.queued:
        age = time.time() - (body.timestamp or 0)
        if body.timestamp is None or age < -300 or age > 7 * 86400:
            raise HTTPException(400, "Queued timestamp is missing or out of range")
        when = from_epoch(body.timestamp)
    else:
        with conn() as c:
            x(c, "UPDATE rooms SET last_heartbeat = %s WHERE id = %s", (when, room["id"]))
            if room["offline_logged"]:                      # a tap proves the terminal is back
                x(c, "UPDATE rooms SET offline_logged = 0 WHERE id = %s", (room["id"],))
                log_event(c, when=when, room_id=room["id"], event_type="TERMINAL_ONLINE", result="INFO")
    return process_swipe(room, uid, when, late=body.queued)


@router.post("/heartbeat")
def heartbeat(request: Request, body: dict = Body(default={}), room: dict = Depends(require_device)):
    """Terminal says it is alive and how healthy it is; the reply tells it whether to re-sync (FR2, FR13)."""
    now = now_local()
    with conn() as c:
        x(c, "UPDATE rooms SET last_heartbeat = %s WHERE id = %s", (now, room["id"]))
        if room["offline_logged"]:
            x(c, "UPDATE rooms SET offline_logged = 0 WHERE id = %s", (room["id"],))
            log_event(c, when=now, room_id=room["id"], event_type="TERMINAL_ONLINE", result="INFO")
        try:                                              # hardware health for the Terminals page (never blocks the heartbeat)
            x(c, UPSERT_SQL, heartbeat_params(room["id"], body, request.client.host if request.client else None, now))
        except Exception as e:
            print("[heartbeat] could not store terminal status:", e)
        cfg = get_settings(c)
    return {"server_time": to_epoch(now), "version": cfg["timetable_version"], "date": local_date(now)}


@router.get("/timetable/sync")
def timetable_sync(room: dict = Depends(require_device)):
    """Today's slots + active card UIDs for this room (the terminal's offline cache)."""
    with conn() as c:
        return build_terminal_cache(c, room, local_date(now_local()), get_settings(c))
