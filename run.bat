@echo off
title TWO-ZONE PETROL LEAKAGE MONITORING SYSTEM - ESP32 DASHBOARD
color 0B

echo ===============================================================================
echo   TWO-ZONE PETROL LEAKAGE DETECTION AND MONITORING SYSTEM USING ESP32
echo   College IoT Capstone Project Dashboard
echo ===============================================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in your PATH.
    echo Please install Python 3.10+ and make sure to check "Add Python to PATH".
    pause
    exit /b
)

:: Install required dependencies if needed
echo [*] Checking dependencies (Flask, pyserial)...
python -m pip install -r requirements.txt --quiet

:: Launch Flask backend server
echo [*] Starting Flask IoT Dashboard Server at http://127.0.0.1:5000 ...
echo [*] Press Ctrl+C in this terminal to stop the server.
echo.

:: Automatically open default browser after 2 seconds
start "" timeout /t 2 >nul & start http://127.0.0.1:5000

:: Run the Flask Application
python app.py

pause
