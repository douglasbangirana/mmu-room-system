import csv
import io
import re
from typing import Optional

from fastapi import Body, Depends, HTTPException, Query
from fastapi.responses import Response

from ..apirouter import ApiRouter
from ..db import conn, q, q1, x
from ..security import require_hod
from ..services.settings import SETTING_KEYS, get_settings
from ..util import local_date, now_local

logs = ApiRouter(prefix="/api", dependencies=[Depends(require_hod)])
settings = ApiRouter(prefix="/api/settings", dependencies=[Depends(require_hod)])


def _range(frm, to):
    today = local_date(now_local())
    return frm or today, to or today


@logs.get("/logs")
def event_log(frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None, room_id: Optional[int] = None,
              type: Optional[str] = None, flagged: Optional[str] = None, limit: int = 200, format: Optional[str] = None):
    """FR10, FR11: filter the audit trail and export it as CSV."""
    frm, to = _range(frm, to)
    where, vals = ["DATE(e.event_time) BETWEEN %s AND %s"], [frm, to]
    if room_id: where.append("e.room_id = %s"); vals.append(room_id)
    if type: where.append("e.event_type = %s"); vals.append(type)
    if flagged == "1": where.append("e.flagged = 1")
    lim = 50000 if format == "csv" else max(1, min(limit, 1000))
    with conn() as c:
        rows = q(c, f"""SELECT e.id, e.event_time, r.code AS room, u.name AS lecturer, e.card_uid, e.event_type, e.result,
                               e.flagged, e.synced_late, e.details
                          FROM event_logs e LEFT JOIN rooms r ON r.id = e.room_id LEFT JOIN users u ON u.id = e.user_id
                         WHERE {' AND '.join(where)} ORDER BY e.event_time DESC, e.id DESC LIMIT {int(lim)}""", vals)
    if format == "csv":
        cols = ["id", "event_time", "room", "lecturer", "card_uid", "event_type", "result", "flagged", "synced_late", "details"]
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(cols)
        for r in rows:
            w.writerow(["" if r[k] is None else r[k] for k in cols])
        return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="event-log-{frm}_{to}.csv"'})
    return rows


@logs.get("/summary")
def summary(frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None):
    """Verified vs unverified slots, ghost-booking frequency and exposure."""
    frm, to = _range(frm, to)
    with conn() as c:
        per = q(c, """SELECT r.code AS room,
                             SUM(t.verification_status = 'VERIFIED')   AS verified,
                             SUM(t.verification_status = 'UNVERIFIED') AS unverified,
                             SUM(t.verification_status = 'PENDING')    AS pending,
                             COALESCE(SUM(CASE WHEN t.verification_status = 'UNVERIFIED'
                                          THEN TIME_TO_SEC(t.end_time) - TIME_TO_SEC(t.start_time) END), 0) / 60 AS exposure_minutes
                        FROM timetable_slots t JOIN rooms r ON r.id = t.room_id
                       WHERE t.slot_date BETWEEN %s AND %s GROUP BY r.id, r.code ORDER BY r.code""", (frm, to))
        sess = q1(c, """SELECT SUM(auth_status = 'UNAUTHORIZED') AS unauthorized, SUM(no_signout = 1) AS no_signout, COUNT(*) AS sessions
                          FROM room_sessions WHERE DATE(opened_at) BETWEEN %s AND %s""", (frm, to))
    rooms = [{"room": r["room"], "verified": int(r["verified"] or 0), "unverified": int(r["unverified"] or 0),
              "pending": int(r["pending"] or 0), "exposure_minutes": round(float(r["exposure_minutes"] or 0))} for r in per]
    verified, unverified = sum(r["verified"] for r in rooms), sum(r["unverified"] for r in rooms)
    finished = verified + unverified
    return {"from": frm, "to": to, "verified": verified, "unverified": unverified,
            "pending": sum(r["pending"] for r in rooms),
            "ghost_booking_pct": round(unverified / finished * 100, 1) if finished else None,
            "exposure_minutes": sum(r["exposure_minutes"] for r in rooms),
            "unauthorized_sessions": int(sess["unauthorized"] or 0), "sessions_without_signout": int(sess["no_signout"] or 0),
            "per_room": rooms}


# ---------- Settings: grace period etc. without redeploying (NFR7) ----------
@settings.get("")
def read_settings():
    with conn() as c:
        s = get_settings(c)
    s.pop("timetable_version", None)
    return s


@settings.put("")
def save_settings(body: dict = Body(default={})):
    with conn() as c:
        for k in SETTING_KEYS:
            if k not in body:
                continue
            v = str(body[k]).strip()
            if not re.fullmatch(r"\d{1,4}", v) or int(v) > 1440:
                raise HTTPException(400, f"{k} must be a whole number between 0 and 1440")
            x(c, "UPDATE settings SET value = %s WHERE name = %s", (str(int(v)), k))
    return {"ok": True}
