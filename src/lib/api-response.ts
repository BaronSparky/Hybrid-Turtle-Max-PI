import { NextResponse } from 'next/server';

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
