# Sacred File Change Log

Per `CLAUDE.md`, edits to risk-sensitive files must be logged here for cross-session audit.

**Sacred files** (any modification requires an entry below):

- `src/lib/stop-manager.ts` (or `packages/stops/`)
- `src/lib/position-sizer.ts` (or `packages/portfolio/`)
- `src/lib/risk-gates.ts` (or `packages/risk/`)
- `src/lib/regime-detector.ts` (or `packages/data/`)
- `src/lib/dual-score.ts` (or `packages/signals/`)
- `src/lib/scan-engine.ts` (or `packages/signals/`)
- `src/cron/auto-trade.ts`
- Any file inside `packages/risk/`, `packages/stops/`, `packages/portfolio/`, `packages/signals/`

## Entry format

Each entry uses this shape (newest at top of the History section):

```
### YYYY-MM-DD — <commit short SHA> — <one-line summary>

- File(s): <relative paths>
- Why: <reason for the change>
- Behaviour preserved: <what must NOT change>
- Tests: <which tests were added/run>
- Author: <agent or person>
```

## History

### 2026-04-29 — 6bba3cf — auto-trade.ts: throttle failure-only Telegram alerts

- File(s): `src/cron/auto-trade.ts`
- Why: Repeated identical failures (kill-switch, mode-blocked, no-T212, scan-fail, fatal crash) were spamming Telegram. Migrated those four blocked-gate notifications and the fatal-crash catch to `sendThrottledTelegramAlert` with new `ALERT_CATEGORY` keys.
- Behaviour preserved: Order placement, gate logic, exit paths, briefings, and success notifications all unchanged. Only failure-path Telegram calls were wrapped; the underlying control flow is untouched.
- Tests: All existing `auto-trade.test.ts` cases still pass (1443/1443 total). No new tests required because the wrapping is purely additive.
- Author: RPI agent (Phase 3 implementation)

### 2026-04-28 — 1b0d9ed — execution-mode: weekday EXECUTION (was Tuesday-only)

- File(s): `src/lib/execution-mode.ts`, `src/types/index.ts` (`getCurrentWeeklyPhase`), `src/cron/auto-trade.ts` (gate read)
- Why: System was blocking buys on Mon/Wed–Fri and only allowing Tuesday. User required consistent buy capability throughout the week.
- Behaviour preserved: Sat/Sun stay PLANNING. Mon–Fri all return EXECUTION. Stop management, regime gates, and risk caps unchanged.
- Tests: `execution-mode.test.ts` weekday matrix expanded; auto-trade integration tests still pass.
- Author: RPI agent (cycle 1)

<!-- Append new entries above this line. Never edit historical entries; supersede with a new entry that explains the change in understanding. -->
