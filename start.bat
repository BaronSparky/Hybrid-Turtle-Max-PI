@echo off
:: ============================================================
:: HybridTurtle Trading Dashboard — Launcher
:: ============================================================
:: Double-click this to start the dashboard.
:: It will open your browser automatically.
:: ============================================================

title HybridTurtle Dashboard
color 0B
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle Trading Dashboard v6.0
echo  ===========================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  !! Node.js not found. Please run install.bat first.
    pause
    exit /b 1
)

:: Check .env
if not exist ".env" (
    echo  !! No .env file found. Please run install.bat first.
    pause
    exit /b 1
)

:: Check node_modules
if not exist "node_modules" (
    echo  Dependencies not found — installing now...
    call npm install
    if %errorlevel% neq 0 (
        echo  !! npm install failed.
        pause
        exit /b 1
    )
)

:: Ensure Prisma client is generated
if not exist "node_modules\.prisma" (
    echo  Generating Prisma client...
    call npx prisma generate
    if %errorlevel% neq 0 (
        echo  !! Prisma generate failed.
        pause
        exit /b 1
    )
)

:: Ensure database exists and schema is up to date
set FIRST_RUN=0
if not exist "prisma\dev.db" set FIRST_RUN=1

if %FIRST_RUN%==1 (
    echo  Setting up database for the first time...
) else (
    echo  Checking database migrations...
)

call node scripts/auto-migrate.mjs
if %errorlevel% neq 0 (
    echo  !! Database migration failed.
    pause
    exit /b 1
)

if %FIRST_RUN%==1 (
    call npx prisma db seed 2>nul
)

:: Pre-flight: verify critical source files exist
if not exist "src\components\shared\Navbar.tsx" (
    echo.
    echo  !! Critical file missing: src\components\shared\Navbar.tsx
    echo  !! The installation appears incomplete.
    echo  !! Please re-extract the HybridTurtle zip and run install.bat again.
    pause
    exit /b 1
)
if not exist "src\app\layout.tsx" (
    echo.
    echo  !! Critical file missing: src\app\layout.tsx
    echo  !! The installation appears incomplete.
    echo  !! Please re-extract the HybridTurtle zip and run install.bat again.
    pause
    exit /b 1
)
if not exist "tsconfig.json" (
    echo.
    echo  !! Critical file missing: tsconfig.json
    echo  !! The installation appears incomplete.
    echo  !! Please re-extract the HybridTurtle zip and run install.bat again.
    pause
    exit /b 1
)

:: Kill any stale HybridTurtle processes on port 3000 (only targets port 3000, not all Node)
echo  Checking for stale processes on port 3000...
netstat -aon 2>nul | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo          Stopping previous dashboard instance...
    for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>&1
)

:: Wait a moment for the port to free up
timeout /t 1 /nobreak >nul

:: Ensure production build exists (install.bat pre-builds; this catches edge cases)
if not exist ".next" (
    echo  Building dashboard for the first time ^(this may take a few minutes^)...
    call npx next build
    if %errorlevel% neq 0 (
        echo  !! Build failed. Try running install.bat again.
        pause
        exit /b 1
    )
)

echo  Starting dashboard server...
echo.
echo  ───────────────────────────────────────────────────────────
echo   Dashboard will open at: http://localhost:3000
echo.
echo   Keep this window open while using the dashboard.
echo   Press Ctrl+C or close this window to stop.
echo  ───────────────────────────────────────────────────────────
echo.

:: Open browser once server is ready (polls until responsive, max 60s)
start /min cmd /v:on /c "set TRIES=0 && :loop && set /a TRIES+=1 && if !TRIES! GTR 30 (echo Server did not start in time. Open http://localhost:3000 manually. && pause && exit /b) && timeout /t 2 /nobreak >nul && powershell -NoProfile -Command \"try { (Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 2).StatusCode } catch { exit 1 }\" >nul 2>&1 && start http://localhost:3000/dashboard || goto loop"

:: Start the production server (blocks until user closes)
call npm start

pause
