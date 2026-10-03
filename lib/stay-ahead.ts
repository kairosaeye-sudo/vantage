import type { SiteScore, Finding } from './types';
import { compareToField, type FieldStats, type ComparisonRow } from './compare';

/**
 * The paid product: what to do next to stay ahead of the field.
 *
 * Where the free check answers "where do I stand?", this answers "what do I do
 * about it, and what are my competitors about to beat me on?".
 *
 * Three kinds of advice, in priority order:
 *   1. DEFEND  — a competitor beats you here; if you do nothing you keep losing.
 *   2. ATTACK  — you beat the field here, but not the leader. Closing this wins
 *                you the category outright.
 *   3. MAINTAIN — you lead here. Keep it; a regression would cost you rank.
 */

export type AdviceKind = 'defend' | 'attack' | 'maintain';

export interface Advice {
  kind: AdviceKind;
  priority: number;
  category: string;
  title: string;
  /** Why this matters in business terms, not technical terms. */
  rationale: string;
  /** Concrete actions, phrased so a non-technical owner can act. */
  actions: string[];
  /** Estimated points available. */
  upside: number;
  you: number;
  fieldAvg: number;
  leader: number;
  leaderUrl: string | null;
  findings: Finding[];
}

/** Category-specific playbooks — what "fixing it" actually means. */
const PLAYBOOK: Record<string, string[]> = {
  performance: [
    'Compress and resize images (aim under 200KB each)',
    'Enable caching on your host',
    'Remove unused scripts and plugins',
  ],
  mobile: [
    'Add a viewport meta tag so the page fits a phone screen',
    'Make the phone number tappable (tel: link)',
    'Check every page on a real phone, not just a desktop browser',
  ],
  search: [
    'Write a unique title and meta description for every page',
    'Add an XML sitemap and submit it to Google Search Console',
    'Use exactly one H1 per page describing what it is',
  ],
  trust: [
    'Add LocalBusiness structured data so Google and AI engines can verify you',
    'Show reviews and star ratings on the site itself',
    'Display your licence number, address and hours',
  ],
  content: [
    'Add a page for each service you offer, with real detail',
    'Start a blog answering the questions customers actually ask',
    'Update the copyright year so the site does not read as abandoned',
  ],
  aiVisibility: [
    'Add FAQ sections — this is what AI engines quote when recommending a business',
    'Allow GPTBot and ClaudeBot in robots.txt',
    'Add llms.txt describing your services',
  ],
  conversion: [
    'Add a contact or quote form — not everyone will call',
    'Add online booking so you capture after-hours enquiries',
    'Make the primary call to action obvious above the fold',
  ],
};

export interface StayAheadReport {
  you: { url: string; overall: number; grade: string; percentile: number };
  field: { industry: string; location: string; siteCount: number; avg: number };
  leader: { url: string; score: number } | null;
  rank: number;
  advice: Advice[];
  /** The single most important thing, stated plainly. */
  headline: string;
}

/**
 * Build the stay-ahead plan.
 *
 * `peers` must include the customer's own site so the leader can be identified
 * and the customer excluded from their own comparison.
 */
export function buildStayAhead(
  you: SiteScore,
  peers: SiteScore[],
  field: FieldStats,
  labels: { industry: string; location: string }
): StayAheadReport {
  const others = peers.filter((p) => !p.error && p.finalUrl !== you.finalUrl);
  const ranked = [...others].sort((a, b) => b.overall - a.overall);
  const leader = ranked[0] ?? null;

  const rows: ComparisonRow[] = compareToField(you, field, peers);
  const rank = ranked.filter((p) => p.overall > you.overall).length + 1;

  const advice: Advice[] = [];

  for (const row of rows) {
    const cat = you.categories.find((c) => c.key === row.category);
    const actions = PLAYBOOK[row.category] ?? [];

    // Which of our own findings are still failing in this category?
    const open = (cat?.findings ?? [])
      .filter((f) => f.status === 'fail' || f.status === 'warn')
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 4);

    // Who is the best performer in this category, and by how much?
    const leaderInCat = others
      .map((p) => ({
        url: p.finalUrl,
        score: p.categories.find((c) => c.key === row.category)?.score ?? 0,
      }))
      .sort((a, b) => b.score - a.score)[0] ?? null;

    const gapToLeader = leaderInCat ? leaderInCat.score - row.you : 0;
    const weight = cat?.weight ?? 0;

    if (row.verdict === 'lagging' || row.verdict === 'below') {
      advice.push({
        kind: 'defend',
        priority: 0,
        category: row.label,
        title: `You're behind the field on ${row.label.toLowerCase()}`,
        rationale:
          `The field averages ${row.fieldAvg} here and you're at ${row.you}. ` +
          (gapToLeader > 0
            ? `The best site scores ${leaderInCat?.score}. This is a category where competitors are actively beating you.`
            : `This is a category where competitors are actively beating you.`),
        actions,
        upside: Math.round(((row.fieldAvg - row.you) / 100) * weight * 100 * 10) / 10,
        you: row.you,
        fieldAvg: row.fieldAvg,
        leader: row.leader,
        leaderUrl: leaderInCat?.url ?? null,
        findings: open,
      });
    } else if (row.verdict === 'above' && gapToLeader > 3) {
      advice.push({
        kind: 'attack',
        priority: 1,
        category: row.label,
        title: `Close the ${Math.round(gapToLeader)}-point gap on ${row.label.toLowerCase()}`,
        rationale:
          `You beat the field average (${row.fieldAvg}) but the leader sits at ${leaderInCat?.score}. ` +
          `Winning this category outright moves you up the ranking.`,
        actions,
        upside: Math.round((gapToLeader / 100) * weight * 100 * 10) / 10,
        you: row.you,
        fieldAvg: row.fieldAvg,
        leader: row.leader,
        leaderUrl: leaderInCat?.url ?? null,
        findings: open,
      });
    } else if (row.verdict === 'leading') {
      advice.push({
        kind: 'maintain',
        priority: 2,
        category: row.label,
        title: `Defend your lead on ${row.label.toLowerCase()}`,
        rationale:
          `You lead the field here (${row.you} vs ${row.fieldAvg} average). ` +
          `Keep it — a regression in a category you lead costs you more rank than gaining elsewhere.`,
        actions,
        upside: 0,
        you: row.you,
        fieldAvg: row.fieldAvg,
        leader: row.leader,
        leaderUrl: leaderInCat?.url ?? null,
        findings: open,
      });
    }
  }

  // Defend first, then attack, then maintain; within a kind, biggest upside first.
  advice.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.upside - a.upside;
  });

  const headline =
    advice.length === 0
      ? `You're at ${you.overall}/100 — no significant gaps against the field.`
      : advice[0].kind === 'defend'
        ? `Priority: ${advice[0].title}. This is costing you rank today.`
        : advice[0].kind === 'attack'
          ? `You're ${rank} of ${others.length + 1}. ${advice[0].title} to move up.`
          : `You lead the field in every category. Maintain it.`;

  return {
    you: { url: you.finalUrl, overall: you.overall, grade: you.grade, percentile: 0 },
    field: {
      industry: labels.industry,
      location: labels.location,
      siteCount: field.siteCount,
      avg: field.avg,
    },
    leader: leader ? { url: leader.finalUrl, score: leader.overall } : null,
    rank,
    advice,
    headline,
  };
}
