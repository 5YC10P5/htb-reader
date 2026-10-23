@echo off
rem Stops the HTB Reader voice server, e.g. one started automatically with Windows.
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 5123 -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force; 'HTB Reader voice server stopped.' } else { 'The voice server was not running.' }"
pause
