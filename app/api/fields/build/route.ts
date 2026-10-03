import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { scoreSite } from '@/lib/score-site';
import { buildFieldStats } from '@/lib/compare';
import { slugify, parseSites } from '@/lib/field-config';
import { db } from '@/lib/db';
import type { SiteScore } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Build a new field from user-supplied sites.
 *
 * POST { industry, location, sites: string[] | string }
 *
 * Sites may be passed as an array or as one blob of text (newline/comma
 * separated) so the mobile UI can use a single textarea.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      industry?: string;
      location?: string;
      sites?: string[] | string;
    };

    const industry = (body.industry ?? '').trim();
    const location = (body.location ?? '').trim();

    if (!industry) {
      return NextResponse.json({ ok: false, error: 'Enter an industry.' }, { status: 400 });
    }
    if (!location) {
      return NextResponse.json({ ok: false, error: 'Enter a location.' }, { status: 400 });
    }

    const raw = Array.isArray(body.sites) ? body.sites.join('\n') : (body.sites ?? '');
    const sites = parseSites(raw);

    if (sites.length < 2) {
      return NextResponse.json(
        { ok: false, error: 'Enter at least 2 websites to build a field.' },
        { status: 400 }
      );
    }
    if (sites.length > 25) {
      return NextResponse.json(
        { ok: false, error: 'Maximum 25 sites per field.' },
        { status: 400 }
      );
    }

    // Score every site. Sequential keeps us inside PageSpeed/rate limits and
    // avoids hammering small-business servers all at once.
    const results: SiteScore[] = [];
    for (const s of sites) {
      const scored = await scoreSite(s, { skipPageSpeed: true });
      results.push(scored);
    }

    const ok = results.filter((r) => !r.error);
    const failed = results.length - ok.length;

    if (ok.length < 2) {
      return NextResponse.json(
        { ok: false, error: 'Fewer than 2 sites could be reached. Check the URLs and try again.' },
        { status: 422 }
      );
    }

    const slug = slugify(industry, location);
    const stats = buildFieldStats(`${industry} — ${location}`, ok);

    const sql = db();
    const fieldId = randomUUID();

    // Upsert the field, then replace its sites.
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM vantage_fields WHERE slug = ${slug} LIMIT 1
    `;

    const finalId = existing[0]?.id ?? fieldId;

    if (existing.length > 0) {
      await sql`
        UPDATE vantage_fields SET
          industry = ${industry}, location = ${location},
          site_count = ${ok.length}, failed_count = ${failed},
          avg_score = ${stats.avg}, median_score = ${stats.median},
          p25_score = ${stats.p25}, p75_score = ${stats.p75},
          min_score = ${stats.min}, max_score = ${stats.max},
          stats = ${sql.json(stats as never)}, built_at = NOW()
        WHERE id = ${finalId}
      `;
      await sql`DELETE FROM vantage_sites WHERE field_id = ${finalId}`;
    } else {
      await sql`
        INSERT INTO vantage_fields (
          id, slug, industry, location, site_count, failed_count,
          avg_score, median_score, p25_score, p75_score, min_score, max_score, stats
        ) VALUES (
          ${finalId}, ${slug}, ${industry}, ${location}, ${ok.length}, ${failed},
          ${stats.avg}, ${stats.median}, ${stats.p25}, ${stats.p75},
          ${stats.min}, ${stats.max}, ${sql.json(stats as never)}
        )
      `;
    }

    for (const r of results) {
      const domain = (() => {
        try {
          return new URL(r.finalUrl).hostname.replace(/^www\./, '');
        } catch {
          return r.url;
        }
      })();

      await sql`
        INSERT INTO vantage_sites (
          id, field_id, url, domain, overall, grade, categories, top_fixes, error
        ) VALUES (
          ${randomUUID()}, ${finalId}, ${r.finalUrl}, ${domain},
          ${r.error ? null : r.overall}, ${r.error ? null : r.grade},
          ${sql.json(Object.fromEntries(r.categories.map((c) => [c.key, c.score])) as never)},
          ${sql.json(r.topFixes.map((f) => f.label) as never)},
          ${r.error ?? null}
        )
      `;
    }

    return NextResponse.json({
      ok: true,
      slug,
      field: {
        slug,
        industry,
        location,
        siteCount: ok.length,
        failedCount: failed,
        avg: stats.avg,
        median: stats.median,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Build failed' },
      { status: 500 }
    );
  }
}
