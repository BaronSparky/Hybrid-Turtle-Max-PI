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
### 2026-05-18 — pending — ORACLE AUDIT remediation: F-3 trailing-stop level preservation

- File(s):
  - `src/lib/stop-manager.ts` — `generateTrailingStopRecommendations` return type adds `recommendedLevel: ProtectionLevel`. New `levelOrder` array + `TRAILING_ATR_IDX` constant; `recommendedLevel = currentIdx >= TRAILING_ATR_IDX ? currentLevel : 'TRAILING_ATR'`. Reads `position.protectionLevel as ProtectionLevel`.
  - `src/cron/nightly.ts` — Step 3b consumer: passes `rec.recommendedLevel` to `updateStopLoss` and `trailingStopChanges.push({ ...level: rec.recommendedLevel })`.
  - (Non-sacred) `src/lib/candidate-grade.ts` + tests, `src/lib/position-sync.ts`, `DASHBOARD-GUIDE.md` — F-1, F-2, F-4 from same audit; logged here for cross-reference only.
- Why (ORACLE AUDIT 2026-05-18, finding F-3, severity LOW): nightly trailing-step routinely downgraded the displayed protection-level label from `LOCK_08R` / `LOCK_1R_TRAIL` back to `TRAILING_ATR` because `updateStopLoss` was called with a hard-coded `'TRAILING_ATR'` arg. The stop *value* was correct (monotonic invariant held), but the displayed level mis-represented the position's protection state on dashboards and in alerts. Operator-facing only; no risk to capital.
- Behaviour preserved:
  - Monotonic stop invariant unchanged. Stop value still computed by existing `calculateTrailingATRStop`.
  - All decision branches in `generateTrailingStopRecommendations` produce the same `recommendedStop`, `currentStop`, `change`, `changePct` as before.
  - Positions at `INITIAL` or `BREAKEVEN` still upgrade to `TRAILING_ATR` on trailing-step (`currentIdx < TRAILING_ATR_IDX`).
  - Positions already at `LOCK_08R` / `LOCK_1R_TRAIL` keep that label (was: silently downgraded).
  - No call-site outside `nightly.ts` Step 3b is affected.
- Tests: `src/lib/stop-manager.test.ts` and `src/lib/candidate-grade.test.ts` full suites pass (83 tests). Targeted vitest run on position-sync + auto-trade + auto-trade-stop-retry (55 tests) also clean. `npx tsc --noEmit` clean.
- Author: ORACLE AUDIT remediation agent (2026-05-18)

### 2026-05-17 — pending — ORACLE SYSTEM AUDIT remediation: all 8 findings (H-1..4, M-1..4)

- File(s):
  - `src/cron/auto-trade.ts` — H-3 `effectiveStopForFill()` helper + Phase C stop-tightening; H-4 `positionsForGates` uses `gbpPrice * shares` not `entryPrice * fxRatio * shares`; M-3 `realisedGateFootprint()` helper + post-fill push uses realised fill state; M-4 extended retry tier (15s/45s/90s at widest factor) after immediate widen loop, skipped on terminal 401/403.
  - `src/cron/nightly.ts` — H-1 pyramid auto-exec calls `validateRiskGates` with GBP-normalised snapshot (fail-closed, 7-day PYRAMID_ADD alert throttle); H-2 pyramid polls `getOrder` 12×5s (404 fallback to `getPositions`) before DB write, cancel-on-timeout; H-4 pyramid snapshot uses `gbpPrice * shares`; M-1 drift auto-correct gated behind `ENABLE_DRIFT_AUTOCORRECT` env (default OFF), `DB > T212` emits CRITICAL `STOP_MISMATCH` alert with dashboard guidance (12h throttle).
  - `src/lib/scan-engine.ts` — H-4 concentration `value` = `currentPriceGbp * shares` (was `entryPriceGbp * shares`).
  - `src/lib/stop-manager.ts` — M-2 trailing-ATR price-divergence band 20%–500% fires throttled `STALE_MARKET_DATA` alert per ticker (24h dedupe); calc continues so monotonic stop still computed; >500% hard skip unchanged.
  - Tests: `src/lib/risk-gates.test.ts` (+3 H-1 tests), `src/cron/auto-trade-stop-retry.test.ts` (+6 H-3 tests, +7 M-3 tests).
- Why (ORACLE SYSTEM AUDIT 2026-05-17): system-level audit identified 4 HIGH findings (all on the theme of concentration safety eroding over time) and 4 MEDIUM findings (instrumentation + correctness at edges). Detail:
  - **H-1**: pyramid auto-exec in Step 6-auto of nightly bypassed `validateRiskGates`, allowing the size add to breach sleeve/cluster/sector caps if the position had grown materially since the original entry.
  - **H-2**: pyramid wrote DB on order submit, not on fill — broker rejection or partial fill produced phantom DB shares that the position-sizer + risk-gates used as "real" for subsequent calls.
  - **H-3**: gap-up fills inflated realised stop risk to `(filledPrice - plannedStop)`, which could be 2-3× the planned per-share risk the position-sizer was designed against. Worst-case after 3 widen retries ~2.6× planned.
  - **H-4**: concentration value used entry price × shares, so profitable positions silently freed sleeve/cluster headroom that didn't exist at market value.
  - **M-1**: drift detector auto-corrected `DB_HIGHER` by lowering DB stop to broker stop — silently rewriting the DB to the looser of two values, bypassing operator review.
  - **M-3**: after first trade fills, the next candidate's gate snapshot used planned `entryTrigger * planned shares` not realised fill — second trade through gates that the realised footprint would breach.
  - **M-4**: Phase C declared `UNPROTECTED_POSITION` after 3 widen attempts (~2 s total), missing transient T212 hiccups on the 30-90 s scale.
  - **M-2**: trailing-ATR only flagged >500% divergence as data corruption; smaller-scale (20–500%) divergence silently produced bad stops.
- Behaviour preserved:
  - Monotonic stop invariant (stops NEVER decrease) unchanged across all files.
  - Phase A/B/D structure unchanged. Existing buy-failure / fill-timeout / DB-failure / terminal-error / kill-switch / regime-gate / ISA-routing paths byte-identical.
  - Position-sizer, dual-score, regime-detector, risk-gates math unchanged. (`risk-gates.ts` not modified.)
  - First widen attempt (factor 1.0) still uses the original stop exactly for well-formed requests.
  - Pyramid first-time-gate: when `validateRiskGates` returns 0 violations and the existing fill/cancel paths are clean, the new code path is byte-identical to the previous one apart from the (correctly) raised stop on gap-up fills.
  - Drift-detector behaviour byte-identical when operator sets `ENABLE_DRIFT_AUTOCORRECT=true`.
  - Trailing-ATR >500% skip behaviour byte-identical; new alert is fire-and-forget so calc never blocks on alert delivery.
- Tests:
  - +3 new tests for H-1 in `risk-gates.test.ts` (sleeve breach, position-size breach, allow-when-within-caps).
  - +6 new tests for H-3 in `auto-trade-stop-retry.test.ts` (`effectiveStopForFill()` contract + worst-case widen).
  - +7 new tests for M-3 in `auto-trade-stop-retry.test.ts` (`realisedGateFootprint()` contract: filledPrice/shares/stopPrice usage, FX conversion, fallback, risk-floor, gap-up regression).
  - Full vitest suite: **118 files / 1697 tests all pass** (was 1690 + 7 new).
  - `npx tsc --noEmit` clean.
- Operator-visible behaviour change: `ENABLE_DRIFT_AUTOCORRECT=true` env var is now required to keep the old M-1 auto-correct behaviour. Default is OFF — first nightly will surface any pre-existing `DB > T212` drift as a CRITICAL `STOP_MISMATCH` alert instead of silently rewriting the DB.
- Author: ORACLE SYSTEM AUDIT remediation agent (2026-05-17)

### 2026-05-16 — pending — auto-trade.ts: H4 stop-retry-widen + M1 heartbeat.kind stamping

- File(s): `src/cron/auto-trade.ts` (Phase C of `executeTrade`, Phase D `actualStopPrice` propagation, 8 heartbeat sites, top-of-file helpers); supporting test `src/cron/auto-trade-stop-retry.test.ts` (new).
- Why (audit 2026-05-16): Two findings landed in the same sacred file, so they are bundled into one edit:
  - **H4 (HIGH)** — single-attempt stop placement left positions UNPROTECTED on any T212 error. A transient 5xx or price-too-close 400 on the first try meant a live long position with no stop until manual intervention. The catch path raised a CRITICAL alert but did not retry.
  - **M1 (MEDIUM)** — the watchdog and midday-sync drift detector matched heartbeats by `details.contains(...)` JSON-string search, which is brittle and (per the H2 fix in Stage 1) was masking a missed nightly when a midday-OK heartbeat coincidentally matched. The structural fix is a `kind` discriminator column on Heartbeat; this sacred edit stamps `kind: 'AUTO_TRADE'` on the 8 heartbeat writes in this file.
- Fix:
  1. **H4 retry-widen loop**: Phase C of `executeTrade` now attempts stop placement up to 3 times with progressively wider stops (factors `1.0, 1.33, 1.67` applied to the entry-stop gap). Each attempt is logged via `logExecution(STOP_FAILED ...)` with the attempt number and widen factor. 401/403 (terminal auth/permission) short-circuit the loop. A 500 ms delay separates attempts. The variable `actualStopPrice` tracks the price that succeeded and is used for the DB Position write (`stopLoss`, `currentStop`, `initial_stop`, `initialRisk`), the TradeLog write (`initialStop`, `initialR`), the `COMPLETE` execution log, and the `TradeResult` return value — so the DB matches what is live at the broker, not the originally-requested price. After all retries fail, the existing UNPROTECTED_POSITION alert path runs unchanged.
  2. **M1 kind stamping**: added `kind: 'AUTO_TRADE'` to every `prisma.heartbeat.create` in this file (8 sites: weekend skip, market-holiday skip, early-close skip, kill-switch skip, operating-mode skip, regime-block, scan-session done, final summary). Schema migration `20260516120000_add_heartbeat_kind` adds the nullable column and an index.
  3. **Helpers extracted to top-of-file**: `STOP_RETRY_WIDEN_FACTORS`, `STOP_RETRY_DELAY_MS`, `STOP_TERMINAL_STATUS_CODES`, and the pure `widenStop(filledPrice, originalStop, factor)` function. All exported so the contract is locked down by the new test file.
- Behaviour preserved:
  - Phase A (market buy) and Phase B (fill polling) are unchanged.
  - Buy-failure / fill-timeout / DB-failure paths are unchanged.
  - The CRITICAL UNPROTECTED_POSITION alert + Telegram notification still fires when all 3 stop attempts fail (`stopPlaced === false && success === true`).
  - First attempt uses the original `stopPrice` exactly (factor `1.0`) — for a well-formed stop request, behaviour is byte-identical to the previous single-attempt path.
  - All 8 gate paths still return early after writing their heartbeat; nothing in the gating logic changed.
  - Auto-trade kill switch (Gate 2), regime gate (Gate 4), health gate (Gate 5), per-session attempt cap, terminal-error abort, and ISA-routing rule from prior incidents (2026-04-30) are unchanged.
  - Position-sizer, scan-engine, dual-score, regime-detector, stop-manager, risk-gates are not touched.
- Tests:
  - New `src/cron/auto-trade-stop-retry.test.ts` — 11 tests covering `widenStop()` math, factor monotonicity, three-attempt cap, retry-delay non-zero, terminal-status-code set.
  - Existing 22 auto-trade.test.ts contract tests still pass (they test TradeResult shape, not the loop body, so are unaffected).
  - Heartbeat readers in watchdog.ts and midday-sync.ts already migrated in the same audit batch to filter by `kind: 'NIGHTLY'` / `kind: 'MIDDAY_SYNC'`; auto-trade heartbeats are not queried by those readers.
- Author: ORACLE AUDIT remediation agent (2026-05-16)

### 2026-05-01 — pending — auto-trade.ts: persist t212Ticker on Position.create

- File(s): `src/cron/auto-trade.ts` (only the `tx.position.create` call inside Phase D)
- Why (incident report): Today's hourly status report read "Positions: 9/4" with UNFI, GOOGL, and PWR each appearing twice. Auto-trade had created the rows correctly with the right entry-stop `initialRisk` math but left `t212Ticker = null`. The follow-up `/api/trading212/sync` then queried existing positions filtered by `source: 'trading212'`, missed the auto-trade rows, and re-created them as fresh trading212 rows — this time with `t212Ticker` set and `initialRisk` defaulted to 5% of entry. Result: every auto-traded ticker became two OPEN rows, the max-positions blocker tripped, and the dashboard showed 9/4 against 6 real T212 holdings.
- Fix: pass `t212Ticker: t212Ticker` (the value already destructured from `candidate`) into the Position.create payload. The follow-up broker sync now resolves these rows by their full T212 ticker on the next run instead of treating them as missing.
- Behaviour preserved: Order placement, fill detection, stop placement, regime gate, kill switch, attempt cap, terminal error abort, ISA/Invest routing, position sizing, FX, and TradeLog writes are all unchanged. The only schema-touching change is one additional non-null field on the new Position row — and the value is one already in scope from the candidate.
- Tests: 22/22 existing auto-trade unit tests pass. New 15-test regression suite for the broker-sync merge logic (`src/lib/trading212-sync-merge.test.ts`) directly covers the matching path that failed: full T212 ticker primary key, bare-ticker fallback for null-t212Ticker rows, cross-account guard, close-detection. Plus a new A4 health check + 6 unit tests in `src/lib/health-check.test.ts` that fires RED whenever two OPEN rows share `(stockId, accountType)` so the next occurrence is caught within an hour rather than waiting for a Telegram report. Full suite: 109 files, 1565 tests pass.
- Author: RPI Agent (incident response, 2026-05-01)

### 2026-04-30 — pending — auto-trade.ts: CRITICAL — attempt cap + terminal error abort + revert routing

- File(s): `src/cron/auto-trade.ts`
- Why (incident report): At 21:35 BST a manual `us-close` re-run was triggered. The market was closed, so T212 queued buy orders without filling; `executeTrade` returned `result.success = false` for every candidate due to the polling timeout. The previous loop only incremented `tradesExecuted` on success, so `MAX_TRADES_PER_SESSION = 2` was never reached and the loop drained the entire ready list, placing real T212 buy orders on each candidate (3 orders accepted: GOOGL, PWR, UNFI; many more rejected by T212 with `i-s-a-ineligible-instrument` and `insufficient-free-for-stocks-buy`). The previous routing change "let T212 reject anything truly ineligible" — that turned out to mean burning a real order placement before the rejection, which is unsafe.
- Fixes (three layered safety guards):
  1. **Attempt cap**: introduced `tradesAttempted` counter; cap is now applied to ATTEMPTS, not just SUCCESSES. The loop cannot exceed `MAX_TRADES_PER_SESSION` order placements regardless of fill outcomes.
  2. **Terminal error abort**: introduced `TERMINAL_ERROR_PATTERNS` (insufficient funds, kill switch, account suspended). On match, `sessionAbortReason` is set and all subsequent candidates are marked skipped without an attempt.
  3. **Routing reverted to safe rule**: only route to ISA when stock is EXPLICITLY tagged `isaEligible=true` (null and false both → Invest). The previous "ISA-only user → ISA for everything" routing was too permissive and produced T212 ineligible-instrument rejections. The currency advisory log was removed (no longer relevant under strict routing).
- Behaviour preserved: `executeTrade` is unchanged. Stop placement, position sizing, regime gates, kill switch, monotonic stop rule, FX handling, risk gates, A-grade filtering, and Telegram notifications are all identical. The only behaviour changes are the three safety guards above plus the routing tightening.
- Tests: 22/22 auto-trade unit tests pass. Manual incident verified: with attempt cap, the same scenario would have produced exactly 2 attempts (1 success + 1 fill-timeout, then session ends). With terminal error abort, the insufficient-funds pattern from the same incident would have aborted after the first such error. Audit entry follows the rule: "supersede with a new entry that explains the change in understanding" — the prior entry's "let T212 reject" assumption is now superseded.
- Author: PR Review agent (incident response, 2026-04-30 21:35 BST)

### 2026-04-30 — 6d7fe1d — auto-trade.ts: smarter ISA-only routing + currency mismatch advisory

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
