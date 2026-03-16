import { getCandidateListView } from '../packages/signals/src';

async function main() {
  const sortByArg = (process.argv[2] as 'rankScore' | 'symbol' | 'currentPrice' | 'triggerPrice' | 'stopDistancePercent' | 'setupStatus' | undefined) ?? 'rankScore';
  const directionArg = (process.argv[3] as 'asc' | 'desc' | undefined) ?? 'desc';
  const result = await getCandidateListView(sortByArg, directionArg);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Signal candidates failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});