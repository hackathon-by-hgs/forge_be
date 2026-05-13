import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { paginate } from '../../common/pagination/offset.dto';
import { StreamPublisher } from '../stream/stream.publisher';
import { PushNotificationService } from '../messaging/push-notification.service';
import {
  ApproveLoanApplicationDto,
  LoanDto,
  LoanRiskLevel,
  LoanStatus,
  RejectLoanApplicationDto,
} from './dto/loans.dto';
import {
  BankApplicationsListQueryDto,
  BankApplicationsListResponseDto,
  LoanApplicationDto,
  LoanApplicationStatus,
} from './dto/loan-applications.dto';
import {
  toBorrowerSummary,
  toLoanApplicationDto,
  toLoanDto,
} from './bank.mapper';

const DEFAULT_APR = 0.14;
const DEFAULT_REPAYMENT_PERCENT_PER_JOB = 0.15;

@Injectable()
export class BankApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stream: StreamPublisher,
    private readonly push: PushNotificationService,
  ) {}

  async list(
    bankId: string | null,
    q: BankApplicationsListQueryDto,
  ): Promise<BankApplicationsListResponseDto> {
    const bid = this.requireScope(bankId);
    const where = this.buildWhere(bid, q);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.loanApplication.findMany({
        where,
        include: { worker: true, employer: true },
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loanApplication.count({ where }),
    ]);

    return paginate<LoanApplicationDto>(
      rows.map((a) =>
        toLoanApplicationDto(
          a,
          toBorrowerSummary(a.borrowerType, a.worker, a.employer),
        ),
      ),
      total,
      page,
      pageSize,
    );
  }

  async detail(bankId: string | null, id: string): Promise<LoanApplicationDto> {
    const bid = this.requireScope(bankId);
    const app = await this.prisma.loanApplication.findFirst({
      where: { id, bankId: bid },
      include: { worker: true, employer: true },
    });
    if (!app)
      throw new AppError(404, 'NOT_FOUND', 'Loan application not found.');
    return toLoanApplicationDto(
      app,
      toBorrowerSummary(app.borrowerType, app.worker, app.employer),
    );
  }

  async approve(
    actor: { userId: string; bankId: string | null },
    id: string,
    body: ApproveLoanApplicationDto,
    req: Request,
  ): Promise<LoanDto> {
    const bid = this.requireScope(actor.bankId);
    const app = await this.prisma.loanApplication.findFirst({
      where: { id, bankId: bid },
      include: { worker: true, employer: true },
    });
    if (!app)
      throw new AppError(404, 'NOT_FOUND', 'Loan application not found.');
    if (app.status !== LoanApplicationStatus.Pending) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot approve an application in status '${app.status}'.`,
      );
    }

    const principalNaira =
      body.principalNairaOverride ?? app.amountRequestedNaira;
    const apr = body.aprOverride ?? DEFAULT_APR;
    const termMonths = body.termMonthsOverride ?? app.termMonths;
    const now = new Date();
    const loanId = newId(ID_PREFIXES.loan);

    const score =
      app.worker?.reliabilityScore ?? app.employer?.creditScore ?? 50;
    const predicted = score >= 80 ? 0.97 : score >= 70 ? 0.9 : 0.75;

    // §24 worker-mobile push — only for worker loans; business borrowers
    // surface on the dashboard, not the mobile app.
    const workerNotificationId = app.workerId
      ? newId(ID_PREFIXES.notification)
      : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          id: loanId,
          workerId: app.workerId,
          employerId: app.employerId,
          bankId: bid,
          borrowerType: app.borrowerType,
          principal: principalNaira,
          outstandingBalance: principalNaira,
          interestRatePercent: Math.round(apr * 100),
          apr,
          termMonths,
          repaymentPercentPerJob: DEFAULT_REPAYMENT_PERCENT_PER_JOB,
          status: LoanStatus.Approved,
          riskLevel: LoanRiskLevel.Green,
          scoreAtApproval: score,
          predictedRepaymentRate: predicted,
          createdAt: now,
        },
        include: { worker: true, employer: true },
      });
      await tx.loanApplication.update({
        where: { id },
        data: { status: LoanApplicationStatus.Approved, decidedAt: now },
      });
      if (workerNotificationId && app.workerId) {
        await tx.notification.create({
          data: {
            id: workerNotificationId,
            workerId: app.workerId,
            kind: 'loan',
            pushKind: 'loan_approved',
            title: 'Your loan was approved',
            body: `₦${principalNaira.toLocaleString('en-NG')} approved — disbursement coming next.`,
            timestamp: now,
            deeplink: '/loans/approved',
          },
        });
      }
      return loan;
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'bank.application_approve',
      entityType: 'loan_application',
      entityId: id,
      before: {
        status: app.status,
        amountRequestedNaira: app.amountRequestedNaira,
      },
      after: {
        status: LoanApplicationStatus.Approved,
        loanId,
        principalNaira,
        apr,
        termMonths,
      },
      request: req,
    });

    // Legacy event — kept for Phase 4 clients already wired against it.
    this.stream.publish({
      scope: { kind: 'bank', id: bid },
      event: 'application.decided',
      data: { applicationId: id, decision: 'approved', loanId, principalNaira },
    });
    // §27 spec name — bank-web invalidation map keys on
    // `loan_application.lifecycle_changed`.
    this.stream.publish({
      scope: { kind: 'bank', id: bid },
      event: 'loan_application.lifecycle_changed',
      data: {
        applicationId: id,
        status: 'approved',
        decidedAt: new Date().toISOString(),
        loanId,
      },
    });

    if (workerNotificationId) {
      void this.push.sendForNotificationRow(workerNotificationId);
    }

    return toLoanDto(
      created,
      toBorrowerSummary(created.borrowerType, created.worker, created.employer),
    );
  }

  async reject(
    actor: { userId: string; bankId: string | null },
    id: string,
    body: RejectLoanApplicationDto,
    req: Request,
  ): Promise<LoanApplicationDto> {
    const bid = this.requireScope(actor.bankId);
    const app = await this.prisma.loanApplication.findFirst({
      where: { id, bankId: bid },
      include: { worker: true, employer: true },
    });
    if (!app)
      throw new AppError(404, 'NOT_FOUND', 'Loan application not found.');
    if (app.status !== LoanApplicationStatus.Pending) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Cannot reject an application in status '${app.status}'.`,
      );
    }

    const now = new Date();
    // §24 — write the worker mobile notification in the same tx as the
    // status flip so a retry doesn't double-notify.
    const workerNotificationId = app.workerId
      ? newId(ID_PREFIXES.notification)
      : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.loanApplication.update({
        where: { id },
        data: { status: LoanApplicationStatus.Rejected, decidedAt: now },
        include: { worker: true, employer: true },
      });
      if (workerNotificationId && app.workerId) {
        await tx.notification.create({
          data: {
            id: workerNotificationId,
            workerId: app.workerId,
            kind: 'loan',
            pushKind: 'loan_rejected',
            title: 'Loan application not approved',
            body: body.reason
              ? `Reason: ${body.reason}`
              : 'Tap to see what to do next.',
            timestamp: now,
            deeplink: '/loans/rejected',
          },
        });
      }
      return u;
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'bank.application_reject',
      entityType: 'loan_application',
      entityId: id,
      before: { status: app.status },
      after: { status: LoanApplicationStatus.Rejected, reason: body.reason },
      request: req,
    });

    // Legacy event — kept for Phase 4 clients already wired against it.
    this.stream.publish({
      scope: { kind: 'bank', id: bid },
      event: 'application.decided',
      data: { applicationId: id, decision: 'rejected', reason: body.reason },
    });
    // §27 spec name — bank-web invalidation map keys on
    // `loan_application.lifecycle_changed`.
    this.stream.publish({
      scope: { kind: 'bank', id: bid },
      event: 'loan_application.lifecycle_changed',
      data: {
        applicationId: id,
        status: 'rejected',
        decidedAt: new Date().toISOString(),
        reason: body.reason,
      },
    });

    if (workerNotificationId) {
      void this.push.sendForNotificationRow(workerNotificationId);
    }

    return toLoanApplicationDto(
      updated,
      toBorrowerSummary(updated.borrowerType, updated.worker, updated.employer),
    );
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
    q: BankApplicationsListQueryDto,
  ): Prisma.LoanApplicationWhereInput {
    const where: Prisma.LoanApplicationWhereInput = { bankId };
    if (q.status) where.status = q.status;
    if (q.borrowerType) where.borrowerType = q.borrowerType;
    if (q.recommendedDecision)
      where.recommendedDecision = q.recommendedDecision;
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
