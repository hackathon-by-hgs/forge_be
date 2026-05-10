import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import {
  SearchJobHitDto,
  SearchResponseDto,
  SearchTransactionHitDto,
  SearchWorkerHitDto,
} from './dto/search.dto';

const HIT_LIMIT = 5;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    user: { userId: string; role: Role; employerId: string | null; bankId: string | null },
    qRaw: string,
  ): Promise<SearchResponseDto> {
    const q = qRaw.trim();
    if (!q) {
      return { jobs: [], workers: [], transactions: [] };
    }

    // Bank users get an empty employer-shaped search for now — bank-search is a
    // Phase 4 surface. Returning empty arrays keeps the FE contract stable.
    if (!user.employerId) {
      return { jobs: [], workers: [], transactions: [] };
    }

    const [jobs, workers, transactions] = await Promise.all([
      this.searchJobs(user.employerId, q),
      this.searchWorkers(q),
      this.searchTransactions(user.employerId, q),
    ]);

    return { jobs, workers, transactions };
  }

  private async searchJobs(employerId: string, q: string): Promise<SearchJobHitDto[]> {
    const rows = await this.prisma.job.findMany({
      where: {
        employerId,
        deletedAt: null,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { neighborhood: { contains: q, mode: 'insensitive' } },
          { id: { equals: q } },
        ],
      },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: HIT_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      href: `/jobs/${r.id}`,
    }));
  }

  private async searchWorkers(q: string): Promise<SearchWorkerHitDto[]> {
    // Workers are platform-shared in the BRIEF; the employer-scoped Browse page
    // does its own radius filter. The TopBar search is a quick lookup so we
    // don't apply the radius here — Phase 2 can tighten if it becomes noisy.
    const rows = await this.prisma.worker.findMany({
      where: {
        deletionScheduledAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phoneNumber: { contains: q } },
          { id: { equals: q } },
        ],
      },
      select: { id: true, name: true, primarySkill: true },
      orderBy: { reliabilityScore: 'desc' },
      take: HIT_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      fullName: r.name,
      primarySkill: r.primarySkill,
      href: `/workers/${r.id}`,
    }));
  }

  private async searchTransactions(employerId: string, q: string): Promise<SearchTransactionHitDto[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        employerId,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { subtitle: { contains: q, mode: 'insensitive' } },
          { squadReference: { equals: q } },
          { id: { equals: q } },
          { relatedJobId: { equals: q } },
        ],
      },
      select: { id: true, title: true, amount: true },
      orderBy: { timestamp: 'desc' },
      take: HIT_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      amountNaira: r.amount,
      href: `/payments/transactions/${r.id}`,
    }));
  }
}
