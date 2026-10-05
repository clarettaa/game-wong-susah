@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python tidak ditemukan di PATH.
    pause
    exit /b 1
)

where npx >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js atau npx tidak ditemukan di PATH.
    echo Install Node.js, lalu jalankan kembali file ini.
    pause
    exit /b 1
)

echo ========================================
echo  Robot Mapper - Public Tunnel
echo ========================================
echo  Local URL : http://localhost:%PORT%
echo  Provider  : LocalTunnel
echo ========================================
echo.
echo Menjalankan server lokal di jendela baru...
start "Robot Mapper Local Server" /min /D "%~dp0" python -m http.server %PORT% --bind 127.0.0.1

timeout /t 2 /nobreak >nul
echo Membuat URL publik. Tunggu sampai muncul baris "your url is".
echo Tekan Ctrl+C untuk menghentikan tunnel.
echo.
npx --yes localtunnel --port %PORT%

echo.
echo Tunnel telah berhenti. Tutup jendela server lokal jika masih berjalan.
pause
