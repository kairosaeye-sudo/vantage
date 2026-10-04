import { NextResponse } from 'next/server';
import { notificationsEnabled, lastNotifyResult, notifyDiscord } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Discord notification health.
 *
 * Instant-only notification has no polling backstop, so a silently-failing post
 * would mean a glow-up finished and nobody was told. This reports whether
 * notifications are configured and what happened on the last attempt.
 *
 * GET /api/notify/health        → configuration + last result
 * GET /api/notify/health?test=1 → send a test message and report the outcome
 */
export async function GET(req: Request) {
  const test = new URL(req.url).searchParams.get('test');
  const configured = notificationsEnabled();

  let testResult: { sent: boolean; reason?: string } | null = null;
  if (test && configured) {
    testResult = await notifyDiscord('**Vantage** — notification test. If you can read this, glow-up alerts are working.');
  }

  return NextResponse.json({
    ok: true,
    configured,
    missing: configured
      ? []
      : ['DISCORD_BOT_TOKEN', 'DISCORD_NOTIFY_CHANNEL_ID'].filter((k) => !process.env[k]),
    lastAttempt: lastNotifyResult(),
    testResult,
  });
}
