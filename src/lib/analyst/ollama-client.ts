/**
 * DEPENDENCIES
 * Consumed by: analyst-service.ts, /api/analyst/* routes
 * Consumes: nothing (standalone HTTP client)
 * Risk-sensitive: NO — read-only, no trade execution, no DB writes
 * Notes: HTTP client for local Ollama API. Never imports sacred files.
 *        Never calls trade execution, stop modification, or settings APIs.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_TIMEOUT_MS = 180_000; // 180s for non-streaming generation
const OLLAMA_HEALTH_TIMEOUT_MS = 5_000; // 5s for health checks

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  think?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    num_ctx?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaHealthResult {
  available: boolean;
  models: OllamaModel[];
  selectedModel: string | null;
  latencyMs: number | null;
  error?: string;
  baseUrl: string;
}

/**
 * List all locally available Ollama models.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as OllamaTagsResponse;
    return data.models || [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if Ollama is reachable and has models available.
 */
export async function checkOllamaHealth(preferredModel?: string): Promise<OllamaHealthResult> {
  const start = Date.now();
  try {
    const models = await listOllamaModels();
    const latencyMs = Date.now() - start;

    if (models.length === 0) {
      return {
        available: false,
        models: [],
        selectedModel: null,
        latencyMs,
        error: 'Ollama is running but no models are installed. Run: ollama pull gemma3:4b',
        baseUrl: OLLAMA_BASE_URL,
      };
    }

    // Pick model: preferred > first gemma > first available
    const selectedModel = pickModel(models, preferredModel);

    return {
      available: true,
      models,
      selectedModel,
      latencyMs,
      baseUrl: OLLAMA_BASE_URL,
    };
  } catch (err) {
    return {
      available: false,
      models: [],
      selectedModel: null,
      latencyMs: Date.now() - start,
      error: `Ollama not reachable at ${OLLAMA_BASE_URL}. Is it running? (ollama serve)`,
      baseUrl: OLLAMA_BASE_URL,
    };
  }
}

/**
 * Pick the best model from available list.
 * Priority: user-preferred > gemma > llama > first available.
 */
export function pickModel(models: OllamaModel[], preferred?: string): string {
  if (!models.length) return '';

  // Exact match for preferred
  if (preferred) {
    const exact = models.find(m => m.name === preferred);
    if (exact) return exact.name;
    // Partial match (e.g. "gemma3" matches "gemma3:4b")
    const partial = models.find(m => m.name.startsWith(preferred));
    if (partial) return partial.name;
  }

  // Prefer gemma, then llama, then anything
  const gemma = models.find(m => m.name.toLowerCase().includes('gemma'));
  if (gemma) return gemma.name;

  const llama = models.find(m => m.name.toLowerCase().includes('llama'));
  if (llama) return llama.name;

  return models[0].name;
}

export type AnalystContext = 'summary' | 'explain' | 'short';

/**
 * Pick a model appropriate for the context.
 * - 'summary': prefer larger models for system-wide analysis
 * - 'explain': prefer larger models for detailed explanations
 * - 'short': prefer smaller models for quick inline explanations
 * Falls back to pickModel if no context-appropriate choice is available.
 */
export function pickModelForContext(models: OllamaModel[], context: AnalystContext, preferred?: string): string {
  if (preferred) return pickModel(models, preferred);
  if (!models.length) return '';

  // Sort by size
  const sorted = [...models].sort((a, b) => a.size - b.size);
  const small = sorted[0]; // Smallest available
  const large = sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0]; // Largest available

  switch (context) {
    case 'summary':
    case 'explain':
      return large.name;
    case 'short':
      return small.name;
    default:
      return pickModel(models);
  }
}

/**
 * Generate a completion from Ollama. Returns the text response.
 * Non-streaming for simplicity. Returns null if Ollama is unavailable.
 */
export async function ollamaGenerate(
  request: OllamaGenerateRequest
): Promise<OllamaGenerateResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false, think: false }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[Ollama] Generate failed: ${res.status} ${res.statusText}`);
      return null;
    }

    return (await res.json()) as OllamaGenerateResponse;
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes('abort')) {
      console.error('[Ollama] Generate timed out after', OLLAMA_TIMEOUT_MS, 'ms');
    } else {
      console.error('[Ollama] Generate error:', msg);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stream a completion from Ollama. Returns a ReadableStream of NDJSON tokens.
 * Each line is JSON: { response: string, done: boolean }.
 * The abort controller handles timeout cleanup.
 */
export async function ollamaGenerateStream(
  request: OllamaGenerateRequest
): Promise<{ body: ReadableStream<Uint8Array>; model: string; abort: () => void } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true, think: false }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      clearTimeout(timeout);
      console.error(`[Ollama] Stream failed: ${res.status} ${res.statusText}`);
      return null;
    }

    return {
      body: res.body,
      model: request.model,
      abort: () => {
        clearTimeout(timeout);
        controller.abort();
      },
    };
  } catch (err) {
    clearTimeout(timeout);
    const msg = (err as Error).message || String(err);
    console.error('[Ollama] Stream error:', msg);
    return null;
  }
}
