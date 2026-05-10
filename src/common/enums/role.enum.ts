/**
 * Dashboard user roles. The `worker` role exists for completeness with
 * BACKEND_BRIEF §5 but workers don't actually log into the dashboard —
 * they authenticate via OTP into the mobile app and own a `Worker` row,
 * not a `User` row.
 */
export enum Role {
  Worker = 'worker',
  BusinessOwner = 'business_owner',
  BusinessAdmin = 'business_admin',
  BusinessHiringManager = 'business_hiring_manager',
  BankCreditOfficer = 'bank_credit_officer',
  BankRiskAnalyst = 'bank_risk_analyst',
  PlatformAdmin = 'platform_admin',
}

export const EMPLOYER_ROLES: Role[] = [
  Role.BusinessOwner,
  Role.BusinessAdmin,
  Role.BusinessHiringManager,
];

export const BANK_ROLES: Role[] = [
  Role.BankCreditOfficer,
  Role.BankRiskAnalyst,
];

/**
 * Capability map. Tighten as features land.
 * "*" = scope-all (still gated by tenant scoping at the data layer).
 */
export const CAPABILITIES: Record<Role, ReadonlySet<string>> = {
  [Role.Worker]: new Set(['mobile.*']),
  [Role.BusinessOwner]: new Set(['employer.*']),
  [Role.BusinessAdmin]: new Set([
    'employer.read',
    'employer.write',
    'employer.team.read',
    'employer.team.write',
    'employer.jobs.*',
    'employer.workers.*',
    'employer.payments.*',
    'employer.analytics.*',
    'employer.credit.*',
    'employer.notifications.*',
  ]),
  [Role.BusinessHiringManager]: new Set([
    'employer.jobs.*',
    'employer.workers.*',
    'employer.payments.read',
    'employer.analytics.read',
  ]),
  [Role.BankCreditOfficer]: new Set(['bank.*']),
  [Role.BankRiskAnalyst]: new Set(['bank.read']),
  [Role.PlatformAdmin]: new Set(['*']),
};
