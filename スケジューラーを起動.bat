@echo off
cd /d "%~dp0"

set "PY_CMD="
where python >nul 2>nul
if not errorlevel 1 set "PY_CMD=python"

if not defined PY_CMD (
  where py >nul 2>nul
  if not errorlevel 1 set "PY_CMD=py -3"
)

if not defined PY_CMD (
  echo Python was not found.
  pause
  exit /b 1
)

rem Closing the scheduler-server window stops the app.
start "scheduler-server" /min %PY_CMD% -m http.server 8765 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/"
