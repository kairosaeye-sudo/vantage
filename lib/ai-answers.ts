import { callModel, parseJsonBlock, providerFromEnv, type ProviderConfig } from './ai-copy';

/**
 * AI Answer Share — when a customer asks an AI assistant who to hire, who gets named?
 *
 * The AI Visibility category measures whether a site is *readable* by AI engines
 * (crawler access, FAQ schema, llms.txt). That is the input. This module measures
 * the output: ask the model the questions real customers ask — "who are the best
 * electricians in Austin?" — and record which businesses it recommends, in what
 * order, and whether the customer is one of them.
 *
 * It is the most direct answer to "is AI sending work to me or to my rival?" and
 * the one number no competitor tool reports per field.
 *
 * Honesty rules, same as the rest of the engine:
 *   - The model's answer is recorded as given. We match names to field sites, we
 *     never infer a mention that is not there.
 *   - A probe that errors is excluded from the denominator, not counted as a miss.
 *   - With no provider configured the report says so; it never fabricates a result.
 *   - Businesses the model names that are not in the field are reported as
 *     rivals the field is missing — that is a finding, not noise.
 */

export interface AnswerSite {
  url: string;
  isSelf: boolean;
}

export interface AnswerMention {
  name: string;
  website: string | null;
  /** 1-based order in the model's answer. */
  position: number;
  /** The field site this mention was matched to, if any. */
  matchedUrl: string | null;
}

export interface AnswerProbe {
  question: string;
  mentions: AnswerMention[];
  error?: string;
}

export interface AnswerShareRow {
  url: string;
  isSelf: boolean;
  /** Questions in which this site was named. */
  appearances: number;
  /** Questions in which this site was named first. */
  firstPlace: number;
  /** appearances / answered questions, 0-100. */
  share: number;
  avgPosition: number | null;
}

export interface UnlistedRival {
  name: string;
  website: string | null;
  appearances: number;
}

export interface AiAnswerReport {
  ok: boolean;
  /** Why the report could not run, when ok is false. */
  reason?: 'not-configured' | 'all-failed';
  model: string | null;
  industry: string;
  location: string;
  /** Questions that returned a usable answer. */
  answered: number;
  probes: AnswerProbe[];
  /** Field sites that were named at least once, plus the customer, by share. */
  rows: AnswerShareRow[];
  you: AnswerShareRow | null;
  unlistedRivals: UnlistedRival[];
  verdict: string;
  measuredAt: string;
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

/**
 * Buyer-intent questions, phrased the way customers actually ask an assistant.
 * Each one is a different intent (quality, trust, urgency, reviews) so a site that
 * is only known for one thing does not get credit for all four.
 */
export function buildQuestions(industry: string, location: string): string[] {
  const what = industry.trim().toLowerCase();
  const where = location.trim();
  return [
    `Who are the best ${what} in ${where}?`,
    `I am looking for ${what} in ${where} I can trust. Who would you recommend?`,
    `Which ${what} in ${where} can handle an urgent job quickly?`,
    `Which ${what} in ${where} have the best reviews?`,
  ];
}

const SYSTEM_PROMPT = `You are a helpful AI assistant answering a consumer who is choosing a local business.

Answer the way you normally would: recommend specific, real businesses you know of, in the order you would recommend them.

Respond ONLY with JSON in exactly this shape, no prose:
{"businesses":[{"name":"Business Name","website":"example.com or null"}]}

Rules:
- At most 8 businesses, best recommendation first.
- Only businesses you believe really exist in that area. Do not invent any.
- If you do not know specific businesses there, return {"businesses":[]}.`;

/* ------------------------------------------------------------------ */
/* Matching a named business to a field site                           */
/* ------------------------------------------------------------------ */

export function domainOf(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/** First label of the domain: irwinelectricatx.com → irwinelectricatx. */
function stemOf(url: string): string {
  return domainOf(url).split('.')[0].replace(/[^a-z0-9]/g, '');
}

const NAME_NOISE = /\b(the|llc|inc|co|corp|company|ltd|pllc|pc)\b/g;

function compactName(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(NAME_NOISE, '').replace(/[^a-z0-9]/g, '');
}

/**
 * Match a named business to one of the field's sites.
 *
 * Website is decisive when the model gives one. Otherwise the business name is
 * compared to the domain stem — "Irwin Electric" starts "irwinelectricatx". The
 * match must be a prefix, because brand names lead a domain: a substring rule let
 * "The Electric Co" match irwinelectricatx through the shared word "electric".
 * Short strings are refused so "ABC" never matches "abcplumbing" by luck.
 */
export function matchMention(
  name: string,
  website: string | null,
  sites: AnswerSite[]
): string | null {
  if (website) {
    const d = domainOf(website);
    const hit = sites.find((s) => domainOf(s.url) === d);
    if (hit) return hit.url;
  }

  const compact = compactName(name);
  if (compact.length < 5) return null;

  for (const s of sites) {
    const stem = stemOf(s.url);
    if (stem.length < 5) continue;
    const [shorter, longer] = stem.length <= compact.length ? [stem, compact] : [compact, stem];
    // The shared prefix must be a real share of the name, not one generic word.
    if (longer.startsWith(shorter) && shorter.length / longer.length >= 0.4) return s.url;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Running the probes                                                  */
/* ------------------------------------------------------------------ */

function parseMentions(raw: string, sites: AnswerSite[]): AnswerMention[] {
  const parsed = parseJsonBlock(raw);
  const list = Array.isArray(parsed?.businesses) ? (parsed!.businesses as unknown[]) : [];
  const out: AnswerMention[] = [];
  for (const item of list.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) continue;
    const website =
      typeof rec.website === 'string' && rec.website.trim() && rec.website.trim().toLowerCase() !== 'null'
        ? rec.website.trim()
        : null;
    out.push({ name, website, position: out.length + 1, matchedUrl: matchMention(name, website, sites) });
  }
  return out;
}

/**
 * Turn raw probes into the share table. Pure — exported so it can be tested
 * without a model.
 */
export function summarise(
  probes: AnswerProbe[],
  sites: AnswerSite[],
  meta: { industry: string; location: string; model: string | null }
): AiAnswerReport {
  const answered = probes.filter((p) => !p.error);
  const measuredAt = new Date().toISOString();

  if (answered.length === 0) {
    return {
      ok: false,
      reason: 'all-failed',
      model: meta.model,
      industry: meta.industry,
      location: meta.location,
      answered: 0,
      probes,
      rows: [],
      you: null,
      unlistedRivals: [],
      verdict: 'The AI assistant did not return a usable answer. Try again shortly.',
      measuredAt,
    };
  }

  const rows: AnswerShareRow[] = sites.map((s) => {
    const positions: number[] = [];
    for (const p of answered) {
      // A site named twice in one answer still counts once for that question.
      const m = p.mentions.find((x) => x.matchedUrl === s.url);
      if (m) positions.push(m.position);
    }
    return {
      url: s.url,
      isSelf: s.isSelf,
      appearances: positions.length,
      firstPlace: positions.filter((x) => x === 1).length,
      share: Math.round((positions.length / answered.length) * 100),
      avgPosition: positions.length
        ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
        : null,
    };
  });

  const ranked = rows
    .filter((r) => r.appearances > 0 || r.isSelf)
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        b.firstPlace - a.firstPlace ||
        (a.avgPosition ?? 99) - (b.avgPosition ?? 99)
    );
  const you = rows.find((r) => r.isSelf) ?? null;

  // Businesses the model recommends that are not in the field at all.
  const unlisted = new Map<string, UnlistedRival>();
  for (const p of answered) {
    const seen = new Set<string>();
    for (const m of p.mentions) {
      if (m.matchedUrl) continue;
      const key = m.website ? domainOf(m.website) : compactName(m.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const cur = unlisted.get(key);
      if (cur) cur.appearances++;
      else unlisted.set(key, { name: m.name, website: m.website, appearances: 1 });
    }
  }
  const unlistedRivals = [...unlisted.values()].sort((a, b) => b.appearances - a.appearances).slice(0, 8);

  const n = answered.length;
  const topRival = ranked.find((r) => !r.isSelf && r.appearances > 0);
  const totalNamed = new Set(
    answered.flatMap((p) => p.mentions.map((m) => m.matchedUrl ?? compactName(m.name)))
  ).size;

  let verdict: string;
  if (!you || you.appearances === 0) {
    verdict =
      totalNamed === 0
        ? `Asked ${n} ways, the AI assistant could not name any ${meta.industry.toLowerCase()} in ${meta.location}. Nobody owns this answer yet — the first business AI can verify will.`
        : topRival
          ? `Asked ${n} ways, the AI assistant named ${totalNamed} businesses — yours was not one of them. ${domainOf(topRival.url)} was named in ${topRival.appearances} of ${n}.`
          : `Asked ${n} ways, the AI assistant named ${totalNamed} businesses — none of them yours, and none of them in your field.`;
  } else if (you.firstPlace === n) {
    verdict = `You were the first recommendation in all ${n} answers. You own this question — defend it.`;
  } else if (topRival && topRival.appearances > you.appearances) {
    verdict = `You were named in ${you.appearances} of ${n} answers; ${domainOf(topRival.url)} was named in ${topRival.appearances}. AI is sending more of this work to them.`;
  } else {
    verdict = `You were named in ${you.appearances} of ${n} answers${you.firstPlace ? `, first in ${you.firstPlace}` : ''}. ${topRival ? `${domainOf(topRival.url)} is your closest AI rival.` : 'No field rival was named as often.'}`;
  }

  return {
    ok: true,
    model: meta.model,
    industry: meta.industry,
    location: meta.location,
    answered: n,
    probes,
    rows: ranked,
    you,
    unlistedRivals,
    verdict,
    measuredAt,
  };
}

/**
 * Ask the configured model each buyer-intent question and build the report.
 *
 * `sites` should include the customer (isSelf) and the field's member sites.
 */
export async function measureAnswerShare(input: {
  industry: string;
  location: string;
  sites: AnswerSite[];
  cfg?: ProviderConfig | null;
}): Promise<AiAnswerReport> {
  const cfg = input.cfg === undefined ? providerFromEnv() : input.cfg;
  if (!cfg) {
    return {
      ok: false,
      reason: 'not-configured',
      model: null,
      industry: input.industry,
      location: input.location,
      answered: 0,
      probes: [],
      rows: [],
      you: null,
      unlistedRivals: [],
      verdict: 'AI answer tracking is not enabled on this deployment.',
      measuredAt: new Date().toISOString(),
    };
  }

  const questions = buildQuestions(input.industry, input.location);
  const probes = await Promise.all(
    questions.map(async (question): Promise<AnswerProbe> => {
      try {
        const raw = await callModel(cfg, SYSTEM_PROMPT, question, 45000);
        return { question, mentions: parseMentions(raw, input.sites) };
      } catch (e) {
        return { question, mentions: [], error: e instanceof Error ? e.message : 'Model call failed' };
      }
    })
  );

  return summarise(probes, input.sites, {
    industry: input.industry,
    location: input.location,
    model: cfg.model,
  });
}
