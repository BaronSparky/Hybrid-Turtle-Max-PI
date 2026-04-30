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
### 2026-04-30 — pending — auto-trade.ts: smarter ISA-only routing + currency mismatch advisory

- File(s): `src/cron/auto-trade.ts` (only `getAccountTypeForStock` and the routing call site in `runSession`)
- Why: Old routing required `sleeve='CORE' AND isaEligible=true` to send a candidate to ISA. For an ISA-only user, this excluded GBP-listed ETFs and HIGH_RISK stocks — they fell through to Invest, hit the "Invest not connected" path, and were skipped. The new rule: when only ISA is connected, route everything (except explicit `isaEligible=false`) to ISA. T212 ISA accepts US shares (with FX) and UK-listed UCITS ETFs; let T212 reject anything truly ineligible. The dual-account case (both connected) is unchanged.
- Behaviour preserved: All risk gates, position sizing, regime checks, kill switch, stop placement, monotonic stop rule, position creation, FX handling, and order execution paths are untouched. The change is **routing-only** — `executeTrade` and downstream behaviour are identical. Currency-mismatch logging is **advisory only** (warn log) — no skip, no block.
- Tests: All 22 auto-trade unit tests pass. Full suite 108/108 test files pass. New helper test coverage isn't added because the change is to a private function with no exported surface; existing route-level tests cover the integration.
- Author: PR Review agent (T212 audit, ship-all batch)

### 2026-04-30 — pending — auto-trade.ts: relax t212ApiSecret requirement (legacy single-token auth)

- File(s): `src/cron/auto-trade.ts` (only `getT212Client`)
- Why: T212 docs show two auth modes — Basic `key:secret` AND legacy single-token `Authorization: <apiKey>`. Today T212 commonly issues a single token with no separate secret. The previous gate `!user.t212ApiSecret || !user.t212IsaApiSecret` blocked these users from connecting. `Trading212Client` constructor now treats an empty `apiSecret` as legacy auth and sends the key directly in the header.
- Behaviour preserved: All routing logic, regime gates, kill switch, stop placement, position creation, risk gates, currency handling, and ISA/Invest selection are untouched. Only the credential-validity check changed: secret is no longer required, key + connected flag still are. `decryptField(... ?? '')` is null-safe so missing secret in DB doesn't throw.
- Tests: trading212-dual updated (1 test renamed to focus on missing-key, 1 new test added asserting key-only legacy auth is accepted). Full T212 test suite 39/39 pass. positions/execute (24 tests) pass with the same relaxation applied.
- Author: PR Review agent (T212 audit, ship-all batch)
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
