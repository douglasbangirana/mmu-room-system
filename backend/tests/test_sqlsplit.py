import unittest
from pathlib import Path

from app.services.sqlsplit import split_sql

SCHEMA = Path(__file__).resolve().parent.parent.parent / "database" / "schema.sql"


class SplitSql(unittest.TestCase):
    def test_schema_splits_into_15_statements(self):
        st = split_sql(SCHEMA.read_text(encoding="utf-8"))
        self.assertEqual(len(st), 15)
        self.assertTrue(st[0].startswith("CREATE DATABASE"))
        self.assertTrue(st[1].startswith("USE "))
        self.assertTrue(all(not s.endswith((";", "$$")) for s in st))

    def test_triggers_stay_whole(self):
        st = split_sql(SCHEMA.read_text(encoding="utf-8"))
        trig = [s for s in st if s.startswith("CREATE TRIGGER")]
        self.assertEqual(len(trig), 2)
        for t in trig:
            self.assertIn("SIGNAL SQLSTATE", t)
            self.assertTrue(t.rstrip().endswith("END"))

    def test_trailing_comment_after_semicolon(self):
        st = split_sql("INSERT INTO t VALUES (1);   -- note; with semicolon\nSELECT 2;")
        self.assertEqual(st, ["INSERT INTO t VALUES (1)", "SELECT 2"])


if __name__ == "__main__":
    unittest.main()
