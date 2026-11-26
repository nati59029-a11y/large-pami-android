@echo off
rem Large Pami - edible print helper: opens the printer Preferences dialog once and saves the chosen settings (devmode.bin).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0edb-helper.ps1" -Setup
