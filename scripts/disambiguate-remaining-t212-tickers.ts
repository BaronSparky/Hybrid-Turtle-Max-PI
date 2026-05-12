/**
 * Hand-curated disambiguation of the 19 Stock rows whose `t212Ticker`
 * could not be safely repaired by the currency-mandatory matcher in
 * `scripts/repair-t212-tickers-from-instruments.ts`.
 *
 * Background — 11 May 2026 incident, follow-on cleanup
 * ───────────────────────────────────────────────────
 * After the cache-driven repair script ran, 19 invalid bare values
 * remained. Manual inspection (cross-referencing the cached T212
 * instruments against each Stock row's currency/region/sleeve)
 * classified them into three groups:
 *
 *   A — T212 does not list the instrument at all (or only via a
 *       wrong-currency US ADR). Action: null out `t212Ticker` and
 *       deactivate the Stock row so the scanner stops surfacing it.
 *
 *   B — iShares / L&G UCITS ETFs that trade on LSE in pence (GBX) but
 *       T212 reports their NAV currency (USD). The matcher correctly
 *       held back; here we explicitly map them to the `*l_EQ` LSE
 *       listing because we know (from ISIN match + LSE primary
 *       listing) that this is the correct instrument.
 *
 *   C — Genuine multi-listing cases where the matcher saw multiple
 *       EUR listings (e.g. AIR.PA on Paris vs XETRA). Here we pick the
 *       primary listing matching the Stock row's exchange suffix.
 *
 * Strategy
 * ────────
 * Apply a small explicit decision table. Idempotent: only updates rows
 * that still have an invalid value. Dry-run by default.
 *
 * Usage
 * ─────
 *   npx tsx scripts/disambiguate-remaining-t212-tickers.ts          # audit
 *   npx tsx scripts/disambiguate-remaining-t212-tickers.ts --apply  # write
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { isInvalidT212TickerFormat } from '../src/lib/t212-ticker-validator';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

type Action =
  | { kind: 'set'; t212Ticker: string }
  | { kind: 'null-and-deactivate' };

interface Decision {
  ticker: string;
  reason: string;
  action: Action;
}

// ── The decision table ────────────────────────────────────────────────
// Each entry annotated with WHY this is the right call. Keep this the
// only source of disambiguation — do not silently grow it; require a
// matching audit-script entry for any new case.

const DECISIONS: readonly Decision[] = [
  // ── Group A: T212 does not list the instrument in the right currency ──
  // Mostly Nordic and Italian listings T212's UK retail tier doesn't carry.
  // Two were already inactive (AHT.L, CATT.L); explicitly null them out
  // so the auto-trade sieve produces "No T212 ticker mapped" rather than
  // the louder "needs remap" signal.
  {
    ticker: 'AHT.L',
    reason: 'T212 only carries AHT_US_EQ (US ADR), not LSE listing; row already inactive',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'CATT.L',
    reason: 'No T212 listing for Catteneo; row already inactive',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'COLO-B.CO',
    reason: 'No T212 listing for Coloplast B (Copenhagen)',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'GMAB.CO',
    reason: 'T212 only carries GMAB_US_EQ (Genmab US ADR), not Copenhagen primary',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'EVO.ST',
    reason: "T212's 'EVO' shortName resolves to Evotec (US ADR), not Evolution AB (Stockholm)",
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'SINCH.ST',
    reason: 'No T212 listing for Sinch AB',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'DSV.CO',
    reason: "T212's 'DSV' shortName resolves to Discovery Silver (Canada), not DSV A/S (Copenhagen)",
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'NESTE.HE',
    reason: 'No T212 listing for Neste (Helsinki)',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'UCG',
    reason: 'No T212 listing for UniCredit (Milan)',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'CPG.L',
    reason: 'T212 only carries CPGl1_EQ in USD (not GBX); compass Group GBX listing not available',
    action: { kind: 'null-and-deactivate' },
  },
  {
    ticker: 'ROG',
    reason: 'T212 only carries ROG_US_EQ (US ADR), not Roche Swiss primary',
    action: { kind: 'null-and-deactivate' },
  },

  // ── Group B: iShares/L&G UCITS LSE ETFs with USD NAV ──
  // T212 reports `currencyCode=USD` because the fund's NAV is denominated
  // in USD, but the *l_EQ ticker is the LSE listing that trades in pence.
  // Verified by ISIN match. Matcher correctly held back; we override.
  {
    ticker: 'CNDX',
    reason: 'iShares NASDAQ 100 (Acc) IE00B53SZB19 — LSE listing, T212 reports NAV currency USD',
    action: { kind: 'set', t212Ticker: 'CNDXl_EQ' },
  },
  {
    ticker: 'IWMO',
    reason: 'iShares Edge MSCI World Momentum (Acc) — LSE listing, T212 reports NAV currency USD',
    action: { kind: 'set', t212Ticker: 'IWMOl_EQ' },
  },
  {
    ticker: 'WSML',
    reason: 'iShares MSCI World Small Cap (Acc) IE00BF4RFH31 — LSE listing, T212 reports NAV currency USD',
    action: { kind: 'set', t212Ticker: 'WSMLl_EQ' },
  },
  {
    ticker: 'EIMI',
    reason: 'iShares Core MSCI EM IMI (Acc) IE00BKM4GZ66 — LSE listing, T212 reports NAV currency USD',
    action: { kind: 'set', t212Ticker: 'EIMIl_EQ' },
  },
  {
    ticker: 'BTEE',
    reason: 'iShares Nasdaq US Biotechnology (Dist) — LSE listing under T212 ticker BTECl_EQ (T212 renamed)',
    action: { kind: 'set', t212Ticker: 'BTECl_EQ' },
  },
  {
    ticker: 'AIAI',
    reason: "L&G AI ETF IE00BK5BCD43 — LSE listing AIAIl_EQ (T212 reports USD NAV); ignore Frankfurt AIAIm_EQ",
    action: { kind: 'set', t212Ticker: 'AIAIl_EQ' },
  },

  // ── Group C: multi-listing where Stock row carries the exchange suffix ──
  {
    ticker: 'IWQU.L',
    reason:
      'iShares Edge MSCI World Quality Factor — LSE primary; pick LSE form IWQUl_EQ even though T212 reports USD NAV',
    action: { kind: 'set', t212Ticker: 'IWQUl_EQ' },
  },
  {
    ticker: 'AIR.PA',
    reason: 'Airbus — Stock row says .PA (Paris primary); pick AIRp_EQ (Paris EUR) over AIRd_EQ (XETRA EUR)',
    action: { kind: 'set', t212Ticker: 'AIRp_EQ' },
  },
];

async function main() {
  const mode = APPLY ? 'APPLY' : 'AUDIT';
  console.log(`[disambiguate-remaining-t212-tickers] mode=${mode}\n`);

  // Sanity: refuse to operate on rows whose t212Ticker is NOT currently
  // invalid (i.e. someone already fixed them). This keeps the script safe
  // to re-run after partial application or hand-edits.
  let updates = 0;
  let deactivations = 0;
  let skipped = 0;

  for (const decision of DECISIONS) {
    const stock = await prisma.stock.findUnique({
      where: { ticker: decision.ticker },
      select: { id: true, ticker: true, t212Ticker: true, active: true },
    });
    if (!stock) {
      console.log(`  SKIP ${decision.ticker}: not found in DB`);
      skipped++;
      continue;
    }
    if (!isInvalidT212TickerFormat(stock.t212Ticker)) {
      console.log(`  SKIP ${decision.ticker}: t212Ticker='${stock.t212Ticker ?? 'null'}' already valid/null`);
      skipped++;
      continue;
    }

    if (decision.action.kind === 'set') {
      console.log(
        `  ${APPLY ? 'UPDATE' : 'WOULD UPDATE'} ${decision.ticker.padEnd(12)} t212Ticker '${stock.t212Ticker}' → '${decision.action.t212Ticker}'`,
      );
      console.log(`      ↳ ${decision.reason}`);
      if (APPLY) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { t212Ticker: decision.action.t212Ticker },
        });
        updates++;
      }
    } else {
      console.log(
        `  ${APPLY ? 'NULL-AND-DEACTIVATE' : 'WOULD NULL+DEACTIVATE'} ${decision.ticker.padEnd(12)} t212Ticker '${stock.t212Ticker}' → null${stock.active ? ' (also setting active=false)' : ' (already inactive)'}`,
      );
      console.log(`      ↳ ${decision.reason}`);
      if (APPLY) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { t212Ticker: null, active: false },
        });
        deactivations++;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`  Decisions in table:   ${DECISIONS.length}`);
  console.log(`  ${APPLY ? 'Applied updates:      ' : 'Would update:         '} ${APPLY ? updates : DECISIONS.filter((d) => d.action.kind === 'set').length - skipped}`);
  console.log(`  ${APPLY ? 'Applied deactivates:  ' : 'Would deactivate:     '} ${APPLY ? deactivations : DECISIONS.filter((d) => d.action.kind === 'null-and-deactivate').length}`);
  console.log(`  Skipped (no-op):       ${skipped}`);

  if (!APPLY) {
    console.log('\nDry run — no changes written. Re-run with `--apply`.');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[disambiguate-remaining-t212-tickers] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
