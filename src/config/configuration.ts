export type AppConfig = ReturnType<typeof appConfig>;

export const appConfig = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10),
    // Dashboard (web) users: separate secret pair so a compromised mobile secret
    // cannot mint dashboard tokens and vice versa.
    userAccessSecret: process.env.USER_JWT_ACCESS_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'dev-user-access-secret',
    userRefreshSecret: process.env.USER_JWT_REFRESH_SECRET ?? process.env.JWT_REFRESH_SECRET ?? 'dev-user-refresh-secret',
    userAccessTtlSeconds: parseInt(process.env.USER_JWT_ACCESS_TTL ?? '900', 10),
    userRefreshTtlSeconds: parseInt(process.env.USER_JWT_REFRESH_TTL ?? '2592000', 10),
  },

  cookies: {
    // Cookie domain: `.forge.app` in prod so employer.forge.app + bank.forge.app share the session.
    // Leave undefined in dev so the cookie attaches to localhost.
    domain: process.env.COOKIE_DOMAIN || undefined,
    secure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
    sameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict' | 'none',
    refreshName: 'forge_rt',
  },

  email: {
    // Provider: 'resend' (default) | 'stub'. 'stub' just logs — useful in dev.
    provider: (process.env.EMAIL_PROVIDER ?? (process.env.EMAIL_API_KEY ? 'resend' : 'stub')) as 'resend' | 'stub',
    // From address. With Resend, the domain MUST be verified in the Resend dashboard.
    // Format may include a display name, e.g. 'Forge <no-reply@forge.app>'.
    from: process.env.EMAIL_FROM ?? 'Forge <no-reply@forge.app>',
    // Optional reply-to address surfaced on outbound mail.
    replyTo: process.env.EMAIL_REPLY_TO ?? null,
    // Resend API key (`re_…`). When unset we fall back to the 'stub' provider.
    apiKey: process.env.EMAIL_API_KEY ?? null,
    // Per-audience dashboard base URLs — used to mint verify/reset links pointing
    // to the correct subdomain. Falls back to APP_BASE_URL.
    employerBaseUrl: process.env.EMPLOYER_APP_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:7070',
    bankBaseUrl: process.env.BANK_APP_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:7080',
    // Generic fallback (legacy callers + worker-mobile email links if/when added).
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  },

  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '30', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    debugExpose: (process.env.OTP_DEBUG_EXPOSE ?? 'false') === 'true',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR ?? './uploads',
    publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL ?? 'http://localhost:3000/uploads',
    ttlHours: parseInt(process.env.UPLOAD_TTL_HOURS ?? '24', 10),
  },

  // Liveness / Smart Selfie verification — Smile Identity (Lagos).
  // When `partnerId` or `apiKey` is unset, the provider falls back to a 'stub'
  // that always passes — matches the email-stub pattern so dev/local works
  // without vendor credentials. Production MUST set both.
  liveness: {
    provider: (process.env.LIVENESS_PROVIDER ?? (process.env.SMILE_PARTNER_ID ? 'smile' : 'stub')) as 'smile' | 'stub',
    smile: {
      partnerId: process.env.SMILE_PARTNER_ID ?? null,
      apiKey: process.env.SMILE_API_KEY ?? null,
      // 'sandbox' (testapi.smileidentity.com) or 'production' (api.smileidentity.com).
      environment: (process.env.SMILE_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production',
      // Optional explicit override; otherwise derived from `environment`.
      baseUrl: process.env.SMILE_BASE_URL ?? null,
      // Confidence floor — Smile rejections come back as ResultCodes; this
      // floor catches borderline-low confidence on success codes.
      minConfidence: parseFloat(process.env.LIVENESS_MIN_CONFIDENCE ?? '0.6'),
    },
    // Per-worker rate limit on /uploads/liveness — defense against abuse + cost control.
    rateLimit: {
      attempts: parseInt(process.env.LIVENESS_RATE_LIMIT_ATTEMPTS ?? '5', 10),
      windowSeconds: parseInt(process.env.LIVENESS_RATE_LIMIT_WINDOW_SECONDS ?? '600', 10),
    },
  },

  rules: {
    geofenceDefaultRadiusM: parseInt(process.env.GEOFENCE_DEFAULT_RADIUS_M ?? '200', 10),
    withdrawalMinNaira: parseInt(process.env.WITHDRAWAL_MIN_NAIRA ?? '500', 10),
    withdrawalFlatFeeNaira: parseInt(process.env.WITHDRAWAL_FLAT_FEE_NAIRA ?? '50', 10),
  },
});
