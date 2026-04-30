'use client';

import { useState } from 'react';
import { X, BookOpen, AlertTriangle, DollarSign, Calendar, Hash, Tag, TrendingDown, TrendingUp } from 'lucide-react';

interface RecordPastTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type TradeType = 'STOP_HIT' | 'EXIT' | 'ENTRY' | 'ADD' | 'TRIM';

export default function RecordPastTradeModal({ isOpen, onClose, onSaved }: RecordPastTradeModalProps) {
  const [ticker, setTicker] = useState('');
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0]);
  const [tradeType, setTradeType] = useState<TradeType>('STOP_HIT');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [shares, setShares] = useState('');
  const [initialStop, setInitialStop] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [gainLossGbp, setGainLossGbp] = useState('');
  const [daysHeld, setDaysHeld] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [whatWentWell, setWhatWentWell] = useState('');
  const [whatWentWrong, setWhatWentWrong] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [tags, setTags] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const entry = parseFloat(entryPrice) || 0;
  const exit = parseFloat(exitPrice) || 0;
  const stop = parseFloat(initialStop) || 0;
  const qty = parseFloat(shares) || 0;

  const initialR = entry > 0 && stop > 0 ? Math.abs(entry - stop) : 0;
  const rMultiple = initialR > 0 && exit > 0 ? (exit - entry) / initialR : null;
  const estimatedPnl = entry > 0 && exit > 0 && qty > 0 ? (exit - entry) * qty : null;

  const isClosingTrade = tradeType === 'STOP_HIT' || tradeType === 'EXIT' || tradeType === 'TRIM';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!ticker.trim()) {
      setError('Ticker is required');
      return;
    }
    if (!tradeDate) {
      setError('Trade date is required');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        ticker: ticker.trim().toUpperCase(),
        tradeDate,
        tradeType,
        decision: 'TAKEN',
      };

      if (entryPrice) body.entryPrice = parseFloat(entryPrice);
      if (exitPrice) body.exitPrice = parseFloat(exitPrice);
      if (shares) body.shares = parseFloat(shares);
      if (initialStop) body.initialStop = parseFloat(initialStop);
      if (exitReason.trim()) body.exitReason = exitReason.trim();
      if (gainLossGbp) body.gainLossGbp = parseFloat(gainLossGbp);
      if (daysHeld) body.daysHeld = parseInt(daysHeld, 10);
      if (decisionReason.trim()) body.decisionReason = decisionReason.trim();
      if (whatWentWell.trim()) body.whatWentWell = whatWentWell.trim();
      if (whatWentWrong.trim()) body.whatWentWrong = whatWentWrong.trim();
      if (lessonsLearned.trim()) body.lessonsLearned = lessonsLearned.trim();
      if (tags.trim()) body.tags = tags.trim();

      const res = await fetch('/api/trade-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Failed (${res.status})`);
      }

      // Reset form
      setTicker('');
      setTradeDate(new Date().toISOString().split('T')[0]);
      setTradeType('STOP_HIT');
      setEntryPrice('');
      setExitPrice('');
      setShares('');
      setInitialStop('');
      setExitReason('');
      setGainLossGbp('');
      setDaysHeld('');
      setDecisionReason('');
      setWhatWentWell('');
      setWhatWentWrong('');
      setLessonsLearned('');
      setTags('');

      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-navy-900 border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-navy-900 z-10">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary-400" />
            Record Past Trade
          </h2>
          <button
            onClick={onClose}
            title="Close"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Row 1: Ticker, Type, Date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> Ticker *</span>
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="BESI.AS"
                className="input-field w-full font-mono"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Trade Type *</label>
              <select
                title="Trade type"
                value={tradeType}
                onChange={(e) => setTradeType(e.target.value as TradeType)}
                className="input-field w-full"
              >
                <option value="STOP_HIT">Stop Hit</option>
                <option value="EXIT">Exit (Manual)</option>
                <option value="ENTRY">Entry</option>
                <option value="ADD">Add (Pyramid)</option>
                <option value="TRIM">Trim</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Trade Date *</span>
              </label>
              <input
                type="date"
                title="Trade date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Row 2: Entry Price, Exit Price, Shares */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Entry Price</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="0.00"
                className="input-field w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1">
                  {isClosingTrade ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                  {' '}Exit Price
                </span>
              </label>
              <input
                type="number"
                step="0.01"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="0.00"
                className="input-field w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Shares</label>
              <input
                type="number"
                step="0.001"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="0"
                className="input-field w-full font-mono"
              />
            </div>
          </div>

          {/* Row 3: Initial Stop, Days Held, P&L */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Initial Stop</label>
              <input
                type="number"
                step="0.01"
                value={initialStop}
                onChange={(e) => setInitialStop(e.target.value)}
                placeholder="0.00"
                className="input-field w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Days Held</label>
              <input
                type="number"
                step="1"
                value={daysHeld}
                onChange={(e) => setDaysHeld(e.target.value)}
                placeholder="0"
                className="input-field w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">P&L (£)</label>
              <input
                type="number"
                step="0.01"
                value={gainLossGbp}
                onChange={(e) => setGainLossGbp(e.target.value)}
                placeholder="0.00"
                className="input-field w-full font-mono"
              />
            </div>
          </div>

          {/* Computed preview */}
          {(rMultiple !== null || estimatedPnl !== null) && (
            <div className="p-3 bg-navy-700/40 border border-border rounded-lg text-sm space-y-1">
              {rMultiple !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Computed R-Multiple</span>
                  <span className={rMultiple >= 0 ? 'text-profit font-medium' : 'text-loss font-medium'}>
                    {rMultiple >= 0 ? '+' : ''}{rMultiple.toFixed(2)}R
                  </span>
                </div>
              )}
              {initialR > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Initial Risk (1R)</span>
                  <span className="text-foreground">{initialR.toFixed(2)}</span>
                </div>
              )}
              {estimatedPnl !== null && !gainLossGbp && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated raw P&L</span>
                  <span className={estimatedPnl >= 0 ? 'text-profit' : 'text-loss'}>
                    {estimatedPnl >= 0 ? '+' : ''}{estimatedPnl.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Exit reason & Decision reason */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Exit Reason</label>
              <input
                type="text"
                value={exitReason}
                onChange={(e) => setExitReason(e.target.value)}
                placeholder="e.g. Stop triggered at open"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Decision Reason</label>
              <input
                type="text"
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                placeholder="Why was this trade taken?"
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</span>
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. semiconductor, gap-down, earnings"
              className="input-field w-full"
            />
          </div>

          {/* Journal section */}
          <div className="border-t border-border pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Journal Notes (optional)</h3>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">What went well?</label>
              <textarea
                value={whatWentWell}
                onChange={(e) => setWhatWentWell(e.target.value)}
                rows={2}
                className="input-field w-full resize-y"
                placeholder="What was good about this trade?"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">What went wrong?</label>
              <textarea
                value={whatWentWrong}
                onChange={(e) => setWhatWentWrong(e.target.value)}
                rows={2}
                className="input-field w-full resize-y"
                placeholder="What would you do differently?"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Lessons learned</label>
              <textarea
                value={lessonsLearned}
                onChange={(e) => setLessonsLearned(e.target.value)}
                rows={2}
                className="input-field w-full resize-y"
                placeholder="Key takeaway from this trade"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !ticker.trim()}
              className="btn-primary disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Record Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
