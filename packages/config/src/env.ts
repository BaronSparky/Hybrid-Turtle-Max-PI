import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MARKET_DATA_PROVIDER: z.enum(['yahoo']).default('yahoo'),
  MARKET_DATA_DEFAULT_RANGE: z.enum(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']).default('1y'),
  MARKET_DATA_DEFAULT_INTERVAL: z.enum(['1d', '1wk', '1mo']).default('1d'),
  MARKET_DATA_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(4),
  MARKET_DATA_FETCH_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  MARKET_DATA_NIGHTLY_CRON: z.string().min(1).default('0 30 22 * * 1-5'),
  BROKER_ADAPTER: z.enum(['mock', 'trading212', 'disabled']).default('disabled'),
  BROKER_MOCK_DATA_FILE: z.string().min(1).default('./docs/fixtures/mock-broker-state.json'),
  BROKER_SYNC_CRON: z.string().min(1).default('0 45 22 * * 1-5'),
  EVENING_PLAN_MAX_TRADES: z.coerce.number().int().min(1).max(20).default(5),
  // Risk per trade as a decimal fraction (0.005 = 0.5%). Max 0.05 = 5%.
  // Named _PCT for legacy reasons but the value is a fraction, not a percentage.
  EVENING_PLAN_RISK_PER_TRADE_PCT: z.coerce.number().min(0.001).max(0.05).default(0.005),
  EVENING_SCAN_BREAKOUT_LOOKBACK: z.coerce.number().int().min(10).max(60).default(20),
  EVENING_SCAN_TREND_LOOKBACK: z.coerce.number().int().min(20).max(120).default(55),
});

export const env = envSchema.parse(process.env);

export type AppEnv = typeof env;