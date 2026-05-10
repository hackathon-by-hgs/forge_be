import { Injectable, Logger } from '@nestjs/common';
import { Invoice, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { ID_PREFIXES, newId } from '../../common/utils/ids';
import { AuditService } from '../../common/audit/audit.service';
import { paginate } from '../../common/pagination/offset.dto';
import { EmailService } from '../dashboard-auth/email.service';
import { Role } from '../../common/enums/role.enum';
import {
  GenerateBatchInvoiceDto,
  InvoiceDto,
  InvoiceLineItemDto,
  InvoiceStatus,
  InvoicesListQueryDto,
  InvoicesListResponseDto,
} from './dto/invoices.dto';

@Injectable()
export class EmployerInvoicesService {
  private readonly logger = new Logger(EmployerInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async list(
    employerId: string | null,
    q: InvoicesListQueryDto,
  ): Promise<InvoicesListResponseDto> {
    const eid = this.requireScope(employerId);
    const where: Prisma.InvoiceWhereInput = { employerId: eid };
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lt = new Date(q.to);
      where.issuedAt = range;
    }
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return paginate<InvoiceDto>(rows.map(this.toDto), total, page, pageSize);
  }

  async detail(employerId: string | null, id: string): Promise<InvoiceDto> {
    const eid = this.requireScope(employerId);
    const inv = await this.prisma.invoice.findFirst({
      where: { id, employerId: eid },
    });
    if (!inv) throw new AppError(404, 'NOT_FOUND', 'Invoice not found.');
    return this.toDto(inv);
  }

  async generateBatch(
    actor: { userId: string; employerId: string | null },
    body: GenerateBatchInvoiceDto,
    req: Request,
  ): Promise<InvoiceDto> {
    const eid = this.requireScope(actor.employerId);
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (!(from < to)) {
      throw new AppError(422, 'INVALID_RANGE', '`from` must be earlier than `to`.');
    }

    // Pull all completed jobs in the range that match the optional filters.
    const where: Prisma.JobWhereInput = {
      employerId: eid,
      status: 'completed',
      completedAt: { gte: from, lt: to },
    };
    if (body.jobIds?.length) where.id = { in: body.jobIds };
    if (body.workerIds?.length) where.assignedWorkerId = { in: body.workerIds };

    const jobs = await this.prisma.job.findMany({
      where,
      select: {
        id: true,
        title: true,
        payAmount: true,
        assignedWorkerId: true,
        completedAt: true,
      },
      orderBy: { completedAt: 'asc' },
    });

    if (jobs.length === 0) {
      throw new AppError(
        422,
        'NO_INVOICEABLE_JOBS',
        'No completed jobs match the supplied filters and date range.',
      );
    }

    const workerIds = Array.from(
      new Set(jobs.map((j) => j.assignedWorkerId).filter((id): id is string => !!id)),
    );
    const workers = await this.prisma.worker.findMany({
      where: { id: { in: workerIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(workers.map((w) => [w.id, w.name]));

    const lineItems: InvoiceLineItemDto[] = jobs.map((j) => ({
      jobId: j.id,
      workerName: j.assignedWorkerId ? nameById.get(j.assignedWorkerId) ?? 'Unknown worker' : 'Unassigned',
      jobTitle: j.title,
      amountNaira: j.payAmount,
    }));
    const subtotal = lineItems.reduce((acc, li) => acc + li.amountNaira, 0);

    const id = newId(ID_PREFIXES.invoice);
    const number = `INV-${id.slice(-6).toUpperCase()}`;
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + 14 * 24 * 3600 * 1000);

    const created = await this.prisma.invoice.create({
      data: {
        id,
        employerId: eid,
        number,
        lineItems: lineItems as unknown as Prisma.InputJsonValue,
        subtotalNaira: subtotal,
        totalNaira: subtotal,
        status: InvoiceStatus.Draft,
        issuedAt,
        dueAt,
      },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.invoice_generate_batch',
      entityType: 'invoice',
      entityId: id,
      after: {
        from: body.from,
        to: body.to,
        jobCount: jobs.length,
        totalNaira: subtotal,
        filters: {
          workerIds: body.workerIds ?? null,
          jobIds: body.jobIds ?? null,
        },
      },
      request: req,
    });

    return this.toDto(created);
  }

  async send(
    actor: { userId: string; employerId: string | null },
    id: string,
    req: Request,
  ): Promise<InvoiceDto> {
    const eid = this.requireScope(actor.employerId);
    const inv = await this.prisma.invoice.findFirst({ where: { id, employerId: eid } });
    if (!inv) throw new AppError(404, 'NOT_FOUND', 'Invoice not found.');
    if (inv.status === InvoiceStatus.Paid) {
      throw new AppError(409, 'INVALID_STATE', 'Cannot resend a paid invoice.');
    }

    const employer = await this.prisma.employer.findUnique({
      where: { id: eid },
      select: { businessName: true, invoicingEmail: true },
    });
    if (!employer?.invoicingEmail) {
      throw new AppError(
        422,
        'INVOICING_EMAIL_MISSING',
        'Set an invoicing email under Settings → Billing before sending invoices.',
      );
    }

    // Send via Resend. Body is a summary; PDF attachment is wired in Phase 5.
    void this.email
      .sendInvoice({
        to: employer.invoicingEmail,
        businessName: employer.businessName,
        invoiceNumber: inv.number,
        totalNaira: inv.totalNaira,
        dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
        // Send to the employer (business_owner role drives the URL).
        role: Role.BusinessOwner,
      })
      .catch((err) => this.logger.error(`Invoice email failed: ${err instanceof Error ? err.message : err}`));

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.Sent },
    });

    await this.audit.record({
      actor: { type: 'user', id: actor.userId },
      action: 'employer.invoice_send',
      entityType: 'invoice',
      entityId: id,
      before: { status: inv.status },
      after: { status: InvoiceStatus.Sent, to: employer.invoicingEmail },
      request: req,
    });

    return this.toDto(updated);
  }

  async pdf(employerId: string | null, id: string): Promise<{ pdfUrl: string }> {
    const eid = this.requireScope(employerId);
    const inv = await this.prisma.invoice.findFirst({ where: { id, employerId: eid } });
    if (!inv) throw new AppError(404, 'NOT_FOUND', 'Invoice not found.');
    if (!inv.pdfS3Key) {
      throw new AppError(
        503,
        'PDF_NOT_READY',
        'Invoice PDF is still being prepared. Try again in a moment.',
      );
    }
    // TODO Phase 5: sign the S3 key and return a 302 redirect URL.
    // Until then this branch is unreachable because pdfS3Key is never set.
    return { pdfUrl: inv.pdfS3Key };
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private toDto = (inv: Invoice): InvoiceDto => ({
    id: inv.id,
    number: inv.number,
    employerId: inv.employerId,
    lineItems: (inv.lineItems as unknown as InvoiceLineItemDto[]) ?? [],
    subtotalNaira: inv.subtotalNaira,
    totalNaira: inv.totalNaira,
    status: inv.status as InvoiceStatus,
    issuedAt: inv.issuedAt.toISOString(),
    dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
    paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
    pdfUrl: null,
  });
}
