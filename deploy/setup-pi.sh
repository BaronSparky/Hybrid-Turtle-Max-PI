#!/usr/bin/env bash
# HybridTurtle-Max — first-time setup on the Raspberry Pi.
#
# Run this ONCE on the Pi, AFTER the first `deploy-to-pi.ps1` has copied the
# source + .next bundle into /home/nigel/hybrid-turtle.
#
#   ssh pi
#   cd ~/hybrid-turtle
#   bash deploy/setup-pi.sh
#
# It installs native deps, prepares the database, installs the systemd service
# (with a scoped passwordless restart rule for deploys), and loads the crontab.
set -euo pipefail

APP_DIR="${HT_APP_DIR:-$HOME/hybrid-turtle}"
SERVICE_NAME="hybridturtle"
USER_NAME="$(whoami)"

cd "$APP_DIR"

echo "=== 1/6  Checking .env ==="
if [ ! -f .env ]; then
  cat >&2 <<EOF
ERROR: $APP_DIR/.env is missing.
Copy your configured .env to the Pi first, e.g. from your PC:
  scp .env pi:$APP_DIR/.env
It must contain at least: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
and (for live trading) the Trading 212 keys + ENABLE_AUTO_TRADING.
EOF
  exit 1
fi
chmod 600 .env
echo "  .env present (permissions tightened to 600)."

echo "=== 2/6  Installing dependencies (npm ci, compiles better-sqlite3 for arm64) ==="
# Full install (NOT --omit=dev): tsx, prisma and better-sqlite3 are in
# devDependencies but the cron jobs and migrations need them at runtime.
# postinstall runs `prisma generate` automatically.
npm ci
sha256sum package-lock.json | awk '{print $1}' > .deploy-lock-hash

echo "=== 3/6  Preparing database ==="
npx prisma generate
node scripts/auto-migrate.mjs --quiet
# Seed only if the ticker table looks empty (safe no-op otherwise).
npm run db:seed || echo "  (seed skipped or already populated)"

echo "=== 4/6  Making cron wrapper executable ==="
chmod +x deploy/ht-cron.sh

echo "=== 5/6  Installing systemd service ==="
sudo cp deploy/hybridturtle.service /etc/systemd/system/${SERVICE_NAME}.service
# Scoped, passwordless restart so deploy-to-pi.ps1 can restart without a prompt.
echo "${USER_NAME} ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${SERVICE_NAME}, /usr/bin/systemctl status ${SERVICE_NAME}" \
  | sudo tee /etc/sudoers.d/hybridturtle-restart >/dev/null
sudo chmod 440 /etc/sudoers.d/hybridturtle-restart
sudo systemctl daemon-reload
sudo systemctl enable --now ${SERVICE_NAME}.service

echo "=== 6/6  Installing crontab ==="
crontab deploy/hybridturtle.crontab
echo "  Installed. Current crontab:"
crontab -l | grep -v '^#' | grep -v '^$' || true

echo
echo "=== Done ==="
echo "Service status:  sudo systemctl status ${SERVICE_NAME}"
echo "Live logs:       journalctl -u ${SERVICE_NAME} -f"
echo "Local health:    curl -s http://127.0.0.1:3000/api/heartbeat"
