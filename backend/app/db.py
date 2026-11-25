"""PyMySQL helpers. A short-lived connection per request keeps this simple and safe at campus scale."""
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

from .config import DB
from .util import tz_offset_str


def connect(autocommit=True):
    return pymysql.connect(
        **DB,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=autocommit,
        init_command=f"SET time_zone='{tz_offset_str()}'",   # so CURRENT_TIMESTAMP defaults are campus time
    )


@contextmanager
def conn():
    c = connect()
    try:
        yield c
    finally:
        c.close()


@contextmanager
def tx():
    """Transaction: commits on success, rolls back on any error."""
    c = connect(autocommit=False)
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def q(c, sql, args=None):
    with c.cursor() as cur:
        cur.execute(sql, args or ())
        return list(cur.fetchall())


def q1(c, sql, args=None):
    rows = q(c, sql, args)
    return rows[0] if rows else None


def x(c, sql, args=None):
    """Run a write. Returns (affected_rows, last_insert_id)."""
    with c.cursor() as cur:
        n = cur.execute(sql, args or ())
        return n, cur.lastrowid
