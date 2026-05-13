-- §27 — Ratings + reliability aggregates (27_ratings_and_reliability.md).
--
-- 1. Create the ratings table — mutual blind 5-star rating between worker
--    and employer after a terminal session. One row per (work_session_id,
--    author_role); enforced by a unique index. `visible_at` defaults to
--    `submitted_at + 48h` at insert; the rating-create service flips both
--    rows to NOW once the counterpart lands.
--
-- 2. Denormalised aggregates on workers + employers (`ratings_count` +
--    `tags_top`). Worker.average_rating + Employer.rating already exist.
--    Updated in the same tx as the rating insert — no Postgres trigger.

CREATE TABLE "ratings" (
  "id"              TEXT PRIMARY KEY,
  "work_session_id" TEXT NOT NULL,
  "author_id"       TEXT NOT NULL,
  "author_role"     TEXT NOT NULL,
  "subject_id"      TEXT NOT NULL,
  "stars"           INTEGER NOT NULL,
  "tags"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "comment"         TEXT,
  "submitted_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "visible_at"      TIMESTAMP(3),
  CONSTRAINT "ratings_stars_chk"       CHECK ("stars" BETWEEN 1 AND 5),
  CONSTRAINT "ratings_author_role_chk" CHECK ("author_role" IN ('worker','employer')),
  CONSTRAINT "ratings_work_session_id_fkey"
    FOREIGN KEY ("work_session_id") REFERENCES "work_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ratings_one_per_author_per_session_idx"
  ON "ratings"("work_session_id", "author_role");

CREATE INDEX "ratings_subject_idx"
  ON "ratings"("subject_id", "submitted_at" DESC);

ALTER TABLE "workers"
  ADD COLUMN "ratings_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tags_top"      TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "employers"
  ADD COLUMN "ratings_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tags_top"      TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[];
