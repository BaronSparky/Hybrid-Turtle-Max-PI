/**
 * DEPENDENCIES
 * Consumed by: AnalyticsExplainCard.tsx, Trade Pulse page (feedback buttons)
 * Consumes: fs (local JSON file storage)
 * Risk-sensitive: NO — advisory feedback storage, no trade execution
 * Notes: Persists AI analyst feedback (thumbs up/down) server-side.
 *        Uses a JSON file in the data directory for simplicity.
 *        GET returns all feedback entries. POST saves a new entry.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { promises as fs } from 'fs';
import path from 'path';

const FEEDBACK_FILE = path.join(process.cwd(), 'data', 'analyst-feedback.json');

interface FeedbackEntry {
  context: string;      // e.g. "trade-pulse:AAPL" or "analytics:Score Lab"
  rating: 'up' | 'down';
  model?: string;
  timestamp: number;
}

interface FeedbackStore {
  entries: FeedbackEntry[];
}

async function ensureDataDir(): Promise<void> {
  const dir = path.dirname(FEEDBACK_FILE);
  await fs.mkdir(dir, { recursive: true });
}

async function readStore(): Promise<FeedbackStore> {
  try {
    const raw = await fs.readFile(FEEDBACK_FILE, 'utf-8');
    return JSON.parse(raw) as FeedbackStore;
  } catch {
    return { entries: [] };
  }
}

async function writeStore(store: FeedbackStore): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(FEEDBACK_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function GET() {
  try {
    const store = await readStore();
    // Aggregate counts
    const summary: Record<string, { up: number; down: number; lastAt: number }> = {};
    for (const entry of store.entries) {
      if (!summary[entry.context]) {
        summary[entry.context] = { up: 0, down: 0, lastAt: 0 };
      }
      summary[entry.context][entry.rating]++;
      summary[entry.context].lastAt = Math.max(summary[entry.context].lastAt, entry.timestamp);
    }
    return NextResponse.json({ total: store.entries.length, summary });
  } catch (error) {
    console.error('[Analyst Feedback] GET error:', error);
    return apiError(500, 'FEEDBACK_READ_FAILED', 'Failed to read feedback');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { context, rating, model } = body as {
      context?: string;
      rating?: string;
      model?: string;
    };

    if (!context || typeof context !== 'string') {
      return apiError(400, 'MISSING_CONTEXT', 'context is required');
    }
    if (rating !== 'up' && rating !== 'down') {
      return apiError(400, 'INVALID_RATING', 'rating must be "up" or "down"');
    }

    // Sanitize context string (max 100 chars, alphanumeric + limited punctuation)
    const sanitizedContext = context.slice(0, 100).replace(/[^a-zA-Z0-9:._\-\s]/g, '');

    const entry: FeedbackEntry = {
      context: sanitizedContext,
      rating,
      model: model?.slice(0, 50),
      timestamp: Date.now(),
    };

    const store = await readStore();

    // Cap at 1000 entries (FIFO eviction)
    if (store.entries.length >= 1000) {
      store.entries = store.entries.slice(-999);
    }

    store.entries.push(entry);
    await writeStore(store);

    return NextResponse.json({ ok: true, totalEntries: store.entries.length });
  } catch (error) {
    console.error('[Analyst Feedback] POST error:', error);
    return apiError(500, 'FEEDBACK_WRITE_FAILED', 'Failed to save feedback');
  }
}
