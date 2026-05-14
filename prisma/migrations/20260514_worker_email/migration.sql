-- §11 worker withdrawal emails — add an optional `email` column on `workers`
-- so the withdrawal settlement helper can send a Resend confirmation /
-- failure email alongside the FCM push. Nullable because workers auth via
-- phone-OTP and may not provide an email; the email send path skips
-- silently when null.
--
-- Not unique: workers don't sign in with email and we don't want to block a
-- second worker who happens to share an inbox (e.g. a family Gmail). The
-- existing `phoneNumber` unique constraint owns identity.

ALTER TABLE "workers"
  ADD COLUMN "email" TEXT;
