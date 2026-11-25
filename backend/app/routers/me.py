from typing import Optional

from fastapi import Depends, HTTPException, Query

from ..apirouter import ApiRouter
from ..db import conn, q
from ..security import current_user
from ..services.validators import valid_date
from ..services.weeks import week_range
from ..util import now_local

router = ApiRouter(prefix="/api/me")


@router.get("/lectures")
def my_lectures(frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None, user: dict = Depends(current_user)):
    """The signed-in person's own timetable slots. Defaults to this week (Monday to Sunday).
    Lecturers can only ever see their own slots: the user id comes from the login token, never from the request."""
    if frm is None and to is None:
        frm, to = week_range(now_local().date())
    if not (frm and to and valid_date(frm) and valid_date(to)) or frm > to:
        raise HTTPException(400, "Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from on or before to")
    with conn() as c:
        return q(c, """SELECT t.id, t.slot_date, t.start_time, t.end_time, t.course_label, t.verification_status,
                              r.code AS room_code, r.name AS room_name
                         FROM timetable_slots t JOIN rooms r ON r.id = t.room_id
                        WHERE t.user_id = %s AND t.slot_date BETWEEN %s AND %s
                        ORDER BY t.slot_date, t.start_time""", (user["id"], frm, to))
