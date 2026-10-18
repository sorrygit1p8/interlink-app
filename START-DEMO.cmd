@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1" %*
set "interlinkExitCode=%ERRORLEVEL%"
if not "%interlinkExitCode%"=="0" pause
exit /b %interlinkExitCode%
