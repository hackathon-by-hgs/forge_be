# Forge — Backend (NestJS)

Backend for the Forge worker mobile app, drafted from the contracts in `endpoint_resources/`. Built on NestJS 11, Prisma 6 (PostgreSQL), JWT auth, and `@nestjs/swagger` for OpenAPI docs.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Bring up Postgres (or set DATABASE_URL to your own)
docker compose -f ../docker-compose.yml up -d

# 3. Apply schema (creates tables in the dev DB)
pnpm exec prisma migrate dev --name init
pnpm exec prisma generate

# 4. Run
pnpm run start:dev
```

- API base:  `http://localhost:3000/v1`
- Swagger UI: `http://localhost:3000/docs`
- Health:    `http://localhost:3000/health`

## Module map

| Module | Files | Endpoints (spec ref) |
|--------|-------|----------------------|
| `AuthModule`   | `modules/auth/*`    | `01_auth.md` |
| `JobsModule`   | `modules/jobs/*`    | `02_jobs_feed.md`, `03_job_detail.md`, `04_apply_for_job.md`, `05_application_status.md`, `06_my_applications.md`, `07_work_session.md`, `20_work_history.md` (reuses applications) |
| `WalletModule` | `modules/wallet/*`  | `08_earnings_home.md` (reuses `/me`), `09_transactions.md`, `10_transaction_detail.md`, `11_withdraw.md`, `12_bank_accounts.md` |
| `LoansModule`  | `modules/loans/*`   | `13_loans_home.md`, `14_loan_apply.md`, `15_loan_detail.md` |
| `MeModule`     | `modules/me/*`      | `16_profile.md`, `17_edit_profile.md`, `18_settings.md`, `19_notifications.md` |
| `SupportModule`| `modules/support/*` | `21_help_support.md`, `22_uploads.md` |

Cross-cutting bits live under `common/`:

- `filters/http-exception.filter.ts` — single error envelope `{ error: { code, message, details? } }`.
- `decorators/idempotency-key.decorator.ts` + `interceptors/idempotency.service.ts` — DB-backed 24h idempotency cache for ⚡ endpoints.
- `pagination/cursor.util.ts` — opaque base64 cursor `{ts, id}`.
- `guards/jwt-auth.guard.ts` + `modules/auth/strategies/jwt.strategy.ts` — Bearer JWT auth.
- `utils/geo.ts` — haversine + Lagos-realistic walking/driving paces.
- `utils/ids.ts` — `<prefix>_<8 base32>` ids.

## Auth

- `Authorization: Bearer <access_token>` on every protected endpoint.
- Access tokens last 15 min, refresh tokens 30 days. Refresh is single-use; on reuse, every refresh for the worker is revoked (defensive).
- OTP codes are 6 digits, hashed with argon2. In dev with `OTP_DEBUG_EXPOSE=true`, the code is logged to stdout (no SMS provider wired yet — TODO Termii / Twilio).

## Idempotency

⚡ endpoints (`POST /auth/profile-setup`, `POST /jobs/:id/apply`, `POST /sessions`, `POST /sessions/:id/clock-out`, `POST /wallet/withdrawals`, `POST /me/bank-accounts`, `POST /loans`) require an `Idempotency-Key` header (UUID v4). Replays return the cached response for 24 h. Same key with a different body returns `409 CONFLICT`.

## Stubs you'll want to swap

| Concern | File | Note |
|---------|------|------|
| SMS dispatch (OTP) | `modules/auth/auth.service.ts` (`requestOtp`) | currently logs the code |
| NIBSS account-name resolve | `modules/wallet/banks.service.ts` (`resolve`) | returns `TEST ACCOUNT NAME` |
| Squad disbursement (clock-out) | `modules/jobs/sessions.service.ts` (`clockOut`) | synchronous "succeeds immediately" |
| Squad withdrawal | `modules/wallet/withdrawals.service.ts` (`withdraw`) | creates a `pending` txn; webhook → `succeeded` not implemented |
| Push notifications (FCM/APNs) | several `// TODO` markers | device tokens are persisted; sender not wired |
| Image moderation (Rekognition / Sightengine) | `modules/me/me.service.ts` (`edit`), `modules/jobs/sessions.service.ts` (`clockOut`) | upload acceptance currently has no moderation step |

## Useful commands

```bash
pnpm exec prisma studio               # browse the DB
pnpm exec prisma migrate dev          # create + run a new migration
pnpm exec prisma migrate reset        # nuke + reseed (dev only)
pnpm run build                        # tsc + nest build
pnpm exec tsc --noEmit                # type-check only
```
