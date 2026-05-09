import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.util';
import {
  TransactionKind,
  TransactionsQueryDto,
} from './dto/transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workerId: string, q: TransactionsQueryDto) {
    const limit = q.limit ?? 20;
    const cursor = decodeCursor(q.cursor);

    const where: Record<string, unknown> = {
      workerId,
      status: 'succeeded',
      ...(q.kinds?.length ? { kind: { in: q.kinds } } : {}),
    };
    if (cursor) {
      where.OR = [
        { timestamp: { lt: new Date(cursor.ts) } },
        { timestamp: new Date(cursor.ts), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      items: page.map((t) => ({
        id: t.id,
        kind: t.kind as TransactionKind,
        amount: t.amount,
        timestamp: t.timestamp.toISOString(),
        title: t.title,
        subtitle: t.subtitle,
        squad_reference: t.squadReference,
        related_job_id: t.relatedJobId,
      })),
      next_cursor: hasMore && last
        ? encodeCursor({ ts: last.timestamp.toISOString(), id: last.id })
        : null,
      has_more: hasMore,
    };
  }

  async detail(workerId: string, id: string) {
    const t = await this.prisma.transaction.findUnique({ where: { id } });
    if (!t || t.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Transaction not found.');
    }

    let relatedJobSummary: {
      id: string;
      type: string;
      title: string;
      location_address: string;
      duration_hours: number;
      completed_at: string;
    } | null = null;
    if (t.relatedJobId && (t.kind === 'job_payment' || t.kind === 'loan_repayment')) {
      const job = await this.prisma.job.findUnique({ where: { id: t.relatedJobId } });
      if (job) {
        relatedJobSummary = {
          id: job.id,
          type: job.type,
          title: job.title,
          location_address: job.address,
          duration_hours: job.durationHours,
          completed_at: t.timestamp.toISOString(),
        };
      }
    }

    let bankAccountSummary: { bank_name: string; account_number_last4: string } | null = null;
    if (t.kind === 'withdrawal' && t.bankAccountId) {
      const ba = await this.prisma.bankAccount.findUnique({ where: { id: t.bankAccountId } });
      if (ba) {
        bankAccountSummary = {
          bank_name: ba.bankName,
          account_number_last4: ba.accountNumber.slice(-4),
        };
      }
    }

    return {
      id: t.id,
      kind: t.kind as TransactionKind,
      amount: t.amount,
      timestamp: t.timestamp.toISOString(),
      title: t.title,
      subtitle: t.subtitle,
      squad_reference: t.squadReference,
      related_job_id: t.relatedJobId,
      related_job_summary: relatedJobSummary,
      bank_account_summary: bankAccountSummary,
    };
  }
}
