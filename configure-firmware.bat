@echo off
cd /d "%~dp0"
if exist "backend\.venv\Scripts\python.exe" ( "backend\.venv\Scripts\python.exe" tools\configure_firmware.py ) else ( python tools\configure_firmware.py )
echo.
pause
