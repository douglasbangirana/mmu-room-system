# Backend (Python + FastAPI)

Started by `START.bat` in the project root. By hand, from this folder:

    .venv\Scripts\python.exe scripts\init_db.py          (creates tables and starter data, safe to repeat)
    .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 3000

`--host 0.0.0.0` lets the ESP32 reach the server. API docs: http://localhost:3000/docs

Unit tests: `.venv\Scripts\python.exe -m unittest discover -s tests -t .`

| Path | Purpose |
|---|---|
| `app/main.py` | App, error format, scheduler, serves `../dashboard/dist` |
| `app/routers/` | `auth` (login, change password), `me` (a lecturer's own week), `rooms`, `terminal` (swipe, heartbeat, sync), `terminals_admin` (live terminal health, system info), `timetable`, `people`, `reports` |
| `app/services/` | `verification` (rules), `swipe`, `timetable` (CSV import), `settings`, `audit`, `sqlsplit` |
| `app/jobs.py` | Every 30 s: mark ghost-booking candidates, auto-close forgotten sessions, log silent terminals |
| `scripts/` | `init_db.py`, `simulate_terminal.py`, `seed.py` (older, optional) |
| `seed/seed_data.json` | Starter accounts, rooms, device keys, timetable |
