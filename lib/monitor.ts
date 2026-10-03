import { randomUUID, createHash } from 'crypto';
import { db } from './db';
import { scoreSite } from './score-site';
import { buildFieldStats } from './compare';
import { buildStayAhead, type StayAheadReport } from './stay-ahead';
import { diffScans, detectOvertakes, rankMovement, type SiteDiff, type Overtake } from './diff';
import type { SiteScore } from './types';

/**
 * The monitoring run — the engine behind the paid tier.
 *
 * For one watch:
 *   1. Re-score the customer's site and every site in their field.
 *   2. Store a snapshot of each.
 *   3. Diff against the previous run.
 *   4. Turn the diff into alerts (deduped so we do not nag).
 *   5. Produce the stay-ahead plan.
 */

export interface WatchRunResult {
  watchId: string;
  runId: string;
  siteUrl: string;
  score: number;
  grade: string;
  previousScore: number | null;
  diff: SiteDiff | null;
  overtakes: Overtake[];
  rank: number;
  movement: Array<{ url: string; beforeRank: number; afterRank: number; moved: number }>;
  stayAhead: StayAheadReport;
  alertsCreated: number;
  failed: string[];
}

export interface WatchRow {
  id: string;
  email: string;
  site_url: string;
  field_id: string | null;
  field_slug: string;
  plan: string;
  cadence: string;
}

/** Stable identity for an alert, so a persistent problem does not re-alert. */
function fingerprint(parts: Array<string | number>): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Canonical form for comparing two URLs that may differ only in trivial ways
 * (trailing slash, www, case, default port). The watch stores whatever the
 * customer typed; the scorer stores the post-redirect finalUrl, so a raw string
 * comparison misses.
 */
function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, '').toLowerCase();
  }
}

async function getFieldSitesForScoring(fieldId: string): Promise<Array<{ url: string }>> {
  const sql = db();
  return sql<Array<{ url: string }>>`
    SELECT url FROM vantage_sites WHERE field_id = ${fieldId} AND error IS NULL
  `;
}

/** The most recent completed run's snapshots for a watch. */
async function previousSnapshots(watchId: string, runId: string) {
  const sql = db();
  const last = await sql<Array<{ run_id: string }>>`
    SELECT DISTINCT run_id FROM vantage_snapshots
    WHERE watch_id = ${watchId} AND run_id <> ${runId}
    ORDER BY run_id DESC
    LIMIT 1
  `;
  if (last.length === 0) return [];
  return sql<Array<{ url: string; is_self: boolean; overall: number | null; score: unknown }>>`
    SELECT url, is_self, overall, score FROM vantage_snapshots
    WHERE watch_id = ${watchId} AND run_id = ${last[0].run_id}
  `;
}

export async function runWatch(watch: WatchRow): Promise<WatchRunResult> {
  const sql = db();
  const runId = new Date().toISOString();
  const failed: string[] = [];

  // Which sites do we score? The customer's own, plus the field members.
  // Dedupe canonically: the same site can appear as both "site.com" and
  // "https://www.site.com/" and must not be scored (or billed) twice.
  const fieldSites = watch.field_id ? await getFieldSitesForScoring(watch.field_id) : [];
  const byKey = new Map<string, string>();
  for (const u of [watch.site_url, ...fieldSites.map((f) => f.url)]) {
    const key = canonicalUrl(u);
    if (!byKey.has(key)) byKey.set(key, u);
  }
  const targets = Array.from(byKey.values());

  const scored: SiteScore[] = [];
  for (const t of targets) {
    const s = await scoreSite(t, { skipPageSpeed: true });
    scored.push(s);
    if (s.error) failed.push(t);
  }

  const ok = scored.filter((s) => !s.error);
  const selfKey = canonicalUrl(watch.site_url);
  const self = scored.find((s) => canonicalUrl(s.finalUrl) === selfKey || canonicalUrl(s.url) === selfKey);

  if (!self || self.error) {
    throw new Error(`Could not score the watched site: ${self?.error ?? 'not found in run'}`);
  }

  // Persist a snapshot per site.
  for (const s of scored) {
    await sql`
      INSERT INTO vantage_snapshots (
        id, watch_id, field_id, run_id, url, domain, is_self,
        overall, grade, categories, findings, score, error
      ) VALUES (
        ${randomUUID()}, ${watch.id}, ${watch.field_id}, ${runId},
        ${s.finalUrl}, ${domainOf(s.finalUrl)}, ${s.finalUrl === self.finalUrl},
        ${s.error ? null : s.overall}, ${s.error ? null : s.grade},
        ${sql.json(Object.fromEntries(s.categories.map((c) => [c.key, c.score])) as never)},
        ${sql.json(
          Object.fromEntries(
            s.categories.map((c) => [c.key, c.findings.map((f) => ({ id: f.id, status: f.status }))])
          ) as never
        )},
        ${sql.json(s as never)},
        ${s.error ?? null}
      )
    `;
  }

  // Diff against the previous run.
  const prev = await previousSnapshots(watch.id, runId);
  const prevSelf = prev.find((p) => p.is_self);

  let diff: SiteDiff | null = null;
  if (prevSelf && prevSelf.score) {
    try {
      diff = diffScans(prevSelf.score as SiteScore, self);
    } catch {
      diff = null; // a shape change must not break the run
    }
  }

  // Competitor movement.
  const beforeRows = prev
    .filter((p) => p.overall !== null)
    .map((p) => ({ url: p.url, score: p.overall as number }));
  const afterRows = ok.map((s) => ({ url: s.finalUrl, score: s.overall }));

  const overtakes = beforeRows.length > 0 ? detectOvertakes(beforeRows, afterRows, self.finalUrl) : [];
  const movement = beforeRows.length > 0 ? rankMovement(beforeRows, afterRows) : [];

  const field = buildFieldStats(`${watch.field_slug}`, ok);
  const stayAhead = buildStayAhead(self, ok, field, {
    industry: watch.field_slug,
    location: '',
  });

  // Alerts — deduped.
  let alertsCreated = 0;
  const raise = async (
    kind: string,
    severity: string,
    title: string,
    body: string,
    payload: unknown,
    fp: string
  ) => {
    const inserted = await sql`
      INSERT INTO vantage_alerts (id, watch_id, fingerprint, severity, kind, title, body, payload)
      VALUES (${randomUUID()}, ${watch.id}, ${fp}, ${severity}, ${kind}, ${title}, ${body}, ${sql.json(payload as never)})
      ON CONFLICT (watch_id, fingerprint) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) alertsCreated++;
  };

  // 1. A competitor overtook the customer — the highest-value alert.
  for (const o of overtakes.slice(0, 3)) {
    await raise(
      'overtaken',
      'critical',
      `${domainOf(o.overtaker)} moved ahead of you`,
      `${domainOf(o.overtaker)} now scores ${o.overtakerScore} against your ${o.overtakenScore} — a ${o.delta}-point gap. They were behind you last run.`,
      o,
      fingerprint(['overtaken', o.overtaker, Math.round(o.overtakerScore)])
    );
  }

  // 2. A regression on the customer's own site.
  if (diff) {
    for (const r of diff.regressions.slice(0, 5)) {
      await raise(
        'regression',
        r.severity,
        `${r.label} regressed`,
        `In ${r.category}, "${r.label}" went from ${r.from} to ${r.to}. ${r.detail}`,
        r,
        fingerprint(['regression', r.findingId, r.to])
      );
    }

    // 3. Score drop.
    if (diff.scoreDelta <= -5) {
      await raise(
        'score-drop',
        'critical',
        `Your score dropped ${Math.abs(diff.scoreDelta)} points`,
        `${diff.beforeScore} → ${diff.afterScore}. ${diff.summary}`,
        diff,
        fingerprint(['score-drop', diff.beforeScore, diff.afterScore])
      );
    }

    // 4. Improvements are worth telling them about.
    for (const i of diff.improvements.slice(0, 5)) {
      await raise(
        'improvement',
        'positive',
        `${i.label} fixed`,
        `In ${i.category}, "${i.label}" went from ${i.from} to ${i.to}.`,
        i,
        fingerprint(['improvement', i.findingId, i.to])
      );
    }
  }

  await sql`
    UPDATE vantage_watches SET
      last_run_at = NOW(),
      last_score = ${self.overall},
      last_grade = ${self.grade},
      next_run_at = ${watch.cadence === 'daily' ? sql`NOW() + INTERVAL '1 day'` : sql`NOW() + INTERVAL '7 days'`}
    WHERE id = ${watch.id}
  `;

  return {
    watchId: watch.id,
    runId,
    siteUrl: self.finalUrl,
    score: self.overall,
    grade: self.grade,
    previousScore: prevSelf?.overall ?? null,
    diff,
    overtakes,
    rank: stayAhead.rank,
    movement: movement.map((m) => ({
      url: m.url,
      beforeRank: m.beforeRank,
      afterRank: m.afterRank,
      moved: m.moved,
    })),
    stayAhead,
    alertsCreated,
    failed,
  };
}

export async function createWatch(params: {
  email: string;
  siteUrl: string;
  fieldSlug: string;
  cadence?: string;
  plan?: string;
}): Promise<string> {
  const sql = db();
  const id = randomUUID();

  const field = await sql<Array<{ id: string }>>`
    SELECT id FROM vantage_fields WHERE slug = ${params.fieldSlug} LIMIT 1
  `;

  await sql`
    INSERT INTO vantage_watches (id, email, site_url, field_id, field_slug, plan, cadence, next_run_at)
    VALUES (
      ${id}, ${params.email}, ${params.siteUrl}, ${field[0]?.id ?? null},
      ${params.fieldSlug}, ${params.plan ?? 'watch'}, ${params.cadence ?? 'weekly'}, NOW()
    )
  `;
  return id;
}

export async function dueWatches(limit = 10): Promise<WatchRow[]> {
  const sql = db();
  return sql<WatchRow[]>`
    SELECT id, email, site_url, field_id, field_slug, plan, cadence
    FROM vantage_watches
    WHERE status = 'active' AND (next_run_at IS NULL OR next_run_at <= NOW())
    ORDER BY next_run_at ASC NULLS FIRST
    LIMIT ${limit}
  `;
}

export async function watchAlerts(watchId: string, limit = 20) {
  const sql = db();
  return sql`
    SELECT id, severity, kind, title, body, created_at AS "createdAt"
    FROM vantage_alerts
    WHERE watch_id = ${watchId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
