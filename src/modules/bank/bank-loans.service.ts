import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { paginate } from '../../common/pagination/offset.dto';
import { SquadClient } from '../squad/squad.client';
import { StreamPublisher } from '../stream/stream.publisher';
import {
  BankLoansListQueryDto,
  BankLoansListResponseDto,
  DisburseLoanDto,
  LoanDetailDto,
  LoanDto,
  LoanRepaymentDto,
  LoanRiskLevel,
  LoanStatus,
  MarkRepaymentPaidDto,
} from './dto/loans.dto';
import {
  toBorrowerSummary,
  toLoanDto,
  toLoanRepaymentDto,
} from './bank.mapper';

@Injectable()
export class BankLoansService {
  private readonly logger = new Logger(BankLoansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly squad: SquadClient,
    private readonly stream: StreamPublisher,
  ) {}

  async list(
    bankId: string | null,
    q: BankLoansListQueryDto,
  ): Promise<BankLoansListResponseDto> {
    const bid = this.requireScope(bankId);
    const where = this.buildWhere(bid, q);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        include: { worker: true, employer: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loan.count({ where }),
    ]);

    return paginate<LoanDto>(
      rows.map((l) =>
        toLoanDto(l, toBorrowerSummary(l.borrowerType, l.worker, l.employer)),
      ),
      total,
      page,
      pageSize,
    );
  }

  async detail(bankId: string | null, loanId: string): Promise<LoanDetailDto> {
    const bid = this.requireScope(bankId);
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, bankId: bid },
      include: {
        worker: true,
        employer: true,
        repayments: { orderBy: { scheduledFor: 'asc' } },
      },
    });
    if (!loan) throw new AppError(404, 'NOT_FOUND', 'Loan not found.');

    const base = toLoanDto(
      loan,
      toBorrowerSummary(loan.borrowerType, loan.worker, loan.employer),
    );
    const repayments: LoanRepaymentDto[] =
      loan.repayments.map(toLoanRepaymentDto);
    const totalPaidNaira = repayments
      .filter((r) => r.status === 'paid')
      .reduce((acc, r) => acc + r.amountNaira, 0);
    const scheduled = repayments.filter(
      (r) => r.status === 'paid' || r.status === 'missed',
    );
    const paidCount = scheduled.filter((r) => r.status === 'paid').length;
    const onTimeRepaymentRate =
      scheduled.length === 0 ? 0 : round2(paidCount / scheduled.length);

    return { ...base, repayments, totalPaidNaira, onTimeRepaymentRate };
  }

  async disburse(
    actor: { userId: string; bankId: string | null },
    loanId: string,
    body: DisburseLoanDto,
    req: Request,
  ): Promise<LoanDto> {
    const bid = this.requireScope(actor.bankId);
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, bankId: bid },
      include: { worker: true, employer: true },
    });
    if (!loan) throw new AppError(404, 'NOT_FOUND', 'Loan not found.');
    if (loan.status !== LoanStatus.Approved) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Only approved loans can be disbursed (current: ${loan.status}).`,
      );
    }

    const principalNaira = body.principalNairaOverride ?? loan.principal;
    const now = new Date();
    const repaymentMonths = loan.termMonths ?? 6;
    const monthlyInstallment = Math.ceil(principalNaira / repaymentMonths);

    // Fire the Squad transfer for worker loans (worker has a linked bank
    // account). Business loans credit the employer's in-app wallet directly —
    // funds are already on Forge's balance sheet via the bank tenant, no
    // external transfer needed. The credit happens inside the $transaction
    // below so it's atomic with the loan-status flip.
    let squadReference: string | null = null;
    if (loan.workerId) {
      const account = await this.prisma.bankAccount.findFirst({
        where: { workerId: loan.workerId, isDefault: true },
      });
      if (account) {
        squadReference = this.squad.newReference('disb');
        const outcome = await this.squad.transfer({
          transactionReference: squadReference,
          bankCode: account.bankCode,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          amountNaira: principalNaira,
          remark: `Loan disbursement ${loanId}`,
        });
        if (!outcome.ok) {
          this.logger.error(
            `[squad] disburse rejected for loan=${loanId}: ${outcome.message}`,
          );
          throw new AppError(
            502,
            'PROVIDER_UNAVAILABLE',
            `Disbursement provider rejected the transfer: ${outcome.message}`,
          );
        }
      } else {
        this.logger.warn(
          `[squad] no default bank account for worker=${loan.workerId} — loan disbursed without provider transfer`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.loan.update({
        where: { id: loanId },
        data: {
          status: LoanStatus.Active,
          riskLevel: LoanRiskLevel.Green,
          principal: principalNaira,
          outstandingBalance: principalNaira,
          disbursedAt: now,
          nextPaymentDueAt: addMonths(now, 1),
          expectedFullRepaymentAt: addMonths(now, repaymentMonths),
        },
        include: { worker: true, employer: true },
      });
      // Mirror the disbursement as a Transaction row so the Squad webhook
      // can transition it (`processing` → `completed` / `failed`).
      if (squadReference && loan.workerId) {
        await tx.transaction.create({
          data: {
            id: newId(ID_PREFIXES.transaction),
            workerId: loan.workerId,
            employerId: null,
            kind: 'loan_disbursement',
            amount: principalNaira,
            timestamp: now,
            title: `Loan disbursed`,
            subtitle: `Loan ${loanId}`,
            relatedJobId: null,
            squadReference,
            status: 'processing',
          },
        });
      }
      // Business borrowers: credit the employer's in-app wallet + write a
      // `completed` Transaction row (no Squad transfer — internal book entry).
      if (loan.employerId) {
        const businessTxId = newId(ID_PREFIXES.transaction);
        await tx.transaction.create({
          data: {
            id: businessTxId,
            workerId: null,
            employerId: loan.employerId,
            kind: 'loan_disbursement',
            amount: principalNaira,
            timestamp: now,
            title: 'Loan disbursed',
            subtitle: `Loan ${loanId}`,
            relatedJobId: null,
            squadReference: `internal_${businessTxId.slice(4)}`,
            status: 'completed',
            settledAt: now,
          },
        });
        await tx.employer.update({
          where: { id: loan.employerId },
          data: { walletBalanceNaira: { increment: principalNaira } },
        });
      }
      // Seed a repayment schedule. Demo-grade — Phase 5 will recompute as
      // job-completions drive partial early payments.
      for (let i = 1; i <= repaymentMonths; i += 1) {
        await tx.loanRepayment.create({
          data: {
            id: `rep_${loanId}_${i}`,
            loanId,
            amount: monthlyInstallment,
            scheduledFor: addMonths(now, i),
            status: 'scheduled',
          },
        });
      }
      // Worker-mobile notification (only meaningful for worker borrowers).
      if (loan.workerId) {
        await tx.notification.create({
          data: {
            id: `ntf_${loanId}_disb`.slice(0, 24),
            workerId: loan.workerId,
            kind: 'loan_disbursed',
            title: 'Loan disbursed',
            body: `₦${principalNaira.toLocaleString('en-NG')} has been disbursed to your wallet.`,
            timestamp: now,
            deeplink: '/loans',
          },
        });
      }
      // Update bank-level aggregates (demo-grade — denormalised summary refresh).
      await tx.bank.update({
        where: { id: bid },
        data: {
          totalActiveLoans: { increment: 1 },
          totalDisbursedNaira: { increment: principalNaira },
        },
      });
      return u;
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'bank.loan_disburse',
      entityType: 'loan',
      entityId: loanId,
      before: { status: loan.status, principalNaira: loan.principal },
      after: {
        status: LoanStatus.Active,
        principalNaira,
        disbursedAt: now.toISOString(),
      },
      request: req,
    });

    this.stream.publish({
      scope: { kind: 'bank', id: bid },
      event: 'loan.disbursed',
      data: { loanId, principalNaira, borrowerType: loan.borrowerType },
    });

    // For business borrowers, tell the employer dashboard too so the wallet
    // tile + transactions table refresh without polling.
    if (loan.employerId) {
      this.stream.publish({
        scope: { kind: 'employer', id: loan.employerId },
        event: 'transaction.updated',
        data: {
          status: 'completed',
          amountNaira: principalNaira,
          source: 'loan_disbursement',
        },
      });
    }

    return toLoanDto(
      updated,
      toBorrowerSummary(updated.borrowerType, updated.worker, updated.employer),
    );
  }

  async markRepaymentPaid(
    actor: { userId: string; bankId: string | null },
    repaymentId: string,
    body: MarkRepaymentPaidDto,
    req: Request,
  ): Promise<LoanRepaymentDto> {
    const bid = this.requireScope(actor.bankId);
    const repayment = await this.prisma.loanRepayment.findFirst({
      where: { id: repaymentId, loan: { bankId: bid } },
      include: { loan: true },
    });
    if (!repayment)
      throw new AppError(404, 'NOT_FOUND', 'Repayment not found.');
    if (repayment.status === 'paid') {
      throw new AppError(
        409,
        'INVALID_STATE',
        'This repayment is already marked paid.',
      );
    }
    if (!['active', 'at_risk'].includes(repayment.loan.status)) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot mark a repayment on a ${repayment.loan.status} loan.`,
      );
    }

    const amount = body.amountNairaOverride ?? repayment.amount;
    const now = new Date();
    const newOutstanding = Math.max(
      0,
      repayment.loan.outstandingBalance - amount,
    );
    const allPaid = newOutstanding === 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.loanRepayment.update({
        where: { id: repaymentId },
        data: {
          status: 'paid',
          paidAt: now,
          amount,
          transactionId: body.transactionId ?? repayment.transactionId,
        },
      });
      await tx.loan.update({
        where: { id: repayment.loanId },
        data: {
          outstandingBalance: newOutstanding,
          status: allPaid ? LoanStatus.Repaid : repayment.loan.status,
          riskLevel: allPaid ? LoanRiskLevel.Green : repayment.loan.riskLevel,
        },
      });
      if (allPaid) {
        await tx.bank.update({
          where: { id: bid },
          data: { totalActiveLoans: { decrement: 1 } },
        });
        if (repayment.loan.workerId) {
          await tx.notification.create({
            data: {
              id: `ntf_${repayment.loanId}_repaid`.slice(0, 24),
              workerId: repayment.loan.workerId,
              kind: 'loan_repayment_made',
              title: 'Loan fully repaid',
              body: 'Your loan has been fully repaid. Thanks for being a great borrower.',
              timestamp: now,
              deeplink: '/loans',
            },
          });
        }
      }
      return r;
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'bank.loan_repayment_paid',
      entityType: 'loan_repayment',
      entityId: repaymentId,
      before: {
        status: repayment.status,
        outstandingNaira: repayment.loan.outstandingBalance,
      },
      after: { status: 'paid', outstandingNaira: newOutstanding, allPaid },
      request: req,
    });

    this.stream.publish({
      scope: { kind: 'bank', id: bid },
      event: 'loan.repayment_paid',
      data: {
        loanId: repayment.loanId,
        repaymentId,
        amountNaira: amount,
        outstandingNaira: newOutstanding,
        allPaid,
      },
    });

    return toLoanRepaymentDto(updated);
  }

  // ── Internals ────────────────────────────────────────────────────────────
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

  private buildWhere(
    bankId: string,
    q: BankLoansListQueryDto,
  ): Prisma.LoanWhereInput {
    const where: Prisma.LoanWhereInput = { bankId };
    if (q.riskLevel) where.riskLevel = q.riskLevel;
    if (q.status) where.status = q.status;
    if (q.borrowerType) where.borrowerType = q.borrowerType;
    if (q.q) {
      where.OR = [
        { id: { equals: q.q } },
        { workerId: { equals: q.q } },
        { employerId: { equals: q.q } },
        { worker: { name: { contains: q.q, mode: 'insensitive' } } },
        { employer: { businessName: { contains: q.q, mode: 'insensitive' } } },
      ];
    }
    return where;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}
