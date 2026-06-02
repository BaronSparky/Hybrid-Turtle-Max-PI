import 'dotenv/config';
import { loadT212InstrumentsCache, type T212InstrumentsLookup } from '../src/lib/t212-instruments-cache';
import type { T212Instrument } from '../src/lib/trading212';

/**
 * Read-only: resolve the correct T212 ticker for a Stockholm (.ST) Stock
 * row against the cached T212 instruments universe. Mirrors the matching
 * logic in scripts/repair-t212-tickers-from-instruments.ts (shortName +
 * bare-ticker lookup, then SEK currency filter) but does NOT write.
 */

function lookupCandidates(lookup: T212InstrumentsLookup, ticker: string): T212Instrument[] {
  const STRIPPABLE = ['.L', '.DE', '.PA', '.MI', '.MC', '.AS', '.CO', '.ST', '.HE', '.SW'];
  const stripped = STRIPPABLE.reduce((t, s) => (t.endsWith(s) ? t.slice(0, -s.length) : t), ticker);
  const keys = [ticker, stripped].map((k) => k.toUpperCase());

  const seen = new Set<string>();
  const out: T212Instrument[] = [];
  for (const k of keys) {
    for (const inst of lookup.byShortName.get(k) ?? []) {
      if (!seen.has(inst.ticker)) { seen.add(inst.ticker); out.push(inst); }
    }
    for (const inst of lookup.byBareTicker.get(k) ?? []) {
      if (!seen.has(inst.ticker)) { seen.add(inst.ticker); out.push(inst); }
    }
  }
  return out;
}

function main(): void {
  const targets = ['SINCH.ST', 'EVO.ST'];
  // Allow a long staleness window — we only read, and want to see whatever exists.
  const lookup = loadT212InstrumentsCache(undefined, 365 * 24 * 60 * 60 * 1000);

  if (!lookup) {
    console.log('No T212 instruments cache found (or unreadable) at prisma/cache/t212-instruments.json.');
    console.log('Refresh it with: npx tsx scripts/repair-t212-tickers-from-instruments.ts --refresh-cache');
    return;
  }

  console.log(`Cache: ${lookup.count} instruments, fetched ${lookup.fetchedAt.toISOString()}\n`);

  for (const t of targets) {
    const candidates = lookupCandidates(lookup, t);
    console.log(`=== ${t} (expects SEK listing) ===`);
    if (candidates.length === 0) {
      console.log('  No T212 instrument matches shortName/bare ticker.\n');
      continue;
    }
    for (const c of candidates) {
      const cc = (c as { currencyCode?: string }).currencyCode ?? '?';
      const sn = (c as { shortName?: string }).shortName ?? '?';
      const nm = (c as { name?: string }).name ?? '?';
      const sek = cc.toUpperCase() === 'SEK' ? '  <-- SEK match' : '';
      console.log(`  ticker=${c.ticker.padEnd(16)} cur=${String(cc).padEnd(5)} shortName=${String(sn).padEnd(8)} ${nm}${sek}`);
    }
    const sekMatches = candidates.filter((c) => ((c as { currencyCode?: string }).currencyCode ?? '').toUpperCase() === 'SEK');
    if (sekMatches.length === 1) {
      console.log(`  → Unambiguous SEK listing: ${sekMatches[0].ticker}`);
    } else if (sekMatches.length === 0) {
      console.log('  → No SEK listing exists on T212 (not tradable in SEK — likely should be excluded).');
    } else {
      console.log(`  → Ambiguous: ${sekMatches.length} SEK listings, needs manual disambiguation.`);
    }
    console.log('');
  }
}

main();
