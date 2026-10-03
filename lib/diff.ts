import type { SiteScore, CategoryScore } from './types';

/**
 * Change detection between two scans of the same site.
 *
 * The scoring engine gives every finding a stable `id`, which is what makes
 * real diffing possible: we can tell that `viewport` went pass -> fail, not
 * merely that the score dropped.
 */

export type ChangeKind =
  | 'regression' // something that was fine now is not
  | 'improvement' // something broken got fixed
  | 'score-up'
  | 'score-down'
  | 'new-finding'
  | 'resolved';

export type ChangeSeverity = 'critical' | 'warning' | 'positive' | 'info';

export interface Change {
  kind: ChangeKind;
  severity: ChangeSeverity;
  category: string;
  findingId: string;
  label: string;
  from: string;
  to: string;
  /** Points lost (negative) or gained (positive) from this change. */
  delta: number;
  detail: string;
}

export interface CategoryDelta {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
}

export interface SiteDiff {
  url: string;
  beforeScore: number;
  afterScore: number;
  scoreDelta: number;
  beforeGrade: string;
  afterGrade: string;
  categories: CategoryDelta[];
  changes: Change[];
  regressions: Change[];
  improvements: Change[];
  summary: string;
}

const RANK: Record<string, number> = { fail: 0, warn: 1, unknown: 1.5, pass: 2 };

function categoryMap(cats: CategoryScore[]): Map<string, CategoryScore> {
  return new Map(cats.map((c) => [c.key, c]));
}

/**
 * Diff two scans of the same site.
 *
 * `before` may be null for a first-ever scan — in that case every finding is
 * reported as baseline rather than as a change.
 */
export function diffScans(before: SiteScore, after: SiteScore): SiteDiff {
  const changes: Change[] = [];

  const beforeCats = categoryMap(before.categories);
  const afterCats = categoryMap(after.categories);

  const categories: CategoryDelta[] = [];
  for (const [key, a] of afterCats) {
    const b = beforeCats.get(key);
    const bScore = b?.score ?? 0;
    categories.push({
      key,
      label: a.label,
      before: bScore,
      after: a.score,
      delta: a.score - bScore,
    });

    // Compare finding-by-finding inside this category.
    const beforeFindings = new Map((b?.findings ?? []).map((f) => [f.id, f]));
    for (const af of a.findings) {
      const bf = beforeFindings.get(af.id);
      if (!bf) {
        changes.push({
          kind: 'new-finding',
          severity: 'info',
          category: a.label,
          findingId: af.id,
          label: af.label,
          from: 'not measured',
          to: af.status,
          delta: 0,
          detail: af.detail,
        });
        continue;
      }
      if (bf.status === af.status) continue;

      const worsened = (RANK[af.status] ?? 1) < (RANK[bf.status] ?? 1);
      const gained = worsened ? -bf.impact : af.impact;

      changes.push({
        kind: worsened ? 'regression' : 'improvement',
        severity: worsened ? (af.status === 'fail' ? 'critical' : 'warning') : 'positive',
        category: a.label,
        findingId: af.id,
        label: af.label,
        from: bf.status,
        to: af.status,
        delta: Math.round(gained * 10) / 10,
        detail: af.detail,
      });
    }
  }

  const scoreDelta = after.overall - before.overall;

  const regressions = changes
    .filter((c) => c.kind === 'regression')
    .sort((a, b) => a.delta - b.delta);
  const improvements = changes
    .filter((c) => c.kind === 'improvement')
    .sort((a, b) => b.delta - a.delta);

  // Overall movement, if it is big enough to be real rather than noise.
  if (Math.abs(scoreDelta) >= 2) {
    changes.unshift({
      kind: scoreDelta > 0 ? 'score-up' : 'score-down',
      severity: scoreDelta > 0 ? 'positive' : scoreDelta <= -5 ? 'critical' : 'warning',
      category: 'Overall',
      findingId: 'overall',
      label: 'Overall score',
      from: String(before.overall),
      to: String(after.overall),
      delta: scoreDelta,
      detail:
        scoreDelta > 0
          ? `Overall score rose ${scoreDelta} points.`
          : `Overall score fell ${Math.abs(scoreDelta)} points.`,
    });
  }

  const summary = buildSummary(before.overall, after.overall, regressions, improvements);

  return {
    url: after.finalUrl,
    beforeScore: before.overall,
    afterScore: after.overall,
    scoreDelta,
    beforeGrade: before.grade,
    afterGrade: after.grade,
    categories,
    changes,
    regressions,
    improvements,
    summary,
  };
}

function buildSummary(
  beforeScore: number,
  afterScore: number,
  regressions: Change[],
  improvements: Change[]
): string {
  if (regressions.length === 0 && improvements.length === 0) {
    return `No change since the last scan (still ${afterScore}/100).`;
  }
  const parts: string[] = [];
  if (improvements.length > 0) {
    parts.push(`${improvements.length} improvement${improvements.length === 1 ? '' : 's'}`);
  }
  if (regressions.length > 0) {
    parts.push(`${regressions.length} regression${regressions.length === 1 ? '' : 's'}`);
  }
  const dir = afterScore > beforeScore ? 'up' : afterScore < beforeScore ? 'down' : 'flat';
  return `${beforeScore} → ${afterScore} (${dir}). ${parts.join(', ')}.`;
}

/* ------------------------------------------------------------------ */
/* Competitor movement                                                 */
/* ------------------------------------------------------------------ */

export interface Overtake {
  /** Who moved past whom. */
  overtaker: string;
  overtaken: string;
  overtakerScore: number;
  overtakenScore: number;
  delta: number;
}

/**
 * Compare the standing of every site in a field between two runs.
 *
 * This is the signal a monitoring subscriber actually pays for: not that their
 * own score changed, but that a named competitor moved past them.
 */
export function detectOvertakes(
  before: Array<{ url: string; score: number }>,
  after: Array<{ url: string; score: number }>,
  youUrl: string
): Overtake[] {
  const beforeBy = new Map(before.map((b) => [b.url, b.score]));
  const overtakes: Overtake[] = [];

  const youBefore = beforeBy.get(youUrl);
  const youAfter = after.find((a) => a.url === youUrl)?.score;
  if (youBefore === undefined || youAfter === undefined) return [];

  for (const a of after) {
    if (a.url === youUrl) continue;
    const b = beforeBy.get(a.url);
    if (b === undefined) continue;

    const wasAhead = youBefore > b; // you led them before
    const isBehind = youAfter < a.score; // they lead you now
    if (wasAhead && isBehind) {
      overtakes.push({
        overtaker: a.url,
        overtaken: youUrl,
        overtakerScore: a.score,
        overtakenScore: youAfter,
        delta: Math.round((a.score - youAfter) * 10) / 10,
      });
    }
  }

  return overtakes.sort((x, y) => y.delta - x.delta);
}

export interface RankChange {
  url: string;
  beforeRank: number;
  afterRank: number;
  beforeScore: number;
  afterScore: number;
  moved: number; // positive = climbed
}

/** Rank movement for every site in the field. */
export function rankMovement(
  before: Array<{ url: string; score: number }>,
  after: Array<{ url: string; score: number }>
): RankChange[] {
  const rank = (rows: Array<{ url: string; score: number }>) => {
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    return new Map(sorted.map((r, i) => [r.url, i + 1]));
  };
  const beforeRank = rank(before);
  const afterRank = rank(after);

  const out: RankChange[] = [];
  for (const a of after) {
    const b = before.find((x) => x.url === a.url);
    if (!b) continue;
    const br = beforeRank.get(a.url) ?? 0;
    const ar = afterRank.get(a.url) ?? 0;
    out.push({
      url: a.url,
      beforeRank: br,
      afterRank: ar,
      beforeScore: b.score,
      afterScore: a.score,
      moved: br - ar,
    });
  }
  return out.sort((x, y) => y.moved - x.moved);
}
