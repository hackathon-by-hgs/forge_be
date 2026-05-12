import { Worker } from '@prisma/client';
import { PrimarySkill } from '../../common/enums/primary-skill.enum';
import { WorkerDto } from './dto/worker.dto';

export function toWorkerDto(w: Worker): WorkerDto {
  return {
    id: w.id,
    name: w.name,
    phone_number: w.phoneNumber,
    photo_url: w.photoUrl,
    primary_skill: w.primarySkill as PrimarySkill,
    preferred_radius_km: w.preferredRadiusKm,
    wallet_balance: w.walletBalance,
    total_earned: w.totalEarned,
    jobs_completed: w.jobsCompleted,
    reliability_score: w.reliabilityScore,
    average_rating: w.averageRating,
    credit_score: w.creditScore,
    joined_at: w.joinedAt.toISOString(),
    virtual_account:
      w.squadVirtualAccountNumber && w.squadVirtualAccountBankCode
        ? {
            number: w.squadVirtualAccountNumber,
            bank_code: w.squadVirtualAccountBankCode,
            account_name: w.squadVirtualAccountName ?? '',
          }
        : null,
  };
}
