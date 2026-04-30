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

### 2026-04-30 — pending — auto-trade.ts: skip candidates whose T212 account isn't connected (don't error)

- File(s): `src/cron/auto-trade.ts`
- Why: When the user has only an ISA account connected (no Invest), `getAccountTypeForStock` still routed non-ISA-eligible US stocks (e.g. GOOGL, PWR, IRM, CAT, HASI, FDX) and untagged ETFs (VUSA, EIMI) to Invest. `getT212Client('invest')` then threw "Trading 212 Invest account not connected", producing 8 noisy per-candidate Telegram failures and 8 execution-log writes per session. This is a configuration mismatch, not a trade failure.
- Behaviour preserved: Routing rules unchanged for connected accounts (ISA-eligible CORE → ISA; everything else → Invest). T212 client construction, order placement, polling, fill detection, stop-loss placement, position creation, risk gates, kill switch, regime checks, and Trade Notifications for actual trades are all untouched. Only the routing function's return type changed: `T212AccountType` → `T212AccountType | null`. The single caller in `runSession` now handles `null` by adding to `skipped[]` (same shape used for "Zero shares after sizing", "No T212 ticker mapped", etc.) instead of calling `executeTrade` which would throw.
- Tests: Full suite 108 test files pass (no new tests added — change is defensive and the existing trade-result/skip-result assertions remain valid). Manual trace: ISA-only user with US-only candidates now reports `Trades: 0 executed, 0 failed, 8 skipped (T212 account not connected for this stock)` instead of `0 executed, 8 failed`.
- Author: PR Review agent (live diagnosis from 30/04/2026 US Near-Close session)

### 2026-04-30 — pending — auto-trade.ts: per-candidate dual-score lookup

- File(s): `src/cron/auto-trade.ts`
- Why: Auto-trade's `classifyCandidate` call was passing a shared `GradingContext` with no `ncs/fws/bqs`. The grader defaults missing scores to worst case (NCS=0, FWS=100, BQS=0), so every candidate failed the A_GRADE_BUY thresholds. Result: 0 A-grades across 8,402 historical ScanResult rows; every auto-trade run produced `eligible: 0` and zero trades. Fix wires the existing dual-score data (already produced nightly into ScoreBreakdown) through to grading per candidate via the new `getLatestScoresByTicker` helper.
- Behaviour preserved: Risk gates, regime checks, health checks, Trading212 order placement, ISA/Invest routing, kill switch, throttled alerts, and the entry/exit logic are all unchanged. Only the input to `classifyCandidate` was upgraded — ncs/fws/bqs are now per-candidate instead of always-null. A_GRADE_BUY filtering and ranking logic downstream is untouched.
- Tests: 39/39 candidate-grade + score-lookup tests pass (2 new tests cover the resolver). Full suite 1540/1540. No `auto-trade.test.ts` changes were required because the call signature is preserved (still `classifyCandidate(c, ctx)`).
- Author: RPI agent (Phase 3 implementation)

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
