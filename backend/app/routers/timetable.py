import csv
import io
from typing import Optional

from fastapi import Body, Depends, HTTPException, Query
from fastapi.responses import Response
from pymysql.err import IntegrityError

from ..apirouter import ApiRouter
from ..db import conn, q, tx, x
from ..security import require_hod
from ..services.audit import log_event
from ..services.settings import bump_version
from ..services.timetable import parse_csv, validate_rows
from ..services.validators import valid_date
from ..util import local_date, now_local, time_to_sec

router = ApiRouter(prefix="/api/timetable", dependencies=[Depends(require_hod)])


def _row(body: dict) -> dict:
    return {k: body.get(k) for k in ("lecturer_email", "room_code", "date", "start", "end", "course")}


@router.get("")
def list_slots(date: Optional[str] = None):
    with conn() as c:
        return q(c, """SELECT t.id, t.slot_date, t.start_time, t.end_time, t.course_label, t.verification_status,
                              u.name AS lecturer, u.email AS lecturer_email, r.code AS room_code
                         FROM timetable_slots t JOIN users u ON u.id = t.user_id JOIN rooms r ON r.id = t.room_id
                        WHERE t.slot_date = %s ORDER BY r.code, t.start_time""", (date or local_date(now_local()),))


def _hhmm(t):
    s = time_to_sec(t)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}"


@router.get("/export")
def export_slots(frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None):
    """CSV of the slots between two dates. The first six columns match the import template, so it can be re-imported."""
    frm = frm or local_date(now_local())
    to = to or frm
    if not (valid_date(frm) and valid_date(to)) or frm > to:
        raise HTTPException(400, "Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from on or before to")
    with conn() as c:
        rows = q(c, """SELECT u.email, r.code, t.slot_date, t.start_time, t.end_time, t.course_label, t.verification_status
                         FROM timetable_slots t JOIN users u ON u.id = t.user_id JOIN rooms r ON r.id = t.room_id
                        WHERE t.slot_date BETWEEN %s AND %s ORDER BY t.slot_date, r.code, t.start_time""", (frm, to))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["lecturer_email", "room_code", "date", "start", "end", "course", "status"])
    for r in rows:
        w.writerow([r["email"], r["code"], str(r["slot_date"]), _hhmm(r["start_time"]), _hhmm(r["end_time"]), r["course_label"] or "", r["verification_status"]])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="timetable-{frm}_{to}.csv"'})


@router.post("/upload")
def upload(body: dict = Body(default={}), dryRun: Optional[str] = Query(None), user: dict = Depends(require_hod)):
    """body: { csv: "..." }. dryRun=1 only previews (FR1, TC10)."""
    try:
        rows = parse_csv(str(body.get("csv") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    dry = dryRun == "1"
    with tx() as c:
        valid, invalid = validate_rows(c, rows)
        if not dry and valid:
            for v in valid:
                x(c, "INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label) VALUES (%s,%s,%s,%s,%s,%s)",
                  (v["user_id"], v["room_id"], v["slot_date"], v["start_time"], v["end_time"], v["course_label"]))
            bump_version(c)
            log_event(c, when=now_local(), user_id=user["id"], event_type="TIMETABLE_UPLOAD", result="INFO",
                      details=f"{len(valid)} slots added, {len(invalid)} rejected")
    return {"dryRun": dry, "created": 0 if dry else len(valid), "valid_count": len(valid), "invalid": invalid}


@router.post("", status_code=201)
def add_slot(body: dict = Body(default={})):
    with tx() as c:
        valid, invalid = validate_rows(c, [_row(body)], first_row_number=1)
        if invalid:
            raise HTTPException(400, "; ".join(invalid[0]["errors"]))
        v = valid[0]
        _n, new_id = x(c, "INSERT INTO timetable_slots (user_id, room_id, slot_date, start_time, end_time, course_label) VALUES (%s,%s,%s,%s,%s,%s)",
                       (v["user_id"], v["room_id"], v["slot_date"], v["start_time"], v["end_time"], v["course_label"]))
        bump_version(c)
    return {"id": new_id}


@router.put("/{slot_id}")
def edit_slot(slot_id: int, body: dict = Body(default={})):
    with tx() as c:
        valid, invalid = validate_rows(c, [_row(body)], exclude_id=slot_id, first_row_number=1)
        if invalid:
            raise HTTPException(400, "; ".join(invalid[0]["errors"]))
        v = valid[0]
        n, _ = x(c, """UPDATE timetable_slots SET user_id=%s, room_id=%s, slot_date=%s, start_time=%s, end_time=%s,
                              course_label=%s, verification_status='PENDING' WHERE id=%s""",
                 (v["user_id"], v["room_id"], v["slot_date"], v["start_time"], v["end_time"], v["course_label"], slot_id))
        if not n:
            raise HTTPException(404, "Slot not found")
        bump_version(c)
    return {"ok": True}


@router.delete("/{slot_id}")
def delete_slot(slot_id: int):
    try:
        with tx() as c:
            n, _ = x(c, "DELETE FROM timetable_slots WHERE id = %s", (slot_id,))
            if not n:
                raise HTTPException(404, "Slot not found")
            bump_version(c)
    except IntegrityError:
        raise HTTPException(409, "This slot already has a recorded session and cannot be deleted")
    return {"ok": True}
