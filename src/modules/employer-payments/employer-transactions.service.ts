import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Transaction, Worker } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { AuditService } from '../../common/audit/audit.service';
import { paginate } from '../../common/pagination/offset.dto';
import { SquadClient } from '../squad/squad.client';
import {
  CreateManualTransactionDto,
  TransactionDto,
  TransactionStatus,
  TransactionsListQueryDto,
  TransactionsListResponseDto,
  TransactionsSummaryDto,
  mapTransactionStatusToWire,
} from './dto/transactions.dto';

const PENDING_DB_STATUSES = ['pending', 'processing'];
const COMPLETED_DB_STATUSES = ['completed', 'succeeded'];
const SUMMARY_WINDOW_DAYS = 90;

@Injectable()
export class EmployerTransactionsService {
  private readonly logger = new Logger(EmployerTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly squad: SquadClient,
  ) {}

  async list(
    employerId: string | null,
    q: TransactionsListQueryDto,
  ): Promise<TransactionsListResponseDto> {
    const eid = this.requireScope(employerId);
    const where = this.buildWhere(eid, q);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { worker: { select: { id: true, name: true } } },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const jobIds = rows.map((r) => r.relatedJobId).filter((id): id is string => !!id);
    const jobs = jobIds.length
      ? await this.prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, title: true },
        })
      : [];
    const jobTitleById = new Map(jobs.map((j) => [j.id, j.title]));

    return paginate<TransactionDto>(
      rows.map((r) => this.toDto(r, r.worker, jobTitleById.get(r.relatedJobId ?? ''))),
      total,
      page,
      pageSize,
    );
  }

  async detail(employerId: string | null, id: string): Promise<TransactionDto> {
    const eid = this.requireScope(employerId);
    const t = await this.prisma.transaction.findFirst({
      where: { id, employerId: eid },
      include: { worker: { select: { id: true, name: true } } },
    });
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Transaction not found.');
    let jobTitle: string | undefined;
    if (t.relatedJobId) {
      const j = await this.prisma.job.findUnique({
        where: { id: t.relatedJobId },
        select: { title: true },
      });
      jobTitle = j?.title;
    }
    return this.toDto(t, t.worker, jobTitle);
  }

  async summary(employerId: string | null): Promise<TransactionsSummaryDto> {
    const eid = this.requireScope(employerId);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(now.getTime() - SUMMARY_WINDOW_DAYS * 86_400_000);

    const [paidThisMonth, pending, completedWindow, largest] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          employerId: eid,
          status: { in: COMPLETED_DB_STATUSES },
          timestamp: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { employerId: eid, status: { in: PENDING_DB_STATUSES } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          employerId: eid,
          status: { in: COMPLETED_DB_STATUSES },
          timestamp: { gte: windowStart },
        },
        _avg: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          employerId: eid,
          status: { in: COMPLETED_DB_STATUSES },
          timestamp: { gte: windowStart },
        },
        _max: { amount: true },
      }),
    ]);

    return {
      paidThisMonthNaira: paidThisMonth._sum.amount ?? 0,
      pendingCount: pending._count._all,
      pendingAmountNaira: pending._sum.amount ?? 0,
      averageJobCostNaira: Math.round(completedWindow._avg.amount ?? 0),
      largestPaymentNaira: largest._max.amount ?? 0,
    };
  }

  async createManual(
    actor: { userId: string; employerId: string | null },
    body: CreateManualTransactionDto,
    req: Request,
  ): Promise<TransactionDto> {
    const eid = this.requireScope(actor.employerId);

    const worker = await this.prisma.worker.findUnique({
      where: { id: body.workerId },
      select: { id: true, name: true },
    });
    if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');

    // If a job is linked, confirm it belongs to this employer (no cross-tenant leak).
    let jobTitle: string | undefined;
    if (body.jobId) {
      const job = await this.prisma.job.findFirst({
        where: { id: body.jobId, employerId: eid },
        select: { id: true, title: true },
      });
      if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found.');
      jobTitle = job.title;
    }

    // Worker must have a default bank account on file before we can transfer
    // — Squad needs (bank_code, account_number, account_name) and we don't
    // store the worker's name redundantly per row.
    const defaultAccount = await this.prisma.bankAccount.findFirst({
      where: { workerId: body.workerId, isDefault: true },
    });
    if (!defaultAccount) {
      throw new AppError(
        422,
        'WORKER_NO_BANK_ACCOUNT',
        'The worker has not linked a default bank account yet — funds can\'t be transferred.',
      );
    }

    const id = newId(ID_PREFIXES.transaction);
    const squadReference = this.squad.newReference('txn');

    // Initiate the Squad transfer FIRST so we have the provider's reply before
    // writing the row. If Squad errors out we still write the row but mark it
    // failed so ops can investigate; we don't want a silent drop.
    const outcome = await this.squad.transfer({
      transactionReference: squadReference,
      bankCode: defaultAccount.bankCode,
      accountNumber: defaultAccount.accountNumber,
      accountName: defaultAccount.accountName,
      amountNaira: body.amountNaira,
      remark: body.description?.slice(0, 80) ?? `Forge transfer to ${worker.name}`,
    });

    if (!outcome.ok) {
      this.logger.error(`[squad] transfer rejected: ${outcome.message}`);
    }

    const created = await this.prisma.transaction.create({
      data: {
        id,
        workerId: body.workerId,
        employerId: eid,
        kind: 'manual_transfer',
        amount: body.amountNaira,
        timestamp: new Date(),
        title: body.description?.slice(0, 80) ?? `Manual transfer to ${worker.name}`,
        subtitle: body.jobId ? `Linked to ${body.jobId}` : 'Manual payout',
        relatedJobId: body.jobId ?? null,
        squadReference,
        // Initial state: `processing` if Squad accepted, `failed` if it didn't.
        // Final state lands via the Squad webhook (`completed` / `failed` / `reversed`).
        status: outcome.ok ? 'processing' : 'failed',
        failureReason: outcome.ok ? null : outcome.message,
      },
      include: { worker: { select: { id: true, name: true } } },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.transaction_create',
      entityType: 'transaction',
      entityId: id,
      after: {
        workerId: body.workerId,
        amountNaira: body.amountNaira,
        jobId: body.jobId ?? null,
        squadReference,
        squadOk: outcome.ok,
      },
      request: req,
    });

    return this.toDto(created, created.worker, jobTitle);
  }

  async *exportCsvRows(
    employerId: string | null,
    q: TransactionsListQueryDto,
  ): AsyncGenerator<string> {
    const eid = this.requireScope(employerId);
    const where = this.buildWhere(eid, q);

    yield '﻿'; // UTF-8 BOM (Excel compat — BRIEF §11.9)
    yield csvLine([
      'id',
      'squadReference',
      'workerId',
      'workerName',
      'jobId',
      'amountNaira',
      'status',
      'timestamp',
      'settledAt',
      'failureReason',
    ]);

    const PAGE = 200;
    let skip = 0;
    while (true) {
      const rows = await this.prisma.transaction.findMany({
        where,
        include: { worker: { select: { name: true } } },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip,
        take: PAGE,
      });
      if (rows.length === 0) break;
      for (const t of rows) {
        yield csvLine([
          t.id,
          t.squadReference ?? '',
          t.workerId,
          t.worker.name,
          t.relatedJobId ?? '',
          String(t.amount),
          mapTransactionStatusToWire(t.status),
          t.timestamp.toISOString(),
          t.settledAt ? t.settledAt.toISOString() : '',
          t.failureReason ?? '',
        ]);
      }
      if (rows.length < PAGE) break;
      skip += PAGE;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private buildWhere(employerId: string, q: TransactionsListQueryDto): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { employerId };
    if (q.status) {
      // Honour the wire value but also accept the legacy 'succeeded' under 'completed'.
      where.status =
        q.status === TransactionStatus.Completed
          ? { in: COMPLETED_DB_STATUSES }
          : q.status;
    }
    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lt = new Date(q.to);
      where.timestamp = range;
    }
    if (q.q) {
      where.OR = [
        { id: { equals: q.q } },
        { squadReference: { equals: q.q } },
        { relatedJobId: { equals: q.q } },
        { worker: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  private toDto(
    t: Transaction,
    worker: Pick<Worker, 'id' | 'name'> | null,
    jobTitle?: string,
  ): TransactionDto {
    return {
      id: t.id,
      squadReference: t.squadReference ?? null,
      employerId: t.employerId ?? '',
      workerId: t.workerId,
      workerName: worker?.name ?? null,
      jobId: t.relatedJobId ?? null,
      jobTitle: jobTitle ?? null,
      amountNaira: t.amount,
      status: mapTransactionStatusToWire(t.status),
      timestamp: t.timestamp.toISOString(),
      settledAt: t.settledAt ? t.settledAt.toISOString() : null,
      failureReason: t.failureReason ?? null,
    };
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function csvLine(fields: string[]): string {
  return fields
    .map((f) => {
      const needsQuote = /[",\n\r]/.test(f);
      const escaped = f.replace(/"/g, '""');
      return needsQuote ? `"${escaped}"` : escaped;
    })
    .join(',') + '\r\n';
}
