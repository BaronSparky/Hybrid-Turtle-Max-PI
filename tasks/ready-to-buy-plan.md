# Ready to Buy — Implementation Plan

> **Status:** PLAN ONLY — no code changes until approved  
> **Target page:** `/portfolio/positions`  
> **Insertion point:** Between `<StopUpdateQueue>` and `<PositionsTable>` in `positions/page.tsx`  
> **Sacred File changes:** NONE  

---

## 1. What It Does

A collapsible panel on the portfolio page showing **trigger-met candidates** — tickers whose latest close ≥ entry trigger from the most recent snapshot. Each candidate card shows scores, risk data, and a "Buy" button that opens a confirmation modal with position sizing, account selection, and safety gates.

The goal: when you open the portfolio page on execution day (Tuesday), you immediately see what's actionable, pre-sized, pre-scored, and gated — no need to cross-reference the plan page.

---

## 2. Data Source — No New API Routes

All data comes from existing endpoints. No new API routes needed.

| Data | Endpoint | Fields Used |
|------|----------|-------------|
| Trigger-met candidates + scores | `GET /api/scan/cross-ref` | `scanPrice`, `scanEntryTrigger`, `bqs`, `fws`, `ncs`, `dualScoreAction`, `scanStatus`, `sleeve`, `clusterName`, `superClusterName` |
| Risk budget | `GET /api/risk?userId=default-user` | `usedPositions`, `maxPositions`, `usedRiskPercent`, `maxRiskPercent` |
| Position creation | `POST /api/positions` | Already enforces all server-side gates (phase, regime, risk gates, health) |
| Live positions (for count) | Already fetched by parent page | `positions` state in `PositionsPage` |
| T212 credential status | `GET /api/settings?userId=default-user` | `t212Connected`, `t212IsaConnected` |

**Trigger-met detection:** Reuse the exact logic from `cross-ref/route.ts` line 365:
```typescript
const triggerMet = scanPrice != null && scanEntryTrigger != null && scanPrice >= scanEntryTrigger;
```

Filter the cross-ref results client-side to show only trigger-met candidates. No custom DB query or new API needed.

**Staleness guard:** The cross-ref endpoint returns `scanCachedAt`. Display age prominently. If snapshot is >48 hours old, show amber warning. If >7 days, show red warning with text "Snapshot stale — run a fresh scan before buying." This addresses the diagnostic finding that snapshot data can go stale (Feb 19 was 9 days old).

---

## 3. Files to Create

### 3a. `src/components/portfolio/ReadyToBuyPanel.tsx`
Main panel component.

**Props:**
```typescript
interface ReadyToBuyPanelProps {
  currentPositionCount: number;  // From parent's positions state
  onPositionCreated: () => void; // Callback to refresh positions table
}
```

**Behaviour:**
- Fetches `/api/scan/cross-ref` and `/api/risk` on mount
- Filters cross-ref results to trigger-met only (`scanPrice >= scanEntryTrigger`)
- Sorts by NCS descending (best candidates first)
- Displays as a collapsible card with count badge: "Ready to Buy (3)"
- If no trigger-met candidates: collapsed, shows "No trigger-met candidates"
- If any candidates exist: auto-expanded on EXECUTION day, collapsed otherwise

**Per-candidate card displays:**
- Ticker, name, sleeve badge (CORE/HIGH_RISK)
- Current price vs entry trigger (with % above trigger)
- BQS / FWS / NCS scores with colour coding:
  - NCS ≥ 70 → green, 50-69 → amber, < 50 → red
  - FWS ≤ 30 → green, 31-50 → amber, > 50 → red
- Dual-score action badge: AUTO_YES (green), CONDITIONAL (amber), AUTO_NO (red)
- Cluster / super-cluster name (for awareness)
- Stop level from snapshot (entry_trigger - stop_level gives initial risk)
- "Buy" button (or disabled state — see gates below)

**Cluster/correlation warnings:**
- If a candidate shares a `clusterName` with an existing open position → amber tag: "Same cluster as [EXISTING_TICKER]"
- If `clusterExposurePct` from snapshot > SMALL_ACCOUNT cap (25%) → red tag: "Cluster cap exceeded"
- Uses cluster data already in the cross-ref response (`clusterName`, `superClusterName`, `clusterExposurePct`)

### 3b. `src/components/portfolio/BuyConfirmationModal.tsx`
Confirmation modal opened by the "Buy" button.

**Props:**
```typescript
interface BuyConfirmationModalProps {
  candidate: TriggerMetCandidate; // Ticker data from cross-ref
  riskBudget: RiskBudgetData;
  onConfirm: (accountType: 'invest' | 'isa') => Promise<void>;
  onCancel: () => void;
  isOpen: boolean;
}
```

**Displays:**
- Ticker, name, sleeve
- Entry price (= current close from snapshot)
- Stop level (from snapshot)
- Initial risk per share
- **Position sizing** (calls `useRiskProfile().sizePosition(entryPrice, stopLevel)`)
  - Shares to buy (floored — displayed as integer or 2dp for fractional)
  - Total position value
  - Risk in £ terms
  - Risk as % of equity
- BQS / FWS / NCS scores
- Cluster warnings (repeated from card)
- **Risk budget summary**: "Using 2 of 4 position slots. Open risk: 4.2% of 10.0%"

**Account selection (ISA vs Invest):**
- Radio group: "Invest" / "ISA"
- Default: "Invest" (most common)
- Each option shows connection status badge:
  - Connected → green dot
  - Not connected → red dot + disabled radio
- If neither connected → both disabled, "Connect a Trading 212 account in Settings" message
- **Mismatch warning:** If candidate is a UK ticker (`.L` suffix) and user selects Invest → amber: "UK stocks are typically held in ISA for tax efficiency"
- **ISA allowance note:** If ISA selected → subtle info text: "Counts towards ISA allowance"
- The selected account type is passed through to `POST /api/positions` in the `accountType` field

**Confirm button:**
- Text: "Confirm Buy — [SHARES] shares of [TICKER] in [ACCOUNT]"
- Sends POST to `/api/positions` with:
  ```typescript
  {
    userId: 'default-user',
    stockId: candidate.stockId,  // or ticker for resolution
    entryPrice: candidate.scanPrice,
    stopLoss: candidate.stopLevel,
    shares: calculatedShares,
    accountType: selectedAccount,
    source: 'manual',
    bqsScore: candidate.bqs,
    fwsScore: candidate.fws,
    ncsScore: candidate.ncs,
    dualScoreAction: candidate.dualScoreAction,
    scanStatus: candidate.scanStatus,
  }
  ```
- The server-side POST handler already validates all risk gates, regime, health, and phase. If any gate fails, it returns an error message which the modal displays.
- On success: close modal, call `onPositionCreated()` to refresh the positions table and re-fetch candidates (removing the just-bought ticker)

### 3c. `src/lib/ready-to-buy.ts` (optional pure utility)
Small extraction of trigger-met filtering + staleness check logic. Keeps component clean.

```typescript
export function filterTriggerMet(crossRefTickers: CrossRefTicker[]): TriggerMetCandidate[]
export function getSnapshotAge(cachedAt: string | null): { hours: number; stale: boolean; critical: boolean }
export function getClusterWarnings(candidate: TriggerMetCandidate, openPositions: PositionData[]): string[]
```

### 3d. `src/lib/ready-to-buy.test.ts`
Vitest tests for the pure utility functions:
- `filterTriggerMet` — correctly filters price >= trigger, excludes nulls
- `getSnapshotAge` — correct staleness thresholds
- `getClusterWarnings` — detects shared clusters with open positions

---

## 4. Files to Modify

### 4a. `src/app/portfolio/positions/page.tsx`
- Import `ReadyToBuyPanel`
- Insert between `<StopUpdateQueue>` and the loading/empty/table block
- Pass `currentPositionCount={openPositions.length}` and `onPositionCreated={handleSyncComplete}` (reuses existing refresh logic)
- Use dynamic import to avoid adding to initial bundle:
  ```tsx
  import dynamic from 'next/dynamic';
  const ReadyToBuyPanel = dynamic(() => import('@/components/portfolio/ReadyToBuyPanel'), { ssr: false });
  ```

### 4b. `src/hooks/useWeeklyPhase.ts` (minor)
- No changes needed. The hook already exposes `phase`, `canPlaceNewTrades`, and `isObserveOnly`. The component will consume these directly.

---

## 5. Safety Gates — Day-of-Week Rules

The "Buy" button on each candidate card respects these rules:

| Day | Phase | Buy Button | Behaviour |
|-----|-------|-----------|-----------|
| Sunday | PLANNING | Disabled (grey) | Tooltip: "Planning day — review only" |
| **Monday–Friday** | **EXECUTION** | **Enabled (green)** | Full functionality when gates pass |
| Saturday | MAINTENANCE | Disabled (grey) | Tooltip: "Markets closed" |

**Implementation:** Uses `useWeeklyPhase()` hook. The phase check is UI-only guidance, and server-side entry handlers also enforce execution-mode blocking. This means:
- Monday to Friday execution is enforced through regime, risk, health, and anti-chase gates
- Sunday/Saturday disabled in UI only (server also blocks entries through execution mode)

**Buy button color logic:**
```typescript
const { phase, canPlaceNewTrades } = useWeeklyPhase();
const day = new Date().getDay();
const isWeekend = day === 0 || day === 6;

if (isWeekend) → disabled, grey, "Markets closed" / "Planning day"
if (canPlaceNewTrades) → enabled, green (weekday execution)
else → disabled, grey, "Execution gates not met"
```

---

## 6. Additional Safety Gates

Beyond day-of-week, the Buy button is also disabled when:

| Gate | Condition | Message |
|------|-----------|---------|
| Position cap reached | `currentPositionCount >= 4` (SMALL_ACCOUNT max) | "Maximum 4 positions reached" |
| Risk budget full | `usedRiskPercent >= maxRiskPercent` from `/api/risk` | "Risk budget exhausted (10.0%)" |
| AUTO_NO score | `candidate.dualScoreAction === 'AUTO_NO'` | Red badge. Button disabled: "Rejected by dual-score (FWS > 65)" |
| No T212 connected | Neither invest nor ISA credentials | "Connect Trading 212 in Settings" |
| Snapshot critically stale | Snapshot age > 7 days | "Snapshot too stale — run a fresh scan" |

**Important:** These are UI-side guards only for UX clarity. The server-side `POST /api/positions` enforces its own comprehensive gates (risk gates, regime, health, phase). The UI gates prevent the user from *trying* something that will be server-rejected, giving better error messages.

---

## 7. Visual Design

Follows existing TailwindCSS patterns from the codebase:

**Panel:**
- `card-surface` class (matches existing cards)
- Collapsible header with chevron icon + "Ready to Buy (N)" title
- Count badge: green if any candidates, muted if none
- Sticky staleness indicator in header: "Snapshot: 2h ago" (green) / "3 days ago" (amber) / "9 days ago" (red)

**Candidate cards:**
- Grid layout: 1 column on mobile, 2 on md, 3 on lg (matches plan page pattern)
- Each card: `bg-navy-800/50 border border-border rounded-lg p-4`
- Score pills inline (BQS/FWS/NCS) with colour coding
- Action badge (AUTO_YES/CONDITIONAL/AUTO_NO) top-right
- Cluster tag bottom (if warning exists)
- Buy button bottom-right

**Confirmation modal:**
- Pattern from existing `AddPositionModal.tsx` — same overlay, sizing, button styles
- Two-column layout: left = position details, right = sizing summary
- Account selector as radio buttons with connection status dots
- Confirm button full-width at bottom

---

## 8. Edge Cases

| Scenario | Handling |
|----------|----------|
| Cross-ref API fails | Show error card: "Could not load candidates — check scan data" |
| Risk API fails | Disable all Buy buttons, show "Risk data unavailable" |
| No snapshot exists | Show "No scan data available — run a scan from the Plan page" |
| Candidate already held | If ticker matches an open position → hide from Ready to Buy (already in portfolio) |
| Position creation fails server-side | Modal shows server error message (e.g., "Risk gate failed: total risk would exceed 10%") |
| Concurrent page users | Not applicable — single-user system |
| FX conversion | Position sizer handles FX internally — no additional logic needed |
| Fractional shares | `useRiskProfile().sizePosition()` uses `allowFractional: true` for T212 |

---

## 9. What This Does NOT Do

- **Does not place orders on Trading 212** — it creates a position record in the local DB. The user still manually places the order in T212. This is intentional (no automated execution).
- **Does not modify the scan engine** — consumes existing scan results only.
- **Does not touch any Sacred Files** — no changes to stop-manager, position-sizer, risk-gates, regime-detector, or dual-score.
- **Does not add new API routes** — everything comes from existing endpoints.
- **Does not replace the Plan page** — the Plan page remains the primary scan/analysis view. This is a portfolio-side "action panel" for execution day convenience.

---

## 10. Implementation Order

| Step | Files | Estimated Effort |
|------|-------|-----------------|
| 1 | Create `src/lib/ready-to-buy.ts` + tests | Small — pure functions |
| 2 | Create `src/components/portfolio/ReadyToBuyPanel.tsx` | Medium — main UI component |
| 3 | Create `src/components/portfolio/BuyConfirmationModal.tsx` | Medium — modal with sizing + account selection |
| 4 | Modify `src/app/portfolio/positions/page.tsx` | Small — import + insert component |
| 5 | Run tests + manual verification | Small |

**Total new files:** 4 (2 components, 1 utility, 1 test)  
**Total modified files:** 1 (positions page)  
**Sacred Files touched:** 0  

---

## 11. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Position sizer called with stale data | Medium | Staleness warnings + server-side re-validation on POST |
| Wrong account type selected | Medium | UK ticker → ISA hint, connection status shown, server has fallback mechanism (lessons.md) |
| User buys on observation day | Low | Double-gated: client disables button + server rejects POST |
| Stale snapshot shows false trigger-met | Medium | Prominent age indicator, 7-day hard warning |
| Bundle size increase | Low | Dynamic import keeps ReadyToBuyPanel out of initial bundle |

---

## 12. Test Plan

### Automated (Vitest)
- `filterTriggerMet()` — price >= trigger, price < trigger, null price, null trigger, empty array
- `getSnapshotAge()` — fresh (< 48h), stale (48h-7d), critical (> 7d), null input
- `getClusterWarnings()` — shared cluster, different cluster, missing cluster data

### Manual verification
- Open `/portfolio/positions` on each day of the week → confirm button state matches table in §5
- Open with 4 open positions → confirm Buy disabled with cap message
- Open with no T212 credentials → confirm Buy disabled with connect message
- Click Buy on a valid candidate → confirm modal shows correct sizing
- Toggle ISA/Invest → confirm connection status changes
- Select wrong account for UK stock → confirm mismatch warning appears
- Confirm buy → verify position appears in table, candidate disappears from panel
- Stale snapshot (> 7 days) → confirm red warning and Buy disabled

---

*Plan written: 26 Feb 2026*  
*Awaiting approval before implementation*
