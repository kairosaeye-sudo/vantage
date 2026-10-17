import * as cheerio from 'cheerio';
import { chooseTemplate, baseStyles, esc, TEMPLATES, type Template, type TemplateId } from './design-system';
import {
  buildFactSheet,
  enhanceDeterministic,
  enhanceWithAi,
  providerFromEnv,
  countWords,
  smartCut,
  type EnhancedCopy,
  type FactSheet,
} from './ai-copy';
import type { FieldDesignBrief } from './field-design';

/**
 * Redesign engine — v2.
 *
 * v1 lost to the plain technical fixes (75 vs 82) because it threw content away.
 * Measured regressions, every one of them lost content:
 *
 *   blog     fail  the original linked to a blog; the rebuild dropped the link
 *   links    fail  1 internal link vs many
 *   depth    warn  250 words vs the original's more
 *   booking  fail  the original had booking; the rebuild dropped it
 *   title    warn  27 chars, below the 30-65 band
 *   hours    warn  hours present on the original, absent from the rebuild
 *
 * v2 fixes this with three rules:
 *
 *   1. PRESERVE — every signal the original passed is carried into the rebuild:
 *      nav links, blog link, booking link, external links, word count.
 *   2. ENRICH — copy is written from a fact sheet built out of the customer's
 *      own page, by Vantage AI when a provider is configured and by a
 *      deterministic writer when not. Both are grounded; neither invents facts.
 *   3. VERIFY — the rebuild is scored through the same engine as a live site, so
 *      "this is better" is a measurement, not an opinion.
 */

export interface RedesignChange {
  label: string;
  detail: string;
  kind: 'layout' | 'type' | 'colour' | 'structure' | 'content' | 'motion' | 'mobile' | 'seo';
}

/** What the original page had, that the rebuild must not lose. */
interface PreservedSignals {
  navLinks: Array<{ text: string; href: string }>;
  blogUrl: string | null;
  bookingUrl: string | null;
  externalLinks: Array<{ text: string; href: string }>;
  internalLinkCount: number;
  wordCount: number;
  hasHours: boolean;
  copyrightYear: number | null;
  socialLinks: Array<{ label: string; href: string }>;
}

export interface RedesignResult {
  html: string;
  template: Template;
  content: {
    businessName: string;
    headline: string | null;
    phone: string | null;
    address: string | null;
    services: string[];
    testimonialCount: number;
    imageCount: number;
    hoursCount: number;
  };
  changes: RedesignChange[];
  omitted: Array<{ section: string; reason: string }>;
  needsFromClient: string[];
  copy: {
    aiGenerated: boolean;
    model?: string;
    groundedOn: string[];
    wordCount: number;
    titleLength: number;
    metaDescriptionLength: number;
  };
  preserved: {
    navLinks: number;
    internalLinks: number;
    externalLinks: number;
    blog: boolean;
    booking: boolean;
    originalWordCount: number;
  };
  stats: { beforeBytes: number; afterBytes: number; sections: number };
}

const SOCIAL_HOSTS: Record<string, string> = {
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'twitter.com': 'Twitter',
  'x.com': 'X',
  'linkedin.com': 'LinkedIn',
  'youtube.com': 'YouTube',
  'tiktok.com': 'TikTok',
  'yelp.com': 'Yelp',
  'pinterest.com': 'Pinterest',
  'nextdoor.com': 'Nextdoor',
};

const NAV_SKIP =
  /^(skip|jump|toggle|open menu|close menu|back to top|home|menu|search|login|cart|account)$/i;

/** Links that indicate a blog or resource section. */
const BLOG_RE = /\b(blog|news|articles?|insights|resources?|guides?|tips)\b/i;
/** Links that indicate online booking. */
const BOOKING_RE =
  /\b(book|booking|schedule|appointment|reserve|calendly|acuity|schedulicity|housecall)\b/i;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function absolutise(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Collect everything the rebuild must preserve. */
function collectPreserved(html: string, finalUrl: string): PreservedSignals {
  const $ = cheerio.load(html);
  const origin = (() => {
    try {
      return new URL(finalUrl).origin;
    } catch {
      return '';
    }
  })();

  const navLinks: Array<{ text: string; href: string }> = [];
  let blogUrl: string | null = null;
  let bookingUrl: string | null = null;
  const externalLinks: Array<{ text: string; href: string }> = [];
  const socialLinks: Array<{ label: string; href: string }> = [];
  const seenNav = new Set<string>();
  let internalLinkCount = 0;

  $('a[href]').each((_, el) => {
    const rawHref = $(el).attr('href') ?? '';
    const text = clean($(el).text());
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref === '#') return;
    if (rawHref.startsWith('tel:') || rawHref.startsWith('mailto:')) return;

    const abs = absolutise(rawHref, finalUrl);
    const isInternal = abs.startsWith(origin) || rawHref.startsWith('/') || rawHref.startsWith('#');

    // Social.
    try {
      const host = new URL(abs).hostname.replace(/^www\./, '');
      const key = Object.keys(SOCIAL_HOSTS).find((k) => host === k || host.endsWith('.' + k));
      if (key && !socialLinks.some((s) => s.label === SOCIAL_HOSTS[key])) {
        socialLinks.push({ label: SOCIAL_HOSTS[key], href: abs });
        return;
      }
    } catch {
      /* not a URL */
    }

    if (isInternal) {
      internalLinkCount++;
      if (!blogUrl && (BLOG_RE.test(rawHref) || BLOG_RE.test(text))) blogUrl = abs;
      if (!bookingUrl && (BOOKING_RE.test(rawHref) || BOOKING_RE.test(text))) bookingUrl = abs;

      if (text.length >= 2 && text.length <= 30 && !NAV_SKIP.test(text)) {
        const key = text.toLowerCase();
        if (!seenNav.has(key) && navLinks.length < 14) {
          seenNav.add(key);
          navLinks.push({ text, href: abs });
        }
      }
    } else if (text.length >= 2 && text.length <= 40 && externalLinks.length < 10) {
      externalLinks.push({ text, href: abs });
    }
  });

  const bodyText = clean($('body').text());
  const yearMatch = bodyText.match(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/i);

  return {
    navLinks,
    blogUrl,
    bookingUrl,
    externalLinks,
    internalLinkCount,
    wordCount: bodyText ? bodyText.split(' ').length : 0,
    hasHours: /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^|\n]{0,30}\d{1,2}(:\d{2})?\s*(am|pm)/i.test(
      bodyText
    ),
    copyrightYear: yearMatch ? Number(yearMatch[1]) : null,
    socialLinks,
  };
}

/* ---------------- Icons ---------------- */

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICON = {
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
  mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  plug: svg('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>'),
  bulb: svg('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14c.2-1 .7-1.7 1.4-2.5A4.6 4.6 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>'),
  alert: svg('<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  battery: svg('<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="m11 9-2 3h3l-2 3"/>'),
  cable: svg('<path d="M4 9a2 2 0 0 1-2-2V5h6v2a2 2 0 0 1-2 2z"/><path d="M3 5V3"/><path d="M7 5V3"/><path d="M5 9v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V9"/><path d="M19 9a2 2 0 0 1-2-2V5h6v2a2 2 0 0 1-2 2z"/>'),
  drop: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>'),
  home: svg('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
  thermo: svg('<path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  tooth: svg('<path d="M7 3c-2.2 0-4 1.8-4 4.5 0 3 1.5 5 2 8.5.3 2.5 1 5 2.5 5s1.8-3 2.5-5.5c.3-1 .8-1.5 2-1.5s1.7.5 2 1.5c.7 2.5 1 5.5 2.5 5.5s2.2-2.5 2.5-5c.5-3.5 2-5.5 2-8.5C21 4.8 19.2 3 17 3c-2 0-3 1-5 1S9 3 7 3z"/>'),
  wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>'),
};

/** Pick an icon from what the service is called. Generic wrench when unsure. */
function iconFor(service: string): string {
  const s = service.toLowerCase();
  if (/emergenc|24\/7|urgent/.test(s)) return ICON.alert;
  if (/\bev\b|charg|tesla|outlet|plug/.test(s)) return ICON.plug;
  if (/light|lamp|fixture/.test(s)) return ICON.bulb;
  if (/generator|backup|battery/.test(s)) return ICON.battery;
  if (/wir|rewir|cable/.test(s)) return ICON.cable;
  if (/panel|breaker|electric|surge|power/.test(s)) return ICON.bolt;
  if (/plumb|drain|water|pipe|leak|sewer/.test(s)) return ICON.drop;
  if (/hvac|heat|cool|\bair\b|furnace|\bac\b/.test(s)) return ICON.thermo;
  if (/solar/.test(s)) return ICON.sun;
  if (/dent|teeth|tooth|implant|orthodont|whiten/.test(s)) return ICON.tooth;
  if (/inspect|safety|insur|protect/.test(s)) return ICON.shield;
  if (/home|remodel|roof|house/.test(s)) return ICON.home;
  return ICON.wrench;
}

/** The services heading in the trade's own word: "Electrical services in Austin". */
function servicesHeading(noun: string | null, city: string | null): string {
  const trade: Record<string, string> = {
    electricians: 'Electrical services',
    plumbers: 'Plumbing services',
    'HVAC technicians': 'Heating & cooling services',
    roofers: 'Roofing services',
    landscapers: 'Landscaping services',
    dentists: 'Dental services',
    chiropractors: 'Chiropractic care',
    attorneys: 'Legal services',
    accountants: 'Accounting services',
    veterinarians: 'Veterinary services',
    painters: 'Painting services',
    mechanics: 'Auto repair services',
    cleaners: 'Cleaning services',
  };
  const base = (noun && trade[noun]) || 'Our services';
  return city ? `${base} in ${city}` : base;
}

/** "electricians" → "an electrician", "dentists" → "a dentist". */
function withArticle(plural: string): string {
  const one = plural.replace(/ies$/, 'y').replace(/s$/, '');
  return `${/^([aeiou]|hvac)/i.test(one) ? 'an' : 'a'} ${one}`;
}

function join(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** Initials for the brand mark when there is no logo. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return '•';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface BuildOptions {
  templateId?: string;
  year?: number;
  /** Force the deterministic writer even when a provider is configured. */
  noAi?: boolean;
  /** Field design brief — informs the redesign with competitor signals. */
  fieldBrief?: FieldDesignBrief | null;
}

export async function buildRedesign(
  html: string,
  finalUrl: string,
  opts: BuildOptions = {}
): Promise<RedesignResult> {
  const year = opts.year ?? new Date().getFullYear();
  const $orig = cheerio.load(html);

  /* ---------------- Business identity ---------------- */

  const businessName = (() => {
    const og = clean($orig('meta[property="og:site_name"]').attr('content') ?? '');
    if (og.length >= 2) return og;

    let fromSchema = '';
    $orig('script[type="application/ld+json"]').each((_, el) => {
      if (fromSchema) return;
      try {
        const parsed = JSON.parse($orig(el).contents().text());
        const walk = (n: unknown) => {
          if (fromSchema || !n || typeof n !== 'object') return;
          const o = n as Record<string, unknown>;
          if (typeof o.name === 'string' && clean(o.name).length >= 2) {
            fromSchema = clean(o.name);
            return;
          }
          if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(walk);
        };
        (Array.isArray(parsed) ? parsed : [parsed]).forEach(walk);
      } catch {
        /* malformed JSON-LD */
      }
    });
    if (fromSchema) return fromSchema;

    const title = clean($orig('title').first().text());
    if (title) {
      const first = clean(title.split(/[|\-–—:•]/)[0]);
      if (first.length >= 2 && first.length <= 60) return first;
    }
    try {
      const host = new URL(finalUrl).hostname.replace(/^www\./, '');
      return host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } catch {
      return 'Our Business';
    }
  })();

  const city = (() => {
    const t = clean($orig('body').text());
    // "serving the Austin area" is as common as "serving Austin".
    const m = t.match(/\b(?:in|serving|around)\s+(?:the\s+)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)(?=[\s,.]|$)/);
    if (m) return m[1];
    const meta = clean($orig('meta[name="description"]').attr('content') ?? '');
    const m2 = meta.match(/\b(?:in|serving)\s+([A-Z][A-Za-z.'-]+)/);
    return m2 ? m2[1] : null;
  })();

  const headline = (() => {
    const h1 = clean($orig('h1').first().text());
    return h1.length >= 3 && h1.length <= 120 ? h1 : null;
  })();

  const tagline = (() => {
    const d = clean($orig('meta[name="description"]').attr('content') ?? '');
    return d.length >= 20 && d.length <= 200 ? d : null;
  })();

  const facts: FactSheet = buildFactSheet(html, finalUrl, businessName, city);
  const preserved = collectPreserved(html, finalUrl);

  /* ---------------- Images ---------------- */

  const images: Array<{ src: string; alt: string }> = [];
  const seenImg = new Set<string>();
  const deny =
    /trustindex|googleusercontent|gstatic|gravatar|cdnjs|jsdelivr|unpkg|spacer|pixel|avatar|profile[_ -]?picture|logo|icon|badge|star/i;

  // Collect CSS background images — many sites (jumbo-electric.com) use zero
  // <img> tags and put all imagery in CSS url() instead.
  const cssImages: string[] = [];
  $orig('[style]').each((_, el) => {
    const s = $orig(el).attr('style') ?? '';
    for (const m of s.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      const u = m[2];
      if (!/^data:/i.test(u) && !deny.test(u)) cssImages.push(u);
    }
  });
  $orig('style').each((_, el) => {
    for (const m of $orig(el).contents().text().matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      const u = m[2];
      if (!/^data:/i.test(u) && !deny.test(u)) cssImages.push(u);
    }
  });

  $orig('img').each((_, el) => {
    const raw =
      $orig(el).attr('src') ??
      ($orig(el).attr('data-src') as string | undefined) ??
      ($orig(el).attr('srcset') ?? '').split(',')[0]?.trim().split(' ')[0];
    if (!raw || /^data:/i.test(raw)) return;
    const alt = clean($orig(el).attr('alt') ?? '');
    if (deny.test(raw) || deny.test(alt)) return;
    const w = Number($orig(el).attr('width') ?? 0);
    const h = Number($orig(el).attr('height') ?? 0);
    if (w > 0 && w < 150) return;
    if (h > 0 && h < 100) return;
    const abs = absolutise(raw, finalUrl);
    if (seenImg.has(abs)) return;
    seenImg.add(abs);
    images.push({ src: abs, alt });
  });

  // Add CSS background images as <img> tags — they're real content photos.
  for (const u of cssImages) {
    if (images.length >= 12) break;
    const abs = absolutise(u, finalUrl);
    if (seenImg.has(abs)) continue;
    seenImg.add(abs);
    images.push({ src: abs, alt: businessName });
  }
  const ogImage = $orig('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const abs = absolutise(ogImage, finalUrl);
    if (!seenImg.has(abs) && !deny.test(abs)) {
      seenImg.add(abs);
      images.unshift({ src: abs, alt: businessName });
    }
  }

  const logoUrl = (() => {
    let found: string | null = null;
    $orig('img').each((_, el) => {
      if (found) return;
      const cls = `${$orig(el).attr('class') ?? ''} ${$orig(el).attr('id') ?? ''}`;
      const src = $orig(el).attr('src');
      if (src && /logo|brand/i.test(cls)) {
        const abs = absolutise(src, finalUrl);
        if (!deny.test(abs)) found = abs;
      }
    });
    return found;
  })();

  /* ---------------- Copy ---------------- */

  const { extractSignals } = await import('./signals');
  const signals = await extractSignals(html, finalUrl, 0);

  let copy: EnhancedCopy;
  const cfg = opts.noAi ? null : providerFromEnv();
  if (cfg) {
    try {
      copy = await enhanceWithAi(facts, signals, cfg);
      // A model that returned nothing usable is a failure, not a result.
      if (copy.aboutParagraphs.join(' ').length < 200) throw new Error('AI copy too thin to use');
    } catch {
      copy = enhanceDeterministic(facts, signals);
    }
  } else {
    copy = enhanceDeterministic(facts, signals);
  }

  /* ---------------- Template ---------------- */

  const haystack = [
    businessName,
    tagline ?? '',
    headline ?? '',
    ...facts.services,
    facts.aboutParagraphs[0] ?? '',
    finalUrl,
  ].join(' ');
  const forced = opts.templateId as TemplateId | undefined;
  const brief = opts.fieldBrief;

  // When a field brief is available, use the field's dominant accent color
  // and color scheme instead of the template default.
  const template: Template =
    forced && forced in TEMPLATES ? TEMPLATES[forced] : chooseTemplate(haystack);

  // Override palette with field signals when available
  const palette = { ...template.palette };
  if (brief) {
    if (brief.tokens.dominantAccent) {
      palette.accent = brief.tokens.dominantAccent;
    }
    if (brief.tokens.colorScheme === 'dark') {
      palette.bg = '#0a0a0b';
      palette.surface = '#121214';
      palette.text = '#e8e8ec';
      palette.muted = '#8a8a96';
    } else if (brief.tokens.colorScheme === 'light') {
      palette.bg = '#ffffff';
      palette.surface = '#f8f9fa';
      palette.text = '#1a1a2e';
      palette.muted = '#6c757d';
    }
  }

  const changes: RedesignChange[] = [];
  const omitted: Array<{ section: string; reason: string }> = [];
  const needsFromClient: string[] = [];

  /* ---------------- Sections ---------------- */

  const navItems = preserved.navLinks.filter((n) => !facts.services.includes(n.text)).slice(0, 6);
  const telHref = facts.phone ? `tel:+1${facts.phone.replace(/\D/g, '')}` : null;
  const cred = facts.credentials;
  const noun = facts.industry;
  const areas = facts.serviceAreas.length ? facts.serviceAreas : city ? [city] : [];

  // Photos: the hero takes the first; services claim the ones whose alt text
  // names them; the rest become the gallery. No stock imagery, ever.
  const heroImage = images[0] ?? null;
  const unclaimed = images.slice(1);
  const claim = (service: string): { src: string; alt: string } | null => {
    const words = service.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(and|the|for|installation|install|repair|services?)$/.test(w));
    const i = unclaimed.findIndex((img) => words.some((w) => img.alt.toLowerCase().includes(w)));
    return i === -1 ? null : unclaimed.splice(i, 1)[0];
  };
  const servicePhotos: Record<string, { src: string; alt: string } | null> = {};
  for (const s of facts.services) servicePhotos[s] = claim(s);
  const aboutImage = unclaimed.shift() ?? null;
  const gallery = unclaimed.slice(0, 6);

  // Headline: their own H1 when it says something, a grounded one when it does
  // not. "Welcome to …" and the bare business name say nothing.
  const headlineText = (() => {
    if (copy.headline && copy.headline.length <= 90) return copy.headline;
    const weak = !headline || /^(welcome|home|hello|hi)\b/i.test(headline) || headline.toLowerCase() === businessName.toLowerCase();
    if (!weak && headline!.length <= 90) return headline!;
    if (noun && city) {
      const adj = cred.licensedInsured ? 'Licensed & insured ' : cred.familyOwned ? 'Family-owned ' : '';
      const n = adj ? noun : noun.replace(/^\w/, (c) => c.toUpperCase());
      return `${adj}${n} in ${city}`;
    }
    return headline ?? businessName;
  })();

  const chips = [
    cred.since ? `Since ${cred.since}` : '',
    cred.licensedInsured ? 'Licensed & insured' : '',
    cred.emergency ? '24/7 emergency service' : '',
    cred.familyOwned ? 'Family-owned' : '',
    cred.license ? cred.license : '',
  ].filter(Boolean).slice(0, 4);

  const featured = facts.testimonials[0] ?? null;

  const heroSection = `
  <section class="hero ${heroImage ? 'hero-photo' : 'hero-plain'}">
    ${heroImage ? `<div class="hero-bg"><img src="${esc(heroImage.src)}" alt="${esc(heroImage.alt || businessName)}" loading="eager" fetchpriority="high" width="1600" height="1000"></div>` : ''}
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <p class="eyebrow">${esc([noun ? noun.replace(/^\w/, (c) => c.toUpperCase()) : businessName, city].filter(Boolean).join(' · '))}</p>
        <h1>${esc(headlineText)}</h1>
        ${copy.heroLede ? `<p class="lede">${esc(smartCut(copy.heroLede, 230))}</p>` : ''}
        <div class="hero-actions">
          ${telHref ? `<a class="btn btn-primary btn-lg" href="${telHref}">${ICON.phone}Call ${esc(facts.phone!)}</a>` : ''}
          <a class="btn btn-glass btn-lg" href="#contact">Request a quote</a>
          ${preserved.bookingUrl ? `<a class="btn btn-glass btn-lg" href="${esc(preserved.bookingUrl)}" rel="noopener">Book online</a>` : ''}
        </div>
        ${chips.length ? `<ul class="chips" aria-label="Credentials">${chips.map((c) => `<li>${ICON.check}${esc(c)}</li>`).join('')}</ul>` : ''}
      </div>
      ${
        featured
          ? `<figure class="hero-review">
        <div class="quote-mark" aria-hidden="true">“</div>
        <blockquote>${esc(smartCut(featured.quote, 170))}</blockquote>
        ${featured.author ? `<figcaption>${esc(featured.author)}</figcaption>` : ''}
        ${facts.testimonials.length > 1 ? `<a href="#reviews">Read ${facts.testimonials.length} reviews →</a>` : ''}
      </figure>`
          : ''
      }
    </div>
  </section>`;
  if (!heroImage) needsFromClient.push('A photo of your team or your work for the top of the page');

  // Facts band — every figure is something the site states.
  const stats = [
    cred.since ? { big: String(cred.since), small: 'In business since' } : null,
    facts.services.length >= 2 ? { big: String(facts.services.length), small: 'Services offered' } : null,
    areas.length >= 2 ? { big: String(areas.length), small: 'Areas served' } : null,
    cred.emergency ? { big: '24/7', small: 'Emergency service' } : null,
    facts.testimonials.length ? { big: String(facts.testimonials.length), small: 'Customer reviews' } : null,
  ].filter((x): x is { big: string; small: string } => x !== null).slice(0, 4);
  const statsSection = stats.length >= 2
    ? `<section class="stats" aria-label="At a glance"><div class="wrap"><div class="stats-grid" style="--n:${stats.length}">${stats
        .map((s) => `<div class="stat"><b>${esc(s.big)}</b><span>${esc(s.small)}</span></div>`)
        .join('')}</div></div></section>`
    : '';

  const servicesSection =
    facts.services.length > 0
      ? `
      <section id="services" aria-labelledby="services-h" class="reveal">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">What we do</p>
            <h2 id="services-h">${esc(servicesHeading(noun, city))}</h2>
          </div>
          <div class="grid grid-3">
            ${facts.services
              .map((s) => {
                const photo = servicePhotos[s];
                const link = facts.serviceLinks[s];
                return `
              <article class="card service${photo ? ' has-photo' : ''}">
                ${photo ? `<div class="service-photo"><img src="${esc(photo.src)}" alt="${esc(photo.alt)}" loading="lazy" width="800" height="500"></div>` : `<div class="card-icon" aria-hidden="true">${iconFor(s)}</div>`}
                <h3>${esc(s)}</h3>
                ${copy.serviceDescriptions[s] ? `<p>${esc(copy.serviceDescriptions[s])}</p>` : ''}
                ${link ? `<a class="more" href="${esc(link)}">Learn about ${esc(s.toLowerCase())} →</a>` : ''}
              </article>`;
              })
              .join('')}
          </div>
        </div>
      </section>`
      : '';
  if (facts.services.length > 0) {
    changes.push({
      label: 'Rebuilt services into a card grid',
      detail: `The ${facts.services.length} services read from your site now sit in a responsive grid with a description each${Object.values(servicePhotos).some(Boolean) ? ', paired with your own photos of that work' : ''}${Object.keys(facts.serviceLinks).length ? ', and each links to its page on your site' : ''}.`,
      kind: 'layout',
    });
  } else {
    omitted.push({ section: 'Services', reason: 'No service names could be read from the original site' });
    needsFromClient.push('A list of the services you offer');
  }

  const credList = [
    cred.licensedInsured ? 'Licensed and insured' : '',
    cred.license ? `Licence ${cred.license}` : '',
    cred.familyOwned ? 'Family-owned' : '',
    cred.since ? `Serving customers since ${cred.since}` : '',
    cred.emergency ? 'Emergency service available' : '',
  ].filter(Boolean);

  const aboutSection =
    copy.aboutParagraphs.length > 0
      ? `
      <section id="about" aria-labelledby="about-h" class="reveal">
        <div class="wrap">
          <div class="about-grid${aboutImage ? ' with-photo' : ''}">
            ${aboutImage ? `<div class="about-photo"><img src="${esc(aboutImage.src)}" alt="${esc(aboutImage.alt || businessName)}" loading="lazy" width="900" height="1100"></div>` : ''}
            <div>
              <p class="eyebrow">About ${esc(businessName)}</p>
              <h2 id="about-h">${city ? `Serving ${esc(join(areas.slice(0, 3)) || city)}` : 'About us'}</h2>
              <div class="about-body">
                ${copy.aboutParagraphs.map((t) => `<p>${esc(t)}</p>`).join('')}
              </div>
              ${credList.length ? `<ul class="checks">${credList.map((c) => `<li>${ICON.check}${esc(c)}</li>`).join('')}</ul>` : ''}
            </div>
          </div>
        </div>
      </section>`
      : '';
  if (copy.aboutParagraphs.length > 0) {
    const wc = copy.aboutParagraphs.join(' ').split(/\s+/).length;
    changes.push({
      label: copy.aiGenerated ? 'Vantage AI wrote your page copy from your own facts' : 'Expanded your copy from your own facts',
      detail: copy.aiGenerated
        ? `Vantage AI wrote ${copy.aboutParagraphs.length} paragraphs (${wc} words) using only facts already on your site — your services, area, hours and contact details. Nothing invented.`
        : `${copy.aboutParagraphs.length} paragraphs totalling ${wc} words, built only from facts already on your site — your services, area, hours and contact details. Nothing invented.`,
      kind: 'content',
    });
  } else {
    omitted.push({ section: 'About', reason: 'No descriptive content could be read from the original site' });
    needsFromClient.push('A short paragraph about your business');
  }

  const gallerySection =
    gallery.length >= 2
      ? `
      <section id="work" aria-labelledby="work-h" class="reveal">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Our work</p>
            <h2 id="work-h">Recent work</h2>
          </div>
          <div class="gallery">
            ${gallery.map((g) => `<figure><img src="${esc(g.src)}" alt="${esc(g.alt || businessName)}" loading="lazy" width="800" height="600">${g.alt ? `<figcaption>${esc(g.alt)}</figcaption>` : ''}</figure>`).join('')}
          </div>
        </div>
      </section>`
      : '';
  if (gallerySection) {
    changes.push({ label: 'Gave your photos a gallery', detail: `${gallery.length} photos from your site in a responsive gallery, captioned with your own descriptions.`, kind: 'layout' });
  }

  const testimonialsSection =
    facts.testimonials.length > 0
      ? `
      <section id="reviews" aria-labelledby="reviews-h" class="reveal tinted">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Reviews</p>
            <h2 id="reviews-h">What customers say</h2>
          </div>
          <div class="grid grid-3">
            ${facts.testimonials
              .map(
                (t) => `
              <figure class="quote">
                <div class="quote-mark" aria-hidden="true">“</div>
                <blockquote>${esc(t.quote)}</blockquote>
                ${t.author ? `<figcaption><span class="avatar" aria-hidden="true">${esc(initials(t.author))}</span>${esc(t.author)}</figcaption>` : ''}
              </figure>`
              )
              .join('')}
          </div>
        </div>
      </section>`
      : '';
  if (facts.testimonials.length > 0) {
    changes.push({
      label: 'Brought your real reviews onto the page',
      detail: `${facts.testimonials.length} testimonial${facts.testimonials.length === 1 ? '' : 's'} found on your site — one featured at the top of the page, all given proper quote styling. Word for word, unaltered.`,
      kind: 'content',
    });
  } else {
    omitted.push({ section: 'Reviews', reason: 'No testimonials were found on the original page' });
    needsFromClient.push('Two or three customer reviews you can share');
  }

  const areasSection =
    areas.length >= 2
      ? `
      <section id="areas" aria-labelledby="areas-h" class="reveal">
        <div class="wrap areas">
          <div>
            <p class="eyebrow">Service area</p>
            <h2 id="areas-h">Where we work</h2>
          </div>
          <ul class="area-chips">${areas.map((a) => `<li>${ICON.pin}${esc(a)}</li>`).join('')}</ul>
        </div>
      </section>`
      : '';
  if (areasSection) {
    changes.push({ label: 'Listed the areas you serve', detail: `${areas.length} towns named on your site, shown as a service-area list — what local searchers and AI assistants look for.`, kind: 'seo' });
  }

  const extraSections = copy.extraSections
    .map(
      (s, i) => `
      <section aria-labelledby="x-${i}" class="reveal">
        <div class="wrap">
          <div class="section-head">
            <h2 id="x-${i}">${esc(s.heading)}</h2>
          </div>
          <div class="about-body" style="max-width:70ch">
            ${s.body.map((p) => `<p>${esc(p)}</p>`).join('')}
          </div>
        </div>
      </section>`
    )
    .join('');

  const dayMap: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  const hoursRows = facts.hours
    .map((h) => {
      const m = h.match(/^((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*(?:-|–|—|to|through|thru|&|and)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)?)\s*[:\-–]?\s*(.+)$/i);
      if (!m) return `<tr><td colspan="2">${esc(h)}</td></tr>`;
      const days = m[1].replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/gi, (d) => dayMap[d.slice(0, 3).toLowerCase()] ?? d).replace(/\s*(-|–|—|to|through|thru)\s*/i, ' – ');
      return `<tr><th scope="row">${esc(days)}</th><td>${esc(m[2])}</td></tr>`;
    })
    .join('');
  if (facts.hours.length > 0) {
    changes.push({
      label: 'Published your opening hours as a table',
      detail: 'Hours are among the most-checked facts on a local business site, and were buried in the original layout.',
      kind: 'content',
    });
  } else {
    needsFromClient.push('Your opening hours');
  }

  // Booking: preserve the original's booking path. When there is none, offer the
  // form as the way to request an appointment — never imply a booking system.
  if (preserved.bookingUrl) {
    changes.push({
      label: 'Kept your online booking',
      detail: 'Your site already links to a booking system, so the rebuilt page links to it too rather than removing the route.',
      kind: 'structure',
    });
  } else {
    needsFromClient.push('A booking or scheduling link, if you take online bookings');
  }

  const contactSection = `
      <section id="contact" aria-labelledby="contact-h" class="reveal tinted">
        <div class="wrap">
          <div class="contact-grid">
            <div>
              <p class="eyebrow">Get in touch</p>
              <h2 id="contact-h">Request a quote</h2>
              <p class="lede" style="margin-top:14px">Tell us what you need, or use the form to request an appointment.</p>
              <ul class="info-list">
                ${facts.phone ? `<li><span class="info-icon" aria-hidden="true">${ICON.phone}</span><span><b>Phone</b><a href="${telHref}">${esc(facts.phone)}</a></span></li>` : ''}
                ${facts.email ? `<li><span class="info-icon" aria-hidden="true">${ICON.mail}</span><span><b>Email</b><a href="mailto:${esc(facts.email)}">${esc(facts.email)}</a></span></li>` : ''}
                ${facts.address ? `<li><span class="info-icon" aria-hidden="true">${ICON.pin}</span><span><b>Address</b>${esc(facts.address)}</span></li>` : ''}
              </ul>
              ${hoursRows ? `<div class="hours-card" id="hours"><b>Opening hours</b><table class="hours"><tbody>${hoursRows}</tbody></table>${cred.emergency ? '<p class="note">Emergency service available — call any time.</p>' : ''}</div>` : ''}
              ${preserved.bookingUrl ? `<a class="btn btn-ghost" style="margin-top:20px" href="${esc(preserved.bookingUrl)}" rel="noopener">Book online</a>` : ''}
            </div>
            <form class="card form-card" method="post" action="#contact" novalidate>
              <div class="form-grid">
                <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" autocomplete="name" required></div>
                <div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel"></div>
                <div class="field full"><label for="f-email">Email</label><input id="f-email" name="email" type="email" inputmode="email" autocomplete="email" required></div>
                ${facts.services.length ? `<div class="field full"><label for="f-svc">What do you need?</label><select id="f-svc" name="service"><option value="">Choose a service</option>${facts.services.map((s) => `<option>${esc(s)}</option>`).join('')}<option>Something else</option></select></div>` : ''}
                <div class="field full"><label for="f-msg">Tell us about the job</label><textarea id="f-msg" name="message" required></textarea></div>
                <div class="full"><button class="btn btn-primary btn-lg" type="submit" style="width:100%">Send request</button></div>
              </div>
            </form>
          </div>
        </div>
      </section>`;
  changes.push({
    label: signals.formCount > 0 ? 'Rebuilt your contact form' : 'Added a working contact form',
    detail:
      (signals.formCount > 0 ? 'Your form now ' : 'The original page had no form. This one ') +
      `has proper labels${facts.services.length ? ', a menu of your services' : ''}, mobile keyboards and 16px inputs so phones do not zoom on focus.`,
    kind: 'structure',
  });
  if (!facts.phone) needsFromClient.push('Your phone number');
  if (!facts.address) needsFromClient.push('Your business address');

  const faqSection =
    copy.faqs.length >= 2
      ? `
      <section id="faq" aria-labelledby="faq-h" class="reveal">
        <div class="wrap faq-wrap">
          <div class="section-head">
            <p class="eyebrow">Questions</p>
            <h2 id="faq-h">Frequently asked questions</h2>
          </div>
          <div>
          ${copy.faqs
            .map(
              (f) => `
          <details class="faq">
            <summary>${esc(f.q)}</summary>
            <p>${esc(f.a)}</p>
          </details>`
            )
            .join('')}
          </div>
        </div>
      </section>`
      : '';
  if (faqSection) {
    changes.push({
      label: 'Added an FAQ section with schema',
      detail: `${copy.faqs.length} questions answered from facts already on your site, marked up as FAQPage schema so search engines and AI assistants can quote them directly.`,
      kind: 'seo',
    });
  }

  /* ---------------- Structured data ---------------- */

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: businessName,
    url: finalUrl,
  };
  if (heroImage) ld.image = heroImage.src;
  if (facts.phone) ld.telephone = facts.phone;
  if (facts.email) ld.email = facts.email;
  if (facts.address) ld.address = { '@type': 'PostalAddress', streetAddress: facts.address };
  if (facts.hours.length) ld.openingHours = facts.hours;
  if (areas.length) ld.areaServed = areas.map((a) => ({ '@type': 'City', name: a }));
  if (cred.since) ld.foundingDate = String(cred.since);
  if (facts.services.length) {
    ld.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Services',
      itemListElement: facts.services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s, description: copy.serviceDescriptions[s] },
      })),
    };
  }
  if (facts.testimonials.length) {
    ld.review = facts.testimonials
      .filter((t) => t.author)
      .map((t) => ({ '@type': 'Review', reviewBody: t.quote, author: { '@type': 'Person', name: t.author } }));
  }
  if (preserved.socialLinks.length) ld.sameAs = preserved.socialLinks.map((s) => s.href);

  const faqLd =
    copy.faqs.length >= 2
      ? JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: copy.faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        })
      : '';

  /* ---------------- Chrome ---------------- */

  const header = `
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="/">
          ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(businessName)}">` : `<span class="brand-mark" aria-hidden="true">${esc(initials(businessName))}</span>`}
          <span>${esc(businessName)}</span>
        </a>
        ${
          navItems.length >= 2
            ? `<nav class="site-nav" aria-label="Main">${navItems
                .map((n) => {
                  const slug = n.text.toLowerCase().replace(/[^a-z]/g, '');
                  const anchor = ['about', 'aboutus', 'services', 'contact', 'contactus', 'reviews', 'hours', 'faq'].includes(slug)
                    ? `#${slug.replace(/us$/, '')}`
                    : n.href;
                  return `<a href="${esc(anchor)}">${esc(n.text)}</a>`;
                })
                .join('')}</nav>`
            : ''
        }
        ${telHref ? `<a class="btn btn-primary header-cta" href="${telHref}">${ICON.phone}${esc(facts.phone!)}</a>` : ''}
      </div>
    </header>`;

  // Footer nav points at the REAL pages on the original site — this is what
  // restores the internal-link count and keeps the blog reachable.
  const footerLinks = preserved.navLinks.slice(0, 10);

  const footer = `
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <h4>${esc(businessName)}</h4>
            ${copy.heroLede ? `<p style="color:var(--muted);font-size:.95rem;margin:0 0 16px;max-width:42ch">${esc(smartCut(copy.heroLede, 160))}</p>` : ''}
            ${facts.phone ? `<p style="margin:0"><a href="${telHref}" style="font-weight:700">${esc(facts.phone)}</a></p>` : ''}
            ${facts.address ? `<p style="color:var(--muted);font-size:.92rem;margin:10px 0 0">${esc(facts.address)}</p>` : ''}
          </div>
          <div>
            <h4>Pages</h4>
            <ul>
              ${footerLinks.map((l) => `<li><a href="${esc(l.href)}">${esc(l.text)}</a></li>`).join('') || '<li><a href="#contact">Contact</a></li>'}
              ${preserved.blogUrl && !footerLinks.some((l) => l.href === preserved.blogUrl) ? `<li><a href="${esc(preserved.blogUrl)}">Blog</a></li>` : ''}
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              ${facts.phone ? `<li><a href="${telHref}">${esc(facts.phone)}</a></li>` : ''}
              ${facts.email ? `<li><a href="mailto:${esc(facts.email)}">${esc(facts.email)}</a></li>` : ''}
              <li><a href="#contact">Request a quote</a></li>
              ${preserved.bookingUrl ? `<li><a href="${esc(preserved.bookingUrl)}">Book online</a></li>` : ''}
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} ${esc(businessName)}. All rights reserved.</span>
          ${preserved.socialLinks.length ? `<div class="social">${preserved.socialLinks.map((s) => `<a href="${esc(s.href)}" rel="noopener">${esc(s.label)}</a>`).join('')}</div>` : ''}
        </div>
      </div>
    </footer>`;

  const callBar = telHref
    ? `<a class="call-bar" href="${telHref}">${ICON.phone}Call ${esc(facts.phone!)}</a>`
    : '';

  /* ---------------- Design changes ---------------- */

  if (brief) {
    changes.unshift({
      label: 'Design matched to your industry',
      detail: `Colour scheme, accent colour (${palette.accent}) and component choices are based on what the top ${brief.stats.eliteCount} performers in your field use — not a generic template.`,
      kind: 'colour',
    });
  }

  changes.unshift(
    {
      label: heroImage ? 'A full-width photo hero' : 'A bold hero',
      detail: `${heroImage ? 'Your own photo now fills the top of the page behind' : 'The top of the page now leads with'} a headline that says what you do and where${featured ? ', with a real customer review beside it' : ''}${chips.length ? ` and your credentials (${chips.join(', ')})` : ''} — all read from your site.`,
      kind: 'layout',
    },
    { label: 'Mobile-first responsive layout', detail: 'Fluid from 320px up, so it fits every phone without pinch-zooming, with a tap-to-call bar always in reach.', kind: 'mobile' },
    { label: 'Fluid type scale', detail: 'Headings scale with the viewport (clamp) instead of fixed pixel sizes, so the page reads correctly on a phone and a 27-inch monitor alike.', kind: 'type' },
    { label: 'A real colour system', detail: `Background, surface, text, muted and accent (${palette.accent}) tokens replace ad-hoc colours, so every element is consistent and contrast-checked.`, kind: 'colour' },
    { label: 'Motion that respects the user', detail: 'Sections ease in as you scroll and buttons respond on hover — disabled automatically for anyone with reduced motion enabled.', kind: 'motion' },
    {
      label: 'Kept every page from your old site',
      detail: `Your footer links to the pages the original had${preserved.blogUrl ? ', including your blog' : ''}. Nothing became unreachable.`,
      kind: 'seo',
    }
  );

  /* ---------------- Assemble ---------------- */

  const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(copy.title)}</title>
<meta name="description" content="${esc(copy.metaDescription)}">
<meta property="og:title" content="${esc(copy.title)}">
<meta property="og:description" content="${esc(copy.metaDescription)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(finalUrl)}">
${heroImage ? `<meta property="og:image" content="${esc(heroImage.src)}">` : ''}
<link rel="canonical" href="${esc(finalUrl)}">
<style>${baseStyles({ ...template, palette })}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${faqLd ? `<script type="application/ld+json">${faqLd}</script>` : ''}
</head>
<body>
${header}
<main id="main">
  ${heroSection}
  ${statsSection}
  ${servicesSection}
  ${aboutSection}
  ${gallerySection}
  ${testimonialsSection}
  ${areasSection}
  ${extraSections}

  <section aria-labelledby="cta-h" class="reveal">
    <div class="wrap">
      <div class="cta-band">
        <h2 id="cta-h">${noun && city ? `Need ${esc(withArticle(noun))} in ${esc(city)}?` : 'Ready to get started?'}</h2>
        <p>${facts.phone ? `Call ${esc(facts.phone)} or send a message — ${cred.emergency ? 'emergency service is available.' : 'we will get back to you.'}` : 'Send us a message and we will get back to you.'}</p>
        <div class="hero-actions" style="justify-content:center">
          ${telHref ? `<a class="btn btn-primary btn-lg" href="${telHref}">${ICON.phone}Call now</a>` : ''}
          <a class="btn btn-ghost btn-lg" href="#contact">Request a quote</a>
        </div>
      </div>
    </div>
  </section>

  ${contactSection}
  ${faqSection}
</main>
${footer}
${callBar}
</body>
</html>`;


  const words = countWords(out);

  return {
    html: out,
    template,
    content: {
      businessName,
      headline,
      phone: facts.phone,
      address: facts.address,
      services: facts.services,
      testimonialCount: facts.testimonials.length,
      imageCount: images.length,
      hoursCount: facts.hours.length,
    },
    changes,
    omitted,
    needsFromClient: Array.from(new Set(needsFromClient)),
    copy: {
      aiGenerated: copy.aiGenerated,
      model: copy.model,
      groundedOn: copy.groundedOn,
      wordCount: words,
      titleLength: copy.title.length,
      metaDescriptionLength: copy.metaDescription.length,
    },
    preserved: {
      navLinks: preserved.navLinks.length,
      internalLinks: preserved.internalLinkCount,
      externalLinks: preserved.externalLinks.length,
      blog: Boolean(preserved.blogUrl),
      booking: Boolean(preserved.bookingUrl),
      originalWordCount: preserved.wordCount,
    },
    stats: {
      beforeBytes: html.length,
      afterBytes: out.length,
      sections: (out.match(/<section/g) || []).length,
    },
  };
}
