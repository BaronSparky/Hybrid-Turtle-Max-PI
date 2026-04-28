/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx
 * Consumes: /api/db-status endpoint (GET + POST)
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: Shows a warning banner when pending database migrations are detected.
 *        Includes a "Fix Now" button that triggers auto-migrate via the API.
 */

'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface DbStatus {
  status: 'ok' | 'needs_migration' | 'error';
  pending: number;
  message?: string;
}

type FixState = 'idle' | 'fixing' | 'success' | 'failed';

export default function MigrationBanner() {
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [fixState, setFixState] = useState<FixState>('idle');
  const [fixMessage, setFixMessage] = useState('');

  useEffect(() => {
    fetch('/api/db-status')
      .then((res) => {
        if (!res.ok) return { status: 'ok' as const, pending: 0 };
        return res.json();
      })
      .then((data: DbStatus) => setDbStatus(data))
      .catch(() => {
        setDbStatus({
          status: 'error',
          pending: 0,
          message: 'Could not check database status. The database may need updating.',
        });
      });
  }, []);

  async function handleFixNow() {
    setFixState('fixing');
    setFixMessage('');
    try {
      const res = await fetch('/api/db-status', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setFixState('success');
        setFixMessage('Migrations applied! Refreshing in 3 seconds...');
        // Auto-refresh after a short delay so Prisma picks up the new schema
        setTimeout(() => window.location.reload(), 3000);
      } else {
        setFixState('failed');
        setFixMessage(data.message || 'Auto-fix failed. Try restarting the app.');
      }
    } catch {
      setFixState('failed');
      setFixMessage('Could not reach the server. Try restarting the app.');
    }
  }

  if (!dbStatus || dbStatus.status === 'ok' || dismissed) return null;

  // After successful fix, show a green confirmation banner
  if (fixState === 'success') {
    return (
      <div className="bg-emerald-900/80 border border-emerald-500/50 rounded-lg mx-4 sm:mx-6 mt-4 p-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0" />
          <p className="text-emerald-200 text-sm font-medium">{fixMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-900/80 border border-amber-500/50 rounded-lg mx-4 sm:mx-6 mt-4 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-amber-200 font-semibold text-sm">
            Database Needs Updating
          </h3>
          <p className="text-amber-300/80 text-sm mt-1">
            {dbStatus.status === 'needs_migration'
              ? `${dbStatus.pending} pending migration(s) detected. The dashboard may show errors until the database is updated.`
              : dbStatus.message}
          </p>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={handleFixNow}
              disabled={fixState === 'fixing'}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-amber-700 disabled:cursor-wait text-white px-4 py-1.5 rounded text-xs font-medium flex items-center gap-2 transition-colors"
            >
              {fixState === 'fixing' ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Fixing...
                </>
              ) : (
                'Fix Now'
              )}
            </button>
            {fixState === 'failed' && (
              <span className="text-red-400 text-xs">{fixMessage}</span>
            )}
            {fixState === 'idle' && (
              <span className="text-amber-400/60 text-xs">
                Or run: <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono">npx prisma migrate deploy</code>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-amber-400/60 hover:text-amber-300 text-xs flex-shrink-0"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
