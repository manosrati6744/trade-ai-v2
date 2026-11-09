@echo off
setlocal enabledelayedexpansion
title SMC SNIPER - Deploy to Vercel
cd /d "%~dp0"

echo ============================================
echo   SMC SNIPER - Deploy to Vercel
echo   Uploads this whole folder to your site.
echo   GitHub is NOT needed for this.
echo.
echo   IMPORTANT: your VPN must cover the WHOLE
echo   system (System Proxy / TUN mode), not only
echo   the browser.
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
echo       Your browser will open. Log in with the SAME account that
echo       already has your project on Vercel.
echo.
call vercel login
if errorlevel 1 goto err2

echo.
echo [3/3] Link this folder to your project, then deploy.
echo.
echo       Answer the questions like this:
echo.
echo         Set up this folder?              type Y  + Enter
echo         Which scope?                     choose YOUR account + Enter
echo         Link to existing project?        type Y  + Enter
echo         Which project?                   choose YOUR EXISTING project + Enter
echo.
call vercel link
if errorlevel 1 goto err3

echo.
echo       Uploading and building - this takes 2-4 minutes. Do not close!
echo.
call vercel --prod
if errorlevel 1 goto err4

echo.
echo ============================================
echo   DONE!
echo   Open your site URL and check the page
echo   footer - it must show v7.8
echo ============================================
pause
exit /b 0

:err1
echo.
echo [X] FAILED AT STEP 1 of 3 (downloading Vercel CLI).
echo     Cause: no internet, or npm is blocked for your region.
echo     FIX 1: turn your VPN ON (whole system / TUN mode) and run again.
echo     FIX 2: if your VPN app has no system mode, see proxy.txt below:
echo            create a file proxy.txt next to this .bat with one line,
echo            the local proxy address of your VPN app (like 127.0.0.1:7890).
pause
exit /b 1

:err2
echo.
echo [X] FAILED AT STEP 2 of 3 (login).
echo     Cause: this black window itself must reach vercel.com - a
echo     browser-only VPN is not enough.
echo     FIX 1: turn VPN ON with System Proxy / TUN mode, run again.
echo     FIX 2: or use proxy.txt (see FIX 2 of step 1 above).
echo     FIX 3: finish the login inside the browser before closing it.
pause
exit /b 1

:err3
echo.
echo [X] FAILED AT STEP 3 of 3 (linking).
echo     Cause: usually a wrong answer to one of the questions.
echo     Run again and answer exactly:
echo       Set up this folder?           Y
echo       Which scope?                  YOUR account
echo       Link to existing project?     Y
echo       Which project?                YOUR EXISTING project
echo     If the project list was EMPTY, you chose the wrong scope -
echo     run again and pick the account you normally see on vercel.com
pause
exit /b 1

:err4
echo.
echo [X] FAILED AT STEP 3 of 3 (upload / build).
echo     Cause: usually the connection dropped in the middle.
echo     FIX: keep VPN ON and run this file again - it will resume
echo     from the login step. If it fails twice more, take a
echo     screenshot of this WHOLE window and send it for support.
pause
exit /b 1
