-- Add `kind` discriminator to Heartbeat so cron readers can filter by source
-- pipeline instead of brittle JSON-string matches on `details`.
-- See audit 2026-05-16 (M1). Nullable for backward compatibility with rows
-- written before this migration; writers populate going forward.
ALTER TABLE "Heartbeat" ADD COLUMN "kind" TEXT;

-- Index supports the watchdog `kind = 'NIGHTLY'` and midday-sync
-- `kind = 'MIDDAY_SYNC'` lookups.
CREATE INDEX "Heartbeat_kind_idx" ON "Heartbeat"("kind");
