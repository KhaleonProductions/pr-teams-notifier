@echo off
REM setup.bat -- Runs the setup script in Git Bash
REM Double-click this file or run it from Command Prompt

echo Starting PR Teams Notifier setup...
echo.

REM Try common Git Bash locations
if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%~dp0setup.sh"
) else if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    "C:\Program Files (x86)\Git\bin\bash.exe" "%~dp0setup.sh"
) else (
    echo ERROR: Git Bash not found. Please install Git from https://git-scm.com
    echo Then run this script again.
)

echo.
pause
