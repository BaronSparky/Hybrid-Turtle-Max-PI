'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page
 * Consumes: /api/backup (GET, POST)
 * Risk-sensitive: NO (display + file copy only)
 * Last modified: 2026-03-03
 */

import { useState, useEffect, useCallback } from 'react';
import {apiRequest, formatApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Database,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  HardDrive,
  RotateCcw,
} from 'lucide-react';

interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

interface BackupListResponse {
  backups: BackupFile[];
  count: number;
  maxBackups: number;
  directory: string;
}

interface BackupResult {
  success: boolean;
  filename: string | null;
  sizeBytes: number | null;
  error: string | null;
  timestamp: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BackupPanel() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [maxBackups, setMaxBackups] = useState(7);
  const [directory, setDirectory] = useState('prisma/backups/');
  const [loading, setLoading] = useState(true);
  const [backing, setBacking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [listExpanded, setListExpanded] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    try {
      const data = await apiRequest<BackupListResponse>('/api/backup');
      setBackups(data.backups);
      setMaxBackups(data.maxBackups);
      setDirectory(data.directory);
    } catch {
      // Silent — empty state is fine
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleBackup = async () => {
    setBacking(true);
    setResult(null);
    try {
      const data = await apiRequest<BackupResult>('/api/backup', { method: 'POST' });
      if (data.success) {
        setResult({ ok: true, message: `Backup created: ${data.filename} (${formatBytes(data.sizeBytes ?? 0)})` });
        fetchBackups(); // Refresh the list
      } else {
        setResult({ ok: false, message: data.error ?? 'Backup failed' });
      }
    } catch (err) {
      setResult({ ok: false, message: formatApiError(err, 'Backup failed') });
    } finally {
      setBacking(false);
    }
  };

  const latest = backups.length > 0 ? backups[0] : null;

  const handleRestore = async (filename: string) => {
    setRestoring(filename);
    setConfirmRestore(null);
    setResult(null);
    try {
      const data = await apiRequest<{ success: boolean; restoredFrom: string; preRestoreBackup: string | null; error: string | null; message?: string }>(
        '/api/backup/restore',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) }
      );
      if (data.success) {
        setResult({
          ok: true,
          message: `Restored from ${data.restoredFrom}. ${data.preRestoreBackup ? `Safety backup saved as ${data.preRestoreBackup}. ` : ''}Restart the app for full effect.`,
        });
      } else {
        setResult({ ok: false, message: data.error ?? 'Restore failed' });
      }
    } catch (err) {
      setResult({ ok: false, message: formatApiError(err, 'Restore failed') });
    } finally {
      setRestoring(null);
      fetchBackups();
    }
  };

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-primary-400" />
          Database Backup
        </h2>
        <button
          onClick={handleBackup}
          disabled={backing}
          className="btn-outline text-sm flex items-center gap-2"
        >
          {backing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {backing ? 'Backing up...' : 'Backup Now'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Backups also run automatically each night as part of the nightly pipeline.
      </p>

      {/* Result feedback */}
      {result && (
        <div className={cn(
          'flex items-center gap-2 p-3 rounded-lg text-sm mb-4',
          result.ok
            ? 'bg-profit/10 border border-profit/30 text-profit'
            : 'bg-loss/10 border border-loss/30 text-loss'
        )}>
          {result.ok ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          )}
          {result.message}
        </div>
      )}

      {/* Summary info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm mb-4">
        <div>
          <span className="text-xs text-muted-foreground">Last backup</span>
          <div className="text-foreground font-mono text-xs mt-0.5">
            {loading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : latest ? (
              <>
                {new Date(latest.createdAt).toLocaleString()}
                <span className="text-muted-foreground ml-1">({formatBytes(latest.sizeBytes)})</span>
              </>
            ) : (
              <span className="text-muted-foreground">No backups yet</span>
            )}
          </div>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Stored</span>
          <div className="text-foreground text-xs mt-0.5">
            {backups.length} of {maxBackups} backups
          </div>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Location</span>
          <div className="text-foreground font-mono text-xs mt-0.5">{directory}</div>
        </div>
      </div>

      {/* Expandable backup list */}
      {backups.length > 0 && (
        <div>
          <button
            onClick={() => setListExpanded(!listExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {listExpanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {listExpanded ? 'Hide backup files' : `Show ${backups.length} backup file${backups.length !== 1 ? 's' : ''}`}
          </button>

          {listExpanded && (
            <div className="mt-2 space-y-1">
              {backups.map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-navy-800/50"
                >
                  <span className="font-mono text-foreground">{b.filename}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
                    {confirmRestore === b.filename ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-warning">Restore this backup?</span>
                        <button
                          onClick={() => handleRestore(b.filename)}
                          disabled={restoring !== null}
                          className="px-2 py-0.5 text-[11px] font-medium rounded bg-warning/20 text-warning hover:bg-warning/30 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmRestore(null)}
                          className="px-2 py-0.5 text-[11px] font-medium rounded bg-navy-700 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmRestore(b.filename)}
                        disabled={restoring !== null}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-navy-700 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                      >
                        {restoring === b.filename ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
