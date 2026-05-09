import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: true, credentials: true });

  app.setGlobalPrefix('v1', { exclude: ['docs', 'docs-json', 'health'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

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
        'Backend API for the Forge worker mobile app. All money is whole Naira (integers); ',
        'all timestamps are ISO 8601 UTC; phone numbers are E.164. Cursor pagination is used everywhere — ',
        'never offset. State-changing endpoints flagged with an Idempotency-Key header are safe to retry.',
      ].join(''),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from `POST /auth/otp/verify` or `POST /auth/refresh`.',
      },
      'bearer',
    )
    .addServer('http://localhost:3000', 'Local')
    .addServer('https://api.forge.app', 'Production')
    .addTag('Auth', 'Login, signup, OTP, refresh, logout')
    .addTag('Jobs', 'Feed, detail, apply')
    .addTag('Applications', 'Application status, my applications, withdraw')
    .addTag('Work Sessions', 'Clock-in / heartbeat / clock-out')
    .addTag('Wallet', 'Worker wallet (transactions, withdrawals, banks)')
    .addTag('Loans', 'Credit score, loan apply, loan detail')
    .addTag('Me', 'Profile, settings, preferences, notifications, devices')
    .addTag('Support', 'Help articles, support tickets')
    .addTag('Uploads', 'Photo / file uploads')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Forge API listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger docs at      http://localhost:${port}/docs`);
}

void bootstrap();
