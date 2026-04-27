$bat = "C:\Turtle-Hybrid\Hybrid-Trurtle-Max\auto-trade-task.bat"
$hs  = "C:\Turtle-Hybrid\Hybrid-Trurtle-Max\hourly-status-task.bat"

# Helper: make a task resilient (run on battery, don't stop on idle, catch up if missed)
function Set-TaskResilient($name) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) {
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $task.Settings.IdleSettings.StopOnIdleEnd = $false
    $task.Settings.StartWhenAvailable = $true
    $task.Settings.ExecutionTimeLimit = "PT10M"
    Set-ScheduledTask -InputObject $task | Out-Null
  }
}

schtasks /Delete /TN "HybridTurtle-Scan" /F 2>$null
schtasks /Create /TN "HybridTurtle-Scan" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:00 /TR "`"$bat`" scan --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Scan"
Write-Host "Scan: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-UK" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-UK" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:15 /TR "`"$bat`" uk --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-UK"
Write-Host "UK: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-US" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-US" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 14:45 /TR "`"$bat`" us --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-US"
Write-Host "US: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-Trade-USC" /F 2>$null
schtasks /Create /TN "HybridTurtle-Trade-USC" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:30 /TR "`"$bat`" us-close --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-Trade-USC"
Write-Host "USC: $LASTEXITCODE"

schtasks /Delete /TN "HybridTurtle-HourlyStatus" /F 2>$null
schtasks /Create /TN "HybridTurtle-HourlyStatus" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:00 /RI 60 /DU 13:00 /TR "`"$hs`" --scheduled" /RL HIGHEST /F
# Make hourly status resilient — run on battery, don't stop on idle, start if missed
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

"DONE" | Out-File "C:\Turtle-Hybrid\Hybrid-Trurtle-Max\auto-trade-result.txt"
