# Deploying HybridTurtle-Max to the Raspberry Pi

Build on this PC, run on the Pi. The heavy `next build` happens here; the Pi
only installs native deps (when they change), applies DB migrations, and runs
`next start`. This keeps the Pi quiet and cool.

| File | Runs on | Purpose |
|------|---------|---------|
| `deploy-to-pi.ps1` | PC (PowerShell) | Build here, copy artifact to the Pi, restart the service |
| `setup-pi.sh` | Pi (once) | Install deps, prep DB, install service + crontab |
| `hybridturtle.service` | Pi | systemd unit — runs `next start` on 127.0.0.1:3000 |
| `hybridturtle.crontab` | Pi | Lean schedule (nightly, midday-sync, watchdog) |
| `ht-cron.sh` | Pi | Wrapper each cron job runs through (migrate + tsx + logging) |

The Pi target is `nigel@bridportpi` (SSH alias `pi`), Node v20.20.2 at
`/usr/bin/node`, timezone Europe/London, app dir `/home/nigel/hybrid-turtle`.

---

## What gets copied (and what never does)

The deploy bundle **includes** source, `.next`, `prisma/` (schema + migrations),
`public`, `Planning`, `scripts`, `packages`, and the package/lock files.

It **excludes** (never overwritten on the Pi):

- `node_modules` — rebuilt on the Pi for arm64
- `.env` — the Pi keeps its own secrets
- `prisma/dev.db*` — the Pi's **live database** is never clobbered
- `prisma/backups`, `.next/cache`, `logs`, `.git`

> Note: `tsx`, `prisma`, and `better-sqlite3` are in `devDependencies` but are
> needed at runtime (cron + migrations), so the Pi runs a **full `npm ci`**, not
> `--omit=dev`.

---

## First-time setup

**1. Configure the Pi's `.env`** (one time). From this PC:

```powershell
scp .env pi:/home/nigel/hybrid-turtle/.env
```

For notify-only mode leave `ENABLE_AUTO_TRADING` unset/false. For live trading,
set `ENABLE_AUTO_TRADING=true` and the Trading 212 keys, then enable the
auto-trade cron lines (see crontab).

**2. Push the first build** from this PC:

```powershell
./deploy/deploy-to-pi.ps1 -Deps
```

This builds, copies, and will try to restart a service that doesn't exist yet —
that's fine, the next step installs it.

**3. Run setup on the Pi** (one time):

```powershell
ssh pi "cd ~/hybrid-turtle && bash deploy/setup-pi.sh"
```

This installs deps, prepares the DB (migrate + seed), installs the systemd
service with a scoped passwordless restart rule, and loads the crontab.

**4. Verify:**

```powershell
ssh pi "systemctl status hybridturtle --no-pager; curl -s http://127.0.0.1:3000/api/heartbeat"
```

---

## Routine deploys

After that, every update is one command from this PC:

```powershell
./deploy/deploy-to-pi.ps1            # build + copy + migrate + restart
./deploy/deploy-to-pi.ps1 -SkipBuild # push existing .next without rebuilding
./deploy/deploy-to-pi.ps1 -Deps      # force npm ci (after changing dependencies)
```

`npm ci` only runs when `package-lock.json` changed (tracked via
`.deploy-lock-hash` on the Pi), so most deploys are just a fast file copy +
restart.

---

## Operating it

- **Service:** `systemctl status hybridturtle` · `journalctl -u hybridturtle -f`
- **Restart:** `sudo systemctl restart hybridturtle`
- **Cron schedule:** `crontab -l`
- **Job logs:** `~/hybrid-turtle/logs/<job>.log` (e.g. `nightly.log`)
- **Health:** `curl -s http://127.0.0.1:3000/api/heartbeat`

### Scheduled jobs (Europe/London local time)

| Job | When | Notes |
|-----|------|-------|
| `watchdog` | 10:05 weekdays | Alerts if the nightly heartbeat is missing |
| `midday-sync` | 13:00 weekdays | Price refresh + intraday stop-out detection |
| `nightly` | 21:30 weekdays | Main run: scan, regrade, manage stops, daily report |

Optional jobs (weekly digest, briefings, research refresh) and the auto-trade
sessions are present but commented out in `hybridturtle.crontab`. Auto-trade
places **real** Trading 212 orders — only enable it after setting
`ENABLE_AUTO_TRADING=true`.

---

## Keeping the Pi calm

The service runs with `Nice=10`, `CPUWeight=50`, and `MemoryMax=1500M`, and the
schedule is deliberately sparse to minimise wake-ups. Cron job logs self-trim at
~5 MB. The heaviest work (`next build`) never runs on the Pi.

## Remote dashboard access (optional)

The service binds `127.0.0.1` only, so the dashboard is reachable on the Pi
itself (which is all the PIroot kiosk panel needs). To view it from your PC,
either:

- SSH tunnel: `ssh -L 3000:127.0.0.1:3000 pi`, then open `http://localhost:3000`, or
- Put a reverse proxy (Caddy/nginx) in front and change `-H 127.0.0.1` if you
  want LAN exposure (add auth first).
