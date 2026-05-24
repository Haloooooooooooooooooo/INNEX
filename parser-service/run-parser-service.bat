@echo off
cd /d E:\my_vibecoding\INNEX\parser-service
if not exist .venv\Scripts\python.exe (
  echo [ERROR] venv python not found: .venv\Scripts\python.exe
  pause
  exit /b 1
)
set PORT=%1
if "%PORT%"=="" set PORT=8011
echo [INFO] starting parser-service on http://127.0.0.1:%PORT%
.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port %PORT%
