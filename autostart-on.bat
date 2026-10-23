@echo off
rem Starts the HTB Reader voice server (minimized) every time you log into Windows.
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\HTB Reader voice server.lnk'); $s.TargetPath = '%~dp0start.bat'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Description = 'HTB Reader voice server'; $s.Save()"
echo The voice server will now start automatically (minimized) when you log into Windows.
echo Run autostart-off.bat to undo this.
pause
