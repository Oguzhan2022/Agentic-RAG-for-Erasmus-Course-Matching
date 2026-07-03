@echo off
setlocal enabledelayedexpansion
title Erasmus Course Matching System - Setup and Run
color 0A

echo ====================================================
echo   Erasmus Course Matching System - Setup and Run
echo ====================================================
echo.

:: 1. Check for Docker
echo [1/6] Checking for Docker...
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/
    pause
    exit /b
)
echo Docker is installed.
echo.

:: 2. Check if Docker Desktop is running
echo [2/6] Checking if Docker daemon is running...
docker info >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Desktop is not running!
    echo Please start Docker Desktop and run this script again.
    pause
    exit /b
)
echo Docker daemon is running.
echo.

:: 3. Check for Python
echo [3/6] Checking for Python...
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10 or newer from: https://www.python.org/downloads/
    pause
    exit /b
)
echo Python is installed.
echo.

:: 4. Check for Node.js / NPM
echo [4/6] Checking for Node.js and NPM...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b
)
echo Node.js and NPM are installed.
echo.

:: 5. Install Dependencies (Python & Node)
echo [5/6] Setting up application dependencies...
cd /d "%~dp0"

:: Set up Python Virtual Environment
if not exist .venv (
    echo Creating Python virtual environment .venv ...
    python -m venv .venv
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create python virtual environment.
        pause
        exit /b
    )
)

echo Installing backend packages...
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b
)

:: Install Frontend packages
echo Installing frontend packages (npm install)...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install frontend dependencies.
    cd ..
    pause
    exit /b
)
cd ..
echo Dependencies installed.
echo.

:: 6. Setup Docker Database
echo [6/6] Setting up Docker containers and database...
docker-compose up -d

:: Get container ID/name dynamically
echo Waiting for database container...
:wait_db
for /f "tokens=*" %%i in ('docker-compose ps -q db') do set DB_CONTAINER=%%i
if "%DB_CONTAINER%"=="" (
    timeout /t 2 /nobreak >nul
    goto wait_db
)

:wait_db_ready
docker exec %DB_CONTAINER% pg_isready -U erasmus -d erasmus_match >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    timeout /t 2 /nobreak >nul
    goto wait_db_ready
)

echo Database container is ready.

:: Check for existing local backup
set "LATEST_BACKUP="

:: Find latest local backup
for /f "tokens=*" %%f in ('dir /b /od "%~dp0local_backup_*.sql" 2^>nul') do set "LATEST_BACKUP=%%f"

if not "%LATEST_BACKUP%"=="" (
    echo En son yerel yedek bulundu: %LATEST_BACKUP%
    echo.
    set /p USE_BACKUP="Bu yedekten geri yuklemek icin E, bos veritabani ile devam etmek icin H yazin (E/H): "
    if /i "!USE_BACKUP!"=="E" (
        echo Yerel yedek yukleniyor...
        echo Eski tablolar ve sema temizleniyor...
        docker exec -i %DB_CONTAINER% psql -U erasmus -d erasmus_match -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
        docker cp "%~dp0%LATEST_BACKUP%" %DB_CONTAINER%:/tmp/restore.sql
        docker exec -i %DB_CONTAINER% psql -U erasmus -d erasmus_match -f /tmp/restore.sql
        docker exec %DB_CONTAINER% rm /tmp/restore.sql >nul 2>nul
        echo Yedek yuklendi.
    ) else (
        echo Bos veritabani ile devam ediliyor. Tablolar backend ilk calistiginda olusturulacak.
    )
) else (
    echo Yerel yedek bulunamadi. Bos veritabani ile devam ediliyor. Tablolar backend ilk calistiginda olusturulacak.
)

echo.
echo ====================================================
echo   Setup Complete! Starting the application...
echo ====================================================
timeout /t 3 /nobreak >nul

:: Launch project using start.bat
call start.bat
