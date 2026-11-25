import unittest
from datetime import date

from app.services.weeks import week_range


class Weeks(unittest.TestCase):
    def test_midweek(self):
        self.assertEqual(week_range(date(2026, 11, 5)), ("2026-11-02", "2026-11-08"))   # Thursday

    def test_monday_and_sunday_are_in_their_own_week(self):
        self.assertEqual(week_range(date(2026, 11, 2)), ("2026-11-02", "2026-11-08"))
        self.assertEqual(week_range(date(2026, 11, 8)), ("2026-11-02", "2026-11-08"))

    def test_month_boundary(self):
        self.assertEqual(week_range(date(2026, 12, 31)), ("2026-12-28", "2027-01-03"))


if __name__ == "__main__":
    unittest.main()
