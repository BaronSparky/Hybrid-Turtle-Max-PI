'use client';

/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx
 * Consumes: /api/analyst/health, /api/analyst/summary (streaming), src/lib/api-client.ts
 * Risk-sensitive: NO — display-only, advisory card
 * Notes: Dashboard widget showing AI analyst summary of today's system state.
 *        Uses SSE streaming so tokens appear as they are generated.
 *        Fetches independently — does not block other dashboard widgets.
 *        Visually distinct from action cards (purple/indigo, not green/red).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiRequest } from '@/lib/api-client';
import { Loader2, BrainCircuit, WifiOff, RefreshCw, ChevronDown, ChevronUp, Settings2, Newspaper, Search } from 'lucide-react';

interface OllamaHealthResponse {
  available: boolean;
  models: Array<{ name: string; size: number }>;
  selectedModel: string | null;
  latencyMs: number | null;
  error?: string;
}

type CardState = 'loading-health' | 'offline' | 'streaming' | 'ready' | 'error';

export default function AnalystCard() {
  const [state, setState] = useState<CardState>('loading-health');
  const [health, setHealth] = useState<OllamaHealthResponse | null>(null);
  const [streamedText, setStreamedText] = useState('');
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // ── News lookup state ──
  const [newsTicker, setNewsTicker] = useState('');
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsData, setNewsData] = useState<{
    ticker: string;
    headlines: Array<{ title: string; publisher: string; ageHours: number; link: string }>;
    earnings: { nextEarningsDate: string | null; daysUntil: number | null; isEstimate: boolean };
    summary: { available: boolean; response: string | null } | null;
    sourceWarnings: string[];
  } | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [showNews, setShowNews] = useState(false);

  const fetchNews = useCallback(async (ticker: string) => {
    if (!ticker.trim()) return;
    setNewsLoading(true);
    setNewsError(null);
    setNewsData(null);
    try {
      const res = await fetch('/api/analyst/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          model: selectedModel || undefined,
          includeSummary: health?.available ?? false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNewsError(body?.error?.message || `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setNewsData(data);
    } catch (err) {
      setNewsError(err instanceof Error ? err.message : 'News fetch failed');
    } finally {
      setNewsLoading(false);
    }
  }, [selectedModel, health?.available]);

  const checkHealth = useCallback(async () => {
    setState('loading-health');
    try {
      const data = await apiRequest<OllamaHealthResponse>(
        `/api/analyst/health${selectedModel ? `?model=${encodeURIComponent(selectedModel)}` : ''}`
      );
      setHealth(data);
      if (!data.available) {
        setState('offline');
        return false;
      }
      if (data.selectedModel && !selectedModel) {
        setSelectedModel(data.selectedModel);
      }
      return true;
    } catch (err) {
      setState('offline');
      setError(err instanceof Error ? err.message : 'Failed to reach analyst');
      return false;
    }
  }, [selectedModel]);

  const fetchStreamingSummary = useCallback(async (model?: string) => {
    // Cancel any in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState('streaming');
    setStreamedText('');
    setError(null);
    setStartTime(Date.now());

    const modelParam = model || selectedModel;
    const url = `/api/analyst/summary?stream=1${modelParam ? `&model=${encodeURIComponent(modelParam)}` : ''}`;

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState('error');
        setError(body?.error?.message || `Server error ${res.status}`);
        return;
      }

      // Check if it's a JSON fallback (unavailable)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await res.json();
        if (!body.available) {
          setState('offline');
          setError(body.error || 'Analyst unavailable');
          return;
        }
      }

      // Stream SSE
      const reader = res.body?.getReader();
      if (!reader) {
        setState('error');
        setError('No response stream');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json) as { type: string; text?: string; model?: string; message?: string };
            if (event.type === 'start' && event.model) {
              setModelUsed(event.model);
            } else if (event.type === 'token' && event.text) {
              setStreamedText(prev => prev + event.text);
            } else if (event.type === 'done') {
              setState('ready');
              return;
            } else if (event.type === 'error') {
              setState('error');
              setError(event.message || 'Stream error');
              return;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // If we reach here without a 'done' event, still mark as ready
      setState('ready');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState('error');
      setError(err instanceof Error ? err.message : 'Stream failed');
    }
  }, [selectedModel]);

  // Timer for streaming state
  useEffect(() => {
    if (state !== 'streaming' || !startTime) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [state, startTime]);

  // Check health on mount, then stream summary if available
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isUp = await checkHealth();
      if (!cancelled && isUp) {
        fetchStreamingSummary();
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    const isUp = await checkHealth();
    if (isUp) {
      fetchStreamingSummary();
    }
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    setShowModelPicker(false);
    fetchStreamingSummary(model);
  };

  const disclaimer = '⚠️ **Advisory only** — verify against dashboard data before acting.';

  return (
    <section className="card-surface border-l-4 border-l-violet-500/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="bg-violet-500/15 w-8 h-8 rounded-lg flex items-center justify-center">
            <BrainCircuit className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">AI Analyst</h3>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/30">
                ADVISORY ONLY
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {modelUsed
                ? `${modelUsed}${state === 'ready' && startTime ? ` · ${Math.round((Date.now() - startTime) / 1000)}s` : ''}`
                : 'Local Ollama analyst'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Model picker toggle */}
          {health?.available && (health?.models?.length ?? 0) > 1 && (
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="p-1.5 rounded-md hover:bg-surface-2 transition-colors text-muted-foreground hover:text-foreground"
              title="Choose model"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={state === 'loading-health' || state === 'streaming'}
            className="p-1.5 rounded-md hover:bg-surface-2 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Refresh summary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(state === 'loading-health' || state === 'streaming') ? 'animate-spin' : ''}`} />
          </button>

          {/* Expand/collapse */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-md hover:bg-surface-2 transition-colors text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Model picker dropdown */}
      {showModelPicker && health?.models && (
        <div className="mx-4 mb-2 p-2 rounded-lg bg-surface-2 border border-border">
          <p className="text-xs text-muted-foreground mb-1.5">Select model:</p>
          <div className="flex flex-wrap gap-1.5">
            {health.models.map((m) => (
              <button
                key={m.name}
                onClick={() => handleModelChange(m.name)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  m.name === selectedModel
                    ? 'bg-violet-500/25 text-violet-300 border border-violet-500/40'
                    : 'bg-surface-3 text-muted-foreground border border-border hover:border-violet-500/30 hover:text-foreground'
                }`}
              >
                {m.name}
                <span className="ml-1 text-[10px] opacity-60">
                  ({(m.size / 1e9).toFixed(1)}GB)
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* Loading health */}
          {state === 'loading-health' && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              Connecting to local analyst…
            </div>
          )}

          {/* Offline */}
          {state === 'offline' && (
            <div className="flex items-center gap-3 py-4 px-3 rounded-lg bg-surface-2 border border-border">
              <WifiOff className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">Analyst offline</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {health?.error || error || 'Start Ollama to enable AI summaries: ollama serve'}
                </p>
              </div>
            </div>
          )}

          {/* Streaming — show tokens as they arrive */}
          {state === 'streaming' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                Generating summary… {elapsedSec > 0 && `${elapsedSec}s`}
              </div>
              {streamedText && (
                <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {streamedText}
                  <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {state === 'error' && (
            <div className="py-3 px-3 rounded-lg bg-loss/10 border border-loss/30">
              <p className="text-sm text-loss">{error || 'Something went wrong'}</p>
              <button
                onClick={handleRefresh}
                className="mt-2 text-xs text-loss/80 hover:text-loss underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Summary ready */}
          {state === 'ready' && streamedText && (
            <div className="space-y-2">
              <div className="text-[10px] text-amber-400/70 mb-1">{disclaimer}</div>
              <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {streamedText}
              </div>
            </div>
          )}

          {/* ── News & Catalyst Lookup ── */}
          <div className="mt-3 pt-3 border-t border-border/50">
            <button
              onClick={() => setShowNews(!showNews)}
              className="flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors"
            >
              <Newspaper className="w-3.5 h-3.5" />
              News &amp; Catalyst Check
              {showNews ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showNews && (
              <div className="mt-2 space-y-2">
                {/* Ticker input */}
                <form
                  onSubmit={(e) => { e.preventDefault(); fetchNews(newsTicker); }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={newsTicker}
                    onChange={(e) => setNewsTicker(e.target.value.toUpperCase())}
                    placeholder="Ticker, e.g. AAPL"
                    maxLength={10}
                    className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-surface-2 border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-violet-500/50"
                  />
                  <button
                    type="submit"
                    disabled={newsLoading || !newsTicker.trim()}
                    className="px-2.5 py-1.5 rounded-md bg-violet-500/20 border border-violet-500/30 text-violet-400 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-40 transition-colors flex items-center gap-1"
                  >
                    {newsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    Check
                  </button>
                </form>

                {/* News error */}
                {newsError && (
                  <p className="text-xs text-loss">{newsError}</p>
                )}

                {/* News results */}
                {newsData && (
                  <div className="space-y-2">
                    {/* Earnings */}
                    <div className="px-2.5 py-2 rounded-md bg-surface-2 border border-border">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Earnings</p>
                      {newsData.earnings.nextEarningsDate ? (
                        <p className={`text-xs ${(newsData.earnings.daysUntil ?? 99) <= 10 ? 'text-amber-400 font-semibold' : 'text-foreground/80'}`}>
                          {new Date(newsData.earnings.nextEarningsDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {' '}({newsData.earnings.daysUntil} days)
                          {(newsData.earnings.daysUntil ?? 99) <= 10 && ' ⚠️ EVENT RISK'}
                          {newsData.earnings.isEstimate && ' (estimated)'}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No earnings date announced</p>
                      )}
                    </div>

                    {/* Headlines */}
                    <div className="px-2.5 py-2 rounded-md bg-surface-2 border border-border">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Recent Headlines</p>
                      {newsData.headlines.length > 0 ? (
                        <ul className="space-y-1.5">
                          {newsData.headlines.map((h, i) => (
                            <li key={i} className="text-xs leading-snug">
                              <a href={h.link} target="_blank" rel="noopener noreferrer" className="text-foreground/80 hover:text-violet-400 transition-colors">
                                {h.title}
                              </a>
                              <span className="text-muted-foreground/60 ml-1">
                                — {h.publisher}, {h.ageHours < 1 ? '<1h' : `${Math.round(h.ageHours)}h`} ago
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">No recent headlines</p>
                      )}
                    </div>

                    {/* LLM Summary */}
                    {newsData.summary?.available && newsData.summary.response && (
                      <div className="px-2.5 py-2 rounded-md bg-violet-500/5 border border-violet-500/20">
                        <p className="text-[10px] font-semibold text-violet-400/70 uppercase tracking-wide mb-1">AI Context Review</p>
                        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{newsData.summary.response}</p>
                      </div>
                    )}

                    {/* Source warnings */}
                    {newsData.sourceWarnings.length > 0 && (
                      <p className="text-[10px] text-amber-400/60">{newsData.sourceWarnings.join('; ')}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
