/**
 * DEPENDENCIES
 * Consumed by: navigation
 * Consumes: packages/portfolio/src/index.ts, src/components/review/ReviewMetricCard.tsx, src/components/review/ReviewStatusBadge.tsx, src/components/shared/Navbar.tsx, src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 jobs/logs page combining recent job runs with the latest audit events.
 */
import Navbar from '@/components/shared/Navbar';
import ReviewMetricCard from '@/components/review/ReviewMetricCard';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { getEveningReviewData } from '../../../packages/portfolio/src';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const data = await getEveningReviewData();
  const failedJobs = data.jobs.filter((job) => job.status === 'FAILED').length;
  const partialJobs = data.jobs.filter((job) => job.status === 'PARTIAL').length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Jobs & Logs</h1>
          <p className="max-w-3xl text-muted-foreground">
            Recent scheduled-job outcomes and audit events for safe nightly review. This is the Phase 9 operational history surface, not the later alerting layer.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <ReviewMetricCard label="Recent Jobs" value={String(data.jobs.length)} detail="Latest 25 job runs" />
          <ReviewMetricCard label="Failed Jobs" value={String(failedJobs)} detail="Immediate manual review needed" />
          <ReviewMetricCard label="Partial Jobs" value={String(partialJobs)} detail="Completed with issues" />
          <ReviewMetricCard label="Audit Events" value={String(data.auditEvents.length)} detail="Latest 25 audit log entries" />
        </div>

        <section className="rounded-xl border border-border bg-surface-1 shadow-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Recent Jobs</h2>
              <p className="text-xs text-muted-foreground">Latest orchestration, broker-sync, and market-data job runs.</p>
            </div>
            <ReviewStatusBadge status={failedJobs > 0 ? 'FAILED' : partialJobs > 0 ? 'PARTIAL' : 'SUCCEEDED'} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Finished</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{job.jobName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{job.id}</div>
                    </td>
                    <td className="px-4 py-3"><ReviewStatusBadge status={job.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(job.startedAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job.finishedAt ? formatDateTime(job.finishedAt) : 'Running'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job.durationMs == null ? 'N/A' : `${formatNumber(job.durationMs)} ms`}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job.errorMessage ?? job.summary ?? 'None'}</td>
                  </tr>
                ))}
                {data.jobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No job history is available yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface-1 shadow-card overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Audit Trail</h2>
            <p className="text-xs text-muted-foreground">Latest audit events across broker sync, workflow, and order lifecycle actions.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Entity ID</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.auditEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3 font-semibold text-foreground">{event.eventType}</td>
                    <td className="px-4 py-3 text-foreground">{event.entityType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{event.entityId}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(event.createdAt)}</td>
                  </tr>
                ))}
                {data.auditEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No audit events have been recorded yet.</td>
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