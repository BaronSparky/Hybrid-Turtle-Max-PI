# Apply updated ExecutionTimeLimit to live HybridTurtle scheduled tasks.
# Mirrors the per-task map in scripts/register-all-tasks.ps1.
# Safe to re-run; Set-ScheduledTask is idempotent.

$ErrorActionPreference = 'Stop'

# Self-elevate. Tasks created with /RL HIGHEST require admin to modify.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Requesting administrator privileges via UAC..." -ForegroundColor Yellow
  $relaunch = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $relaunch -Wait
  exit $LASTEXITCODE
}

$limits = @{
  'HybridTurtle-Scan'        = 'PT20M'
  'HybridTurtle-Trade-UK'    = 'PT20M'
  'HybridTurtle-Trade-US'    = 'PT20M'
  'HybridTurtle-Trade-USC'   = 'PT20M'
  'HybridTurtle Nightly'     = 'PT45M'
  'HybridTurtle Midday Sync' = 'PT15M'
}

$results = @()
foreach ($name in $limits.Keys) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) {
    $results += [pscustomobject]@{ Task = $name; Before = '<missing>'; After = '<missing>'; Status = 'NOT_FOUND' }
    continue
  }
  $before = $task.Settings.ExecutionTimeLimit
  $target = $limits[$name]
  if ($before -eq $target) {
    $results += [pscustomobject]@{ Task = $name; Before = $before; After = $target; Status = 'UNCHANGED' }
    continue
  }
  try {
    $task.Settings.ExecutionTimeLimit = $target
    Set-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null
    $verify = Get-ScheduledTask -TaskName $name
    $results += [pscustomobject]@{ Task = $name; Before = $before; After = $verify.Settings.ExecutionTimeLimit; Status = 'UPDATED' }
  } catch {
    $results += [pscustomobject]@{ Task = $name; Before = $before; After = '<error>'; Status = "ERROR: $($_.Exception.Message)" }
  }
}

$results | Format-Table -AutoSize

# Persist a verification artifact so the orchestrator can confirm the elevated
# child process actually ran (otherwise its console output disappears).
$artifact = Join-Path $PSScriptRoot '..\data\apply-task-time-limits-result.json'
$artifactDir = Split-Path $artifact -Parent
if (-not (Test-Path $artifactDir)) { New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null }
[pscustomobject]@{
  ranAt   = (Get-Date).ToString('o')
  results = $results
} | ConvertTo-Json -Depth 4 | Out-File -FilePath $artifact -Encoding utf8
