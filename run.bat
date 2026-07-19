@echo off
title Kanji Trainer
cd /d "%~dp0"

rem Prefer the Windows Python launcher, fall back to python on PATH
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 server.py
    goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
    python server.py
    goto :end
)
echo.
echo   Python 3 was not found.
echo   Install it from https://www.python.org/downloads/  (check "Add to PATH"),
echo   then double-click run.bat again. No other installs are needed.
echo.
pause
:end
