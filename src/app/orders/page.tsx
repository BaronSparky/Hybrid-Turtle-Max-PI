/**
 * DEPENDENCIES
 * Consumed by: navigation
 * Consumes: packages/portfolio/src/index.ts, src/components/review/ReviewMetricCard.tsx, src/components/review/ReviewStatusBadge.tsx, src/components/shared/Navbar.tsx, src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 order-history page for reviewing recent broker orders and plan linkage.
 */
import Navbar from '@/components/shared/Navbar';
import ReviewMetricCard from '@/components/review/ReviewMetricCard';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import { getEveningReviewData } from '../../../packages/portfolio/src';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const data = await getEveningReviewData();
  const pendingCount = data.orders.filter((order) => ['PENDING', 'SUBMITTED'].includes(order.status)).length;
  const filledCount = data.orders.filter((order) => order.status === 'FILLED').length;
  const rejectedCount = data.orders.filter((order) => ['REJECTED', 'CANCELLED'].includes(order.status)).length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Orders</h1>
          <p className="max-w-3xl text-muted-foreground">
            Recent broker-order history with status, planned-trade linkage, and fill details for next-session execution review.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <ReviewMetricCard label="Recent Orders" value={String(data.orders.length)} detail="Latest 50 broker orders" />
          <ReviewMetricCard label="Pending" value={String(pendingCount)} detail="Pending or submitted" />
          <ReviewMetricCard label="Filled" value={String(filledCount)} detail="Filled orders" />
          <ReviewMetricCard label="Rejected" value={String(rejectedCount)} detail="Rejected or cancelled" />
        </div>

        <section className="rounded-xl border border-border bg-surface-1 shadow-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Broker Orders</h2>
              <p className="text-xs text-muted-foreground">Most recent order activity captured in the local broker mirror.</p>
            </div>
            <ReviewStatusBadge status={pendingCount > 0 ? 'PARTIAL' : 'SUCCEEDED'} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Pricing</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Plan Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{order.symbol}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{order.brokerOrderId}</div>
                    </td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={order.status} /></td>
                    <td className="px-4 py-3 text-foreground">{order.side}</td>
                    <td className="px-4 py-3 text-foreground">{order.orderType}</td>
                    <td className="px-4 py-3 text-foreground">
                      {formatNumber(order.quantity, 2)}
                      {order.filledQuantity != null ? <div className="mt-1 text-xs text-muted-foreground">Filled {formatNumber(order.filledQuantity, 2)}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {order.limitPrice != null ? <div>Limit {formatCurrency(order.limitPrice, data.summary.currency)}</div> : null}
                      {order.stopPrice != null ? <div>Stop {formatCurrency(order.stopPrice, data.summary.currency)}</div> : null}
                      {order.averageFillPrice != null ? <div>Fill {formatCurrency(order.averageFillPrice, data.summary.currency)}</div> : null}
                      {order.limitPrice == null && order.stopPrice == null && order.averageFillPrice == null ? 'Market' : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{order.submittedAt ? formatDateTime(order.submittedAt) : formatDateTime(order.updatedAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{order.plannedTradeId ?? 'Unlinked'}</td>
                  </tr>
                ))}
                {data.orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No broker orders have been mirrored locally yet.</td>
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