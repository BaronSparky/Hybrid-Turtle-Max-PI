<#
.SYNOPSIS
  Build HybridTurtle on this PC and push the artifact to the Raspberry Pi.

.DESCRIPTION
  Keeps the Pi quiet and cool by running the heavy `next build` here, then
  copying the result over SSH. The Pi only installs native dependencies
  (better-sqlite3) when the lockfile changes, applies DB migrations, and
  restarts the service.

  NEVER overwrites the Pi's live database (prisma/dev.db*) or its .env.

.PARAMETER PiHost
  SSH host alias for the Pi (default: 'pi', from ~/.ssh/config).

.PARAMETER RemoteDir
  Target directory on the Pi (default: /home/nigel/hybrid-turtle).

.PARAMETER SkipBuild
  Push the existing .next without rebuilding.

.PARAMETER Deps
  Force `npm ci` on the Pi even if the lockfile is unchanged.

.EXAMPLE
  ./deploy/deploy-to-pi.ps1
  ./deploy/deploy-to-pi.ps1 -Deps
  ./deploy/deploy-to-pi.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
  [string]$PiHost = 'pi',
  [string]$RemoteDir = '/home/nigel/hybrid-turtle',
  [switch]$SkipBuild,
  [switch]$Deps
)

$ErrorActionPreference = 'Stop'

# Move to repo root (this script lives in deploy/)
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# --- 1. Verify connectivity ------------------------------------------------
Write-Step "Checking SSH connectivity to '$PiHost'"
$ping = ssh -o BatchMode=yes -o ConnectTimeout=10 $PiHost 'echo ok' 2>$null
if ($ping -ne 'ok') { throw "Cannot reach '$PiHost' over SSH (BatchMode). Check ~/.ssh/config and keys." }
Write-Host "Connected."

# --- 2. Build on the PC ----------------------------------------------------
if (-not $SkipBuild) {
  Write-Step "Building production bundle (npm run build)"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed. Aborting deploy." }
} else {
  Write-Host "Skipping build (using existing .next)."
}

# --- 3. Package the artifact (exclude DB, env, node_modules, caches) -------
Write-Step "Packaging artifact"
$bundle = Join-Path $env:TEMP 'ht-deploy.tgz'
if (Test-Path $bundle) { Remove-Item $bundle -Force }

# These paths are excluded so we never clobber Pi-side state or ship junk.
$excludes = @(
  '--exclude=./node_modules',
  '--exclude=./.git',
  '--exclude=./.next/cache',
  '--exclude=./.env',
  '--exclude=./prisma/dev.db',
  '--exclude=./prisma/dev.db-shm',
  '--exclude=./prisma/dev.db-wal',
  '--exclude=./prisma/backups',
  '--exclude=./prisma/cache',
  '--exclude=./logs',
  '--exclude=./*.log'
)
tar -cz $excludes -f $bundle .
if ($LASTEXITCODE -ne 0) { throw "tar packaging failed." }
$sizeMb = [math]::Round((Get-Item $bundle).Length / 1MB, 1)
Write-Host "Bundle: $sizeMb MB"

# --- 4. Copy to the Pi -----------------------------------------------------
Write-Step "Copying to $PiHost`:$RemoteDir"
ssh $PiHost "mkdir -p $RemoteDir"
scp $bundle "${PiHost}:/tmp/ht-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed." }
ssh $PiHost "tar -xzf /tmp/ht-deploy.tgz -C $RemoteDir && rm -f /tmp/ht-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "Remote extract failed." }
Remove-Item $bundle -Force
Write-Host "Extracted on Pi."

# Restore the execute bit on shell scripts. The bundle is tarred from the
# Windows working tree, which does not preserve the Unix +x bit, so the
# extracted copies arrive as 0664. Cron invokes deploy/ht-cron.sh by path,
# which requires +x — without this the wrapper fails with "Permission denied"
# and every scheduled job goes silently dark (no log, output discarded).
ssh $PiHost "chmod +x $RemoteDir/deploy/*.sh"
if ($LASTEXITCODE -ne 0) { throw "Failed to restore +x on deploy scripts." }
Write-Host "Restored +x on deploy/*.sh."

# --- 5. Install native deps only when the lockfile changed -----------------
Write-Step "Checking dependencies"
$localHash = (Get-FileHash package-lock.json -Algorithm SHA256).Hash.ToLower()
# On the first deploy the hash file won't exist, so ssh returns nothing (null).
$remoteHash = ([string](ssh $PiHost "cat $RemoteDir/.deploy-lock-hash 2>/dev/null")).Trim()
if ($Deps -or $localHash -ne $remoteHash) {
  # Full install (NOT --omit=dev): tsx, prisma and better-sqlite3 live in
  # devDependencies but are required at runtime by the cron jobs and migrations.
  Write-Host "Lockfile changed (or -Deps) — running npm ci on the Pi (compiles better-sqlite3 for arm64)..."
  ssh $PiHost "cd $RemoteDir && npm ci && echo $localHash > .deploy-lock-hash"
  if ($LASTEXITCODE -ne 0) { throw "Remote npm ci failed." }
} else {
  Write-Host "Dependencies unchanged — skipping npm ci."
}

# --- 6. Restart the service (migrations run in ExecStartPre) ----------------
# Do NOT migrate here: the live service holds the SQLite DB lock, so a
# standalone `prisma migrate`/auto-migrate fails with "database is locked".
# The systemd unit's ExecStartPre runs scripts/auto-migrate.mjs at restart,
# when the old process has released the lock and before the new one binds.
Write-Step "Restarting service (migrations run in ExecStartPre)"
ssh $PiHost "sudo systemctl restart hybridturtle"
if ($LASTEXITCODE -ne 0) { throw "Service restart failed." }

# --- 7. Health check -------------------------------------------------------
Write-Step "Verifying service health"
Start-Sleep -Seconds 4
$health = ssh $PiHost "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/heartbeat || echo 000"
if ($health -match '^2|^3') {
  Write-Host "`nDeploy complete — service healthy (HTTP $health)." -ForegroundColor Green
} else {
  Write-Warning "Service did not return healthy yet (HTTP $health). Check: ssh $PiHost 'journalctl -u hybridturtle -n 50'"
}
