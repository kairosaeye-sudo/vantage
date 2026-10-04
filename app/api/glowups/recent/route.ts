import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recent glow-ups, newest first.
 *
 * Reads `vantage_previews`, which every glow-up writes — including ones run
 * without a watch. `vantage_glowups` cannot be used for this: it has a foreign
 * key to `vantage_watches`, so anonymous runs never land there.
 *
 * GET /api/glowups/recent            → the last 20
 * GET /api/glowups/recent?since=ISO  → only those created after that time
 * GET /api/glowups/recent?format=text → a plain-text digest
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const since = params.get('since');
  const format = params.get('format');
  const sql = db();

  const when = since ? new Date(since) : null;
  const validSince = when && !Number.isNaN(when.getTime()) ? when : null;

  const rows = await sql<
    Array<{
      id: string;
      url: string;
      beforeScore: number;
      afterScore: number;
      fieldDetected: boolean;
      hasRedesign: boolean;
      createdAt: string;
    }>
  >`
    SELECT id, url,
           before_score AS "beforeScore",
           after_score AS "afterScore",
           COALESCE(field_detected, false) AS "fieldDetected",
           (redesigned_html IS NOT NULL) AS "hasRedesign",
           created_at AS "createdAt"
    FROM vantage_previews
    WHERE ${validSince ? sql`created_at > ${validSince}` : sql`true`}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  if (format === 'text') {
    if (rows.length === 0) return new NextResponse('No new glow-ups.', { status: 200 });
    const lines = rows.map(
      (r) =>
        `${r.url}: ${r.beforeScore} → ${r.afterScore} (+${r.afterScore - r.beforeScore})${
          r.hasRedesign ? ' [redesign]' : ''
        }${r.fieldDetected ? '' : ' [no field]'}`
    );
    return new NextResponse(`New glow-ups (${rows.length}):\n${lines.join('\n')}`, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    count: rows.length,
    glowups: rows.map((r) => ({
      ...r,
      gain: r.afterScore - r.beforeScore,
      previewUrl: `https://vantage-kappa-orcin.vercel.app/glowup/preview?id=${r.id}`,
    })),
  });
}
