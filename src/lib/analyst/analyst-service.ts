/**
 * DEPENDENCIES
 * Consumed by: /api/analyst/* routes
 * Consumes: ollama-client.ts, prompt-builder.ts, safety-filter.ts
 * Risk-sensitive: NO — read-only analyst, no trade execution, no DB writes
 * Notes: Orchestrates the analyst pipeline: fetch data → build prompt → call Ollama → filter response.
 *        NEVER imports sacred files. NEVER writes to the database. NEVER calls execution endpoints.
 */

import { ollamaGenerate, ollamaGenerateStream, checkOllamaHealth, pickModel, pickModelForContext, type OllamaModel, type AnalystContext } from './ollama-client';
import {
  buildSystemSummaryPrompt,
  buildCandidateExplainPrompt,
  buildStopExplainPrompt,
  buildJournalDraftPrompt,
  buildNewsContextPrompt,
  buildTradePulseExplainPrompt,
  type SystemSummaryData,
  type CandidateExplainData,
  type StopExplainData,
  type JournalDraftData,
  type NewsContextData,
  type TradePulseExplainData,
} from './prompt-builder';
import { checkResponseSafety, checkForFabricatedNumbers } from './safety-filter';

export interface AnalystResult {
  available: boolean;
  response: string | null;
  model: string | null;
  durationMs: number | null;
  safetyWarnings: string[];
  fabricationWarnings: string[];
}

const GENERATION_OPTIONS = {
  temperature: 0.3, // Low temperature for factual summaries
  top_p: 0.9,
  num_predict: 300, // ~225 words — keeps responses concise and fast (~60s on CPU)
  num_ctx: 4096,
};

// ── LLM response cache (30-minute TTL, keyed by prompt hash) ──

const LLM_CACHE_TTL_MS = 30 * 60 * 1000;

interface LlmCacheEntry {
  result: AnalystResult;
  expiresAt: number;
}

const llmCache = new Map<string, LlmCacheEntry>();

function hashPrompt(system: string, prompt: string, model: string): string {
  // Simple hash — djb2 variant. Good enough for cache keys.
  let hash = 5381;
  const input = `${model}:${system}:${prompt}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function getLlmCached(key: string): AnalystResult | null {
  const entry = llmCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    llmCache.delete(key);
    return null;
  }
  return entry.result;
}

function setLlmCache(key: string, result: AnalystResult): void {
  llmCache.set(key, { result, expiresAt: Date.now() + LLM_CACHE_TTL_MS });
  // Bounded eviction
  if (llmCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of llmCache) {
      if (now > v.expiresAt) llmCache.delete(k);
    }
  }
}

/**
 * Generate a system summary using Ollama.
 */
export async function generateSystemSummary(
  data: SystemSummaryData,
  preferredModel?: string
): Promise<AnalystResult> {
  return runAnalystPipeline(
    () => buildSystemSummaryPrompt(data),
    preferredModel,
    'summary'
  );
}

/**
 * Generate a candidate explanation using Ollama.
 */
export async function generateCandidateExplanation(
  data: CandidateExplainData,
  preferredModel?: string
): Promise<AnalystResult> {
  return runAnalystPipeline(
    () => buildCandidateExplainPrompt(data),
    preferredModel,
    'short'
  );
}

/**
 * Generate a stop explanation using Ollama.
 */
export async function generateStopExplanation(
  data: StopExplainData,
  preferredModel?: string
): Promise<AnalystResult> {
  return runAnalystPipeline(
    () => buildStopExplainPrompt(data),
    preferredModel
  );
}

/**
 * Generate a journal draft using Ollama.
 */
export async function generateJournalDraft(
  data: JournalDraftData,
  preferredModel?: string
): Promise<AnalystResult> {
  return runAnalystPipeline(
    () => buildJournalDraftPrompt(data),
    preferredModel
  );
}

/**
 * Generate a news + earnings context summary using Ollama.
 * Source data is fetched separately via news-fetcher.ts (Yahoo Finance, free).
 */
export async function generateNewsContextSummary(
  data: NewsContextData,
  preferredModel?: string
): Promise<AnalystResult> {
  return runAnalystPipeline(
    () => buildNewsContextPrompt(data),
    preferredModel,
    'short'
  );
}

/**
 * Generate a plain-English Trade Pulse explanation using Ollama.
 */
export async function generateTradePulseExplanation(
  data: TradePulseExplainData,
  preferredModel?: string
): Promise<AnalystResult> {
  return runAnalystPipeline(
    () => buildTradePulseExplainPrompt(data),
    preferredModel
  );
}

/**
 * Core pipeline: check health → build prompt → check cache → generate → safety check → cache result.
 */
async function runAnalystPipeline(
  buildPrompt: () => { system: string; prompt: string; contextNumbers: number[] },
  preferredModel?: string,
  contextHint: AnalystContext = 'explain'
): Promise<AnalystResult> {
  const start = Date.now();

  // Check Ollama availability (use context-aware model selection)
  const health = await checkOllamaHealth();
  if (!health.available || !health.models.length) {
    return {
      available: false,
      response: null,
      model: null,
      durationMs: Date.now() - start,
      safetyWarnings: [],
      fabricationWarnings: [],
    };
  }

  const selectedModel = pickModelForContext(health.models, contextHint, preferredModel);
  if (!selectedModel) {
    return {
      available: false,
      response: null,
      model: null,
      durationMs: Date.now() - start,
      safetyWarnings: [],
      fabricationWarnings: [],
    };
  }

  // Build prompt
  const { system, prompt, contextNumbers } = buildPrompt();

  // Check LLM cache
  const cacheKey = hashPrompt(system, prompt, selectedModel);
  const cached = getLlmCached(cacheKey);
  if (cached) {
    return { ...cached, durationMs: Date.now() - start };
  }

  // Call Ollama
  const result = await ollamaGenerate({
    model: selectedModel,
    system,
    prompt,
    options: GENERATION_OPTIONS,
  });

  if (!result) {
    return {
      available: true,
      response: null,
      model: selectedModel,
      durationMs: Date.now() - start,
      safetyWarnings: ['Ollama generation returned no result'],
      fabricationWarnings: [],
    };
  }

  // Safety check response
  const safety = checkResponseSafety(result.response);
  const fabricationWarnings = checkForFabricatedNumbers(result.response, contextNumbers);

  if (!safety.safe) {
    console.warn('[Analyst] Safety warnings:', safety.warnings);
  }
  if (fabricationWarnings.length > 0) {
    console.warn('[Analyst] Possible fabricated numbers:', fabricationWarnings);
  }

  const analystResult: AnalystResult = {
    available: true,
    response: safety.cleaned,
    model: selectedModel,
    durationMs: Date.now() - start,
    safetyWarnings: safety.warnings,
    fabricationWarnings,
  };

  // Cache successful results
  if (analystResult.response) {
    setLlmCache(cacheKey, analystResult);
  }

  return analystResult;
}

export interface StreamingAnalystResult {
  available: boolean;
  stream: ReadableStream<Uint8Array> | null;
  model: string | null;
  error?: string;
}

/**
 * Streaming version of the summary pipeline. Returns a ReadableStream of
 * Server-Sent Events so the frontend can show tokens as they arrive.
 */
export async function streamSystemSummary(
  data: SystemSummaryData,
  preferredModel?: string
): Promise<StreamingAnalystResult> {
  return runStreamingPipeline(
    () => buildSystemSummaryPrompt(data),
    preferredModel
  );
}

/**
 * Streaming version of the candidate explanation pipeline.
 */
export async function streamCandidateExplanation(
  data: CandidateExplainData,
  preferredModel?: string
): Promise<StreamingAnalystResult> {
  return runStreamingPipeline(
    () => buildCandidateExplainPrompt(data),
    preferredModel
  );
}

/**
 * Streaming version of the stop explanation pipeline.
 */
export async function streamStopExplanation(
  data: StopExplainData,
  preferredModel?: string
): Promise<StreamingAnalystResult> {
  return runStreamingPipeline(
    () => buildStopExplainPrompt(data),
    preferredModel
  );
}

/**
 * Streaming version of the journal draft pipeline.
 */
export async function streamJournalDraft(
  data: JournalDraftData,
  preferredModel?: string
): Promise<StreamingAnalystResult> {
  return runStreamingPipeline(
    () => buildJournalDraftPrompt(data),
    preferredModel
  );
}

/**
 * Core streaming pipeline: check health → build prompt → stream from Ollama.
 * Returns a ReadableStream that emits SSE-formatted chunks.
 */
async function runStreamingPipeline(
  buildPrompt: () => { system: string; prompt: string; contextNumbers: number[] },
  preferredModel?: string
): Promise<StreamingAnalystResult> {
  const health = await checkOllamaHealth(preferredModel);
  if (!health.available || !health.selectedModel) {
    return { available: false, stream: null, model: null, error: health.error };
  }

  const { system, prompt } = buildPrompt();

  const ollamaResult = await ollamaGenerateStream({
    model: health.selectedModel,
    system,
    prompt,
    options: GENERATION_OPTIONS,
  });

  if (!ollamaResult) {
    return { available: true, stream: null, model: health.selectedModel, error: 'Stream failed' };
  }

  // Transform Ollama's NDJSON body into SSE for the browser.
  // Use a TransformStream to pipe chunks through.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = '';
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'start', model: ollamaResult.model })}\n\n`)
      );
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { response?: string; done?: boolean };
          if (parsed.response) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'token', text: parsed.response })}\n\n`)
            );
          }
          if (parsed.done) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          }
        } catch {
          // Skip malformed JSON
        }
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer) as { response?: string };
          if (parsed.response) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'token', text: parsed.response })}\n\n`)
            );
          }
        } catch { /* skip */ }
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
    },
  });

  const sseStream = ollamaResult.body.pipeThrough(transform);

  return { available: true, stream: sseStream, model: health.selectedModel };
}
