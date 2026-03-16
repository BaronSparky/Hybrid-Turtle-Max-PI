/**
 * DEPENDENCIES
 * Consumed by: package.json#stops:view
 * Consumes: packages/stops/src/index.ts
 * Risk-sensitive: YES
 * Last modified: 2026-03-08
 * Notes: CLI projection for the Phase 8 stop dashboard table.
 */
import 'dotenv/config';
import { getStopDashboardData } from '../packages/stops/src';

async function main() {
  const dashboard = await getStopDashboardData();
  console.log(JSON.stringify(dashboard, null, 2));
}

main().catch((error) => {
  console.error('Stop dashboard failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});