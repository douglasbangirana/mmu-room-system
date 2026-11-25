"""Fills in the terminal settings (Wi-Fi, your PC's address, room and key) for you.

Run it with configure-firmware.bat. It edits firmware/src/config.h and the Arduino IDE copy together.
"""
import json
import re
import socket
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "firmware" / "src" / "config.h", ROOT / "firmware-arduino-ide" / "mmu_terminal" / "config.h"]
SEED = ROOT / "backend" / "seed" / "seed_data.json"


def my_ip():
    """The address other devices on your Wi-Fi use to reach this PC (no data is sent)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "192.168.1.10"


def c_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def set_define(text, name, value):
    pat = re.compile(r"^(#define\s+" + name + r"\s+).*$", re.M)
    if not pat.search(text):
        raise SystemExit(f"Could not find {name} in config.h")
    return pat.sub(lambda m: m.group(1) + value, text, count=1)


def ask(prompt, default=""):
    shown = f" [{default}]" if default else ""
    answer = input(f"{prompt}{shown}: ").strip()
    return answer or default


def main():
    rooms = {r["code"]: r["device_key"] for r in json.loads(SEED.read_text(encoding="utf-8"))["rooms"]}
    print("\nTERMINAL SETUP\n")
    print("Rooms with a starter key: " + ", ".join(rooms))
    room = ask("Which room is this terminal in? (type its code)", "LH-101")
    key_default = rooms.get(room, "")
    if not key_default:
        print(f"'{room}' has no starter key. Paste its key from the dashboard (Rooms setup > Rotate key).")
    key = ask("Device key (Enter keeps the starter key)" if key_default else "Device key", key_default)
    while not key:
        key = ask("Device key (required)")
    ssid = ask("Wi-Fi name (2.4 GHz network)")
    while not ssid:
        ssid = ask("Wi-Fi name is required")
    password = ask("Wi-Fi password")
    ip = ask("This PC's address on that Wi-Fi", my_ip())

    for f in FILES:
        example = f.with_name("config.example.h")
        if not f.exists() and example.exists():          # fresh clone: config.h is not stored in git
            f.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
        if not f.exists():
            continue
        t = f.read_text(encoding="utf-8")
        t = set_define(t, "WIFI_SSID", c_string(ssid))
        t = set_define(t, "WIFI_PASS", c_string(password))
        t = set_define(t, "API_BASE", c_string(f"http://{ip}:3000/api"))
        t = set_define(t, "ROOM_CODE", c_string(room))
        t = set_define(t, "DEVICE_KEY", c_string(key))
        f.write_text(t, encoding="utf-8")
        print("Updated", f.relative_to(ROOT))

    print(f"\nDone. The terminal will contact http://{ip}:3000/api as room {room}.")
    print("Next: upload the firmware. Then check that http://%s:3000/api/health opens on your phone." % ip)


if __name__ == "__main__":
    main()
