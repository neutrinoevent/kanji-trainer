@echo off
title Kanji Trainer updater
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 update.py
    goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
    python update.py
    goto :end
)
echo.
echo   Python 3 was not found.
echo   Install it from https://www.python.org/downloads/  (check "Add to PATH"),
echo   then double-click update.bat again.
echo.
:end
pause
