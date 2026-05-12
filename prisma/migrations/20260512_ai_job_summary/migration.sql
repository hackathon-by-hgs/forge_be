-- AI surface — job-description summarizer cache.
-- ai.md §1: server-cache by job_id, 7-day TTL, schema_version bump invalidates.

CREATE TABLE "job_summaries" (
    "job_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "elapsed_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_summaries_pkey" PRIMARY KEY ("job_id")
);

CREATE INDEX "job_summaries_expires_at_idx" ON "job_summaries"("expires_at");

ALTER TABLE "job_summaries" ADD CONSTRAINT "job_summaries_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
