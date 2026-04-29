'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/watchlist-news)
 * Consumes: /api/analyst/news-batch (Yahoo Finance public data)
 * Risk-sensitive: NO — read-only news aggregation, no trade execution
 * Notes: Consolidated live news feed for all portfolio + candidate tickers.
 *        Auto-refreshes every 15 minutes. Display-only / advisory.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import Navbar from '@/components/shared/Navbar';
import { Loader2, Newspaper, RefreshCw, AlertTriangle } from 'lucide-react';
import { formatApiError } from '@/lib/api-client';

interface NewsHeadline {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  ageHours: number;
}

interface SentimentTrend {
  ticker: string;
  current: string;
  direction: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
  daysCovered: number;
  entries: Array<{ sentiment: string; date: string }>;
}

interface TickerNewsItem {
  ticker: string;
  headlines: NewsHeadline[];
  earnings: { nextEarningsDate: string | null; daysUntil: number | null; isEstimate: boolean };
  warnings: string[];
  sentiment?: { sentiment: string; confidence: string };
}

interface BatchData {
  portfolio: TickerNewsItem[];
  candidates: TickerNewsItem[];
  fetchedAt: string;
}

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export default function WatchlistNewsPage() {
  const [data, setData] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trends, setTrends] = useState<Record<string, SentimentTrend>>({});
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analyst/news-batch?topN=10');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message || `Error ${res.status}`);
        return;
      }
      const result = await res.json();
      setData(result);

      // Fetch sentiment trends (best-effort)
      const allTickers = [
        ...(result.portfolio?.map((p: TickerNewsItem) => p.ticker) ?? []),
        ...(result.candidates?.map((c: TickerNewsItem) => c.ticker) ?? []),
      ];
      if (allTickers.length > 0) {
        try {
          const trendRes = await fetch(`/api/analyst/sentiment-trend?tickers=${allTickers.join(',')}`);
          if (trendRes.ok) {
            const trendData = await trendRes.json();
            setTrends(trendData.tickers ?? {});
          }
        } catch { /* best-effort */ }
      }
    } catch (err) {
      setError(formatApiError(err, 'Failed to fetch news'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    refreshTimer.current = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchData]);

  const allItems = [
    ...(data?.portfolio.map(p => ({ ...p, group: 'portfolio' as const })) ?? []),
    ...(data?.candidates.map(c => ({ ...c, group: 'candidate' as const })) ?? []),
  ];

  // Flatten all headlines for a unified feed, sorted by recency
  const allHeadlines = allItems
    .flatMap(item => item.headlines.map(h => ({
      ...h,
      ticker: item.ticker,
      group: item.group,
      sentiment: item.sentiment?.sentiment,
    })))
    .sort((a, b) => a.ageHours - b.ageHours);

  const earningsAlerts = allItems.filter(item => (item.earnings.daysUntil ?? 99) <= 10);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-violet-400" />
              Watchlist News Feed
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live news for portfolio holdings + top scan candidates. Auto-refreshes every 15 minutes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground">
                Updated {new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded-md hover:bg-navy-600 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
              title="Refresh now"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Earnings alerts */}
        {earningsAlerts.length > 0 && (
          <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <h2 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Upcoming Earnings
            </h2>
            <div className="flex flex-wrap gap-3">
              {earningsAlerts
                .sort((a, b) => (a.earnings.daysUntil ?? 99) - (b.earnings.daysUntil ?? 99))
                .map(item => (
                  <div key={item.ticker} className="flex items-center gap-1.5 text-sm">
                    <span className={`font-semibold ${(item.earnings.daysUntil ?? 99) <= 5 ? 'text-amber-400' : 'text-foreground'}`}>
                      {item.ticker}
                    </span>
                    <span className="text-muted-foreground">
                      {item.earnings.daysUntil}d
                      {(item.earnings.daysUntil ?? 99) <= 5 && ' ⚠️'}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      ({item.group === 'portfolio' ? 'held' : 'candidate'})
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="card-surface p-12 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
            Loading news feed…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card-surface p-6 text-center">
            <p className="text-loss text-sm">{error}</p>
            <button onClick={fetchData} className="mt-2 text-xs text-loss/80 hover:text-loss underline">Retry</button>
          </div>
        )}

        {/* News feed */}
        {data && !loading && allHeadlines.length === 0 && (
          <div className="card-surface p-8 text-center text-muted-foreground">
            No recent headlines for your watchlist.
          </div>
        )}

        {allHeadlines.length > 0 && (
          <div className="card-surface divide-y divide-border/30">
            {allHeadlines.map((h, i) => (
              <div key={`${h.ticker}-${i}`} className="px-4 py-3 hover:bg-navy-600/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <a
                      href={h.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-foreground/90 hover:text-violet-400 transition-colors leading-snug"
                    >
                      {h.title}
                    </a>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{h.publisher}</span>
                      <span className="text-xs text-muted-foreground/50">•</span>
                      <span className="text-xs text-muted-foreground/50">
                        {h.ageHours < 1 ? '<1h ago' : `${Math.round(h.ageHours)}h ago`}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1.5">
                    {h.sentiment === 'POSITIVE' && <span className="text-emerald-400 text-xs" title="Positive sentiment">▲</span>}
                    {h.sentiment === 'NEGATIVE' && <span className="text-red-400 text-xs" title="Negative sentiment">▼</span>}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      h.group === 'portfolio'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                    }`}>
                      {h.ticker}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sentiment Trend Summary */}
        {data && Object.keys(trends).length > 0 && (
          <div className="card-surface p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Sentiment Trends</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {allItems.map(item => {
                const trend = trends[item.ticker];
                if (!trend) return null;
                const dirIcon = trend.direction === 'IMPROVING' ? '📈'
                  : trend.direction === 'DETERIORATING' ? '📉' : '➡️';
                const sentColor = trend.current === 'POSITIVE' ? 'text-emerald-400'
                  : trend.current === 'NEGATIVE' ? 'text-red-400' : 'text-muted-foreground';
                return (
                  <div key={`trend-${item.ticker}`} className="px-3 py-2 rounded-md border bg-navy-600 border-border text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-foreground">{item.ticker}</span>
                      <span className={sentColor}>{trend.current} {dirIcon}</span>
                    </div>
                    {trend.entries && trend.entries.length >= 2 && (
                      <SentimentSparkline entries={trend.entries.slice(-14)} />
                    )}
                    <div className="text-[9px] text-muted-foreground/50 mt-0.5">{trend.daysCovered}d tracked</div>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          </div>
        )}

        {/* Per-ticker earnings summary */}
        {data && (
          <div className="card-surface p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Earnings Calendar</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {allItems
                .sort((a, b) => (a.earnings.daysUntil ?? 999) - (b.earnings.daysUntil ?? 999))
                .map(item => (
                  <div
                    key={item.ticker}
                    className={`px-3 py-2 rounded-md border text-xs ${
                      (item.earnings.daysUntil ?? 99) <= 5
                        ? 'bg-amber-500/5 border-amber-500/30'
                        : 'bg-navy-600 border-border'
                    }`}
                  >
                    <span className="font-semibold text-foreground">{item.ticker}</span>
                    <span className={`ml-2 ${(item.earnings.daysUntil ?? 99) <= 5 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                      {item.earnings.nextEarningsDate
                        ? `${item.earnings.daysUntil}d`
                        : 'N/A'}
                      {(item.earnings.daysUntil ?? 99) <= 5 && ' ⚠️'}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Sentiment Sparkline ──

function SentimentSparkline({ entries }: { entries: Array<{ sentiment: string; date: string }> }) {
  const W = 80;
  const H = 20;
  const PAD = 2;

  const scores = entries.map(e =>
    e.sentiment === 'POSITIVE' ? 1 : e.sentiment === 'NEGATIVE' ? -1 : 0
  );

  const stepX = scores.length > 1 ? (W - PAD * 2) / (scores.length - 1) : 0;

  const points = scores.map((s, i) => {
    const x = PAD + i * stepX;
    const y = H / 2 - s * (H / 2 - PAD);
    return `${x},${y}`;
  }).join(' ');

  // Color based on last score
  const lastScore = scores[scores.length - 1];
  const strokeColor = lastScore > 0 ? '#34d399' : lastScore < 0 ? '#f87171' : '#6b7280';

  // Dot colors for each point
  const dotColors = scores.map(s =>
    s > 0 ? '#34d399' : s < 0 ? '#f87171' : '#6b7280'
  );

  return (
    <svg width={W} height={H} className="block" viewBox={`0 0 ${W} ${H}`}>
      {/* Zero line */}
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#374151" strokeWidth="0.5" />
      {/* Trend line */}
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        opacity="0.8"
      />
      {/* Data points */}
      {scores.map((_, i) => (
        <circle
          key={i}
          cx={PAD + i * stepX}
          cy={H / 2 - scores[i] * (H / 2 - PAD)}
          r="1.5"
          fill={dotColors[i]}
        />
      ))}
    </svg>
  );
}
