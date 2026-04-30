-- Add per-candidate dual-score columns to ScanResult.
-- These are populated at scan time from ScoreBreakdown so the grader
-- and dashboards see consistent NCS/FWS/BQS for each persisted candidate.
ALTER TABLE "ScanResult" ADD COLUMN "ncs" REAL;
ALTER TABLE "ScanResult" ADD COLUMN "fws" REAL;
ALTER TABLE "ScanResult" ADD COLUMN "bqs" REAL;
