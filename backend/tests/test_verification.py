import unittest
from datetime import datetime, timedelta

from app.services.validators import norm_time, valid_date
from app.services.verification import compute_room_status, find_matching_slot

H = 3600
SLOTS = [{"id": 1, "start_sec": 9 * H, "end_sec": 11 * H}]


class Rules(unittest.TestCase):
    def test_tc1_inside_slot(self):
        self.assertEqual(find_matching_slot(SLOTS, 9 * H + 600, 900)["id"], 1)

    def test_early_arrival_within_grace(self):
        self.assertEqual(find_matching_slot(SLOTS, 9 * H - 600, 900)["id"], 1)

    def test_tc2_too_early_or_too_late(self):
        self.assertIsNone(find_matching_slot(SLOTS, 9 * H - 1200, 900))
        self.assertIsNone(find_matching_slot(SLOTS, 11 * H + 1, 900))

    def test_no_slots(self):
        self.assertIsNone(find_matching_slot([], 10 * H, 900))

    def test_back_to_back_prefers_in_progress(self):
        two = [{"id": 1, "start_sec": 9 * H, "end_sec": 10 * H}, {"id": 2, "start_sec": 10 * H, "end_sec": 11 * H}]
        self.assertEqual(find_matching_slot(two, 10 * H - 60, 900)["id"], 2)

    def test_tc7_silent_terminal_is_unverified(self):
        now = datetime(2026, 10, 28, 10, 0, 0)
        self.assertEqual(compute_room_status(now - timedelta(minutes=5), now, 90, None), "UNVERIFIED")
        self.assertEqual(compute_room_status(None, now, 90, None), "UNVERIFIED")

    def test_live_terminal_states(self):
        now = datetime(2026, 10, 28, 10, 0, 0)
        live = now - timedelta(seconds=10)
        self.assertEqual(compute_room_status(live, now, 90, None), "AVAILABLE")
        self.assertEqual(compute_room_status(live, now, 90, {"auth_status": "AUTHORIZED"}), "OCCUPIED_AUTHORIZED")
        self.assertEqual(compute_room_status(live, now, 90, {"auth_status": "UNAUTHORIZED"}), "OCCUPIED_UNAUTHORIZED")

    def test_tc10_validation(self):
        self.assertEqual(norm_time("9:05"), "09:05:00")
        self.assertIsNone(norm_time("25:00"))
        self.assertFalse(valid_date("2026-02-30"))
        self.assertTrue(valid_date("2026-10-28"))


if __name__ == "__main__":
    unittest.main()
