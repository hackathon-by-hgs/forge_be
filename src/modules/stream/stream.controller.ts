import { Controller, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, interval, merge, map } from 'rxjs';
import { JwtUserAuthGuard } from '../../common/guards/jwt-user-auth.guard';
import {
  AuthedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AppError } from '../../common/utils/app-error';
import { StreamEvent, StreamPublisher, StreamScope } from './stream.publisher';

const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Server-Sent Events stream for the dashboards (employer + bank). One
 * persistent connection per browser tab, scoped to the caller's tenant via
 * their JWT (`employerId` for business users, `bankId` for bank users).
 *
 * Each event arrives on the wire as:
 *
 *     event: <name>
 *     id: <iso-timestamp>
 *     data: {"event":"<name>", "ts":"...", "data":{...}}
 *
 * The FE consumes with EventSource and switches on `event.event` to
 * invalidate the right React Query keys.
 */
@ApiTags('Stream')
@Controller('stream')
@UseGuards(JwtUserAuthGuard)
@ApiBearerAuth('bearer-user')
export class StreamController {
  constructor(private readonly publisher: StreamPublisher) {}

  @Sse()
  @ApiOperation({
    summary: 'Server-Sent Events stream (employer + bank dashboards).',
    description: [
      '**Audience:** Dashboard users (`business_*`, `bank_*`).',
      '',
      '**Powers:** Real-time invalidation hints for Risk Radar, active-map, ',
      'and credit/payments surfaces. Replaces tab-focus polling.',
      '',
      "**Scoping:** Each connection is filtered to the caller's tenant — ",
      'employer users see `job.lifecycle_changed`, `worker.clock_event`, ',
      '`transaction.updated`, `score.recomputed`; bank users see ',
      '`loan.disbursed`, `loan.repayment_paid`, `loan.risk_changed`, ',
      '`application.decided`. `heartbeat` is broadcast to every connection ',
      "every 25 s so reverse proxies don't close idle sockets.",
      '',
      '**Failure semantics:** This is a hint stream, not a source of truth. ',
      'On reconnect the FE should refetch the affected queries — events ',
      'missed during the disconnect are NOT replayed.',
    ].join('\n'),
  })
  stream(
    @CurrentUser() user: AuthedUser,
  ): Observable<{ data: object; type: string; id: string }> {
    const scope = this.resolveScope(user);

    const data$ = this.publisher.forScope(scope);
    const heartbeat$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map<number, StreamEvent>(() => ({
        scope: { kind: 'broadcast' },
        event: 'heartbeat',
        data: {},
        ts: new Date().toISOString(),
      })),
    );

    return merge(data$, heartbeat$).pipe(
      map((evt) => ({
        type: evt.event,
        id: evt.ts,
        data: { event: evt.event, ts: evt.ts, data: evt.data },
      })),
    );
  }

  private resolveScope(user: AuthedUser): StreamScope {
    if (user.employerId) return { kind: 'employer', id: user.employerId };
    if (user.bankId) return { kind: 'bank', id: user.bankId };
    throw new AppError(
      403,
      'NO_TENANT_SCOPE',
      'This account is not bound to a business or bank — nothing to stream.',
    );
  }
}
