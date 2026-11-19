@echo off
rem Large Pami - Caspit extension: one-time setup of the automatic update (Windows Task Scheduler, current user).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0updater\install.ps1"
