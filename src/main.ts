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
        'Forge backend serves three clients on one API:\n\n',
        '1. **Worker mobile app** — `/v1/auth/*`, `/v1/jobs/*`, `/v1/applications/*`, `/v1/sessions/*`, `/v1/me/*`, etc. ',
        'Wire format: `snake_case`, integer Naira, body-based refresh.\n',
        '2. **Employer dashboard** — `/v1/employer/*`. Wire format: `camelCase`, integer Naira at boundary, ',
        'cookie-based refresh.\n',
        '3. **Bank dashboard** — `/v1/bank/*`. Same conventions as employer.\n\n',
        'Common rules: timestamps are ISO 8601, phone numbers are E.164, ',
        'state-changing endpoints flagged with `Idempotency-Key` are safe to retry.',
      ].join(''),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Worker access token from `POST /auth/otp/verify` or `POST /auth/refresh`.',
      },
      'bearer',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Dashboard user access token from `POST /dashboard/auth/email/login`.',
      },
      'bearer-user',
    )
    .addServer('http://localhost:3000', 'Local')
    .addServer('https://forgebe-production.up.railway.app', 'Production')
    .addTag('Auth', 'Worker mobile — login, signup, OTP, refresh, logout')
    .addTag('Jobs', 'Worker mobile — feed, detail, apply')
    .addTag('Applications', 'Worker mobile — application status, my applications, withdraw')
    .addTag('Work Sessions', 'Worker mobile — clock-in / heartbeat / clock-out')
    .addTag('Wallet', 'Worker mobile — transactions, withdrawals, banks')
    .addTag('Loans', 'Worker mobile — credit score, loan apply, loan detail')
    .addTag('Me', 'Worker mobile — profile, settings, preferences, notifications, devices')
    .addTag('Support', 'Worker mobile — help articles, support tickets')
    .addTag('Uploads', 'Worker mobile — photo / file uploads')
    .addTag('Dashboard Auth', 'Employer + Bank — email/password, cookie refresh, /me')
    .addTag('Employer', 'Employer dashboard — overview, jobs, workers, payments, analytics, credit')
    .addTag('Bank', 'Bank dashboard — risk radar, loans, notifications')
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
