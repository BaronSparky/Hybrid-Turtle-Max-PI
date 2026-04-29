'use client';

/**
 * DEPENDENCIES
 * Consumed by: /portfolio/positions page
 * Consumes: /api/journal/[positionId]/entry, /api/journal/[positionId]/close, /api/journal
 * Risk-sensitive: NO — journal notes only
 * Last modified: 2026-03-03
 * Notes: Slide-in drawer for per-position journal editing.
 *        Auto-saves on blur with debounce. Never navigates away.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { formatPrice, formatPercent, cn } from '@/lib/utils';
import {
  X,
  BookOpen,
  Star,
  Pencil,
  Check,
  AlertTriangle,
  Loader2,
  Lock,
} from 'lucide-react';

// ── Types ──

interface JournalData {
  entryNote: string | null;
  entryConfidence: number | null;
  closeNote: string | null;
  learnedNote: string | null;
  entryNoteAt: string | null;
  closeNoteAt: string | null;
}

/** Position context passed from the positions table — no extra API call needed */
export interface JournalPositionContext {
  id: string;
  ticker: string;
  name: string;
  status: string;
  protectionLevel: string;
  entryPrice: number;
  currentStop: number;
  currentPrice: number;
  rMultiple: number;
  gainPercent: number;
  priceCurrency?: string;
  entryDate: string;
}

type DrawerTab = 'entry' | 'trade' | 'close';

interface JournalDrawerProps {
  positionId: string | null;
  initialTab?: DrawerTab;
  /** Position context from the already-loaded table data */
  positionContext?: JournalPositionContext | null;
  onClose: () => void;
}

// ── Save status ──

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === 'saving') {
    return (
      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="text-[10px] text-profit flex items-center gap-1">
        <Check className="w-3 h-3" /> Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-[10px] text-loss flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> {error || 'Save failed — try again'}
      </span>
    );
  }
  return null;
}

// ── Days held helper ──

function daysHeld(entryDate: string): number {
  const start = new Date(entryDate).getTime();
  return Math.max(1, Math.round((Date.now() - start) / (1000 * 60 * 60 * 24)));
}

// ── Component ──

export default function JournalDrawer({
  positionId,
  initialTab = 'entry',
  positionContext,
  onClose,
}: JournalDrawerProps) {
  const isOpen = positionId !== null;
  const [activeTab, setActiveTab] = useState<DrawerTab>(initialTab);
  const [journal, setJournal] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Field states
  const [entryNote, setEntryNote] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [tradeNote, setTradeNote] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [learnedNote, setLearnedNote] = useState('');

  // Save statuses per tab
  const [entrySaveStatus, setEntrySaveStatus] = useState<SaveStatus>('idle');
  const [entrySaveError, setEntrySaveError] = useState<string>('');
  const [closeSaveStatus, setCloseSaveStatus] = useState<SaveStatus>('idle');
  const [closeSaveError, setCloseSaveError] = useState<string>('');

  // Ref to track which positionId we loaded for (prevents stale saves)
  const loadedIdRef = useRef<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset on tab change from props
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab, positionId]);

  // Fetch journal data when positionId changes
  useEffect(() => {
    if (!positionId) {
      setJournal(null);
      setNotFound(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    loadedIdRef.current = positionId;

    // Fetch all journal entries and find the one for this position
    apiRequest<{ entries: Array<{ positionId: string; entryNote: string | null; entryConfidence: number | null; closeNote: string | null; learnedNote: string | null; entryNoteAt: string | null; closeNoteAt: string | null }> }>('/api/journal')
      .then((data) => {
        if (cancelled) return;
        const match = data.entries?.find((e) => e.positionId === positionId);
        const jdata: JournalData = {
          entryNote: match?.entryNote ?? null,
          entryConfidence: match?.entryConfidence ?? null,
          closeNote: match?.closeNote ?? null,
          learnedNote: match?.learnedNote ?? null,
          entryNoteAt: match?.entryNoteAt ?? null,
          closeNoteAt: match?.closeNoteAt ?? null,
        };
        setJournal(jdata);
        setEntryNote(jdata.entryNote ?? '');
        setConfidence(jdata.entryConfidence ?? 3);
        setCloseNote(jdata.closeNote ?? '');
        setLearnedNote(jdata.learnedNote ?? '');
        setEntrySaveStatus('idle');
        setCloseSaveStatus('idle');
      })
      .catch(() => {
        if (cancelled) return;
        // No journal entry yet — show empty
        setJournal({ entryNote: null, entryConfidence: null, closeNote: null, learnedNote: null, entryNoteAt: null, closeNoteAt: null });
        setEntryNote('');
        setConfidence(3);
        setCloseNote('');
        setLearnedNote('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [positionId]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Clear "Saved" indicator after 2s
  const flashSaved = useCallback((setter: (s: SaveStatus) => void) => {
    setter('saved');
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setter('idle'), 2000);
  }, []);

  // ── Auto-save: Entry ──
  const saveEntry = useCallback(async () => {
    if (!positionId || positionId !== loadedIdRef.current) return;
    if (!entryNote.trim()) return;

    setEntrySaveStatus('saving');
    try {
      await apiRequest(`/api/journal/${positionId}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryNote: entryNote.trim(), entryConfidence: confidence }),
      });
      flashSaved(setEntrySaveStatus);
    } catch (err) {
      setEntrySaveStatus('error');
      setEntrySaveError(formatApiError(err, 'Save failed'));
    }
  }, [positionId, entryNote, confidence, flashSaved]);

  // ── Auto-save: Close ──
  const saveClose = useCallback(async () => {
    if (!positionId || positionId !== loadedIdRef.current) return;
    if (!closeNote.trim()) return;

    setCloseSaveStatus('saving');
    try {
      await apiRequest(`/api/journal/${positionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closeNote: closeNote.trim(),
          learnedNote: learnedNote.trim() || undefined,
        }),
      });
      flashSaved(setCloseSaveStatus);
    } catch (err) {
      setCloseSaveStatus('error');
      setCloseSaveError(formatApiError(err, 'Save failed'));
    }
  }, [positionId, closeNote, learnedNote, flashSaved]);

  // Save on confidence change
  const handleConfidenceChange = useCallback((n: number) => {
    setConfidence(n);
    // Debounced save — but confidence is immediate (no typing involved)
    if (positionId && entryNote.trim()) {
      setTimeout(() => {
        if (loadedIdRef.current === positionId) {
          saveEntry();
        }
      }, 300);
    }
  }, [positionId, entryNote, saveEntry]);

  const isClosed = positionContext?.status === 'CLOSED';
  const ctx = positionContext;

  const TABS: { id: DrawerTab; label: string; disabled?: boolean }[] = [
    { id: 'entry', label: 'Entry Notes' },
    { id: 'trade', label: 'Trade Notes' },
    { id: 'close', label: 'Close Notes', disabled: !isClosed },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-full sm:w-[480px] bg-navy-900/95 border-l border-border shadow-2xl shadow-black/40 flex flex-col',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ transitionTimingFunction: isOpen ? 'ease-out' : 'ease-in' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-navy-900 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 text-primary-400 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">
                {ctx ? `${ctx.ticker} — ${ctx.status}` : 'Journal'}
              </h2>
              {ctx && (
                <span className="text-[10px] text-muted-foreground">
                  {ctx.protectionLevel}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Position context strip */}
        {ctx && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border/30 text-[10px] text-muted-foreground bg-navy-800/30 flex-shrink-0 overflow-x-auto">
            <span>Entry: {formatPrice(ctx.entryPrice, ctx.priceCurrency)}</span>
            <span>Stop: {formatPrice(ctx.currentStop, ctx.priceCurrency)}</span>
            <span className={cn(ctx.rMultiple >= 0 ? 'text-profit' : 'text-loss')}>
              {ctx.rMultiple >= 0 ? '+' : ''}{ctx.rMultiple.toFixed(1)}R
            </span>
            <span>{daysHeld(ctx.entryDate)}d held</span>
            <span className={cn(ctx.gainPercent >= 0 ? 'text-profit' : 'text-loss')}>
              {ctx.gainPercent >= 0 ? '+' : ''}{ctx.gainPercent.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-border flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={cn(
                'flex-1 py-2.5 text-xs font-medium transition-colors relative',
                activeTab === tab.id
                  ? 'text-primary-400'
                  : tab.disabled
                  ? 'text-muted-foreground/30 cursor-not-allowed'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {tab.disabled && <Lock className="w-2.5 h-2.5 inline ml-1" />}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-400" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : notFound ? (
            <div className="text-center py-12">
              <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Position not found</p>
            </div>
          ) : (
            <>
              {/* Tab: Entry Notes */}
              {activeTab === 'entry' && (
                <div className="space-y-4">
                  {/* Confidence */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Confidence (1–5)</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => handleConfidenceChange(n)}
                          title={`${n} star${n !== 1 ? 's' : ''}`}
                          className={cn(
                            'p-1 transition-colors',
                            n <= confidence ? 'text-amber-400' : 'text-navy-600'
                          )}
                        >
                          <Star className="w-5 h-5" fill={n <= confidence ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Entry reasoning */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-muted-foreground">Why did you take this trade?</label>
                      <SaveIndicator status={entrySaveStatus} error={entrySaveError} />
                    </div>
                    <textarea
                      className="w-full h-32 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="What setup did you see? What made you pull the trigger?"
                      value={entryNote}
                      onChange={(e) => setEntryNote(e.target.value)}
                      onBlur={saveEntry}
                    />
                    {journal?.entryNoteAt && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Last saved: {new Date(journal.entryNoteAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab: Trade Notes (ongoing commentary) */}
              {activeTab === 'trade' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      How is this trade developing?
                    </label>
                    <textarea
                      className="w-full h-40 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Ongoing observations, stop adjustments, regime changes..."
                      value={tradeNote}
                      onChange={(e) => setTradeNote(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Trade notes are stored locally in this session only.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab: Close Notes */}
              {activeTab === 'close' && isClosed && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-muted-foreground">Why did you exit?</label>
                      <SaveIndicator status={closeSaveStatus} error={closeSaveError} />
                    </div>
                    <textarea
                      className="w-full h-28 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="What caused the exit? Stop hit, manual sale, target reached?"
                      value={closeNote}
                      onChange={(e) => setCloseNote(e.target.value)}
                      onBlur={saveClose}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Lessons learned (optional)
                    </label>
                    <textarea
                      className="w-full h-24 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="What would you do differently next time?"
                      value={learnedNote}
                      onChange={(e) => setLearnedNote(e.target.value)}
                      onBlur={saveClose}
                    />
                    {journal?.closeNoteAt && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Last saved: {new Date(journal.closeNoteAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Close tab disabled message for open positions */}
              {activeTab === 'close' && !isClosed && (
                <div className="text-center py-8 text-muted-foreground">
                  <Lock className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">Available when position closes</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
