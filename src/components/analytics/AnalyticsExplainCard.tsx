'use client';

/**
 * DEPENDENCIES
 * Consumed by: /score-validation page, /filter-scorecard page
 * Consumes: /api/analyst/explain (Ollama)
 * Risk-sensitive: NO — read-only, advisory only
 * Notes: Reusable AI explain card for analytics pages. Accepts a context string
 *        (metrics summary) and asks the analyst to interpret it in plain English.
 *        Used for Score Lab and Filter Scorecard pages.
 */

import { useState } from 'react';
import { BrainCircuit, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react';

interface AnalyticsExplainCardProps {
  title: string;
  contextSummary: string;
  question: string;
}

export default function AnalyticsExplainCard({ title, contextSummary, question }: AnalyticsExplainCardProps) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleExplain = async () => {
    setLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const res = await fetch('/api/analyst/analytics-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextSummary, question }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message || `Error ${res.status}`);
        return;
      }
      const result = await res.json();
      if (!result.available) {
        setError('Ollama is offline. Start it with: ollama serve');
        return;
      }
      setExplanation(result.response);
      setModelUsed(result.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get explanation');
    } finally {
      setLoading(false);
    }
  };

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
          <span className="text-[10px] text-muted-foreground">{modelUsed}</span>
        )}
      </div>

      {!explanation && !loading && !error && (
        <button
          onClick={handleExplain}
          className="px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-400 text-sm font-medium hover:bg-violet-500/30 transition-colors flex items-center gap-2"
        >
          <BrainCircuit className="w-4 h-4" />
          Explain These Metrics
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          Generating explanation…
        </div>
      )}

      {error && (
        <div className="py-2">
          <p className="text-xs text-loss">{error}</p>
          <button onClick={handleExplain} className="mt-1 text-xs text-loss/80 hover:text-loss underline">Try again</button>
        </div>
      )}

      {explanation && (
        <div className="space-y-2">
          <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{explanation}</div>
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
                    onClick={() => { setFeedback('up'); try { const key = `analyst-fb-${title}`; const data = JSON.parse(localStorage.getItem('analyst-feedback') || '{}'); data[key] = { rating: 'up', at: Date.now() }; localStorage.setItem('analyst-feedback', JSON.stringify(data)); } catch {} }}
                    className="p-1 rounded hover:bg-emerald-500/15 text-muted-foreground/50 hover:text-emerald-400 transition-colors"
                    title="Helpful"
                  >
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => { setFeedback('down'); try { const key = `analyst-fb-${title}`; const data = JSON.parse(localStorage.getItem('analyst-feedback') || '{}'); data[key] = { rating: 'down', at: Date.now() }; localStorage.setItem('analyst-feedback', JSON.stringify(data)); } catch {} }}
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
