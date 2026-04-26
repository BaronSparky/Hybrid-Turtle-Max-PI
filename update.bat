@echo off
:: ============================================================
:: HybridTurtle — Update Script v6.0
:: ============================================================
:: Run this after pulling new code to update dependencies
:: and apply any database changes.
:: ============================================================

title HybridTurtle Updater v6.0
color 0E
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle — Updating (v6.0)...
echo  ===========================================================
echo.

:: Stop any running HybridTurtle instances on port 3000
echo  [1/5] Stopping any running dashboard instances...
powershell -NoProfile -Command "$conns = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue; if ($conns) { Write-Host '         Stopping dashboard on port 3000...'; $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" 2>nul

:: Update dependencies
echo  [2/5] Updating dependencies...
if exist "package-lock.json" (
    call npm ci
) else (
    call npm install
)
if %errorlevel% neq 0 (
    echo  !! npm install failed.
    pause
    exit /b 1
)

:: Regenerate Prisma client and apply migrations
echo  [3/5] Updating database schema...
call npx prisma generate
if %errorlevel% neq 0 (
    echo  !! Prisma generate failed.
    pause
    exit /b 1
)
call node scripts/auto-migrate.mjs
if %errorlevel% neq 0 (
    echo  !! Database migration failed.
    pause
    exit /b 1
)

:: Re-seed (upserts, so safe to re-run)
echo  [4/5] Refreshing stock universe...
call npx prisma db seed 2>nul

:: Rebuild for production (start.bat uses production mode)
echo  [5/5] Building dashboard (this may take a few minutes)...
call npx next build
if %errorlevel% neq 0 (
    echo  !! Build failed. The dashboard may still work — try start.bat.
)

echo.
echo  ===========================================================
echo   UPDATE COMPLETE!
echo  ===========================================================
echo.
echo   Run start.bat or double-click the desktop shortcut to launch.
echo.

pause
