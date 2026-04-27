/**
 * DEPENDENCIES
 * Consumed by: ollama-client.ts (pickModelForContext)
 * Consumes: fs (local JSON file storage)
 * Risk-sensitive: NO — read-only feedback aggregation
 * Notes: Lightweight reader for aggregated model feedback scores.
 *        Used by model selection to prefer models with higher user ratings.
 *        Best-effort — returns empty on any failure.
 */

import { promises as fs } from 'fs';
import path from 'path';

const FEEDBACK_FILE = path.join(process.cwd(), 'data', 'analyst-feedback.json');

interface FeedbackEntry {
  context: string;
  rating: 'up' | 'down';
  model?: string;
  timestamp: number;
}

interface FeedbackStore {
  entries: FeedbackEntry[];
}

export interface ModelFeedbackScore {
  model: string;
  up: number;
  down: number;
  total: number;
  helpfulPct: number; // 0-100
}

/**
 * Aggregate feedback per model. Returns empty array on any failure.
 * Cached in-memory for 5 minutes to avoid repeated file reads.
 */
let cachedScores: ModelFeedbackScore[] = [];
let cacheExpiresAt = 0;

/** Clear the in-memory cache. Exported for test use only. */
export function clearFeedbackCache(): void {
  cachedScores = [];
  cacheExpiresAt = 0;
}

export async function getModelFeedbackScores(): Promise<ModelFeedbackScore[]> {
  if (Date.now() < cacheExpiresAt) return cachedScores;

  try {
    const raw = await fs.readFile(FEEDBACK_FILE, 'utf-8');
    const store = JSON.parse(raw) as FeedbackStore;

    const byModel = new Map<string, { up: number; down: number }>();
    for (const entry of store.entries) {
      if (!entry.model) continue;
      const current = byModel.get(entry.model) ?? { up: 0, down: 0 };
      current[entry.rating]++;
      byModel.set(entry.model, current);
    }

    cachedScores = [...byModel.entries()].map(([model, stats]) => {
      const total = stats.up + stats.down;
      return {
        model,
        up: stats.up,
        down: stats.down,
        total,
        helpfulPct: total > 0 ? Math.round((stats.up / total) * 100) : 50,
      };
    });
    cacheExpiresAt = Date.now() + 5 * 60 * 1000; // 5 min cache
    return cachedScores;
  } catch {
    return [];
  }
}

/**
 * Get the helpfulness score for a specific model. Returns 50 (neutral) if unknown.
 */
export async function getModelScore(modelName: string): Promise<number> {
  const scores = await getModelFeedbackScores();
  const match = scores.find(s => s.model === modelName);
  return match?.helpfulPct ?? 50;
}
