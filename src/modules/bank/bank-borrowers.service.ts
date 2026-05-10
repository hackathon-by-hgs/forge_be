import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { BorrowerProfileDto } from './dto/borrower.dto';
import { BorrowerType, LoanDto } from './dto/loans.dto';
import { toBorrowerSummary, toLoanDto } from './bank.mapper';

@Injectable()
export class BankBorrowersService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(
    bankId: string | null,
    borrowerType: BorrowerType,
    id: string,
  ): Promise<BorrowerProfileDto> {
    const bid = this.requireScope(bankId);

    if (borrowerType === BorrowerType.Worker) {
      return this.workerProfile(bid, id);
    }
    return this.businessProfile(bid, id);
  }

  private async workerProfile(bankId: string, id: string): Promise<BorrowerProfileDto> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker || worker.deletionScheduledAt) {
      throw new AppError(404, 'NOT_FOUND', 'Borrower not found.');
    }

    const loans = await this.prisma.loan.findMany({
      where: { workerId: id, bankId },
      include: { worker: true, employer: true },
      orderBy: { createdAt: 'desc' },
    });
    const defaultsCount = loans.filter((l) => l.status === 'defaulted' || l.status === 'written_off').length;

    return {
      id: worker.id,
      type: BorrowerType.Worker,
      displayName: worker.name,
      photoUrl: worker.photoUrl ?? null,
      phoneNumber: worker.phoneNumber ?? null,
      memberSince: worker.joinedAt.toISOString(),
      workerMetrics: {
        reliabilityScore: worker.reliabilityScore,
        jobsCompleted: worker.jobsCompleted,
        onTimeRate: worker.onTimeRate,
        totalEarnedNaira: worker.totalEarned,
        averageWeeklyIncomeNaira: worker.averageWeeklyIncomeNaira,
        incomeVolatilityPct: worker.incomeVolatilityPct,
        eligibility: worker.eligibility,
      },
      loans: loans.map((l) =>
        toLoanDto(l, toBorrowerSummary(l.borrowerType, l.worker, l.employer)),
      ) as LoanDto[],
      defaultsCount,
    };
  }

  private async businessProfile(bankId: string, id: string): Promise<BorrowerProfileDto> {
    const employer = await this.prisma.employer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!employer) throw new AppError(404, 'NOT_FOUND', 'Borrower not found.');

    const loans = await this.prisma.loan.findMany({
      where: { employerId: id, bankId },
      include: { worker: true, employer: true },
      orderBy: { createdAt: 'desc' },
    });
    const defaultsCount = loans.filter((l) => l.status === 'defaulted' || l.status === 'written_off').length;

    return {
      id: employer.id,
      type: BorrowerType.Business,
      displayName: employer.businessName,
      photoUrl: employer.photoUrl ?? null,
      phoneNumber: employer.phoneNumber ?? null,
      memberSince: employer.joinedAt.toISOString(),
      businessMetrics: {
        creditScore: employer.creditScore,
        totalLaborSpendNaira: employer.totalLaborSpendNaira,
        jobsPosted: employer.jobsPosted,
        workersHired: employer.workersHired,
        paymentTimelinessRate: employer.paymentTimelinessRate,
      },
      loans: loans.map((l) =>
        toLoanDto(l, toBorrowerSummary(l.borrowerType, l.worker, l.employer)),
      ) as LoanDto[],
      defaultsCount,
    };
  }

  private requireScope(bankId: string | null): string {
    if (!bankId) {
      throw new AppError(403, 'NO_BANK_SCOPE', 'This account is not bound to a bank.');
    }
    return bankId;
  }
}
