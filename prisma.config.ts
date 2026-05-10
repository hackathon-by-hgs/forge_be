import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// `prisma generate` runs at Docker build time when DATABASE_URL is unset.
// Migrate / db push / seed run at runtime when it is. Pass the URL through
// either way; Prisma will fail loudly with a clear message at the operation
// level if the URL is needed and missing.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
