@echo off
title TwoD Hub - Backend API
cd /d "%~dp0"
echo.
echo ========================================================
echo   TwoD Hub - Backend REST API (Python 3.11)
echo ========================================================
echo.
set "PATH=%LOCALAPPDATA%\Programs\Python311;%PATH%"
python backend\server.py
pause
