import { randomUUID } from 'crypto';
import { db } from './db';
import { scoreSite } from './score-site';
import { fetchSite } from './fetch-site';
import { planGlowUp, applyGlowUp, type GlowUpPlan } from './glowup';
import { extractSignals } from './signals';
import {
  scorePerformance,
  scoreMobile,
  scoreSearch,
  scoreTrust,
  scoreContent,
  scoreAiVisibility,
  scoreConversion,
  combineCategories,
  gradeFor,
} from './score';
import type { SiteScore } from './types';

/**
 * Glow-up as part of monitoring.
 *
 * The free check produces a score. The glow-up produces the improved site AND a
 * verified before/after by re-running the rebuilt HTML through the same scoring
 * engine. The monitoring loop then tracks whether the gain held, and what the
 * field did meanwhile.
 *
 * Honesty rules enforced here:
 *  - `verifiedGain` is measured, never estimated. We re-score the rebuilt HTML.
 *  - Anything we cannot do in a rebuild is listed as `needsWork` with a reason.
 *  - A glow-up that does not improve the score is reported as such.
 */

export interface GlowUpRecord {
  id: string;
  url: string;
  beforeScore: number;
  afterScore: number;
  verifiedGain: number;
  plan: GlowUpPlan;
  appliedCount: number;
  skipped: Array<{ findingId: string; reason: string }>;
  files: string[];
  createdAt: string;
}

/** Re-score rebuilt HTML through the real engine. */
export async function rescoreHtml(
  html: string,
  finalUrl: string,
  ttfbMs: number,
  totalMs: number
): Promise<SiteScore> {
  const signals = await extractSignals(html, finalUrl, ttfbMs);
  const bytes = Buffer.byteLength(html);

  const categories = [
    scorePerformance(null, signals, ttfbMs, totalMs, bytes),
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
    topFixes: [],
    measuredAt: new Date().toISOString(),
    fetch: { status: 200, ttfbMs, totalMs, bytes },
    pagespeed: null,
  };
}

/**
 * Run a glow-up for a URL and verify the result.
 *
 * Does not persist by default — call `saveGlowUp` to store it.
 */
export async function runGlowUp(url: string): Promise<{
  record: GlowUpRecord;
  html: string;
  files: Record<string, string>;
  before: SiteScore;
  after: SiteScore;
  /** The fixes actually applied — the ground truth for what changed. */
  applied: Array<{ findingId: string; label: string; category: string; points: number }>;
}> {
  const before = await scoreSite(url, { skipPageSpeed: true });
  if (before.error) {
    throw new Error(`Could not score ${url}: ${before.error}`);
  }

  const fetched = await fetchSite(before.finalUrl);
  const result = applyGlowUp(before, fetched.html);
  const after = await rescoreHtml(result.html, before.finalUrl, fetched.ttfbMs, fetched.totalMs);

  const record: GlowUpRecord = {
    id: randomUUID(),
    url: before.finalUrl,
    beforeScore: before.overall,
    afterScore: after.overall,
    verifiedGain: after.overall - before.overall,
    plan: planGlowUp(before),
    appliedCount: result.applied.length,
    skipped: result.skipped,
    files: Object.keys(result.files),
    createdAt: new Date().toISOString(),
  };

  return { record, html: result.html, files: result.files, before, after, applied: result.applied };
}

export async function saveGlowUp(
  watchId: string,
  record: GlowUpRecord,
  html: string,
  files: Record<string, string>
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO vantage_glowups (
      id, watch_id, url, before_score, after_score, verified_gain,
      plan, applied_count, skipped, files, html, artifacts
    ) VALUES (
      ${record.id}, ${watchId}, ${record.url}, ${record.beforeScore}, ${record.afterScore},
      ${record.verifiedGain}, ${sql.json(record.plan as never)}, ${record.appliedCount},
      ${sql.json(record.skipped as never)}, ${sql.json(record.files as never)},
      ${html}, ${sql.json(files as never)}
    )
  `;
}

export async function listGlowUps(watchId: string) {
  const sql = db();
  return sql`
    SELECT id, url, before_score AS "beforeScore", after_score AS "afterScore",
           verified_gain AS "verifiedGain", applied_count AS "appliedCount",
           created_at AS "createdAt"
    FROM vantage_glowups
    WHERE watch_id = ${watchId}
    ORDER BY created_at DESC
  `;
}

/**
 * The next round of glow-ups.
 *
 * After a site has been improved, the remaining gaps are different — mostly the
 * things a rebuild cannot fix, plus whatever the field has since moved on. This
 * is what the customer pays for month after month.
 */
export interface NextRound {
  currentScore: number;
  stillFixable: GlowUpPlan['fixes'];
  needsWork: GlowUpPlan['needsWork'];
  /** Categories where the field has moved ahead since the last glow-up. */
  fieldPressure: Array<{ category: string; you: number; fieldAvg: number; gap: number }>;
  headline: string;
}

export async function nextRound(url: string, fieldScores?: Array<{ category: string; avg: number }>): Promise<NextRound> {
  const site = await scoreSite(url, { skipPageSpeed: true });
  if (site.error) throw new Error(site.error);

  const plan = planGlowUp(site);

  const fieldPressure = (fieldScores ?? [])
    .map((f) => {
      const mine = site.categories.find((c) => c.label === f.category)?.score ?? 0;
      return { category: f.category, you: mine, fieldAvg: f.avg, gap: f.avg - mine };
    })
    .filter((f) => f.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  const headline =
    plan.fixes.length > 0
      ? `${plan.fixes.length} more fix${plan.fixes.length === 1 ? '' : 'es'} available worth about +${plan.estimatedGain} points.`
      : fieldPressure.length > 0
        ? `Nothing left to fix in a rebuild — but the field leads you in ${fieldPressure.length} categor${fieldPressure.length === 1 ? 'y' : 'ies'}.`
        : 'You are ahead of the field and there is nothing left to fix in a rebuild.';

  return {
    currentScore: site.overall,
    stillFixable: plan.fixes,
    needsWork: plan.needsWork,
    fieldPressure,
    headline,
  };
}
