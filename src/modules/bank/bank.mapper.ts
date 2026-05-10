import { Employer, Loan, LoanRepayment, Worker } from '@prisma/client';
import {
  BorrowerSummaryDto,
  BorrowerType,
  LoanDto,
  LoanRepaymentDto,
  LoanRiskLevel,
  LoanStatus,
} from './dto/loans.dto';
import {
  LoanApplicationDto,
  LoanApplicationStatus,
  RecommendedDecision,
} from './dto/loan-applications.dto';

/**
 * Build a `BorrowerSummaryDto` from the Worker OR Employer row tied to a
 * Loan/LoanApplication. One of `worker` / `employer` must be present.
 */
export function toBorrowerSummary(
  borrowerType: string,
  worker: Worker | null,
  employer: Employer | null,
): BorrowerSummaryDto {
  if (borrowerType === BorrowerType.Worker && worker) {
    return {
      id: worker.id,
      type: BorrowerType.Worker,
      displayName: worker.name,
      photoUrl: worker.photoUrl ?? null,
      score: worker.reliabilityScore,
    };
  }
  if (borrowerType === BorrowerType.Business && employer) {
    return {
      id: employer.id,
      type: BorrowerType.Business,
      displayName: employer.businessName,
      photoUrl: employer.photoUrl ?? null,
      score: employer.creditScore,
    };
  }
  // Defensive fallback — should never trigger in practice.
  return {
    id: worker?.id ?? employer?.id ?? '',
    type: borrowerType === BorrowerType.Business ? BorrowerType.Business : BorrowerType.Worker,
    displayName: worker?.name ?? employer?.businessName ?? 'Unknown borrower',
    photoUrl: worker?.photoUrl ?? employer?.photoUrl ?? null,
    score: worker?.reliabilityScore ?? employer?.creditScore ?? 0,
  };
}

export function toLoanDto(
  loan: Loan,
  borrower: BorrowerSummaryDto,
): LoanDto {
  return {
    id: loan.id,
    bankId: loan.bankId ?? '',
    borrowerType: loan.borrowerType as BorrowerType,
    borrower,
    principalNaira: loan.principal,
    outstandingNaira: loan.outstandingBalance,
    apr: loan.apr,
    termMonths: loan.termMonths ?? null,
    repaymentPercentPerJob: loan.repaymentPercentPerJob,
    status: loan.status as LoanStatus,
    riskLevel: loan.riskLevel as LoanRiskLevel,
    purpose: loan.purpose ?? null,
    disbursedAt: loan.disbursedAt ? loan.disbursedAt.toISOString() : null,
    expectedFullRepaymentAt: loan.expectedFullRepaymentAt
      ? loan.expectedFullRepaymentAt.toISOString()
      : null,
    nextPaymentDueAt: loan.nextPaymentDueAt ? loan.nextPaymentDueAt.toISOString() : null,
    scoreAtApproval: loan.scoreAtApproval ?? null,
    predictedRepaymentRate: loan.predictedRepaymentRate ?? null,
    rejectionReason: loan.rejectionReason ?? null,
    createdAt: loan.createdAt.toISOString(),
  };
}

export function toLoanRepaymentDto(r: LoanRepayment): LoanRepaymentDto {
  return {
    id: r.id,
    loanId: r.loanId,
    amountNaira: r.amount,
    scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    status: r.status,
    fromJobId: r.fromJobId ?? null,
    fromJobTitle: r.fromJobTitle ?? null,
    transactionId: r.transactionId ?? null,
  };
}

export function toLoanApplicationDto(
  app: { id: string; bankId: string; borrowerType: string; amountRequestedNaira: number; termMonths: number; status: string; recommendedDecision: string; recommendationConfidencePct: number; recommendationReason: string; appliedAt: Date; decidedAt: Date | null },
  borrower: BorrowerSummaryDto,
): LoanApplicationDto {
  return {
    id: app.id,
    bankId: app.bankId,
    borrowerType: app.borrowerType as BorrowerType,
    borrower,
    amountRequestedNaira: app.amountRequestedNaira,
    termMonths: app.termMonths,
    status: app.status as LoanApplicationStatus,
    recommendedDecision: app.recommendedDecision as RecommendedDecision,
    recommendationConfidencePct: app.recommendationConfidencePct,
    recommendationReason: app.recommendationReason,
    appliedAt: app.appliedAt.toISOString(),
    decidedAt: app.decidedAt ? app.decidedAt.toISOString() : null,
  };
}
