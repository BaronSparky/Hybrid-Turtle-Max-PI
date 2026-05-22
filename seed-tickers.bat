@echo off
title HybridTurtle - Import Ticker Data
echo.
echo  =============================================
echo   HybridTurtle - Ticker Data Import
echo  =============================================
echo.
echo  This will import all ticker data from the
echo  Planning folder into your database:
echo.
echo    - stock_core_200.txt   (Core stocks)
echo    - etf_core.txt         (ETF sleeve)
echo    - stock_high_risk.txt  (High-risk sleeve)
echo    - hedge.txt            (Hedge sleeve)
echo    - cluster_map.csv      (Cluster mappings)
echo    - super_cluster_map.csv
echo    - region_map.csv       (Region + currency)
echo    - ticker_map.csv       (T212 ticker map)
echo.
echo  =============================================
echo.

cd /d "%~dp0"

:: Check node_modules exist
if not exist "node_modules" (
    echo  [!] node_modules not found. Running npm install first...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed. Please fix and retry.
        pause
        exit /b 1
    )
    echo.
)

:: Check Planning folder exists
if not exist "Planning" (
    echo  [ERROR] Planning folder not found!
    echo  Make sure the Planning folder is in: %cd%
    pause
    exit /b 1
)

:: Stop HybridTurtle Node processes that may lock Prisma files
echo  [*] Checking for running HybridTurtle processes...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 /nobreak >nul

:: Generate Prisma client if needed
echo  [1/2] Generating Prisma client...
call npx prisma generate
if errorlevel 1 (
    echo.
    echo  [ERROR] Prisma generate failed.
    pause
    exit /b 1
)

echo.
echo  [2/3] Seeding database with ticker data...
echo.
call npx prisma db seed
if errorlevel 1 (
    echo.
    echo  [ERROR] Seed failed. Check the error above.
    pause
    exit /b 1
)

echo.
echo  [3/3] Repairing T212 ticker mappings from live API...
echo.
echo  This queries Trading 212's instruments API to map exact
echo  instrument IDs (e.g. AAPL_US_EQ). Requires a T212 account
echo  to be connected in Settings. Skipping is OK — the seed
echo  provides best-guess mappings that cover most stocks.
echo.
call npx tsx scripts/repair-t212-tickers-from-instruments.ts --refresh-cache --apply 2>&1
if errorlevel 1 (
    echo.
    echo  [NOTE] T212 repair skipped or failed. This is OK if you
    echo  haven't connected a Trading 212 account yet. You can run
    echo  this step later with:
    echo    npx tsx scripts/repair-t212-tickers-from-instruments.ts --refresh-cache --apply
    echo.
)

echo.
echo  =============================================
echo   Import complete!
echo  =============================================
echo.
pause
