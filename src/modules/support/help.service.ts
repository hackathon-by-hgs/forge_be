import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import {
  CreateTicketDto,
  HelpArticlesListDto,
  HelpArticlesQueryDto,
  HelpCategory,
} from './dto/help.dto';

@Injectable()
export class HelpService {
  constructor(private readonly prisma: PrismaService) {}

  async articles(q: HelpArticlesQueryDto): Promise<HelpArticlesListDto> {
    const items = await this.prisma.helpArticle.findMany({
      where: q.category ? { category: q.category } : undefined,
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: items.map((a) => ({
        id: a.id,
        category: a.category as HelpCategory,
        title: a.title,
        body_markdown: a.bodyMarkdown,
        updated_at: a.updatedAt.toISOString(),
      })),
    };
  }

  async createTicket(workerId: string, body: CreateTicketDto) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await this.prisma.supportTicket.count({
      where: { workerId, createdAt: { gte: since } },
    });
    if (recent >= 3) {
      throw new AppError(429, 'RATE_LIMITED', 'Limit of 3 tickets / 24h reached.');
    }
    const ticket = await this.prisma.supportTicket.create({
      data: {
        id: newId(ID_PREFIXES.ticket),
        workerId,
        category: body.category,
        subject: body.subject,
        message: body.message,
        relatedTransactionId: body.related_transaction_id ?? null,
        relatedJobId: body.related_job_id ?? null,
      },
    });
    // TODO: pipe to ops ticketing system.
    return { ticket_id: ticket.id, estimated_response: 'within 1 business day' };
  }
}
