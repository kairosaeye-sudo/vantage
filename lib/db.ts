import postgres from 'postgres';
import { randomUUID } from 'crypto';
import type { SiteScore } from './types';
import type { FieldFile } from './field-store';

/**
 * Supabase (Postgres) persistence.
 *
 * Supabase exposes a standard Postgres connection, so we talk to it with
 * `postgres` directly rather than a heavier client.
 *
 * IMPORTANT — connection string: use the CONNECTION POOLING host
 * (aws-0-<region>.pooler.supabase.com, port 6543), not the direct host
 * (db.<ref>.supabase.co, port 5432). The direct host is IPv6-only, and Vercel's
 * serverless functions are IPv4-only, so the direct string fails on deploy even
 * though it may work locally.
 */

let client: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (client) return client;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add your Supabase connection string to .env.local');
  }

  client = postgres(url, {
    max: 1, // serverless: one connection per instance
    idle_timeout: 20,
    connect_timeout: 12,
    ssl: url.includes('localhost') ? false : 'require',
  });

  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

export interface StoredField {
  id: string;
  slug: string;
  industry: string;
  location: string;
  siteCount: number;
  failedCount: number;
  avg: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  stats: unknown;
  builtAt: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Insert or update a field and replace its site rows. */
export async function saveField(
  field: FieldFile,
  results: SiteScore[]
): Promise<{ fieldId: string; sitesWritten: number }> {
  const sql = db();
  const slug = field.slug ?? field.industry ?? 'unknown';
  const industry = field.industry ?? field.vertical ?? 'unknown';
  const location = field.location ?? 'unknown';

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM vantage_fields WHERE slug = ${slug} LIMIT 1
  `;
  const fieldId = existing[0]?.id ?? randomUUID();

  const stats = {
    overall: field.overall,
    categories: field.categories,
    distribution: field.distribution,
    pagespeed: field.pagespeed ?? false,
  };

  if (existing.length > 0) {
    await sql`
      UPDATE vantage_fields SET
        industry = ${industry},
        location = ${location},
        site_count = ${field.siteCount},
        failed_count = ${field.failedCount ?? 0},
        avg_score = ${field.overall.avg},
        median_score = ${field.overall.median},
        p25_score = ${field.overall.p25},
        p75_score = ${field.overall.p75},
        min_score = ${field.overall.min},
        max_score = ${field.overall.max},
        stats = ${sql.json(stats as never)},
        built_at = NOW()
      WHERE id = ${fieldId}
    `;
    // Replace sites wholesale so stale rows from an earlier crawl don't linger.
    await sql`DELETE FROM vantage_sites WHERE field_id = ${fieldId}`;
  } else {
    await sql`
      INSERT INTO vantage_fields (
        id, slug, industry, location, site_count, failed_count,
        avg_score, median_score, p25_score, p75_score, min_score, max_score, stats
      ) VALUES (
        ${fieldId}, ${slug}, ${industry}, ${location}, ${field.siteCount}, ${field.failedCount ?? 0},
        ${field.overall.avg}, ${field.overall.median}, ${field.overall.p25},
        ${field.overall.p75}, ${field.overall.min}, ${field.overall.max},
        ${sql.json(stats as never)}
      )
    `;
  }

  let sitesWritten = 0;
  for (const r of results) {
    await sql`
      INSERT INTO vantage_sites (
        id, field_id, url, domain, overall, grade, categories, top_fixes,
        ttfb_ms, bytes, error
      ) VALUES (
        ${randomUUID()}, ${fieldId}, ${r.finalUrl}, ${domainOf(r.finalUrl)},
        ${r.error ? null : r.overall}, ${r.error ? null : r.grade},
        ${sql.json(Object.fromEntries(r.categories.map((c) => [c.key, c.score])) as never)},
        ${sql.json(r.topFixes.map((f) => f.label) as never)},
        ${r.fetch.ttfbMs}, ${r.fetch.bytes}, ${r.error ?? null}
      )
    `;
    sitesWritten++;
  }

  return { fieldId, sitesWritten };
}

export async function listStoredFields(): Promise<StoredField[]> {
  const sql = db();
  const rows = await sql<StoredField[]>`
    SELECT id, slug, industry, location,
           site_count AS "siteCount", failed_count AS "failedCount",
           avg_score AS "avg", median_score AS "median",
           p25_score AS "p25", p75_score AS "p75",
           min_score AS "min", max_score AS "max",
           stats, built_at AS "builtAt"
    FROM vantage_fields
    ORDER BY built_at DESC
  `;
  return rows;
}

export async function getFieldBySlug(slug: string): Promise<StoredField | null> {
  const rows = await listStoredFields();
  return rows.find((r) => r.slug === slug) ?? null;
}

export async function getFieldSites(fieldId: string) {
  const sql = db();
  return sql`
    SELECT url, domain, overall, grade, categories, top_fixes AS "topFixes", error
    FROM vantage_sites
    WHERE field_id = ${fieldId}
    ORDER BY overall DESC NULLS LAST
  `;
}

/* ------------------------------------------------------------------ */
/* Scans                                                               */
/* ------------------------------------------------------------------ */

export async function saveScan(params: {
  url: string;
  fieldSlug?: string;
  overall: number;
  grade: string;
  percentile?: number;
  result: unknown;
  email?: string;
}): Promise<string> {
  const sql = db();
  const id = randomUUID();

  let fieldId: string | null = null;
  if (params.fieldSlug) {
    const f = await getFieldBySlug(params.fieldSlug);
    fieldId = f?.id ?? null;
  }

  await sql`
    INSERT INTO vantage_scans (id, url, field_id, overall, grade, percentile, result, email)
    VALUES (
      ${id}, ${params.url}, ${fieldId}, ${params.overall}, ${params.grade},
      ${params.percentile ?? null}, ${sql.json(params.result as never)},
      ${params.email ?? null}
    )
  `;
  return id;
}

export async function recentScans(limit = 20) {
  const sql = db();
  return sql`
    SELECT id, url, overall, grade, percentile, email, created_at AS "createdAt"
    FROM vantage_scans
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
