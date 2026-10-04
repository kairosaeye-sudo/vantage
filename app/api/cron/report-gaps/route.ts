import { NextResponse } from 'next/server';
import { listUnnotifiedGaps, markGapsNotified, describeGap } from '@/lib/field-gaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Report new field-coverage gaps to Discord.
 *
 * Fires from cron. Each gap is reported once — the `notified` flag is set after
 * a successful post, so a failing webhook retries rather than losing the gap.
 *
 * Auth: same CRON_SECRET bearer token as the other cron routes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      { ok: false, error: 'DISCORD_WEBHOOK_URL is not configured' },
      { status: 500 }
    );
  }

  const gaps = await listUnnotifiedGaps();
  if (gaps.length === 0) {
    return NextResponse.json({ ok: true, reported: 0 });
  }

  // One message, not one per gap — a burst of gaps should read as a digest.
  const lines = gaps.slice(0, 10).map((g) => `• ${describeGap(g)}`);
  const more = gaps.length > 10 ? `\n…and ${gaps.length - 10} more.` : '';
  const content = [
    `**Vantage: ${gaps.length} field gap${gaps.length === 1 ? '' : 's'} to review**`,
    'Sites scored against no field — these tell us which field to build next.',
    '',
    ...lines,
    more,
    '',
    'Full list: https://vantage-kappa-orcin.vercel.app/api/gaps',
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `Discord rejected the message (${res.status})`, detail: text.slice(0, 300) },
        { status: 502 }
      );
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Could not reach Discord' },
      { status: 502 }
    );
  }

  await markGapsNotified(gaps.map((g) => g.id));
  return NextResponse.json({ ok: true, reported: gaps.length });
}
