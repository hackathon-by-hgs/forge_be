# syntax=docker/dockerfile:1.7

# ─── Builder stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# argon2 falls back to native compilation on musl when no prebuilt is found.
# python3 + make + g++ cover that path. Stripped from the production image.
RUN apk add --no-cache python3 make g++ libc6-compat

# corepack picks up the pinned pnpm version from package.json's `packageManager`
# field — no `@latest` lottery. We copy package.json first so the version pin is
# available before we ask corepack to prepare anything.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare --activate

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate
RUN pnpm run build
RUN pnpm prune --prod

# ─── Production stage ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# libc6-compat is needed at runtime for argon2's native bindings on musl.
RUN apk add --no-cache libc6-compat tini

ENV NODE_ENV=production

# Same packageManager pin as the builder.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare --activate

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Railway injects PORT — main.ts honors it, default 3000.
EXPOSE 8080

# tini reaps zombies. The migrate runs before the API boots; if no migrations
# exist (we use `db push` for now), it's a no-op and exits 0.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/src/main.js"]
