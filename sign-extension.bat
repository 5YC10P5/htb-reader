@echo off
rem Gets the extension signed by Mozilla (free, private/unlisted) so it installs
rem permanently in normal Firefox. Get your API keys at:
rem https://addons.mozilla.org/developers/addon/api/key/
title Sign HTB Reader
cd /d "%~dp0"
if "%AMO_JWT_ISSUER%"=="" set /p AMO_JWT_ISSUER=Paste your "JWT issuer" key:
if "%AMO_JWT_SECRET%"=="" set /p AMO_JWT_SECRET=Paste your "JWT secret":
call npx web-ext sign --source-dir extension --artifacts-dir dist --channel unlisted --api-key "%AMO_JWT_ISSUER%" --api-secret "%AMO_JWT_SECRET%"
echo.
echo If it worked, your signed extension (.xpi file) is in the "dist" folder.
echo Drag it onto a Firefox window to install it.
pause
