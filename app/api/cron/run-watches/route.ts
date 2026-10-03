import { NextResponse } from 'next/server';
import { dueWatches, runWatch } from '@/lib/monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Scheduled monitoring run.
 *
 * Intended to be called by Vercel Cron (see vercel.json). Protected by a shared
 * secret so the endpoint cannot be triggered by anyone who finds the URL.
 *
 *   GET /api/cron/run-watches?key=<CRON_SECRET>
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(req.url).searchParams.get('key');

  // If no secret is configured we still refuse in production, rather than
  // leaving an open endpoint that burns PageSpeed quota and scores strangers.
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured.' },
      { status: 503 }
    );
  }
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const due = await dueWatches(5);
  const results: Array<Record<string, unknown>> = [];

  for (const w of due) {
    try {
      const r = await runWatch(w);
      results.push({
        watchId: w.id,
        site: w.site_url,
        ok: true,
        score: r.score,
        rank: r.rank,
        alertsCreated: r.alertsCreated,
        overtakes: r.overtakes.length,
        regressions: r.diff?.regressions.length ?? 0,
      });
    } catch (e) {
      results.push({
        watchId: w.id,
        site: w.site_url,
        ok: false,
        error: e instanceof Error ? e.message : 'failed',
      });
    }
  }

  return NextResponse.json({ ok: true, due: due.length, results });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
