import { PrismaService } from '../../prisma/prisma.service';

/**
 * Per-factor weights from BACKEND_BRIEF §11.7. Must sum to 1.
 * Exported so the cron, the live read endpoint, and any test fixture all
 * see the same numbers.
 */
export const FACTOR_WEIGHTS = {
  paymentTimeliness: 0.4,
  workerRetention: 0.2,
  transactionConsistency: 0.2,
  growthTrend: 0.1,
  timeOnPlatform: 0.1,
} as const;

export interface FactorValues {
  paymentTimeliness: number;
  workerRetention: number;
  transactionConsistency: number;
  growthTrend: number;
  timeOnPlatform: number;
  // Side-channel diagnostics — handy for rationale strings on the live read,
  // but not persisted to history.
  diagnostics: {
    repeatWorkers: number;
    totalWorkers: number;
    weeklyOutflowBuckets: number;
    recentJobsLast30: number;
    priorJobsPrior30: number;
    monthsOnPlatform: number;
  };
}

interface EmployerSnapshot {
  joinedAt: Date;
  paymentTimelinessRate: number;
}

/**
 * Compute the 5 factor values for an employer. Pure (modulo Prisma reads).
 * Identical math to the previous inline computation in EmployerCreditService.
 */
export async function computeFactorValues(
  prisma: PrismaService,
  employerId: string,
  employer: EmployerSnapshot,
  now: Date = new Date(),
): Promise<FactorValues> {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const completedApps = await prisma.jobApplication.findMany({
    where: { status: 'completed', job: { employerId } },
    select: {
      workerId: true,
      completedAt: true,
      job: { select: { payAmount: true } },
    },
  });

  const completionsByWorker = new Map<string, number>();
  for (const a of completedApps) {
    completionsByWorker.set(
      a.workerId,
      (completionsByWorker.get(a.workerId) ?? 0) + 1,
    );
  }
  const totalWorkers = completionsByWorker.size;
  const repeatWorkers = Array.from(completionsByWorker.values()).filter(
    (n) => n >= 2,
  ).length;
  const workerRetention = totalWorkers > 0 ? repeatWorkers / totalWorkers : 0;

  const weeklyBuckets = aggregateWeeklyOutflows(
    completedApps,
    ninetyDaysAgo,
    now,
  );
  const transactionConsistency = computeConsistency(weeklyBuckets);

  const last30 = new Date(now.getTime() - 30 * 86_400_000);
  const prior30 = new Date(now.getTime() - 60 * 86_400_000);
  const [recentJobs, priorJobs] = await Promise.all([
    prisma.job.count({ where: { employerId, createdAt: { gte: last30 } } }),
    prisma.job.count({
      where: { employerId, createdAt: { gte: prior30, lt: last30 } },
    }),
  ]);
  const growthTrend = computeGrowthTrend(recentJobs, priorJobs);

  const monthsOn = Math.max(
    0,
    (now.getTime() - employer.joinedAt.getTime()) / (30 * 86_400_000),
  );
  const timeOnPlatform = Math.min(1, monthsOn / 12);

  const paymentTimeliness = clamp01(employer.paymentTimelinessRate);

  return {
    paymentTimeliness: round2(paymentTimeliness),
    workerRetention: round2(workerRetention),
    transactionConsistency: round2(transactionConsistency),
    growthTrend: round2(growthTrend),
    timeOnPlatform: round2(timeOnPlatform),
    diagnostics: {
      repeatWorkers,
      totalWorkers,
      weeklyOutflowBuckets: weeklyBuckets.length,
      recentJobsLast30: recentJobs,
      priorJobsPrior30: priorJobs,
      monthsOnPlatform: monthsOn,
    },
  };
}

/**
 * Convert factor values (each 0..1) to a 0..100 score using the §11.7 weights.
 * Weighted average → multiply by 100 → round.
 */
export function scoreFromFactors(v: FactorValues): number {
  const weighted =
    v.paymentTimeliness * FACTOR_WEIGHTS.paymentTimeliness +
    v.workerRetention * FACTOR_WEIGHTS.workerRetention +
    v.transactionConsistency * FACTOR_WEIGHTS.transactionConsistency +
    v.growthTrend * FACTOR_WEIGHTS.growthTrend +
    v.timeOnPlatform * FACTOR_WEIGHTS.timeOnPlatform;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregateWeeklyOutflows(
  apps: { completedAt: Date | null; job: { payAmount: number } }[],
  start: Date,
  end: Date,
): number[] {
  const weeks = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (7 * 86_400_000)),
  );
  const buckets = new Array<number>(weeks).fill(0);
  for (const a of apps) {
    if (!a.completedAt) continue;
    const t = a.completedAt.getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    const idx = Math.min(
      weeks - 1,
      Math.floor((t - start.getTime()) / (7 * 86_400_000)),
    );
    buckets[idx] += a.job.payAmount;
  }
  return buckets;
}

function computeConsistency(buckets: number[]): number {
  if (buckets.length === 0) return 0;
  const mean = buckets.reduce((a, b) => a + b, 0) / buckets.length;
  if (mean === 0) return 0;
  const variance =
    buckets.reduce((acc, v) => acc + (v - mean) ** 2, 0) / buckets.length;
  const stddev = Math.sqrt(variance);
  return clamp01(1 - stddev / mean);
}

function computeGrowthTrend(recent: number, prior: number): number {
  if (prior === 0) {
    return recent > 0 ? 0.5 : 0.3;
  }
  return clamp01(recent / (2 * prior));
}
