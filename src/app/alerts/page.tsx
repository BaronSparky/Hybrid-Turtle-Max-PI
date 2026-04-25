/**
 * DEPENDENCIES
 * Consumed by: navigation
 * Consumes: src/components/shared/Navbar.tsx, src/components/review/ReviewStatusBadge.tsx, src/lib/safety-alerts.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Phase 10 alerts page showing active safety states and kill-switch posture.
 */
import Link from 'next/link';
import Navbar from '@/components/shared/Navbar';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import { getActiveSafetyAlerts } from '@/lib/safety-alerts';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const snapshot = await getActiveSafetyAlerts();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Alerts</h1>
          <p className="max-w-3xl text-muted-foreground">
            Active Phase 10 safety alerts for stale data, broker failure, stop protection gaps, failed orders, drawdown, and risk-limit breaches.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-card">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Total Alerts</div>
            <div className="mt-2 text-2xl font-bold text-foreground">{snapshot.summary.total}</div>
          </div>
          <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-card">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Critical</div>
            <div className="mt-2 text-2xl font-bold text-loss">{snapshot.summary.critical}</div>
          </div>
          <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-card">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Warning</div>
            <div className="mt-2 text-2xl font-bold text-warning">{snapshot.summary.warning}</div>
          </div>
          <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-card">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Safety Toggles</div>
            <div className="mt-2 space-y-1 text-sm text-foreground">
              <div>All submissions: {snapshot.killSwitches.disableAllSubmissions ? 'Disabled' : 'Allowed'}</div>
              <div>Automated submissions: {snapshot.killSwitches.disableAutomatedSubmissions ? 'Disabled' : 'Allowed'}</div>
              <div>Scans on stale data: {snapshot.killSwitches.disableScansWhenDataStale ? 'Blocked' : 'Allowed'}</div>
            </div>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-surface-1 shadow-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Active Safety Alerts</h2>
              <p className="text-xs text-muted-foreground">Dangerous states are shown here even if the notifications inbox has already been read.</p>
            </div>
            <ReviewStatusBadge status={snapshot.summary.critical > 0 ? 'FAILED' : snapshot.summary.warning > 0 ? 'PARTIAL' : 'SUCCEEDED'} />
          </div>

          <div className="divide-y divide-border">
            {snapshot.alerts.map((alert) => (
              <div key={alert.kind} className="px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-4xl">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{alert.title}</h3>
                      <ReviewStatusBadge status={alert.severity} />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{alert.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Count: {alert.count}</p>
                  </div>
                  <Link href={alert.actionHref} className="text-sm text-primary-400 hover:text-primary-300">
                    Open related view
                  </Link>
                </div>
              </div>
            ))}
            {snapshot.alerts.length === 0 ? (
              <div className="px-4 py-10 text-center text-profit">No active safety alerts. The current system state is clear.</div>
            ) : null}
          </div>
        </section>

        <div className="text-sm text-muted-foreground">
          Safety toggles are managed in <Link href="/settings" className="text-primary-400 hover:text-primary-300">Settings</Link>.
        </div>
      </main>
    </div>
  );
}