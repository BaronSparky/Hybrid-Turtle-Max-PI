# ============================================================
# HybridTurtle - Register Nightly Scheduled Task
# ============================================================
# Called from register-nightly-task.bat (already elevated)
# OR right-click -> Run with PowerShell (self-elevates)
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
Write-Host "   HybridTurtle - Registering Nightly Scheduled Task" -ForegroundColor Cyan
Write-Host "  ==========================================================" -ForegroundColor Cyan
Write-Host ""

try {
    # Remove existing task if present
    $existing = Get-ScheduledTask -TaskName "HybridTurtle Nightly" -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Removing existing task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName "HybridTurtle Nightly" -Confirm:$false
    }

    $Action = New-ScheduledTaskAction `
        -Execute "cmd.exe" `
        -Argument "/c `"$PSScriptRoot\nightly-task.bat`" --scheduled" `
        -WorkingDirectory "$PSScriptRoot"

    # All 7 days: the HealthCheck record (written only by nightly) gates auto-trade
    # entries via the 30h fail-closed staleness window. A Mon-Fri-only schedule left
    # Monday sessions blocked because Friday's health was ~60h stale by Monday open.
    # Running nightly on Sat+Sun keeps health fresh. Weekend runs are safe: pyramid
    # auto-buys are Friday-gated, and stop pushes are idempotent (no new daily bars
    # over the weekend => SKIPPED_SAME at the broker).
    $Trigger = New-ScheduledTaskTrigger `
        -Weekly `
        -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday `
        -At 21:00

    $Settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 1)

    $Principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERNAME" `
        -LogonType S4U `
        -RunLevel Highest

    $task = Register-ScheduledTask `
        -TaskName "HybridTurtle Nightly" `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description "HybridTurtle 9-step nightly pipeline"

    Write-Host ""
    Write-Host "  SUCCESS: Task 'HybridTurtle Nightly' registered!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Schedule:    Daily (7 days) at 21:00" -ForegroundColor White
    Write-Host "  Elevated:    Yes" -ForegroundColor White
    Write-Host "  Missed runs: Will run on next login" -ForegroundColor White
    Write-Host "  Logon type:  S4U (runs whether or not logged in)" -ForegroundColor White
    Write-Host ""

    # Write result for verification
    "SUCCESS" | Out-File "$PSScriptRoot\schtask-result.txt"

} catch {
    Write-Host ""
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    "FAILED: $($_.Exception.Message)" | Out-File "$PSScriptRoot\schtask-result.txt"
}

Write-Host ""
if (-NOT $FromBat) {
    Write-Host "  Press any key to close..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
