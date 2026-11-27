@echo off
rem Large Pami - stops the edible print helper (only the PowerShell running edb-helper.ps1).
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*edb-helper.ps1*' -and $_.CommandLine -notlike '*-Setup*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Stopped.
timeout /t 2 /nobreak >nul
