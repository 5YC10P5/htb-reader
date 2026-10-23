@echo off
rem Stops the HTB Reader voice server from starting with Windows.
powershell -NoProfile -Command "$p = [Environment]::GetFolderPath('Startup') + '\HTB Reader voice server.lnk'; if (Test-Path $p) { Remove-Item $p; 'Auto-start turned off.' } else { 'Auto-start was not turned on.' }"
pause
