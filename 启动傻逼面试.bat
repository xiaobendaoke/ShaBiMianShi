@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-win.ps1" "%~dp0"
if errorlevel 1 pause
