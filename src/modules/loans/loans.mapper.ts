import { Loan, LoanRepayment } from '@prisma/client';
import { LoanPurpose, LoanStatus, LoanSummaryDto } from './dto/loan.dto';

export function toLoanSummary(l: Loan, repaymentStats?: { count: number; total: number }): LoanSummaryDto {
  return {
    id: l.id,
    principal: l.principal,
    outstanding_balance: l.outstandingBalance,
    interest_rate_percent: l.interestRatePercent,
    repayment_percent_per_job: l.repaymentPercentPerJob,
    status: l.status as LoanStatus,
    disbursed_at: l.disbursedAt?.toISOString() ?? null,
    estimated_decision_at: l.estimatedDecisionAt?.toISOString() ?? null,
    rejection_reason: l.rejectionReason ?? null,
    purpose: (l.purpose as LoanPurpose | null) ?? null,
    next_repayment_estimate: Math.round(l.principal * l.repaymentPercentPerJob),
    next_repayment_when: 'On your next job',
    repayments_count: repaymentStats?.count,
    repayments_total: repaymentStats?.total,
  };
}

export function toRepaymentDto(r: LoanRepayment) {
  return {
    id: r.id,
    amount: r.amount,
    paid_at: (r.paidAt ?? r.scheduledFor ?? new Date(0)).toISOString(),
    from_job_id: r.fromJobId ?? '',
    from_job_title: r.fromJobTitle ?? '',
    transaction_id: r.transactionId ?? '',
  };
}
