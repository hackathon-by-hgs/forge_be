import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { TransactionKind } from './dto/transaction.dto';
import {
  WithdrawDto,
  WithdrawalPreviewQueryDto,
} from './dto/withdrawal.dto';

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async loadDestination(workerId: string, bankAccountId: string) {
    const ba = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!ba || ba.workerId !== workerId) {
      throw new AppError(422, 'BANK_NOT_FOUND', 'Bank account not found.');
    }
    return ba;
  }

  private fee(): number {
    return this.config.get<number>('rules.withdrawalFlatFeeNaira')!;
  }

  async preview(workerId: string, q: WithdrawalPreviewQueryDto) {
    const min = this.config.get<number>('rules.withdrawalMinNaira')!;
    if (q.amount <= 0) throw new AppError(400, 'VALIDATION_FAILED', 'Amount must be positive.');
    if (q.amount < min) {
      throw new AppError(422, 'BELOW_MINIMUM', `Minimum withdrawal is ₦${min}.`, { minimum: min });
    }
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker || q.amount > worker.walletBalance) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Amount exceeds wallet balance.');
    }
    const ba = await this.loadDestination(workerId, q.bank_account_id);
    const fee = this.fee();
    const arriveAt = new Date(Date.now() + 5 * 60 * 1000);
    return {
      amount: q.amount,
      fee,
      amount_credited: q.amount - fee,
      estimated_arrival: 'in 5 minutes',
      estimated_arrival_at: arriveAt.toISOString(),
      destination: {
        bank_name: ba.bankName,
        account_number_last4: ba.accountNumber.slice(-4),
        account_name: ba.accountName,
      },
    };
  }

  async withdraw(workerId: string, body: WithdrawDto) {
    const min = this.config.get<number>('rules.withdrawalMinNaira')!;
    if (body.amount < min) {
      throw new AppError(422, 'BELOW_MINIMUM', `Minimum withdrawal is ₦${min}.`, { minimum: min });
    }
    const ba = await this.loadDestination(workerId, body.bank_account_id);

    const result = await this.prisma.$transaction(async (tx) => {
      const worker = await tx.worker.findUnique({ where: { id: workerId } });
      if (!worker) throw new AppError(404, 'NOT_FOUND', 'Worker not found.');
      if (worker.walletBalance < body.amount) {
        throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Wallet balance changed before submit.');
      }

      // Deduct first, refund on Squad failure (none here — Squad call is stubbed).
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
          title: `Withdrawal to ${ba.bankName} ****${ba.accountNumber.slice(-4)}`,
          subtitle: 'Estimated arrival in 5 min',
          squadReference: 'sqd_w' + txnId.slice(4),
          relatedJobId: null,
          bankAccountId: ba.id,
          status: 'pending',
        },
      });

      // TODO: kick off Squad transfer; on webhook confirm, flip to `succeeded`.
      return { transaction, walletBalanceAfter: updatedWorker.walletBalance };
    });

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
