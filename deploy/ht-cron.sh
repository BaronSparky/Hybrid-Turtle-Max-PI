#!/usr/bin/env bash
# HybridTurtle cron wrapper.
# Runs a single cron entry point with a clean environment and per-job logging.
# Usage: ht-cron.sh <job-name> [extra args...]
#   e.g. ht-cron.sh nightly --run-now
#        ht-cron.sh watchdog
#        ht-cron.sh midday-sync
set -uo pipefail

APP_DIR="${HT_APP_DIR:-/home/nigel/hybrid-turtle}"
cd "$APP_DIR" || { echo "cannot cd to $APP_DIR" >&2; exit 1; }

JOB="${1:?usage: ht-cron.sh <job> [args...]}"
shift || true

LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$JOB.log"

# Trim logs that grow past ~5 MB so the SD card stays happy.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

{
  echo "----- $(date '+%Y-%m-%d %H:%M:%S %Z') start $JOB $* -----"
  # NOTE: DB migrations are NOT run here. The systemd service applies them via
  # ExecStartPre on every (re)start/deploy, when no process holds the SQLite
  # lock. Running `prisma migrate` here would contend with the live server and
  # block for the busy-timeout on every job.
  ./node_modules/.bin/tsx "src/cron/$JOB.ts" "$@"
  code=$?
  echo "----- $(date '+%Y-%m-%d %H:%M:%S %Z') done $JOB (exit $code) -----"
} >> "$LOG" 2>&1
