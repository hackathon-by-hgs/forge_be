import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';

/**
 * Tenant scope a published event applies to. Each connected SSE subscriber
 * declares its own scope (derived from JWT) and only sees events whose scope
 * matches or that are broadcast.
 */
export type StreamScope =
  | { kind: 'employer'; id: string }
  | { kind: 'bank'; id: string }
  | { kind: 'broadcast' };

/**
 * Compact event name. Each value names a specific surface signal so the FE
 * can map name → React Query key invalidation without parsing the payload.
 *
 * Phase 4 set:
 *   - `loan.disbursed` | `loan.repayment_paid` | `loan.risk_changed`
 *       → bank scope; FE invalidates `['bank','risk-radar']` + `['bank','loans']`.
 *   - `application.decided`
 *       → bank scope; FE invalidates `['bank','loan-applications']`.
 *   - `job.lifecycle_changed` | `worker.clock_event`
 *       → employer scope; FE invalidates active-map / job-detail queries.
 *   - `transaction.updated`
 *       → employer scope; FE invalidates payouts / transactions / overview.
 *   - `score.recomputed`
 *       → employer scope; FE invalidates `['employer','credit']`.
 *   - `heartbeat`
 *       → broadcast every 25s so proxies don't close idle connections.
 */
export type StreamEventName =
  | 'loan.disbursed'
  | 'loan.repayment_paid'
  | 'loan.risk_changed'
  | 'application.decided'
  | 'job.lifecycle_changed'
  | 'worker.clock_event'
  | 'transaction.updated'
  | 'score.recomputed'
  | 'heartbeat';

export interface StreamEvent {
  scope: StreamScope;
  event: StreamEventName;
  data: Record<string, unknown>;
  ts: string;
}

/**
 * In-process pub/sub for SSE. Single Subject, fan-out to N concurrent
 * connections (currently — single-instance Railway deploy, no Redis needed).
 * If we move to multi-instance, swap this implementation for a Redis pub/sub
 * fan-out keyed off the same `StreamEvent` shape; controllers don't change.
 */
@Injectable()
export class StreamPublisher {
  private readonly logger = new Logger(StreamPublisher.name);
  private readonly subject = new Subject<StreamEvent>();

  publish(event: Omit<StreamEvent, 'ts'>): void {
    const enriched: StreamEvent = { ...event, ts: new Date().toISOString() };
    this.subject.next(enriched);
  }

  /**
   * Stream filtered to a single tenant scope. Broadcast events are always
   * included. The returned Observable is hot (one emission → all subscribers).
   */
  forScope(scope: StreamScope): Observable<StreamEvent> {
    return this.subject.asObservable().pipe(
      filter((evt) => scopeMatches(evt.scope, scope)),
      map((evt) => evt),
    );
  }
}

function scopeMatches(
  eventScope: StreamScope,
  subscriberScope: StreamScope,
): boolean {
  if (eventScope.kind === 'broadcast') return true;
  if (subscriberScope.kind === 'broadcast') return false;
  return (
    eventScope.kind === subscriberScope.kind &&
    eventScope.id === subscriberScope.id
  );
}
