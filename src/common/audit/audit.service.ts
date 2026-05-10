import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ID_PREFIXES, newId } from '../utils/ids';

export interface AuditInput {
  actor:
    | { type: 'user'; id: string }
    | { type: 'worker'; id: string }
    | { type: 'system' };
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  request?: Request;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: newId(ID_PREFIXES.audit),
        actorUserId: input.actor.type === 'user' ? input.actor.id : null,
        actorWorkerId: input.actor.type === 'worker' ? input.actor.id : null,
        actorType: input.actor.type,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        // Only set the json fields when the caller actually has a payload.
        // Omitting → column is SQL NULL.
        ...(input.before !== undefined && input.before !== null
          ? { before: input.before as Prisma.InputJsonValue }
          : {}),
        ...(input.after !== undefined && input.after !== null
          ? { after: input.after as Prisma.InputJsonValue }
          : {}),
        ipAddress: input.request?.ip ?? null,
        userAgent: (input.request?.headers['user-agent'] as string | undefined) ?? null,
      },
    });
  }
}
