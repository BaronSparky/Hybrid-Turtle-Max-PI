# ============================================================
# HybridTurtle — Register All Scheduled Tasks
# ============================================================
# Single entry point that registers every HybridTurtle scheduled
# task by chaining the existing register scripts. Self-elevates
# via UAC so the user can run it without an admin shell.
#
# Usage:
#   npm run tasks:register-all
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-all-tasks.ps1
# ============================================================

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Self-elevate if not already running as administrator.
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Requesting administrator privileges via UAC..." -ForegroundColor Yellow
  $relaunch = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $relaunch -Wait
  exit $LASTEXITCODE
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " HybridTurtle - Register All Scheduled Tasks" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Repo: $repoRoot"
Write-Host ""

$registerScripts = @(
  @{ Label = 'Nightly';        Path = Join-Path $repoRoot 'register-nightly-task.ps1';          Args = @('-FromBat') },
  @{ Label = 'Watchdog';       Path = Join-Path $repoRoot 'register-watchdog-task.bat';         Args = @() },
  @{ Label = 'Midday Sync';    Path = Join-Path $repoRoot 'register-midday-sync.ps1';           Args = @('-FromBat') },
  @{ Label = 'Auto-Trade';     Path = Join-Path $repoRoot 'register-auto-trade.bat';            Args = @('--yes') },
  @{ Label = 'Weekly + Daily'; Path = Join-Path $PSScriptRoot 'register-weekly-tasks.ps1';      Args = @() }
)

$results = @()
foreach ($script in $registerScripts) {
  Write-Host ">> $($script.Label): $($script.Path)" -ForegroundColor Cyan

  if (-not (Test-Path $script.Path)) {
    Write-Host "   SKIPPED - script not found" -ForegroundColor Yellow
    $results += [pscustomobject]@{ Label = $script.Label; Status = 'SKIPPED'; ExitCode = $null }
    continue
  }

  try {
    $extension = [IO.Path]::GetExtension($script.Path).ToLowerInvariant()
    if ($extension -eq '.ps1') {
      & $script.Path @($script.Args)
    } else {
      # .bat scripts must be invoked through cmd /c. Args are joined with spaces;
      # register-auto-trade.bat understands --yes to skip its Y/N prompt and pause.
      # Pipe NUL to stdin so any trailing `pause` (e.g. register-watchdog-task.bat)
      # auto-acknowledges without blocking the orchestrator.
      $argString = if ($script.Args.Count -gt 0) { ' ' + ($script.Args -join ' ') } else { '' }
      cmd /c "`"$($script.Path)`"$argString < nul"
    }
    $exitCode = $LASTEXITCODE
    $status = if ($exitCode -eq 0) { 'OK' } else { 'FAILED' }
    $results += [pscustomobject]@{ Label = $script.Label; Status = $status; ExitCode = $exitCode }
  } catch {
    Write-Host "   ERROR - $_" -ForegroundColor Red
    $results += [pscustomobject]@{ Label = $script.Label; Status = 'ERROR'; ExitCode = $null }
  }
  Write-Host ""
}

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Summary" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize

Write-Host ""
Write-Host "Run 'npm run tasks:audit' to verify all tasks are registered." -ForegroundColor Green
