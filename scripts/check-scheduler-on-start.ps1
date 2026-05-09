# Surface scheduler ERROR-level findings to the start.bat console.
# Read-only: never mutates tasks, never blocks dashboard start.
# Exit 0 even when ERRORs are present so callers can keep going.

$ErrorActionPreference = 'Continue'

$lines = & node "$PSScriptRoot/audit-scheduled-tasks.mjs" 2>&1 | ForEach-Object { $_.ToString() }
$errors = $lines | Where-Object { $_ -match 'ERROR:' }

if ($errors) {
  Write-Host '  !! Scheduler issues detected (npm run sanity:scheduler for full report):' -ForegroundColor Yellow
  foreach ($line in $errors) {
    Write-Host ('    ' + $line) -ForegroundColor Yellow
  }
} else {
  Write-Host '  Scheduler: OK' -ForegroundColor Green
}

exit 0
