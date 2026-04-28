@echo off
:: ============================================================
:: HybridTurtle Trading Dashboard — One-Click Installer
:: ============================================================
:: This script installs everything a novice needs to run
:: the HybridTurtle dashboard on a fresh Windows machine.
:: ============================================================

:: Keep window open even if the script crashes unexpectedly
if not defined _INSTALL_RUNNING (
    set "_INSTALL_RUNNING=1"
    cmd /k "%~f0" %*
    exit /b
)

title HybridTurtle Installer v6.0
color 0A
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

:: ── Install log ──
set "LOG=%~dp0install.log"
>> "%LOG%" echo.
>> "%LOG%" echo [%date% %time%] ====== Starting install ======
echo  (logging to install.log)

echo.
echo  ===========================================================
echo       _  _      _        _    _  _____          _   _
echo     ^| ^|^| ^|_  _^| ^|__  _ ^(_) ^|^|_^|_   _^|_  _ _ ^|_^| ^| ___
echo     ^|  _  ^| ^|^| ^| '_ \^| '__^| ^| / _` ^| ^| ^|  ^| ^| ^| '_^|  _^|^| / -_^)
echo     ^|_^| ^|_^|\_, ^|_.__/^|_^|  ^|_^|\__,_^| ^|_^|  ^|___^|_^|  ^|_^|^| ^|_\___^|
echo            ^|__/
echo  ===========================================================
echo       Trading Dashboard Installer v6.0
echo  ===========================================================
echo.

:: ── Step 1: Check for Node.js ──
echo  [1/7] Checking for Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  !! Node.js is NOT installed.
    echo  !! Opening the Node.js download page...
    echo  !! Please install Node.js LTS.
    echo  !! Important: after install finishes, close this window
    echo  !! and run install.bat again.
    echo.
    start https://nodejs.org/en/download/
    echo  Press any key to exit installer...
    pause >nul
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo         Found Node.js %NODE_VER%
>> "%LOG%" echo [%date% %time%] Node.js %NODE_VER%

:: ── Node.js version compatibility check ──
set "NODE_VER_NO_V=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%i in ("%NODE_VER_NO_V%") do set NODE_MAJOR=%%i
if %NODE_MAJOR% LSS 18 (
    echo.
    echo  !! This installer requires Node.js 18 or higher.
    echo  !! You have Node.js %NODE_VER% installed.
    echo  !! Please install a current Node.js LTS version, then run install.bat again.
    echo  !! On the Node.js website, choose the LTS tab.
    echo.
    echo  !! Opening Node.js download page...
    >> "%LOG%" echo [%date% %time%] FAIL: Node.js too old: %NODE_VER%
    start https://nodejs.org/en/download/
    pause
    exit /b 1
)

:: ── Node.js architecture check ──
for /f "tokens=*" %%i in ('node -e "console.log(process.arch)"') do set NODE_ARCH=%%i
echo         Architecture: %NODE_ARCH%
echo %NODE_ARCH% | findstr /i "x64 arm64" >nul
if %errorlevel% neq 0 (
    echo.
    echo  !! 64-bit Node.js is required. You have: %NODE_ARCH%
    echo  !! Please install the 64-bit ^(x64^) version from https://nodejs.org
    >> "%LOG%" echo [%date% %time%] FAIL: Wrong architecture: %NODE_ARCH%
    pause
    exit /b 1
)

:: ── Step 2: Check npm ──
echo  [2/7] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  !! npm not found. It should come with Node.js.
    echo  !! Please reinstall Node.js from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set NPM_VER=%%i
echo         Found npm v%NPM_VER%

:: ── Pre-flight: Verify PowerShell ──
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo  !! PowerShell not found. Required for installation.
    >> "%LOG%" echo [%date% %time%] FAIL: PowerShell not found
    pause
    exit /b 1
)

:: ── Step 3: Create .env if missing ──
echo  [3/7] Setting up environment...
if exist ".env" (
    echo         .env already exists - keeping existing config
    >> "%LOG%" echo [%date% %time%] .env already exists - skipped
    goto :env_done
)
:: Generate a cryptographically random secret (32 bytes, base64)
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)"') do set NEXTAUTH_SECRET=%%i
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)"') do set CRON_SECRET=%%i
> ".env" echo DATABASE_URL=file:./dev.db
>> ".env" echo NEXTAUTH_URL=http://localhost:3000
>> ".env" echo NEXTAUTH_SECRET=!NEXTAUTH_SECRET!
>> ".env" echo ENCRYPTION_SECRET=!NEXTAUTH_SECRET!
>> ".env" echo CRON_SECRET=!CRON_SECRET!
>> ".env" echo DISABLE_API_AUTH=true
>> ".env" echo.
>> ".env" echo # Broker adapter: disabled, mock, or trading212
>> ".env" echo BROKER_ADAPTER=disabled
>> ".env" echo.
>> ".env" echo # Telegram nightly reports - fill these in during Step 7 or later
>> ".env" echo # TELEGRAM_BOT_TOKEN=your-bot-token-here
>> ".env" echo # TELEGRAM_CHAT_ID=your-chat-id-here
echo         Created .env with SQLite database
>> "%LOG%" echo [%date% %time%] Created .env
:env_done

:: ── Step 4: Install dependencies ──
echo  [4/7] Installing dependencies (this may take 2-5 minutes)...
echo.
:: Use npm ci for reproducible installs when lockfile exists; fall back to npm install
if exist "package-lock.json" (
    call npm ci >> "%LOG%" 2>&1
) else (
    call npm install >> "%LOG%" 2>&1
)
if errorlevel 1 (
    echo.
    echo  !! npm install failed. Try these steps:
    echo  !!
    echo  !!   1. Close any other programs, then double-click install.bat again
    echo  !!   2. Right-click install.bat and choose "Run as administrator"
    echo  !!   3. If your antivirus is active, temporarily disable it and retry
    echo  !!
    echo  !! If the problem persists, see install.log for technical details.
    >> "%LOG%" echo [%date% %time%] FAIL: npm install
    goto :fail
)
>> "%LOG%" echo [%date% %time%] npm install OK

:: ── Step 5: Setup database ──
echo.
echo  [5/7] Setting up database...
call npx prisma generate >> "%LOG%" 2>&1
if errorlevel 1 (
    echo  !! Prisma generate failed. See install.log for details.
    >> "%LOG%" echo [%date% %time%] FAIL: prisma generate
    goto :fail
)

call node scripts/auto-migrate.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
    echo  !! Database migration failed. See install.log for details.
    >> "%LOG%" echo [%date% %time%] FAIL: auto-migrate
    goto :fail
)

:: Seed the database with stock universe (idempotent — safe to re-run)
echo         Seeding stock universe...
call npx prisma db seed >> "%LOG%" 2>&1
if errorlevel 1 (
    echo         Note: Seed may have already been applied — continuing.
)
>> "%LOG%" echo [%date% %time%] Database setup OK

:: ── Step 5b: Verify build compiles ──
echo.
echo         Building the dashboard (this may take 2-5 minutes, please wait)...
call npx next build >> "%LOG%" 2>&1
if errorlevel 1 (
    echo(
    echo  Build verification failed.
    echo  This usually means some files are missing from the install.
    echo  Try these steps:
    echo    1. Re-extract the HybridTurtle zip to a fresh folder
    echo    2. Make sure you extract ALL files ^(not just some^)
    echo    3. Run install.bat again from the new folder
    echo  See install.log for the specific error.
    >> "%LOG%" echo [%date% %time%] FAIL: next build verification
    goto :fail
)
echo         Build OK
>> "%LOG%" echo [%date% %time%] Build verification OK

:: ── Step 6: Create desktop shortcut ──
echo  [6/7] Creating desktop shortcut...
set "SCRIPT_DIR=%~dp0"
set "SHORTCUT_NAME=HybridTurtle Dashboard"

:: Use PowerShell to create a proper shortcut (paths are escaped to handle special chars)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$scriptDir = '%SCRIPT_DIR%' -replace \"'\", \"''\"; $ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = Join-Path $desktop '%SHORTCUT_NAME%.lnk'; $sc = $ws.CreateShortcut($lnk); $sc.TargetPath = Join-Path $scriptDir 'start.bat'; $sc.WorkingDirectory = $scriptDir; $sc.Description = 'Launch HybridTurtle Trading Dashboard'; $sc.IconLocation = 'shell32.dll,21'; $sc.Save()"

if %errorlevel% equ 0 (
    echo         Desktop shortcut created!
) else (
    echo         Could not create shortcut. You can launch by double-clicking:
    echo         %SCRIPT_DIR%start.bat
)

:: ── Step 7: Optional — Nightly Telegram Scheduled Task ──
echo.
echo  [7/7] Nightly Telegram Notifications (optional)
echo.
echo   This sets up a Windows Scheduled Task that runs every
echo   weeknight at 21:10 to send a Telegram summary of your
echo   portfolio - stops, risk gates, laggards, module alerts.
echo.
echo   Requirements:
echo     - A Telegram bot token (from @BotFather)
echo     - Your Telegram chat ID (from @userinfobot)
echo     - PC must be on at 21:10 (runs late if missed)
echo.
set /p SETUP_TELEGRAM="  Set up the nightly Telegram task? (Y/N): "
if /i not "%SETUP_TELEGRAM%"=="Y" if /i not "%SETUP_TELEGRAM%"=="N" (
    echo         Input not recognized, defaulting to N.
    set "SETUP_TELEGRAM=N"
)
if /i not "%SETUP_TELEGRAM%"=="Y" (
    echo         Skipped - you can set this up later by running:
    echo         install.bat or manually in Task Scheduler.
    goto :skip_tg_setup
)

echo.
echo   --- Telegram Credentials ---
echo.
echo   To get your bot token:
echo     1. Open Telegram and message @BotFather
echo     2. Send /newbot and follow the prompts
echo     3. Copy the token it gives you
echo.
echo   To get your chat ID:
echo     1. Open Telegram and message @userinfobot
echo     2. It replies with your numeric ID
echo.

:: Check if credentials already exist in .env
set "HAS_TOKEN="
set "HAS_CHATID="
for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="TELEGRAM_BOT_TOKEN" if not "%%b"=="" if not "%%b"=="your-bot-token-here" set "HAS_TOKEN=1"
    if "%%a"=="TELEGRAM_CHAT_ID" if not "%%b"=="" if not "%%b"=="your-chat-id-here" set "HAS_CHATID=1"
)

if defined HAS_TOKEN if defined HAS_CHATID (
    echo         Telegram credentials already found in .env
    echo.
    set /p TG_REPLACE="  Replace existing credentials? (Y/N): "
    if /i not "!TG_REPLACE!"=="Y" (
        echo         Keeping existing credentials.
        goto :skip_tg_creds
    )
)

call :read_tg_token
if "!TG_TOKEN!"=="" (
    echo         No token entered - skipping Telegram setup.
    goto :skip_tg_setup
)

call :read_tg_chatid
if "!TG_CHATID!"=="" (
    echo         No chat ID entered - skipping Telegram setup.
    goto :skip_tg_setup
)

:: Remove any existing Telegram lines from .env, then append new ones
:: Credentials are passed via environment variables (not command-line args)
:: to avoid leaking them in process listings.
set "_TG_TOKEN=!TG_TOKEN!"
set "_TG_CHATID=!TG_CHATID!"
powershell -NoProfile -Command "$tok = $env:_TG_TOKEN; $cid = $env:_TG_CHATID; $f = Get-Content '.env' | Where-Object { $_ -notmatch '^TELEGRAM_BOT_TOKEN=' -and $_ -notmatch '^TELEGRAM_CHAT_ID=' }; $f += \"TELEGRAM_BOT_TOKEN=$tok\"; $f += \"TELEGRAM_CHAT_ID=$cid\"; Set-Content '.env' $f"
echo         Telegram credentials saved to .env

:: Send a test message to confirm it works
:: Token and chat ID are read from env vars, not embedded in args.
echo.
echo         Sending test message to your Telegram...
powershell -NoProfile -Command "$tok = $env:_TG_TOKEN; $cid = $env:_TG_CHATID; $r = Invoke-RestMethod -Uri \"https://api.telegram.org/bot$tok/sendMessage\" -Method Post -ContentType 'application/json' -Body ('{\"chat_id\":\"' + $cid + '\",\"text\":\"HybridTurtle connected! Nightly reports will arrive here at 21:10 Mon-Fri.\"}'); if ($r.ok) { Write-Output '         Test message sent successfully!' } else { Write-Output '         !! Test message failed - check your token and chat ID.' }" 2>nul || echo         !! Could not reach Telegram API - check your internet connection.

:skip_tg_creds
echo.
echo         Registering scheduled task...

:: Check for admin privileges (schtasks usually requires elevation)
net session >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  !! Creating a scheduled task requires Administrator privileges.
    echo  !! Please re-run install.bat as Administrator to set up the nightly task.
    echo  !! ^(Right-click install.bat ^> Run as administrator^)
    echo  !! Everything else is installed — only the scheduled task was skipped.
    >> "%LOG%" echo [%date% %time%] WARN: Skipped schtasks - no admin
    goto :skip_tg_setup
)

:: Only create nightly-task.bat if it does not already exist
if not exist "%~dp0nightly-task.bat" (
    call :create_nightly_bat
    if errorlevel 1 (
        echo  !! Failed to create nightly-task.bat. See install.log.
        >> "%LOG%" echo [%date% %time%] FAIL: create nightly-task.bat
        goto :fail
    )
) else (
    echo         nightly-task.bat already exists - keeping existing version
)

:: Create/replace scheduled task using schtasks (more robust across machines)
set "TASK_NAME=HybridTurtle-Nightly"
set "NIGHTLY_BAT=%SCRIPT_DIR%nightly-task.bat"
schtasks /Delete /TN "%TASK_NAME%" /F >> "%LOG%" 2>&1
schtasks /Create /TN "%TASK_NAME%" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 21:10 /TR "\"%NIGHTLY_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1

if !errorlevel! equ 0 (
    echo         Scheduled task 'HybridTurtle-Nightly' created!
    echo         Runs Mon-Fri at 21:10. View/edit in Task Scheduler.
    >> "%LOG%" echo [%date% %time%] Scheduled task created
) else (
    echo         !! Could not create scheduled task.
    echo         !! Try running this installer as Administrator.
    >> "%LOG%" echo [%date% %time%] FAIL: schtasks create
)

:skip_tg_setup

:: ── Optional — Auto-Trade Scheduled Tasks ──
echo.
echo  ───────────────────────────────────────────────────────────
echo   Automated Trading (optional)
echo  ───────────────────────────────────────────────────────────
echo.
echo   This sets up scheduled tasks that automatically scan for
echo   breakout candidates, buy stocks that meet all criteria,
echo   and place protective stops — all without the dashboard.
echo.
echo   IMPORTANT: Auto-trading is OFF by default. To enable:
echo     1. Connect Trading 212 in the dashboard Settings
echo     2. Set ENABLE_AUTO_TRADING=true in .env
echo     3. Toggle the kill switch ON in Settings ^> Safety Controls
echo.
echo   Schedule:
echo     20:00  Evening scan (candidates for tomorrow)
echo     08:15  UK/EU entries
echo     14:45  US entries (early session)
echo     20:30  US near-close entries
echo     08:00  UK pre-session Telegram briefing
echo     14:30  US pre-session Telegram briefing
echo     07:30  Monday morning briefing
echo     18:00  Sunday weekly performance digest
echo.
echo   You will receive Telegram updates for every trade.
echo.
set /p SETUP_AUTOTRADE="  Set up automated trading? (Y/N): "
if /i not "%SETUP_AUTOTRADE%"=="Y" if /i not "%SETUP_AUTOTRADE%"=="N" (
    echo         Input not recognized, defaulting to N.
    set "SETUP_AUTOTRADE=N"
)
if /i not "%SETUP_AUTOTRADE%"=="Y" (
    echo         Skipped — you can set this up later with register-auto-trade.bat
    goto :skip_autotrade
)

:: Check admin privileges
net session >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  !! Creating scheduled tasks requires Administrator privileges.
    echo  !! Re-run install.bat as Administrator, or run register-auto-trade.bat later.
    >> "%LOG%" echo [%date% %time%] WARN: Skipped auto-trade tasks - no admin
    goto :skip_autotrade
)

:: Add ENABLE_AUTO_TRADING to .env if not present
findstr /c:"ENABLE_AUTO_TRADING" ".env" >nul 2>&1
if !errorlevel! neq 0 (
    >> ".env" echo.
    >> ".env" echo # Automated trading - set to true ONLY after connecting T212 and testing
    >> ".env" echo ENABLE_AUTO_TRADING=false
    echo         Added ENABLE_AUTO_TRADING=false to .env ^(safe default^)
    echo         Change to true after connecting Trading 212 and reviewing Settings
) else (
    echo         ENABLE_AUTO_TRADING already in .env
)

:: Create all 4 scheduled tasks
set "AT_BAT=%SCRIPT_DIR%auto-trade-task.bat"

schtasks /Delete /TN "HybridTurtle-Scan" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-Scan" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:00 /TR "\"%AT_BAT%\" scan --scheduled" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Evening scan: 20:00 Mon-Fri

schtasks /Delete /TN "HybridTurtle-Trade-UK" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-Trade-UK" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:15 /TR "\"%AT_BAT%\" uk --scheduled" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         UK entries: 08:15 Mon-Fri

schtasks /Delete /TN "HybridTurtle-Trade-US" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-Trade-US" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 14:45 /TR "\"%AT_BAT%\" us --scheduled" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         US entries: 14:45 Mon-Fri

schtasks /Delete /TN "HybridTurtle-Trade-USC" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-Trade-USC" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:30 /TR "\"%AT_BAT%\" us-close --scheduled" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         US near-close: 20:30 Mon-Fri

set "HS_BAT=%SCRIPT_DIR%hourly-status-task.bat"
schtasks /Delete /TN "HybridTurtle-HourlyStatus" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-HourlyStatus" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:00 /RI 60 /DU 13:00 /TR "\"%HS_BAT%\" --scheduled" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Hourly Telegram status: 08:00-21:00 Mon-Fri

:: Midday sync (position detection)
set "MS_BAT=%SCRIPT_DIR%midday-sync-task.bat"
schtasks /Delete /TN "HybridTurtle-MiddaySync" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-MiddaySync" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 12:00 /TR "\"%MS_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Midday sync: 12:00 Mon-Fri

:: Watchdog (missed heartbeat detection)
set "WD_BAT=%SCRIPT_DIR%watchdog-task.bat"
schtasks /Delete /TN "HybridTurtle-Watchdog" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-Watchdog" /SC DAILY /ST 10:00 /TR "\"%WD_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Watchdog: daily 10:00

:: Pre-session briefings (Telegram)
set "UK_BAT=%SCRIPT_DIR%uk-briefing-task.bat"
set "US_BAT=%SCRIPT_DIR%us-briefing-task.bat"
set "MB_BAT=%SCRIPT_DIR%monday-briefing-task.bat"
set "WK_BAT=%SCRIPT_DIR%weekly-digest-task.bat"

schtasks /Delete /TN "HybridTurtle-UKBriefing" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-UKBriefing" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:00 /TR "\"%UK_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         UK briefing: 08:00 Mon-Fri

schtasks /Delete /TN "HybridTurtle-USBriefing" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-USBriefing" /SC WEEKLY /D TUE,WED,THU,FRI /ST 14:30 /TR "\"%US_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         US briefing: 14:30 Tue-Fri

schtasks /Delete /TN "HybridTurtle-MondayBriefing" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-MondayBriefing" /SC WEEKLY /D MON /ST 07:30 /TR "\"%MB_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Monday briefing: 07:30 Monday

schtasks /Delete /TN "HybridTurtle-WeeklyDigest" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-WeeklyDigest" /SC WEEKLY /D SUN /ST 18:00 /TR "\"%WK_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Weekly digest: 18:00 Sunday

set "TA_BAT=%~dp0ticker-audit-task.bat"
schtasks /Delete /TN "HybridTurtle-TickerAudit" /F >> "%LOG%" 2>&1
schtasks /Create /TN "HybridTurtle-TickerAudit" /SC MONTHLY /D 1 /ST 06:00 /TR "\"%TA_BAT%\" --scheduled" /RL HIGHEST /F >> "%LOG%" 2>&1
echo         Ticker audit: 06:00 1st+15th monthly

>> "%LOG%" echo [%date% %time%] Auto-trade + briefing scheduled tasks created

:skip_autotrade

:: ── Done! ──
echo.
echo  ===========================================================
echo   INSTALLATION COMPLETE!
echo  ===========================================================
echo.
echo   To launch the dashboard:
echo     - Double-click "HybridTurtle Dashboard" on your Desktop
echo     - OR run start.bat in this folder
echo.
echo   The dashboard will open at: http://localhost:3000
echo.
echo   First run may take a moment while the app compiles.
if /i "%SETUP_TELEGRAM%"=="Y" (
    echo.
    echo   Telegram: Nightly summary at 21:10 Mon-Fri
)
if /i "%SETUP_AUTOTRADE%"=="Y" (
    echo.
    echo   Auto-Trade:
    echo     Scan 20:00, UK 08:15, US 14:45, US-Close 20:30
    echo     Midday sync 12:00, Watchdog 10:00
    echo     Hourly Telegram status: every hour 08:00-21:00
    echo     UK briefing 08:00, US briefing 14:30
    echo     Monday briefing 07:30, Weekly digest Sunday 18:00
    echo     Disable anytime: toggle in Settings or set ENABLE_AUTO_TRADING=false
)
echo.
echo   Full install log: install.log
echo  ===========================================================
echo.
>> "%LOG%" echo [%date% %time%] ====== Install complete ======

set /p LAUNCH="  Launch the dashboard now? (Y/N): "
if /i not "%LAUNCH%"=="Y" if /i not "%LAUNCH%"=="N" (
    echo         Input not recognized, defaulting to N.
    set "LAUNCH=N"
)
if /i "%LAUNCH%"=="Y" (
    call "%~dp0start.bat"
)

pause
exit /b 0

:: ── Error handler ──
:fail
echo.
echo  ===========================================================
echo   INSTALLATION FAILED
echo  ===========================================================
echo.
echo   Check install.log for details.
echo.
>> "%LOG%" echo [%date% %time%] ====== Install FAILED ======
pause
exit /b 1

:: ── Helper subroutines ──

:read_tg_token
setlocal DisableDelayedExpansion
set /p TG_TOKEN="  Paste your Bot Token: "
endlocal & set "TG_TOKEN=%TG_TOKEN%"
goto :eof

:read_tg_chatid
setlocal DisableDelayedExpansion
set /p TG_CHATID="  Paste your Chat ID: "
endlocal & set "TG_CHATID=%TG_CHATID%"
goto :eof

:create_nightly_bat
> "%~dp0nightly-task.bat" echo @echo off
>> "%~dp0nightly-task.bat" echo cd /d "%%~dp0"
>> "%~dp0nightly-task.bat" echo echo [%%date%% %%time%%] Starting nightly process... ^>^> nightly.log
>> "%~dp0nightly-task.bat" echo call npx tsx src/cron/nightly.ts --run-now 2^>^&1 ^| powershell -NoProfile -Command "$input ^| Tee-Object -FilePath 'nightly.log' -Append"
>> "%~dp0nightly-task.bat" echo echo [%%date%% %%time%%] Nightly process finished ^(exit code: %%ERRORLEVEL%%^) ^>^> nightly.log
goto :eof
