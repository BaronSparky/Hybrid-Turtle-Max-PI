/**
 * DEPENDENCIES
 * Consumed by: navigation
 * Consumes: packages/portfolio/src/index.ts, src/components/review/ReviewMetricCard.tsx, src/components/review/ReviewStatusBadge.tsx, src/components/shared/Navbar.tsx, src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 planned-trades review page for the next execution session.
 */
import Navbar from '@/components/shared/Navbar';
import ReviewMetricCard from '@/components/review/ReviewMetricCard';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { getEveningReviewData } from '../../../packages/portfolio/src';

export const dynamic = 'force-dynamic';

export default async function PlannedTradesPage() {
  const data = await getEveningReviewData();
  const totalTrades = data.plannedTrades.length;
  const approvedTrades = data.plannedTrades.filter((trade) => ['APPROVED', 'READY', 'SUBMITTED', 'FILLED'].includes(trade.status)).length;
  const blockedTrades = data.plannedTrades.filter((trade) => trade.riskApproved === false).length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Planned Trades</h1>
          <p className="max-w-3xl text-muted-foreground">
            Next-session trade plan review for the current Phase 9 evening workflow. This page shows planned entry, planned stop, risk approval, and linked broker-order state in one place.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ReviewMetricCard label="Plan Items" value={String(totalTrades)} detail="Next execution session" />
          <ReviewMetricCard label="Approved" value={String(approvedTrades)} detail="Approved, ready, submitted, or filled" />
          <ReviewMetricCard label="Risk Blocked" value={String(blockedTrades)} detail="Plan items with failed risk approval" />
        </div>

        <section className="rounded-xl border border-border bg-surface-1 shadow-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Next-Session Plan</h2>
              <p className="text-xs text-muted-foreground">{totalTrades === 0 ? 'No plan items yet.' : `${totalTrades} items staged for review.`}</p>
            </div>
            <ReviewStatusBadge status={totalTrades > 0 ? 'READY' : 'UNKNOWN'} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Entry</th>
                  <th className="px-4 py-3">Stop</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Broker</th>
                  <th className="px-4 py-3">Session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.plannedTrades.map((trade) => (
                  <tr key={trade.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{trade.symbol}</div>
                      <div className="mt-1 max-w-[28rem] text-xs text-muted-foreground">{trade.rationale}</div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{trade.side}</td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={trade.status} /></td>
                    <td className="px-4 py-3 text-foreground">{formatNumber(trade.plannedQuantity, 2)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(trade.plannedEntryPrice, data.summary.currency)}</td>
                    <td className="px-4 py-3 text-foreground">{formatCurrency(trade.plannedStopPrice, data.summary.currency)}</td>
                    <td className="px-4 py-3">
                      <ReviewStatusBadge status={trade.riskApproved === false ? 'FAILED' : trade.riskApproved === true ? 'APPROVED' : 'UNKNOWN'} />
                      {trade.riskRationale ? <div className="mt-1 text-xs text-muted-foreground">{trade.riskRationale}</div> : null}
                    </td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={trade.brokerOrderStatus} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(trade.executionSessionDate)}</td>
                  </tr>
                ))}
                {data.plannedTrades.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No planned trades exist for the next execution session yet.
                    </td>
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