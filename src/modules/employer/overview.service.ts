import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import {
  AttentionItemDto,
  CashPositionDto,
  CreditHealthDto,
  EmployerOverviewDto,
  LiveJobPinDto,
  MetricTileDto,
  OverviewMetricsDto,
  SpendDayDto,
  StartingSoonJobDto,
} from './dto/overview.dto';

const ACTIVE_STATUSES = ['open', 'applications_in', 'accepted', 'in_progress', 'pending_verification'];
const LATE_THRESHOLD_MINUTES = 15;
const STARTING_SOON_HOURS = 6;
const TREND_BUCKETS = 9;
const SPEND_TREND_DAYS = 7;

@Injectable()
export class EmployerOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(employerId: string | null): Promise<EmployerOverviewDto> {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }

    const now = new Date();
    const startOfToday = startOfDay(now);
    const sevenDaysAgo = addDays(startOfToday, -SPEND_TREND_DAYS + 1);
    const trendStart = addDays(startOfToday, -(TREND_BUCKETS - 1));

    const [employer, jobs, recentTransactions, recentJobsForTrend] = await Promise.all([
      this.prisma.employer.findUnique({
        where: { id: employerId },
        select: {
          id: true,
          walletBalanceNaira: true,
          creditScore: true,
          totalLaborSpendNaira: true,
          paymentTimelinessRate: true,
        },
      }),
      this.prisma.job.findMany({
        where: { employerId, deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          startTime: true,
          payAmount: true,
          neighborhood: true,
          lat: true,
          lng: true,
          applicantsCount: true,
          createdAt: true,
        },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.transaction.findMany({
        where: {
          employerId,
          timestamp: { gte: trendStart },
        },
        select: { amount: true, status: true, timestamp: true },
      }),
      this.prisma.job.findMany({
        where: {
          employerId,
          deletedAt: null,
          createdAt: { gte: trendStart },
        },
        select: { createdAt: true, completedAt: true, status: true },
      }),
    ]);

    if (!employer) {
      // Auth said you have an employerId but the row is gone — surface as NOT_FOUND
      // rather than 500 to match the BRIEF "404 over 403, never leak existence" rule.
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }

    const activeJobs = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));

    // ── Metrics tiles ──────────────────────────────────────────────────────
    const activeJobsTrend = bucketCountByDay(
      recentJobsForTrend
        .filter((j) => ACTIVE_STATUSES.includes(j.status))
        .map((j) => j.createdAt),
      trendStart,
      TREND_BUCKETS,
    );
    const workersWorkingNow = activeJobs.filter((j) => j.status === 'in_progress').length;
    const workersWorkingTrend = bucketCountByDay(
      recentJobsForTrend
        .filter((j) => j.status === 'in_progress' || j.status === 'completed')
        .map((j) => j.createdAt),
      trendStart,
      TREND_BUCKETS,
    );

    const completedTxs = recentTransactions.filter((t) => t.status === 'completed' || t.status === 'succeeded');
    const todaySpend = completedTxs
      .filter((t) => t.timestamp >= startOfToday)
      .reduce((acc, t) => acc + t.amount, 0);
    const todaySpendTrend = bucketSumByDay(
      completedTxs.map((t) => ({ at: t.timestamp, value: t.amount })),
      trendStart,
      TREND_BUCKETS,
    );

    const pendingTxs = recentTransactions.filter((t) => t.status === 'pending' || t.status === 'processing');
    const pendingTrend = bucketCountByDay(
      pendingTxs.map((t) => t.timestamp),
      trendStart,
      TREND_BUCKETS,
    );

    const metrics: OverviewMetricsDto = {
      activeJobs: tile(activeJobs.length, activeJobsTrend),
      workersWorking: tile(workersWorkingNow, workersWorkingTrend),
      todaySpendNaira: tile(todaySpend, todaySpendTrend),
      pendingPayments: tile(pendingTxs.length, pendingTrend),
    };

    // ── Live jobs ──────────────────────────────────────────────────────────
    const liveJobs: LiveJobPinDto[] = activeJobs.slice(0, 50).map((j) => ({
      id: j.id,
      lat: j.lat,
      lng: j.lng,
      status: j.status,
    }));

    // ── Attention ──────────────────────────────────────────────────────────
    const attention: AttentionItemDto[] = [];

    const applicationsWaiting = activeJobs.reduce(
      (acc, j) => acc + (j.status === 'applications_in' || j.status === 'open' ? j.applicantsCount : 0),
      0,
    );
    if (applicationsWaiting > 0) {
      attention.push({ kind: 'applications_waiting', count: applicationsWaiting, href: '/jobs/active' });
    }

    const startingSoonWindow = addMinutes(now, STARTING_SOON_HOURS * 60);
    const startingSoonCount = activeJobs.filter(
      (j) => j.startTime > now && j.startTime <= startingSoonWindow,
    ).length;
    if (startingSoonCount > 0) {
      attention.push({ kind: 'starting_soon', count: startingSoonCount, href: '/jobs/active' });
    }

    const lateThreshold = addMinutes(now, -LATE_THRESHOLD_MINUTES);
    const workerLateCount = activeJobs.filter(
      (j) => (j.status === 'accepted' || j.status === 'open') && j.startTime <= lateThreshold,
    ).length;
    if (workerLateCount > 0) {
      attention.push({ kind: 'worker_late', count: workerLateCount, href: '/workers/active' });
    }

    // ── Cash position ──────────────────────────────────────────────────────
    const spendTrend7d: SpendDayDto[] = bucketSumByDay(
      completedTxs
        .filter((t) => t.timestamp >= sevenDaysAgo)
        .map((t) => ({ at: t.timestamp, value: t.amount })),
      sevenDaysAgo,
      SPEND_TREND_DAYS,
    ).map((amount, i) => ({
      day: formatDay(addDays(sevenDaysAgo, i)),
      amountNaira: amount,
    }));
    const last7Total = spendTrend7d.reduce((acc, d) => acc + d.amountNaira, 0);
    const cashPosition: CashPositionDto = {
      walletBalanceNaira: employer.walletBalanceNaira,
      projectedWeeklySpendNaira: last7Total,
      spendTrend7d,
    };

    // ── Credit health ──────────────────────────────────────────────────────
    // Until the scoring engine emits factor breakdowns, surface a stable, derived
    // top-factors view. Real factor deltas land with Phase 4 analytics.
    const score = employer.creditScore;
    const eligibility = computeEligibility(score, employer.totalLaborSpendNaira);
    const creditHealth: CreditHealthDto = {
      score,
      deltaPoints: 0,
      topFactors: [
        { label: 'Payment timeliness', deltaPoints: Math.round((employer.paymentTimelinessRate - 0.85) * 60) },
        { label: 'Worker retention', deltaPoints: 0 },
        { label: 'Job cancellation rate', deltaPoints: 0 },
      ],
      eligibility,
    };

    // ── Starting soon ──────────────────────────────────────────────────────
    const startingSoon: StartingSoonJobDto[] = activeJobs
      .filter((j) => j.startTime > now)
      .slice(0, 4)
      .map((j) => ({
        id: j.id,
        title: j.title,
        neighborhood: j.neighborhood ?? null,
        scheduledStartAt: j.startTime.toISOString(),
        payNaira: j.payAmount,
      }));

    return {
      metrics,
      liveJobs,
      attention,
      cashPosition,
      creditHealth,
      startingSoon,
    };
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function tile(value: number, trend: number[]): MetricTileDto {
  // deltaPct compares the most recent bucket to the prior bucket. Trend is oldest-first.
  const last = trend[trend.length - 1] ?? 0;
  const prev = trend[trend.length - 2] ?? 0;
  const deltaPct = prev === 0 ? 0 : ((last - prev) / prev) * 100;
  return { value, deltaPct: Math.round(deltaPct * 10) / 10, trend };
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function formatDay(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function bucketCountByDay(timestamps: Date[], start: Date, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (const t of timestamps) {
    const idx = Math.floor((startOfDay(t).getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < buckets) out[idx] += 1;
  }
  return out;
}

function bucketSumByDay(
  rows: { at: Date; value: number }[],
  start: Date,
  buckets: number,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (const { at, value } of rows) {
    const idx = Math.floor((startOfDay(at).getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < buckets) out[idx] += value;
  }
  return out;
}

function computeEligibility(score: number, totalSpendNaira: number): {
  maxAmountNaira: number;
  aprPct: number;
} {
  // BACKEND_BRIEF §11.8: ≥80 → pre_approved (3× monthly avg labor spend),
  // 70–79 → eligible (2× monthly avg), <70 → ineligible.
  // Approximate "monthly avg" as 1/12 of the running total (rough but stable).
  const monthlyAvg = Math.max(0, Math.round(totalSpendNaira / 12));
  if (score >= 80) {
    return { maxAmountNaira: Math.min(monthlyAvg * 3, 5_000_000), aprPct: 12 };
  }
  if (score >= 70) {
    return { maxAmountNaira: Math.min(monthlyAvg * 2, 2_000_000), aprPct: 14 };
  }
  return { maxAmountNaira: 0, aprPct: 0 };
}
