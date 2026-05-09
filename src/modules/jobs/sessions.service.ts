import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { haversineMeters } from '../../common/utils/geo';
import { ClockInDto, ClockOutDto } from './dto/session.dto';
import { mapSession } from './jobs.mapper';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async clockIn(workerId: string, body: ClockInDto) {
    if (body.accuracy_meters > 50) {
      throw new AppError(422, 'LOCATION_ACCURACY_TOO_LOW', 'GPS accuracy too low. Move outdoors and try again.', {
        accuracy_meters: body.accuracy_meters,
      });
    }

    const application = await this.prisma.jobApplication.findUnique({
      where: { id: body.application_id },
      include: { job: true, session: true },
    });
    if (!application || application.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    }
    if (application.status !== 'accepted' || application.session) {
      throw new AppError(409, 'INVALID_STATE', 'Application is not in an `accepted` state.');
    }

    const requiredRadius = application.job.geofenceRadiusMeters
      ?? this.config.get<number>('rules.geofenceDefaultRadiusM')!;
    const distance = haversineMeters(
      { lat: body.lat, lng: body.lng },
      { lat: application.job.lat, lng: application.job.lng },
    );
    if (distance > requiredRadius) {
      throw new AppError(422, 'OUTSIDE_GEOFENCE', `You're ${distance}m from the site — get closer to clock in.`, {
        distance_meters: distance,
        required_radius_meters: requiredRadius,
      });
    }

    const clockInAt = new Date();
    const expectedClockOutAt = new Date(clockInAt.getTime() + application.job.durationHours * 3_600_000);

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workSession.create({
        data: {
          id: newId(ID_PREFIXES.session),
          applicationId: application.id,
          status: 'in_progress',
          clockInAt,
          clockInLat: body.lat,
          clockInLng: body.lng,
          expectedClockOutAt,
          payAmountPending: application.job.payAmount,
        },
      });
      await tx.jobApplication.update({
        where: { id: application.id },
        data: { status: 'in_progress' },
      });
      await tx.job.update({
        where: { id: application.jobId },
        data: { filled: true },
      });
      return created;
    });

    return { session: mapSession(session) };
  }

  async heartbeat(workerId: string, sessionId: string) {
    const s = await this.prisma.workSession.findUnique({
      where: { id: sessionId },
      include: { application: true },
    });
    if (!s || s.application.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found.');
    }
    return { session: mapSession(s) };
  }

  async clockOut(workerId: string, sessionId: string, body: ClockOutDto) {
    const s = await this.prisma.workSession.findUnique({
      where: { id: sessionId },
      include: { application: { include: { job: true } } },
    });
    if (!s || s.application.workerId !== workerId) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found.');
    }
    if (s.status !== 'in_progress') {
      throw new AppError(409, 'INVALID_STATE', 'Session is not in progress.');
    }

    const upload = await this.prisma.upload.findUnique({ where: { id: body.proof_upload_id } });
    if (!upload || upload.workerId !== workerId || upload.purpose !== 'clock_out_proof') {
      throw new AppError(422, 'UPLOAD_NOT_FOUND', 'Proof upload not found or expired.');
    }

    const requiredRadius = s.application.job.geofenceRadiusMeters
      ?? this.config.get<number>('rules.geofenceDefaultRadiusM')!;
    const distance = haversineMeters(
      { lat: body.lat, lng: body.lng },
      { lat: s.application.job.lat, lng: s.application.job.lng },
    );
    if (distance > requiredRadius) {
      throw new AppError(422, 'OUTSIDE_GEOFENCE', `You're ${distance}m from the site at clock-out.`, {
        distance_meters: distance,
        required_radius_meters: requiredRadius,
      });
    }

    // Synchronously simulate Squad disbursement. In production this is an async
    // call to the Squad transfer API; on slow responses we return 202 with status `submitting`.
    const transactionId = newId(ID_PREFIXES.transaction);
    const clockOutAt = new Date();

    const employer = await this.prisma.employer.findUnique({ where: { id: s.application.job.employerId } });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.upload.update({ where: { id: upload.id }, data: { promoted: true } });

      const session = await tx.workSession.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          clockOutAt,
          clockOutLat: body.lat,
          clockOutLng: body.lng,
          proofPhotoUrl: upload.url,
          payAmountPending: 0,
          payAmountDisbursed: s.payAmountPending,
          transactionId,
          workerNote: body.worker_note ?? null,
        },
      });

      await tx.jobApplication.update({
        where: { id: s.applicationId },
        data: { status: 'completed', completedAt: clockOutAt },
      });

      await tx.transaction.create({
        data: {
          id: transactionId,
          workerId,
          kind: 'job_payment',
          amount: s.payAmountPending,
          timestamp: clockOutAt,
          title: employer?.name ?? 'Job payment',
          subtitle: `${s.application.job.type} · ${s.application.job.address}`,
          relatedJobId: s.application.jobId,
          squadReference: 'sqd_' + transactionId.slice(4),
          status: 'succeeded',
        },
      });

      const worker = await tx.worker.update({
        where: { id: workerId },
        data: {
          walletBalance: { increment: s.payAmountPending },
          totalEarned: { increment: s.payAmountPending },
          jobsCompleted: { increment: 1 },
        },
      });

      // Loan auto-deduction: if the worker has an active loan with a configured
      // repayment percent, peel off the cut and create a sibling ledger row.
      const activeLoan = await tx.loan.findFirst({
        where: { workerId, status: 'active', outstandingBalance: { gt: 0 } },
      });
      if (activeLoan && activeLoan.repaymentPercentPerJob > 0) {
        const cut = Math.min(
          activeLoan.outstandingBalance,
          Math.round(s.payAmountPending * activeLoan.repaymentPercentPerJob),
        );
        if (cut > 0) {
          const repaymentTxId = newId(ID_PREFIXES.transaction);
          await tx.transaction.create({
            data: {
              id: repaymentTxId,
              workerId,
              kind: 'loan_repayment',
              amount: -cut,
              timestamp: clockOutAt,
              title: 'Loan repayment',
              subtitle: 'Auto-deducted from job payment',
              relatedJobId: s.application.jobId,
              squadReference: 'sqd_' + repaymentTxId.slice(4),
              status: 'succeeded',
            },
          });
          await tx.loanRepayment.create({
            data: {
              id: newId(ID_PREFIXES.loanRepayment),
              loanId: activeLoan.id,
              amount: cut,
              paidAt: clockOutAt,
              fromJobId: s.application.jobId,
              fromJobTitle: s.application.job.title,
              transactionId: repaymentTxId,
            },
          });
          await tx.worker.update({
            where: { id: workerId },
            data: { walletBalance: { decrement: cut } },
          });
          const newOutstanding = activeLoan.outstandingBalance - cut;
          await tx.loan.update({
            where: { id: activeLoan.id },
            data: {
              outstandingBalance: newOutstanding,
              status: newOutstanding === 0 ? 'repaid' : 'active',
            },
          });
        }
      }

      void worker;
      return session;
    });

    // TODO: push notification "₦{amount} arrived in your wallet".
    return { session: mapSession(updated) };
  }
}
