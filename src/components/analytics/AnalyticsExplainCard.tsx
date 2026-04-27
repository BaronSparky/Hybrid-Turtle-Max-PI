'use client';

/**
 * DEPENDENCIES
 * Consumed by: /score-validation page, /filter-scorecard page
 * Consumes: /api/analyst/analytics-explain (Ollama, streaming SSE)
 * Risk-sensitive: NO — read-only, advisory only
 * Notes: Reusable AI explain card for analytics pages. Accepts a context string
 *        (metrics summary) and asks the analyst to interpret it in plain English.
 *        Uses SSE streaming for token-by-token display.
 *        Used for Score Lab and Filter Scorecard pages.
 */

import { useState, useRef } from 'react';
import { BrainCircuit, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react';

interface AnalyticsExplainCardProps {
  title: string;
  contextSummary: string;
  question: string;
}

export default function AnalyticsExplainCard({ title, contextSummary, question }: AnalyticsExplainCardProps) {
  const [streamedText, setStreamedText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleExplain = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setDone(false);
    setStreamedText('');
    setError(null);
    setFeedback(null);
    setStartTime(Date.now());

    try {
      const res = await fetch('/api/analyst/analytics-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextSummary, question, stream: true }),
        signal: controller.signal,
      });

      // Check if JSON fallback (unavailable)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await res.json();
        if (!body.available) {
          setError('Ollama is offline. Start it with: ollama serve');
          setStreaming(false);
          return;
        }
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message || `Error ${res.status}`);
        setStreaming(false);
        return;
      }

      // Read model from header
      const modelHeader = res.headers.get('X-Model');
      if (modelHeader) setModelUsed(modelHeader);

      // Stream SSE tokens
      const reader = res.body?.getReader();
      if (!reader) { setError('No stream'); setStreaming(false); return; }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; text?: string; model?: string };
            if (event.type === 'start' && event.model) setModelUsed(event.model);
            else if (event.type === 'token' && event.text) setStreamedText(prev => prev + event.text);
            else if (event.type === 'done') { setDone(true); setStreaming(false); return; }
          } catch { /* skip */ }
        }
      }
      setDone(true);
      setStreaming(false);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to get explanation');
      setStreaming(false);
    }
  };

  const elapsedSec = startTime ? Math.round((Date.now() - startTime) / 1000) : null;

  return (
    <div className="card-surface border-l-4 border-l-violet-500/60 p-4 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-violet-400" />
          {title}
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/30">
            ADVISORY
          </span>
        </h3>
        {modelUsed && (
          <span className="text-[10px] text-muted-foreground">{modelUsed}{done && elapsedSec ? ` · ${elapsedSec}s` : ''}</span>
        )}
      </div>

      {!streamedText && !streaming && !error && (
        <button
          onClick={handleExplain}
          className="px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-400 text-sm font-medium hover:bg-violet-500/30 transition-colors flex items-center gap-2"
        >
          <BrainCircuit className="w-4 h-4" />
          Explain These Metrics
        </button>
      )}

      {streaming && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
            Generating explanation…
          </div>
          {streamedText && (
            <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {streamedText}
              <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="py-2">
          <p className="text-xs text-loss">{error}</p>
          <button onClick={handleExplain} className="mt-1 text-xs text-loss/80 hover:text-loss underline">Try again</button>
        </div>
      )}

      {done && streamedText && (
        <div className="space-y-2">
          <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{streamedText}</div>
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-amber-400/70">⚠️ Advisory only — verify against the data tables above.</div>
            <div className="flex items-center gap-1">
              {feedback ? (
                <span className="text-[10px] text-muted-foreground">
                  {feedback === 'up' ? '👍 Helpful' : '👎 Not helpful'}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => { setFeedback('up'); try { const key = `analyst-fb-${title}`; const data = JSON.parse(localStorage.getItem('analyst-feedback') || '{}'); data[key] = { rating: 'up', at: Date.now() }; localStorage.setItem('analyst-feedback', JSON.stringify(data)); } catch {} fetch('/api/analyst/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: `analytics:${title}`, rating: 'up', model: modelUsed }) }).catch(() => {}); }}
                    className="p-1 rounded hover:bg-emerald-500/15 text-muted-foreground/50 hover:text-emerald-400 transition-colors"
                    title="Helpful"
                  >
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => { setFeedback('down'); try { const key = `analyst-fb-${title}`; const data = JSON.parse(localStorage.getItem('analyst-feedback') || '{}'); data[key] = { rating: 'down', at: Date.now() }; localStorage.setItem('analyst-feedback', JSON.stringify(data)); } catch {} fetch('/api/analyst/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: `analytics:${title}`, rating: 'down', model: modelUsed }) }).catch(() => {}); }}
                    className="p-1 rounded hover:bg-red-500/15 text-muted-foreground/50 hover:text-red-400 transition-colors"
                    title="Not helpful"
                  >
                    <ThumbsDown className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>
          <button onClick={() => { setFeedback(null); handleExplain(); }} className="text-[10px] text-violet-400/60 hover:text-violet-400 transition-colors">Regenerate</button>
        </div>
      )}
    </div>
  );
}
