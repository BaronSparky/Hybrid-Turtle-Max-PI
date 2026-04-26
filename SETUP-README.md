# HybridTurtle Trading Dashboard v6.0

A systematic trading dashboard built on the Turtle Trading methodology with modern risk management.

---

## Quick Start (Windows)

### First Time Setup

1. **Double-click `install.bat`**
   - It will check for Node.js (and help you install it if missing)
   - Installs all dependencies automatically
   - Sets up the local SQLite database
   - Seeds the stock universe (~600 tickers)
   - Creates a desktop shortcut

2. **That's it!** The installer will ask if you want to launch immediately.

### Daily Use

- **Double-click the "HybridTurtle Dashboard" shortcut** on your Desktop
- Or double-click `start.bat` in the project folder
- The dashboard opens at **http://localhost:3000**
- **Keep the black terminal window open** while using the dashboard
- Close the terminal window to stop the server

---

## What Each File Does

| File | Purpose |
|------|---------|
| `install.bat` | One-time setup — installs Node.js deps, database, desktop shortcut |
| `start.bat` | Daily launcher — starts the server and opens your browser |
| `run-dashboard.bat` | Compatibility alias — redirects to `start.bat` |
| `update.bat` | Run after getting new code — updates deps and database |
| `nightly-task.bat` | Run nightly automation checks (schedulable via Task Scheduler) |
| `watchdog-task.bat` | Check for missed nightly heartbeats, send Telegram alert |
| `register-nightly-task.bat` | Register nightly as a Windows Scheduled Task |
| `register-watchdog-task.bat` | Register watchdog as a Windows Scheduled Task (10:00 AM daily) |
| `auto-trade-task.bat` | Run automated trading for a session (scan/uk/us/us-close) |
| `register-auto-trade.bat` | Register all auto-trade + hourly status Scheduled Tasks |
| `hourly-status-task.bat` | Send Telegram status update (portfolio, blockers, candidates) |

---

## System Requirements

- **Windows 10 or 11**
- **Node.js 20 or 22 LTS** (choose the **LTS** tab on nodejs.org)
- **4 GB RAM** minimum
- **Internet connection** (for live market data from Yahoo Finance)

---

## Features

- **7-Stage Scan Engine** — Systematic screening from 268 stocks
- **Risk Management** — Position sizing, stop-loss tracking, sleeve caps
- **Live Market Data** — Real-time quotes via Yahoo Finance (no API key needed)
- **Portfolio Tracking** — Sync with Trading 212 or manage manually
- **Technical Charts** — Candlestick charts with RSI, MACD, Fibonacci levels
- **Weekly Phase System** — Planning → Observation → Execution → Maintenance

---

## Telegram Signal Messages (Optional)

Use this if you want nightly Telegram summaries/signals.

1. Create a Telegram bot with **@BotFather** (`/newbot`) and copy the bot token.
2. Send at least one message to the bot.
3. Get your chat ID from:
   - `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. In the app, open **Settings → Telegram Notifications** and test with **Send Test Message**.
5. Put these values in `.env`:
   - `TELEGRAM_BOT_TOKEN="..."`
   - `TELEGRAM_CHAT_ID="..."`
6. Restart with `start.bat`.
7. To automate nightly delivery, run `install.bat` and choose **Y** for the nightly Telegram task.

---

## Troubleshooting

### "Node.js not found"
Download and install from https://nodejs.org (choose the LTS version).
After installing, close and re-open the terminal, then try again.

### "npm install failed"
- Try running `install.bat` as Administrator (right-click → Run as administrator)
- Temporarily disable antivirus software
- Make sure you have internet access

### "Prisma engines do not seem to be compatible" / "not a valid Win32 application"
This means the Prisma database engine doesn't match your Node.js architecture. Usually caused by having 32-bit Node.js on a 64-bit machine.
1. Check your architecture: open a terminal and run `node -e "console.log(process.arch)"`
2. If it says `ia32` instead of `x64` — uninstall Node.js, then download and install the **64-bit (x64)** version from https://nodejs.org
3. Delete the `node_modules` folder and run `install.bat` again

If the architecture is already `x64`, the binary may be corrupted (e.g. antivirus quarantine). Delete `node_modules\.prisma`, then run `npx prisma generate`.

### "Port 3000 already in use"
The `start.bat` script handles this automatically. If it persists:
1. Open Task Manager (Ctrl+Shift+Esc)
2. Find any "Node.js" processes
3. End them
4. Try `start.bat` again

### Dashboard shows no data
1. Go to the **Scan** page
2. Click **Run Full Scan** — this fetches live data from Yahoo Finance
3. The first scan may take 2-3 minutes for all ~600 tickers

### Need to reset the database
Delete the file `prisma/dev.db` and run `install.bat` again.

### Trading 212 connection fails immediately / auth error
Trading 212 uses Basic Auth with base64 encoding, not a bearer token. Verify your API key and secret are correct and that you are using the right environment (Demo vs Live).

---

## For Developers

```bash
# Dev server with hot reload
npm run dev

# Build for production
npm run build && npm start

# Database management
npx prisma studio              # Visual database browser
npx prisma migrate deploy      # Apply pending schema migrations
npx prisma db seed             # Re-seed stock universe
```

---

*Built with Next.js 15, Prisma, TailwindCSS, and lightweight-charts.*

---

For complete end-user instructions (full system walkthrough), see `USER-GUIDE.md`.
