import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import {
  BankAccountDto,
  LinkBankAccountDto,
  ResolveBankDto,
} from './dto/bank-account.dto';

@Injectable()
export class BanksService {
  constructor(private readonly prisma: PrismaService) {}

  async listBanks() {
    const items = await this.prisma.bank.findMany({ orderBy: { name: 'asc' } });
    return { items };
  }

  /**
   * NIBSS resolve. In production this hits Squad's `/transfer/account/lookup`;
   * here we accept any 10-digit number and synthesise a name. Real provider
   * wiring is a swap of this method only.
   */
  async resolve(workerId: string, body: ResolveBankDto) {
    void workerId;
    const bank = await this.prisma.bank.findUnique({ where: { code: body.bank_code } });
    if (!bank) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Unknown bank code.');
    }
    // TODO: rate-limit at 10/minute per worker.
    return { account_name: 'TEST ACCOUNT NAME' };
  }

  async listMine(workerId: string): Promise<{ items: BankAccountDto[] }> {
    const rows = await this.prisma.bankAccount.findMany({
      where: { workerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      items: rows.map((b) => ({
        id: b.id,
        bank_code: b.bankCode,
        bank_name: b.bankName,
        account_number: b.accountNumber,
        account_name: b.accountName,
        is_default: b.isDefault,
        created_at: b.createdAt.toISOString(),
      })),
    };
  }

  async link(workerId: string, body: LinkBankAccountDto): Promise<BankAccountDto> {
    const bank = await this.prisma.bank.findUnique({ where: { code: body.bank_code } });
    if (!bank) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Unknown bank code.');
    }

    // Re-resolve and reject if the name doesn't match what the client claims.
    const reResolved = await this.resolve(workerId, body);
    if (reResolved.account_name !== body.account_name) {
      throw new AppError(422, 'NAME_MISMATCH', 'Account name no longer matches; please re-enter.');
    }

    // Worker name fuzzy-match (reduces fraud).
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (worker && !this.fuzzyNameMatch(worker.name, body.account_name)) {
      throw new AppError(422, 'NAME_DOES_NOT_MATCH_PROFILE', 'Account name does not match your profile name.');
    }

    const dup = await this.prisma.bankAccount.findUnique({
      where: {
        workerId_bankCode_accountNumber: {
          workerId,
          bankCode: body.bank_code,
          accountNumber: body.account_number,
        },
      },
    });
    if (dup) {
      throw new AppError(409, 'ALREADY_LINKED', 'This account is already linked.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (body.set_as_default) {
        await tx.bankAccount.updateMany({ where: { workerId }, data: { isDefault: false } });
      }
      const existingCount = await tx.bankAccount.count({ where: { workerId } });
      const isDefault = body.set_as_default || existingCount === 0;

      return tx.bankAccount.create({
        data: {
          id: newId(ID_PREFIXES.bankAccount),
          workerId,
          bankCode: body.bank_code,
          bankName: bank.name,
          accountNumber: body.account_number,
          accountName: body.account_name,
          isDefault,
        },
      });
    });

    return {
      id: created.id,
      bank_code: created.bankCode,
      bank_name: created.bankName,
      account_number: created.accountNumber,
      account_name: created.accountName,
      is_default: created.isDefault,
      created_at: created.createdAt.toISOString(),
    };
  }

  async setDefault(workerId: string, id: string) {
    const ba = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!ba || ba.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Bank account not found.');
    }
    await this.prisma.$transaction([
      this.prisma.bankAccount.updateMany({ where: { workerId }, data: { isDefault: false } }),
      this.prisma.bankAccount.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.listMine(workerId);
  }

  async remove(workerId: string, id: string) {
    const ba = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!ba || ba.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Bank account not found.');
    }
    const total = await this.prisma.bankAccount.count({ where: { workerId } });

    const activeLoan = await this.prisma.loan.findFirst({
      where: { workerId, status: 'active' },
    });
    if (activeLoan && total <= 1) {
      throw new AppError(409, 'CANNOT_REMOVE_LAST_ACCOUNT', 'You have an active loan — keep at least one bank.');
    }
    if (ba.isDefault && total > 1) {
      throw new AppError(409, 'CANNOT_REMOVE_DEFAULT', 'Promote another account before removing the default.');
    }
    await this.prisma.bankAccount.delete({ where: { id } });
  }

  private fuzzyNameMatch(profile: string, account: string): boolean {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
    const a = new Set(norm(profile).split(' '));
    const b = norm(account).split(' ');
    const overlap = b.filter((w) => a.has(w)).length;
    return overlap >= Math.min(2, b.length);
  }
}
