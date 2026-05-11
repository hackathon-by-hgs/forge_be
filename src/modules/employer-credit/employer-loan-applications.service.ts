import { Injectable } from '@nestjs/common';
import { LoanApplication, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { AuditService } from '../../common/audit/audit.service';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { paginate } from '../../common/pagination/offset.dto';
import {
  CreateEmployerLoanApplicationDto,
  EmployerLoanApplicationDto,
  EmployerLoanApplicationStatus,
  EmployerLoanApplicationsListQueryDto,
  EmployerLoanApplicationsListResponseDto,
  RecommendedDecision,
} from './dto/loan-application.dto';

type AppWithBank = LoanApplication & { bank: { name: string } };

@Injectable()
export class EmployerLoanApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── POST /v1/employer/loan-applications ────────────────────────────────
  async apply(
    actor: { userId: string; employerId: string | null },
    body: CreateEmployerLoanApplicationDto,
    req: Request,
  ): Promise<EmployerLoanApplicationDto> {
    const eid = this.requireScope(actor.employerId);
    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { id: true, creditScore: true, totalLaborSpendNaira: true, businessName: true },
    });
    if (!employer) throw new AppError(404, 'NOT_FOUND', 'Employer not found.');

    const bank = await this.resolveBank(body.bankId);

    const recommendation = computeRecommendation(
      employer.creditScore,
      employer.totalLaborSpendNaira,
      body.amountNaira,
    );

    const id = newId(ID_PREFIXES.loanApplication);
    const created = await this.prisma.loanApplication.create({
      data: {
        id,
        borrowerType: 'business',
        employerId: eid,
        bankId: bank.id,
        amountRequestedNaira: body.amountNaira,
        termMonths: body.termMonths,
        recommendedDecision: recommendation.decision,
        recommendationConfidencePct: recommendation.confidencePct,
        recommendationReason: recommendation.reason,
        status: 'pending',
      },
      include: { bank: { select: { name: true } } },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.loan_application_create',
      entityType: 'loan_application',
      entityId: id,
      after: {
        bankId: bank.id,
        amountRequestedNaira: body.amountNaira,
        termMonths: body.termMonths,
        recommendedDecision: recommendation.decision,
      },
      request: req,
    });

    return toEmployerLoanApplicationDto(created, body.purpose ?? null);
  }

  // ── GET /v1/employer/loan-applications ─────────────────────────────────
  async list(
    employerId: string | null,
    q: EmployerLoanApplicationsListQueryDto,
  ): Promise<EmployerLoanApplicationsListResponseDto> {
    const eid = this.requireScope(employerId);
    const where: Prisma.LoanApplicationWhereInput = { employerId: eid };
    if (q.status) where.status = q.status;

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.loanApplication.findMany({
        where,
        include: { bank: { select: { name: true } } },
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.loanApplication.count({ where }),
    ]);

    return paginate<EmployerLoanApplicationDto>(
      rows.map((a) => toEmployerLoanApplicationDto(a, null)),
      total,
      page,
      pageSize,
    );
  }

  // ── GET /v1/employer/loan-applications/:id ─────────────────────────────
  async detail(employerId: string | null, id: string): Promise<EmployerLoanApplicationDto> {
    const eid = this.requireScope(employerId);
    const app = await this.prisma.loanApplication.findFirst({
      where: { id, employerId: eid },
      include: { bank: { select: { name: true } } },
    });
    if (!app) throw new AppError(404, 'NOT_FOUND', 'Loan application not found.');
    return toEmployerLoanApplicationDto(app, null);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private async resolveBank(bankId: string | undefined): Promise<{ id: string; name: string }> {
    if (bankId) {
      const bank = await this.prisma.bank.findUnique({
        where: { id: bankId },
        select: { id: true, name: true },
      });
      if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank not found.');
      return bank;
    }
    // No bank specified — file with the earliest-onboarded lender. Banks are
    // vetted (admin-only signup) so this is safe; the employer can switch
    // explicitly via `bankId` once we expose a picker.
    const fallback = await this.prisma.bank.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!fallback) {
      throw new AppError(503, 'NO_LENDERS_AVAILABLE', 'No banks are onboarded yet.');
    }
    return fallback;
  }
}

// ── Indicative scoring (BRIEF §11.8 + §11.7) ──────────────────────────────

interface Recommendation {
  decision: RecommendedDecision;
  confidencePct: number;
  reason: string;
}

function computeRecommendation(
  score: number,
  totalSpendNaira: number,
  requestedNaira: number,
): Recommendation {
  const monthlyAvg = Math.max(0, Math.round(totalSpendNaira / 12));

  if (score < 70) {
    return {
      decision: RecommendedDecision.Reject,
      confidencePct: 90,
      reason: `Credit score ${score} is below the 70 threshold for business lending.`,
    };
  }

  const maxNaira = score >= 80 ? Math.min(monthlyAvg * 3, 5_000_000) : Math.min(monthlyAvg * 2, 2_000_000);

  if (requestedNaira > maxNaira && maxNaira > 0) {
    return {
      decision: RecommendedDecision.Review,
      confidencePct: 60,
      reason: `Requested ₦${requestedNaira.toLocaleString('en-NG')} exceeds the indicative cap of ₦${maxNaira.toLocaleString('en-NG')} at score ${score}; manual review recommended.`,
    };
  }

  if (maxNaira === 0) {
    return {
      decision: RecommendedDecision.Review,
      confidencePct: 55,
      reason: `Score ${score} qualifies but recorded labour spend is too low to size the loan automatically; manual review recommended.`,
    };
  }

  if (score >= 90) {
    return {
      decision: RecommendedDecision.Approve,
      confidencePct: 95,
      reason: `Pre-approved at score ${score}; well within the ₦${maxNaira.toLocaleString('en-NG')} cap.`,
    };
  }
  if (score >= 80) {
    return {
      decision: RecommendedDecision.Approve,
      confidencePct: 88,
      reason: `Pre-approved at score ${score}; within the ₦${maxNaira.toLocaleString('en-NG')} cap.`,
    };
  }
  // 70–79
  return {
    decision: RecommendedDecision.Approve,
    confidencePct: 76,
    reason: `Eligible at score ${score}; recommend approving within the ₦${maxNaira.toLocaleString('en-NG')} cap.`,
  };
}

function toEmployerLoanApplicationDto(
  app: AppWithBank,
  purpose: string | null,
): EmployerLoanApplicationDto {
  return {
    id: app.id,
    bankId: app.bankId,
    bankName: app.bank.name,
    borrowerType: 'business',
    amountRequestedNaira: app.amountRequestedNaira,
    termMonths: app.termMonths,
    purpose,
    appliedAt: app.appliedAt.toISOString(),
    status: app.status as EmployerLoanApplicationStatus,
    decidedAt: app.decidedAt ? app.decidedAt.toISOString() : null,
    recommendedDecision: app.recommendedDecision as RecommendedDecision,
    recommendationConfidencePct: app.recommendationConfidencePct,
    recommendationReason: app.recommendationReason,
  };
}
