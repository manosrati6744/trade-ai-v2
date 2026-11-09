@echo off
setlocal enabledelayedexpansion
title SMC SNIPER - Launcher
cd /d "%~dp0"

echo ============================================
echo   SMC SNIPER - Gold / Oil / Forex Analyzer
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [X] Node.js not found!
    echo     Please install Node.js 20.9 or newer from https://nodejs.org
    echo     then run this file again.
    echo.
    pause
    exit /b 1
)

rem -- Node version must be 20.9+ (Next.js 16 requirement)
set NODE_VER=
for /f %%i in ('node -v') do set NODE_VER=%%i
set NODE_VER=!NODE_VER:v=!
for /f "tokens=1,2 delims=." %%a in ("!NODE_VER!") do (
    set NODE_MAJ=%%a
    set NODE_MIN=%%b
)
echo [OK] Node.js v!NODE_VER! detected
if !NODE_MAJ! LSS 20 goto badnode
if !NODE_MAJ! EQU 20 if !NODE_MIN! LSS 9 goto badnode
goto nodeok

:badnode
echo.
echo [X] Your Node.js v!NODE_VER! is too old for this app.
echo     This app needs Node.js 20.9 or newer.
echo     Install the LTS version from https://nodejs.org  then run again.
echo.
pause
exit /b 1

:nodeok
rem -- warn if port 3000 is already taken (old copy still running)
netstat -ano 2>nul | findstr ":3000" | findstr /i "LISTENING" >nul
if not errorlevel 1 (
    echo.
    echo [!] Port 3000 is BUSY - an old copy of the app is probably still open.
    echo     Close that black Node.js window first ^(Ctrl+C inside it^),
    echo     otherwise the new version cannot start.
    echo.
)

rem -- install deps when missing, or when the app version changed
set DEPSVER=0
if exist DEPS-VERSION set /p DEPSVER=<DEPS-VERSION
if exist "node_modules\.smc-deps-v!DEPSVER!" goto depsok

echo.
echo [1/2] Preparing packages - please wait 1-3 min (needs internet once)...
echo.
call npm install --no-audit --no-fund --prefer-offline
if errorlevel 1 (
    echo.
    echo [X] npm install failed - check your internet / VPN.
    echo     Tip: if you use a proxy or VPN, turn it ON and run this file again.
    echo     If it still fails: delete the "node_modules" folder and run again.
    echo.
    pause
    exit /b 1
)
type nul > "node_modules\.smc-deps-v!DEPSVER!"

:depsok
echo.
echo [2/2] Building and starting...
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo     Build failed - trying one automatic repair ^(re-install packages^)...
    echo.
    call npm install --no-audit --no-fund --prefer-offline
    if errorlevel 1 (
        echo [X] Repair install failed - check internet / VPN and run again.
        echo     If it still fails: delete the "node_modules" folder and run again.
        echo.
        pause
        exit /b 1
    )
    type nul > "node_modules\.smc-deps-v!DEPSVER!"
    call npm run build
    if errorlevel 1 (
        echo.
        echo [X] Build failed again. Please screenshot this whole window and
        echo     send it for support. Also try: delete "node_modules" + ".next"
        echo     folders, then run this file again.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo ============================================
echo   SMC SNIPER is running!
echo   Open:  http://localhost:3000
echo   Stop:  press Ctrl+C in this window
echo ============================================
echo.
call npm start
pause
