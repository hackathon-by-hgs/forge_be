/**
 * Forge seed — mirrors `forge_fe/packages/mock-data` byte-for-byte where possible
 * so a developer can copy IDs from the frontend mock layer and find them in the DB.
 *
 * Volumes: 50 workers, 20 employers, 220 jobs, 40 loans, 30 loan applications, 3 banks.
 *
 * RNG seeds match the frontend (`0xc0ffee` workers, `0xface` employers, `0xbeef` jobs,
 * `0xdead` transactions, `0xbada55` loans, `0xfade` loan applications) for that
 * cross-tool determinism.
 *
 * Idempotent: every run truncates first.
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { addHours, addMonths, formatISO, subDays, subHours, subMonths } from 'date-fns';

/**
 * Deterministic stub virtual-account values. Mirrors the math in
 * `SquadClient.createVirtualAccount` stub mode so the seed produces the same
 * NUBANs the runtime provisioner would. Lets demo logins land on a populated
 * `virtualAccount` field without waiting for the lazy-retry on first /overview.
 */
function stubVirtualAccount(customerId: string, displayName: string): {
  squadWalletId: string;
  squadVirtualAccountNumber: string;
  squadVirtualAccountBankCode: string;
  squadVirtualAccountName: string;
} {
  const hash = createHash('sha1').update(customerId).digest('hex').slice(0, 8);
  const nuban =
    '99' +
    hash.replace(/[a-f]/gi, (c) => String(c.charCodeAt(0) % 10));
  return {
    squadWalletId: `va_stub_${customerId}`,
    squadVirtualAccountNumber: nuban,
    squadVirtualAccountBankCode: '999',
    squadVirtualAccountName: `Forge Test ${displayName}`.slice(0, 40),
  };
}

// ─── RNG (mulberry32, identical to forge_fe/packages/mock-data/src/rng.ts) ───

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick: empty array');
  return arr[Math.floor(rng() * arr.length)] as T;
}

function range(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function rangeFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Adeolu', 'Tunde', 'Chinwe', 'Emeka', 'Aisha', 'Hauwa', 'Ifeoma', 'Bola', 'Yetunde', 'Olumide',
  'Ngozi', 'Kemi', 'Femi', 'Bisi', 'Funmi', 'Dapo', 'Sade', 'Lanre', 'Wale', 'Nkechi',
  'Tobi', 'Seun', 'Chidi', 'Uche', 'Musa', 'Ibrahim', 'Yusuf', 'Folake', 'Tope', 'Bukola',
  'Joshua', 'Mary', 'Ruth', 'David', 'Daniel', 'Esther', 'Grace', 'Samuel', 'Joy', 'Faith',
] as const;

const LAST_NAMES = [
  'Adeyemi', 'Okafor', 'Bello', 'Eze', 'Okonkwo', 'Adebayo', 'Ojo', 'Ibrahim', 'Yusuf', 'Aliyu',
  'Olawale', 'Akande', 'Nwosu', 'Onyeka', 'Sanusi', 'Ogun', 'Adesina', 'Igbinedion', 'Babatunde',
  'Okeke', 'Achebe', 'Olusoji', 'Ojuolape', 'Adeniyi', 'Anyanwu', 'Oseni', 'Sulaimon',
] as const;

const BUSINESS_PREFIXES = [
  'Apapa', 'Lekki', 'Lagos', 'Trade', 'Market', 'Ocean', 'Rapid', 'Premier', 'Kingpin', 'Greenline',
  'Eko', 'Crown', 'Sunrise', 'Pioneer', 'Continental',
] as const;

const BUSINESS_SUFFIXES = [
  'Wholesale', 'Trading Co.', 'Logistics', 'Distribution', 'Industries', 'Foods', 'Mills',
  'Imports', 'Stores', 'Mart', 'Supplies', 'Hub',
] as const;

type Neighborhood =
  | 'Apapa' | 'Lekki' | 'Victoria Island' | 'Ikeja' | 'Mile 2' | 'Surulere'
  | 'Yaba' | 'Ikoyi' | 'Ajah' | 'Festac' | 'Oshodi';

const NEIGHBORHOOD_COORDS: Record<Neighborhood, { lat: number; lng: number }> = {
  Apapa: { lat: 6.4458, lng: 3.3608 },
  Lekki: { lat: 6.4474, lng: 3.5006 },
  'Victoria Island': { lat: 6.4281, lng: 3.4216 },
  Ikeja: { lat: 6.6018, lng: 3.3515 },
  'Mile 2': { lat: 6.4581, lng: 3.3199 },
  Surulere: { lat: 6.4983, lng: 3.3614 },
  Yaba: { lat: 6.5075, lng: 3.3787 },
  Ikoyi: { lat: 6.4503, lng: 3.4359 },
  Ajah: { lat: 6.4677, lng: 3.6045 },
  Festac: { lat: 6.4647, lng: 3.2849 },
  Oshodi: { lat: 6.5559, lng: 3.3491 },
};

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_COORDS) as Neighborhood[];

// Worker mobile uses capitalised PrimarySkill, lowercase JobType. Frontend dashboard
// uses bare lowercase `loader|driver|unloader|general`. We store worker-mobile values
// in the DB; dashboard mappers translate. See DECISIONS.md.
const WORKER_SKILLS = ['Loader', 'Driver', 'Unloader', 'General Labor'] as const;
const JOB_TYPES = ['loader', 'driver', 'unloader', 'general_labor'] as const;
const SKILL_TO_TYPE: Record<typeof WORKER_SKILLS[number], typeof JOB_TYPES[number]> = {
  Loader: 'loader',
  Driver: 'driver',
  Unloader: 'unloader',
  'General Labor': 'general_labor',
};

const TITLE_BY_TYPE: Record<typeof JOB_TYPES[number], readonly string[]> = {
  loader: ['Container loaders needed at warehouse', 'Truck loaders, 4 hrs', 'Cargo loaders'],
  driver: ['Delivery driver, light truck', 'Driver — Apapa to VI', 'Local distribution driver'],
  unloader: ['Unloaders for inbound shipment', 'Discharge crew, evening shift'],
  general_labor: ['General hands needed', 'Stocking and inventory help', 'Event setup crew'],
};

// Job-status distribution mirrors the frontend's `jobs.ts`.
const JOB_STATUS_DISTRIBUTION = [
  'open', 'open', 'open',
  'applications_in', 'applications_in',
  'accepted', 'accepted',
  'in_progress', 'in_progress', 'in_progress',
  'pending_verification',
  'completed', 'completed', 'completed', 'completed', 'completed',
  'draft',
  'cancelled',
] as const;

const TX_STATUS_DISTRIBUTION = [
  'succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded',
  'pending', 'processing', 'failed',
] as const;

const LOAN_STATUS_DIST = [
  'active', 'active', 'active', 'active', 'active', 'active', 'active',
  'at_risk', 'at_risk',
  'repaid', 'repaid',
  'defaulted',
] as const;

// ─── Prisma client (Prisma 7 — pg adapter) ──────────────────────────────────

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// ─── Helpers ────────────────────────────────────────────────────────────────

const wkrId = (i: number) => `wkr_${String(i).padStart(4, '0')}`;
const empId = (i: number) => `emp_${String(i).padStart(4, '0')}`;
const jobId = (i: number) => `job_${String(i).padStart(5, '0')}`;
const loanId = (i: number) => `loan_${String(i).padStart(4, '0')}`;
const lapId = (i: number) => `lap_${String(i).padStart(4, '0')}`;
const txnId = (i: number) => `txn_${String(i).padStart(6, '0')}`;
const appId = (i: number) => `app_${String(i).padStart(6, '0')}`;
const sesId = (i: number) => `ses_${String(i).padStart(6, '0')}`;
const cevId = (i: number) => `cev_${String(i).padStart(6, '0')}`;
const prfId = (i: number) => `prf_${String(i).padStart(5, '0')}`;
const jevId = (i: number) => `jev_${String(i).padStart(7, '0')}`;
const revId = (i: number) => `rev_${String(i).padStart(5, '0')}`;
const repId = (i: number) => `rep_${String(i).padStart(6, '0')}`;
const ntfId = (i: number) => `ntf_${String(i).padStart(5, '0')}`;
const unotId = (i: number) => `unot_${String(i).padStart(5, '0')}`;
const usrId = (i: number) => `usr_${String(i).padStart(4, '0')}`;
const invId = (i: number) => `inv_${String(i).padStart(5, '0')}`;
const baId = (i: number) => `ba_${String(i).padStart(5, '0')}`;

// Derive a stable phone with leading +234-80-XXXXXXXX
function phone(i: number): string {
  const tail = String(10000000 + (i * 9301 + 49297) % 89999999).padStart(8, '0');
  return `+23480${tail}`;
}

// ─── Truncation (idempotency) ───────────────────────────────────────────────

async function truncate() {
  console.log('• truncating');
  // Order matters: children before parents.
  await prisma.auditEvent.deleteMany({});
  await prisma.jobRun.deleteMany({});
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.userNotification.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.userRefreshToken.deleteMany({});
  await prisma.emailToken.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.otpChallenge.deleteMany({});
  await prisma.teamInvitation.deleteMany({});
  await prisma.employerBlock.deleteMany({});
  await prisma.employerTeamMember.deleteMany({});
  await prisma.review.deleteMany({});
  await prisma.photoProof.deleteMany({});
  await prisma.clockEvent.deleteMany({});
  await prisma.jobEvent.deleteMany({});
  await prisma.workSession.deleteMany({});
  await prisma.jobApplication.deleteMany({});
  await prisma.loanRepayment.deleteMany({});
  await prisma.loanApplication.deleteMany({});
  await prisma.loan.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.payout.deleteMany({});
  await prisma.upload.deleteMany({});
  await prisma.deviceToken.deleteMany({});
  await prisma.preference.deleteMany({});
  await prisma.supportTicket.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.employer.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.bank.deleteMany({});
  await prisma.nibssBank.deleteMany({});
  await prisma.helpArticle.deleteMany({});
}

// ─── Seeders ────────────────────────────────────────────────────────────────

async function seedNibssBanks() {
  console.log('• nibss banks');
  await prisma.nibssBank.createMany({
    data: [
      { code: '058', name: 'GTBank' },
      { code: '044', name: 'Access Bank' },
      { code: '057', name: 'Zenith Bank' },
      { code: '011', name: 'First Bank' },
      { code: '033', name: 'United Bank for Africa' },
      { code: '232', name: 'Sterling Bank' },
      { code: '076', name: 'Polaris Bank' },
      { code: '050', name: 'Ecobank Nigeria' },
      { code: '999058', name: 'Kuda' },
      { code: '999017', name: 'Wema Bank' },
    ],
  });
}

async function seedLenderBanks() {
  console.log('• lender banks');
  await prisma.bank.createMany({
    data: [
      {
        id: 'bnk_gtbank',
        name: 'GTBank',
        primaryColor: '#10B981',
        totalActiveLoans: 26,
        totalDisbursedNaira: 18_500_000,
        repaymentRate: 0.94,
        defaultRate: 0.04,
      },
      {
        id: 'bnk_kuda',
        name: 'Kuda',
        primaryColor: '#7C3AED',
        totalActiveLoans: 14,
        totalDisbursedNaira: 6_200_000,
        repaymentRate: 0.91,
        defaultRate: 0.06,
      },
      {
        id: 'bnk_sterling',
        name: 'Sterling',
        primaryColor: '#0EA5E9',
        totalActiveLoans: 9,
        totalDisbursedNaira: 4_800_000,
        repaymentRate: 0.92,
        defaultRate: 0.05,
      },
    ],
  });
}

async function seedEmployers() {
  console.log('• employers (20)');
  const rng = createRng(0xface);
  const types = ['wholesaler', 'factory', 'retailer', 'logistics'];
  const rows: Prisma.EmployerCreateManyInput[] = [];
  for (let i = 0; i < 20; i += 1) {
    const neighborhood = pick(rng, NEIGHBORHOODS);
    const coords = NEIGHBORHOOD_COORDS[neighborhood];
    const name = `${pick(rng, BUSINESS_PREFIXES)} ${pick(rng, BUSINESS_SUFFIXES)}`;
    const id = empId(i + 1);
    const va = stubVirtualAccount(id, name);
    rows.push({
      id,
      businessName: name,
      type: pick(rng, types),
      registeredLat: coords.lat + rangeFloat(rng, -0.005, 0.005),
      registeredLng: coords.lng + rangeFloat(rng, -0.005, 0.005),
      registeredNeighborhood: neighborhood,
      registeredAddress: `${range(rng, 1, 220)} ${neighborhood} Road, Lagos`,
      joinedAt: subMonths(new Date(), range(rng, 2, 22)),
      photoUrl: null,
      rating: rangeFloat(rng, 4.1, 4.9),
      phoneNumber: `+23490${range(rng, 10000000, 99999999)}`,
      creditScore: range(rng, 55, 92),
      totalLaborSpendNaira: range(rng, 800_000, 12_000_000),
      workersHired: range(rng, 25, 280),
      jobsPosted: range(rng, 30, 400),
      paymentTimelinessRate: rangeFloat(rng, 0.85, 0.99),
      walletBalanceNaira: range(rng, 200_000, 2_500_000),
      squadWalletId: va.squadWalletId,
      squadVirtualAccountNumber: va.squadVirtualAccountNumber,
      squadVirtualAccountBankCode: va.squadVirtualAccountBankCode,
      squadVirtualAccountName: va.squadVirtualAccountName,
      invoicingEmail: `${name.toLowerCase().replace(/[^a-z]/g, '')}.billing@example.ng`,
    });
  }
  await prisma.employer.createMany({ data: rows });
}

async function seedWorkers() {
  console.log('• workers (50)');
  const rng = createRng(0xc0ffee);
  const rows: Prisma.WorkerCreateManyInput[] = [];
  for (let i = 0; i < 50; i += 1) {
    const firstName = pick(rng, FIRST_NAMES);
    const lastName = pick(rng, LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const neighborhood = pick(rng, NEIGHBORHOODS);
    const coords = NEIGHBORHOOD_COORDS[neighborhood];
    const score = range(rng, 35, 95);
    const jobsCompleted = range(rng, 4, 220);
    const onTimeRate = rangeFloat(rng, 0.78, 0.99);
    const avgWeekly = range(rng, 8000, 35000);
    const totalEarned = avgWeekly * range(rng, 8, 32);
    const monthsAgo = range(rng, 1, 11);
    const eligibility = score >= 80 ? 'pre_approved' : score >= 70 ? 'eligible' : 'ineligible';
    const skill = pick(rng, WORKER_SKILLS);
    const id = wkrId(i + 1);
    const va = stubVirtualAccount(id, fullName);
    rows.push({
      id,
      name: fullName,
      phoneNumber: phone(i + 1),
      photoUrl: null,
      primarySkill: skill,
      preferredRadiusKm: rangeFloat(rng, 4, 12),
      walletBalance: range(rng, 0, 60_000),
      totalEarned,
      jobsCompleted,
      reliabilityScore: score,
      averageRating: rangeFloat(rng, 3.8, 4.9),
      creditScore: score,
      joinedAt: subMonths(new Date(), monthsAgo),
      homeLat: coords.lat + rangeFloat(rng, -0.01, 0.01),
      homeLng: coords.lng + rangeFloat(rng, -0.01, 0.01),
      homeNeighborhood: neighborhood,
      homeAddress: `${range(rng, 1, 220)} ${neighborhood} Cres, Lagos`,
      onTimeRate,
      incomeVolatilityPct: rangeFloat(rng, 0.05, 0.25),
      averageWeeklyIncomeNaira: avgWeekly,
      eligibility,
      squadWalletId: va.squadWalletId,
      squadVirtualAccountNumber: va.squadVirtualAccountNumber,
      squadVirtualAccountBankCode: va.squadVirtualAccountBankCode,
      squadVirtualAccountName: va.squadVirtualAccountName,
    });
  }
  // Story-graduate the first 3 workers.
  for (let i = 0; i < 3 && rows[i]; i += 1) {
    rows[i]!.reliabilityScore = 88 + i;
    rows[i]!.creditScore = 88 + i;
    rows[i]!.jobsCompleted = 120 + i * 15;
    rows[i]!.onTimeRate = 0.96 + i * 0.01;
    rows[i]!.eligibility = 'pre_approved';
  }
  // Demote the last 3 workers to at-risk.
  for (let i = 47; i < 50 && rows[i]; i += 1) {
    rows[i]!.reliabilityScore = 42 - (i - 47) * 2;
    rows[i]!.creditScore = 42 - (i - 47) * 2;
    rows[i]!.onTimeRate = 0.74;
    rows[i]!.eligibility = 'ineligible';
  }
  await prisma.worker.createMany({ data: rows });

  // Per-worker preference + a default bank account so withdrawal tests work end-to-end.
  await prisma.preference.createMany({
    data: rows.map((r) => ({ workerId: r.id! })),
  });
  await prisma.bankAccount.createMany({
    data: rows.map((r, i) => ({
      id: baId(i + 1),
      workerId: r.id!,
      bankCode: '058',
      bankName: 'GTBank',
      accountNumber: `0${String(123456789 + i).padStart(9, '0')}`.slice(-10),
      accountName: r.name!.toUpperCase(),
      isDefault: true,
    })),
  });
}

async function seedUsers() {
  console.log('• users (employer owners + bank officers + admin)');
  const passwordHash = await argon2.hash('forge-demo-pass');
  const rows: Prisma.UserCreateManyInput[] = [];
  // 1 owner per employer
  for (let i = 0; i < 20; i += 1) {
    const employer = empId(i + 1);
    rows.push({
      id: usrId(i + 1),
      email: `owner+${employer}@example.ng`,
      fullName: `Owner ${i + 1}`,
      passwordHash,
      role: 'business_owner',
      employerId: employer,
      emailVerifiedAt: new Date(),
    });
  }
  // 1 hiring manager for the first employer (so the team-page has > 1 row to render)
  rows.push({
    id: usrId(21),
    email: 'manager+emp_0001@example.ng',
    fullName: 'Hiring Manager',
    passwordHash,
    role: 'business_hiring_manager',
    employerId: 'emp_0001',
    emailVerifiedAt: new Date(),
  });
  // Bank officers (1 credit officer + 1 risk analyst per bank)
  const banks = ['bnk_gtbank', 'bnk_kuda', 'bnk_sterling'];
  let cursor = 22;
  for (const b of banks) {
    rows.push({
      id: usrId(cursor++),
      email: `credit+${b}@example.ng`,
      fullName: `Credit Officer (${b.replace('bnk_', '')})`,
      passwordHash,
      role: 'bank_credit_officer',
      bankId: b,
      emailVerifiedAt: new Date(),
    });
    rows.push({
      id: usrId(cursor++),
      email: `risk+${b}@example.ng`,
      fullName: `Risk Analyst (${b.replace('bnk_', '')})`,
      passwordHash,
      role: 'bank_risk_analyst',
      bankId: b,
      emailVerifiedAt: new Date(),
    });
  }
  // Platform admin
  rows.push({
    id: usrId(cursor++),
    email: 'admin@forge.app',
    fullName: 'Platform Admin',
    passwordHash,
    role: 'platform_admin',
    emailVerifiedAt: new Date(),
  });
  await prisma.user.createMany({ data: rows });
}

interface JobInsert {
  id: string;
  employerId: string;
  type: typeof JOB_TYPES[number];
  status: typeof JOB_STATUS_DISTRIBUTION[number];
  payAmount: number;
  durationHours: number;
  scheduledStart: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  assignedWorkerId: string | null;
  applicantsCount: number;
  neighborhood: Neighborhood;
  lat: number;
  lng: number;
}

async function seedJobs(): Promise<JobInsert[]> {
  console.log('• jobs (220)');
  const rng = createRng(0xbeef);
  const inserts: JobInsert[] = [];
  const rows: Prisma.JobCreateManyInput[] = [];
  for (let i = 0; i < 220; i += 1) {
    const employerNum = range(rng, 1, 20);
    const skill = pick(rng, WORKER_SKILLS);
    const type = SKILL_TO_TYPE[skill];
    let status = pick(rng, JOB_STATUS_DISTRIBUTION);
    const neighborhood = pick(rng, NEIGHBORHOODS);
    const coords = NEIGHBORHOOD_COORDS[neighborhood];
    const lat = coords.lat + rangeFloat(rng, -0.01, 0.01);
    const lng = coords.lng + rangeFloat(rng, -0.01, 0.01);
    const durationHours = range(rng, 2, 8);

    // Bias the first 8 jobs to "live" states for an interesting Overview.
    if (i < 3) status = 'in_progress';
    else if (i === 3) status = 'pending_verification';
    else if (i < 6) status = 'applications_in';
    else if (i < 8) status = 'open';

    // `open` / `applications_in` / `draft` jobs must have a FUTURE `startTime`
    // so the worker-mobile feed (which filters `startTime > now`) actually
    // surfaces them. `in_progress` / `pending_verification` / `completed` /
    // `cancelled` keep historical timestamps so the dashboard's overview +
    // analytics charts still see realistic activity.
    const isFutureFacingStatus =
      status === 'open' ||
      status === 'applications_in' ||
      status === 'draft';
    const now = new Date();
    let postedAt: Date;
    let start: Date;
    if (isFutureFacingStatus) {
      const hoursFromNow = range(rng, 2, 168); // 2 hours to 7 days out
      start = addHours(now, hoursFromNow);
      // Posted 1–72 hours before scheduled start — feels natural on the feed.
      postedAt = subHours(start, range(rng, 1, 72));
    } else {
      const daysAgo = range(rng, 0, 90);
      postedAt = subDays(now, daysAgo);
      start = subHours(postedAt, -range(rng, 1, 48));
    }

    const assigned =
      status === 'accepted' ||
      status === 'in_progress' ||
      status === 'pending_verification' ||
      status === 'completed';
    const startedAt =
      status === 'in_progress' || status === 'pending_verification' || status === 'completed'
        ? start
        : null;
    const completedAt = status === 'completed' ? addHours(start, durationHours) : null;
    const assignedWorkerId = assigned ? wkrId(range(rng, 1, 50)) : null;
    const applicantsCount =
      status === 'open' || status === 'applications_in' ? range(rng, 0, 18) : 0;
    const id = jobId(i + 1);
    const title = pick(rng, TITLE_BY_TYPE[type]);
    rows.push({
      id,
      employerId: empId(employerNum),
      type,
      title,
      description:
        'Reliable hands needed. Show up on time, follow site safety rules. Payment via Squad on completion.',
      payAmount: range(rng, 2000, 15000),
      durationHours,
      lat,
      lng,
      address: `${range(rng, 1, 220)} ${neighborhood} Road, Lagos`,
      neighborhood,
      startTime: start,
      startedAt,
      completedAt,
      requiredEquipment: type === 'loader' ? ['work gloves', 'boots'] : [],
      applicantsCount,
      filled: status === 'in_progress' || status === 'pending_verification' || status === 'completed',
      status,
      audience: 'public',
      assignedWorkerId,
    });
    inserts.push({
      id,
      employerId: empId(employerNum),
      type,
      status,
      payAmount: rows[rows.length - 1]!.payAmount as number,
      durationHours,
      scheduledStart: start,
      startedAt,
      completedAt,
      assignedWorkerId,
      applicantsCount,
      neighborhood,
      lat,
      lng,
    });
  }
  await prisma.job.createMany({ data: rows });
  return inserts;
}

async function seedApplicationsSessionsProof(jobs: JobInsert[]) {
  console.log('• applications, sessions, clock events, photo proofs, job events');
  const rng = createRng(0x7e57);
  const apps: Prisma.JobApplicationCreateManyInput[] = [];
  const sessions: Prisma.WorkSessionCreateManyInput[] = [];
  const clocks: Prisma.ClockEventCreateManyInput[] = [];
  const proofs: Prisma.PhotoProofCreateManyInput[] = [];
  const events: Prisma.JobEventCreateManyInput[] = [];
  let appCursor = 1;
  let sesCursor = 1;
  let cevCursor = 1;
  let prfCursor = 1;
  let jevCursor = 1;

  for (const job of jobs) {
    // Always emit `job_posted` and (for non-draft) `job_published`.
    const postedAt = subHours(job.scheduledStart, range(rng, 4, 72));
    events.push({
      id: jevId(jevCursor++),
      jobId: job.id,
      kind: 'job_posted',
      actorId: job.employerId,
      actorType: 'employer',
      occurredAt: postedAt,
    });
    if (job.status !== 'draft') {
      events.push({
        id: jevId(jevCursor++),
        jobId: job.id,
        kind: 'job_published',
        actorId: job.employerId,
        actorType: 'employer',
        occurredAt: postedAt,
      });
    }

    // Pending applications for "open" / "applications_in".
    if (job.status === 'open' || job.status === 'applications_in') {
      const n = job.applicantsCount;
      const seen = new Set<string>();
      for (let i = 0; i < n; i += 1) {
        const w = wkrId(range(rng, 1, 50));
        if (seen.has(w)) continue;
        seen.add(w);
        apps.push({
          id: appId(appCursor++),
          jobId: job.id,
          workerId: w,
          status: 'applied',
          appliedAt: addHours(postedAt, rangeFloat(rng, 0.1, 24)),
          distanceMeters: range(rng, 200, 8000),
        });
        events.push({
          id: jevId(jevCursor++),
          jobId: job.id,
          kind: 'application_received',
          actorId: w,
          actorType: 'worker',
          occurredAt: addHours(postedAt, rangeFloat(rng, 0.1, 24)),
        });
      }
    }

    // For accepted/in_progress/pending_verification/completed: an accepted application + 2-4 rejected.
    let acceptedAppId: string | null = null;
    if (job.assignedWorkerId) {
      const acceptedAt = addHours(postedAt, rangeFloat(rng, 0.5, 18));
      acceptedAppId = appId(appCursor++);
      apps.push({
        id: acceptedAppId,
        jobId: job.id,
        workerId: job.assignedWorkerId,
        status:
          job.status === 'completed'
            ? 'completed'
            : job.status === 'in_progress'
              ? 'in_progress'
              : 'accepted',
        appliedAt: subHours(acceptedAt, 1),
        decidedAt: acceptedAt,
        completedAt: job.completedAt,
        distanceMeters: range(rng, 200, 6000),
      });
      events.push({
        id: jevId(jevCursor++),
        jobId: job.id,
        kind: 'application_accepted',
        actorId: job.employerId,
        actorType: 'employer',
        occurredAt: acceptedAt,
        payload: { workerId: job.assignedWorkerId } as Prisma.InputJsonValue,
      });
      // 2-3 auto-rejects — unique workers, never the accepted one.
      const competitorCount = range(rng, 2, 4);
      const seenCompetitors = new Set<string>([job.assignedWorkerId]);
      let attempts = 0;
      while (seenCompetitors.size - 1 < competitorCount && attempts < 20) {
        attempts += 1;
        const w = wkrId(range(rng, 1, 50));
        if (seenCompetitors.has(w)) continue;
        seenCompetitors.add(w);
        apps.push({
          id: appId(appCursor++),
          jobId: job.id,
          workerId: w,
          status: 'rejected',
          appliedAt: subHours(acceptedAt, 0.5),
          decidedAt: acceptedAt,
          distanceMeters: range(rng, 200, 8000),
        });
      }

      // Sessions + clock events for in_progress / pending_verification / completed.
      if (
        job.status === 'in_progress' ||
        job.status === 'pending_verification' ||
        job.status === 'completed'
      ) {
        const clockInAt = job.startedAt ?? job.scheduledStart;
        const sesPk = sesId(sesCursor++);
        const expectedOut = addHours(clockInAt, job.durationHours);
        const actualOut = job.status === 'completed' ? job.completedAt ?? expectedOut : null;
        sessions.push({
          id: sesPk,
          applicationId: acceptedAppId!,
          status:
            job.status === 'completed'
              ? 'completed'
              : job.status === 'pending_verification'
                ? 'submitting'
                : 'in_progress',
          clockInAt,
          clockInLat: job.lat + rangeFloat(rng, -0.001, 0.001),
          clockInLng: job.lng + rangeFloat(rng, -0.001, 0.001),
          expectedClockOutAt: expectedOut,
          clockOutAt: actualOut,
          clockOutLat: actualOut ? job.lat + rangeFloat(rng, -0.001, 0.001) : null,
          clockOutLng: actualOut ? job.lng + rangeFloat(rng, -0.001, 0.001) : null,
          proofPhotoUrl: actualOut ? `https://cdn.forge.app/proof/${sesPk}.jpg` : null,
          payAmountPending: job.status === 'completed' ? 0 : job.payAmount,
          payAmountDisbursed: job.status === 'completed' ? job.payAmount : 0,
          transactionId: null, // wire up after transactions seeded
        });
        clocks.push({
          id: cevId(cevCursor++),
          jobId: job.id,
          workerId: job.assignedWorkerId,
          kind: 'clock_in',
          at: clockInAt,
          gpsLat: job.lat + rangeFloat(rng, -0.001, 0.001),
          gpsLng: job.lng + rangeFloat(rng, -0.001, 0.001),
          gpsAccuracyMeters: rangeFloat(rng, 4, 18),
          verified: true,
        });
        events.push({
          id: jevId(jevCursor++),
          jobId: job.id,
          kind: 'worker_clocked_in',
          actorId: job.assignedWorkerId,
          actorType: 'worker',
          occurredAt: clockInAt,
        });
        if (actualOut) {
          clocks.push({
            id: cevId(cevCursor++),
            jobId: job.id,
            workerId: job.assignedWorkerId,
            kind: 'clock_out',
            at: actualOut,
            gpsLat: job.lat + rangeFloat(rng, -0.001, 0.001),
            gpsLng: job.lng + rangeFloat(rng, -0.001, 0.001),
            gpsAccuracyMeters: rangeFloat(rng, 4, 18),
            verified: true,
          });
          events.push({
            id: jevId(jevCursor++),
            jobId: job.id,
            kind: 'worker_clocked_out',
            actorId: job.assignedWorkerId,
            actorType: 'worker',
            occurredAt: actualOut,
          });
          proofs.push({
            id: prfId(prfCursor++),
            jobId: job.id,
            workerId: job.assignedWorkerId,
            at: actualOut,
            s3Key: `proofs/${sesPk}.jpg`,
            exifLat: job.lat,
            exifLng: job.lng,
            exifTakenAt: actualOut,
          });
          events.push({
            id: jevId(jevCursor++),
            jobId: job.id,
            kind: 'photo_proof_uploaded',
            actorId: job.assignedWorkerId,
            actorType: 'worker',
            occurredAt: actualOut,
          });
          if (job.status === 'completed') {
            events.push({
              id: jevId(jevCursor++),
              jobId: job.id,
              kind: 'job_completed',
              actorId: 'system',
              actorType: 'system',
              occurredAt: actualOut,
            });
          }
        }
      }
    }

    if (job.status === 'cancelled') {
      events.push({
        id: jevId(jevCursor++),
        jobId: job.id,
        kind: 'job_cancelled',
        actorId: job.employerId,
        actorType: 'employer',
        occurredAt: addHours(postedAt, rangeFloat(rng, 1, 36)),
      });
    }
  }

  // Final safety dedup: enforce the (workerId, jobId) unique constraint at the array
  // level so any RNG collisions don't take the seed down.
  const seenAppKeys = new Set<string>();
  const dedupedApps = apps.filter((a) => {
    const key = `${a.workerId}|${a.jobId}`;
    if (seenAppKeys.has(key)) return false;
    seenAppKeys.add(key);
    return true;
  });

  // Bulk insert in chunks to keep argument count under Postgres' parameter limits.
  await chunkedCreateMany(prisma.jobApplication, dedupedApps);
  await chunkedCreateMany(prisma.workSession, sessions);
  await chunkedCreateMany(prisma.clockEvent, clocks);
  await chunkedCreateMany(prisma.photoProof, proofs);
  await chunkedCreateMany(prisma.jobEvent, events);
}

async function seedTransactionsAndReviews(jobs: JobInsert[]) {
  console.log('• transactions + reviews');
  const rng = createRng(0xdead);
  const txns: Prisma.TransactionCreateManyInput[] = [];
  const reviews: Prisma.ReviewCreateManyInput[] = [];
  let txnCursor = 1;
  let revCursor = 1;
  for (const job of jobs) {
    if (
      (job.status === 'completed' || job.status === 'pending_verification') &&
      job.assignedWorkerId
    ) {
      const status = pick(rng, TX_STATUS_DISTRIBUTION);
      const created = job.completedAt ?? job.startedAt ?? job.scheduledStart;
      const txn: Prisma.TransactionCreateManyInput = {
        id: txnId(txnCursor++),
        workerId: job.assignedWorkerId,
        employerId: job.employerId,
        kind: 'job_payment',
        amount: job.payAmount,
        timestamp: created,
        title: `Job payment — ${job.id}`,
        subtitle: `${job.type} · ${job.neighborhood}`,
        squadReference: `SQ-${range(rng, 100_000_000, 999_999_999)}`,
        relatedJobId: job.id,
        status,
        settledAt: status === 'succeeded' ? new Date() : null,
      };
      txns.push(txn);

      // Review on ~60% of completed jobs.
      if (job.status === 'completed' && rng() < 0.6) {
        reviews.push({
          id: revId(revCursor++),
          jobId: job.id,
          workerId: job.assignedWorkerId,
          employerId: job.employerId,
          rating: range(rng, 3, 5),
          body: pick(rng, [
            'Showed up early, did the work, no complaints.',
            'Very reliable. Would hire again.',
            'Solid hands. Communicated well throughout the job.',
            'Good worker. Could be a touch faster on unloads.',
          ]),
          createdAt: addHours(job.completedAt ?? created, rangeFloat(rng, 1, 24)),
        });
      }
    }
  }

  // A small set of withdrawals so the worker mobile wallet has variety.
  for (let i = 0; i < 30; i += 1) {
    const workerNum = range(rng, 1, 50);
    const amount = range(rng, 1000, 25000);
    txns.push({
      id: txnId(txnCursor++),
      workerId: wkrId(workerNum),
      kind: 'withdrawal',
      amount: -amount,
      timestamp: subDays(new Date(), range(rng, 0, 60)),
      title: `Withdrawal to GTBank ****${String(range(rng, 1000, 9999))}`,
      subtitle: 'Bank transfer',
      squadReference: `SQ-${range(rng, 100_000_000, 999_999_999)}`,
      status: pick(rng, ['succeeded', 'succeeded', 'succeeded', 'pending']),
    });
  }

  await chunkedCreateMany(prisma.transaction, txns);
  await chunkedCreateMany(prisma.review, reviews);
}

async function seedLoans() {
  console.log('• loans + applications + repayment schedules');
  const rng = createRng(0xbada55);
  const loans: Prisma.LoanCreateManyInput[] = [];
  const repayments: Prisma.LoanRepaymentCreateManyInput[] = [];
  const banks = ['bnk_gtbank', 'bnk_kuda', 'bnk_sterling'];
  let repCursor = 1;
  for (let i = 0; i < 40; i += 1) {
    const isWorker = rng() < 0.7;
    const borrowerType = isWorker ? 'worker' : 'business';
    const borrowerId = isWorker ? wkrId(range(rng, 1, 50)) : empId(range(rng, 1, 20));
    const principal = isWorker ? range(rng, 20_000, 500_000) : range(rng, 500_000, 5_000_000);
    const status = pick(rng, LOAN_STATUS_DIST);
    const outstanding =
      status === 'repaid' ? 0 : Math.round(principal * rangeFloat(rng, 0.2, 0.95));
    const disbursed = subDays(new Date(), range(rng, 14, 240));
    const termMonths = pick(rng, [3, 6, 9, 12]);
    const apr = rangeFloat(rng, 0.12, 0.22);
    const id = loanId(i + 1);
    const bankId = pick(rng, banks);
    const riskLevel =
      status === 'at_risk' ? 'yellow' : status === 'defaulted' ? 'red' : 'green';

    loans.push({
      id,
      ...(isWorker ? { workerId: borrowerId } : { employerId: borrowerId }),
      bankId,
      borrowerType,
      principal,
      outstandingBalance: outstanding,
      interestRatePercent: apr * 100,
      apr,
      termMonths,
      repaymentPercentPerJob: isWorker ? rangeFloat(rng, 0.1, 0.3) : 0,
      status,
      riskLevel,
      purpose: pick(rng, ['stock_purchase', 'tools', 'transport', 'family_emergency', 'other']),
      disbursedAt: disbursed,
      nextPaymentDueAt:
        status === 'active' || status === 'at_risk'
          ? addMonths(disbursed, range(rng, 1, 6))
          : null,
      scoreAtApproval: range(rng, 70, 95),
      predictedRepaymentRate: rangeFloat(rng, 0.85, 0.99),
    });

    // Repayment schedule
    const installment = Math.round(principal / termMonths);
    for (let m = 1; m <= termMonths; m += 1) {
      const due = addMonths(disbursed, m);
      const isPast = due.getTime() < Date.now();
      const missed = isPast && rng() < (status === 'at_risk' ? 0.4 : 0.05);
      const repStatus = !isPast ? 'scheduled' : missed ? 'missed' : 'paid';
      repayments.push({
        id: repId(repCursor++),
        loanId: id,
        amount: installment,
        scheduledFor: due,
        paidAt: repStatus === 'paid' ? due : null,
        status: repStatus,
      });
    }
  }
  await chunkedCreateMany(prisma.loan, loans);
  await chunkedCreateMany(prisma.loanRepayment, repayments);

  // Loan applications (30, all pending)
  console.log('• loan applications (30)');
  const lapRng = createRng(0xfade);
  const lapRows: Prisma.LoanApplicationCreateManyInput[] = [];
  for (let i = 0; i < 30; i += 1) {
    const isWorker = lapRng() < 0.7;
    const borrowerId = isWorker ? wkrId(range(lapRng, 1, 50)) : empId(range(lapRng, 1, 20));
    const score = range(lapRng, 55, 95);
    const decision = score >= 80 ? 'approve' : score >= 65 ? 'approve_with_conditions' : 'reject';
    lapRows.push({
      id: lapId(i + 1),
      borrowerType: isWorker ? 'worker' : 'business',
      ...(isWorker ? { workerId: borrowerId } : { employerId: borrowerId }),
      bankId: pick(lapRng, banks),
      amountRequestedNaira: isWorker
        ? range(lapRng, 25_000, 400_000)
        : range(lapRng, 500_000, 4_500_000),
      termMonths: pick(lapRng, [3, 6, 9, 12]),
      appliedAt: subDays(new Date(), range(lapRng, 0, 14)),
      recommendedDecision: decision,
      recommendationConfidencePct: range(lapRng, 65, 96),
      recommendationReason:
        decision === 'approve'
          ? 'Strong verified income, on-time history, stable 6-month trend.'
          : decision === 'approve_with_conditions'
            ? 'Acceptable profile with shorter tenure — recommend reduced amount.'
            : 'Insufficient verified income consistency for requested amount.',
      status: 'pending',
    });
  }
  await prisma.loanApplication.createMany({ data: lapRows });
}

async function seedNotifications() {
  console.log('• notifications + user notifications');
  const rng = createRng(0x1234);
  const wkrNotifs: Prisma.NotificationCreateManyInput[] = [];
  for (let i = 0; i < 80; i += 1) {
    const w = wkrId(range(rng, 1, 50));
    const kinds = ['payment', 'application_update', 'new_job', 'loan'] as const;
    const k = pick(rng, kinds);
    wkrNotifs.push({
      id: ntfId(i + 1),
      workerId: w,
      kind: k,
      title:
        k === 'payment'
          ? `₦${range(rng, 2000, 12000).toLocaleString()} arrived in your wallet`
          : k === 'application_update'
            ? 'Your application was accepted'
            : k === 'new_job'
              ? 'New job near you'
              : 'Loan repayment processed',
      body: k === 'new_job' ? 'A new loading job is open near Apapa.' : 'Tap to view details.',
      timestamp: subHours(new Date(), range(rng, 1, 240)),
      unread: rng() < 0.4,
      deeplink: null,
    });
  }
  await prisma.notification.createMany({ data: wkrNotifs });

  const userNotifs: Prisma.UserNotificationCreateManyInput[] = [];
  // 20 recent dashboard notifications across 3 employers.
  for (let i = 0; i < 20; i += 1) {
    const ownerNum = range(rng, 1, 5);
    userNotifs.push({
      id: unotId(i + 1),
      recipientUserId: usrId(ownerNum),
      kind: pick(rng, ['application_update', 'payment', 'system']),
      title: pick(rng, [
        'New applicant for "Truck loaders, 4 hrs"',
        'Payment processed',
        'Worker clocked in at the site',
        'Your wallet balance is low',
      ]),
      detail: 'Tap to view in the dashboard.',
      occurredAt: subHours(new Date(), range(rng, 1, 96)),
      readAt: rng() < 0.5 ? subHours(new Date(), range(rng, 0, 24)) : null,
    });
  }
  await prisma.userNotification.createMany({ data: userNotifs });
}

async function seedHelpArticles() {
  console.log('• help articles');
  await prisma.helpArticle.createMany({
    data: [
      {
        id: 'art_payments_when',
        category: 'payments',
        title: 'When does my pay arrive?',
        bodyMarkdown:
          '## When pay lands\n\nYour pay is sent to your default bank account immediately after the employer confirms your clock-out and uploads photo proof. Squad transfers usually settle within 5 minutes.',
      },
      {
        id: 'art_payments_failed',
        category: 'payments',
        title: 'My payment failed — what now?',
        bodyMarkdown:
          'Pay first goes into a `pending` state and flips to `succeeded` after Squad confirms. If it fails, our ops team manually retries within 24h.',
      },
      {
        id: 'art_loans_eligibility',
        category: 'loans',
        title: 'How does loan eligibility work?',
        bodyMarkdown:
          'Loan eligibility is computed from your reliability score (0-100). Score ≥ 80 → pre-approved. 70-79 → eligible. Below 70 → keep working to qualify.',
      },
      {
        id: 'art_account_phone',
        category: 'account',
        title: 'How do I change my phone number?',
        bodyMarkdown:
          'Settings → Account → Change phone number. We send a one-time code to the new number to verify it.',
      },
      {
        id: 'art_getting_started_first',
        category: 'getting_started',
        title: 'Your first job',
        bodyMarkdown:
          '1. Browse the Jobs feed.\n2. Tap "Apply".\n3. Wait for the employer to accept.\n4. Show up on time.\n5. Clock in via GPS.',
      },
      {
        id: 'art_account_delete',
        category: 'account',
        title: 'Deleting your account',
        bodyMarkdown:
          'Account deletion is a 30-day soft-delete. Sign back in within 30 days to cancel. Active loans must be repaid first.',
      },
    ],
  });
}

// ─── Util ───────────────────────────────────────────────────────────────────

interface CreateManyDelegate<T> {
  createMany: (args: { data: T[] }) => Promise<unknown>;
}

async function chunkedCreateMany<T>(
  delegate: CreateManyDelegate<T>,
  rows: T[],
  chunkSize = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await delegate.createMany({ data: rows.slice(i, i + chunkSize) });
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Forge seed starting against', maskUrl(url!));
  const start = Date.now();
  await truncate();
  await seedNibssBanks();
  await seedLenderBanks();
  await seedEmployers();
  await seedWorkers();
  await seedUsers();
  const jobs = await seedJobs();
  await seedApplicationsSessionsProof(jobs);
  await seedTransactionsAndReviews(jobs);
  await seedLoans();
  await seedNotifications();
  await seedHelpArticles();
  const ms = Date.now() - start;
  console.log(`✔ seed complete in ${(ms / 1000).toFixed(1)}s`);
  console.log(
    `\nDemo logins (password = forge-demo-pass):\n` +
      `  • owner+emp_0001@example.ng         (business_owner)\n` +
      `  • manager+emp_0001@example.ng       (business_hiring_manager)\n` +
      `  • credit+bnk_gtbank@example.ng      (bank_credit_officer)\n` +
      `  • risk+bnk_gtbank@example.ng        (bank_risk_analyst)\n` +
      `  • admin@forge.app                    (platform_admin)\n`,
  );
}

function maskUrl(u: string): string {
  return u.replace(/:\/\/[^@]*@/, '://***:***@');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
