import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/utils/app-error';
import { DashboardJobTypeEnum } from '../employer-jobs/dto/job.dto';
import { mapJobTypeToDashboard } from '../employer-jobs/employer-jobs.mapper';
import {
  AnalyticsRange,
  AnalyticsRangeQueryDto,
  AnalyticsWindowDto,
  CostByJobTypePointDto,
  CostByJobTypeResponseDto,
  DemandHeatmapCellDto,
  DemandHeatmapResponseDto,
  LaborCostPointDto,
  LaborCostTrendResponseDto,
  RoiByTypeItemDto,
  RoiByTypeResponseDto,
  TimeToFillPointDto,
  TimeToFillResponseDto,
  WorkerUtilizationItemDto,
  WorkerUtilizationResponseDto,
} from './dto/analytics.dto';

const DEFAULT_WINDOW_DAYS = 30;

const JOB_TYPE_LABELS: Record<DashboardJobTypeEnum, string> = {
  [DashboardJobTypeEnum.Loader]: 'Loader',
  [DashboardJobTypeEnum.Driver]: 'Driver',
  [DashboardJobTypeEnum.Unloader]: 'Unloader',
  [DashboardJobTypeEnum.General]: 'General',
};

@Injectable()
export class EmployerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── /labor-cost-trend ───────────────────────────────────────────────────
  async laborCostTrend(
    employerId: string | null,
    q: AnalyticsRangeQueryDto,
  ): Promise<LaborCostTrendResponseDto> {
    const eid = this.requireScope(employerId);
    const window = resolveWindow(q, this.rangeToDays(q.range));

    const transactions = await this.prisma.transaction.findMany({
      where: {
        employerId: eid,
        kind: 'job_payment',
        status: { in: ['succeeded', 'completed'] },
        timestamp: { gte: window.from, lt: window.to },
      },
      select: { amount: true, timestamp: true },
    });

    const days = enumerateDays(window.from, window.to);
    const totals = new Map<string, number>();
    for (const d of days) totals.set(d, 0);
    for (const t of transactions) {
      const key = toUtcDateKey(t.timestamp);
      if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }

    const data: LaborCostPointDto[] = days.map((d) => ({ date: d, costNaira: totals.get(d) ?? 0 }));
    return { data, window: windowToDto(window) };
  }

  // ── /cost-by-job-type ───────────────────────────────────────────────────
  async costByJobType(
    employerId: string | null,
    q: AnalyticsRangeQueryDto,
  ): Promise<CostByJobTypeResponseDto> {
    const eid = this.requireScope(employerId);
    const window = resolveWindow(q);

    // Pull job-payment transactions in the window, join through `relatedJobId`
    // to get the `Job.type`. We could do this in raw SQL for big workloads,
    // but in-memory rollup is cheap at the current scale.
    const transactions = await this.prisma.transaction.findMany({
      where: {
        employerId: eid,
        kind: 'job_payment',
        status: { in: ['succeeded', 'completed'] },
        timestamp: { gte: window.from, lt: window.to },
        relatedJobId: { not: null },
      },
      select: { amount: true, relatedJobId: true },
    });

    const jobIds = Array.from(new Set(transactions.map((t) => t.relatedJobId!).filter(Boolean)));
    const jobs = jobIds.length
      ? await this.prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, type: true },
        })
      : [];
    const typeByJob = new Map(jobs.map((j) => [j.id, mapJobTypeToDashboard(j.type)]));

    const totals = new Map<DashboardJobTypeEnum, number>();
    let grandTotal = 0;
    for (const t of transactions) {
      const type = typeByJob.get(t.relatedJobId ?? '') ?? DashboardJobTypeEnum.General;
      totals.set(type, (totals.get(type) ?? 0) + t.amount);
      grandTotal += t.amount;
    }

    const data: CostByJobTypePointDto[] = Array.from(totals.entries())
      .map(([type, valueNaira]) => ({
        type,
        label: JOB_TYPE_LABELS[type],
        valueNaira,
        share: grandTotal > 0 ? round3(valueNaira / grandTotal) : 0,
      }))
      .sort((a, b) => b.valueNaira - a.valueNaira);

    return { data, window: windowToDto(window) };
  }

  // ── /worker-utilization ─────────────────────────────────────────────────
  async workerUtilization(
    employerId: string | null,
    q: AnalyticsRangeQueryDto,
  ): Promise<WorkerUtilizationResponseDto> {
    const eid = this.requireScope(employerId);
    const window = resolveWindow(q);

    const apps = await this.prisma.jobApplication.findMany({
      where: {
        status: 'completed',
        completedAt: { gte: window.from, lt: window.to },
        job: { employerId: eid },
      },
      select: { workerId: true, job: { select: { payAmount: true } } },
    });

    const buckets = new Map<string, { jobs: number; earnedNaira: number }>();
    for (const a of apps) {
      const cur = buckets.get(a.workerId) ?? { jobs: 0, earnedNaira: 0 };
      cur.jobs += 1;
      cur.earnedNaira += a.job.payAmount;
      buckets.set(a.workerId, cur);
    }

    const topIds = Array.from(buckets.entries())
      .sort((a, b) => b[1].jobs - a[1].jobs || b[1].earnedNaira - a[1].earnedNaira)
      .slice(0, 8)
      .map(([id]) => id);

    if (topIds.length === 0) return { data: [], window: windowToDto(window) };

    const workers = await this.prisma.worker.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(workers.map((w) => [w.id, w.name]));

    const data: WorkerUtilizationItemDto[] = topIds.map((id) => {
      const stats = buckets.get(id)!;
      return {
        workerId: id,
        name: nameById.get(id) ?? 'Unknown',
        jobs: stats.jobs,
        earnedNaira: stats.earnedNaira,
      };
    });

    return { data, window: windowToDto(window) };
  }

  // ── /time-to-fill ───────────────────────────────────────────────────────
  async timeToFill(
    employerId: string | null,
    q: AnalyticsRangeQueryDto,
  ): Promise<TimeToFillResponseDto> {
    const eid = this.requireScope(employerId);
    const window = resolveWindow(q);

    // For each job posted in the window, find the first application timestamp.
    const jobs = await this.prisma.job.findMany({
      where: {
        employerId: eid,
        deletedAt: null,
        createdAt: { gte: window.from, lt: window.to },
      },
      select: {
        id: true,
        createdAt: true,
        applications: {
          orderBy: { appliedAt: 'asc' },
          take: 1,
          select: { appliedAt: true },
        },
      },
    });

    const weekly = new Map<string, { total: number; jobs: number }>();
    for (const j of jobs) {
      const first = j.applications[0]?.appliedAt;
      if (!first) continue; // job not filled within the window — exclude
      const minutes = Math.max(0, Math.round((first.getTime() - j.createdAt.getTime()) / 60_000));
      const weekKey = toUtcWeekStart(j.createdAt);
      const cur = weekly.get(weekKey) ?? { total: 0, jobs: 0 };
      cur.total += minutes;
      cur.jobs += 1;
      weekly.set(weekKey, cur);
    }

    const weeks = enumerateWeeks(window.from, window.to);
    const data: TimeToFillPointDto[] = weeks.map((w) => {
      const stats = weekly.get(w);
      return {
        weekStartDate: w,
        averageMinutes: stats && stats.jobs > 0 ? Math.round(stats.total / stats.jobs) : 0,
        jobs: stats?.jobs ?? 0,
      };
    });

    return { data, window: windowToDto(window) };
  }

  // ── /demand-heatmap ─────────────────────────────────────────────────────
  async demandHeatmap(
    employerId: string | null,
    q: AnalyticsRangeQueryDto,
  ): Promise<DemandHeatmapResponseDto> {
    const eid = this.requireScope(employerId);
    const window = resolveWindow(q);

    const jobs = await this.prisma.job.findMany({
      where: {
        employerId: eid,
        deletedAt: null,
        startTime: { gte: window.from, lt: window.to },
      },
      select: { startTime: true },
    });

    // Bucket jobs by their scheduled start (the demand signal — when work actually happens).
    const cells = new Map<string, DemandHeatmapCellDto>();
    for (const j of jobs) {
      const dow = j.startTime.getUTCDay();
      const hour = j.startTime.getUTCHours();
      const key = `${dow}-${hour}`;
      const cur = cells.get(key);
      if (cur) cur.jobs += 1;
      else cells.set(key, { dayOfWeek: dow, hour, jobs: 1 });
    }

    const data = Array.from(cells.values()).sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour,
    );
    return { data, window: windowToDto(window) };
  }

  // ── /roi-by-type ────────────────────────────────────────────────────────
  async roiByType(
    employerId: string | null,
    q: AnalyticsRangeQueryDto,
  ): Promise<RoiByTypeResponseDto> {
    const eid = this.requireScope(employerId);
    const window = resolveWindow(q);

    const jobs = await this.prisma.job.findMany({
      where: {
        employerId: eid,
        deletedAt: null,
        createdAt: { gte: window.from, lt: window.to },
      },
      select: {
        type: true,
        status: true,
        payAmount: true,
        createdAt: true,
        applications: { orderBy: { appliedAt: 'asc' }, take: 1, select: { appliedAt: true } },
      },
    });

    type Agg = {
      jobs: number;
      completed: number;
      costTotal: number;
      fillTimeTotal: number;
      fillTimeCount: number;
    };
    const byType = new Map<DashboardJobTypeEnum, Agg>();
    for (const j of jobs) {
      const type = mapJobTypeToDashboard(j.type);
      const agg = byType.get(type) ?? { jobs: 0, completed: 0, costTotal: 0, fillTimeTotal: 0, fillTimeCount: 0 };
      agg.jobs += 1;
      if (j.status === 'completed') {
        agg.completed += 1;
        agg.costTotal += j.payAmount;
      }
      const first = j.applications[0]?.appliedAt;
      if (first) {
        agg.fillTimeTotal += Math.max(0, (first.getTime() - j.createdAt.getTime()) / 60_000);
        agg.fillTimeCount += 1;
      }
      byType.set(type, agg);
    }

    const data: RoiByTypeItemDto[] = Array.from(byType.entries())
      .map(([type, agg]) => ({
        type,
        label: JOB_TYPE_LABELS[type],
        jobs: agg.jobs,
        avgCostNaira: agg.completed > 0 ? Math.round(agg.costTotal / agg.completed) : 0,
        avgFillTimeMinutes: agg.fillTimeCount > 0 ? Math.round(agg.fillTimeTotal / agg.fillTimeCount) : 0,
        completionRate: agg.jobs > 0 ? round3(agg.completed / agg.jobs) : 0,
      }))
      .sort((a, b) => b.jobs - a.jobs);

    return { data, window: windowToDto(window) };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private requireScope(employerId: string | null): string {
    if (!employerId) {
      throw new AppError(403, 'NO_EMPLOYER_SCOPE', 'This account is not bound to a business.');
    }
    return employerId;
  }

  private rangeToDays(range: AnalyticsRange | undefined): number {
    switch (range) {
      case AnalyticsRange.Days7: return 7;
      case AnalyticsRange.Days30: return 30;
      case AnalyticsRange.Days90: return 90;
      default: return DEFAULT_WINDOW_DAYS;
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

interface Window {
  from: Date;
  to: Date;
}

function resolveWindow(q: AnalyticsRangeQueryDto, defaultDays = DEFAULT_WINDOW_DAYS): Window {
  if (q.from && q.to) {
    return { from: new Date(q.from), to: new Date(q.to) };
  }
  if (q.from) {
    return { from: new Date(q.from), to: new Date() };
  }
  if (q.to) {
    const to = new Date(q.to);
    return { from: new Date(to.getTime() - defaultDays * 86_400_000), to };
  }
  const to = startOfUtcDayAfter(new Date());
  const from = new Date(to.getTime() - defaultDays * 86_400_000);
  return { from, to };
}

function windowToDto(w: Window): AnalyticsWindowDto {
  return { from: w.from.toISOString(), to: w.to.toISOString() };
}

function toUtcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcDayAfter(d: Date): Date {
  return new Date(startOfUtcDay(d).getTime() + 86_400_000);
}

function enumerateDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

function toUtcWeekStart(d: Date): string {
  // ISO weeks start Monday. Snap to the Monday of the UTC date.
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0 = Sunday
  const offsetDays = (dow + 6) % 7;
  return new Date(day.getTime() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function enumerateWeeks(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = new Date(toUtcWeekStart(from));
  const end = new Date(toUtcWeekStart(to));
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 7 * 86_400_000);
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
