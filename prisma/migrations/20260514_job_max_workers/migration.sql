-- Multi-worker jobs — additive only; legacy single-worker jobs keep working.
--
-- `max_workers` is the slot count the employer set on this job. Default 1
-- so every existing row stays single-worker. The single-worker accept path
-- (`employer-jobs.service.ts:acceptApplication`) doesn't read this column,
-- so existing behaviour is byte-identical.
--
-- `accepted_count` is a denormalised counter for cheap apply-guard /
-- feed-filter checks. Maintained by the new multi-worker accept path
-- (`acceptApplicationSlot`) and reset to 0 by job-cancellation. The
-- single-worker path doesn't increment it (it sets `assigned_worker_id`
-- + `filled=true` instead, same as today).

ALTER TABLE "jobs"
  ADD COLUMN "max_workers" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "accepted_count" INTEGER NOT NULL DEFAULT 0;
