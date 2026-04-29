'use client';

/**
 * DEPENDENCIES
 * Consumed by: app router (navigation)
 * Consumes: /api/journal, /api/journal/[positionId]/entry, /api/journal/[positionId]/close
 * Risk-sensitive: NO — journal notes only, no execution actions
 * Last modified: 2026-03-12
 * Notes: Sidebar + timeline layout. Supports ?position=xxx query param to auto-select position.
 */

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Navbar from '@/components/shared/Navbar';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { formatDate, cn } from '@/lib/utils';
import {
  BookOpen, Pencil, Star, TrendingUp, TrendingDown, X,
  ExternalLink, Clock, ChevronRight, MessageSquare, Lightbulb, LogIn, LogOut,
} from 'lucide-react';
import Link from 'next/link';

interface JournalEntry {
  id: number;
  positionId: string;
  ticker: string;
  companyName: string;
  entryDate: string;
  exitDate: string | null;
  status: string;
  entryPrice: number;
  exitPrice: number | null;
  shares: number;
  gainLoss: number | null;
  entryNote: string | null;
  entryConfidence: number | null;
  closeNote: string | null;
  learnedNote: string | null;
  entryNoteAt: string | null;
  closeNoteAt: string | null;
  createdAt: string;
}

// Modal for editing entry notes
function EntryNoteModal({
  positionId,
  existing,
  onClose,
  onSaved,
}: {
  positionId: string;
  existing: { entryNote: string | null; entryConfidence: number | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(existing.entryNote ?? '');
  const [confidence, setConfidence] = useState(existing.entryConfidence ?? 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/journal/${positionId}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryNote: note.trim(), entryConfidence: confidence }),
      });
      onSaved();
    } catch (err) {
      setError(formatApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card-surface p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Entry Note</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          className="w-full h-28 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Why did you take this trade? What setup did you see?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mt-3">
          <label className="text-xs text-muted-foreground mb-1.5 block">Confidence (1–5)</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setConfidence(n)}
                className={cn(
                  'p-1 transition-colors',
                  n <= confidence ? 'text-amber-400' : 'text-navy-600'
                )}
                title={`${n} star`}
              >
                <Star className="w-5 h-5" fill={n <= confidence ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-loss mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-navy-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !note.trim()}
            className="flex-1 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal for close notes
function CloseNoteModal({
  positionId,
  existing,
  onClose,
  onSaved,
}: {
  positionId: string;
  existing: { closeNote: string | null; learnedNote: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [closeNote, setCloseNote] = useState(existing.closeNote ?? '');
  const [learnedNote, setLearnedNote] = useState(existing.learnedNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!closeNote.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/journal/${positionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closeNote: closeNote.trim(),
          learnedNote: learnedNote.trim() || undefined,
        }),
      });
      onSaved();
    } catch (err) {
      setError(formatApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card-surface p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Close Note</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          className="w-full h-24 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Why did you close? What happened?"
          value={closeNote}
          onChange={(e) => setCloseNote(e.target.value)}
        />

        <label className="text-xs text-muted-foreground mt-3 mb-1.5 block">What did you learn? (optional)</label>
        <textarea
          className="w-full h-20 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Lessons for next time..."
          value={learnedNote}
          onChange={(e) => setLearnedNote(e.target.value)}
        />

        {error && <p className="text-xs text-loss mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-navy-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !closeNote.trim()}
            className="flex-1 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfidenceStars({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('w-3.5 h-3.5', n <= level ? 'text-amber-400' : 'text-navy-600')}
          fill={n <= level ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  );
}

function daysHeld(entryDate: string, exitDate: string | null): number {
  const start = new Date(entryDate).getTime();
  const end = exitDate ? new Date(exitDate).getTime() : Date.now();
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

export default function JournalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
          <div className="text-center py-16 text-muted-foreground text-sm">Loading journal…</div>
        </main>
      </div>
    }>
      <JournalPageInner />
    </Suspense>
  );
}

function JournalPageInner() {
  const searchParams = useSearchParams();
  const targetPositionId = searchParams.get('position');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editingClose, setEditingClose] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const data = await apiRequest<{ entries: JournalEntry[] }>('/api/journal');
      setEntries(data.entries ?? []);
    } catch {
      // Non-critical: empty state will show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Auto-select position from query param
  useEffect(() => {
    if (!loading && targetPositionId && entries.length > 0) {
      const match = entries.find((e) => e.positionId === targetPositionId);
      if (match) setSelectedId(targetPositionId);
    }
  }, [loading, targetPositionId, entries]);

  // Auto-select first position if none selected
  useEffect(() => {
    if (!loading && !selectedId && entries.length > 0) {
      setSelectedId(entries[0].positionId);
    }
  }, [loading, selectedId, entries]);

  const handleSaved = () => {
    setEditingEntry(null);
    setEditingClose(null);
    fetchEntries();
  };

  // Sort: open positions first, then by most recent activity (update or entry date)
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      // Open positions first
      if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
      if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
      // Then by most recent note activity, falling back to entry date
      const aDate = a.closeNoteAt || a.entryNoteAt || a.entryDate;
      const bDate = b.closeNoteAt || b.entryNoteAt || b.entryDate;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
  }, [entries]);

  const selectedEntry = entries.find((e) => e.positionId === selectedId) ?? null;

  // Build timeline events for the selected position
  const timelineEvents = useMemo(() => {
    if (!selectedEntry) return [];
    const events: TimelineEvent[] = [];

    // Entry event (always present)
    events.push({
      type: 'ENTRY',
      date: selectedEntry.entryDate,
      icon: LogIn,
      title: `Entered ${selectedEntry.ticker}`,
      detail: `${selectedEntry.shares} shares at £${selectedEntry.entryPrice.toFixed(2)}`,
      color: 'text-primary-400',
    });

    // Entry note (if present)
    if (selectedEntry.entryNote) {
      events.push({
        type: 'ENTRY_NOTE',
        date: selectedEntry.entryNoteAt ?? selectedEntry.entryDate,
        icon: MessageSquare,
        title: 'Entry Note',
        detail: selectedEntry.entryNote,
        confidence: selectedEntry.entryConfidence,
        color: 'text-foreground',
      });
    }

    // Exit event (if closed)
    if (selectedEntry.status === 'CLOSED' && selectedEntry.exitDate) {
      const isWin = selectedEntry.gainLoss != null && selectedEntry.gainLoss > 0;
      events.push({
        type: 'EXIT',
        date: selectedEntry.exitDate,
        icon: LogOut,
        title: `Closed ${selectedEntry.ticker}`,
        detail: selectedEntry.exitPrice
          ? `Exit at £${selectedEntry.exitPrice.toFixed(2)}${selectedEntry.gainLoss != null ? ` · ${isWin ? '+' : ''}£${selectedEntry.gainLoss.toFixed(2)}` : ''}`
          : 'Position closed',
        color: isWin ? 'text-profit' : 'text-loss',
      });
    }

    // Close note (if present)
    if (selectedEntry.closeNote) {
      events.push({
        type: 'CLOSE_NOTE',
        date: selectedEntry.closeNoteAt ?? selectedEntry.exitDate ?? selectedEntry.entryDate,
        icon: MessageSquare,
        title: 'Close Note',
        detail: selectedEntry.closeNote,
        color: 'text-foreground',
      });
    }

    // Lesson learned (if present)
    if (selectedEntry.learnedNote) {
      events.push({
        type: 'LESSON',
        date: selectedEntry.closeNoteAt ?? selectedEntry.exitDate ?? selectedEntry.entryDate,
        icon: Lightbulb,
        title: 'Lesson Learned',
        detail: selectedEntry.learnedNote,
        color: 'text-amber-400',
      });
    }

    // Sort by date ascending (chronological)
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return events;
  }, [selectedEntry]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-6 h-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-foreground">Trade Journal</h1>
          <span className="text-xs text-muted-foreground ml-2">
            {entries.filter((e) => e.status === 'OPEN').length} open · {entries.filter((e) => e.status === 'CLOSED').length} closed
          </span>
        </div>

        {loading && (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading journal…</div>
        )}

        {!loading && entries.length === 0 && (
          <div className="card-surface p-8 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium mb-1">No journal entries yet.</p>
            <p className="text-sm text-muted-foreground">
              When you take a trade, you&apos;ll be prompted to record why you took it.
            </p>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="flex gap-6">
            {/* ── Left Sidebar: Position List ── */}
            <div className="w-72 shrink-0">
              <div className="card-surface overflow-hidden">
                <div className="p-3 border-b border-border">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Positions</h2>
                </div>
                <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                  {sortedEntries.map((entry) => {
                    const isSelected = entry.positionId === selectedId;
                    const isClosed = entry.status === 'CLOSED';
                    const isWin = entry.gainLoss != null && entry.gainLoss > 0;
                    const held = daysHeld(entry.entryDate, entry.exitDate);
                    const hasNotes = !!(entry.entryNote || entry.closeNote || entry.learnedNote);

                    return (
                      <button
                        key={entry.positionId}
                        onClick={() => setSelectedId(entry.positionId)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors',
                          isSelected
                            ? 'bg-primary-500/10 border-l-2 border-l-primary-400'
                            : 'hover:bg-navy-700/50 border-l-2 border-l-transparent'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className={cn('font-semibold text-sm', isSelected ? 'text-primary-400' : 'text-foreground')}>
                            {entry.ticker}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {hasNotes && <MessageSquare className="w-3 h-3 text-muted-foreground" />}
                            {isClosed ? (
                              <span className={cn('text-[10px] font-bold', isWin ? 'text-profit' : 'text-loss')}>
                                {isWin ? '+' : ''}£{(entry.gainLoss ?? 0).toFixed(0)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground bg-navy-700 px-1.5 py-0.5 rounded">
                                OPEN
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDate(new Date(entry.entryDate))} · {held}d
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Main Panel: Timeline ── */}
            <div className="flex-1 min-w-0">
              {selectedEntry ? (
                <div>
                  {/* Position header */}
                  <div className="card-surface p-5 mb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-foreground">
                          {selectedEntry.ticker}
                          <span className="text-muted-foreground font-normal ml-2 text-sm">
                            {selectedEntry.companyName}
                          </span>
                        </h2>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(new Date(selectedEntry.entryDate))}
                          {selectedEntry.exitDate && <> → {formatDate(new Date(selectedEntry.exitDate))}</>}
                          {' · '}{daysHeld(selectedEntry.entryDate, selectedEntry.exitDate)} days held
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {selectedEntry.status === 'CLOSED' && selectedEntry.gainLoss != null && (
                          <div className={cn(
                            'flex items-center gap-1 text-sm font-semibold',
                            selectedEntry.gainLoss > 0 ? 'text-profit' : 'text-loss'
                          )}>
                            {selectedEntry.gainLoss > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            {selectedEntry.gainLoss > 0 ? '+' : ''}£{selectedEntry.gainLoss.toFixed(2)}
                          </div>
                        )}
                        {selectedEntry.status === 'OPEN' && (
                          <span className="text-xs text-muted-foreground bg-navy-700 px-2 py-1 rounded">
                            Open position
                          </span>
                        )}
                        <Link
                          href={`/portfolio/positions?position=${selectedEntry.positionId}`}
                          className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  {timelineEvents.length > 0 ? (
                    <div className="relative ml-4">
                      {/* Vertical line */}
                      <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />

                      {timelineEvents.map((event, i) => {
                        const Icon = event.icon;
                        return (
                          <div key={`${event.type}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
                            {/* Dot */}
                            <div className={cn('relative z-10 w-6 h-6 rounded-full bg-navy-800 border-2 border-border flex items-center justify-center shrink-0', event.color)}>
                              <Icon className="w-3 h-3" />
                            </div>
                            {/* Content */}
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={cn('text-sm font-semibold', event.color)}>{event.title}</span>
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {formatDate(new Date(event.date))}
                                </span>
                                {event.confidence != null && (
                                  <ConfidenceStars level={event.confidence} />
                                )}
                              </div>
                              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{event.detail}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="card-surface p-6 text-center text-muted-foreground text-sm">
                      No journal entries for this position yet.
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-6 pt-4 border-t border-border/50">
                    <button
                      onClick={() => setEditingEntry(selectedEntry.positionId)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:bg-navy-700 transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {selectedEntry.entryNote ? 'Edit entry note' : 'Add entry note'}
                    </button>
                    {selectedEntry.status === 'CLOSED' && (
                      <button
                        onClick={() => setEditingClose(selectedEntry.positionId)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border hover:bg-navy-700 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        {selectedEntry.closeNote ? 'Edit close note' : 'Add close note'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card-surface p-8 text-center text-muted-foreground text-sm">
                  Select a position from the sidebar to view its journal timeline.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modals */}
        {editingEntry && (() => {
          const entry = entries.find((e) => e.positionId === editingEntry);
          return entry ? (
            <EntryNoteModal
              positionId={editingEntry}
              existing={{ entryNote: entry.entryNote, entryConfidence: entry.entryConfidence }}
              onClose={() => setEditingEntry(null)}
              onSaved={handleSaved}
            />
          ) : null;
        })()}

        {editingClose && (() => {
          const entry = entries.find((e) => e.positionId === editingClose);
          return entry ? (
            <CloseNoteModal
              positionId={editingClose}
              existing={{ closeNote: entry.closeNote, learnedNote: entry.learnedNote }}
              onClose={() => setEditingClose(null)}
              onSaved={handleSaved}
            />
          ) : null;
        })()}
      </main>
    </div>
  );
}

// ── Timeline Event Type ──────────────────────────────────────

interface TimelineEvent {
  type: 'ENTRY' | 'ENTRY_NOTE' | 'EXIT' | 'CLOSE_NOTE' | 'LESSON';
  date: string;
  icon: React.ElementType;
  title: string;
  detail: string;
  confidence?: number | null;
  color: string;
}
