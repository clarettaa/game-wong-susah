@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python tidak ditemukan di PATH.
    echo Install Python, lalu jalankan kembali file ini.
    pause
    exit /b 1
)

echo ========================================
echo  Robot Mapper - Local Server
echo ========================================
echo  Folder : %CD%
echo  URL    : http://localhost:%PORT%
echo  Stop   : tekan Ctrl+C
echo ========================================
echo.

start "" "http://localhost:%PORT%"
python -m http.server %PORT% --bind 127.0.0.1
