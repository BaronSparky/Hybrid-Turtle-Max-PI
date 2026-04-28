import 'dotenv/config';

async function main() {
  const prisma = (await import('../src/lib/prisma')).default;

  // === 5: SCAN ENGINE ===
  console.log('=== SCAN ENGINE ===');
  try {
    const { runTechnicalFilters, classifyCandidate, rankCandidate } = await import('../src/lib/scan-engine');
    const filterResult = runTechnicalFilters(150, {
      currentPrice: 150, ma200: 140, adx: 30, plusDI: 25, minusDI: 15,
      atr: 3, atr20DayAgo: 2.5, atrSpiking: false, medianAtr14: 2.8,
      atrPercent: 2.0, twentyDayHigh: 155, efficiency: 60,
      relativeStrength: 50, volumeRatio: 1.5, failedBreakoutAt: null,
    }, 'CORE');
    console.log('Filter passesAll:', filterResult.passesAll);
    console.log('Classify (99 vs 100):', classifyCandidate(99, 100));
    console.log('Rank CORE READY:', rankCandidate('CORE', {
      currentPrice: 150, ma200: 140, adx: 30, plusDI: 25, minusDI: 15,
      atr: 3, atr20DayAgo: 2.5, atrSpiking: false, medianAtr14: 2.8,
      atrPercent: 2.0, twentyDayHigh: 155, efficiency: 60,
      relativeStrength: 50, volumeRatio: 1.5, failedBreakoutAt: null,
    }, 'READY').toFixed(2));
  } catch (err) {
    console.error('Scan engine FAILED:', (err as Error).message);
  }

  // === 6: STOP MANAGER ===
  console.log('\n=== STOP MANAGER ===');
  try {
    const { calculateProtectionStop, calculateStopRecommendation, getProtectionLevel } = await import('../src/lib/stop-manager');
    console.log('INITIAL stop (100, 10):', calculateProtectionStop(100, 10, 'INITIAL'));
    console.log('BREAKEVEN stop (100, 10):', calculateProtectionStop(100, 10, 'BREAKEVEN'));
    console.log('LOCK_1R_TRAIL (100, 10, 150, ATR=5):', calculateProtectionStop(100, 10, 'LOCK_1R_TRAIL', 150, 5));
    
    // Same-value filter test
    const rec = calculateStopRecommendation(130, 100, 10, 122.5, 'LOCK_08R', 5);
    console.log('Rec for 130 price, 122.5 stop:', rec ? `${rec.newStop} (${rec.newLevel})` : 'null (no change)');
    
    // APLS regression: same-value should return null
    const sameVal = calculateStopRecommendation(115, 100, 10, 100, 'BREAKEVEN', 5);
    console.log('Same-value regression (should be null):', sameVal === null ? 'PASS' : 'FAIL');
  } catch (err) {
    console.error('Stop manager FAILED:', (err as Error).message);
  }

  // === 7: SAFETY CONTROLS ===
  console.log('\n=== SAFETY CONTROLS ===');
  try {
    const { getKillSwitchSettings, isAutoTradingEnabled, getMarketDataSafetyStatus } = await import('../packages/workflow/src');
    const ks = await getKillSwitchSettings();
    console.log('Kill switch — submissions disabled:', ks.disableAllSubmissions);
    console.log('Kill switch — auto disabled:', ks.disableAutomatedSubmissions);
    console.log('Auto-trading enabled:', await isAutoTradingEnabled());
    const mds = await getMarketDataSafetyStatus();
    console.log('Market data stale:', mds.isStale, '| stale symbols:', mds.staleSymbolCount);
  } catch (err) {
    console.error('Safety controls FAILED:', (err as Error).message);
  }

  // === 8: CRYPTO / ENCRYPTION ===
  console.log('\n=== CRYPTO ===');
  try {
    const { encryptField, decryptField, isEncrypted } = await import('../src/lib/crypto');
    const plain = 'test-api-key-12345';
    const encrypted = encryptField(plain);
    const decrypted = decryptField(encrypted);
    console.log('Encrypt/decrypt round-trip:', decrypted === plain ? 'PASS' : 'FAIL');
    console.log('isEncrypted (enc):', isEncrypted(encrypted));
    console.log('isEncrypted (plain):', isEncrypted(plain));
    console.log('Backward compat (plain passthrough):', decryptField(plain) === plain ? 'PASS' : 'FAIL');
    
    // Check DB keys are encrypted
    const user = await prisma.user.findUnique({
      where: { id: 'default-user' },
      select: { t212IsaApiKey: true, t212IsaApiSecret: true },
    });
    console.log('DB ISA key encrypted:', user?.t212IsaApiKey ? isEncrypted(user.t212IsaApiKey) : 'no key');
    console.log('DB ISA secret encrypted:', user?.t212IsaApiSecret ? isEncrypted(user.t212IsaApiSecret) : 'no key');
  } catch (err) {
    console.error('Crypto FAILED:', (err as Error).message);
  }

  // === 9: T212 CREDENTIAL FLOW ===
  console.log('\n=== T212 CREDENTIAL FLOW ===');
  try {
    const { getCredentialsForAccount } = await import('../src/lib/trading212-dual');
    const user = await prisma.user.findUnique({
      where: { id: 'default-user' },
      select: {
        t212ApiKey: true, t212ApiSecret: true, t212Environment: true, t212Connected: true,
        t212IsaApiKey: true, t212IsaApiSecret: true, t212IsaConnected: true,
      },
    });
    if (user) {
      const isaCreds = getCredentialsForAccount(user, 'isa');
      console.log('ISA creds loaded:', !!isaCreds);
      if (isaCreds) {
        // Verify the key was decrypted (not still enc: prefixed)
        console.log('ISA key decrypted (not enc: prefix):', !isaCreds.apiKey.startsWith('enc:') ? 'PASS' : 'FAIL');
      }
      const investCreds = getCredentialsForAccount(user, 'invest');
      console.log('Invest creds loaded:', !!investCreds);
    }
  } catch (err) {
    console.error('T212 credentials FAILED:', (err as Error).message);
  }

  // === 10: POSITIONS + RISK ===
  console.log('\n=== POSITIONS + RISK ===');
  try {
    const { getRiskBudget } = await import('../src/lib/risk-gates');
    const positions = await prisma.position.findMany({
      where: { userId: 'default-user', status: 'OPEN' },
      include: { stock: { select: { ticker: true, sleeve: true, currency: true } } },
    });
    console.log('Open positions:', positions.length);
    for (const p of positions) {
      const rMul = p.initialRisk > 0 ? ((p.entryPrice - p.currentStop) / p.initialRisk).toFixed(1) : '?';
      console.log(`  ${p.stock.ticker} [${p.stock.sleeve}] — entry ${p.entryPrice.toFixed(2)}, stop ${p.currentStop.toFixed(2)}, R=${rMul}`);
    }
    
    const budget = getRiskBudget(
      positions.map(p => ({
        id: p.id, ticker: p.stock.ticker, sleeve: (p.stock.sleeve || 'CORE') as any,
        sector: 'Unknown', cluster: 'General', value: p.shares * p.entryPrice,
        riskDollars: p.shares * (p.entryPrice - p.currentStop), shares: p.shares,
        entryPrice: p.entryPrice, currentStop: p.currentStop, currentPrice: p.entryPrice,
      })),
      (await prisma.user.findUnique({ where: { id: 'default-user' }, select: { equity: true } }))?.equity || 0,
      'BALANCED'
    );
    console.log(`Risk: ${budget.usedRiskPercent.toFixed(1)}% / ${budget.maxRiskPercent}% | Positions: ${budget.usedPositions}/${budget.maxPositions}`);
  } catch (err) {
    console.error('Positions FAILED:', (err as Error).message);
  }

  // === 11: MARKET HOLIDAYS ===
  console.log('\n=== MARKET HOLIDAYS ===');
  try {
    const { isMarketHoliday, isTodayMarketHoliday, isEarlyCloseDay, checkHolidayCoverage } = await import('../src/lib/market-holidays');
    const { isHoliday, holiday } = isTodayMarketHoliday();
    console.log('Today is holiday:', isHoliday, holiday?.label || '');
    console.log('Good Friday 2026:', isMarketHoliday('2026-04-03') ? 'YES' : 'NO');
    console.log('Black Friday 2026 early close:', isEarlyCloseDay('2026-11-27') || 'none');
    console.log('2026 coverage:', checkHolidayCoverage(2026) ?? 'OK');
    console.log('2027 coverage:', checkHolidayCoverage(2027) ?? 'OK');
    console.log('2028 coverage:', checkHolidayCoverage(2028) ?? 'OK');
    console.log('2030 coverage:', checkHolidayCoverage(2030) ?? 'OK');
  } catch (err) {
    console.error('Holidays FAILED:', (err as Error).message);
  }

  // === 12: UK TIME ===
  console.log('\n=== UK TIME ===');
  try {
    const { getUKDayOfWeek, getUKHour, getUKDateString, getUKTimeString, isUKWeekday } = await import('../src/lib/uk-time');
    console.log('Day:', getUKDayOfWeek(), '| Hour:', getUKHour(), '| Weekday:', isUKWeekday());
    console.log('Date:', getUKDateString(), '| Time:', getUKTimeString());
  } catch (err) {
    console.error('UK time FAILED:', (err as Error).message);
  }

  // === 13: RATE LIMITER ===
  console.log('\n=== RATE LIMITER ===');
  try {
    const { checkRateLimit, getRateLimitCategory } = await import('../src/lib/rate-limit');
    console.log('execute category:', getRateLimitCategory('/api/positions/execute'));
    console.log('scan category:', getRateLimitCategory('/api/scan'));
    console.log('settings (no limit):', getRateLimitCategory('/api/settings'));
    const key = 'e2e-test-' + Date.now();
    console.log('Rate check 1:', checkRateLimit(key, 3, 1));
    console.log('Rate check 2:', checkRateLimit(key, 3, 1));
    console.log('Rate check 3:', checkRateLimit(key, 3, 1));
    console.log('Rate check 4 (blocked):', checkRateLimit(key, 3, 1));
  } catch (err) {
    console.error('Rate limiter FAILED:', (err as Error).message);
  }

  await prisma.$disconnect();
}

main().catch(console.error).finally(() => process.exit(0));
