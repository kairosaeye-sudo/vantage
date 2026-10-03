import { db } from './db';
import { CATEGORY_WEIGHTS, CATEGORY_LABELS } from './score';
import type { CategoryKey, CategoryScore, Grade, SiteScore } from './types';

/**
 * Load a field and its member sites from Supabase in the shape the comparison
 * engine expects.
 *
 * The web app reads from the database rather than the JSON files in ./data,
 * because Vercel's filesystem is read-only at runtime.
 */

export interface DbField {
  id: string;
  slug: string;
  industry: string;
  location: string;
  siteCount: number;
  avg: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  builtAt: string;
}

export interface DbSiteRow {
  url: string;
  domain: string;
  overall: number | null;
  grade: string | null;
  categories: Record<string, number> | null;
  error: string | null;
}

export async function listFields(): Promise<DbField[]> {
  const sql = db();
  return sql<DbField[]>`
    SELECT id, slug, industry, location,
           site_count AS "siteCount", avg_score AS avg, median_score AS median,
           p25_score AS p25, p75_score AS p75, min_score AS min, max_score AS max,
           built_at AS "builtAt"
    FROM vantage_fields
    ORDER BY site_count DESC, industry ASC
  `;
}

export async function getFieldBySlug(slug: string): Promise<DbField | null> {
  const sql = db();
  const rows = await sql<DbField[]>`
    SELECT id, slug, industry, location,
           site_count AS "siteCount", avg_score AS avg, median_score AS median,
           p25_score AS p25, p75_score AS p75, min_score AS min, max_score AS max,
           built_at AS "builtAt"
    FROM vantage_fields
    WHERE slug = ${slug}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getFieldSites(fieldId: string): Promise<DbSiteRow[]> {
  const sql = db();
  return sql<DbSiteRow[]>`
    SELECT url, domain, overall, grade, categories, error
    FROM vantage_sites
    WHERE field_id = ${fieldId}
    ORDER BY overall DESC NULLS LAST
  `;
}

/** Convert stored site rows into SiteScore objects the comparison engine can use. */
export function rowsToPeers(rows: DbSiteRow[]): SiteScore[] {
  return rows
    .filter((r) => !r.error && r.overall !== null)
    .map((r) => {
      const cats = r.categories ?? {};
      const categories: CategoryScore[] = (Object.keys(CATEGORY_WEIGHTS) as CategoryKey[])
        .filter((k) => typeof cats[k] === 'number')
        .map((k) => ({
          key: k,
          label: CATEGORY_LABELS[k],
          weight: CATEGORY_WEIGHTS[k],
          score: cats[k],
          findings: [],
        }));

      return {
        url: r.url,
        finalUrl: r.url,
        overall: r.overall as number,
        grade: (r.grade ?? 'developing') as Grade,
        categories,
        topFixes: [],
        measuredAt: new Date().toISOString(),
        fetch: { status: 200, ttfbMs: 0, totalMs: 0, bytes: 0 },
        pagespeed: null,
      } satisfies SiteScore;
    });
}
