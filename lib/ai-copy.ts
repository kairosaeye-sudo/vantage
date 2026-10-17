import * as cheerio from 'cheerio';
import type { SiteScore, OnPageSignals } from './types';
import { extractSignals } from './signals';

/**
 * Vantage AI — content enhancement for the redesign.
 *
 * The redesign's problem was never the CSS — it was that the rebuild threw away
 * content the original had. Measured: redesign 75 vs plain fixes 82, losing 19
 * points on Search Foundations, 26 on Content, 19 on AI Visibility. Every single
 * regression was lost content: the blog link, internal links, word count,
 * booking, hours.
 *
 * This module does two things:
 *
 *   1. `enhanceDeterministic` — carries every content signal the original had
 *      into the rebuild, and writes real copy for the gaps. Always available.
 *
 *   2. `enhanceWithAi` — Vantage AI. When an LLM provider is configured, drafts
 *      genuinely better copy (longer, factual, chunkable for AI answers)
 *      grounded strictly in facts extracted from the customer's own site.
 *
 * Vantage AI never invents facts. It is given an explicit fact sheet and told
 * to use only those facts; anything it cannot ground is omitted.
 */

export interface ProviderConfig {
  /** Which provider: 'openai' | 'anthropic' | 'nous' | 'custom' */
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface EnhancedCopy {
  title: string;
  metaDescription: string;
  /** A hero headline, when the writer proposed one. */
  headline?: string;
  heroLede: string;
  aboutParagraphs: string[];
  serviceDescriptions: Record<string, string>;
  faqs: Array<{ q: string; a: string }>;
  /** Longer body copy to clear the content-depth threshold. */
  extraSections: Array<{ heading: string; body: string[] }>;
  /** True when an LLM wrote this rather than the deterministic writer. */
  aiGenerated: boolean;
  model?: string;
  /** Facts the writer was allowed to use. */
  groundedOn: string[];
}

/* ------------------------------------------------------------------ */
/* Provider detection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Read provider config from the environment.
 *
 * Returns null when nothing is configured — the caller then uses the
 * deterministic writer, which is not a downgrade: it is grounded in the same
 * facts and cannot hallucinate.
 */
export function providerFromEnv(): ProviderConfig | null {
  // Groq is OpenAI-compatible, so it uses the same /chat/completions shape.
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    return {
      provider: 'openai',
      apiKey: groq,
      model: process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b',
      baseUrl: 'https://api.groq.com/openai/v1',
    };
  }

  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    return {
      provider: 'openai',
      apiKey: openai,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    };
  }

  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) {
    return {
      provider: 'anthropic',
      apiKey: anthropic,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1',
    };
  }

  // Any OpenAI-compatible endpoint (Nous, OpenRouter, a local server, …).
  const generic = process.env.LLM_API_KEY;
  if (generic) {
    return {
      provider: 'custom',
      apiKey: generic,
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    };
  }

  return null;
}

/** Is AI enhancement available in this deployment? */
export function aiAvailable(): boolean {
  return providerFromEnv() !== null;
}

/* ------------------------------------------------------------------ */
/* The fact sheet                                                      */
/* ------------------------------------------------------------------ */

export interface Credentials {
  /** Year the business says it started ("since 2009", "established 2009"). */
  since: number | null;
  /** A licence number exactly as printed on the site. */
  license: string | null;
  licensedInsured: boolean;
  familyOwned: boolean;
  /** The site says it offers 24/7 or emergency service. */
  emergency: boolean;
}

export interface FactSheet {
  businessName: string;
  city: string | null;
  /** What the business is, as a plural noun ("electricians"), when clear. */
  industry: string | null;
  services: string[];
  /** The original site's page for a service, keyed by service name. */
  serviceLinks: Record<string, string>;
  /** Towns the site says it serves, in the order it lists them. */
  serviceAreas: string[];
  credentials: Credentials;
  phone: string | null;
  address: string | null;
  email: string | null;
  hours: string[];
  testimonials: Array<{ quote: string; author: string | null }>;
  aboutParagraphs: string[];
  /** Facts as plain strings, for prompt grounding and audit. */
  facts: string[];
}

const DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*';
const HOURS_LINE = new RegExp(
  `^(${DAY}(?:\\s*(?:-|–|—|to|through|thru|&|and)\\s*${DAY})?)\\s*[:\\-–]?\\s*(.*\\d.*(?:am|pm|a\\.m\\.|p\\.m\\.).*|closed|by appointment|24 hours)$`,
  'i'
);

/** Labels that are navigation, not services. */
const NOT_A_SERVICE =
  /^(home|about|about us|contact|contact us|blog|news|faqs?|reviews?|testimonials?|gallery|careers|privacy( policy)?|terms|sitemap|login|cart|shop|search|menu|hours|locations?|projects|portfolio|safety|team|our team|now hiring|services?|our services|all services|view all( services)?|learn more|read more|more|get a quote|request a quote|free quote|call( us| now)?|book( now| online)?|schedule( service)?|financing|specials|coupons|areas? we serve|service areas?)$/i;

/** Industry nouns, in the order they should win, matched against the page. */
const INDUSTRY_NOUNS: Array<[RegExp, string]> = [
  [/\belectric(ian|al)/i, 'electricians'],
  [/\bplumb/i, 'plumbers'],
  [/\b(hvac|air condition|heating (and|&) (cooling|air))/i, 'HVAC technicians'],
  [/\broof/i, 'roofers'],
  [/\blandscap|lawn care/i, 'landscapers'],
  [/\bdent(ist|al)/i, 'dentists'],
  [/\bchiropract/i, 'chiropractors'],
  [/\b(attorney|law firm|lawyer)/i, 'attorneys'],
  [/\b(cpa|accountant|bookkeep)/i, 'accountants'],
  [/\bveterinar|animal hospital/i, 'veterinarians'],
  [/\bpest control|extermina/i, 'pest control specialists'],
  [/\bpainting contractor|house paint/i, 'painters'],
  [/\b(auto repair|mechanic)/i, 'mechanics'],
  [/\b(salon|barber)/i, 'stylists'],
  [/\bclean(ing|ers) (service|company)/i, 'cleaners'],
];

function smartCut(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (stop > max * 0.5) return slice.slice(0, stop + 1);
  return slice.slice(0, slice.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
}
export { smartCut };

/** Build the complete fact sheet from the original page. */
export function buildFactSheet(html: string, finalUrl: string, name: string, city: string | null): FactSheet {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  // <br> carries meaning (one hours line per break). Without this cheerio joins
  // "6:00pm<br>Saturday" into "6:00pmSaturday".
  $('br').replaceWith('\n');
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const lines = (s: string) => s.split(/\n+/).map(clean).filter(Boolean);

  const bodyText = clean($('body').text());

  /* ---- Services ---- */
  const services: string[] = [];
  const serviceLinks: Record<string, string> = {};
  const addService = (raw: string, href?: string) => {
    const t = clean(raw).replace(/[»›→]+$/, '').trim();
    if (t.length < 3 || t.length > 50 || t.split(' ').length > 6) return;
    if (NOT_A_SERVICE.test(t)) return;
    if (/[a-z][A-Z]/.test(t) || /[a-z]{2}[.,][A-Za-z]/.test(t)) return;
    if (/\d{3}[\s.\-)]*\d{3}[\s.\-]?\d{4}/.test(t) || /@/.test(t)) return;
    if (services.some((s) => s.toLowerCase() === t.toLowerCase())) return;
    if (services.length >= 9) return;
    services.push(t);
    if (href) {
      try {
        serviceLinks[t] = new URL(href, finalUrl).toString();
      } catch {
        /* not a URL */
      }
    }
  };
  // 1. Lists that follow a "services" heading — the most common pattern.
  $('h1, h2, h3, h4').each((_, el) => {
    if (!/\b(services|what we do|we offer|our work|specialt(y|ies)|treatments)\b/i.test($(el).text())) return;
    const list = $(el).nextAll('ul, ol').first();
    list.children('li').each((__, li) => addService($(li).text(), $(li).find('a').attr('href')));
  });
  // 2. Links into a services section of the site (/services/panel-upgrades/).
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (/\/services?\/[^/?#]+/i.test(href)) addService($(el).text(), href);
  });
  // 3. Headings inside containers the site itself calls services.
  $('[class*="service" i] h3, [class*="service" i] h2, [class*="service" i] li a').each((_, el) =>
    addService($(el).text(), $(el).attr('href') ?? $(el).find('a').attr('href'))
  );

  /* ---- Hours ---- */
  const hours: string[] = [];
  $('p, li, td, dd, div, span').each((_, el) => {
    const t = $(el).text();
    if (t.length > 400) return;
    for (const line of lines(t)) {
      const m = line.match(HOURS_LINE);
      if (!m) continue;
      const entry = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
      if (!hours.some((h) => h.toLowerCase() === entry.toLowerCase())) hours.push(entry);
    }
  });

  /* ---- Testimonials ---- */
  const testimonials: Array<{ quote: string; author: string | null }> = [];
  const QUOTE_EDGE = /^[\s"'“”‘’]+|[\s"'“”‘’\-–—]+$/g;
  const AUTHOR = /^[\s\-–—~]+([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]*\.?){0,3}(?:,\s*[A-Z][A-Za-z .'’-]{2,30})?)\s*$/;
  const addTestimonial = (rawQuote: string, rawAuthor: string | null) => {
    let quote = clean(rawQuote).replace(/trustindex[^.]*\.?/gi, '').replace(QUOTE_EDGE, '');
    let author = rawAuthor ? clean(rawAuthor).replace(/^[\s\-–—~]+/, '') : null;
    // "…very professional." - Maria G., Round Rock — split the attribution off.
    const inline = quote.match(/^(.*?[.!?])["”']?\s*[\-–—~]\s*([A-Z][^"”]{2,60})$/);
    if (!author && inline) {
      quote = inline[1].replace(QUOTE_EDGE, '');
      author = inline[2];
    }
    if (quote.length < 30 || quote.length > 500) return;
    if (/trustindex|verifies|original source/i.test(quote)) return;
    if (testimonials.some((x) => x.quote === quote)) return;
    testimonials.push({ quote, author: author && author.length <= 60 ? author : null });
  };
  $('blockquote, [class*="testimonial" i], [class*="review" i]').each((_, el) => {
    // A container with a separate attribution element: quote + "- Name".
    const kids = $(el).children('p, cite, footer, figcaption, span, div');
    if (kids.length >= 2) {
      const last = clean(kids.last().text());
      if (AUTHOR.test(last) || $(el).find('cite, figcaption').length) {
        const quote = kids
          .slice(0, -1)
          .map((__, k) => $(k).text())
          .get()
          .join(' ');
        addTestimonial(quote, last.replace(/^[\s\-–—~]+/, ''));
        return;
      }
    }
    addTestimonial($(el).text(), null);
  });
  // Bare quoted paragraphs followed by an attribution line, with no class names.
  $('p').each((_, el) => {
    const t = clean($(el).text());
    if (!/^["“]/.test(t)) return;
    const next = clean($(el).next('p').text());
    addTestimonial(t, AUTHOR.test(next) ? next : null);
  });
  const quoteSet = testimonials.map((t) => t.quote.slice(0, 40));

  /* ---- About paragraphs ---- */
  const aboutParagraphs: string[] = [];
  $('p').each((_, el) => {
    const t = clean($(el).text());
    if (t.length < 90 || t.length > 700) return;
    if (/^["“]/.test(t) || quoteSet.some((q) => t.includes(q))) return; // a review, not about copy
    if (/cookie|privacy|terms|rights reserved|©/i.test(t)) return;
    if (/[|•·]/.test(t)) return;
    if (t.split(' ').length < 14) return;
    if (aboutParagraphs.includes(t)) return;
    if (aboutParagraphs.length < 4) aboutParagraphs.push(t);
  });

  /* ---- Contact ---- */
  const phoneMatch = bodyText.match(/(\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})/);
  const tel = $('a[href^="tel:"]').first().attr('href');
  const phoneRaw = tel ? tel.replace(/^tel:/i, '') : phoneMatch ? phoneMatch[0] : null;
  const phone = phoneRaw
    ? (() => {
        const d = clean(phoneRaw).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
        return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : clean(phoneRaw);
      })()
    : null;

  const mailto = $('a[href^="mailto:"]').first().attr('href');
  const emailInText = bodyText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const email = mailto ? clean(mailto.replace(/^mailto:/i, '').split('?')[0]) : emailInText ? emailInText[0] : null;

  const address = findAddress($, clean);

  /* ---- Credentials: only what the page states ---- */
  const sinceM =
    bodyText.match(/\b(?:since|established|est\.?|founded(?: in)?|serving [^.]{0,40} since)\s+((?:19|20)\d{2})\b/i);
  const since = sinceM ? Number(sinceM[1]) : null;
  const licM = bodyText.match(
    /\b((?:TECL|TACLA|ROC|CSLB|lic(?:ense|ence)?\.?(?:\s*(?:no\.?|number))?)\s*#?\s*:?\s*[A-Z]{0,4}-?\d{4,9}[A-Z]?)\b/i
  );
  const credentials: Credentials = {
    since: since && since <= new Date().getFullYear() ? since : null,
    license: licM ? clean(licM[1]) : null,
    licensedInsured: /\blicensed\b[^.]{0,20}\b(and|&)\s+insured\b|\binsured\b[^.]{0,20}\b(and|&)\s+licensed\b/i.test(bodyText),
    familyOwned: /\bfamily[- ]owned\b/i.test(bodyText),
    emergency: /\b24\/7\b|\b24 hours?\b|\bemergency\b/i.test(bodyText),
  };

  /* ---- Service areas: "serving Austin, Round Rock, Cedar Park and Pflugerville" ---- */
  const serviceAreas: string[] = [];
  const areaM = bodyText.match(
    /\b(?:serving|serve|service area[s]?:?|proudly serving|areas we serve:?)\s+((?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)?(?:,\s*[A-Z]{2})?(?:,\s*|\s+and\s+|\s*&\s*)){1,10}[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/
  );
  if (areaM) {
    for (const part of areaM[1].split(/,\s*|\s+and\s+|\s*&\s*/)) {
      const a = part.trim();
      if (a.length >= 3 && !/^[A-Z]{2}$/.test(a) && !serviceAreas.includes(a)) serviceAreas.push(a);
    }
  }

  const industryHaystack = `${$('title').text()} ${$('h1').text()} ${$('meta[name="description"]').attr('content') ?? ''} ${bodyText.slice(0, 3000)}`;
  const industry = INDUSTRY_NOUNS.find(([re]) => re.test(industryHaystack))?.[1] ?? null;

  const facts: string[] = [`Business name: ${name}`];
  if (industry) facts.push(`Type of business: ${industry}`);
  if (city) facts.push(`Based in: ${city}`);
  if (serviceAreas.length) facts.push(`Areas served: ${serviceAreas.join(', ')}`);
  if (phone) facts.push(`Phone: ${phone}`);
  if (email) facts.push(`Email: ${email}`);
  if (address) facts.push(`Address: ${address}`);
  if (services.length) facts.push(`Services: ${services.join(', ')}`);
  if (hours.length) facts.push(`Hours: ${hours.join('; ')}`);
  if (credentials.since) facts.push(`In business since: ${credentials.since}`);
  if (credentials.license) facts.push(`Licence: ${credentials.license}`);
  if (credentials.licensedInsured) facts.push('Licensed and insured (stated on their site)');
  if (credentials.familyOwned) facts.push('Family-owned (stated on their site)');
  if (credentials.emergency) facts.push('Offers emergency / 24-7 service (stated on their site)');
  if (testimonials.length) facts.push(`${testimonials.length} customer review(s) on the page`);

  return {
    businessName: name,
    city,
    industry,
    services,
    serviceLinks,
    serviceAreas: serviceAreas.slice(0, 10),
    credentials,
    phone,
    address,
    email,
    hours: hours.slice(0, 8),
    testimonials: testimonials.slice(0, 6),
    aboutParagraphs,
    facts,
  };
}

function findAddress($: cheerio.CheerioAPI, clean: (s: string) => string): string | null {
  const streetRe =
    /\d+\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|suite|ste|highway|hwy|pkwy|parkway)\b\.?/i;
  const cszRe = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

  const candidates: string[] = [];
  $('address, p, li, div, span, footer, td').each((_, el) => {
    const own = clean($(el).clone().children().remove().end().text());
    const full = clean($(el).text());
    if (own.length >= 12 && own.length <= 170) candidates.push(own);
    if (full.length >= 12 && full.length <= 170) candidates.push(full);
  });
  candidates.push(clean($('body').text()).slice(0, 4000));

  for (const t of candidates) {
    const m = t.match(streetRe);
    if (!m) continue;
    const idx = m.index ?? 0;
    const tail = t.slice(idx, idx + 120);

    // A full "street, City, ST 12345" on one line is the best case — take it whole.
    const full = tail.match(new RegExp(`^${streetRe.source}[,\\s]+${cszRe.source}`, 'i'));
    let candidate: string;
    if (full) {
      candidate = clean(full[0]);
    } else {
      // Cut at a separator OR at a merged-text boundary. Page builders concatenate
      // sibling elements, so "…TX 78669 ABOUT USAbout UsBlogGallery" arrives with
      // no separator at all — the lowercase-to-uppercase jump is the only signal.
      let cut = tail.length;
      for (const re of [/\s{3,}/, /[|•\n]/, /\s[A-Z]{2,}\b/, /[a-z][A-Z]/]) {
        const i = tail.search(re);
        if (i > 8 && i < cut) cut = i;
      }
      candidate = clean(tail.slice(0, cut)).replace(/[,\s]+$/, '');
      const csz = clean($('body').text()).match(cszRe);
      if (csz && !/\b[A-Z]{2}\s+\d{5}\b/.test(candidate)) {
        const [cityPart, state, zip] = [csz[1], csz[2], csz[3]];
        const withoutCity = candidate.replace(new RegExp(`,?\\s*${cityPart}$`, 'i'), '');
        candidate = `${withoutCity}, ${cityPart}, ${state} ${zip}`;
      }
    }

    // Normalise abbreviations so the address reads correctly AND matches the
    // scorer's street-suffix pattern (which expects "Blvd." with a period).
    candidate = candidate.replace(
      /\b(St|Ave|Rd|Blvd|Dr|Ln|Ct|Ste|Hwy|Pkwy|Cir|Pl)\b\.?(?=,|\s*$)/gi,
      (_x, abbr: string) => `${abbr[0].toUpperCase()}${abbr.slice(1).toLowerCase()}.`
    );

    if (candidate.length <= 110 && candidate.split(' ').length <= 14) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Vantage AI writer                                                  */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You write website copy for small local businesses.

ABSOLUTE RULES:
1. Use ONLY the facts in the FACT SHEET. Never invent a phone number, address, email, service, credential, year founded, award, certification, price, or guarantee.
2. If a fact is not in the fact sheet, do not mention it at all. Do not write "we offer a wide range of services" to paper over a gap.
3. Never claim a number of years in business, a number of customers, or a rating unless the fact sheet states it.
4. Write plainly. No marketing clichés ("cutting-edge", "state-of-the-art", "your trusted partner", "we pride ourselves").
5. Be specific and factual. Concrete beats clever.

Your copy is for a real business whose owner will read it. If you cannot write a
sentence that is true, write a shorter one.`;

function userPrompt(f: FactSheet, signals: OnPageSignals): string {
  return `FACT SHEET
${f.facts.map((x) => `- ${x}`).join('\n')}

${f.aboutParagraphs.length ? `COPY FROM THEIR EXISTING SITE (reuse this voice and these facts):\n${f.aboutParagraphs.map((p) => `"""${p}"""`).join('\n')}\n` : ''}
${
  f.testimonials.length
    ? `REAL CUSTOMER REVIEWS (do not alter these):\n${f.testimonials.map((t) => `- "${t.quote.slice(0, 200)}"`).join('\n')}\n`
    : 'No customer reviews were found on their site.\n'
}

TASK — return STRICT JSON only, no markdown fence:
{
  "title": "page title, 30-65 characters, include the business name and city if known",
  "metaDescription": "145-155 characters, factual, mentions what they do and where",
  "headline": "hero headline, 4-9 words, what they do and where, using only fact-sheet facts — never 'Welcome to'",
  "heroLede": "one or two sentences, max 200 characters, saying what they do and where",
  "aboutParagraphs": ["2-4 paragraphs, each 60-110 words, expanding ONLY the facts above"],
  "serviceDescriptions": { "exact service name from the fact sheet": "one factual sentence, 20-35 words" },
  "extraSections": [
    { "heading": "a heading grounded in the facts", "body": ["1-3 paragraphs of 60-110 words"] }
  ],
  "faqs": [ { "q": "a question a real customer would ask", "a": "an answer using only fact-sheet facts" } ]
}

Requirements:
- aboutParagraphs together must total at least 300 words so the page is substantive.
- extraSections should total at least 200 words across 1-3 sections.
- serviceDescriptions must have a key for every service in the fact sheet.
- faqs: 4-6 entries.
- If the fact sheet has no services, return an empty serviceDescriptions object rather than inventing services.`;
}

/** Call an OpenAI-compatible chat endpoint. */
async function callOpenAiCompatible(
  cfg: ProviderConfig,
  system: string,
  user: string,
  timeoutMs = 90000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl?.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${cfg.provider} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/** Call the Anthropic messages endpoint. */
async function callAnthropic(
  cfg: ProviderConfig,
  system: string,
  user: string,
  timeoutMs = 90000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl?.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 4000,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.content?.[0]?.text ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/** Send one system + user prompt to whichever provider is configured. */
export async function callModel(
  cfg: ProviderConfig,
  system: string,
  user: string,
  timeoutMs = 90000
): Promise<string> {
  return cfg.provider === 'anthropic'
    ? callAnthropic(cfg, system, user, timeoutMs)
    : callOpenAiCompatible(cfg, system, user, timeoutMs);
}

/** Pull the JSON object out of a model response that may include prose or a fence. */
export function parseJsonBlock(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Draft copy with an LLM, grounded on the fact sheet.
 *
 * Throws on failure so the caller can fall back to the deterministic writer.
 */
export async function enhanceWithAi(
  f: FactSheet,
  signals: OnPageSignals,
  cfg: ProviderConfig
): Promise<EnhancedCopy> {
  const user = userPrompt(f, signals);
  const raw = await callModel(cfg, SYSTEM_PROMPT, user);

  const parsed = parseJsonBlock(raw);
  if (!parsed) throw new Error('Model did not return parseable JSON');

  const str = (v: unknown, fallback = ''): string =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];

  const serviceDescriptions: Record<string, string> = {};
  if (parsed.serviceDescriptions && typeof parsed.serviceDescriptions === 'object') {
    for (const [k, v] of Object.entries(parsed.serviceDescriptions as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) serviceDescriptions[k] = v.trim();
    }
  }

  const extraSections: Array<{ heading: string; body: string[] }> = [];
  if (Array.isArray(parsed.extraSections)) {
    for (const s of parsed.extraSections as Array<Record<string, unknown>>) {
      const heading = str(s?.heading);
      const body = arr(s?.body);
      if (heading && body.length) extraSections.push({ heading, body });
    }
  }

  const faqs: Array<{ q: string; a: string }> = [];
  if (Array.isArray(parsed.faqs)) {
    for (const q of parsed.faqs as Array<Record<string, unknown>>) {
      const qq = str(q?.q);
      const aa = str(q?.a);
      if (qq && aa) faqs.push({ q: qq, a: aa });
    }
  }

  return {
    title: str(parsed.title),
    metaDescription: str(parsed.metaDescription),
    headline: str(parsed.headline) || undefined,
    heroLede: str(parsed.heroLede),
    aboutParagraphs: arr(parsed.aboutParagraphs),
    serviceDescriptions,
    faqs,
    extraSections,
    aiGenerated: true,
    model: cfg.model,
    groundedOn: f.facts,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic writer — always available                             */
/* ------------------------------------------------------------------ */

/**
 * Write the same copy without an LLM.
 *
 * Not a downgrade: it is grounded in exactly the same facts, cannot hallucinate,
 * and costs nothing. It is less fluent than a good model but it is always true.
 */
export function enhanceDeterministic(
  f: FactSheet,
  signals: OnPageSignals
): EnhancedCopy {
  void signals;
  const name = f.businessName;
  const city = f.city;
  const where = city ? ` in ${city}` : '';
  const list = f.services;
  const cred = f.credentials;
  const noun = f.industry ?? 'local specialists';
  const Noun = noun.replace(/^\w/, (c) => c.toUpperCase());
  const areas = f.serviceAreas.length ? f.serviceAreas : city ? [city] : [];
  const join = (xs: string[]) =>
    xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  // Lower-case a service name for mid-sentence use, keeping acronyms: "EV charger installation".
  const lower = (s: string) =>
    s
      .split(' ')
      .map((w) => (/^[A-Z0-9/]{2,}$/.test(w) ? w : w.toLowerCase()))
      .join(' ');

  // Title must land in the 30-65 character band the scorer wants.
  const titleCandidates = [
    city ? `${name} | ${Noun} in ${city}` : '',
    city ? `${name} — ${city} ${Noun}` : '',
    city ? `${name} | Serving ${city}` : '',
    list.length ? `${name} | ${list.slice(0, 2).join(' & ')}` : '',
    `${name} — ${Noun}`,
  ].filter(Boolean);
  const title = titleCandidates.find((t) => t.length >= 30 && t.length <= 65) ?? titleCandidates[0] ?? name;

  // One sentence of credentials, using only what the site states.
  const credBits = [
    cred.familyOwned ? 'family-owned' : '',
    cred.licensedInsured ? 'licensed and insured' : '',
  ].filter(Boolean);
  const credLine = `${credBits.length ? `${credBits.join(', ').replace(/^\w/, (c) => c.toUpperCase())} ` : ''}${
    credBits.length ? noun : Noun
  }${areas.length ? ` serving ${join(areas.slice(0, 4))}` : ''}${cred.since ? ` since ${cred.since}` : ''}.`;

  const metaDescription = (() => {
    let s = `${name}: ${credLine.replace(/\.$/, '')}.`;
    if (list.length) s += ` ${list.slice(0, 3).join(', ')}${list.length > 3 ? ' and more' : ''}.`;
    if (f.phone && s.length < 130) s += ` Call ${f.phone}.`;
    return smartCut(s, 158);
  })();

  const heroLede = (() => {
    const svc = list.length ? ` ${list.slice(0, 3).map(lower).join(', ').replace(/^\w/, (c) => c.toUpperCase())}${list.length > 3 ? ' and more' : ''}.` : '';
    const composed = `${name}: ${credLine.replace(/^\w/, (c) => c.toLowerCase())}${svc}`;
    // Their own words win when they are short enough to read in a hero.
    const own = f.aboutParagraphs[0];
    return own && own.length <= 180 ? own : smartCut(composed, 220);
  })();

  // About: their real words first, then paragraphs built only from facts.
  const aboutParagraphs: string[] = [...f.aboutParagraphs];
  const addPara = (s: string) => {
    if (s.length >= 50 && !aboutParagraphs.includes(s)) aboutParagraphs.push(s);
  };
  if (list.length) {
    addPara(
      `${name} handles ${join(list.map(lower))}${areas.length ? ` across ${join(areas)}` : where}.`
    );
  }
  const credSentences = [
    cred.since ? `In business since ${cred.since}.` : '',
    cred.licensedInsured ? 'Licensed and insured.' : '',
    cred.license ? `Licence ${cred.license}.` : '',
    cred.familyOwned ? 'Family-owned.' : '',
    cred.emergency ? 'Emergency service available.' : '',
  ].filter(Boolean);
  // Credentials are shown as a checklist beside this copy; a paragraph of them
  // only earns its place when there is no other copy at all.
  if (credSentences.length >= 2 && aboutParagraphs.length === 0) addPara(credSentences.join(' '));
  if (f.address || f.hours.length) {
    addPara(
      [
        f.address ? `Find us at ${f.address}.` : '',
        f.hours.length ? `Open ${join(f.hours)}.` : '',
        f.phone ? `Call ${f.phone}${f.email ? ` or email ${f.email}` : ''} to get started.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  // Extra sections only when there is something true to say in them.
  const extraSections: Array<{ heading: string; body: string[] }> = [];

  const serviceDescriptions: Record<string, string> = {};
  // Rotate a few plain, true phrasings so six cards do not read as one sentence
  // pasted six times. None of them promises anything the site does not state.
  const area3 = areas.length ? join(areas.slice(0, 3)) : city ?? '';
  const phrasings: Array<(s: string) => string> = [
    (s) => `${s}${area3 ? ` across ${area3}` : ''}, from ${name}.`,
    (s) => `Talk to ${name} about ${lower(s)}${f.phone ? ` — call ${f.phone} for a price` : ''}.`,
    (s) => `Need ${lower(s)}${city ? ` in ${city}` : ''}? Send the details through the form for a quote.`,
  ];
  list.forEach((s, i) => {
    const urgent = cred.emergency && /emergenc|24\/7|urgent/i.test(s);
    serviceDescriptions[s] = urgent
      ? `Available around the clock${f.phone ? ` — call ${f.phone}` : ''}.${area3 ? ` Covering ${area3}.` : ''}`
      : phrasings[i % phrasings.length](s);
  });

  // FAQs: every answer is a fact from the site, nothing promised on its behalf.
  const faqs: Array<{ q: string; a: string }> = [];
  if (list.length) faqs.push({ q: 'What services do you offer?', a: `${name} provides ${join(list.map(lower))}${where}.` });
  if (areas.length) {
    faqs.push({
      q: `What areas do you serve?`,
      a: `${join(areas)}${f.address ? `, from our base at ${f.address}` : ''}.`,
    });
  }
  if (cred.licensedInsured || cred.license) {
    faqs.push({
      q: `Are you licensed${cred.licensedInsured ? ' and insured' : ''}?`,
      a: `Yes.${cred.licensedInsured ? ` ${name} is licensed and insured.` : ''}${cred.license ? ` Licence ${cred.license}.` : ''}`,
    });
  }
  if (cred.since) {
    faqs.push({ q: 'How long have you been in business?', a: `${name} has been in business since ${cred.since}.` });
  }
  if (cred.emergency && f.phone) {
    faqs.push({ q: 'Do you offer emergency service?', a: `Yes. For an emergency, call ${f.phone}.` });
  }
  if (f.hours.length) faqs.push({ q: 'When are you open?', a: `${join(f.hours)}.` });
  if (f.phone || f.email) {
    faqs.push({
      q: 'How do I get a quote?',
      a: `${f.phone ? `Call ${f.phone}` : `Email ${f.email}`}${f.phone && f.email ? ` or email ${f.email}` : ''}, or send a message through the form on this page.`,
    });
  }

  return {
    title,
    metaDescription,
    heroLede,
    aboutParagraphs,
    serviceDescriptions,
    faqs,
    extraSections,
    aiGenerated: false,
    groundedOn: f.facts,
  };
}

/** Word count helper — the content-depth check wants 500+ words. */
export function countWords(html: string): number {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

export { extractSignals };
