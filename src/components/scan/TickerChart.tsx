'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle, type Time } from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { apiRequest, formatApiError } from '@/lib/api-client';
import { TrendingUp, Activity, Hash, Loader2, RotateCcw } from 'lucide-react';

// ── Types ──
interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerChartProps {
  /** Array of tickers to display in the sidebar list */
  tickers: { ticker: string; sleeve?: string; status?: string }[];
  /** Currently selected ticker in the scan table (optional auto-select) */
  initialTicker?: string;
}

// ── Indicator Calculations ──
function calcRSI(closes: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcEMA(data: number[], period: number): (number | null)[] {
  const ema: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period) return ema;

  // SMA as seed
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  ema[period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) {
    ema[i] = data[i] * k + (ema[i - 1] as number) * (1 - k);
  }
  return ema;
}

function calcMACD(closes: number[]): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  const macdLine: (number | null)[] = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? (ema12[i] as number) - (ema26[i] as number) : null
  );

  // Signal line = 9-period EMA of MACD
  const macdValues = macdLine.map((v) => v ?? 0);
  const signalRaw = calcEMA(macdValues, 9);

  // Only show signal where MACD exists
  const signal = signalRaw.map((v, i) => (macdLine[i] !== null && v !== null ? v : null));
  const hist = macdLine.map((v, i) =>
    v !== null && signal[i] !== null ? v - (signal[i] as number) : null
  );

  return { macd: macdLine, signal, hist };
}

// ── Fibonacci Levels ──
function calcFibLevels(bars: DailyBar[]): { level: number; label: string; price: number }[] {
  if (bars.length === 0) return [];
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const diff = high - low;

  return [
    { level: 0, label: 'Low', price: low },
    { level: 0.236, label: 'R0.236', price: low + diff * 0.236 },
    { level: 0.382, label: 'R0.382', price: low + diff * 0.382 },
    { level: 0.5, label: 'R0.5', price: low + diff * 0.5 },
    { level: 0.618, label: 'R0.618', price: low + diff * 0.618 },
    { level: 0.786, label: 'R0.786', price: low + diff * 0.786 },
    { level: 1, label: 'High', price: high },
    { level: 1.272, label: 'E1.272', price: low + diff * 1.272 },
    { level: 1.618, label: 'E1.618', price: low + diff * 1.618 },
  ];
}

// ── Sleeve color ──
function sleeveColor(sleeve?: string) {
  switch (sleeve) {
    case 'CORE':
    case 'STOCK_CORE':
      return 'text-primary-400';
    case 'HIGH_RISK':
    case 'STOCK_HIGH_RISK':
      return 'text-amber-400';
    case 'ETF':
    case 'ETF_CORE':
      return 'text-blue-400';
    default:
      return 'text-foreground';
  }
}

function statusDot(status?: string) {
  switch (status) {
    case 'READY':
      return 'bg-emerald-400';
    case 'WATCH':
      return 'bg-amber-400';
    case 'FAR':
      return 'bg-red-400';
    default:
      return 'bg-muted-foreground';
  }
}

// ── Main Component ──
export default function TickerChart({ tickers, initialTicker }: TickerChartProps) {
  const [selectedTicker, setSelectedTicker] = useState(initialTicker || tickers[0]?.ticker || '');
  const [bars, setBars] = useState<DailyBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Indicator toggles
  const [showRSI, setShowRSI] = useState(true);
  const [showMACD, setShowMACD] = useState(true);
  const [showFib, setShowFib] = useState(true);

  // Search
  const [search, setSearch] = useState('');

  // Refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);

  // Filter tickers
  const filteredTickers = tickers.filter(
    (t) =>
      t.ticker.toLowerCase().includes(search.toLowerCase())
  );

  // ── Fetch historical data ──
  const fetchData = useCallback(async (ticker: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ bars?: DailyBar[] }>(`/api/market-data?action=historical&ticker=${ticker}`);
      // API returns newest-first; chart needs oldest-first
      const sorted = [...(data.bars || [])].reverse();
      setBars(sorted);
    } catch (error) {
      setError(formatApiError(error, 'Failed to fetch data'));
      setBars([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTicker) fetchData(selectedTicker);
  }, [selectedTicker, fetchData]);

  // ── Render Charts ──
  useEffect(() => {
    if (!chartContainerRef.current || bars.length === 0) return;

    // Clear previous
    chartContainerRef.current.innerHTML = '';
    if (rsiContainerRef.current) rsiContainerRef.current.innerHTML = '';
    if (macdContainerRef.current) macdContainerRef.current.innerHTML = '';

    const closes = bars.map((b) => b.close);

    // ── Main Candlestick Chart ──
    const mainChart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 380,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(139, 92, 246, 0.06)' },
        horzLines: { color: 'rgba(139, 92, 246, 0.06)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: 'rgba(139, 92, 246, 0.15)',
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: 'rgba(139, 92, 246, 0.15)',
        timeVisible: false,
      },
    });

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    candleSeries.setData(
      bars
        .filter((b) => b.open != null && b.high != null && b.low != null && b.close != null)
        .map((b) => ({
          time: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
    );

    // ── Fibonacci levels ──
    if (showFib) {
      const fibLevels = calcFibLevels(bars);
      const fibColors: Record<string, string> = {
        Low: 'rgba(148, 163, 184, 0.3)',
        'R0.236': 'rgba(251, 191, 36, 0.4)',
        'R0.382': 'rgba(251, 146, 60, 0.4)',
        'R0.5': 'rgba(168, 85, 247, 0.4)',
        'R0.618': 'rgba(59, 130, 246, 0.5)',
        'R0.786': 'rgba(34, 211, 238, 0.4)',
        High: 'rgba(148, 163, 184, 0.3)',
        'E1.272': 'rgba(34, 197, 94, 0.35)',
        'E1.618': 'rgba(34, 197, 94, 0.5)',
      };

      fibLevels.forEach((fib) => {
        candleSeries.createPriceLine({
          price: fib.price,
          color: fibColors[fib.label] || 'rgba(148, 163, 184, 0.2)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: fib.label,
        });
      });
    }

    // ── RSI Sub-Chart ──
    if (showRSI && rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        width: rsiContainerRef.current.clientWidth,
        height: 120,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
          fontSize: 10,
          fontFamily: 'Inter, system-ui, sans-serif',
        },
        grid: {
          vertLines: { color: 'rgba(139, 92, 246, 0.04)' },
          horzLines: { color: 'rgba(139, 92, 246, 0.04)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(139, 92, 246, 0.15)',
          scaleMargins: { top: 0.05, bottom: 0.05 },
        },
        timeScale: {
          borderColor: 'rgba(139, 92, 246, 0.15)',
          timeVisible: false,
          visible: !showMACD,
        },
        crosshair: { mode: CrosshairMode.Normal },
      });

      const rsiData = calcRSI(closes);
      const rsiSeries = rsiChart.addLineSeries({
        color: '#22d3ee',
        lineWidth: 2,
        priceLineVisible: false,
      });

      const rsiPoints = bars
        .map((b, i) => (rsiData[i] !== null ? { time: b.date as Time, value: rsiData[i] as number } : null))
        .filter((p): p is { time: Time; value: number } => p !== null);
      rsiSeries.setData(rsiPoints);

      // Overbought / Oversold lines
      const ob = rsiChart.addLineSeries({ color: 'rgba(239, 68, 68, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
      const os = rsiChart.addLineSeries({ color: 'rgba(34, 197, 94, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
      const mid = rsiChart.addLineSeries({ color: 'rgba(139, 92, 246, 0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });

      const timeRange = rsiPoints.map((p) => ({ time: p.time }));
      ob.setData(timeRange.map((t) => ({ ...t, value: 70 })));
      os.setData(timeRange.map((t) => ({ ...t, value: 30 })));
      mid.setData(timeRange.map((t) => ({ ...t, value: 50 })));

      // Sync time scale
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) mainChart.timeScale().setVisibleLogicalRange(range);
      });

      // Crosshair sync
      mainChart.subscribeCrosshairMove((param) => {
        if (param.time) rsiChart.setCrosshairPosition(NaN, param.time as Time, rsiSeries);
        else rsiChart.clearCrosshairPosition();
      });
      rsiChart.subscribeCrosshairMove((param) => {
        if (param.time) mainChart.setCrosshairPosition(NaN, param.time as Time, candleSeries);
        else mainChart.clearCrosshairPosition();
      });
    }

    // ── MACD Sub-Chart ──
    if (showMACD && macdContainerRef.current) {
      const macdChart = createChart(macdContainerRef.current, {
        width: macdContainerRef.current.clientWidth,
        height: 120,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
          fontSize: 10,
          fontFamily: 'Inter, system-ui, sans-serif',
        },
        grid: {
          vertLines: { color: 'rgba(139, 92, 246, 0.04)' },
          horzLines: { color: 'rgba(139, 92, 246, 0.04)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(139, 92, 246, 0.15)',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: 'rgba(139, 92, 246, 0.15)',
          timeVisible: false,
        },
        crosshair: { mode: CrosshairMode.Normal },
      });

      const { macd, signal, hist } = calcMACD(closes);

      // MACD line
      const macdLineSeries = macdChart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        priceLineVisible: false,
      });
      const macdPoints = bars
        .map((b, i) => (macd[i] !== null ? { time: b.date as Time, value: macd[i] as number } : null))
        .filter((p): p is { time: Time; value: number } => p !== null);
      macdLineSeries.setData(macdPoints);

      // Signal line
      const signalSeries = macdChart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1,
        priceLineVisible: false,
      });
      const signalPoints = bars
        .map((b, i) => (signal[i] !== null ? { time: b.date as Time, value: signal[i] as number } : null))
        .filter((p): p is { time: Time; value: number } => p !== null);
      signalSeries.setData(signalPoints);

      // Histogram
      const histSeries = macdChart.addHistogramSeries({
        priceLineVisible: false,
      });
      const histPoints = bars
        .map((b, i) =>
          hist[i] !== null
            ? {
                time: b.date as Time,
                value: hist[i] as number,
                color: (hist[i] as number) >= 0 ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
              }
            : null
        )
        .filter((p): p is { time: Time; value: number; color: string } => p !== null);
      histSeries.setData(histPoints);

      // Sync time scale
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) macdChart.timeScale().setVisibleLogicalRange(range);
      });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) mainChart.timeScale().setVisibleLogicalRange(range);
      });

      // Crosshair sync
      mainChart.subscribeCrosshairMove((param) => {
        if (param.time) macdChart.setCrosshairPosition(NaN, param.time as Time, macdLineSeries);
        else macdChart.clearCrosshairPosition();
      });
      macdChart.subscribeCrosshairMove((param) => {
        if (param.time) mainChart.setCrosshairPosition(NaN, param.time as Time, candleSeries);
        else mainChart.clearCrosshairPosition();
      });
    }

    mainChart.timeScale().fitContent();

    // ── Resize handler ──
    const handleResize = () => {
      if (chartContainerRef.current) {
        mainChart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      mainChart.remove();
    };
  }, [bars, showRSI, showMACD, showFib]);

  // ── Toggle Button ──
  const ToggleBtn = ({
    active,
    onClick,
    icon: Icon,
    label,
    variant,
  }: {
    active: boolean;
    onClick: () => void;
    icon: React.ElementType;
    label: string;
    variant: 'cyan' | 'blue' | 'amber';
  }) => {
    const activeStyles = {
      cyan: 'bg-cyan-400/20 border-cyan-400/50 text-cyan-300',
      blue: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
      amber: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
    }[variant];
    const dotStyles = {
      cyan: 'bg-cyan-300',
      blue: 'bg-blue-400',
      amber: 'bg-amber-400',
    }[variant];

    return (
      <button
        onClick={onClick}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
          active
            ? activeStyles
            : 'bg-navy-700/50 text-muted-foreground border-transparent hover:border-border'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        {label}
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full ml-0.5',
            active ? cn('opacity-100', dotStyles) : 'opacity-0'
          )}
        />
      </button>
    );
  };

  return (
    <div className="card-surface overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary-400" />
            Technical Chart
          </h3>
          <div className="flex items-center gap-2">
            {/* Indicator toggles */}
            <ToggleBtn
              active={showRSI}
              onClick={() => setShowRSI(!showRSI)}
              icon={Activity}
              label="RSI"
              variant="cyan"
            />
            <ToggleBtn
              active={showMACD}
              onClick={() => setShowMACD(!showMACD)}
              icon={TrendingUp}
              label="MACD"
              variant="blue"
            />
            <ToggleBtn
              active={showFib}
              onClick={() => setShowFib(!showFib)}
              icon={Hash}
              label="Fib"
              variant="amber"
            />
            <button
              onClick={() => fetchData(selectedTicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-navy-700/50 text-muted-foreground border border-transparent
                         hover:border-primary/30 hover:text-foreground transition-all"
              title="Retry / Refresh"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* ── Ticker Sidebar ── */}
        <div className="w-[140px] border-r border-border flex flex-col bg-navy-800/30">
          {/* Search */}
          <div className="p-2 border-b border-border/50">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-navy-800 border border-border/50 rounded-md px-2 py-1 text-xs
                         text-foreground placeholder:text-muted-foreground
                         focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Ticker list */}
          <div className="flex-1 overflow-y-auto max-h-[560px] scrollbar-thin">
            {filteredTickers.map((t) => (
              <button
                key={t.ticker}
                onClick={() => setSelectedTicker(t.ticker)}
                className={cn(
                  'w-full text-left px-3 py-2 text-xs font-semibold transition-all flex items-center gap-2',
                  selectedTicker === t.ticker
                    ? 'bg-primary/15 text-primary-400 border-l-2 border-l-primary-400'
                    : 'text-muted-foreground hover:text-foreground hover:bg-navy-700/40 border-l-2 border-l-transparent'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDot(t.status))} />
                {t.ticker}
              </button>
            ))}
            {filteredTickers.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground text-center">No matches</div>
            )}
          </div>
        </div>

        {/* ── Chart Area ── */}
        <div className="flex-1 min-w-0">
          {/* Title bar */}
          <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">
              {selectedTicker}
              <span className="text-muted-foreground font-normal ml-2">— Price + Context</span>
            </span>
            {bars.length > 0 && (
              <span className="text-xs text-muted-foreground font-mono">
                {bars.length} bars
              </span>
            )}
          </div>

          {/* Loading / Error / Chart */}
          {loading ? (
            <div className="flex items-center justify-center h-[380px]">
              <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">Loading {selectedTicker}...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-[380px] gap-3">
              <span className="text-sm text-loss">{error}</span>
              <button
                onClick={() => fetchData(selectedTicker)}
                className="btn-outline text-xs px-3 py-1.5"
              >
                Retry
              </button>
            </div>
          ) : bars.length === 0 ? (
            <div className="flex items-center justify-center h-[380px]">
              <span className="text-sm text-muted-foreground">Select a ticker to view chart</span>
            </div>
          ) : (
            <div>
              {/* Main candlestick */}
              <div ref={chartContainerRef} className="w-full" />

              {/* RSI panel */}
              {showRSI && (
                <div className="border-t border-border/30">
                  <div className="px-4 py-1">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-cyan-400/70">RSI (14)</span>
                  </div>
                  <div ref={rsiContainerRef} className="w-full" />
                </div>
              )}

              {/* MACD panel */}
              {showMACD && (
                <div className="border-t border-border/30">
                  <div className="px-4 py-1">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-blue-400/70">MACD (12, 26, 9)</span>
                  </div>
                  <div ref={macdContainerRef} className="w-full" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
