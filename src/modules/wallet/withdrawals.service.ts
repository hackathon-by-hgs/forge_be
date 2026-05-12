import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { SquadClient } from '../squad/squad.client';
import { VirtualAccountProvisioner } from '../squad/virtual-account-provisioner.service';
import { TransactionKind } from './dto/transaction.dto';
import { WithdrawDto, WithdrawalPreviewQueryDto } from './dto/withdrawal.dto';

interface WithdrawalDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  /** Internal bank-account row id when known; null for virtual-NUBAN destinations. */
  bankAccountId: string | null;
}

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly squad: SquadClient,
    private readonly virtualAccount: VirtualAccountProvisioner,
  ) {}

  /**
   * Resolve the withdrawal destination. If `bankAccountId` is provided, the
   * worker has chosen one of their linked external bank accounts. Otherwise
   * we default to the worker's own Squad virtual NUBAN — lazily provisioning
   * it if signup hit a Squad outage.
   */
  private async resolveDestination(
    workerId: string,
    bankAccountId: string | null | undefined,
  ): Promise<WithdrawalDestination> {
    if (bankAccountId) {
      const ba = await this.prisma.bankAccount.findUnique({
        where: { id: bankAccountId },
      });
      if (!ba || ba.workerId !== workerId) {
        throw new AppError(422, 'BANK_NOT_FOUND', 'Bank account not found.');
      }
      return {
        bankCode: ba.bankCode,
        accountNumber: ba.accountNumber,
        accountName: ba.accountName,
        bankName: ba.bankName,
        bankAccountId: ba.id,
      };
    }
    // Virtual-NUBAN destination — lazy-provision if missing.
    let worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      select: {
        squadVirtualAccountNumber: true,
        squadVirtualAccountBankCode: true,
        squadVirtualAccountName: true,
        name: true,
      },
    });
    if (worker && !worker.squadVirtualAccountNumber) {
      await this.virtualAccount.ensureForWorker(workerId);
      worker = await this.prisma.worker.findUnique({
        where: { id: workerId },
        select: {
          squadVirtualAccountNumber: true,
          squadVirtualAccountBankCode: true,
          squadVirtualAccountName: true,
          name: true,
        },
      });
    }
    if (
      !worker?.squadVirtualAccountNumber ||
      !worker.squadVirtualAccountBankCode
    ) {
      throw new AppError(
        503,
        'PROVISIONING_VIRTUAL_ACCOUNT',
        'Your virtual account is still being set up. Try again in a few seconds.',
      );
    }
    return {
      bankCode: worker.squadVirtualAccountBankCode,
      accountNumber: worker.squadVirtualAccountNumber,
      accountName:
        worker.squadVirtualAccountName ?? worker.name ?? 'Forge wallet',
      bankName: 'Forge wallet',
      bankAccountId: null,
    };
  }

  private fee(): number {
    return this.config.get<number>('rules.withdrawalFlatFeeNaira')!;
  }

  async preview(workerId: string, q: WithdrawalPreviewQueryDto) {
    const min = this.config.get<number>('rules.withdrawalMinNaira')!;
    if (q.amount <= 0)
      throw new AppError(400, 'VALIDATION_FAILED', 'Amount must be positive.');
    if (q.amount < min) {
      throw new AppError(
        422,
        'BELOW_MINIMUM',
        `Minimum withdrawal is ₦${min}.`,
        { minimum: min },
      );
    }
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker || q.amount > worker.walletBalance) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Amount exceeds wallet balance.',
      );
    }
    const dest = await this.resolveDestination(workerId, q.bank_account_id);
    const fee = this.fee();
    const arriveAt = new Date(Date.now() + 5 * 60 * 1000);
    return {
      amount: q.amount,
      fee,
      amount_credited: q.amount - fee,
      estimated_arrival: 'in 5 minutes',
      estimated_arrival_at: arriveAt.toISOString(),
      destination: {
        bank_name: dest.bankName,
        account_number_last4: dest.accountNumber.slice(-4),
        account_name: dest.accountName,
      },
    };
  }

  async withdraw(workerId: string, body: WithdrawDto) {
    const min = this.config.get<number>('rules.withdrawalMinNaira')!;
    if (body.amount < min) {
      throw new AppError(
        422,
        'BELOW_MINIMUM',
        `Minimum withdrawal is ₦${min}.`,
        { minimum: min },
      );
    }
    const dest = await this.resolveDestination(workerId, body.bank_account_id);
    const squadReference = this.squad.newReference('wdr');

    // Phase 1 of the txn: debit wallet + write a `pending` Transaction so the
    // mobile UI sees the withdrawal queued immediately.
    const result = await this.prisma.$transaction(async (tx) => {
      const worker = await tx.worker.findUnique({ where: { id: workerId } });
      if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');
      if (worker.walletBalance < body.amount) {
        throw new AppError(
          422,
          'INSUFFICIENT_BALANCE',
          'Wallet balance changed before submit.',
        );
      }
      const updatedWorker = await tx.worker.update({
        where: { id: workerId },
        data: { walletBalance: { decrement: body.amount } },
      });
      const txnId = newId(ID_PREFIXES.transaction);
      const transaction = await tx.transaction.create({
        data: {
          id: txnId,
          workerId,
          kind: 'withdrawal',
          amount: -body.amount,
          timestamp: new Date(),
          title: `Withdrawal to ${dest.bankName} ****${dest.accountNumber.slice(-4)}`,
          subtitle: 'Estimated arrival in 5 min',
          squadReference,
          relatedJobId: null,
          bankAccountId: dest.bankAccountId,
          status: 'processing',
        },
      });
      return { transaction, walletBalanceAfter: updatedWorker.walletBalance };
    });

    // Phase 2: fire the real Squad transfer outside the DB transaction so a
    // slow Squad response doesn't hold the row lock. If Squad rejects the
    // transfer synchronously, refund the wallet and mark the Transaction
    // failed; otherwise the webhook will flip `processing → completed`.
    const outcome = await this.squad.transfer({
      transactionReference: squadReference,
      bankCode: dest.bankCode,
      accountNumber: dest.accountNumber,
      accountName: dest.accountName,
      amountNaira: body.amount,
      remark: 'Forge wallet withdrawal',
    });
    if (!outcome.ok) {
      this.logger.error(
        `[withdrawal] squad rejected ref=${squadReference} worker=${workerId}: ${outcome.message}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: result.transaction.id },
          data: {
            status: 'failed',
            failureReason: outcome.message,
            settledAt: new Date(),
          },
        });
        await tx.worker.update({
          where: { id: workerId },
          data: { walletBalance: { increment: body.amount } },
        });
      });
      throw new AppError(
        502,
        'PROVIDER_UNAVAILABLE',
        `Withdrawal provider rejected the transfer: ${outcome.message}`,
      );
    }

    return {
      transaction: {
        id: result.transaction.id,
        kind: result.transaction.kind as TransactionKind,
        amount: result.transaction.amount,
        timestamp: result.transaction.timestamp.toISOString(),
        title: result.transaction.title,
        subtitle: result.transaction.subtitle,
        squad_reference: result.transaction.squadReference,
        related_job_id: result.transaction.relatedJobId,
      },
      wallet_balance_after: result.walletBalanceAfter,
    };
  }
}
