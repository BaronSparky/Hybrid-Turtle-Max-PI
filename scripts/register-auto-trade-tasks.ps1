$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$bat = Join-Path $scriptDir "auto-trade-task.bat"
$hs  = Join-Path $scriptDir "hourly-status-task.bat"

# Helper: make a task resilient (run on battery, don't stop on idle, catch up if missed)
# NOTE: PT20M for the auto-trade scan/trade tasks. The full scan over the
# ~1149-ticker universe (Yahoo fetches + earnings lookups + grading + T212
# order placement + stops) routinely exceeds 10 minutes and the scheduler
# would otherwise terminate the .bat with Last Result = 267014 before any
# buys are placed. Hourly-status stays at PT5M (it only summarises state).
function Set-TaskResilient($name) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) {
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $task.Settings.IdleSettings.StopOnIdleEnd = $false
    $task.Settings.StartWhenAvailable = $true
    $task.Settings.ExecutionTimeLimit = "PT20M"
    Set-ScheduledTask -InputObject $task | Out-Null
  }
}

schtasks /Delete /TN "HybridTurtle-Scan" /F 2>$null
schtasks /Create /TN "HybridTurtle-Scan" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:00 /TR "`"$bat`" scan --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Scan"
Write-Host "Scan: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-UK" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-UK" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:20 /TR "`"$bat`" uk --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-UK"
Write-Host "UK: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-UKM" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-UKM" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 10:30 /TR "`"$bat`" uk-mid --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-UKM"
Write-Host "UKM: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-US" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-US" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 14:45 /TR "`"$bat`" us --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-US"
Write-Host "US: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-USM" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-USM" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 17:00 /TR "`"$bat`" us-mid --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-USM"
Write-Host "USM: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-USC" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-USC" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:30 /TR "`"$bat`" us-close --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-USC"
Write-Host "USC: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-HourlyStatus" /F 2>$null
schtasks /Create /TN "HybridTurtle-HourlyStatus" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:00 /RI 60 /DU 13:00 /TR "`"$hs`" --scheduled" /RL HIGHEST /F
$task = Get-ScheduledTask -TaskName "HybridTurtle-HourlyStatus" -ErrorAction SilentlyContinue
if ($task) {
  $task.Settings.DisallowStartIfOnBatteries = $false
  $task.Settings.StopIfGoingOnBatteries = $false
  $task.Settings.IdleSettings.StopOnIdleEnd = $false
  $task.Settings.StartWhenAvailable = $true
  $task.Settings.ExecutionTimeLimit = "PT5M"
  Set-ScheduledTask -InputObject $task | Out-Null
}
Write-Host "Hourly: $LASTEXITCODE"
