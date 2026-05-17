# ============================================================
# HybridTurtle - Post-Install Cleanup
# ============================================================
# Fixes the three benign warnings that surface on a fresh install
# after register-all-tasks.bat has run:
#
#   1. Stale "HybridTurtle-Nightly" task (dash naming) left over
#      from an earlier repo location (H:\V1 One Turtle Way\...).
#      The current task is "HybridTurtle Nightly" (with a space).
#   2. HybridTurtle-HourlyStatus ExecutionTimeLimit drift
#      (PT10M live vs PT5M expected). Runs apply-task-time-limits.ps1.
#   3. Missing prisma\backups directory used by the nightly db backup
#      step.
#
# Self-elevates via UAC. Safe to re-run - each step is idempotent.
# ============================================================

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

# Self-elevate.
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
Write-Host " HybridTurtle - Post-Install Cleanup" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Repo: $repoRoot"
Write-Host ""

# ------------------------------------------------------------
# 1. Remove stale dash-named HybridTurtle-Nightly task.
# ------------------------------------------------------------
Write-Host ">> [1/3] Removing stale 'HybridTurtle-Nightly' task (if present)" -ForegroundColor Cyan
$stale = Get-ScheduledTask -TaskName 'HybridTurtle-Nightly' -ErrorAction SilentlyContinue
if ($stale) {
  try {
    Unregister-ScheduledTask -TaskName 'HybridTurtle-Nightly' -Confirm:$false -ErrorAction Stop
    Write-Host "   Removed." -ForegroundColor Green
  } catch {
    Write-Host "   FAILED: $_" -ForegroundColor Red
  }
} else {
  Write-Host "   Not present - nothing to remove." -ForegroundColor Gray
}
Write-Host ""

# ------------------------------------------------------------
# 2. Apply expected ExecutionTimeLimits to fix HourlyStatus drift.
# ------------------------------------------------------------
Write-Host ">> [2/3] Applying expected ExecutionTimeLimits" -ForegroundColor Cyan
$applyScript = Join-Path $PSScriptRoot 'apply-task-time-limits.ps1'
if (Test-Path $applyScript) {
  & $applyScript
  Write-Host "   Done (exit $LASTEXITCODE)." -ForegroundColor Green
} else {
  Write-Host "   SKIPPED - $applyScript not found." -ForegroundColor Yellow
}
Write-Host ""

# ------------------------------------------------------------
# 3. Ensure prisma\backups directory exists for the nightly db backup.
# ------------------------------------------------------------
Write-Host ">> [3/3] Ensuring prisma\backups directory exists" -ForegroundColor Cyan
$backupDir = Join-Path $repoRoot 'prisma\backups'
if (Test-Path $backupDir) {
  Write-Host "   Already present: $backupDir" -ForegroundColor Gray
} else {
  try {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Write-Host "   Created: $backupDir" -ForegroundColor Green
  } catch {
    Write-Host "   FAILED: $_" -ForegroundColor Red
  }
}
Write-Host ""

# ------------------------------------------------------------
# Final audit report.
# ------------------------------------------------------------
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Scheduler audit after cleanup" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
$auditScript = Join-Path $repoRoot 'scripts\audit-scheduled-tasks.mjs'
if (Test-Path $auditScript) {
  node $auditScript
} else {
  Write-Host "audit-scheduled-tasks.mjs not found - skipping audit." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Cleanup complete. Any remaining warnings above are unrelated." -ForegroundColor Green
