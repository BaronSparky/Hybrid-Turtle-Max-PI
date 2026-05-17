-- Add provenance tag to EquitySnapshot so the user-facing equity curve can
-- filter out derived / stale rows. Before this change every writer
-- (broker sync, nightly, settings PUT) dumped into the same table, which
-- allowed a £10000 seed-default row from nightly to contaminate the chart
-- as a fake "starting equity" on 2026-05-17.
--
-- Source values used by writers:
--   'BROKER'  — fetched from broker (Trading 212 sync). Authoritative.
--   'NIGHTLY' — derived from User.equity during nightly run. May be stale.
--             Retained because openRiskPercent is recorded on these rows.
--
-- Existing rows default to 'NIGHTLY' since pre-migration writes were
-- predominantly from the nightly path. The single legitimate broker row
-- in production data is retagged explicitly by the follow-up data fix.
ALTER TABLE "EquitySnapshot" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'NIGHTLY';

-- Index supports the equity-curve route's `where source = 'BROKER'` filter.
CREATE INDEX "EquitySnapshot_source_idx" ON "EquitySnapshot"("source");
