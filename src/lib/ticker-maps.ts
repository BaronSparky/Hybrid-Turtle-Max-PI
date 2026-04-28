/**
 * Shared Ticker Maps — Single Source of Truth
 *
 * Maps database/T212 ticker symbols to their Yahoo Finance and EODHD equivalents.
 * Used by market-data.ts, market-data-eodhd.ts, clean-delisted-tickers.ts,
 * and sync-yahoo-tickers.ts to prevent map drift across the codebase.
 *
 * NOTE: This module must NOT import 'server-only' — it's used by CLI scripts.
 */

// ── Exchange suffix mappings ──
// Yahoo uses: .L (LSE), .DE (XETRA), .AS, .PA, .SW, .CO, .MI
// EODHD uses: .LSE, .XETRA, .AS, .PA, .SW, .CO, .MI

interface TickerEntry {
  /** DB/T212 ticker (no exchange suffix) */
  db: string;
  /** Yahoo Finance symbol */
  yahoo: string;
  /** EODHD symbol */
  eodhd: string;
}

/**
 * All non-US tickers that need exchange suffix mapping.
 * This is the canonical list — all other maps are derived from it.
 */
const INTERNATIONAL_TICKERS: readonly TickerEntry[] = [
  // UK / LSE (GBP / GBX)
  { db: 'AIAI',  yahoo: 'AIAI.L',  eodhd: 'AIAI.LSE' },
  { db: 'AZN',   yahoo: 'AZN.L',   eodhd: 'AZN.LSE' },
  { db: 'BTEE',  yahoo: 'BTEE.L',  eodhd: 'BTEE.LSE' },
  { db: 'CNDX',  yahoo: 'CNDX.L',  eodhd: 'CNDX.LSE' },
  { db: 'DGE',   yahoo: 'DGE.L',   eodhd: 'DGE.LSE' },
  { db: 'EIMI',  yahoo: 'EIMI.L',  eodhd: 'EIMI.LSE' },
  { db: 'GSK',   yahoo: 'GSK.L',   eodhd: 'GSK.LSE' },
  { db: 'HSBA',  yahoo: 'HSBA.L',  eodhd: 'HSBA.LSE' },
  { db: 'INRG',  yahoo: 'INRG.L',  eodhd: 'INRG.LSE' },
  { db: 'IWMO',  yahoo: 'IWMO.L',  eodhd: 'IWMO.LSE' },
  { db: 'NG',    yahoo: 'NG.L',    eodhd: 'NG.LSE' },
  { db: 'RBOT',  yahoo: 'RBOT.L',  eodhd: 'RBOT.LSE' },
  { db: 'REL',   yahoo: 'REL.L',   eodhd: 'REL.LSE' },
  { db: 'RIO',   yahoo: 'RIO.L',   eodhd: 'RIO.LSE' },
  { db: 'SGLN',  yahoo: 'SGLN.L',  eodhd: 'SGLN.LSE' },
  { db: 'SHEL',  yahoo: 'SHEL.L',  eodhd: 'SHEL.LSE' },
  { db: 'SSE',   yahoo: 'SSE.L',   eodhd: 'SSE.LSE' },
  { db: 'SSLN',  yahoo: 'SSLN.L',  eodhd: 'SSLN.LSE' },
  { db: 'ULVR',  yahoo: 'ULVR.L',  eodhd: 'ULVR.LSE' },
  { db: 'VUSA',  yahoo: 'VUSA.L',  eodhd: 'VUSA.LSE' },
  { db: 'WSML',  yahoo: 'WSML.L',  eodhd: 'WSML.LSE' },
  // Germany / XETRA (EUR)
  { db: 'ALV',   yahoo: 'ALV.DE',  eodhd: 'ALV.XETRA' },
  { db: 'SAP',   yahoo: 'SAP.DE',  eodhd: 'SAP.XETRA' },
  { db: 'SIE',   yahoo: 'SIE.DE',  eodhd: 'SIE.XETRA' },
  { db: 'DBK',   yahoo: 'DBK.DE',  eodhd: 'DBK.XETRA' },
  { db: 'IFX',   yahoo: 'IFX.DE',  eodhd: 'IFX.XETRA' },
  { db: 'HLAG',  yahoo: 'HLAG.DE', eodhd: 'HLAG.XETRA' },
  // Netherlands / Euronext Amsterdam (EUR)
  { db: 'ASML',  yahoo: 'ASML.AS', eodhd: 'ASML.AS' },
  { db: 'MT',    yahoo: 'MT.AS',   eodhd: 'MT.AS' },
  // France / Euronext Paris (EUR)
  { db: 'MC',    yahoo: 'MC.PA',   eodhd: 'MC.PA' },
  { db: 'OR',    yahoo: 'OR.PA',   eodhd: 'OR.PA' },
  { db: 'SU',    yahoo: 'SU.PA',   eodhd: 'SU.PA' },
  { db: 'TTE',   yahoo: 'TTE.PA',  eodhd: 'TTE.PA' },
  // Switzerland / SIX (CHF)
  { db: 'NOVN',  yahoo: 'NOVN.SW', eodhd: 'NOVN.SW' },
  { db: 'ROG',   yahoo: 'ROG.SW',  eodhd: 'ROG.SW' },
  // Denmark / Copenhagen (DKK)
  { db: 'NVO',   yahoo: 'NOVO-B.CO', eodhd: 'NOVO-B.CO' },
  // Italy / Milan (EUR)
  { db: 'UCG',   yahoo: 'UCG.MI',  eodhd: 'UCG.MI' },
  // Ticker renames (same symbol on both providers)
  { db: 'WLTW',  yahoo: 'WTW',     eodhd: 'WTW' },
] as const;

/** DB ticker → Yahoo Finance symbol */
export const YAHOO_TICKER_MAP: Record<string, string> = Object.fromEntries(
  INTERNATIONAL_TICKERS.map(t => [t.db, t.yahoo])
);

/** DB ticker → EODHD symbol */
export const EODHD_TICKER_MAP: Record<string, string> = Object.fromEntries(
  INTERNATIONAL_TICKERS.map(t => [t.db, t.eodhd])
);

/**
 * Convert a database/T212 ticker to its Yahoo Finance symbol.
 * Priority: explicit yahooTicker override → static map → T212 'l' suffix rule → passthrough.
 */
export function toYahooTicker(ticker: string, yahooTickerOverride?: string | null): string {
  if (yahooTickerOverride) return yahooTickerOverride;
  if (YAHOO_TICKER_MAP[ticker]) return YAHOO_TICKER_MAP[ticker];
  if (/^[A-Z]{2,5}l$/.test(ticker)) {
    return ticker.slice(0, -1) + '.L';
  }
  return ticker;
}

/**
 * Convert a database/T212 ticker to its EODHD symbol.
 * Priority: explicit map → T212 'l' suffix rule → Yahoo suffix conversion → default .US.
 */
export function toEodhdTicker(ticker: string): string {
  if (EODHD_TICKER_MAP[ticker]) return EODHD_TICKER_MAP[ticker];
  if (/^[A-Z]{2,5}l$/.test(ticker)) {
    return ticker.slice(0, -1) + '.LSE';
  }
  if (ticker.endsWith('.L')) return ticker.replace('.L', '.LSE');
  if (ticker.endsWith('.DE')) return ticker.replace('.DE', '.XETRA');
  if (/\.(AS|PA|SW|CO|MI)$/.test(ticker)) return ticker;
  if (!ticker.includes('.')) return `${ticker}.US`;
  return ticker;
}
