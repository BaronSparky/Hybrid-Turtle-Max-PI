#requires -Version 5.1
<#
.SYNOPSIS
  Detects whether the current Next.js build is stale relative to source.

.DESCRIPTION
  Used by start.bat to decide whether to rebuild before launching the
  production server. Without this check, source edits silently fail to
  surface in the running app (this is the foot-gun that caused the
  2026-05-02 "portfolio shows 3 of 6" confusion: dev edited /api/positions
  to drop a source filter, but next start kept serving the morning's bundle).

.OUTPUTS
  Writes a single integer to stdout:
    0 = build is fresh (or comparison failed safely → assume fresh)
    N = N source files have been modified after .next\BUILD_ID

.NOTES
  - Compares against src/**/* and prisma/schema.prisma. Anything outside
    those paths (e.g. config files, package.json) is intentionally not
    monitored here; touching those should trigger a manual `npm run build`.
  - Returns 0 (not stale) if BUILD_ID is missing — start.bat already has
    a separate branch for that case.
#>

param()

$buildIdPath = Join-Path $PSScriptRoot '..\.next\BUILD_ID'
if (-not (Test-Path $buildIdPath)) {
    Write-Output 0
    exit 0
}

try {
    $buildTime = (Get-Item $buildIdPath).LastWriteTime
    $repoRoot  = (Get-Item (Join-Path $PSScriptRoot '..')).FullName
    $paths     = @(
        (Join-Path $repoRoot 'src'),
        (Join-Path $repoRoot 'prisma\schema.prisma')
    ) | Where-Object { Test-Path $_ }

    $newer = @(
        Get-ChildItem -Recurse -File -Path $paths -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -gt $buildTime }
    )
    Write-Output $newer.Count
} catch {
    # Fail safe: if anything goes wrong, claim the build is fresh so we
    # don't trigger an unwanted rebuild on every launch.
    Write-Output 0
}
