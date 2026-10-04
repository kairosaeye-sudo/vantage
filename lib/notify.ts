/**
 * Discord notifications sent by Vantage itself.
 *
 * Vantage had no way to tell anyone a glow-up finished. Notification lived
 * entirely in a Hermes cron polling an API from the user's laptop, which meant
 * nothing was sent if the laptop was closed — the one time you most want to know
 * something ran unattended.
 *
 * This posts straight to Discord using the bot token, so the app notifies
 * independently of any local process.
 *
 * Design notes:
 * - Never throws. A notification failing must not fail the glow-up the customer
 *   asked for; the result is already computed and saved by then.
 * - Disabled silently when the env vars are absent, so local dev and preview
 *   deploys do not post.
 * - Truncates to Discord's 2000-char content limit rather than letting the API
 *   reject the whole message.
 */

const DISCORD_API = 'https://discord.com/api/v10';

export interface NotifyResult {
  sent: boolean;
  reason?: string;
}

export function notificationsEnabled(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_NOTIFY_CHANNEL_ID);
}

export async function notifyDiscord(content: string): Promise<NotifyResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_NOTIFY_CHANNEL_ID;

  if (!token || !channelId) {
    return { sent: false, reason: 'notifications not configured' };
  }

  // Discord rejects content over 2000 chars outright; trim rather than lose it.
  const body = content.length > 1900 ? `${content.slice(0, 1890)}\n…(truncated)` : content;

  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        // Discord's edge rejects requests without a recognisable UA (Cloudflare
        // error 1010) — Node's default fetch UA is blocked.
        'User-Agent': 'DiscordBot (https://vantage-kappa-orcin.vercel.app, 1.0)',
      },
      body: JSON.stringify({ content: body }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { sent: false, reason: `Discord ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : 'unknown error' };
  }
}

/** The message sent when a glow-up finishes. */
export function glowUpMessage(input: {
  url: string;
  beforeScore: number;
  afterScore: number;
  appliedCount: number;
  hasRedesign: boolean;
  fieldSlug: string | null;
  previewId: string | null;
}): string {
  const gain = input.afterScore - input.beforeScore;
  const sign = gain >= 0 ? '+' : '';
  const lines = [
    `**Glow-up finished** — ${input.url}`,
    `${input.beforeScore} → ${input.afterScore} (${sign}${gain})`,
    `${input.appliedCount} technical fix${input.appliedCount === 1 ? '' : 'es'} applied` +
      (input.hasRedesign ? ' + design rebuild' : ''),
    input.fieldSlug ? `Field: ${input.fieldSlug}` : 'No matching field — general glow-up',
  ];
  if (input.previewId) {
    lines.push(
      `https://vantage-kappa-orcin.vercel.app/glowup/preview?id=${input.previewId}`
    );
  }
  return lines.join('\n');
}
