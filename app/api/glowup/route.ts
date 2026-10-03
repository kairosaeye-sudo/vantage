import { NextResponse } from 'next/server';
import { runGlowUp, saveGlowUp, listGlowUps } from '@/lib/glowup-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Run a glow-up.
 *
 * POST { url, watchId? }
 *
 * Returns the verified before/after (re-scored, not estimated), the plan, and
 * what we could not fix with the honest reason for each.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string; watchId?: string };
    const url = (body.url ?? '').trim();
    if (!url) {
      return NextResponse.json({ ok: false, error: 'Enter a website URL.' }, { status: 400 });
    }

    const { record, before, after, files } = await runGlowUp(url);

    if (body.watchId) {
      try {
        await saveGlowUp(body.watchId, record, '', files);
      } catch {
        // Persisting must not break the result the user asked for.
      }
    }

    return NextResponse.json({
      ok: true,
      record: {
        id: record.id,
        url: record.url,
        beforeScore: record.beforeScore,
        afterScore: record.afterScore,
        verifiedGain: record.verifiedGain,
        appliedCount: record.appliedCount,
        skipped: record.skipped,
        files: record.files,
        createdAt: record.createdAt,
      },
      plan: record.plan,
      before: {
        overall: before.overall,
        grade: before.grade,
        categories: before.categories.map((c) => ({ label: c.label, score: c.score })),
      },
      after: {
        overall: after.overall,
        grade: after.grade,
        categories: after.categories.map((c) => ({ label: c.label, score: c.score })),
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Glow-up failed',
        unreachable: true,
      },
      { status: 422 }
    );
  }
}

/** List past glow-ups for a watch. */
export async function GET(req: Request) {
  try {
    const watchId = new URL(req.url).searchParams.get('watchId');
    if (!watchId) {
      return NextResponse.json({ ok: false, error: 'watchId required' }, { status: 400 });
    }
    const rows = await listGlowUps(watchId);
    return NextResponse.json({ ok: true, glowups: rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
