import unittest
from datetime import datetime, timedelta

from app.schema_upgrade import TERMINAL_STATUS
from app.services.netinfo import lan_ips
from app.services.terminals import LIST_SQL, UPSERT_SQL, clean_int, connection_state, heartbeat_params, shape_rows, signal_quality

NOW = datetime(2026, 11, 10, 10, 0, 0)


class Terminals(unittest.TestCase):
    def test_signal_labels(self):
        self.assertEqual([signal_quality(v) for v in (-45, -60, -65, -70, -75, -80, -81, None)],
                         ["excellent", "excellent", "good", "good", "fair", "fair", "weak", "unknown"])

    def test_connection_states(self):
        self.assertEqual(connection_state(None, NOW, 90), "WAITING")                       # never reported
        self.assertEqual(connection_state(NOW - timedelta(seconds=30), NOW, 90), "ONLINE")
        self.assertEqual(connection_state(NOW - timedelta(seconds=91), NOW, 90), "SILENT")

    def test_terminal_input_is_never_trusted(self):
        self.assertEqual(clean_int("-62", -127, 0), -62)
        self.assertIsNone(clean_int("abc", -127, 0))
        self.assertIsNone(clean_int(55, -127, 0))            # RSSI cannot be positive
        self.assertIsNone(clean_int(None, 0, 10))

    def test_heartbeat_params_match_the_sql(self):
        params = heartbeat_params(3, {"queue": 4, "rssi": -58, "uptime": 120, "fw": "1.1.0"}, "192.168.1.50", NOW)
        self.assertEqual(UPSERT_SQL.count("%s"), len(params))
        self.assertEqual(params, (3, 4, -58, 120, "1.1.0", "192.168.1.50", NOW))

    def test_heartbeat_with_garbage_body_still_works(self):
        params = heartbeat_params(3, {"queue": "x", "rssi": 999, "fw": "A" * 99}, None, NOW)
        self.assertEqual(params[1:4], (0, None, None))
        self.assertEqual(len(params[4]), 20)
        self.assertIsNone(params[5])

    def test_list_sql_has_one_placeholder(self):
        self.assertEqual(LIST_SQL.count("%s"), 1)

    def test_shape_rows(self):
        rows = [{"id": 1, "code": "LH-101", "name": "Hall", "last_heartbeat": NOW - timedelta(seconds=5), "queue_len": 2, "rssi": -55,
                 "uptime_s": 99, "fw": "1.1.0", "ip": "10.0.0.5", "last_tap": NOW, "taps_today": 3},
                {"id": 2, "code": "RB4", "name": "RB4", "last_heartbeat": None, "queue_len": None, "rssi": None,
                 "uptime_s": None, "fw": None, "ip": None, "last_tap": None, "taps_today": None}]
        a, b = shape_rows(rows, NOW, 90)
        self.assertEqual((a["state"], a["signal"], a["queue_len"], a["taps_today"]), ("ONLINE", "excellent", 2, 3))
        self.assertEqual((b["state"], b["signal"], b["queue_len"], b["taps_today"]), ("WAITING", "unknown", 0, 0))

    def test_table_definition_exists(self):
        self.assertIn("terminal_status", TERMINAL_STATUS)

    def test_lan_ips_never_raises(self):
        ips = lan_ips()
        self.assertIsInstance(ips, list)
        self.assertTrue(all(not ip.startswith("127.") for ip in ips))


if __name__ == "__main__":
    unittest.main()
