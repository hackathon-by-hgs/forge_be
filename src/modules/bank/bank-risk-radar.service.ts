import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import {
  BankPortfolioMetricsDto,
  OpportunityBorrowerDto,
  RiskRadarResponseDto,
} from './dto/risk-radar.dto';
import { LoanDto, LoanRiskLevel } from './dto/loans.dto';
import { toBorrowerSummary, toLoanDto } from './bank.mapper';

const CRITICAL_LIMIT = 20;
const WATCHLIST_LIMIT = 20;
const OPPORTUNITY_LIMIT = 5;
const OPPORTUNITY_SCORE_FLOOR = 70;
const ACTIVE_STATUSES = ['active', 'at_risk'];

@Injectable()
export class BankRiskRadarService {
  constructor(private readonly prisma: PrismaService) {}

  async radar(bankId: string | null): Promise<RiskRadarResponseDto> {
    const bid = this.requireScope(bankId);

    const [critical, watchlist, portfolio, opportunity] = await Promise.all([
      this.findByRisk(bid, LoanRiskLevel.Red, CRITICAL_LIMIT),
      this.findByRisk(bid, LoanRiskLevel.Yellow, WATCHLIST_LIMIT),
      this.computePortfolio(bid),
      this.computeOpportunity(bid),
    ]);

    return { critical, watchlist, portfolio, opportunity };
  }

  private requireScope(bankId: string | null): string {
    if (!bankId) {
      throw new AppError(403, 'NO_BANK_SCOPE', 'This account is not bound to a bank.');
    }
    return bankId;
  }

  private async findByRisk(bankId: string, level: LoanRiskLevel, limit: number): Promise<LoanDto[]> {
    const loans = await this.prisma.loan.findMany({
      where: { bankId, riskLevel: level, status: { in: ACTIVE_STATUSES } },
      include: { worker: true, employer: true },
      orderBy: { nextPaymentDueAt: 'asc' },
      take: limit,
    });
    return loans.map((l) =>
      toLoanDto(l, toBorrowerSummary(l.borrowerType, l.worker, l.employer)),
    );
  }

  private async computePortfolio(bankId: string): Promise<BankPortfolioMetricsDto> {
    const [activeAgg, atRiskCount, allLoans, repayments] = await Promise.all([
      this.prisma.loan.aggregate({
        where: { bankId, status: { in: ACTIVE_STATUSES } },
        _count: { _all: true },
        _sum: { principal: true, outstandingBalance: true },
      }),
      this.prisma.loan.count({ where: { bankId, status: 'at_risk' } }),
      this.prisma.loan.findMany({
        where: { bankId, status: { in: ['active', 'at_risk', 'repaid', 'defaulted', 'written_off'] } },
        select: { status: true },
      }),
      this.prisma.loanRepayment.findMany({
        where: { loan: { bankId } },
        select: { status: true },
      }),
    ]);

    const defaultedCount = allLoans.filter((l) => l.status === 'defaulted' || l.status === 'written_off').length;
    const totalLoans = allLoans.length;
    const paidRepayments = repayments.filter((r) => r.status === 'paid').length;
    const totalRepayments = repayments.length;

    return {
      activeCount: activeAgg._count._all,
      atRiskCount,
      disbursedTotalNaira: activeAgg._sum.principal ?? 0,
      outstandingTotalNaira: activeAgg._sum.outstandingBalance ?? 0,
      repaymentRate: totalRepayments === 0 ? 0 : round2(paidRepayments / totalRepayments),
      defaultRate: totalLoans === 0 ? 0 : round2(defaultedCount / totalLoans),
    };
  }

  private async computeOpportunity(bankId: string): Promise<OpportunityBorrowerDto[]> {
    // Pre-approved + eligible workers without any active loan with this bank.
    // Heuristic: order by reliabilityScore desc, exclude workers who already
    // hold an `active`/`at_risk` loan here.
    const heldLoanWorkerIds = await this.prisma.loan.findMany({
      where: { bankId, status: { in: ACTIVE_STATUSES }, workerId: { not: null } },
      select: { workerId: true },
    });
    const excluded = new Set(
      heldLoanWorkerIds
        .map((r) => r.workerId)
        .filter((id): id is string => !!id),
    );

    const workers = await this.prisma.worker.findMany({
      where: {
        eligibility: { in: ['eligible', 'pre_approved'] },
        reliabilityScore: { gte: OPPORTUNITY_SCORE_FLOOR },
        ...(excluded.size > 0 ? { id: { notIn: Array.from(excluded) } } : {}),
      },
      orderBy: [{ reliabilityScore: 'desc' }, { jobsCompleted: 'desc' }],
      take: OPPORTUNITY_LIMIT,
    });

    return workers.map((w) => ({
      id: w.id,
      displayName: w.name,
      score: w.reliabilityScore,
      eligibility: w.eligibility,
      maxAmountNaira: estimateMaxLoan(w.reliabilityScore, w.averageWeeklyIncomeNaira),
    }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Quick indicative max-loan estimate mirroring BACKEND_BRIEF §11.8 logic:
 * pre_approved (≥80) → up to 4× avg weekly income; eligible (70–79) → 2×.
 * Capped at ₦250k for the worker side.
 */
function estimateMaxLoan(score: number, weeklyIncomeNaira: number): number {
  const baseline = Math.max(weeklyIncomeNaira, 5000);
  const multiplier = score >= 80 ? 4 : score >= 70 ? 2 : 0;
  return Math.min(multiplier * baseline, 250_000);
}
