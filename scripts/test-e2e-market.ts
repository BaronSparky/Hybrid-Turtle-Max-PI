import 'dotenv/config';

async function main() {
  console.log('=== MARKET DATA + REGIME ===');
  
  const { getMarketRegime, getBatchPrices } = await import('../src/lib/market-data');
  
  // Test regime detection
  console.log('\n--- Regime ---');
  try {
    const regime = await getMarketRegime();
    console.log('Regime:', regime);
  } catch (err) {
    console.error('Regime FAILED:', (err as Error).message);
  }
  
  // Test price fetching
  console.log('\n--- Price Fetch (3 tickers) ---');
  try {
    const prices = await getBatchPrices(['AAPL', 'MSFT', 'GSK.L']);
    for (const [ticker, price] of Object.entries(prices)) {
      console.log(`  ${ticker}: ${price > 0 ? '$' + price.toFixed(2) : 'NO DATA'}`);
    }
  } catch (err) {
    console.error('Price fetch FAILED:', (err as Error).message);
  }

  // Test data freshness
  console.log('\n--- Data Freshness ---');
  try {
    const { getDataFreshness } = await import('../src/lib/market-data');
    const freshness = getDataFreshness();
    console.log('Source:', freshness.source);
    console.log('Age (min):', freshness.ageMinutes.toFixed(1));
  } catch (err) {
    console.error('Freshness check FAILED:', (err as Error).message);
  }
}

main().catch(console.error).finally(() => process.exit(0));
