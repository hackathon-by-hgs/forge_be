/*
  Warnings:

  - The primary key for the `banks` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `code` on the `banks` table. All the data in the column will be lost.
  - You are about to drop the column `member_since` on the `employers` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `employers` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[squad_wallet_id]` on the table `employers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[squad_reference]` on the table `transactions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[squad_wallet_id]` on the table `workers` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `id` to the `banks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `primary_color` to the `banks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `banks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `business_name` to the `employers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registered_address` to the `employers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registered_lat` to the `employers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registered_lng` to the `employers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `registered_neighborhood` to the `employers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `employers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `employers` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "loan_repayments_loan_id_paid_at_idx";

-- AlterTable
ALTER TABLE "banks" DROP CONSTRAINT "banks_pkey",
DROP COLUMN "code",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "default_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "primary_color" TEXT NOT NULL,
ADD COLUMN     "repayment_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "total_active_loans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_disbursed_naira" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD CONSTRAINT "banks_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "employers" DROP COLUMN "member_since",
DROP COLUMN "name",
ADD COLUMN     "business_name" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "credit_score" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "invoicing_email" TEXT,
ADD COLUMN     "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "notify_on_clock_events" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_on_new_application" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_on_payment_events" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "payment_timeliness_rate" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "payouts_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'starter',
ADD COLUMN     "registered_address" TEXT NOT NULL,
ADD COLUMN     "registered_lat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "registered_lng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "registered_neighborhood" TEXT NOT NULL,
ADD COLUMN     "squad_wallet_id" TEXT,
ADD COLUMN     "total_labor_spend_naira" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "wallet_balance_naira" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workers_hired" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "idempotency_records" ADD COLUMN     "user_id" TEXT,
ALTER COLUMN "worker_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "distance_meters" INTEGER;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "assigned_worker_id" TEXT,
ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'public',
ADD COLUMN     "audience_flipped_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_reason" TEXT,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "neighborhood" TEXT,
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open';

-- AlterTable
ALTER TABLE "loan_repayments" ADD COLUMN     "scheduled_for" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'paid',
ALTER COLUMN "paid_at" DROP NOT NULL,
ALTER COLUMN "from_job_id" DROP NOT NULL,
ALTER COLUMN "from_job_title" DROP NOT NULL,
ALTER COLUMN "transaction_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "apr" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bank_id" TEXT,
ADD COLUMN     "borrower_type" TEXT NOT NULL DEFAULT 'worker',
ADD COLUMN     "employer_id" TEXT,
ADD COLUMN     "next_payment_due_at" TIMESTAMP(3),
ADD COLUMN     "predicted_repayment_rate" DOUBLE PRECISION,
ADD COLUMN     "risk_level" TEXT NOT NULL DEFAULT 'green',
ADD COLUMN     "score_at_approval" INTEGER,
ADD COLUMN     "term_months" INTEGER,
ALTER COLUMN "worker_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN     "owner_user_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "employer_id" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "settled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workers" ADD COLUMN     "average_weekly_income_naira" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eligibility" TEXT NOT NULL DEFAULT 'ineligible',
ADD COLUMN     "home_address" TEXT,
ADD COLUMN     "home_lat" DOUBLE PRECISION,
ADD COLUMN     "home_lng" DOUBLE PRECISION,
ADD COLUMN     "home_neighborhood" TEXT,
ADD COLUMN     "income_volatility_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "on_time_rate" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "squad_wallet_id" TEXT,
ADD COLUMN     "watchlisted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "full_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "oauth_provider" TEXT,
    "role" TEXT NOT NULL,
    "employer_id" TEXT,
    "bank_id" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_team_members" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employer_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_blocks" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "reason" TEXT,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employer_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clock_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "gps_lat" DOUBLE PRECISION NOT NULL,
    "gps_lng" DOUBLE PRECISION NOT NULL,
    "gps_accuracy_meters" DOUBLE PRECISION NOT NULL,
    "verified" BOOLEAN NOT NULL,

    CONSTRAINT "clock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_proofs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "s3_key" TEXT NOT NULL,
    "exif_lat" DOUBLE PRECISION,
    "exif_lng" DOUBLE PRECISION,
    "exif_taken_at" TIMESTAMP(3),

    CONSTRAINT "photo_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nibss_banks" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "nibss_banks_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "line_items" JSONB NOT NULL,
    "subtotal_naira" INTEGER NOT NULL,
    "total_naira" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pdf_s3_key" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "employer_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "amount_naira" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "description" TEXT NOT NULL,
    "failed_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" TEXT NOT NULL,
    "borrower_type" TEXT NOT NULL,
    "worker_id" TEXT,
    "employer_id" TEXT,
    "bank_id" TEXT NOT NULL,
    "amount_requested_naira" INTEGER NOT NULL,
    "term_months" INTEGER NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommended_decision" TEXT NOT NULL,
    "recommendation_confidence_pct" INTEGER NOT NULL,
    "recommendation_reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "href" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_worker_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "payload" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_employer_id_idx" ON "users"("employer_id");

-- CreateIndex
CREATE INDEX "users_bank_id_idx" ON "users"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_refresh_tokens_token_hash_key" ON "user_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_refresh_tokens_user_id_idx" ON "user_refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "user_refresh_tokens_family_id_idx" ON "user_refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "employer_team_members_employer_id_worker_id_key" ON "employer_team_members"("employer_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "employer_blocks_employer_id_worker_id_key" ON "employer_blocks"("employer_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_hash_key" ON "team_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "team_invitations_employer_id_idx" ON "team_invitations"("employer_id");

-- CreateIndex
CREATE INDEX "job_events_job_id_occurred_at_idx" ON "job_events"("job_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "job_events_kind_idx" ON "job_events"("kind");

-- CreateIndex
CREATE INDEX "clock_events_job_id_at_idx" ON "clock_events"("job_id", "at");

-- CreateIndex
CREATE INDEX "clock_events_worker_id_at_idx" ON "clock_events"("worker_id", "at" DESC);

-- CreateIndex
CREATE INDEX "photo_proofs_job_id_idx" ON "photo_proofs"("job_id");

-- CreateIndex
CREATE INDEX "reviews_worker_id_idx" ON "reviews"("worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_job_id_worker_id_key" ON "reviews"("job_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_employer_id_issued_at_idx" ON "invoices"("employer_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "payouts_employer_id_scheduled_for_idx" ON "payouts"("employer_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "loan_applications_bank_id_status_idx" ON "loan_applications"("bank_id", "status");

-- CreateIndex
CREATE INDEX "user_notifications_recipient_user_id_occurred_at_idx" ON "user_notifications"("recipient_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "user_notifications_recipient_user_id_read_at_idx" ON "user_notifications"("recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "job_runs_name_started_at_idx" ON "job_runs"("name", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "employers_squad_wallet_id_key" ON "employers"("squad_wallet_id");

-- CreateIndex
CREATE INDEX "idempotency_records_user_id_idx" ON "idempotency_records"("user_id");

-- CreateIndex
CREATE INDEX "job_applications_job_id_status_idx" ON "job_applications"("job_id", "status");

-- CreateIndex
CREATE INDEX "jobs_employer_id_status_idx" ON "jobs"("employer_id", "status");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "loan_repayments_loan_id_scheduled_for_idx" ON "loan_repayments"("loan_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "loans_employer_id_status_idx" ON "loans"("employer_id", "status");

-- CreateIndex
CREATE INDEX "loans_bank_id_status_idx" ON "loans"("bank_id", "status");

-- CreateIndex
CREATE INDEX "loans_risk_level_idx" ON "loans"("risk_level");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_squad_reference_key" ON "transactions"("squad_reference");

-- CreateIndex
CREATE INDEX "transactions_employer_id_timestamp_idx" ON "transactions"("employer_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workers_squad_wallet_id_key" ON "workers"("squad_wallet_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_refresh_tokens" ADD CONSTRAINT "user_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_team_members" ADD CONSTRAINT "employer_team_members_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_team_members" ADD CONSTRAINT "employer_team_members_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_blocks" ADD CONSTRAINT "employer_blocks_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_blocks" ADD CONSTRAINT "employer_blocks_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_worker_id_fkey" FOREIGN KEY ("assigned_worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clock_events" ADD CONSTRAINT "clock_events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_proofs" ADD CONSTRAINT "photo_proofs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_proofs" ADD CONSTRAINT "photo_proofs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
