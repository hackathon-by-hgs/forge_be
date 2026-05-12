-- Phase 4 — score-recalc cron output. One row per employer per recalc.
-- Powers the real `trend12Week` / `scoreDeltaPoints` series once the cron
-- has run at least once for the employer.

CREATE TABLE "employer_credit_history" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,
    "payment_timeliness" DOUBLE PRECISION NOT NULL,
    "worker_retention" DOUBLE PRECISION NOT NULL,
    "transaction_consistency" DOUBLE PRECISION NOT NULL,
    "growth_trend" DOUBLE PRECISION NOT NULL,
    "time_on_platform" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "employer_credit_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employer_credit_history_employer_id_captured_at_key" ON "employer_credit_history"("employer_id", "captured_at");

CREATE INDEX "employer_credit_history_employer_id_captured_at_idx" ON "employer_credit_history"("employer_id", "captured_at" DESC);

ALTER TABLE "employer_credit_history" ADD CONSTRAINT "employer_credit_history_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
