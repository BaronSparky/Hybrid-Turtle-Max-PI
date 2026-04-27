'use client';

/**
 * DEPENDENCIES
 * Consumed by: CandidateRankingsTable.tsx (per-row explain button)
 * Consumes: /api/analyst/explain (existing candidate explain endpoint)
 * Risk-sensitive: NO — read-only, advisory only
 * Notes: Compact inline explain button for a scan candidate. Calls the existing
 *        /api/analyst/explain endpoint and shows the explanation in a collapsible row.
 */

import { useState } from 'react';
import { BrainCircuit, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export default function CandidateExplainButton({ ticker }: { ticker: string }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleExplain = async () => {
    if (explanation) {
      setExpanded(!expanded);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analyst/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candidate', ticker }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message || `Error ${res.status}`);
        return;
      }
      const result = await res.json();
      if (!result.available) {
        setError('Ollama offline');
        return;
      }
      setExplanation(result.response);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col">
      <button
        onClick={handleExplain}
        disabled={loading}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-violet-500/15 text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-40 transition-colors"
        title={`AI explain ${ticker}`}
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <BrainCircuit className="w-3 h-3" />
        )}
        {explanation ? (expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : 'Explain'}
      </button>

      {error && <p className="text-[10px] text-loss mt-0.5">{error}</p>}

      {expanded && explanation && (
        <div className="mt-1 px-2 py-1.5 rounded bg-violet-500/5 border border-violet-500/20 text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap max-w-md">
          {explanation}
          <p className="text-[9px] text-amber-400/60 mt-1">Advisory only</p>
        </div>
      )}
    </div>
  );
}
