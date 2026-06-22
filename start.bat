@echo off
title Erasmus Course Matching System
color 0B

echo ============================================
echo   Erasmus Course Matching System
echo ============================================
echo.

:: Docker / Postgres
echo [1/3] Starting Database (PostgreSQL inside Docker)...
cd /d "%~dp0"
docker-compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not running or docker-compose failed.
    echo Please start Docker Desktop and try again.
    pause
    exit /b
)

:: Kill any existing process on port 8000
echo Stopping any existing backend on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Backend
echo [2/3] Starting Backend (FastAPI - port 8000)...
set PYTHON_CMD=python
if exist "%~dp0.venv\Scripts\python.exe" (
    set PYTHON_CMD="%~dp0.venv\Scripts\python.exe"
)
start "Backend - FastAPI" cmd /k "cd /d %~dp0 && %PYTHON_CMD% run_server.py"

:: Celery Worker (Conditional based on .env configuration)
findstr /i "USE_CELERY=true" .env >nul 2>&1
if errorlevel 1 goto :no_celery

echo Starting Celery Worker (Redis-backed Queue)...
start "Celery Worker" cmd /k "cd /d %~dp0 && %PYTHON_CMD% -m celery -A backend.celery_app worker --loglevel=info -P threads -c 1"
goto :celery_done

:no_celery
echo Celery is disabled (USE_CELERY is not 'true' in .env). Running in Thread Fallback mode.

:celery_done

:: Wait for backend to be ready
timeout /t 6 /nobreak >nul

:: Frontend — VITE_API_URL points to local backend
echo [3/3] Starting Frontend (Vite - port 3000)...
start "Frontend - Vite" cmd /k "cd /d %~dp0frontend && npm run dev"

:: Wait then open browser
timeout /t 4 /nobreak >nul
start http://localhost:3000

echo.
echo ============================================
echo   Database:  Postgres (Port 5432)
echo   Backend:   http://localhost:8000
echo   Frontend:  http://localhost:3000
echo   Production: https://ikuerasmus.onrender.com
echo ============================================
echo.
echo Systems are starting in separate windows.
echo Close this window anytime.
pause
