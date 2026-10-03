import { NextResponse } from 'next/server';
import { createWatch, runWatch, watchAlerts, dueWatches, type WatchRow } from '@/lib/monitor';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Create a monitoring subscription. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      email?: string;
      siteUrl?: string;
      fieldSlug?: string;
      cadence?: string;
    };

    const email = (body.email ?? '').trim();
    const siteUrl = (body.siteUrl ?? '').trim();
    const fieldSlug = (body.fieldSlug ?? '').trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (!siteUrl) {
      return NextResponse.json({ ok: false, error: 'Enter your website URL.' }, { status: 400 });
    }
    if (!fieldSlug) {
      return NextResponse.json({ ok: false, error: 'Choose the field to monitor against.' }, { status: 400 });
    }

    const id = await createWatch({
      email,
      siteUrl,
      fieldSlug,
      cadence: body.cadence === 'daily' ? 'daily' : 'weekly',
      plan: body.cadence === 'daily' ? 'watch-pro' : 'watch',
    });

    return NextResponse.json({ ok: true, watchId: id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Could not create watch' },
      { status: 500 }
    );
  }
}

/** List watches for an email, with their latest alerts. */
export async function GET(req: Request) {
  try {
    const email = new URL(req.url).searchParams.get('email')?.trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 });
    }

    const sql = db();
    const rows = await sql<WatchRow[]>`
      SELECT id, email, site_url, field_id, field_slug, plan, cadence
      FROM vantage_watches
      WHERE email = ${email}
      ORDER BY created_at DESC
    `;

    const withAlerts = [];
    for (const w of rows) {
      const alerts = await watchAlerts(w.id, 10);
      withAlerts.push({ ...w, alerts });
    }

    return NextResponse.json({ ok: true, watches: withAlerts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}

/** Trigger a run. Used by the cron job and by "run now" in the UI. */
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { watchId?: string; runDue?: boolean };

    if (body.runDue) {
      const due = await dueWatches(5);
      const results = [];
      for (const w of due) {
        try {
          const r = await runWatch(w);
          results.push({ watchId: w.id, ok: true, score: r.score, alerts: r.alertsCreated });
        } catch (e) {
          results.push({ watchId: w.id, ok: false, error: e instanceof Error ? e.message : 'failed' });
        }
      }
      return NextResponse.json({ ok: true, ran: results.length, results });
    }

    if (!body.watchId) {
      return NextResponse.json({ ok: false, error: 'watchId required' }, { status: 400 });
    }

    const sql = db();
    const rows = await sql<WatchRow[]>`
      SELECT id, email, site_url, field_id, field_slug, plan, cadence
      FROM vantage_watches WHERE id = ${body.watchId} LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Watch not found' }, { status: 404 });
    }

    const r = await runWatch(rows[0]);
    return NextResponse.json({
      ok: true,
      score: r.score,
      grade: r.grade,
      rank: r.rank,
      alertsCreated: r.alertsCreated,
      diff: r.diff,
      overtakes: r.overtakes,
      stayAhead: r.stayAhead,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Run failed' },
      { status: 500 }
    );
  }
}
