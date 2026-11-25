# One-click start: installs what is missing (first run only), prepares the database, starts the system.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
function Fail($msg) { Write-Host "`n$msg" -ForegroundColor Red; Read-Host "`nPress Enter to close"; exit 1 }

Write-Host "`nMMU Room Verification System" -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Fail "Python was not found. Install it from python.org and tick 'Add python.exe to PATH', then run START.bat again."
}
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Fail "Port 3000 is already in use. Close any other server window (including an old Node server) and run START.bat again."
}

Set-Location "$PSScriptRoot\backend"
$py = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "First run: installing the backend packages (needs internet, 1-3 minutes)..." -ForegroundColor Yellow
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the Python environment." }
    & $py -m pip install --upgrade pip --quiet
    & $py -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue
        Fail "Package install failed. Check your internet connection and run START.bat again."
    }
}

if (-not (Test-Path ".env")) {
    Write-Host "First run: creating backend\.env with a new secret..." -ForegroundColor Yellow
    $secret = & $py -c "import secrets;print(secrets.token_hex(32))"
    (Get-Content ".env.example") -replace '^JWT_SECRET=.*', "JWT_SECRET=$secret" | Set-Content -Encoding ascii ".env"
}

Write-Host "Preparing the database..." -ForegroundColor Cyan
& $py scripts\init_db.py
if ($LASTEXITCODE -ne 0) { Fail "The database step failed (message above). Make sure MySQL is running in WAMP/XAMPP." }

Write-Host "Starting the server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle='MMU server (close to stop)'; Set-Location '$PSScriptRoot\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 3000"
Start-Sleep -Seconds 4
Start-Process "http://localhost:3000"
Write-Host "`nOpen http://localhost:3000   (log in with hod@mmu.ac.ug / ChangeMe123!)" -ForegroundColor Green
Write-Host "Keep the server window open while you use the system. Close it to stop."
Start-Sleep -Seconds 6
