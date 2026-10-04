import { db } from './db';

/**
 * Field gap tracking.
 *
 * Vantage only scores a site against a field it has built. When a site matches
 * no field, or matches an industry in a location we have no data for, the
 * glow-up silently falls back to generic best practices — and nobody finds out
 * that we are missing coverage the market is asking for.
 *
 * Every gap is a signal about which field to build next. This module records
 * them, groups them so the same request doesn't pile up, and exposes the
 * summary the notification and dashboard read.
 *
 * Two kinds of gap:
 *
 *   no-field        nothing matched at all — no industry or location evidence
 *   no-field-area   the industry is recognisable but we have no field for that
 *                   location (e.g. an electrician in Tulsa, fields only in Austin)
 */

export type GapKind = 'no-field' | 'no-field-area';

export interface FieldGap {
  id: string;
  kind: GapKind;
  url: string;
  /** Industry the site appears to be in, when we can tell. */
  industry: string | null;
  /** City read from the site. */
  city: string | null;
  region: string | null;
  /** What the location detection was based on. */
  locationSource: string | null;
  /** Raw evidence text, so a human can judge whether the read was right. */
  evidence: string | null;
  /** The field slug we would build, e.g. "electricians-tulsa-ok". */
  suggestedSlug: string | null;
  /** How many times this exact gap has been seen. */
  hits: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** True once the gap has been shown in a notification. */
  notified: boolean;
}

/** Grouping key: one row per industry+location, not per request. */
function gapKey(kind: GapKind, industry: string | null, city: string | null, region: string | null): string {
  return [kind, industry ?? '-', (city ?? '-').toLowerCase(), (region ?? '-').toLowerCase()].join('|');
}

export async function recordFieldGap(input: {
  url: string;
  industry: string | null;
  city: string | null;
  region: string | null;
  locationSource: string | null;
  evidence: string | null;
  suggestedSlug: string | null;
}): Promise<void> {
  // A gap with no location evidence and no industry is noise, not a lead.
  if (!input.city && !input.industry) return;

  const kind: GapKind = input.city || input.region ? 'no-field-area' : 'no-field';
  const key = gapKey(kind, input.industry, input.city, input.region);
  const sql = db();

  try {
    await sql`
      INSERT INTO vantage_field_gaps
        (id, kind, url, industry, city, region, location_source, evidence, suggested_slug, hits, first_seen_at, last_seen_at, notified)
      VALUES
        (${key}, ${kind}, ${input.url}, ${input.industry}, ${input.city}, ${input.region},
         ${input.locationSource}, ${input.evidence}, ${input.suggestedSlug}, 1, NOW(), NOW(), false)
      ON CONFLICT (id) DO UPDATE
        SET hits = vantage_field_gaps.hits + 1,
            last_seen_at = NOW(),
            -- keep the most recent concrete evidence
            url = ${input.url},
            evidence = COALESCE(${input.evidence}, vantage_field_gaps.evidence)
    `;
  } catch {
    // Gap tracking must never break a glow-up the customer asked for.
  }
}

export async function listFieldGaps(limit = 50): Promise<FieldGap[]> {
  const sql = db();
  const rows = await sql<FieldGap[]>`
    SELECT id, kind, url, industry, city, region,
           location_source AS "locationSource", evidence,
           suggested_slug AS "suggestedSlug", hits,
           first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", notified
    FROM vantage_field_gaps
    ORDER BY hits DESC, last_seen_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/** Gaps first seen since a timestamp — lets a poller report only what is new. */
export async function listGapsSince(since: string, limit = 50): Promise<FieldGap[]> {
  const sql = db();
  const when = new Date(since);
  if (Number.isNaN(when.getTime())) return [];
  return sql<FieldGap[]>`
    SELECT id, kind, url, industry, city, region,
           location_source AS "locationSource", evidence,
           suggested_slug AS "suggestedSlug", hits,
           first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", notified
    FROM vantage_field_gaps
    WHERE first_seen_at > ${when}
    ORDER BY first_seen_at DESC
    LIMIT ${limit}
  `;
}

/** Gaps not yet reported, so a notification fires once per gap. */
export async function listUnnotifiedGaps(): Promise<FieldGap[]> {
  const sql = db();
  return sql<FieldGap[]>`
    SELECT id, kind, url, industry, city, region,
           location_source AS "locationSource", evidence,
           suggested_slug AS "suggestedSlug", hits,
           first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", notified
    FROM vantage_field_gaps
    WHERE notified = false
    ORDER BY hits DESC, last_seen_at DESC
  `;
}

export async function markGapsNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sql = db();
  await sql`
    UPDATE vantage_field_gaps SET notified = true WHERE id = ANY(${ids})
  `;
}

/** A one-line summary of a gap, for notifications and the dashboard. */
export function describeGap(gap: FieldGap): string {
  const where = [gap.city, gap.region].filter(Boolean).join(', ');
  const what = gap.industry ?? 'unknown industry';
  const slug = gap.suggestedSlug ? ` → build \`${gap.suggestedSlug}\`` : '';
  const times = gap.hits > 1 ? ` (${gap.hits}×)` : '';
  if (where) return `${what} in ${where}${slug}${times}`;
  return `${what}${slug}${times}`;
}
