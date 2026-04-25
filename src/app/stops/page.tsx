/**
 * DEPENDENCIES
 * Consumed by: navigation
 * Consumes: packages/portfolio/src/index.ts, src/components/review/ReviewMetricCard.tsx, src/components/review/ReviewStatusBadge.tsx, src/components/shared/Navbar.tsx, src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 stop review page built on the Phase 8 stop dashboard projection.
 */
import Navbar from '@/components/shared/Navbar';
import ReviewMetricCard from '@/components/review/ReviewMetricCard';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import { getEveningReviewData } from '../../../packages/portfolio/src';

export const dynamic = 'force-dynamic';

export default async function StopsPage() {
  const data = await getEveningReviewData();
  const { summary, rows } = data.stops;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Stops</h1>
          <p className="max-w-3xl text-muted-foreground">
            Protective-stop review for live positions, including broker reference, verification time, and mismatch visibility required for the Phase 9 nightly review.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <ReviewMetricCard label="Protected" value={String(summary.protectedCount)} detail="Active protective stops" />
          <ReviewMetricCard label="Unprotected" value={String(summary.unprotectedCount)} detail="Positions needing follow-up" />
          <ReviewMetricCard label="Mismatched" value={String(summary.mismatchedCount)} detail="Local vs broker stop mismatch" />
          <ReviewMetricCard label="Failed" value={String(summary.failedCount)} detail="Stops in failed state" />
        </div>

        <section className="rounded-xl border border-border bg-surface-1 shadow-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Stop Protection Table</h2>
              <p className="text-xs text-muted-foreground">{summary.positionsCount} open broker-backed positions in the stop dashboard.</p>
            </div>
            <ReviewStatusBadge status={summary.unprotectedCount > 0 ? 'PARTIAL' : 'SUCCEEDED'} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Position Size</th>
                  <th className="px-4 py-3">Intended Stop</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Alert</th>
                  <th className="px-4 py-3">Broker Ref</th>
                  <th className="px-4 py-3">Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.brokerPositionId}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{row.symbol}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{row.brokerPositionId}</div>
                    </td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(row.positionSize, 2)}</td>
                    <td className="px-4 py-3 text-foreground">
                      {row.intendedStop == null ? 'N/A' : formatCurrency(row.intendedStop, data.summary.currency)}
                    </td>
                    <td className="px-4 py-3 text-foreground">{row.stopSource}</td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={row.alertState} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{row.brokerStopReference ?? 'N/A'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.verificationTime ? formatDateTime(row.verificationTime) : 'Never'}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No open positions are currently tracked in the stop dashboard.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}