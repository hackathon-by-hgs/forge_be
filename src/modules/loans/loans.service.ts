import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { CreditDto, CreditTier } from './dto/credit.dto';
import {
  ActiveLoanDto,
  ApplyLoanDto,
  ApplyLoanResponseDto,
  LoanDetailDto,
} from './dto/loan.dto';
import { toLoanSummary, toRepaymentDto } from './loans.mapper';

@Injectable()
export class LoansService {
  constructor(private readonly prisma: PrismaService) {}

  async credit(workerId: string): Promise<CreditDto> {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');

    const score = worker.creditScore;
    const tier = this.tierFor(score);
    const ceiling = this.ceilingFor(score);
    const isEligible = score >= 60;

    const subtitle =
      tier === CreditTier.Building
        ? 'Build your score by completing more jobs.'
        : tier === CreditTier.Fair
        ? 'Almost there — a few more jobs to unlock loans.'
        : tier === CreditTier.Good
        ? 'Good — keep working to qualify for higher amounts.'
        : 'Excellent — top eligibility unlocked.';

    return {
      credit_score: score,
      tier,
      subtitle,
      eligibility: {
        is_eligible: isEligible,
        max_principal: isEligible ? ceiling : 0,
        min_principal: isEligible ? 5000 : 0,
        interest_rate_percent: 5.0,
        repayment_percent_per_job_default: 0.20,
      },
      next_unlock: tier === CreditTier.Excellent ? null : this.nextUnlock(score),
    };
  }

  async active(workerId: string): Promise<ActiveLoanDto> {
    const loan = await this.prisma.loan.findFirst({
      where: { workerId, status: { in: ['pending', 'approved', 'active'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!loan) return { loan: null };
    const stats = await this.repaymentStats(loan.id);
    return { loan: toLoanSummary(loan, stats) };
  }

  async detail(workerId: string, id: string): Promise<LoanDetailDto> {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: { repayments: { orderBy: { paidAt: 'desc' }, take: 50 } },
    });
    if (!loan || loan.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Loan not found.');
    }
    const stats = {
      count: loan.repayments.length,
      total: loan.repayments.reduce((s, r) => s + r.amount, 0),
    };
    return {
      ...toLoanSummary(loan, stats),
      expected_full_repayment_at: loan.expectedFullRepaymentAt?.toISOString() ?? null,
      repayments: loan.repayments.map(toRepaymentDto),
    };
  }

  async apply(workerId: string, body: ApplyLoanDto): Promise<ApplyLoanResponseDto> {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');

    const score = worker.creditScore;
    const ceiling = this.ceilingFor(score);
    if (score < 60) {
      throw new AppError(422, 'NOT_ELIGIBLE', 'Credit score too low.');
    }
    if (body.principal < 5000 || body.principal > ceiling) {
      throw new AppError(400, 'VALIDATION_FAILED', `Principal must be between 5000 and ${ceiling}.`);
    }

    const blocking = await this.prisma.loan.findFirst({
      where: { workerId, status: { in: ['pending', 'active'] } },
    });
    if (blocking) {
      throw new AppError(409, 'ACTIVE_LOAN_EXISTS', 'You already have a loan in progress.', {
        loan: toLoanSummary(blocking),
      });
    }

    const defaultBank = await this.prisma.bankAccount.findFirst({
      where: { workerId, isDefault: true },
    });
    if (!defaultBank) {
      throw new AppError(422, 'BANK_ACCOUNT_REQUIRED', 'Add a default bank account before applying.');
    }

    const tier = this.tierFor(score);
    const autoApprove = tier === CreditTier.Excellent && body.principal <= 50_000;

    const status = autoApprove ? 'approved' : 'pending';
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          id: newId(ID_PREFIXES.loan),
          workerId,
          principal: body.principal,
          outstandingBalance: body.principal,
          interestRatePercent: 5.0,
          repaymentPercentPerJob: body.repayment_percent_per_job,
          status,
          purpose: body.purpose ?? null,
          estimatedDecisionAt: autoApprove ? null : new Date(now.getTime() + 5 * 60 * 1000),
          disbursedAt: autoApprove ? now : null,
        },
      });

      if (autoApprove) {
        const txnId = newId(ID_PREFIXES.transaction);
        await tx.transaction.create({
          data: {
            id: txnId,
            workerId,
            kind: 'loan_disbursement',
            amount: body.principal,
            timestamp: now,
            title: 'Loan disbursed',
            subtitle: `Principal ₦${body.principal.toLocaleString()}`,
            squadReference: 'sqd_l' + txnId.slice(4),
            relatedJobId: null,
            status: 'succeeded',
          },
        });
        await tx.worker.update({
          where: { id: workerId },
          data: { walletBalance: { increment: body.principal } },
        });
        await tx.loan.update({ where: { id: loan.id }, data: { status: 'active' } });
        loan.status = 'active';
      }
      return loan;
    });

    return { loan: toLoanSummary(created) };
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private tierFor(score: number): CreditTier {
    if (score >= 80) return CreditTier.Excellent;
    if (score >= 60) return CreditTier.Good;
    if (score >= 40) return CreditTier.Fair;
    return CreditTier.Building;
  }

  private ceilingFor(score: number): number {
    if (score >= 80) return 100_000;
    if (score >= 70) return 50_000;
    if (score >= 60) return 20_000;
    return 0;
  }

  private nextUnlock(score: number) {
    const target = score >= 70 ? 80 : score >= 60 ? 70 : 60;
    return {
      score_target: target,
      max_principal_at_target: this.ceilingFor(target),
      jobs_to_unlock_estimate: Math.max(1, Math.ceil((target - score) / 2)),
    };
  }

  private async repaymentStats(loanId: string) {
    const rows = await this.prisma.loanRepayment.findMany({
      where: { loanId },
      select: { amount: true },
    });
    return { count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) };
  }
}
