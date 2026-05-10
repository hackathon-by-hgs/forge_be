import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS allowlist — see BACKEND_BRIEF §12 security. `*` in dev for ergonomics.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });

  app.use(cookieParser());

  app.setGlobalPrefix('v1', { exclude: ['docs', 'docs-json', 'health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Static serving for the local-disk uploads provider.
  app.useStaticAssets(join(process.cwd(), process.env.UPLOAD_DIR ?? './uploads'), {
    prefix: '/uploads',
  });

  const config = new DocumentBuilder()
    .setTitle('Forge API')
    .setDescription(
      [
        '# Forge API\n\n',
        'One backend, three clients. Every endpoint below is annotated with the **Audience** ',
        '(worker mobile / employer dashboard / bank dashboard) and the **Powers** ',
        '(the screen or feature it serves) so you can navigate by product surface, not just by URL.\n\n',
        '## Audiences\n\n',
        '| Audience | Path prefixes | Wire format | Auth scheme | JWT secret |\n',
        '|---|---|---|---|---|\n',
        '| **Worker mobile** (Flutter) | `/v1/auth/*`, `/v1/jobs/*`, `/v1/applications/*`, `/v1/sessions/*`, `/v1/wallet/*`, `/v1/loans/*`, `/v1/me/*`, `/v1/banks`, `/v1/help`, `/v1/uploads` | `snake_case`, integer Naira, ISO-8601 | `bearer` | `JWT_*_SECRET` |\n',
        '| **Employer dashboard** (`employer.forge.app`) | `/v1/dashboard/auth/*` (auth) → planned: `/v1/employer/*`, `/v1/jobs/*` (employer view), `/v1/workers/*`, `/v1/transactions/*`, `/v1/invoices/*`, `/v1/payouts/*`, `/v1/analytics/*`, `/v1/credit`, `/v1/loans/*`, `/v1/loan-applications`, `/v1/notifications/*`, `/v1/search`, `/v1/settings/*`, `/v1/stream` (SSE) | `camelCase`, integer Naira, ISO-8601 with offset | `bearer-user` | `USER_JWT_*_SECRET` |\n',
        '| **Bank dashboard** (`bank.forge.app`) | `/v1/dashboard/auth/*` (auth, shared) → planned: `/v1/bank/*` | Same as employer | `bearer-user` | Same as employer |\n\n',
        '## Build phases (HANDOFF.md)\n\n',
        '- **Phase 0 — done.** Worker mobile API, dashboard auth, audit log, OpenAPI, idempotency, schema, seed, deploy.\n',
        '- **Phase 1 — todo.** Employer Overview composite, Notifications, Search, Settings; tighten bank-signup gap.\n',
        '- **Phase 2 — todo.** Hire-to-clock-out lifecycle (Jobs, Workers, Applications, Sessions on the dashboard side).\n',
        '- **Phase 3 — todo.** Money — Transactions, Invoices, Payouts, Squad webhook.\n',
        '- **Phase 4 — todo.** Analytics, Credit & Loans (employer), Bank Risk Radar, SSE stream.\n',
        '- **Phase 5 — todo.** Polish, NDPR data export, runbook, observability.\n\n',
        'Endpoints already implemented show up in this Swagger UI; planned ones are documented in ',
        '`BACKEND_BRIEF.md` §10 (canonical) and the FE feature map in `FRONTEND_INTEGRATION.md` §5.\n\n',
        '## Cross-cutting rules\n\n',
        '- **Idempotency.** Endpoints marked with the `Idempotency-Key` header parameter MUST receive a UUID v4 ',
        'on the first call; retries with the same key replay the original response (24-hour cache). Required on: ',
        '`POST /jobs`, `POST /transactions`, `POST /invoices/generate-batch`, `POST /loans/:id/disburse`, ',
        '`POST /loan-repayments/:id/pay`, plus all worker-mobile mutations starred above.\n',
        '- **Tenant scoping is non-negotiable.** Never pass `employerId`/`bankId` from the client; the BE derives ',
        'scope from the JWT.\n',
        '- **Errors.** One envelope: `{ error: { code, message, details? } }`. ',
        'Codes: `VALIDATION_FAILED`, `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `GONE`, ',
        '`FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `BUSINESS_RULE_VIOLATION`, `RATE_LIMITED`, ',
        '`PROVIDER_UNAVAILABLE`, `MAINTENANCE`, `INTERNAL`, plus domain-specific codes per endpoint.\n',
        '- **404 over 403** when the caller has no visibility — we do not leak existence.\n',
        '- **Money is integer Naira at the boundary** (not kobo). DB columns are `Int`. See DECISIONS.md 0001.\n',
        '- **Time is ISO 8601 UTC**, with `+01:00` Africa/Lagos offset on dashboard responses.\n',
        '- **Pagination.** Worker mobile uses cursor; dashboard uses offset (`?page=&pageSize=`, max 100).\n',
        '- **Real-time.** Server-Sent Events at `GET /v1/stream`, scoped to the caller\'s tenant — Phase 4.\n',
      ].join(''),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: [
          'Worker access token (mobile audience). Issued by `POST /auth/otp/verify` or `POST /auth/refresh`. ',
          'Distinct from `bearer-user` — a worker token cannot authenticate dashboard endpoints and vice versa.',
        ].join(''),
      },
      'bearer',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: [
          'Dashboard user access token (employer + bank audience). Issued by `POST /dashboard/auth/email/login`. ',
          'The companion refresh token is delivered as an `HttpOnly` cookie scoped to `/v1/dashboard/auth` and is ',
          'rotated by `POST /dashboard/auth/refresh`.',
        ].join(''),
      },
      'bearer-user',
    )
    .addServer('http://localhost:3000', 'Local')
    .addServer('https://forgebe-production.up.railway.app', 'Production')
    // ── Worker mobile (Flutter app) ────────────────────────────────────────
    .addTag('Auth', 'Worker mobile — phone+OTP login, signup, profile setup, refresh, logout')
    .addTag('Jobs', 'Worker mobile — nearby feed, job detail, apply (worker view of jobs)')
    .addTag('Applications', 'Worker mobile — "My Jobs" tab: list, detail, withdraw')
    .addTag('Work Sessions', 'Worker mobile — clock-in (geofenced), heartbeat, clock-out (with photo proof + auto-payment)')
    .addTag('Wallet', 'Worker mobile — transaction ledger, withdrawals, linked bank accounts (NIBSS)')
    .addTag('Loans', 'Worker mobile — credit score + tier, active loan, apply for loan, loan detail (worker side)')
    .addTag('Me', 'Worker mobile — profile, preferences, account deletion, phone change, push devices, in-app notifications')
    .addTag('Support', 'Worker mobile — public help articles + authenticated support tickets')
    .addTag('Uploads', 'Worker mobile — direct multipart upload (photos, proof, documents). Returns `upload_id` to reference downstream')
    .addTag(
      'Employers',
      'Worker mobile — employer profile screen (`employer_detail_screen.dart`): hero, stats, about, active jobs, history.',
    )
    // ── Dashboards (employer-web + bank-web) ───────────────────────────────
    .addTag(
      'Dashboard Auth',
      'Employer + Bank — shared auth surface for both dashboards. Email/password login, HttpOnly cookie refresh, /me. Replaces NextAuth on the FE.',
    )
    .addTag(
      'Employer',
      'Employer dashboard — Phase 1+: Overview composite, Jobs (employer view), Workers (active/team/browse), Payments (transactions/invoices/payouts), Analytics, Credit & loans, Notifications, Search, Settings.',
    )
    .addTag(
      'Bank',
      'Bank dashboard — Phase 4+: Risk Radar composite, loan portfolio, bank-scoped notifications. Underwriting Sandbox / Performance Attribution / Borrower Profile are out of scope until the FE is built.',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // BACKEND_BRIEF §14 deliverable: serve the OpenAPI spec at /v1/openapi.json
  // for frontend codegen and contract drift detection.
  app.use('/v1/openapi.json', (_req: Request, res: Response) => {
    res.json(document);
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Forge API listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger docs at      http://localhost:${port}/docs`);
  // eslint-disable-next-line no-console
  console.log(`OpenAPI JSON at      http://localhost:${port}/v1/openapi.json`);
}

void bootstrap();
