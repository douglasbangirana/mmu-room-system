import os
import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal

os.environ.setdefault("JWT_SECRET", "x" * 40)

from app.util import combine, from_epoch, prep, time_to_sec, to_epoch  # noqa: E402


class Encoding(unittest.TestCase):
    def test_mysql_types_become_json_safe(self):
        out = prep({"rows": [{"t": timedelta(hours=9), "d": date(2026, 10, 28),
                              "dt": datetime(2026, 10, 28, 14, 2), "n": Decimal("3"), "f": Decimal("2.5")}]})
        self.assertEqual(out["rows"][0], {"t": "09:00:00", "d": "2026-10-28",
                                          "dt": "2026-10-28T14:02:00+03:00", "n": 3, "f": 2.5})

    def test_time_helpers(self):
        self.assertEqual(time_to_sec(timedelta(hours=9, minutes=30)), 34200)
        self.assertEqual(time_to_sec("09:30:15"), 34215)
        self.assertEqual(combine(date(2026, 10, 28), timedelta(hours=14)), datetime(2026, 10, 28, 14, 0))
        self.assertEqual(to_epoch(from_epoch(1_800_000_000)), 1_800_000_000)


if __name__ == "__main__":
    unittest.main()
