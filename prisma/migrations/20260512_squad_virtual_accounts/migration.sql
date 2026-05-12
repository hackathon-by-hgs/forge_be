-- Phase 5 — Squad virtual accounts + wallet escrow per job.
--
-- 1. Virtual NUBAN fields on Employer + Worker.
-- 2. reserved_amount_naira on Job (hard-escrow column for the wallet hold).
-- 3. Relax transactions.worker_id to NULL so virtual-account top-ups attributed
--    to an employer (no worker) can write a Transaction row.

ALTER TABLE "employers"
  ADD COLUMN "squad_virtual_account_number"   TEXT,
  ADD COLUMN "squad_virtual_account_bank_code" TEXT,
  ADD COLUMN "squad_virtual_account_name"     TEXT;

CREATE UNIQUE INDEX "employers_squad_virtual_account_number_key"
  ON "employers"("squad_virtual_account_number");

ALTER TABLE "workers"
  ADD COLUMN "squad_virtual_account_number"   TEXT,
  ADD COLUMN "squad_virtual_account_bank_code" TEXT,
  ADD COLUMN "squad_virtual_account_name"     TEXT;

CREATE UNIQUE INDEX "workers_squad_virtual_account_number_key"
  ON "workers"("squad_virtual_account_number");

ALTER TABLE "jobs"
  ADD COLUMN "reserved_amount_naira" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "transactions"
  DROP CONSTRAINT "transactions_worker_id_fkey",
  ALTER COLUMN "worker_id" DROP NOT NULL;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "workers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
