import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import {
  AnalyticsWindowDays,
  AnalyticsWindowQueryDto,
  AttributionFactorDto,
  AttributionKey,
  AttributionResponseDto,
  BorrowerTypeCohortDto,
  CohortResponseDto,
  PeriodKpiResponseDto,
  PeriodMetricsDto,
  ScoreBandCohortDto,
  StatusBreakdownDto,
  VintageCurvesQueryDto,
  VintageCurvesResponseDto,
} from './dto/analytics.dto';

/**
 * Status values that represent an actually-disbursed loan (i.e. the bank
 * committed real money). Drafts and rejected applications never reached
 * disbursement and are excluded from every analytics computation.
 */
const DISBURSED_STATUSES = [
  'approved',
  'active',
  'at_risk',
  'repaid',
  'defaulted',
  'written_off',
] as const;

const DEFAULT_STATUSES = ['defaulted', 'written_off'] as const;

/** §B3 — score-band cuts, ordered top → bottom. */
const SCORE_BANDS: Array<{
  label: ScoreBandCohortDto['label'];
  min: ScoreBandCohortDto['min'];
  max: ScoreBandCohortDto['max'];
}> = [
  { label: '90–100', min: 90, max: 100 },
  { label: '80–89', min: 80, max: 89 },
  { label: '70–79', min: 70, max: 79 },
  { label: '60–69', min: 60, max: 69 },
];

interface LoanRow {
  principal: number;
  outstandingBalance: number;
  apr: number;
  /** Nullable in the schema — old loans pre-dating the term field have `null`.
   *  Treated as missing data in averages (filtered out, not zero-padded). */
  termMonths: number | null;
  status: string;
  borrowerType: string;
  scoreAtApproval: number | null;
  disbursedAt: Date | null;
}

@Injectable()
export class BankAnalyticsService {
  private readonly logger = new Logger(BankAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── B1 — Period KPIs ──────────────────────────────────────────────────

  async period(
    bankId: string | null,
    q: AnalyticsWindowQueryDto,
  ): Promise<PeriodKpiResponseDto> {
    const bid = this.requireScope(bankId);
    const { window: days } = q;
    const asOf = this.resolveAsOf(q.as_of);
    const current = this.windowFor(asOf, days);
    const prior = this.windowFor(current.from, days);

    const [currentLoans, priorLoans] = await Promise.all([
      this.loansInWindow(bid, current.from, current.to),
      this.loansInWindow(bid, prior.from, prior.to),
    ]);

    const currentMetrics = this.computeMetrics(currentLoans);
    const priorMetrics = this.computeMetrics(priorLoans);

    return {
      window: this.serializeRange(current, days),
      prior: this.serializeRange(prior, days),
      current: currentMetrics,
      priorMetrics,
      deltaBps: {
        repaymentRate: this.bps(currentMetrics.repaymentRate - priorMetrics.repaymentRate),
        defaultRate: this.bps(currentMetrics.defaultRate - priorMetrics.defaultRate),
        netYield: this.bps(currentMetrics.netYield - priorMetrics.netYield),
      },
    };
  }

  // ── B2 — Attribution ──────────────────────────────────────────────────

  async attribution(
    bankId: string | null,
    q: AnalyticsWindowQueryDto,
  ): Promise<AttributionResponseDto> {
    const bid = this.requireScope(bankId);
    const { window: days } = q;
    const asOf = this.resolveAsOf(q.as_of);
    const current = this.windowFor(asOf, days);
    const prior = this.windowFor(current.from, days);

    const [currentLoans, priorLoans] = await Promise.all([
      this.loansInWindow(bid, current.from, current.to),
      this.loansInWindow(bid, prior.from, prior.to),
    ]);

    const cur = this.computeMetrics(currentLoans);
    const pri = this.computeMetrics(priorLoans);
    const totalDeltaBps = this.bps(cur.repaymentRate - pri.repaymentRate);

    // §B2 — empty when either window is empty.
    if (cur.count === 0 || pri.count === 0) {
      return {
        window: this.serializeRange(current, days),
        totalDeltaBps,
        factors: [],
      };
    }

    // §B2 reference decomposition — coefficients are placeholder weights;
    // tune via regression once we have ≥ 6 months of real loan history.
    const scoreShift = cur.avgScoreAtApproval - pri.avgScoreAtApproval;
    const tenureShift = cur.avgTermMonths - pri.avgTermMonths;
    const mixShift = cur.workerShare - pri.workerShare;

    const factors: AttributionFactorDto[] = [];
    const push = (key: AttributionKey, label: string, bps: number, detail: string) => {
      factors.push({ key, label, bps, detail });
    };

    push(
      'borrower_mix',
      'Borrower mix',
      Math.round(scoreShift * 8),
      `Avg approval score ${scoreShift >= 0 ? 'rose' : 'fell'} by ${Math.abs(scoreShift).toFixed(1)} points`,
    );
    push(
      'approval_gate',
      'Approval gate',
      Math.round(Math.max(0, scoreShift) * 6),
      scoreShift > 0
        ? `Tighter score gate kept ${scoreShift.toFixed(1)} pts more out`
        : 'Approval gate unchanged or looser this window',
    );
    push(
      'tenure',
      'Tenure',
      Math.round(-tenureShift * 4),
      `Avg term ${tenureShift >= 0 ? 'lengthened' : 'shortened'} by ${Math.abs(tenureShift).toFixed(1)} months`,
    );
    push(
      'borrower_type_mix',
      'Worker vs. business mix',
      Math.round(mixShift * 18),
      `Worker share ${mixShift >= 0 ? 'rose' : 'fell'} by ${(Math.abs(mixShift) * 100).toFixed(1)} pts`,
    );
    const summed = factors.reduce((s, f) => s + f.bps, 0);
    push(
      'residual',
      'Residual',
      totalDeltaBps - summed,
      'Unexplained — collection lift, season, ops noise',
    );

    return {
      window: this.serializeRange(current, days),
      totalDeltaBps,
      factors,
    };
  }

  // ── B3 — Cohorts ──────────────────────────────────────────────────────

  async cohorts(
    bankId: string | null,
    q: AnalyticsWindowQueryDto,
  ): Promise<CohortResponseDto> {
    const bid = this.requireScope(bankId);
    const { window: days } = q;
    const asOf = this.resolveAsOf(q.as_of);
    const current = this.windowFor(asOf, days);
    const loans = await this.loansInWindow(bid, current.from, current.to);

    // Score-band cohorts — always emit all 4 bands so the FE chart axes
    // stay stable across empty windows.
    const byScoreBand: ScoreBandCohortDto[] = SCORE_BANDS.map((band) => {
      const bucket = loans.filter((l) => {
        const s = l.scoreAtApproval;
        return s !== null && s >= band.min && s <= band.max;
      });
      const defaultedCount = bucket.filter((l) =>
        (DEFAULT_STATUSES as readonly string[]).includes(l.status),
      ).length;
      const repaidCount = bucket.filter((l) => l.status === 'repaid').length;
      return {
        label: band.label,
        min: band.min,
        max: band.max,
        count: bucket.length,
        principalNaira: bucket.reduce((s, l) => s + l.principal, 0),
        defaultedCount,
        repaidCount,
        defaultRate: bucket.length > 0 ? defaultedCount / bucket.length : 0,
      };
    });

    // Borrower-type cohorts.
    const byBorrowerType: BorrowerTypeCohortDto[] = (['worker', 'business'] as const).map(
      (type) => {
        const bucket = loans.filter((l) => l.borrowerType === type);
        const defaultedCount = bucket.filter((l) =>
          (DEFAULT_STATUSES as readonly string[]).includes(l.status),
        ).length;
        return {
          type,
          count: bucket.length,
          principalNaira: bucket.reduce((s, l) => s + l.principal, 0),
          defaultRate: bucket.length > 0 ? defaultedCount / bucket.length : 0,
        };
      },
    );

    // Status breakdown — omit zero-count statuses per spec so the FE doesn't
    // render empty rows.
    const statusCounts = new Map<string, { count: number; principalNaira: number }>();
    for (const l of loans) {
      const existing = statusCounts.get(l.status) ?? { count: 0, principalNaira: 0 };
      existing.count += 1;
      existing.principalNaira += l.principal;
      statusCounts.set(l.status, existing);
    }
    const total = loans.length;
    const statusBreakdown: StatusBreakdownDto[] = [...statusCounts.entries()].map(
      ([status, { count, principalNaira }]) => ({
        status: status as StatusBreakdownDto['status'],
        count,
        principalNaira,
        share: total > 0 ? count / total : 0,
      }),
    );

    return {
      window: this.serializeRange(current, days),
      byScoreBand,
      byBorrowerType,
      statusBreakdown,
    };
  }

  // ── B4 — Vintage curves ───────────────────────────────────────────────

  async vintageCurves(
    bankId: string | null,
    q: VintageCurvesQueryDto,
  ): Promise<VintageCurvesResponseDto> {
    const bid = this.requireScope(bankId);
    const horizonMonths = q.horizonMonths ?? 12;
    const cohortCount = q.cohorts ?? 3;
    const granularity = q.granularity ?? 'quarter';

    // Window backwards from NOW: enough disbursement history to cover
    // `cohortCount` buckets at the requested granularity.
    const now = new Date();
    const cohortKeys: string[] = [];
    const cohortBounds: Array<{ key: string; from: Date; to: Date }> = [];
    for (let i = cohortCount - 1; i >= 0; i -= 1) {
      const bucket = this.bucketFor(now, i, granularity);
      cohortKeys.push(bucket.key);
      cohortBounds.push(bucket);
    }

    // Pull every disbursed loan in [oldest cohort start, NOW].
    const oldestFrom = cohortBounds[0].from;
    const loans = await this.prisma.loan.findMany({
      where: {
        bankId: bid,
        status: { in: [...DISBURSED_STATUSES] },
        disbursedAt: { gte: oldestFrom, lte: now, not: null },
      },
      select: {
        principal: true,
        outstandingBalance: true,
        status: true,
        disbursedAt: true,
      },
    });

    // Per-cohort totals + outstanding-defaulted by months-since-disbursed.
    const presentKeys: string[] = [];
    const cohortPrincipal = new Map<string, number>();
    type DefaultedRow = { outstanding: number; monthsSince: number };
    const cohortDefaulted = new Map<string, DefaultedRow[]>();

    for (const bucket of cohortBounds) {
      const inCohort = loans.filter(
        (l) =>
          l.disbursedAt !== null &&
          l.disbursedAt >= bucket.from &&
          l.disbursedAt < bucket.to,
      );
      if (inCohort.length === 0) continue; // spec: omit empty cohorts
      presentKeys.push(bucket.key);
      cohortPrincipal.set(
        bucket.key,
        inCohort.reduce((s, l) => s + l.principal, 0),
      );
      cohortDefaulted.set(
        bucket.key,
        inCohort
          .filter((l) => (DEFAULT_STATUSES as readonly string[]).includes(l.status))
          .map((l) => ({
            outstanding: l.outstandingBalance,
            monthsSince: this.monthsBetween(l.disbursedAt!, now),
          })),
      );
    }

    // Cumulative loss at monthsSince = m for cohort c = sum of outstanding
    // over defaulted loans whose monthsSince ≥ m / cohortPrincipal.
    const rows: Array<Record<string, number>> = [];
    for (let m = 0; m <= horizonMonths; m += 1) {
      const row: Record<string, number> = { monthsSince: m };
      for (const key of presentKeys) {
        const principal = cohortPrincipal.get(key) ?? 0;
        const defaulted = (cohortDefaulted.get(key) ?? [])
          .filter((d) => d.monthsSince >= m)
          .reduce((s, d) => s + d.outstanding, 0);
        row[key] = principal > 0 ? defaulted / principal : 0;
      }
      rows.push(row);
    }

    return { cohorts: presentKeys, rows };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private requireScope(bankId: string | null): string {
    if (!bankId) {
      throw new AppError(
        403,
        'NO_BANK_SCOPE',
        'This account is not bound to a bank.',
      );
    }
    return bankId;
  }

  private resolveAsOf(raw: string | undefined): Date {
    if (!raw) return new Date();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new AppError(400, 'VALIDATION_FAILED', '`as_of` must be a valid ISO-8601 date.', {
        errors: [{ field: 'as_of', message: 'invalid date' }],
      });
    }
    return d;
  }

  private windowFor(end: Date, days: AnalyticsWindowDays): { from: Date; to: Date } {
    const to = new Date(end);
    const from = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  private serializeRange(
    range: { from: Date; to: Date },
    days: AnalyticsWindowDays,
  ): { from: string; to: string; days: AnalyticsWindowDays } {
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days,
    };
  }

  /**
   * Pull every loan whose `disbursedAt` falls in `[from, to)` for this
   * bank. Only loans that reached disbursement count — draft / rejected
   * rows are excluded.
   */
  private async loansInWindow(
    bankId: string,
    from: Date,
    to: Date,
  ): Promise<LoanRow[]> {
    const rows = await this.prisma.loan.findMany({
      where: {
        bankId,
        status: { in: [...DISBURSED_STATUSES] },
        disbursedAt: { gte: from, lt: to, not: null },
      },
      select: {
        principal: true,
        outstandingBalance: true,
        apr: true,
        termMonths: true,
        status: true,
        borrowerType: true,
        scoreAtApproval: true,
        disbursedAt: true,
      },
    });
    return rows;
  }

  private computeMetrics(loans: LoanRow[]): PeriodMetricsDto {
    const count = loans.length;
    if (count === 0) {
      return {
        count: 0,
        principalDisbursedNaira: 0,
        repaymentRate: 0,
        defaultRate: 0,
        netYield: 0,
        avgScoreAtApproval: 0,
        avgTermMonths: 0,
        workerShare: 0,
      };
    }
    const principal = loans.reduce((s, l) => s + l.principal, 0);
    const defaulted = loans.filter((l) =>
      (DEFAULT_STATUSES as readonly string[]).includes(l.status),
    );
    const defaultedCount = defaulted.length;
    const defaultRate = defaultedCount / count;
    const repaymentRate = (count - defaultedCount) / count;
    const weightedApr =
      loans.reduce((s, l) => s + l.apr * l.principal, 0) / Math.max(1, principal);
    const writeOffDrag =
      defaulted.reduce((s, l) => s + l.outstandingBalance, 0) / Math.max(1, principal);
    const netYield = Math.max(0, weightedApr * repaymentRate - writeOffDrag);

    const scoresWithValue = loans
      .map((l) => l.scoreAtApproval)
      .filter((s): s is number => typeof s === 'number');
    const avgScoreAtApproval =
      scoresWithValue.length > 0
        ? scoresWithValue.reduce((s, v) => s + v, 0) / scoresWithValue.length
        : 0;
    const termsWithValue = loans
      .map((l) => l.termMonths)
      .filter((t): t is number => typeof t === 'number');
    const avgTermMonths =
      termsWithValue.length > 0
        ? termsWithValue.reduce((s, v) => s + v, 0) / termsWithValue.length
        : 0;
    const workerCount = loans.filter((l) => l.borrowerType === 'worker').length;
    const workerShare = workerCount / count;

    return {
      count,
      principalDisbursedNaira: principal,
      repaymentRate,
      defaultRate,
      netYield,
      avgScoreAtApproval,
      avgTermMonths,
      workerShare,
    };
  }

  private bps(delta: number): number {
    return Math.round(delta * 10_000);
  }

  /**
   * Compute the cohort bucket `n` periods before `ref`. `n=0` is the
   * current bucket; `n=1` is the previous one; etc. Quarter granularity
   * produces keys like "2026 Q1", month granularity produces "2026-04".
   */
  private bucketFor(
    ref: Date,
    n: number,
    granularity: 'quarter' | 'month',
  ): { key: string; from: Date; to: Date } {
    if (granularity === 'quarter') {
      const refQuarter = Math.floor(ref.getUTCMonth() / 3);
      const refYear = ref.getUTCFullYear();
      const totalQ = refYear * 4 + refQuarter - n;
      const year = Math.floor(totalQ / 4);
      const quarter = ((totalQ % 4) + 4) % 4;
      const startMonth = quarter * 3;
      const from = new Date(Date.UTC(year, startMonth, 1));
      const to = new Date(Date.UTC(year, startMonth + 3, 1));
      return { key: `${year} Q${quarter + 1}`, from, to };
    }
    // month
    const refYear = ref.getUTCFullYear();
    const refMonth = ref.getUTCMonth();
    const totalM = refYear * 12 + refMonth - n;
    const year = Math.floor(totalM / 12);
    const month = ((totalM % 12) + 12) % 12;
    const from = new Date(Date.UTC(year, month, 1));
    const to = new Date(Date.UTC(year, month + 1, 1));
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    return { key, from, to };
  }

  private monthsBetween(from: Date, to: Date): number {
    return (
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
      (to.getUTCMonth() - from.getUTCMonth())
    );
  }
}
