import type { FetchResult } from './types';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 VantageBot/0.1 (+website intelligence)';

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!u) throw new Error('Empty URL');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const parsed = new URL(u);
  if (!parsed.hostname.includes('.')) throw new Error('Invalid hostname');
  return parsed.toString();
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Fetch a page and measure real timing. We deliberately measure TTFB and total
 * time ourselves rather than trusting any third party, so this signal works with
 * zero external API keys.
 */
export async function fetchSite(url: string, timeoutMs = 20000): Promise<FetchResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const ttfbMs = Date.now() - started;
    const body = await res.text();
    const totalMs = Date.now() - started;

    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      html: body,
      ttfbMs,
      totalMs,
      bytes: Buffer.byteLength(body, 'utf8'),
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    const totalMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: '',
      ttfbMs: totalMs,
      totalMs,
      bytes: 0,
      error: msg.includes('abort') ? 'Timed out' : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkExists(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
