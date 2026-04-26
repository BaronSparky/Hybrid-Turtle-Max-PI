# ============================================================
# HybridTurtle - Register Midday Sync Scheduled Task
# ============================================================
# Runs T212 position sync at 10:00, 13:00, 16:00, 19:00 UK time
# on weekdays. Catches stop-outs within ~3 hours.
# ============================================================

param([switch]$FromBat)

# Self-elevate if not running as admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host ""
Write-Host "  ==========================================================" -ForegroundColor Cyan
Write-Host "   HybridTurtle - Registering Midday Sync Scheduled Task" -ForegroundColor Cyan
Write-Host "  ==========================================================" -ForegroundColor Cyan
Write-Host ""

try {
    # Remove existing task if present
    $existing = Get-ScheduledTask -TaskName "HybridTurtle Midday Sync" -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Removing existing task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName "HybridTurtle Midday Sync" -Confirm:$false
    }

    $Action = New-ScheduledTaskAction `
        -Execute "cmd.exe" `
        -Argument "/c `"$PSScriptRoot\midday-sync-task.bat`" --scheduled" `
        -WorkingDirectory "$PSScriptRoot"

    # Create 4 triggers: 10:00, 13:00, 16:00, 19:00 on weekdays
    $Triggers = @(
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 10:00),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 13:00),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 16:00),
        (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 19:00)
    )

    $Settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

    $Principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERNAME" `
        -LogonType S4U `
        -RunLevel Highest

    $task = Register-ScheduledTask `
        -TaskName "HybridTurtle Midday Sync" `
        -Action $Action `
        -Trigger $Triggers `
        -Settings $Settings `
        -Principal $Principal `
        -Description "HybridTurtle intra-day T212 position sync (10:00, 13:00, 16:00, 19:00)"

    Write-Host ""
    Write-Host "  Task registered successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Schedule: Mon-Fri at 10:00, 13:00, 16:00, 19:00" -ForegroundColor White
    Write-Host "  Action:   midday-sync-task.bat --scheduled" -ForegroundColor White
    Write-Host "  Timeout:  10 minutes" -ForegroundColor White
    Write-Host ""
    Write-Host "  To test now:  double-click midday-sync-task.bat" -ForegroundColor Yellow
    Write-Host "  To remove:    schtasks /delete /tn `"HybridTurtle Midday Sync`" /f" -ForegroundColor Yellow
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "  FAILED to register task: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Try running as administrator, or register manually:" -ForegroundColor Yellow
    Write-Host "    schtasks /create /tn `"HybridTurtle Midday Sync`" /tr `"cmd /c midday-sync-task.bat --scheduled`" /sc daily /st 10:00 /ru %USERNAME%" -ForegroundColor Gray
    Write-Host ""
}

if (-NOT $FromBat) {
    Write-Host "Press any key to close..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
