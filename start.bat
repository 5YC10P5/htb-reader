@echo off
title HTB Reader voice server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it free from https://nodejs.org ^(LTS version^), then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing the voice engine. This takes a minute...
  call npm install --omit=dev
)
node server\server.mjs
echo.
echo The voice server has stopped.
pause
