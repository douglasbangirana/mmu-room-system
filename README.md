# MMU Room Verification System

Checks lecture-room occupancy against the official timetable using RFID staff cards.
Everything on the software side is finished and set up. **Only the hardware connection is left.**

```
 Room terminal (ESP32)  --Wi-Fi, HTTP + JSON-->  Backend (Python, FastAPI)  <--  Dashboard (React)
 card reader, LCD, clock, LED, buzzer              MySQL, 30-second timer       Lecturer / H.O.D
```

The dashboard has a sidebar, a search bar (Ctrl+K), summary cards that filter the rooms table, a 7-day verification chart, an occupancy gauge, a terminal-health card and (for the H.O.D) a recent-activity feed. A light/dark switch is in the top bar.

Room states: **Occupied – Authorized**, **Occupied – Unauthorized**, **Available**
(plus a grey *Status unverified* when a terminal has gone silent, so a dead terminal never shows a false "Available").

---

## Cloning from GitHub
Secrets are not stored in the repository. On a fresh clone `START.bat` creates `backend\.env` for you, and `configure-firmware.bat` creates the terminal's `config.h`. The device keys and passwords in `backend/seed/seed_data.json` are starter values: change them before real use.

## 1. Start the system (the whole software setup)

1. Start **MySQL** (WAMP or XAMPP).
2. Double-click **`START.bat`**.

That's it. On the **first run only** it needs internet for 1–3 minutes to install the Python packages. It then creates the database, loads the starter data, starts the server and opens http://localhost:3000.

Windows may warn about an unknown script: click **More info → Run anyway**. Keep the server window open while you use the system; close it to stop.

| Login | Email | Password |
|---|---|---|
| H.O.D | `hod@mmu.ac.ug` | `ChangeMe123!` |
| Lecturers | `lecturer1@mmu.ac.ug` (and the others below) | `Lecturer123!` |

**Already loaded for you**
- Rooms `LH-101`, `LH-102`, `RB4`, `RA3-1`, `RB7-1`, each with a device key (see `backend/seed/seed_data.json`).
- The BSSE4 timetable for 2–6 November 2026, with its five lecturers (`douglas@mmu.ac.ug`, `kulzdouglas@gmail.com`, `douglasbangirana19@gmail.com`, `benard@mmu.ac.ug`, `bangiranadouglas@mmu.ac.ug`).
- A demo card `04A1B2C3` belonging to `lecturer1`, with an all-day slot in `LH-101` for the next 60 days, so a test tap always works.

Seeding runs once and never overwrites your changes. **Change the passwords and rotate the device keys** (Cards and accounts → Reset password; Rooms setup → Rotate key) before real use.

If your MySQL `root` account has a password, put it after `DB_PASSWORD=` in `backend\.env`.

### Try the whole chain without hardware
With the server running, double-click **`test-without-hardware.bat`**. It sends a heartbeat, a valid tap, a sign-out tap and an unknown card, exactly as the ESP32 will. Watch the Rooms tab change.

---

## 2. Hardware integration (what is left)

### Wire the parts
| Part | Part pin | ESP32 pin | Notes |
|---|---|---|---|
| Card reader (MFRC522) | SDA/SS | GPIO 5 | **3.3 V only, never 5 V** |
| | SCK / MOSI / MISO | GPIO 18 / 23 / 19 | |
| | RST | GPIO 27 | |
| LCD (I2C) | SDA / SCL | GPIO 21 / 22 | Power from **5 V (VIN)** |
| Clock (DS3231) | SDA / SCL | GPIO 21 / 22 | Same two wires as the LCD; 3.3 V |
| Buzzer (active) | + | GPIO 25 | Other leg to GND |
| RGB LED (common cathode) | R / G / B | GPIO 32 / 33 / 14 | One 220 Ω resistor on **each** colour; common leg to GND |

Join all grounds together. LCD address `0x27` (try `0x3F` if blank), clock `0x68`.

### Fill in the terminal settings
Double-click **`configure-firmware.bat`**. It asks for the room, your Wi-Fi name and password, and detects your PC's address, then updates `config.h` for both build methods. The starter key for each room is already known. (If you rotated a key in the dashboard, paste the new one when asked.)

Your PC and the ESP32 must be on the **same 2.4 GHz Wi-Fi**. Before uploading, open `http://YOUR-PC-ADDRESS:3000/api/health` on your phone; it should show `{"ok":true,...}`. If not, allow Python through Windows Firewall (port 3000).

### Upload the firmware (choose ONE)
- **Arduino IDE:** follow `firmware-arduino-ide/README.md` (ESP32 board package **2.0.17**, four libraries, open `mmu_terminal.ino`, Upload).
- **PlatformIO:** open the `firmware` folder in VS Code and click Upload.

Hold the **BOOT** button if it hangs on "Connecting…". Serial Monitor: 115200 baud.

### Register a real card
Tap it: the terminal shows **CARD NOT RECOGNISED**. In the dashboard open **Cards and accounts**, click that card number, choose the lecturer, save. Make sure the lecturer has a slot in that room today (Timetable tab), then tap again for **AUTHORIZED**.

### Watch the terminal connect (Terminals tab)
Open **Terminals** in the dashboard before you upload. It shows the address the ESP32 must use (copy it with one click), and each room's row changes from *Waiting for first heartbeat* to **Online** within about 30 seconds of the terminal powering on. After that you can see its Wi-Fi signal, uptime, firmware version, taps waiting to upload (taps saved during an outage), the last tap and the number of taps today. A *Silent* terminal has stopped reporting; a weak signal is flagged. The Dashboard also shows a banner until the first terminal has connected.

### Hardware troubleshooting
| Symptom | Fix |
|---|---|
| LCD blank | `LCD_ADDR 0x3F`; turn the contrast screw on the backpack |
| `RFID READER NOT FOUND` | Check the SPI wires and that it is on 3.3 V |
| `RTC NOT FOUND` | Check SDA/SCL and the coin cell |
| `KEY ERROR` | Room code or key does not match the dashboard; run `configure-firmware.bat` again |
| Stays OFFLINE | Wrong PC address, server not running, firewall, or Wi-Fi isolation (try a phone hotspot) |
| Time shows `--:--` | The clock sets itself on the first successful heartbeat |

---

## Everyday functions
- **Everyone:** click your name (top right) to see your account and change your own password.
- **Lecturers:** the dashboard lists their own lectures for the rest of the week and which rooms are free.
- **H.O.D:** Dashboard, Terminals, Timetable (add, edit, delete, CSV import with preview, CSV export), Cards and accounts, Logs and summary (filters, CSV export), Rooms setup (add, retire and reactivate rooms, rotate keys, change the rules). The search bar (Ctrl+K) finds rooms, lecturers, cards and slots and opens the right page.

## How it behaves
| Situation | Result |
|---|---|
| Scheduled lecturer taps from 15 min before the start until the end | Occupied – Authorized, green, one beep |
| Registered lecturer taps with no matching slot | Occupied – Unauthorized, amber, flagged |
| Same lecturer taps again | Signed out; room Available |
| Unknown or deactivated card | Rejected, red, logged |
| Nobody taps during a booked slot | Slot becomes UNVERIFIED (ghost-booking candidate) |
| Session left open after the slot ends | Auto-closed and flagged |
| Terminal silent for 90 s | Dashboard shows Status unverified |
| Wi-Fi or server down | Terminal checks its saved timetable, saves the tap, uploads later |

Grace period, silence timeout and auto-close delays are editable in the dashboard (Rooms setup → Rules).

## Folders
| Folder | Contents |
|---|---|
| `backend/` | FastAPI server, verification rules, scheduled jobs, first-run database script |
| `dashboard/` | React website. `dist/` is pre-built and served by the backend; no Node needed. To change the UI: `npm install`, edit `src`, `npm run build`. |
| `database/` | `schema.sql` |
| `firmware/`, `firmware-arduino-ide/` | The same terminal code for PlatformIO or Arduino IDE |
| `tools/` | The firmware settings helper |
| `alternatives/server-node/` | Same backend in Node.js, for reference only |

## Test status
- **Run and passing:** 25 unit tests (verification rules, status logic, terminal health, the weekly view, SQL splitting against the real schema, data encoding), a dry run of the first-run database seeding with a fake database, and every dashboard page in a real browser against a mock API (login, rooms board for each state, all five H.O.D tabs, CSV preview, read-only lecturer view).
- **Not run here:** the backend against a live MySQL, and the firmware on an ESP32 (it could not be compiled in the environment this was built in). If anything fails on first run, copy the message and ask; `test-without-hardware.bat` helps tell a server problem from a wiring problem.
