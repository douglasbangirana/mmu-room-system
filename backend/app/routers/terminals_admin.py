from fastapi import Depends, Request

from ..apirouter import ApiRouter
from ..config import TZ_NAME
from ..db import conn, q, q1
from ..security import require_hod
from ..services.netinfo import lan_ips
from ..services.settings import get_settings
from ..services.terminals import LIST_SQL, shape_rows
from ..util import local_date, now_local
from ..version import VERSION

router = ApiRouter(prefix="/api", dependencies=[Depends(require_hod)])


@router.get("/terminals")
def terminals():
    """Live health of every room terminal: connection, Wi-Fi signal, taps waiting to upload, last tap."""
    now = now_local()
    with conn() as c:
        timeout = get_settings(c)["heartbeat_timeout_seconds"]
        rows = q(c, LIST_SQL, (local_date(now),))
    return {"server_time": now, "heartbeat_timeout_seconds": timeout, "terminals": shape_rows(rows, now, timeout)}


@router.get("/system")
def system(request: Request):
    """What a terminal needs to know to reach this server, plus basic health."""
    port = request.url.port or 3000
    ips = lan_ips()
    try:
        with conn() as c:
            db_ok = bool(q1(c, "SELECT 1 AS ok"))
    except Exception:
        db_ok = False
    return {"version": VERSION, "port": port, "timezone": TZ_NAME, "server_time": now_local(), "database": "ok" if db_ok else "error",
            "api_bases": [f"http://{ip}:{port}/api" for ip in ips], "recommended": f"http://{ips[0]}:{port}/api" if ips else None}
