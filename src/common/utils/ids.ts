import { randomBytes } from 'crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomSuffix(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export const newId = (prefix: string): string => `${prefix}_${randomSuffix(8)}`;

export const ID_PREFIXES = {
  worker: 'wkr',
  employer: 'emp',
  job: 'job',
  application: 'app',
  session: 'ses',
  transaction: 'txn',
  bankAccount: 'bnk',
  loan: 'loan',
  loanRepayment: 'rep',
  notification: 'ntf',
  device: 'dvc',
  ticket: 'tkt',
  article: 'art',
  upload: 'upl',
  challenge: 'chl',
  refresh: 'rt',
  deletion: 'dr',
} as const;
