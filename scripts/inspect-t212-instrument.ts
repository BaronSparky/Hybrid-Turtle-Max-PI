import 'dotenv/config';
import { loadT212InstrumentsCache } from '../src/lib/t212-instruments-cache';

/** Read-only: dump full metadata (incl. ISIN) for specific T212 tickers,
 *  so identity can be confirmed by ISIN rather than by name guesswork. */
function main(): void {
  const wanted = (process.argv.slice(2).length ? process.argv.slice(2) : ['E3G1d_EQ', 'EVVTY_US_EQ']).map((t) => t.toUpperCase());
  const lookup = loadT212InstrumentsCache(undefined, 365 * 24 * 60 * 60 * 1000);
  if (!lookup) { console.log('No cache found.'); return; }

  console.log(`Cache: ${lookup.count} instruments, fetched ${lookup.fetchedAt.toISOString()}\n`);
  for (const [key, inst] of lookup.byT212Ticker.entries()) {
    if (!wanted.includes(key.toUpperCase())) continue;
    console.log(JSON.stringify(inst, null, 2));
    console.log('');
  }
}

main();
