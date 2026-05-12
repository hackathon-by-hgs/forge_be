-- FE Phase 4.6 — free-form job locations.
-- Adds optional `state` + `city` columns on `jobs` so the employer dashboard
-- can persist Google-Places / geolocation results structurally instead of
-- folding everything into the `neighborhood` freeform string.

ALTER TABLE "jobs"
  ADD COLUMN "state" TEXT,
  ADD COLUMN "city"  TEXT;

CREATE INDEX "jobs_state_idx" ON "jobs"("state");
