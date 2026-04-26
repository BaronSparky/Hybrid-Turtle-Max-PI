/**
 * DEPENDENCIES
 * Consumed by: /evidence page
 * Consumes: evidence-framework.ts
 * Risk-sensitive: NO — read-only analytics
 */
import { NextResponse } from 'next/server';
import { generateEvidence } from '@/lib/evidence-framework';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const sleeve = searchParams.get('sleeve') ?? undefined;
  const regime = searchParams.get('regime') ?? undefined;

  const result = await generateEvidence({
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    sleeve,
    regime,
  });

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=120' },
  });
}
