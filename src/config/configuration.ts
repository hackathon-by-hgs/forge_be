export type AppConfig = ReturnType<typeof appConfig>;

export const appConfig = () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  return {
    nodeEnv,
    port: parseInt(process.env.PORT ?? '3000', 10),

    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
      accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
      refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10),
      // Dashboard (web) users: separate secret pair so a compromised mobile secret
      // cannot mint dashboard tokens and vice versa.
      userAccessSecret:
        process.env.USER_JWT_ACCESS_SECRET ??
        process.env.JWT_ACCESS_SECRET ??
        'dev-user-access-secret',
      userRefreshSecret:
        process.env.USER_JWT_REFRESH_SECRET ??
        process.env.JWT_REFRESH_SECRET ??
        'dev-user-refresh-secret',
      userAccessTtlSeconds: parseInt(
        process.env.USER_JWT_ACCESS_TTL ?? '900',
        10,
      ),
      userRefreshTtlSeconds: parseInt(
        process.env.USER_JWT_REFRESH_TTL ?? '2592000',
        10,
      ),
    },

    cookies: {
      // Cookie domain: set to `.forge.app` (or your apex) in prod ONLY if the FE and BE
      // share a parent domain — then employer.forge.app + bank.forge.app share the session.
      // When FE and BE live on unrelated hosts (e.g. forgefe.up.railway.app +
      // forgebe-production.up.railway.app), leave this unset and rely on SameSite=None.
      domain: process.env.COOKIE_DOMAIN || undefined,

      // Production: secure=true (browsers reject SameSite=None without it).
      // Development: secure=false so the cookie attaches over plain http://localhost.
      secure:
        (process.env.COOKIE_SECURE ?? (isProd ? 'true' : 'false')) === 'true',

      // Production: SameSite=None so the refresh cookie is sent on cross-site fetch
      // from the FE app (e.g. forgefe.up.railway.app → forgebe-production.up.railway.app).
      // Development: SameSite=Lax so the cookie still attaches on localhost without https.
      // Override with COOKIE_SAMESITE if FE + BE share a parent domain (use `lax`).
      sameSite: (process.env.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax')) as
        | 'lax'
        | 'strict'
        | 'none',

      refreshName: 'forge_rt',
    },

    email: {
      // Provider: 'resend' (default) | 'stub'. 'stub' just logs — useful in dev.
      provider: (process.env.EMAIL_PROVIDER ??
        (process.env.EMAIL_API_KEY ? 'resend' : 'stub')) as 'resend' | 'stub',
      // From address. With Resend, the domain MUST be verified in the Resend dashboard.
      // Format may include a display name, e.g. 'Forge <no-reply@forge.app>'.
      from: process.env.EMAIL_FROM ?? 'Forge <no-reply@forge.app>',
      // Optional reply-to address surfaced on outbound mail.
      replyTo: process.env.EMAIL_REPLY_TO ?? null,
      // Resend API key (`re_…`). When unset we fall back to the 'stub' provider.
      apiKey: process.env.EMAIL_API_KEY ?? null,
      // Per-audience dashboard base URLs — used to mint verify/reset links pointing
      // to the correct subdomain. Falls back to APP_BASE_URL.
      employerBaseUrl:
        process.env.EMPLOYER_APP_BASE_URL ??
        process.env.APP_BASE_URL ??
        'http://localhost:7070',
      bankBaseUrl:
        process.env.BANK_APP_BASE_URL ??
        process.env.APP_BASE_URL ??
        'http://localhost:7080',
      // Generic fallback (legacy callers + worker-mobile email links if/when added).
      appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    },

    otp: {
      ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
      resendCooldownSeconds: parseInt(
        process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '30',
        10,
      ),
      maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
      debugExpose: (process.env.OTP_DEBUG_EXPOSE ?? 'false') === 'true',
    },

    uploads: {
      // Legacy local-disk path. Kept for files written before the R2 migration —
      // existing rows still resolve via the static-asset middleware. New writes
      // go to R2 (see `storage` below).
      dir: process.env.UPLOAD_DIR ?? './uploads',
      publicBaseUrl:
        process.env.UPLOAD_PUBLIC_BASE_URL ?? 'http://localhost:3000/uploads',
      ttlHours: parseInt(process.env.UPLOAD_TTL_HOURS ?? '24', 10),
    },

    // Cloudflare R2 (S3-compatible) — primary blob store for every new upload.
    // When the four `R2_*` vars are unset the storage service falls back to
    // the legacy local-disk path so dev / CI keeps working without R2 creds.
    storage: {
      provider: (process.env.STORAGE_PROVIDER ??
        (process.env.R2_ACCESS_KEY_ID ? 'r2' : 'local')) as 'r2' | 'local',
      r2: {
        endpoint: process.env.R2_ENDPOINT ?? null,
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? null,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? null,
        bucket: process.env.R2_BUCKET_NAME ?? null,
        // Public-read base URL for objects (e.g. https://pub-…r2.dev or
        // https://files.forge.app). Trailing slash optional — normalised at use.
        publicUrl: process.env.R2_PUBLIC_URL ?? null,
      },
    },

    // Liveness / Smart Selfie verification — Smile Identity (Lagos).
    // When `partnerId` or `apiKey` is unset, the provider falls back to a 'stub'
    // that always passes — matches the email-stub pattern so dev/local works
    // without vendor credentials. Production MUST set both.
    liveness: {
      provider: (process.env.LIVENESS_PROVIDER ??
        (process.env.SMILE_PARTNER_ID ? 'smile' : 'stub')) as 'smile' | 'stub',
      smile: {
        partnerId: process.env.SMILE_PARTNER_ID ?? null,
        apiKey: process.env.SMILE_API_KEY ?? null,
        // 'sandbox' (testapi.smileidentity.com) or 'production' (api.smileidentity.com).
        environment: (process.env.SMILE_ENVIRONMENT ?? 'sandbox') as
          | 'sandbox'
          | 'production',
        // Optional explicit override; otherwise derived from `environment`.
        baseUrl: process.env.SMILE_BASE_URL ?? null,
        // Confidence floor — Smile rejections come back as ResultCodes; this
        // floor catches borderline-low confidence on success codes.
        minConfidence: parseFloat(process.env.LIVENESS_MIN_CONFIDENCE ?? '0.6'),
      },
      // Per-worker rate limit on /uploads/liveness — defense against abuse + cost control.
      rateLimit: {
        attempts: parseInt(process.env.LIVENESS_RATE_LIMIT_ATTEMPTS ?? '5', 10),
        windowSeconds: parseInt(
          process.env.LIVENESS_RATE_LIMIT_WINDOW_SECONDS ?? '600',
          10,
        ),
      },
    },

    rules: {
      geofenceDefaultRadiusM: parseInt(
        process.env.GEOFENCE_DEFAULT_RADIUS_M ?? '200',
        10,
      ),
      withdrawalMinNaira: parseInt(
        process.env.WITHDRAWAL_MIN_NAIRA ?? '500',
        10,
      ),
      withdrawalFlatFeeNaira: parseInt(
        process.env.WITHDRAWAL_FLAT_FEE_NAIRA ?? '50',
        10,
      ),
    },

    // Squad payment provider — real transfers + checkout + webhooks. Without
    // `SQUAD_SECRET_KEY` we fall back to a 'stub' that fakes everything (matches
    // the email + liveness pattern so dev works without credentials). Production
    // MUST set the real keys.
    squad: {
      provider: (process.env.SQUAD_PROVIDER ??
        (process.env.SQUAD_SECRET_KEY ? 'real' : 'stub')) as 'real' | 'stub',
      publicKey: process.env.SQUAD_PUBLIC_KEY ?? null,
      secretKey: process.env.SQUAD_SECRET_KEY ?? null,
      // HMAC-SHA512 secret used to verify inbound webhook signatures.
      webhookSecret:
        process.env.SQUAD_WEBHOOK_SECRET ??
        process.env.SQUAD_SECRET_KEY ??
        null,
      // 'sandbox' → sandbox-api-d.squadco.com; 'production' → api-d.squadco.com.
      environment: (process.env.SQUAD_ENVIRONMENT ?? 'sandbox') as
        | 'sandbox'
        | 'production',
      baseUrl: process.env.SQUAD_BASE_URL ?? null,
      // Hosted checkout return URL after a top-up. Defaults to the employer base URL + a query route.
      checkoutCallbackUrl: process.env.SQUAD_CHECKOUT_CALLBACK_URL ?? null,
      // SMS sender ID shown in worker handsets. Squad approves the ID at merchant level.
      smsSenderId: process.env.SQUAD_SMS_SENDER_ID ?? 'FORGE',
    },

    // Firebase Cloud Messaging — worker mobile push notifications. Stub mode
    // (no service-account JSON) logs the would-be payload and returns success
    // so dev/CI works without Firebase access. Production MUST provide either
    // FCM_SERVICE_ACCOUNT_JSON (single env var with the inlined JSON) or the
    // discrete FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY triple.
    fcm: {
      provider: (process.env.FCM_PROVIDER ??
        (process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FCM_PRIVATE_KEY
          ? 'real'
          : 'stub')) as 'real' | 'stub',
      serviceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? null,
      projectId: process.env.FCM_PROJECT_ID ?? null,
      clientEmail: process.env.FCM_CLIENT_EMAIL ?? null,
      // PEM private key. Railway/Vercel env vars often replace newlines with
      // literal `\n` — normalised at use.
      privateKey: process.env.FCM_PRIVATE_KEY ?? null,
    },

    // OTP delivery channel selection. `default` is the fallback when the
    // mobile sends `preferred_channel=auto` and no other signal applies.
    otpChannels: {
      // Whether the WhatsApp channel is wired up server-side. When false we
      // skip past it and go straight to SMS — useful while the Termii
      // WhatsApp template / Meta business approval is in flight.
      whatsappEnabled:
        (process.env.OTP_WHATSAPP_ENABLED ?? 'true') === 'true',
      pushEnabled: (process.env.OTP_PUSH_ENABLED ?? 'true') === 'true',
      // Public `/v1/auth/otp/channels` rate limit — protects against phone
      // enumeration even though we always return `available: true`.
      channelsLookupPerPhonePer15Min: parseInt(
        process.env.OTP_CHANNELS_LOOKUP_PER_PHONE_PER_15_MIN ?? '10',
        10,
      ),
    },

    // Anthropic (Claude) — `/v1/ai/*` endpoints. Stub mode (no key) returns
    // deterministic canned outputs so mobile signup + jobs feed work without
    // hitting the AI vendor.
    anthropic: {
      provider: (process.env.ANTHROPIC_PROVIDER ??
        (process.env.ANTHROPIC_API_KEY ? 'real' : 'stub')) as 'real' | 'stub',
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
      summaryModel:
        process.env.ANTHROPIC_SUMMARY_MODEL ?? 'claude-haiku-4-5-20251001',
      summaryTimeoutMs: parseInt(
        process.env.ANTHROPIC_SUMMARY_TIMEOUT_MS ?? '3000',
        10,
      ),
    },
  };
};
