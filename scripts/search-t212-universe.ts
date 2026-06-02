import 'dotenv/config';
import { loadT212InstrumentsCache } from '../src/lib/t212-instruments-cache';

/** Read-only: broad search of the T212 universe for any instrument whose
 *  ticker, shortName, or name mentions a search term. Used to confirm
 *  whether a stock is tradable on T212 under ANY listing/suffix. */
function main(): void {
  const term = (process.argv[2] ?? 'SINCH').toUpperCase();
  const lookup = loadT212InstrumentsCache(undefined, 365 * 24 * 60 * 60 * 1000);
  if (!lookup) { console.log('No cache found.'); return; }

  console.log(`Cache: ${lookup.count} instruments, fetched ${lookup.fetchedAt.toISOString()}`);
  console.log(`Searching all instruments for "${term}" in ticker / shortName / name...\n`);

  let hits = 0;
  for (const inst of lookup.byT212Ticker.values()) {
    const i = inst as { ticker: string; shortName?: string; name?: string; currencyCode?: string };
    const hay = `${i.ticker} ${i.shortName ?? ''} ${i.name ?? ''}`.toUpperCase();
    if (hay.includes(term)) {
      hits++;
      console.log(`  ticker=${i.ticker.padEnd(16)} cur=${(i.currencyCode ?? '?').padEnd(5)} shortName=${(i.shortName ?? '?').padEnd(8)} ${i.name ?? ''}`);
    }
  }
  if (hits === 0) console.log('  (no instruments mention this term anywhere)');
  console.log(`\nTotal matches: ${hits}`);
}

main();
