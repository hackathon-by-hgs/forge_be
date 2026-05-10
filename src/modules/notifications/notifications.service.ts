import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import {
  OffsetPaginationQueryDto,
  offsetFromQuery,
  paginate,
} from '../../common/pagination/offset.dto';
import {
  NotificationsListResponseDto,
  UnreadCountDto,
} from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, q: OffsetPaginationQueryDto): Promise<NotificationsListResponseDto> {
    const { page, pageSize, skip, take } = offsetFromQuery(q);

    const [rows, total] = await Promise.all([
      this.prisma.userNotification.findMany({
        where: { recipientUserId: userId },
        orderBy: { occurredAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.userNotification.count({
        where: { recipientUserId: userId },
      }),
    ]);

    return paginate(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        href: r.href ?? null,
        occurredAt: r.occurredAt.toISOString(),
        readAt: r.readAt ? r.readAt.toISOString() : null,
      })),
      total,
      page,
      pageSize,
    );
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    const unreadCount = await this.prisma.userNotification.count({
      where: { recipientUserId: userId, readAt: null },
    });
    return { unreadCount };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.prisma.userNotification.updateMany({
      where: { id: notificationId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      // Already read OR never visible to this user — surface 404 (don't leak existence).
      const exists = await this.prisma.userNotification.findFirst({
        where: { id: notificationId, recipientUserId: userId },
        select: { id: true },
      });
      if (!exists) {
        throw new AppError(404, 'NOT_FOUND', 'Notification not found.');
      }
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.userNotification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
