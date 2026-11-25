"""Pure input validators (no dependencies)."""
import re
from datetime import date

_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$")
_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def norm_time(t):
    m = _TIME.match(str(t if t is not None else "").strip())
    if not m:
        return None
    return f"{m.group(1).zfill(2)}:{m.group(2)}:{m.group(3) or '00'}"


def valid_date(s) -> bool:
    m = _DATE.match(str(s if s is not None else "").strip())
    if not m:
        return False
    try:
        date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return True
    except ValueError:
        return False
