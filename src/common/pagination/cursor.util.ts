/**
 * Opaque cursor encoded as base64url JSON. The shape is implementation-detail —
 * clients echo the string back without parsing.
 *
 * For most ledgers we sort by `(timestamp DESC, id DESC)` and use the last row's
 * (timestamp, id) as the pointer.
 */
export interface Cursor {
  ts: string; // ISO timestamp
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(token: string | undefined): Cursor | null {
  if (!token) return null;
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Cursor;
    if (!parsed.ts || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}
