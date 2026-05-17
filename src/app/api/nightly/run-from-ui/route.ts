/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx (Run Nightly button)
 * Consumes: ../route.ts (POST), src/lib/api-response.ts
 * Risk-sensitive: YES (triggers the same nightly pipeline as the cron POST)
 * Last modified: 2026-05-17
 * Notes: UI-only sibling of POST /api/nightly. The parent route is cron-only
 * (CRON_SECRET enforced even when DISABLE_API_AUTH=true) per the 2026-05-16
 * audit. This route exists so the dashboard "Run Nightly" button can trigger
 * the same pipeline under standard session auth / desktop bypass. It reads
 * CRON_SECRET from process.env server-side and forwards the request to the
 * cron handler — the business logic is not duplicated.
 */
export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { POST as nightlyCronPost } from '../route';
import { apiError } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return apiError(500, 'CRON_SECRET_MISSING', 'Server CRON_SECRET is not configured');
  }

  // The user has already been authorised by middleware (NextAuth session or
  // the desktop DISABLE_API_AUTH bypass) before this handler runs. We attach
  // the server-side CRON_SECRET and forward to the cron-protected handler
  // so the nightly pipeline's business logic lives in exactly one place.
  const headers = new Headers(request.headers);
  headers.set('x-cron-secret', secret);

  // Buffer the body. The dashboard button sends a small JSON payload
  // ({ userId }); buffering avoids the request-stream "duplex" gotcha that
  // appears when forwarding ReadableStream bodies in Node fetch.
  const bodyText = await request.text();

  const forwarded = new NextRequest(request.url, {
    method: 'POST',
    headers,
    body: bodyText.length > 0 ? bodyText : undefined,
  });

  return nightlyCronPost(forwarded);
}
