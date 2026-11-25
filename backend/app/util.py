"""Time helpers and JSON encoding. All datetimes inside the app are naive campus-local time."""
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi.responses import JSONResponse

from .config import TZ_NAME

TZ = ZoneInfo(TZ_NAME)


def now_local() -> datetime:
    return datetime.now(TZ).replace(tzinfo=None)


def from_epoch(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, TZ).replace(tzinfo=None)


def to_epoch(dt: datetime) -> int:
    return int(dt.replace(tzinfo=TZ).timestamp())


def tz_offset_sec() -> int:
    return int(datetime.now(TZ).utcoffset().total_seconds())


def tz_offset_str() -> str:
    s = tz_offset_sec()
    sign = "+" if s >= 0 else "-"
    s = abs(s)
    return f"{sign}{s // 3600:02d}:{(s % 3600) // 60:02d}"


def local_date(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def local_time(d: datetime) -> str:
    return d.strftime("%H:%M:%S")


def seconds_of_day(d: datetime) -> int:
    return d.hour * 3600 + d.minute * 60 + d.second


def time_to_sec(t) -> int:
    """'HH:MM[:SS]' string, MySQL TIME (timedelta) or datetime.time -> seconds since midnight."""
    if isinstance(t, timedelta):
        return int(t.total_seconds())
    if isinstance(t, time):
        return t.hour * 3600 + t.minute * 60 + t.second
    parts = [int(p) for p in str(t).split(":")]
    parts += [0] * (3 - len(parts))
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def combine(date_val, time_val) -> datetime:
    """A DATE (date or 'YYYY-MM-DD') plus a TIME -> local datetime."""
    if isinstance(date_val, str):
        y, m, d = (int(x) for x in date_val.split("-"))
    else:
        y, m, d = date_val.year, date_val.month, date_val.day
    return datetime(y, m, d) + timedelta(seconds=time_to_sec(time_val))


def _default(o):
    if isinstance(o, datetime):
        return o.replace(tzinfo=TZ).isoformat()      # includes +03:00 so browsers read it correctly
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, timedelta):                     # MySQL TIME columns
        s = int(o.total_seconds())
        return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", "replace")
    raise TypeError(f"Cannot serialise {type(o)}")


class ApiResponse(JSONResponse):
    """Default response class: knows how to encode dates, TIMEs and Decimals from MySQL."""
    def render(self, content) -> bytes:
        return json.dumps(content, default=_default, ensure_ascii=False, allow_nan=False).encode("utf-8")


def prep(o):
    """Recursively convert MySQL types (datetime, date, TIME, Decimal) into JSON-safe values.
    FastAPI's own encoder would turn a TIME into a number of seconds, so we convert first."""
    if isinstance(o, dict):
        return {k: prep(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [prep(v) for v in o]
    if isinstance(o, (datetime, date, timedelta, Decimal, bytes)):
        return _default(o)
    return o
