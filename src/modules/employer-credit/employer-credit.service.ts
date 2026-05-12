import { Injectable } from '@nestjs/common';
import type { EmployerCreditHistory as EmployerCreditHistoryRow } from '@prisma/client';
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
import {
  computeFactorValues,
  FACTOR_WEIGHTS as RAW_FACTOR_WEIGHTS,
} from './employer-credit.factors';

const FACTOR_WEIGHTS: Record<EmployerCreditFactorKey, number> = {
  [EmployerCreditFactorKey.PaymentTimeliness]:
    RAW_FACTOR_WEIGHTS.paymentTimeliness,
  [EmployerCreditFactorKey.WorkerRetention]: RAW_FACTOR_WEIGHTS.workerRetention,
  [EmployerCreditFactorKey.TransactionConsistency]:
    RAW_FACTOR_WEIGHTS.transactionConsistency,
  [EmployerCreditFactorKey.GrowthTrend]: RAW_FACTOR_WEIGHTS.growthTrend,
  [EmployerCreditFactorKey.TimeOnPlatform]: RAW_FACTOR_WEIGHTS.timeOnPlatform,
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

    const [factors, history, activeLoanRow, pastLoanRows] = await Promise.all([
      this.computeFactors(eid, employer),
      this.prisma.employerCreditHistory.findMany({
        where: { employerId: eid },
        orderBy: { capturedAt: 'desc' },
        take: 12 * 7, // up to ~12 weeks of daily rows
      }),
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

    const eligibility = computeEligibility(
      score,
      employer.totalLaborSpendNaira,
    );
    const { trend12Week, scoreDeltaPoints } = this.weeklyTrendFromHistory(
      history,
      score,
    );
    const factorsWithTrend = this.attachFactorTrends(factors, history);

    return {
      score,
      scoreDeltaPoints,
      trend12Week,
      factors: factorsWithTrend,
      eligibility,
      activeLoan: activeLoanRow ? this.toLoanSummary(activeLoanRow) : null,
      pastLoans: pastLoanRows.map((l) => this.toLoanSummary(l)),
    };
  }

  // ── GET /v1/employer/credit/score-history ───────────────────────────────
  async scoreHistory(
    employerId: string | null,
  ): Promise<EmployerScoreHistoryDto> {
    const eid = this.requireScope(employerId);
    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { creditScore: true },
    });
    if (!employer) {
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }
    // Real 12 monthly snapshots when the score-recalc cron has run; fall back
    // to synthetic for employers without history yet.
    const history = await this.prisma.employerCreditHistory.findMany({
      where: { employerId: eid },
      orderBy: { capturedAt: 'desc' },
      take: 365,
    });
    if (history.length === 0) {
      return { data: syntheticMonthlyHistory(employer.creditScore, 12) };
    }
    return { data: monthlyHistoryFromRows(history, 12) };
  }

  // ── Factor computation (BRIEF §11.7) ────────────────────────────────────
  /**
   * Builds the DTO-shaped factor list. Factor *values* and the underlying
   * stats come from the shared helper (so the cron and the live read agree
   * byte-for-byte). Trends are attached later from EmployerCreditHistory
   * once the score-recalc cron has run.
   */
  private async computeFactors(
    employerId: string,
    employer: {
      paymentTimelinessRate: number;
      joinedAt: Date;
    },
  ): Promise<EmployerCreditFactorDto[]> {
    const v = await computeFactorValues(this.prisma, employerId, employer);
    const {
      repeatWorkers,
      totalWorkers,
      weeklyOutflowBuckets,
      recentJobsLast30,
      priorJobsPrior30,
      monthsOnPlatform,
    } = v.diagnostics;

    return [
      {
        key: EmployerCreditFactorKey.PaymentTimeliness,
        label: FACTOR_LABEL[EmployerCreditFactorKey.PaymentTimeliness],
        value: v.paymentTimeliness,
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.PaymentTimeliness],
        trend: syntheticFactorTrend(v.paymentTimeliness, 12),
        rationale: paymentTimelinessRationale(v.paymentTimeliness),
      },
      {
        key: EmployerCreditFactorKey.WorkerRetention,
        label: FACTOR_LABEL[EmployerCreditFactorKey.WorkerRetention],
        value: v.workerRetention,
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.WorkerRetention],
        trend: syntheticFactorTrend(v.workerRetention, 12),
        rationale: workerRetentionRationale(repeatWorkers, totalWorkers),
      },
      {
        key: EmployerCreditFactorKey.TransactionConsistency,
        label: FACTOR_LABEL[EmployerCreditFactorKey.TransactionConsistency],
        value: v.transactionConsistency,
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.TransactionConsistency],
        trend: syntheticFactorTrend(v.transactionConsistency, 12),
        rationale: transactionConsistencyRationale(
          v.transactionConsistency,
          weeklyOutflowBuckets,
        ),
      },
      {
        key: EmployerCreditFactorKey.GrowthTrend,
        label: FACTOR_LABEL[EmployerCreditFactorKey.GrowthTrend],
        value: v.growthTrend,
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.GrowthTrend],
        trend: syntheticFactorTrend(v.growthTrend, 12),
        rationale: growthTrendRationale(recentJobsLast30, priorJobsPrior30),
      },
      {
        key: EmployerCreditFactorKey.TimeOnPlatform,
        label: FACTOR_LABEL[EmployerCreditFactorKey.TimeOnPlatform],
        value: v.timeOnPlatform,
        weight: FACTOR_WEIGHTS[EmployerCreditFactorKey.TimeOnPlatform],
        trend: syntheticFactorTrend(v.timeOnPlatform, 12),
        rationale: timeOnPlatformRationale(monthsOnPlatform),
      },
    ];
  }

  /**
   * Build the 12-week trend from real history rows when present, else fall
   * back to the synthetic ramp anchored at `currentScore`. `scoreDeltaPoints`
   * is `today - 7-days-ago` once we have a row from a week back, otherwise 0.
   */
  private weeklyTrendFromHistory(
    history: EmployerCreditHistoryRow[],
    currentScore: number,
  ): { trend12Week: ScorePointDto[]; scoreDeltaPoints: number } {
    if (history.length === 0) {
      return {
        trend12Week: syntheticWeeklyTrend(currentScore, 12),
        scoreDeltaPoints: 0,
      };
    }
    // history is ordered DESC by capturedAt; pick the latest row per ISO week.
    const byWeek = new Map<string, EmployerCreditHistoryRow>();
    for (const row of history) {
      const key = isoWeekKey(row.capturedAt);
      if (!byWeek.has(key)) byWeek.set(key, row);
    }
    const now = new Date();
    const trend: ScorePointDto[] = [];
    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - i * 7 * 86_400_000);
      const key = isoWeekKey(weekStart);
      const row = byWeek.get(key);
      trend.push({
        date: weekStart.toISOString().slice(0, 10),
        score: row?.score ?? currentScore,
      });
    }
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const priorRow = history.find(
      (r) => r.capturedAt.getTime() <= sevenDaysAgo.getTime(),
    );
    const scoreDeltaPoints = priorRow ? currentScore - priorRow.score : 0;
    return { trend12Week: trend, scoreDeltaPoints };
  }

  /**
   * Replace each factor's synthetic `trend[]` with real per-factor weekly
   * values when history rows exist; otherwise leave the synthetic value in place.
   */
  private attachFactorTrends(
    factors: EmployerCreditFactorDto[],
    history: EmployerCreditHistoryRow[],
  ): EmployerCreditFactorDto[] {
    if (history.length === 0) return factors;
    const byWeek = new Map<string, EmployerCreditHistoryRow>();
    for (const row of history) {
      const key = isoWeekKey(row.capturedAt);
      if (!byWeek.has(key)) byWeek.set(key, row);
    }
    const now = new Date();
    const weekRows: (EmployerCreditHistoryRow | null)[] = [];
    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - i * 7 * 86_400_000);
      weekRows.push(byWeek.get(isoWeekKey(weekStart)) ?? null);
    }
    const pickField = (
      key: EmployerCreditFactorKey,
    ): keyof Pick<
      EmployerCreditHistoryRow,
      | 'paymentTimeliness'
      | 'workerRetention'
      | 'transactionConsistency'
      | 'growthTrend'
      | 'timeOnPlatform'
    > => {
      switch (key) {
        case EmployerCreditFactorKey.PaymentTimeliness:
          return 'paymentTimeliness';
        case EmployerCreditFactorKey.WorkerRetention:
          return 'workerRetention';
        case EmployerCreditFactorKey.TransactionConsistency:
          return 'transactionConsistency';
        case EmployerCreditFactorKey.GrowthTrend:
          return 'growthTrend';
        case EmployerCreditFactorKey.TimeOnPlatform:
          return 'timeOnPlatform';
      }
    };
    return factors.map((f) => {
      const field = pickField(f.key);
      const trend = weekRows.map((row) =>
        row ? Math.round(row[field] * 100) / 100 : f.value,
      );
      return { ...f, trend };
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(
        403,
        'NO_EMPLOYER_SCOPE',
        'This account is not bound to a business.',
      );
    }
    return employerId;
  }

  private toLoanSummary(loan: {
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
  }): EmployerLoanSummaryDto {
    return {
      id: loan.id,
      status: loan.status as LoanStatus,
      principalNaira: loan.principal,
      outstandingNaira: loan.outstandingBalance,
      apr: loan.apr,
      termMonths: loan.termMonths,
      disbursedAt: loan.disbursedAt ? loan.disbursedAt.toISOString() : null,
      nextPaymentDueAt: loan.nextPaymentDueAt
        ? loan.nextPaymentDueAt.toISOString()
        : null,
      expectedFullRepaymentAt: loan.expectedFullRepaymentAt
        ? loan.expectedFullRepaymentAt.toISOString()
        : null,
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
    out.push({
      date: d.toISOString().slice(0, 10),
      score: Math.max(0, Math.min(100, current - drift)),
    });
  }
  return out;
}

function syntheticMonthlyHistory(
  current: number,
  months: number,
): ScorePointDto[] {
  const out: ScorePointDto[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const drift = Math.round((i / Math.max(1, months - 1)) * 4);
    out.push({
      date: d.toISOString().slice(0, 10),
      score: Math.max(0, Math.min(100, current - drift)),
    });
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

/**
 * Pick the row closest to the first of each month for the last `months`
 * months. Falls through to "no entry for that month" → omitted, which the
 * FE renders as a gap.
 */
function monthlyHistoryFromRows(
  rows: EmployerCreditHistoryRow[],
  months: number,
): ScorePointDto[] {
  const byMonth = new Map<string, EmployerCreditHistoryRow>();
  // rows are DESC by capturedAt; first seen for each month wins (latest in month).
  for (const r of rows) {
    const key = `${r.capturedAt.getUTCFullYear()}-${String(r.capturedAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, r);
  }
  const now = new Date();
  const out: ScorePointDto[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    const key = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key);
    if (row) {
      out.push({ date: ref.toISOString().slice(0, 10), score: row.score });
    }
  }
  return out;
}

/**
 * Key a date by its ISO week (Mon-anchored, UTC). Used to bucket history rows
 * onto the weekly trend rail. We pick "Monday of week N of year Y".
 */
function isoWeekKey(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** BRIEF §11.8: ≥80 pre_approved (3× monthly avg), 70–79 eligible (2×), <70 ineligible. */
function computeEligibility(
  score: number,
  totalSpendNaira: number,
): EmployerEligibilityDto {
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
  if (prior === 0 && recent === 0)
    return 'No recent posting activity to compare.';
  if (prior === 0)
    return `New activity — ${recent} job(s) in the last 30 days.`;
  const ratio = recent / prior;
  if (ratio >= 1.5)
    return `Growing fast: ${recent} jobs vs ${prior} the prior 30 days.`;
  if (ratio >= 1)
    return `Stable: ${recent} jobs vs ${prior} the prior 30 days.`;
  return `Slowing: ${recent} jobs vs ${prior} the prior 30 days.`;
}

function timeOnPlatformRationale(months: number): string {
  if (months >= 12)
    return `${Math.floor(months)}+ months on Forge — fully seasoned.`;
  return `${Math.floor(months)} month(s) on Forge — score builds with tenure.`;
}
