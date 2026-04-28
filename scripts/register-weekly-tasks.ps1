# Register HybridTurtle weekly digest + Monday briefing in Windows Task Scheduler
# Run as Administrator

$root = "C:\Turtle-Hybrid\Hybrid-Trurtle-Max"

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

# Weekly Digest — Sunday 18:00
schtasks /Delete /TN "HybridTurtle-WeeklyDigest" /F 2>$null
schtasks /Create /TN "HybridTurtle-WeeklyDigest" /SC WEEKLY /D SUN /ST 18:00 /TR "`"$root\weekly-digest-task.bat`"" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-WeeklyDigest"
Write-Host "Weekly Digest: $LASTEXITCODE"

# Monday Briefing — Monday 07:30
schtasks /Delete /TN "HybridTurtle-MondayBriefing" /F 2>$null
schtasks /Create /TN "HybridTurtle-MondayBriefing" /SC WEEKLY /D MON /ST 07:30 /TR "`"$root\monday-briefing-task.bat`"" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-MondayBriefing"
Write-Host "Monday Briefing: $LASTEXITCODE"

# UK Pre-Session Briefing — Mon-Fri 08:00
schtasks /Delete /TN "HybridTurtle-UKBriefing" /F 2>$null
schtasks /Create /TN "HybridTurtle-UKBriefing" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:00 /TR "`"$root\uk-briefing-task.bat`"" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-UKBriefing"
Write-Host "UK Briefing: $LASTEXITCODE"

# US Pre-Session Briefing — Tue-Fri 14:30
schtasks /Delete /TN "HybridTurtle-USBriefing" /F 2>$null
schtasks /Create /TN "HybridTurtle-USBriefing" /SC WEEKLY /D TUE,WED,THU,FRI /ST 14:30 /TR "`"$root\us-briefing-task.bat`"" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-USBriefing"
Write-Host "US Briefing: $LASTEXITCODE"

# Ticker Audit — 1st of each month at 06:00 (before market open)
schtasks /Delete /TN "HybridTurtle-TickerAudit" /F 2>$null
schtasks /Create /TN "HybridTurtle-TickerAudit" /SC MONTHLY /D 1 /ST 06:00 /TR "`"$root\ticker-audit-task.bat`" --scheduled" /RL HIGHEST /F
Set-TaskResilient "HybridTurtle-TickerAudit"
Write-Host "Ticker Audit: $LASTEXITCODE"

Write-Host ""
Write-Host "Done. Verify with: schtasks /Query /TN HybridTurtle-WeeklyDigest"
Write-Host "                    schtasks /Query /TN HybridTurtle-MondayBriefing"
Write-Host "                    schtasks /Query /TN HybridTurtle-USBriefing"
Write-Host "                    schtasks /Query /TN HybridTurtle-TickerAudit"
