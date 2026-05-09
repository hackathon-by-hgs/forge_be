export type AppConfig = ReturnType<typeof appConfig>;

export const appConfig = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10),
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

  rules: {
    geofenceDefaultRadiusM: parseInt(process.env.GEOFENCE_DEFAULT_RADIUS_M ?? '200', 10),
    withdrawalMinNaira: parseInt(process.env.WITHDRAWAL_MIN_NAIRA ?? '500', 10),
    withdrawalFlatFeeNaira: parseInt(process.env.WITHDRAWAL_FLAT_FEE_NAIRA ?? '50', 10),
  },
});
