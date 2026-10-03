import { NextResponse } from 'next/server';
import { scoreSite } from '@/lib/score-site';
import { buildSideBySide } from '@/lib/compare';
import { getFieldBySlug, getFieldSites, rowsToPeers } from '@/lib/field-from-db';
import { saveScan } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Score one site against a field.
 *
 * POST { url, fieldSlug, save? }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string; fieldSlug?: string; save?: boolean };
    const url = (body.url ?? '').trim();
    const fieldSlug = (body.fieldSlug ?? '').trim();

    if (!url) {
      return NextResponse.json({ ok: false, error: 'Enter a website URL.' }, { status: 400 });
    }
    if (!fieldSlug) {
      return NextResponse.json({ ok: false, error: 'Choose a field to compare against.' }, { status: 400 });
    }

    const field = await getFieldBySlug(fieldSlug);
    if (!field) {
      return NextResponse.json({ ok: false, error: `Field "${fieldSlug}" not found.` }, { status: 404 });
    }

    // Score the submitted site with the full engine (real fetch + signals).
    const scored = await scoreSite(url, { skipPageSpeed: true });
    if (scored.error) {
      return NextResponse.json(
        {
          ok: false,
          error: `Couldn't reach that site — ${scored.error}. It may block automated requests.`,
          unreachable: true,
        },
        { status: 422 }
      );
    }

    const siteRows = await getFieldSites(field.id);
    const peers = rowsToPeers(siteRows);
    const vertical = `${field.industry} in ${field.location}`;
    const side = buildSideBySide(scored, peers, vertical);

    if (body.save) {
      try {
        await saveScan({
          url: scored.finalUrl,
          fieldSlug,
          overall: scored.overall,
          grade: scored.grade,
          percentile: side.you.percentile,
          result: side as unknown,
        });
      } catch {
        // Logging must never break the score the user asked for.
      }
    }

    return NextResponse.json({ ok: true, side, field });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Scoring failed' },
      { status: 500 }
    );
  }
}
