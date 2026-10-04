import * as cheerio from 'cheerio';
import type { OnPageSignals } from './types';
import { checkExists, originOf } from './fetch-site';

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'yelp.com',
  'pinterest.com',
];

const CTA_WORDS = [
  'contact',
  'call',
  'book',
  'schedule',
  'get a quote',
  'get quote',
  'free quote',
  'request',
  'estimate',
  'appointment',
  'buy',
  'order',
  'sign up',
  'subscribe',
  'learn more',
  'get started',
  'consultation',
];

/**
 * Extract every measurable on-page signal from raw HTML.
 * Pure function over fetched HTML — no network, no external services.
 */
export async function extractSignals(
  html: string,
  finalUrl: string,
  timeoutMs = 15000,
  opts: { skipNetwork?: boolean } = {}
): Promise<OnPageSignals> {
  const $ = cheerio.load(html);
  const origin = originOf(finalUrl);
  const https = finalUrl.startsWith('https://');

  const title = $('title').first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null;

  const h1s = $('h1');
  const h1Count = h1s.length;
  const h1Text = h1s.first().text().trim().replace(/\s+/g, ' ').slice(0, 200) || null;
  const h2Count = $('h2').length;

  // Structured data
  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const collect = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        const t = obj['@type'];
        if (typeof t === 'string') jsonLdTypes.push(t);
        else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && jsonLdTypes.push(x));
        if (Array.isArray(obj['@graph'])) (obj['@graph'] as unknown[]).forEach(collect);
      };
      if (Array.isArray(parsed)) parsed.forEach(collect);
      else collect(parsed);
    } catch {
      /* malformed JSON-LD is itself a signal, but we ignore it here */
    }
  });
  const uniqTypes = [...new Set(jsonLdTypes)];

  // Images
  const imgs = $('img');
  const imageCount = imgs.length;
  let imagesMissingAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr('alt');
    if (!alt || !alt.trim()) imagesMissingAlt++;
  });

  // Links
  let internalLinks = 0;
  let externalLinks = 0;
  const socialSet = new Set<string>();
  let hasBlogLink = false;

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    let abs: URL;
    try {
      abs = new URL(href, finalUrl);
    } catch {
      return;
    }
    if (abs.origin === origin) {
      internalLinks++;
      if (/\/(blog|news|articles|insights|resources|guides)/i.test(abs.pathname)) hasBlogLink = true;
    } else {
      externalLinks++;
      const host = abs.hostname.replace(/^www\./, '');
      if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith('.' + s))) socialSet.add(host);
    }
  });

  // Conversion signals
  const formCount = $('form').length;
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const bodyLower = bodyText.toLowerCase();
  const telHref = $('a[href^="tel:"]').length > 0;
  const mailtoHref = $('a[href^="mailto:"]').length > 0;
  const phoneInText = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(bodyText);
  const addressSignals =
    /(\b(street|st\.|avenue|ave\.|road|rd\.|suite|ste\.|boulevard|blvd\.|drive|dr\.|lane|ln\.)\b)/i.test(
      bodyText
    ) || /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(bodyText);
  const hoursSignals =
    /(hours|open|mon(day)?\s*[-–]\s*fri(day)?|24\/7|by appointment|business hours)/i.test(bodyText);
  const bookingSignals =
    /(book (now|online|an appointment)|schedule (now|online|a)|request (an )?appointment|calendly|cal\.com|acuity|setmore|housecall)/i.test(
      bodyLower
    );

  const ctaTexts: string[] = [];
  $('a, button').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ').toLowerCase();
    if (!t || t.length > 60) return;
    if (CTA_WORDS.some((w) => t.includes(w))) {
      if (!ctaTexts.includes(t)) ctaTexts.push(t);
    }
  });

  // Content depth + freshness
  const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 1).length;
  const yearMatches = bodyText.match(/\b(19|20)\d{2}\b/g) || [];
  const years = yearMatches.map(Number).filter((y) => y >= 1990 && y <= 2100);
  const copyrightYear = years.length ? Math.max(...years) : null;

  // Factual density: numbers + proper nouns suggest substantive content
  const numbers = (bodyText.match(/\b\d+(\.\d+)?\b/g) || []).length;
  const numericDensity = wordCount > 0 ? numbers / wordCount : 0;

  // Mobile
  const viewport = $('meta[name="viewport"]').attr('content')?.trim() || null;
  const hasMediaQueries = /@media/i.test(html);

  // AI visibility infrastructure
  const hasSitemap = opts.skipNetwork ? false : await checkExists(`${origin}/sitemap.xml`);
  const hasRobots = opts.skipNetwork ? false : await checkExists(`${origin}/robots.txt`);
  const hasLlmsTxt = opts.skipNetwork ? false : await checkExists(`${origin}/llms.txt`);

  let robotsAllowsAi = true;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': 'VantageBot/0.1' },
    });
    if (res.ok) {
      const txt = (await res.text()).toLowerCase();
      const aiBots = ['gptbot', 'claudebot', 'perplexitybot', 'google-extended', 'ccbot'];
      const blocked = aiBots.some((bot) => {
        const re = new RegExp(`user-agent:\\s*${bot}[\\s\\S]*?disallow:\\s*/`, 'i');
        return re.test(txt);
      });
      robotsAllowsAi = !blocked;
    }
  } catch {
    /* no robots.txt = allowed */
  }

  return {
    url: finalUrl,
    origin,
    https,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    h1Count,
    h1Text,
    h2Count,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() || null,
    lang: $('html').attr('lang')?.trim() || null,
    viewport,
    jsonLdTypes: uniqTypes,
    hasOrganizationSchema: uniqTypes.some((t) => /organization|localbusiness|professionalservice/i.test(t)),
    hasFaqSchema: uniqTypes.some((t) => /faqpage|qapage|question/i.test(t)),
    hasLocalBusinessSchema: uniqTypes.some((t) => /localbusiness|professionalservice|store|restaurant/i.test(t)),
    imageCount,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    socialLinks: [...socialSet],
    formCount,
    hasTelLink: telHref,
    hasMailtoLink: mailtoHref,
    phoneInText,
    addressSignals,
    hoursSignals,
    bookingSignals,
    ctaTexts: ctaTexts.slice(0, 10),
    wordCount,
    copyrightYear,
    hasBlogLink,
    hasMediaQueries,
    hasSitemap,
    hasRobots,
    robotsAllowsAi,
    hasLlmsTxt,
    numericDensity,
  };
}
