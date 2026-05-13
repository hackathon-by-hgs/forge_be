-- §11.7 — employer-signed payouts (26_employer_signed_payouts.md).
--
-- 1. Add verification_state / hold_release_at / employer_reviewed_at to work_sessions.
--    The new clock-out path parks the session in `auto_review` for a server-decided
--    hold window (Phase 1 flat 2h); the auto-release-cron + employer-confirm /
--    dispute endpoints terminate it.
--
-- 2. Create the disputes table. One open dispute per session is the norm; the
--    work-session FK cascades on delete so removing a session removes its disputes.
--
-- 3. Backfill historical sessions. Pre-§11.7 rows with `clock_out_at IS NOT NULL`
--    have already been disbursed (or are in the legacy pending_verification state)
--    — flag them `auto_released` so the dashboard's `?state=auto_review` review
--    queue doesn't surface them. New rows pick up the column default at clock-out.

ALTER TABLE "work_sessions"
  ADD COLUMN "verification_state"   TEXT NOT NULL DEFAULT 'auto_review',
  ADD COLUMN "hold_release_at"      TIMESTAMP(3),
  ADD COLUMN "employer_reviewed_at" TIMESTAMP(3);

UPDATE "work_sessions"
  SET "verification_state" = 'auto_released'
  WHERE "clock_out_at" IS NOT NULL;

CREATE INDEX "work_sessions_verification_state_hold_release_at_idx"
  ON "work_sessions"("verification_state", "hold_release_at");

CREATE TABLE "disputes" (
  "id"              TEXT PRIMARY KEY,
  "work_session_id" TEXT NOT NULL,
  "opened_by"       TEXT NOT NULL,
  "reason"          TEXT NOT NULL,
  "description"     TEXT,
  "evidence_urls"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"          TEXT NOT NULL DEFAULT 'open',
  "opened_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at"     TIMESTAMP(3),
  "resolved_by"     TEXT,
  "resolution_note" TEXT,
  CONSTRAINT "disputes_work_session_id_fkey"
    FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "disputes_status_idx"          ON "disputes"("status");
CREATE INDEX "disputes_work_session_id_idx" ON "disputes"("work_session_id");
