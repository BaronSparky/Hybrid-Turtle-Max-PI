import { NextRequest, NextResponse } from 'next/server';

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: string;
    retryable?: boolean;
  };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: string,
  retryable?: boolean
) {
  // Log full error details server-side; suppress from client in production
  if (details && process.env.NODE_ENV === 'production') {
    console.error(`[apiError] ${code}: ${details}`);
  }
  const safeDetails = process.env.NODE_ENV === 'production' ? undefined : details;
  return NextResponse.json<ApiErrorPayload>(
    {
      ok: false,
      error: { code, message, details: safeDetails, retryable },
    },
    { status }
  );
}

/**
 * Verify the CRON_SECRET header on scheduled/cron endpoints.
 * Returns null if valid, or a 401 NextResponse if invalid.
 * Skips validation when DISABLE_API_AUTH is true in non-production.
 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  if (process.env.DISABLE_API_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
    return null;
  }
  const secret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing cron secret' } },
      { status: 401 }
    );
  }
  return null;
}
