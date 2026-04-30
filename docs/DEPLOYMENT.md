# HybridTurtle Deployment

## Phase 13 Scope

Phase 13 packages the current runtime, adds CI, and documents stable startup commands.

Important constraint: the checked-in Prisma schema is still SQLite-backed. The stable deployment path in this workspace therefore uses the existing SQLite database file. A Postgres service is included in Docker Compose as a migration scaffold, not as the active database for the current app image.

## Local Mode

### Prerequisites

- Docker Desktop
- A populated `.env` file

### Stable app runtime

```bash
docker compose up --build app
```

This starts the Next.js app on `http://localhost:3000` and persists the SQLite database through the mounted `prisma` directory.

### App + optional model service

```bash
docker compose --profile model up --build
```

The optional model service listens on `http://localhost:8000` and exposes `/healthz` and `/versions` for deployment checks.

### Postgres scaffold

```bash
docker compose --profile postgres up -d postgres
```

Use this only for future migration work. The current application container is not yet switched to a Postgres Prisma provider.

## Cloud Mode

### Recommended topology

- Linux VM or VPS
- Reverse proxy such as Caddy or Nginx for HTTPS
- One app process running `npm run start`
- Scheduled jobs triggered by Task Scheduler equivalents, cron, or systemd timers
- External Postgres only after the Prisma provider migration is completed

### Baseline commands

```bash
npm ci
npm run db:generate
npm run db:auto-migrate
npm run build
npm run start
```

### Reverse proxy notes

- Terminate TLS at the proxy
- Forward traffic to `localhost:3000`
- Keep `NEXTAUTH_URL` aligned with the public HTTPS origin

### Scheduled jobs

- Nightly run: call the existing nightly script or schedule the current nightly route workflow used by this workspace
- Broker/data refresh: keep existing scheduler scripts as separate supervised jobs
- Watchdog: retain the daily heartbeat check if Telegram alerts are enabled

Windows Task Scheduler audit and repair steps are documented in [SCHEDULER-AUDIT.md](SCHEDULER-AUDIT.md).

## CI

The Phase 13 CI workflow runs:

```bash
npm run test:unit
npm run build
```

## Manual Verification

```bash
npm run test:unit
npm run build
```

If `npm run build` fails after future changes, treat it as a hardening blocker before relying on the container image.