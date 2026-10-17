import { timingSafeEqual } from 'crypto';

/** How long a free glow-up preview stays viewable. */
export const FREE_PREVIEW_DAYS = 14;

export function freePreviewExpiry(createdAt: string | Date): Date {
  return new Date(new Date(createdAt).getTime() + FREE_PREVIEW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The team's way to see a preview unprotected, for review before a Glow Up is
 * delivered. Off unless PREVIEW_ADMIN_KEY is set; compared in constant time.
 */
export function isPreviewAdmin(key: string | null): boolean {
  const expected = process.env.PREVIEW_ADMIN_KEY;
  if (!expected || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface FixSummary {
  category: string;
  count: number;
  points: number;
}

/**
 * What a free preview may say about the fixes: how many, where, and what they
 * are worth — not what they are. The itemised list is a to-do list ("add a
 * viewport tag", "write a meta description") and belongs to the Glow Up.
 */
export function summariseFixes(fixes: Array<{ category: string; points: number }>): FixSummary[] {
  const by = new Map<string, FixSummary>();
  for (const f of fixes) {
    const cur = by.get(f.category) ?? { category: f.category, count: 0, points: 0 };
    cur.count += 1;
    cur.points = Math.round((cur.points + f.points) * 10) / 10;
    by.set(f.category, cur);
  }
  return [...by.values()].sort((a, b) => b.points - a.points);
}
