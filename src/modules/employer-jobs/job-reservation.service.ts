import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/utils/app-error';

/**
 * Per-job hard escrow over `Employer.walletBalanceNaira`. Publishing a job
 * (or creating with `postNow=true`) atomically:
 *   1. Verifies the employer has enough wallet balance to cover `payAmount`.
 *   2. Decrements `Employer.walletBalanceNaira`.
 *   3. Stamps `Job.reservedAmountNaira = payAmount`.
 *
 * Cancelling a job refunds. Completing drains the reserve into the worker's
 * wallet (handled in `JobCompletionService` — this service only manages the
 * employer-side hold).
 *
 * All methods take a Prisma `TransactionClient` so they participate in the
 * caller's atomic transaction.
 */
@Injectable()
export class JobReservationService {
  /**
   * Lock the employer row, verify sufficient balance, debit the wallet,
   * and stamp the job's reserve. Throws `409 INSUFFICIENT_FUNDS` if the
   * employer can't cover `payAmount`.
   */
  async reserveOrThrow(
    tx: Prisma.TransactionClient,
    employerId: string,
    jobId: string,
    payAmount: number,
  ): Promise<void> {
    const employer = await tx.employer.findUnique({
      where: { id: employerId },
      select: { walletBalanceNaira: true },
    });
    if (!employer) {
      throw new AppError(404, 'NOT_FOUND', 'Employer not found.');
    }
    if (employer.walletBalanceNaira < payAmount) {
      throw new AppError(
        409,
        'INSUFFICIENT_FUNDS',
        `Your wallet balance is ₦${employer.walletBalanceNaira.toLocaleString('en-NG')} — top up at least ₦${(payAmount - employer.walletBalanceNaira).toLocaleString('en-NG')} more before publishing this job.`,
        {
          walletBalanceNaira: employer.walletBalanceNaira,
          requiredNaira: payAmount,
          shortfallNaira: payAmount - employer.walletBalanceNaira,
        },
      );
    }
    await tx.employer.update({
      where: { id: employerId },
      data: { walletBalanceNaira: { decrement: payAmount } },
    });
    await tx.job.update({
      where: { id: jobId },
      data: { reservedAmountNaira: payAmount },
    });
  }

  /**
   * Return whatever's still reserved on this job to the employer wallet, then
   * zero the reserve. No-op when nothing is reserved (e.g. cancelling a draft).
   */
  async refund(tx: Prisma.TransactionClient, jobId: string): Promise<void> {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { employerId: true, reservedAmountNaira: true },
    });
    if (!job) return;
    if (job.reservedAmountNaira <= 0) return;
    await tx.employer.update({
      where: { id: job.employerId },
      data: { walletBalanceNaira: { increment: job.reservedAmountNaira } },
    });
    await tx.job.update({
      where: { id: jobId },
      data: { reservedAmountNaira: 0 },
    });
  }
}
