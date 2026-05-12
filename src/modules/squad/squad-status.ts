/**
 * Squad → internal transaction-status translation. Shared by the webhook
 * receiver and the reconciliation cron so a webhook-driven update and a
 * polled update converge to the same final state.
 */
export interface ClassifiedOutcome {
  /** Coarse event family. `transfer` covers outbound transfers + top-up
   *  checkouts (anything keyed off our own `Transaction.squadReference`).
   *  `va_credit` is an INCOMING credit to a Forge-owned virtual account
   *  triggered by an external party paying that NUBAN — those events don't
   *  have a pre-existing Transaction row. */
  kind: 'transfer' | 'va_credit';
  /** Mirror of `Transaction.status` after applying. */
  dbStatus: 'completed' | 'failed' | 'reversed' | 'processing';
  /** Whether `Transaction.settledAt` should be stamped now. */
  terminal: boolean;
  /** Surfaced into `Transaction.failureReason` when applicable. */
  failureReason?: string;
}

export function classifySquadOutcome(
  eventName: string,
  status: string,
): ClassifiedOutcome | null {
  const e = eventName.toLowerCase();
  const s = status.toLowerCase();
  // Virtual-account funding: an external bank transfer landed in a NUBAN we own.
  // Squad's documented event name is `virtual_account.funding` / `virtual_account_funding`
  // (the exact string needs sandbox verification; we accept several variants).
  if (
    e.includes('virtual_account.funding') ||
    e.includes('virtual_account_funding') ||
    e.includes('virtualaccount.credit') ||
    e.includes('virtual_account.credit')
  ) {
    return { kind: 'va_credit', dbStatus: 'completed', terminal: true };
  }
  if (e.includes('transfer.success') || s === 'success' || s === 'successful') {
    return { kind: 'transfer', dbStatus: 'completed', terminal: true };
  }
  if (
    e.includes('transaction.successful') &&
    (s === 'success' || s === 'successful')
  ) {
    return { kind: 'transfer', dbStatus: 'completed', terminal: true };
  }
  if (e.includes('failed') || s === 'failed') {
    return {
      kind: 'transfer',
      dbStatus: 'failed',
      terminal: true,
      failureReason: `Squad reported ${eventName || status}`,
    };
  }
  if (e.includes('reversed') || s === 'reversed') {
    return {
      kind: 'transfer',
      dbStatus: 'reversed',
      terminal: true,
      failureReason: 'Squad reversed the transfer.',
    };
  }
  if (s === 'processing' || s === 'pending') {
    return { kind: 'transfer', dbStatus: 'processing', terminal: false };
  }
  return null;
}
