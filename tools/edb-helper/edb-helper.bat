@echo off
rem Large Pami - edible print helper. Starts edb-helper.ps1 hidden (one copy only - the script itself exits if already running).
rem ExecutionPolicy Bypass applies to this one run only; nothing is changed in Windows settings.
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0edb-helper.ps1"
