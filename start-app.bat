@echo off
setlocal
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\cleanup-logs.ps1" -Days 30
cd /d "%~dp0backend"
node server.js >> "%~dp0logs\backend.out.log" 2>> "%~dp0logs\backend.err.log"
