export class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: string;
  retryable?: boolean;

  constructor(message: string, status: number, code?: string, details?: string, retryable?: boolean) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

function parseErrorPayload(payload: unknown): {
  message: string;
  code?: string;
  details?: string;
  retryable?: boolean;
} {
  const fallback = { message: 'Request failed' };

  if (!payload || typeof payload !== 'object') return fallback;

  const obj = payload as Record<string, unknown>;

  // New contract: { ok: false, error: { code, message, details, retryable } }
  const nested = obj.error;
  if (nested && typeof nested === 'object') {
    const errObj = nested as Record<string, unknown>;
    return {
      message: typeof errObj.message === 'string' ? errObj.message : fallback.message,
      code: typeof errObj.code === 'string' ? errObj.code : undefined,
      details: typeof errObj.details === 'string' ? errObj.details : undefined,
      retryable: typeof errObj.retryable === 'boolean' ? errObj.retryable : undefined,
    };
  }

  // Legacy contract: { error: 'message', message?: 'details', code?: 'X' }
  return {
    message: typeof obj.error === 'string'
      ? obj.error
      : typeof obj.message === 'string'
      ? obj.message
      : fallback.message,
    code: typeof obj.code === 'string' ? obj.code : undefined,
    details: typeof obj.message === 'string' ? obj.message : undefined,
    retryable: undefined,
  };
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (networkErr) {
    // fetch() rejects with TypeError when the origin is unreachable, DNS fails,
    // CORS blocks the request, or the request is aborted before any response.
    // Surface this distinctly from server-side failures so callers can show
    // "server unreachable" rather than mis-attributing it to the API.
    const aborted = networkErr instanceof DOMException && networkErr.name === 'AbortError';
    throw new ApiClientError(
      aborted ? 'Request aborted' : 'Dashboard server unreachable',
      0,
      aborted ? 'REQUEST_ABORTED' : 'NETWORK_UNREACHABLE',
      networkErr instanceof Error ? networkErr.message : undefined,
      true,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const err = parseErrorPayload(payload);
    throw new ApiClientError(err.message, response.status, err.code, err.details, err.retryable);
  }

  return payload as T;
}

/**
 * Format an error from apiRequest into a user-friendly message string.
 * Centralises NETWORK_UNREACHABLE / REQUEST_ABORTED handling so every
 * catch block that calls this shows consistent guidance.
 */
export function formatApiError(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'NETWORK_UNREACHABLE') {
      return 'Dashboard server is not reachable. Make sure start.bat is running, then retry.';
    }
    if (err.code === 'REQUEST_ABORTED') {
      return 'Request was cancelled.';
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
