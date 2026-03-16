import { runSignalScan } from '../packages/signals/src';

async function main() {
  const result = await runSignalScan();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Signal scan failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});