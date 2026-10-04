import type { PageSpeedResult, SiteScore } from './types';
import { fetchSite, normalizeUrl, originOf } from './fetch-site';
import { extractSignals } from './signals';
import {
  combineCategories,
  gradeFor,
  rankFixes,
  scoreAiVisibility,
  scoreContent,
  scoreConversion,
  scoreMobile,
  scorePerformance,
  scoreSearch,
  scoreTrust,
} from './score';

/**
 * Google PageSpeed Insights — official, free, no key strictly required.
 * If a key is provided we get higher rate limits.
 */
export async function runPageSpeed(url: string, timeoutMs = 45000): Promise<PageSpeedResult> {
  const key = process.env.PAGESPEED_API_KEY;
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', 'mobile');
  endpoint.searchParams.set('category', 'performance');
  if (key) endpoint.searchParams.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint.toString(), { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, performanceScore: null, lcpMs: null, cls: null, tbtMs: null, fcpMs: null, speedIndexMs: null, error: `PageSpeed HTTP ${res.status}` };
    }
    const data = await res.json();
    const lh = data?.lighthouseResult;
    const audits = lh?.audits ?? {};
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

    return {
      ok: true,
      performanceScore: num(lh?.categories?.performance?.score) !== null
        ? Math.round((lh.categories.performance.score as number) * 100)
        : null,
      lcpMs: num(audits['largest-contentful-paint']?.numericValue),
      cls: num(audits['cumulative-layout-shift']?.numericValue),
      tbtMs: num(audits['total-blocking-time']?.numericValue),
      fcpMs: num(audits['first-contentful-paint']?.numericValue),
      speedIndexMs: num(audits['speed-index']?.numericValue),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, performanceScore: null, lcpMs: null, cls: null, tbtMs: null, fcpMs: null, speedIndexMs: null, error: msg.includes('abort') ? 'PageSpeed timed out' : msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface ScoreOptions {
  /** Skip PageSpeed to keep scoring fast (used for bulk corpus crawls). */
  skipPageSpeed?: boolean;
  /** Skip the extra network probes (sitemap/robots/llms.txt). */
  skipProbes?: boolean;
}

/**
 * Score raw HTML without fetching it.
 *
 * Needed to measure a page we generated — the redesign, or the rebuilt page —
 * against the same rubric as a live site. Without this, a generated page can
 * never be verified and "better" stays an opinion.
 */
export async function scoreHtml(
  html: string,
  finalUrl: string,
  opts: ScoreOptions & { ttfbMs?: number; bytes?: number } = {}
): Promise<SiteScore> {
  const measuredAt = new Date().toISOString();
  const ttfbMs = opts.ttfbMs ?? 0;
  const bytes = opts.bytes ?? Buffer.byteLength(html, 'utf8');

  const signals = await extractSignals(html, finalUrl, ttfbMs, { skipNetwork: opts.skipProbes });
  const pagespeed = opts.skipPageSpeed ? null : await runPageSpeed(finalUrl);

  const categories = [
    scorePerformance(pagespeed, signals, ttfbMs, ttfbMs, bytes),
    scoreMobile(signals),
    scoreSearch(signals),
    scoreTrust(signals, false),
    scoreContent(signals),
    scoreAiVisibility(signals),
    scoreConversion(signals),
  ];

  const overall = combineCategories(categories);

  return {
    url: finalUrl,
    finalUrl,
    overall,
    grade: gradeFor(overall),
    categories,
    topFixes: rankFixes(categories),
    measuredAt,
    fetch: { status: 200, ttfbMs, totalMs: ttfbMs, bytes },
    pagespeed,
  };
}

/**
 * Score a single site end to end.
 */
export async function scoreSite(inputUrl: string, opts: ScoreOptions = {}): Promise<SiteScore> {
  const measuredAt = new Date().toISOString();
  let url: string;
  try {
    url = normalizeUrl(inputUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid URL';
    return {
      url: inputUrl,
      finalUrl: inputUrl,
      overall: 0,
      grade: 'critical',
      categories: [],
      topFixes: [],
      measuredAt,
      fetch: { status: 0, ttfbMs: 0, totalMs: 0, bytes: 0 },
      pagespeed: null,
      error: msg,
    };
  }

  const fetched = await fetchSite(url);
  if (!fetched.ok || !fetched.html) {
    return {
      url,
      finalUrl: fetched.finalUrl,
      overall: 0,
      grade: 'critical',
      categories: [],
      topFixes: [],
      measuredAt,
      fetch: { status: fetched.status, ttfbMs: fetched.ttfbMs, totalMs: fetched.totalMs, bytes: fetched.bytes },
      pagespeed: null,
      error: fetched.error || 'Could not fetch site',
    };
  }

  const signals = await extractSignals(fetched.html, fetched.finalUrl, fetched.ttfbMs);
  const pagespeed = opts.skipPageSpeed ? null : await runPageSpeed(fetched.finalUrl);

  const categories = [
    scorePerformance(pagespeed, signals, fetched.ttfbMs, fetched.totalMs, fetched.bytes),
    scoreMobile(signals),
    scoreSearch(signals),
    scoreTrust(signals, false),
    scoreContent(signals),
    scoreAiVisibility(signals),
    scoreConversion(signals),
  ];

  const overall = combineCategories(categories);

  return {
    url,
    finalUrl: fetched.finalUrl,
    overall,
    grade: gradeFor(overall),
    categories,
    topFixes: rankFixes(categories),
    measuredAt,
    fetch: {
      status: fetched.status,
      ttfbMs: fetched.ttfbMs,
      totalMs: fetched.totalMs,
      bytes: fetched.bytes,
    },
    pagespeed,
  };
}

export { originOf };
