import type { SiteScore, CategoryScore, Finding } from './types';
import { percentileAgainst, gradeFor } from './score';

export interface FieldStats {
  vertical: string;
  siteCount: number;
  avg: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  categories: Record<string, { avg: number; median: number; p25: number; p75: number }>;
}

export interface ComparisonRow {
  category: string;
  label: string;
  you: number;
  fieldAvg: number;
  fieldMedian: number;
  leader: number;
  delta: number; // you - fieldAvg
  verdict: 'leading' | 'above' | 'below' | 'lagging';
}

export interface Recommendation {
  rank: number;
  finding: Finding;
  category: string;
  /** Estimated points this single fix would add to the overall score. */
  scoreGain: number;
  /** Plain-English framing of why it matters, in business terms. */
  businessCase: string;
}

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return {
    avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    median: s[Math.floor(s.length / 2)],
    p25: s[Math.floor(s.length * 0.25)],
    p75: Math.floor(s.length * 0.75) < s.length ? s[Math.floor(s.length * 0.75)] : s[s.length - 1],
    min: s[0],
    max: s[s.length - 1],
  };
}

export function buildFieldStats(vertical: string, scores: SiteScore[]): FieldStats {
  const ok = scores.filter((s) => !s.error);
  const overalls = ok.map((s) => s.overall);
  const o = stats(overalls.length ? overalls : [0]);

  const categories: FieldStats['categories'] = {};
  const catKeys = ok[0]?.categories.map((c) => c.key) ?? [];
  for (const key of catKeys) {
    const vals = ok.map((r) => r.categories.find((c) => c.key === key)?.score ?? 0);
    categories[key] = stats(vals.length ? vals : [0]);
  }

  return {
    vertical,
    siteCount: ok.length,
    avg: o.avg,
    median: o.median,
    p25: o.p25,
    p75: o.p75,
    min: o.min,
    max: o.max,
    categories,
  };
}

export function compareToField(you: SiteScore, field: FieldStats, peers: SiteScore[]): ComparisonRow[] {
  const okPeers = peers.filter((p) => !p.error && p.finalUrl !== you.finalUrl);

  return you.categories.map((c) => {
    const fs = field.categories[c.key];
    const peerScores = okPeers
      .map((p) => p.categories.find((x) => x.key === c.key)?.score ?? 0)
      .sort((a, b) => b - a);
    const leader = peerScores[0] ?? c.score;
    const delta = c.score - (fs?.avg ?? 0);

    let verdict: ComparisonRow['verdict'];
    if (delta >= 8) verdict = 'leading';
    else if (delta >= 0) verdict = 'above';
    else if (delta >= -8) verdict = 'below';
    else verdict = 'lagging';

    return {
      category: c.key,
      label: c.label,
      you: c.score,
      fieldAvg: fs?.avg ?? 0,
      fieldMedian: fs?.median ?? 0,
      leader,
      delta,
      verdict,
    };
  });
}

const BUSINESS_CASE: Record<string, string> = {
  viewport:
    'Most local searches happen on a phone. Without a viewport tag the page renders at desktop zoom and visitors pinch-zoom or leave.',
  responsive:
    'If the layout does not adapt, mobile visitors see a broken page — and Google uses mobile-first indexing, so it hurts rankings too.',
  tap: 'A phone number that is not tappable costs you calls. Every mobile visitor has to memorise the number and dial manually.',
  https: 'Browsers show "Not Secure" on HTTP sites. Visitors abandon forms, and Google demotes you in search.',
  title: 'The title is the blue headline in Google results. A weak one loses clicks before anyone reaches your site.',
  meta: 'Without a meta description Google invents your search snippet, and it is usually worse than one you write.',
  h1: 'The H1 tells Google and visitors what the page is about. Missing or duplicated H1s dilute relevance.',
  sitemap: 'A sitemap helps Google find and index every page. Without it, pages get missed.',
  schema:
    'Structured data unlocks rich results — star ratings, hours, service lists in search. Competitors with schema take that space.',
  localbusiness:
    'LocalBusiness schema is how Google and AI engines confirm where you are and what you do. Without it you are harder to recommend.',
  reviews: 'Star ratings in search results measurably increase click-through. They are the strongest trust signal you have.',
  depth: 'Thin pages give Google little to rank and visitors little reason to trust you. Depth wins both.',
  freshness:
    'A stale copyright year reads as abandoned. Visitors and search engines both use it as a signal the business is active.',
  blog: 'A blog or resource section is the only scalable way to earn search traffic for what customers actually search for.',
  crawlers:
    'If robots.txt blocks GPTBot or ClaudeBot, you cannot be recommended in AI answers — the fastest-growing discovery channel.',
  faq: 'FAQ schema is what AI engines quote when someone asks "who should I hire for X". No FAQ, no citation.',
  entity: 'Entity schema is how AI engines verify you are a real business. Without it they recommend someone they can verify.',
  llms: 'llms.txt is new but cheap — it tells AI engines what matters on your site.',
  cta: 'No clear call to action means visitors leave without converting. This is the single most direct revenue lever.',
  form: 'No form means no way to convert outside a phone call. You lose every visitor who will not call.',
  clickcall: 'A tappable call button is the highest-converting element on a local business site.',
  booking: 'Online booking captures appointments outside business hours — when many customers are actually searching.',
  hours: 'Hours are one of the top questions visitors have. Missing them costs you the visit.',
  valueprop: 'If a visitor cannot tell what you do in three seconds, they leave.',
  weight: 'Heavy pages are slow on mobile connections, which is most of your traffic.',
  lighthouse: 'Google uses page experience as a ranking signal. Speed affects both ranking and conversion.',
  lcp: 'LCP is when the main content appears. Above 2.5s, visitors start abandoning.',
  cls: 'Layout shift makes pages feel broken and causes mis-taps, especially on mobile.',
  tbt: 'Blocking time is how long the page ignores input. High TBT feels unresponsive and frustrates users.',
  ttfb: 'Server response time is the floor for everything else. Slow servers make a fast site impossible.',
  load: 'Full load time determines whether visitors stay or bounce back to search results.',
  media: 'Large numbers of unoptimised images are the most common cause of slow local business sites.',
  lang: 'Declaring the language helps search engines and screen readers serve the right audience.',
  canonical: 'Canonical tags prevent duplicate-content problems across www, http, and tracking URLs.',
  robots: 'robots.txt controls what crawlers can index. Missing it is usually fine but leaves you less in control.',
  alt: 'Alt text is how Google understands images, and how screen readers serve blind visitors.',
  structure: 'Subheadings break content into scannable chunks. Dense blocks get skipped.',
  density: 'Vague copy without specific numbers, prices, or facts does not persuade and does not get quoted by AI.',
  links: 'Internal links spread authority and keep visitors on the site longer.',
  substance: 'AI engines need chunkable, factual content to quote you. Marketing copy without facts gets skipped.',
  phone: 'A visible phone number is the primary conversion path for local services.',
  address: 'Address consistency (NAP) is a core local ranking factor.',
  social: 'Linked social profiles are trust signals and let visitors verify you are real.',
  contactpage: 'Every business needs an obvious way to get in touch.',
  clickthrough: 'Clear next steps reduce bounce and increase conversion.',
};

export function recommend(
  you: SiteScore,
  field: FieldStats,
  peers: SiteScore[],
  limit = 8
): Recommendation[] {
  const okPeers = peers.filter((p) => !p.error && p.finalUrl !== you.finalUrl);

  // Which categories are we losing on? Fixing a lagging category moves the
  // overall score more than polishing one we already lead.
  const catWeights = new Map(you.categories.map((c) => [c.key, c.weight]));

  const candidates = you.categories.flatMap((cat) =>
    cat.findings
      .filter((f) => f.status === 'fail' || f.status === 'warn')
      .map((f) => {
        const totalImpact = cat.findings.reduce((s, x) => s + x.impact, 0) || 1;
        const weight = catWeights.get(cat.key) ?? 0;
        // A fail is worth its full impact; a warn is a partial miss.
        const recovered = f.status === 'fail' ? f.impact : f.impact * 0.75;
        const scoreGain = Math.round((recovered / totalImpact) * weight * 100 * 10) / 10;
        return {
          finding: f,
          category: cat.label,
          scoreGain,
          businessCase: BUSINESS_CASE[f.id] ?? 'This is a measurable gap against the rest of your field.',
        };
      })
  );

  // Rank by score gain, then by fail-over-warn, then by impact.
  candidates.sort((a, b) => {
    if (b.scoreGain !== a.scoreGain) return b.scoreGain - a.scoreGain;
    if (a.finding.status !== b.finding.status) return a.finding.status === 'fail' ? -1 : 1;
    return b.finding.impact - a.finding.impact;
  });

  return candidates.slice(0, limit).map((c, i) => ({ rank: i + 1, ...c }));
}

export interface SideBySide {
  you: {
    url: string;
    overall: number;
    grade: string;
    percentile: number;
    categories: CategoryScore[];
  };
  field: FieldStats;
  rows: ComparisonRow[];
  recommendations: Recommendation[];
  headline: string;
}

export function buildSideBySide(
  you: SiteScore,
  peers: SiteScore[],
  vertical: string
): SideBySide {
  const field = buildFieldStats(vertical, peers);
  const peerOveralls = peers.filter((p) => !p.error).map((p) => p.overall);
  const percentile = percentileAgainst(you.overall, peerOveralls);
  const rows = compareToField(you, field, peers);
  const recommendations = recommend(you, field, peers);

  const leading = rows.filter((r) => r.verdict === 'leading').length;
  const above = rows.filter((r) => r.verdict === 'above').length;
  const behind = rows.filter((r) => r.verdict === 'below' || r.verdict === 'lagging').length;

  // The percentile describes overall rank; the category counts describe shape.
  // They can point opposite ways (a site can beat the field in most categories
  // yet trail on the heavy-weighted ones), so state both plainly instead of
  // implying they agree.
  const rank =
    percentile >= 75
      ? `Top quarter of ${field.siteCount} sites`
      : percentile >= 50
        ? `Ahead of ${percentile}% of ${field.siteCount} sites`
        : percentile >= 25
          ? `Behind ${100 - percentile}% of ${field.siteCount} sites`
          : `Bottom quarter of ${field.siteCount} sites`;

  const shape =
    behind === 0
      ? `ahead of the field on all ${rows.length} categories`
      : leading + above === 0
        ? `behind on all ${rows.length} categories`
        : `ahead on ${leading + above} of ${rows.length}, behind on ${behind}`;

  return {
    you: {
      url: you.finalUrl,
      overall: you.overall,
      grade: you.grade,
      percentile,
      categories: you.categories,
    },
    field,
    rows,
    recommendations,
    headline: `${rank} — ${shape}.`,
  };
}
