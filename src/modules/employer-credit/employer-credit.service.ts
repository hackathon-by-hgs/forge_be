import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { LoanRiskLevel, LoanStatus } from '../bank/dto/loans.dto';
import {
  EmployerCreditDto,
  EmployerCreditFactorDto,
  EmployerCreditFactorKey,
  EmployerEligibilityDto,
  EmployerEligibilityTier,
  EmployerLoanSummaryDto,
  EmployerScoreHistoryDto,
  ScorePointDto,
} from './dto/credit.dto';

const FACTOR_WEIGHTS: Record<EmployerCreditFactorKey, number> = {
  [EmployerCreditFactorKey.PaymentTimeliness]: 0.4,
  [EmployerCreditFactorKey.WorkerRetention]: 0.2,
  [EmployerCreditFactorKey.TransactionConsistency]: 0.2,
  [EmployerCreditFactorKey.GrowthTrend]: 0.1,
  [EmployerCreditFactorKey.TimeOnPlatform]: 0.1,
};

const FACTOR_LABEL: Record<EmployerCreditFactorKey, string> = {
  [EmployerCreditFactorKey.PaymentTimeliness]: 'Payment timeliness',
  [EmployerCreditFactorKey.WorkerRetention]: 'Worker retention',
  [EmployerCreditFactorKey.TransactionConsistency]: 'Transaction consistency',
  [EmployerCreditFactorKey.GrowthTrend]: 'Growth trend',
  [EmployerCreditFactorKey.TimeOnPlatform]: 'Time on platform',
};

const ACTIVE_LOAN_STATUSES = ['active', 'at_risk', 'approved'];
const PAST_LOAN_STATUSES = ['repaid', 'defaulted', 'rejected', 'written_off'];

@Injectable()
export class EmployerCreditService {
  constructor(private readonly prisma: PrismaService) {}

  // ── GET /v1/employer/credit ─────────────────────────────────────────────
  async credit(employerId: string | null): Promise<EmployerCreditDto> {
    const eid = this.requireScope(employerId);
    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: {
        id: true,
        creditScore: true,
        joinedAt: true,
        totalLaborSpendNaira: true,
        paymentTimelinessRate: true,
        workersHired: true,
        jobsPosted: true,
      },
    });
    if (!employer) {
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }

    const score = employer.creditScore;

    const [factors, activeLoanRow, pastLoanRows] = await Promise.all([
      this.computeFactors(eid, employer),
      this.prisma.loan.findFirst({
        where: { employerId: eid, status: { in: ACTIVE_LOAN_STATUSES } },
        include: { bank: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loan.findMany({
        where: { employerId: eid, status: { in: PAST_LOAN_STATUSES } },
        include: { bank: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const eligibility = computeEligibility(score, employer.totalLaborSpendNaira);

    return {
      score,
      // Until the score-recalc cron writes history rows, we have no real delta.
      // Surface 0 explicitly so the FE knows not to render a misleading arrow.
      scoreDeltaPoints: 0,
      trend12Week: syntheticWeeklyTrend(score, 12),
      factors,
      eligibility,
      activeLoan: activeLoanRow ? this.toLoanSummary(activeLoanRow) : null,
      pastLoans: pastLoanRows.map((l) => this.toLoanSummary(l)),
    };
  }

  // ── GET /v1/employer/credit/score-history ───────────────────────────────
  async scoreHistory(employerId: string | null): Promise<EmployerScoreHistoryDto> {
    const eid = this.requireScope(employerId);
    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { creditScore: true },
    });
    if (!employer) {
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }
    // Synthetic 12 monthly snapshots until score-recalc cron writes history.
    return { data: syntheticMonthlyHistory(employer.creditScore, 12) };
  }

  // ── Factor computation (BRIEF §11.7) ────────────────────────────────────
  private async computeFactors(
    employerId: string,
    employer: {
      paymentTimelinessRate: number;
      joinedAt: Date;
    },
  ): Promise<EmployerCreditFactorDto[]> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

    // Worker retention: distinct workers who completed ≥ 2 jobs for this employer
    // divided by distinct workers who completed any job for this employer.
    const completedApps = await this.prisma.jobApplication.findMany({
      where: { status: 'completed', job: { employerId } },
      select: { workerId: true, completedAt: true, job: { select: { payAmount: true } } },
    });
    const completionsByWorker = new Map<string, number>();
    for (const a of completedApps) {
      completionsByWorker.set(a.workerId, (completionsByWorker.get(a.workerId) ?? 0) + 1);
    }
    const totalWorkers = completionsByWorker.size;
    const repeatWorkers = Array.from(completionsByWorker.values()).filter((n) => n >= 2).length;
    const workerRetention = totalWorkers > 0 ? repeatWorkers / totalWorkers : 0;

    // Transaction consistency: 1 - coefficient of variation of weekly outflows
    // over the last 90 days. Higher when spend is steady, lower when spiky.
    const weeklyTotals = aggregateWeeklyOutflows(completedApps, ninetyDaysAgo, now);
    const transactionConsistency = computeConsistency(weeklyTotals);

    // Growth trend: ratio of jobs posted in the last 30 days to the prior 30 days.
    // Clamped to 0..1 so a doubling-or-better caps at 1.
    const last30 = new Date(now.getTime() - 30 * 86_400_000);
    const prior30 = new Date(now.getTime() - 60 * 86_400_000);
    const [recentJobs, priorJobs] = await Promise.all([
      this.prisma.job.count({ where: { employerId, createdAt: { gte: last30 } } }),
      this.prisma.job.count({ where: { employerId, createdAt: { gte: prior30, lt: last30 } } }),
    ]);
    const growthTrend = computeGrowthTrend(recentJobs, priorJobs);

    // Time on platform: min(1, months since joinedAt / 12).
    const monthsOn = Math.max(0, (now.getTime() - employer.joinedAt.getTime()) / (30 * 86_400_000));
    const timeOnPlatform = Math.min(1, monthsOn / 12);

    const paymentTimeliness = clamp01(employer.paymentTimelinessRate);

    const factors: EmployerCreditFactorDto[] = [
      {
        key: EmployerCreditFactorKey.PaymentTimeliness,
        label: FACTOR_LABEL[EmployerCreditFactorKey.PaymentTimeliness],
        value: round2(paymentTimeliness),
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.PaymentTimeliness],
        trend: syntheticFactorTrend(paymentTimeliness, 12),
        rationale: paymentTimelinessRationale(paymentTimeliness),
      },
      {
        key: EmployerCreditFactorKey.WorkerRetention,
        label: FACTOR_LABEL[EmployerCreditFactorKey.WorkerRetention],
        value: round2(workerRetention),
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.WorkerRetention],
        trend: syntheticFactorTrend(workerRetention, 12),
        rationale: workerRetentionRationale(repeatWorkers, totalWorkers),
      },
      {
        key: EmployerCreditFactorKey.TransactionConsistency,
        label: FACTOR_LABEL[EmployerCreditFactorKey.TransactionConsistency],
        value: round2(transactionConsistency),
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.TransactionConsistency],
        trend: syntheticFactorTrend(transactionConsistency, 12),
        rationale: transactionConsistencyRationale(transactionConsistency, weeklyTotals.length),
      },
      {
        key: EmployerCreditFactorKey.GrowthTrend,
        label: FACTOR_LABEL[EmployerCreditFactorKey.GrowthTrend],
        value: round2(growthTrend),
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.GrowthTrend],
        trend: syntheticFactorTrend(growthTrend, 12),
        rationale: growthTrendRationale(recentJobs, priorJobs),
      },
      {
        key: EmployerCreditFactorKey.TimeOnPlatform,
        label: FACTOR_LABEL[EmployerCreditFactorKey.TimeOnPlatform],
        value: round2(timeOnPlatform),
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.TimeOnPlatform],
        trend: syntheticFactorTrend(timeOnPlatform, 12),
        rationale: timeOnPlatformRationale(monthsOn),
      },
    ];

    return factors;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private toLoanSummary(
    loan: {
      id: string;
      status: string;
      principal: number;
      outstandingBalance: number;
      apr: number;
      termMonths: number | null;
      disbursedAt: Date | null;
      nextPaymentDueAt: Date | null;
      expectedFullRepaymentAt: Date | null;
      riskLevel: string;
      bank: { name: string } | null;
    },
  ): EmployerLoanSummaryDto {
    return {
      id: loan.id,
      status: loan.status as LoanStatus,
      principalNaira: loan.principal,
      outstandingNaira: loan.outstandingBalance,
      apr: loan.apr,
      termMonths: loan.termMonths,
      disbursedAt: loan.disbursedAt ? loan.disbursedAt.toISOString() : null,
      nextPaymentDueAt: loan.nextPaymentDueAt ? loan.nextPaymentDueAt.toISOString() : null,
      expectedFullRepaymentAt: loan.expectedFullRepaymentAt ? loan.expectedFullRepaymentAt.toISOString() : null,
      bankName: loan.bank?.name ?? null,
      riskLevel: (loan.riskLevel as LoanRiskLevel) ?? LoanRiskLevel.Green,
    };
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Synthetic 12-week score series anchored at `current`. We add a small
 * deterministic ramp so the chart isn't a flat line — once the score-recalc
 * cron writes history, this gets replaced with the real series.
 */
function syntheticWeeklyTrend(current: number, weeks: number): ScorePointDto[] {
  const out: ScorePointDto[] = [];
  const now = new Date();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86_400_000);
    // Drift down 0–2 points further back in time so today is the apex; bounded 0..100.
    const drift = Math.round((i / Math.max(1, weeks - 1)) * 2);
    out.push({ date: d.toISOString().slice(0, 10), score: Math.max(0, Math.min(100, current - drift)) });
  }
  return out;
}

function syntheticMonthlyHistory(current: number, months: number): ScorePointDto[] {
  const out: ScorePointDto[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const drift = Math.round((i / Math.max(1, months - 1)) * 4);
    out.push({ date: d.toISOString().slice(0, 10), score: Math.max(0, Math.min(100, current - drift)) });
  }
  return out;
}

function syntheticFactorTrend(current: number, periods: number): number[] {
  const out: number[] = [];
  for (let i = periods - 1; i >= 0; i--) {
    const drift = (i / Math.max(1, periods - 1)) * 0.04;
    out.push(round2(clamp01(current - drift)));
  }
  return out;
}

function aggregateWeeklyOutflows(
  apps: { completedAt: Date | null; job: { payAmount: number } }[],
  start: Date,
  end: Date,
): number[] {
  const weeks = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * 86_400_000)));
  const buckets = new Array<number>(weeks).fill(0);
  for (const a of apps) {
    if (!a.completedAt) continue;
    const t = a.completedAt.getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    const idx = Math.min(weeks - 1, Math.floor((t - start.getTime()) / (7 * 86_400_000)));
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
  // 1 - CV, clamped 0..1. Lower CV = more consistent spend = higher score.
  return clamp01(1 - stddev / mean);
}

function computeGrowthTrend(recent: number, prior: number): number {
  if (prior === 0) {
    // First-month employer or quiet period — neutral score so we don't double-count
    // a "new business" signal that's already in `time_on_platform`.
    return recent > 0 ? 0.5 : 0.3;
  }
  return clamp01(recent / (2 * prior));
}

/** BRIEF §11.8: ≥80 pre_approved (3× monthly avg), 70–79 eligible (2×), <70 ineligible. */
function computeEligibility(score: number, totalSpendNaira: number): EmployerEligibilityDto {
  const monthlyAvg = Math.max(0, Math.round(totalSpendNaira / 12));
  if (score >= 80) {
    return {
      tier: EmployerEligibilityTier.PreApproved,
      maxAmountNaira: Math.min(monthlyAvg * 3, 5_000_000),
      aprPct: 0.12,
      estimatedDecisionAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }
  if (score >= 70) {
    return {
      tier: EmployerEligibilityTier.Eligible,
      maxAmountNaira: Math.min(monthlyAvg * 2, 2_000_000),
      aprPct: 0.14,
      estimatedDecisionAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    };
  }
  return {
    tier: EmployerEligibilityTier.Ineligible,
    maxAmountNaira: 0,
    aprPct: 0,
    estimatedDecisionAt: null,
  };
}

function paymentTimelinessRationale(value: number): string {
  if (value >= 0.95) return 'Near-perfect on-time payment record.';
  if (value >= 0.85) return 'Consistently pays workers on schedule.';
  if (value >= 0.7) return 'Occasional late payments; consider auto-debit.';
  return 'Late payments are weighing on the score.';
}

function workerRetentionRationale(repeat: number, total: number): string {
  if (total === 0) return 'No completed hires yet — score is provisional.';
  const pct = Math.round((repeat / total) * 100);
  return `${repeat}/${total} hired workers (${pct}%) have done multiple jobs for you.`;
}

function transactionConsistencyRationale(value: number, weeks: number): string {
  if (weeks === 0) return 'Not enough transaction history yet.';
  if (value >= 0.8) return 'Spend is steady week-to-week.';
  if (value >= 0.5) return 'Moderate week-to-week variation in spend.';
  return 'Spend is spiky — banks prefer steadier cash flow.';
}

function growthTrendRationale(recent: number, prior: number): string {
  if (prior === 0 && recent === 0) return 'No recent posting activity to compare.';
  if (prior === 0) return `New activity — ${recent} job(s) in the last 30 days.`;
  const ratio = recent / prior;
  if (ratio >= 1.5) return `Growing fast: ${recent} jobs vs ${prior} the prior 30 days.`;
  if (ratio >= 1) return `Stable: ${recent} jobs vs ${prior} the prior 30 days.`;
  return `Slowing: ${recent} jobs vs ${prior} the prior 30 days.`;
}

function timeOnPlatformRationale(months: number): string {
  if (months >= 12) return `${Math.floor(months)}+ months on Forge — fully seasoned.`;
  return `${Math.floor(months)} month(s) on Forge — score builds with tenure.`;
}
