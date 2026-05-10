import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/utils/app-error';
import { Role } from '../../common/enums/role.enum';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { EmailService } from '../dashboard-auth/email.service';
import { Request } from 'express';
import {
  InvitableTeamRole,
  InviteTeamMemberDto,
  PendingInvitationDto,
  TeamListDto,
  TeamMemberDto,
  UpdateTeamMemberRoleDto,
} from './dto/team.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async list(employerId: string | null): Promise<TeamListDto> {
    const eid = this.requireScope(employerId);
    const [members, pending] = await Promise.all([
      this.prisma.user.findMany({
        where: { employerId: eid },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.teamInvitation.findMany({
        where: { employerId: eid, acceptedAt: null, expiresAt: { gt: new Date() } },
        include: { invitedBy: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      members: members.map(
        (m): TeamMemberDto => ({
          id: m.id,
          email: m.email,
          fullName: m.fullName,
          role: m.role as Role,
          joinedAt: m.createdAt.toISOString(),
          lastLoginAt: m.lastLoginAt ? m.lastLoginAt.toISOString() : null,
          emailVerified: !!m.emailVerifiedAt,
        }),
      ),
      pending: pending.map(
        (p): PendingInvitationDto => ({
          id: p.id,
          email: p.email,
          role: p.role as InvitableTeamRole,
          invitedByName: p.invitedBy.fullName,
          invitedAt: p.createdAt.toISOString(),
          expiresAt: p.expiresAt.toISOString(),
        }),
      ),
    };
  }

  async invite(
    actor: { userId: string; employerId: string | null },
    body: InviteTeamMemberDto,
    req: Request,
  ): Promise<PendingInvitationDto> {
    const eid = this.requireScope(actor.employerId);
    const email = body.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.employerId === eid) {
        throw new AppError(409, 'ALREADY_TEAM_MEMBER', 'This person is already on your team.');
      }
      // The user exists with a different scope (or unscoped). Don't leak which.
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
    }

    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { businessName: true },
    });
    if (!employer) throw new AppError(404, 'NOT_FOUND', 'Employer not found.');

    const inviter = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { fullName: true, role: true },
    });
    if (!inviter) throw new AppError(404, 'NOT_FOUND', 'Inviter not found.');

    // Revoke any prior pending invite for the same (employer, email) so
    // sending a fresh invite always supersedes the last one.
    await this.prisma.teamInvitation.updateMany({
      where: { employerId: eid, email, acceptedAt: null },
      data: { expiresAt: new Date() },
    });

    const token = this.randomToken();
    const id = newId(ID_PREFIXES.teamInvite);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invitation = await this.prisma.teamInvitation.create({
      data: {
        id,
        employerId: eid,
        email,
        role: body.role,
        invitedById: actor.userId,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
      include: { invitedBy: { select: { fullName: true } } },
    });

    void this.email.sendTeamInvite({
      to: email,
      token,
      inviterName: inviter.fullName,
      businessName: employer.businessName,
      role: body.role as unknown as Role,
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.team_invite',
      entityType: 'team_invitation',
      entityId: id,
      after: { email, role: body.role },
      request: req,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as InvitableTeamRole,
      invitedByName: invitation.invitedBy.fullName,
      invitedAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async updateRole(
    actor: { userId: string; employerId: string | null; role: Role },
    targetUserId: string,
    body: UpdateTeamMemberRoleDto,
    req: Request,
  ): Promise<TeamMemberDto> {
    const eid = this.requireScope(actor.employerId);
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, employerId: eid },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Team member not found.');
    if (target.id === actor.userId) {
      throw new AppError(409, 'CANNOT_DEMOTE_SELF', 'Use another owner to change your role.');
    }
    if (target.role === Role.BusinessOwner) {
      throw new AppError(409, 'CANNOT_CHANGE_OWNER_ROLE', 'The business owner role cannot be changed.');
    }

    await this.prisma.user.update({ where: { id: target.id }, data: { role: body.role } });
    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.team_role_change',
      entityType: 'user',
      entityId: target.id,
      before: { role: target.role },
      after: { role: body.role },
      request: req,
    });

    const updated = await this.prisma.user.findUnique({ where: { id: target.id } });
    return this.toMember(updated!);
  }

  async remove(
    actor: { userId: string; employerId: string | null },
    targetUserId: string,
    req: Request,
  ): Promise<void> {
    const eid = this.requireScope(actor.employerId);
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, employerId: eid },
    });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Team member not found.');
    if (target.id === actor.userId) {
      throw new AppError(409, 'CANNOT_REMOVE_SELF', 'You cannot remove yourself.');
    }
    if (target.role === Role.BusinessOwner) {
      throw new AppError(409, 'CANNOT_REMOVE_OWNER', 'The business owner cannot be removed.');
    }
    // Detach from employer + revoke sessions. Keep the user row so audit + soft
    // history survive — the recovered account would just be re-invited.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: target.id },
        data: { employerId: null },
      }),
      this.prisma.userRefreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.team_remove',
      entityType: 'user',
      entityId: target.id,
      before: { employerId: eid, role: target.role },
      after: { employerId: null },
      request: req,
    });
  }

  async revokeInvitation(
    actor: { userId: string; employerId: string | null },
    invitationId: string,
    req: Request,
  ): Promise<void> {
    const eid = this.requireScope(actor.employerId);
    const inv = await this.prisma.teamInvitation.findFirst({
      where: { id: invitationId, employerId: eid, acceptedAt: null },
    });
    if (!inv) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');
    await this.prisma.teamInvitation.update({
      where: { id: inv.id },
      data: { expiresAt: new Date() },
    });
    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.team_invite_revoke',
      entityType: 'team_invitation',
      entityId: inv.id,
      request: req,
    });
  }

  // ── Public (used by dashboard-auth/team/accept) ──────────────────────────
  async claimByToken(token: string) {
    const invitation = await this.prisma.teamInvitation.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { employer: { select: { id: true, businessName: true } } },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
      throw new AppError(400, 'INVITATION_INVALID', 'This invitation link is invalid or expired.');
    }
    return invitation;
  }

  async markAccepted(invitationId: string): Promise<void> {
    await this.prisma.teamInvitation.update({
      where: { id: invitationId },
      data: { acceptedAt: new Date() },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private toMember(u: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    createdAt: Date;
    lastLoginAt: Date | null;
    emailVerifiedAt: Date | null;
  }): TeamMemberDto {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role as Role,
      joinedAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      emailVerified: !!u.emailVerifiedAt,
    };
  }

  private randomToken(): string {
    return uuidv4() + '-' + randomBytes(16).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
