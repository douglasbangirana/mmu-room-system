@echo off
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" ( echo Run START.bat first. & pause & exit /b 1 )
set PY=.venv\Scripts\python.exe
echo.
echo === 1. Heartbeat: LH-101 comes online (blue = Available on the dashboard) ===
%PY% scripts\simulate_terminal.py heartbeat
echo.
echo === 2. Tap the demo card: expect AUTHORIZED (green on the dashboard) ===
%PY% scripts\simulate_terminal.py swipe 04A1B2C3
echo.
echo === 3. Tap it again: expect SIGNED_OUT (back to blue) ===
%PY% scripts\simulate_terminal.py swipe 04A1B2C3
echo.
echo === 4. Unknown card: expect REJECTED (it appears under Cards and accounts) ===
%PY% scripts\simulate_terminal.py swipe DEADBEEF
echo.
pause
