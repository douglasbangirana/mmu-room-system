"""Pretend to be a room terminal so you can test the server without hardware.

    (no setup needed: it uses the starter room LH-101 and its key from seed/seed_data.json)
    python scripts/simulate_terminal.py heartbeat
    python scripts/simulate_terminal.py swipe 04A1B2C3
    python scripts/simulate_terminal.py swipe-queued 04A1B2C3 120    (an event saved 120 s ago)
    python scripts/simulate_terminal.py sync
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.getenv("API", "http://localhost:3000/api")
def _default_key(room):
    try:
        seed = json.loads((__import__("pathlib").Path(__file__).resolve().parent.parent / "seed" / "seed_data.json").read_text(encoding="utf-8"))
        return next(r["device_key"] for r in seed["rooms"] if r["code"] == room)
    except Exception:
        return ""


ROOM = os.getenv("ROOM", "LH-101")
HEAD = {"Content-Type": "application/json", "X-Room-Code": ROOM, "X-Device-Key": os.getenv("KEY") or _default_key(ROOM)}


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, headers=HEAD,
                                 data=json.dumps(body).encode() if body is not None else None)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            status, text = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode()
    except urllib.error.URLError:
        sys.exit(f"Cannot reach the server at {BASE}. Is START.bat running?")
    print(f"{method} {path} -> {status} in {round((time.perf_counter() - t0) * 1000)} ms")
    print(json.dumps(json.loads(text), indent=2))


cmd, *rest = sys.argv[1:] or ["help"]
if cmd == "heartbeat": call("POST", "/heartbeat", {"queue": 0, "rssi": -58, "uptime": int(time.time()) % 86400, "fw": "simulator"})
elif cmd == "sync": call("GET", "/timetable/sync")
elif cmd == "swipe" and rest: call("POST", "/swipe", {"card_uid": rest[0]})
elif cmd == "swipe-queued" and rest:
    ago = int(rest[1]) if len(rest) > 1 else 60
    call("POST", "/swipe", {"card_uid": rest[0], "queued": True, "timestamp": int(time.time()) - ago})
else: print("Commands: heartbeat | sync | swipe <UID> | swipe-queued <UID> [secondsAgo]")
