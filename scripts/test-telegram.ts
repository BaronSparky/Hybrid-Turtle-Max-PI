import 'dotenv/config';

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log('Token:', token ? token.substring(0, 10) + '...' : 'MISSING');
  console.log('Chat ID:', chatId || 'MISSING');

  if (!token || !chatId) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env');
    process.exit(1);
  }

  // Test 1: Raw API call
  console.log('\n--- Test 1: Raw Telegram API ---');
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '🧪 HybridTurtle E2E Test — Telegram is working!', parse_mode: 'HTML' }),
    });
    const data = await res.json();
    console.log('Status:', res.status, '| OK:', data.ok);
    if (!data.ok) console.log('Error:', data.description);
  } catch (err) {
    console.error('Fetch failed:', (err as Error).message);
  }

  // Test 2: App's sendTelegramMessage function
  console.log('\n--- Test 2: sendTelegramMessage() ---');
  try {
    const { sendTelegramMessage } = await import('../src/lib/telegram');
    const sent = await sendTelegramMessage({ text: '🧪 Test 2: sendTelegramMessage() works!' });
    console.log('Sent:', sent);
  } catch (err) {
    console.error('sendTelegramMessage failed:', (err as Error).message);
  }

  // Test 3: Check secrets.ts credential loading
  console.log('\n--- Test 3: getTelegramCredentials() ---');
  try {
    const { getTelegramCredentials } = await import('../src/lib/secrets');
    const creds = await getTelegramCredentials();
    console.log('Creds found:', !!creds);
    if (creds) {
      console.log('Bot token prefix:', creds.botToken.substring(0, 10) + '...');
      console.log('Chat ID:', creds.chatId);
    }
  } catch (err) {
    console.error('getTelegramCredentials failed:', (err as Error).message);
  }
}

main().catch(console.error).finally(() => process.exit(0));
