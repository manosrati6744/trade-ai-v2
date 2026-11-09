@echo off
setlocal enabledelayedexpansion
title SMC SNIPER - Deploy as a NEW Vercel project
cd /d "%~dp0"

echo ============================================
echo   SMC SNIPER - Deploy as a NEW project
echo   No GitHub. No linking questions.
echo   It creates a brand new project itself.
echo ============================================
echo.

rem -- optional: if your VPN app gives a local proxy (v2ray / clash),
rem -- put its address in a file named proxy.txt next to this .bat
rem -- (one line, just host:port, example: 127.0.0.1:7890)
if exist proxy.txt (
    set /p PROXY=<proxy.txt
    echo !PROXY! | findstr /i "http://" >nul
    if errorlevel 1 set PROXY=http://!PROXY!
    set HTTPS_PROXY=!PROXY!
    set HTTP_PROXY=!PROXY!
    echo [i] Using local proxy from proxy.txt:  !PROXY!
    echo.
)

where node >nul 2>nul
if errorlevel 1 (
    echo [X] Node.js not found! Install it from https://nodejs.org then run again.
    pause
    exit /b 1
)

if not exist package.json (
    echo [X] package.json not found here!
    echo     This .bat file must sit INSIDE the extracted app folder,
    echo     next to package.json - the same folder as START-WINDOWS.bat.
    pause
    exit /b 1
)

for %%I in (.) do set FOLDER=%%~nI
echo [i] The new project name will be:  !FOLDER!
echo     (If you want another name: rename this FOLDER to English
echo      letters and dashes only, then run this file again.)
echo.

echo [1/3] Checking Vercel CLI ...
vercel --version >nul 2>nul
if not errorlevel 1 goto cliok
echo       First run: downloading Vercel CLI - needs internet / VPN.
echo.
call npm i -g vercel --no-audit --no-fund
if errorlevel 1 goto err1

:cliok
echo.
echo [2/3] Login to Vercel...
echo       Your browser will open. Log in with your account.
echo.
call vercel login
if errorlevel 1 goto err2

echo.
echo [3/3] Uploading and building as a NEW project ...
echo       This takes 2-4 minutes. Do not close this window!
echo.
call vercel --prod --yes
if errorlevel 1 goto err3

echo.
echo ============================================
echo   DONE! Your NEW site URL is printed above,
echo   like https://!FOLDER!.vercel.app
echo.
echo   The page footer must show v7.8
echo.
echo   If you need Telegram / AI keys: open the new
echo   project on vercel.com - Settings - Environment
echo   Variables, add the same values as the old
echo   project, then deploy again (run this file).
echo ============================================
pause
exit /b 0

:err1
echo.
echo [X] FAILED AT STEP 1 of 3 (downloading Vercel CLI).
echo     Cause: no internet, or npm is blocked for your region.
echo     FIX: turn your VPN ON (whole system / TUN mode), or use
echo     proxy.txt (one line, like 127.0.0.1:7890), and run again.
pause
exit /b 1

:err2
echo.
echo [X] FAILED AT STEP 2 of 3 (login).
echo     Cause: this black window itself must reach vercel.com -
echo     a browser-only VPN is not enough.
echo     FIX: VPN with System Proxy / TUN mode, or proxy.txt, then
echo     run again and complete the login in the browser.
pause
exit /b 1

:err3
echo.
echo [X] FAILED AT STEP 3 of 3 (upload / build).
echo     Cause: usually the connection dropped in the middle.
echo     FIX: keep VPN ON (or proxy.txt) and run again - it skips
echo     straight to the upload. If it fails twice more, take a
echo     screenshot of this WHOLE window and send it for support.
pause
exit /b 1
