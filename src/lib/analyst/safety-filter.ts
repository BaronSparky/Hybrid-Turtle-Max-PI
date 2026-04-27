/**
 * DEPENDENCIES
 * Consumed by: analyst-service.ts, prompt-builder.ts
 * Consumes: nothing (pure validation functions)
 * Risk-sensitive: NO — defensive filter, no side effects
 * Notes: Strips sensitive data from prompts and validates analyst responses.
 *        Prevents credential leakage and actionable trade language.
 */

// ── Sensitive patterns to strip from prompts ──

const SENSITIVE_PATTERNS = [
  /NEXTAUTH_SECRET\s*=\s*\S+/gi,
  /CRON_SECRET\s*=\s*\S+/gi,
  /TELEGRAM_BOT_TOKEN\s*=\s*\S+/gi,
  /TELEGRAM_CHAT_ID\s*=\s*\S+/gi,
  /T212[_-]?API[_-]?KEY\s*[:=]\s*\S+/gi,
  /Bearer\s+\S{20,}/gi,
  /password\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
];

/**
 * Strip sensitive data from text before it enters a prompt.
 */
export function stripSensitiveData(text: string): string {
  let cleaned = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
}

// ── Forbidden action phrases in responses ──

const FORBIDDEN_PHRASES = [
  'buy now',
  'sell now',
  'place the order',
  'place an order',
  'execute the trade',
  'execute this trade',
  'you should buy',
  'you should sell',
  'i recommend buying',
  'i recommend selling',
  'move your stop to',
  'set your stop to',
  'change the stop',
  'lower the stop',
  'override the gate',
  'bypass the gate',
  'disable the kill switch',
  'turn off the kill switch',
  'ignore the risk gate',
  'override risk',
];

export interface SafetyCheckResult {
  safe: boolean;
  warnings: string[];
  cleaned: string;
}

/**
 * Check an analyst response for forbidden action language.
 * Returns the response with a safety disclaimer prepended.
 */
export function checkResponseSafety(response: string): SafetyCheckResult {
  const warnings: string[] = [];
  const lower = response.toLowerCase();

  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) {
      warnings.push(`Response contained forbidden phrase: "${phrase}"`);
    }
  }

  // Always prepend advisory disclaimer
  const disclaimer = '⚠️ **Advisory only** — verify against dashboard data before acting.\n\n';
  const cleaned = disclaimer + response;

  return {
    safe: warnings.length === 0,
    warnings,
    cleaned,
  };
}

/**
 * Validate that a response doesn't fabricate numbers not present in the context.
 * This is a heuristic check — looks for currency amounts not in the source data.
 */
export function checkForFabricatedNumbers(
  response: string,
  contextNumbers: number[]
): string[] {
  const warnings: string[] = [];
  // Find all currency-like numbers in the response (£123, $456, 78.9%)
  const numberMatches = response.match(/[£$][\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%/g) || [];

  for (const match of numberMatches) {
    const numStr = match.replace(/[£$%,]/g, '');
    const num = parseFloat(numStr);
    if (isNaN(num)) continue;

    // Allow common small numbers (0, 1, 2, etc.) and percentages
    if (num < 10) continue;

    // Check if this number appears in the context
    const found = contextNumbers.some(cn => Math.abs(cn - num) < 0.01);
    if (!found) {
      warnings.push(`Number ${match} in response may not match source data`);
    }
  }

  return warnings;
}
