import { Injectable } from '@nestjs/common';
import { Loan, LoanRepayment, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { paginate } from '../../common/pagination/offset.dto';
import { toLoanRepaymentDto } from '../bank/bank.mapper';
import { LoanRepaymentDto, LoanRiskLevel, LoanStatus } from '../bank/dto/loans.dto';
import {
  EmployerLoanDetailDto,
  EmployerLoanDto,
  EmployerLoanRepaymentsResponseDto,
  EmployerLoansListQueryDto,
  EmployerLoansListResponseDto,
} from './dto/loan.dto';

type LoanWithBank = Loan & { bank: { name: string } | null };
type LoanWithRepayments = LoanWithBank & { repayments: LoanRepayment[] };

@Injectable()
export class EmployerLoansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    employerId: string | null,
    q: EmployerLoansListQueryDto,
  ): Promise<EmployerLoansListResponseDto> {
    const eid = this.requireScope(employerId);
    const where: Prisma.LoanWhereInput = { employerId: eid };
    if (q.status) where.status = q.status;

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        include: { bank: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loan.count({ where }),
    ]);

    return paginate<EmployerLoanDto>(rows.map((l) => toEmployerLoanDto(l)), total, page, pageSize);
  }

  async detail(employerId: string | null, loanId: string): Promise<EmployerLoanDetailDto> {
    const eid = this.requireScope(employerId);
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, employerId: eid },
      include: {
        bank: { select: { name: true } },
        repayments: { orderBy: { scheduledFor: 'asc' } },
      },
    });
    if (!loan) throw new AppError(404, 'NOT_FOUND', 'Loan not found.');

    const base = toEmployerLoanDto(loan);
    const repayments: LoanRepaymentDto[] = loan.repayments.map(toLoanRepaymentDto);
    const totalPaidNaira = repayments
      .filter((r) => r.status === 'paid')
      .reduce((acc, r) => acc + r.amountNaira, 0);
    // On-time rate = paid / (paid + missed). Scheduled-but-future repayments
    // aren't counted because they haven't had a chance to be late yet.
    const judged = repayments.filter((r) => r.status === 'paid' || r.status === 'missed');
    const onTimeRepaymentRate =
      judged.length === 0 ? 0 : round2(judged.filter((r) => r.status === 'paid').length / judged.length);

    return { ...base, repayments, totalPaidNaira, onTimeRepaymentRate };
  }

  async repayments(
    employerId: string | null,
    loanId: string,
  ): Promise<EmployerLoanRepaymentsResponseDto> {
    const eid = this.requireScope(employerId);
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, employerId: eid },
      select: { id: true },
    });
    if (!loan) throw new AppError(404, 'NOT_FOUND', 'Loan not found.');

    const rows = await this.prisma.loanRepayment.findMany({
      where: { loanId },
      orderBy: { scheduledFor: 'asc' },
    });
    return { data: rows.map(toLoanRepaymentDto) };
  }

  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }
}

function toEmployerLoanDto(l: LoanWithBank | LoanWithRepayments): EmployerLoanDto {
  return {
    id: l.id,
    bankId: l.bankId ?? '',
    bankName: l.bank?.name ?? '',
    principalNaira: l.principal,
    outstandingNaira: l.outstandingBalance,
    apr: l.apr,
    termMonths: l.termMonths ?? null,
    repaymentPercentPerJob: l.repaymentPercentPerJob,
    status: l.status as LoanStatus,
    riskLevel: (l.riskLevel as LoanRiskLevel) ?? LoanRiskLevel.Green,
    purpose: l.purpose ?? null,
    disbursedAt: l.disbursedAt ? l.disbursedAt.toISOString() : null,
    expectedFullRepaymentAt: l.expectedFullRepaymentAt
      ? l.expectedFullRepaymentAt.toISOString()
      : null,
    nextPaymentDueAt: l.nextPaymentDueAt ? l.nextPaymentDueAt.toISOString() : null,
    rejectionReason: l.rejectionReason ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
