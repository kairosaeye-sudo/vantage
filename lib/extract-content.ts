import * as cheerio from 'cheerio';

/**
 * Extract the REAL content of an existing site so it can be re-rendered through
 * a modern design system.
 *
 * The rule that governs this whole file: never invent. Every field is either
 * found in the source HTML or reported as absent. A redesign that fabricates a
 * phone number, a testimonial or a service is worse than no redesign.
 *
 * Fields carry a `found` flag so callers can omit sections entirely rather than
 * render an empty shell.
 */

export interface ExtractedImage {
  src: string;
  alt: string;
}

export interface ExtractedService {
  name: string;
  description: string | null;
}

export interface ExtractedTestimonial {
  quote: string;
  author: string | null;
}

export interface SiteContent {
  /** Where it came from — used to absolutise assets and to credit nothing. */
  sourceUrl: string;
  origin: string;

  businessName: string;
  nameSource: 'og:site_name' | 'schema' | 'title' | 'domain';
  tagline: string | null;
  headline: string | null;
  aboutParagraphs: string[];

  phone: string | null;
  phoneHref: string | null;
  email: string | null;
  address: string | null;
  hours: string[];

  services: ExtractedService[];
  testimonials: ExtractedTestimonial[];
  images: ExtractedImage[];

  navItems: string[];
  socialLinks: Array<{ label: string; href: string }>;
  existingCtas: string[];

  hasLogo: boolean;
  logoUrl: string | null;

  /** What we could not find, so the UI can be honest about gaps. */
  missing: string[];
}

const SOCIAL_LABELS: Record<string, string> = {
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

/** Words that look like a nav item but are not a service. */
const NON_SERVICE = /^(home|about|about us|contact|contact us|blog|news|news & alerts|news and alerts|faq|faqs|reviews|gallery|careers|privacy|privacy policy|terms|terms of use|sitemap|site ?map|footer|header|sidebar|navigation|menu|login|cart|shop|search|hours|location|directions|call|call us|quote|book|book now|services?|our services|all services|products?|more|read more|projects?|our projects|portfolio|safety|team|our team|staff|testimonials|why us|process|warranty|financing|specials|offers|emergency|contact form|get a quote|request a quote|schedule service|book online|areas? we serve|service areas?|power|energy)$/i;

/** Nav sections that are structurally not service offerings. */
const NAV_SECTION = /\b(news|alerts|hiring|careers?|jobs?|projects?|portfolio|safety|gallery|team|staff|blog|press|awards|testimonials?|reviews?|privacy|terms|policy|login|account|cart|checkout|search|sitemap|warranty|financing|specials?|offers?|coupons?|faqs?)\b/i;

/**
 * Detect text that was concatenated from separate DOM nodes.
 *
 * A nav link wrapping several divs comes out as "Denver ElectriciansFederal
 * Blvd" — the words are real but the string is not, and rendering it would
 * produce visible garbage. Signals: a lowercase letter jammed against a capital,
 * a period or comma with no following space, or two runs of lowercase letters
 * that only make sense as separate words.
 */
function isMergedText(t: string): boolean {
  if (/[a-z][A-Z]/.test(t)) return true; // "callto final" / "ElectriciansFederal"
  if (/[a-z]{2}[.,][A-Za-z]/.test(t)) return true; // "licenses.Real" / "retail,restaurant"
  if (/[a-z]{2,}[A-Z][a-z]{2,}/.test(t)) return true; // "servicemodules"
  return false;
}

/** Emoji and pictographs carry no meaning in a redesign — strip them. */
function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Third-party widget assets that are never the business's own logo. */
const LOGO_HOST_DENY = /trustindex|googleusercontent|gstatic|gravatar|w.org|cloudflare|jsdelivr|unpkg|cdnjs|google-analytics|doubleclick|facebook\.com\/tr|schema\.org/i;

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

/** Is this image worth showing? Filters out icons, spacers, tracking pixels. */
function isContentImage(src: string, w: number | null, h: number | null, alt: string): boolean {
  if (!src) return false;
  if (/^data:/i.test(src)) return false;
  if (/spacer|blank|clear|pixel|1x1|tracking/i.test(src)) return false;
  if (/\.(svg)(\?|$)/i.test(src)) return false;
  if (/logo|icon|favicon|sprite|badge/i.test(src) && !alt) return false;
  // Third-party widget chrome: review avatars, rating stars, social badges.
  // These belong to Google/Yelp/Facebook, not to the business.
  if (LOGO_HOST_DENY.test(src)) return false;
  if (/profile[_ -]?picture|avatar|headshot|reviewer|rating|star|trustindex|badge/i.test(src + ' ' + alt)) return false;
  if (/\/a\/|\/a-\//.test(src) && /googleusercontent/i.test(src)) return false;
  // Explicit tiny dimensions are never hero content.
  if (w !== null && w > 0 && w < 150) return false;
  if (h !== null && h > 0 && h < 100) return false;
  return true;
}

/** Does this text look like a service offering rather than chrome? */
function looksLikeService(text: string): boolean {
  const t = clean(text);
  if (t.length < 3 || t.length > 60) return false;
  if (NON_SERVICE.test(t)) return false;
  if (isMergedText(t)) return false;
  if (/[.!?]$/.test(t)) return false; // a label, not a sentence
  if (/^\d/.test(t)) return false;
  if (/[|·•]/.test(t)) return false; // separator soup
  // A phone number is a contact detail, not a service.
  if (/(\d{3})[\s.\-)]*\d{3}[\s.\-]?\d{4}/.test(t)) return false;
  if (/now hiring|apply now|careers|job/i.test(t)) return false;
  // Nav sections are not services.
  if (NAV_SECTION.test(t)) return false;
  // Accessibility and chrome text.
  if (/skip to (content|main)|jump to|toggle navigation|open menu|close menu|back to top/i.test(t)) return false;
  // Section headings that frame a list rather than name an offering.
  // "Our Specialized Services", "Clients We've Worked With", "Skills & Expertise".
  if (/^(our|the|why|what|who|how)\b/i.test(t) && t.split(' ').length <= 5) return false;
  if (/^(clients?|customers?|skills?|expertise|specialt|capabilit|credential|certification|experience|quality|values?|mission|commitment|guarantee)\b/i.test(t)) return false;
  // A dangling fragment is not a service ("integrity", "Power").
  if (/^(integrity|quality|value|trust|reliability|service|excellence|safety|honesty|craftsmanship)$/i.test(t)) return false;
  // ALL-CAPS single words are almost always nav labels, not service names.
  if (/^[A-Z\s&]{3,}$/.test(t) && t.split(/\s+/).length <= 2) return false;
  // "Commercial Service" duplicates "Commercial Services" — drop the singular echo.
  if (/\bservice$/i.test(t) && t.split(' ').length <= 3) return false;
  // A single generic word is a heading, not an offering.
  if (t.split(' ').length === 1 && t.length < 8) return false;
  // A label is a few words, not a paragraph.
  if (t.split(' ').length > 7) return false;
  // Must contain at least one letter and be mostly letters.
  if (!/[a-z]/i.test(t)) return false;
  return true;
}

export function extractContent(html: string, finalUrl: string): SiteContent {
  const $ = cheerio.load(html);
  const origin = (() => {
    try {
      return new URL(finalUrl).origin;
    } catch {
      return '';
    }
  })();

  const missing: string[] = [];

  /* ---------------- Business name ---------------- */

  let businessName = '';
  let nameSource: SiteContent['nameSource'] = 'domain';

  const ogSite = $('meta[property="og:site_name"]').attr('content');
  if (ogSite && clean(ogSite).length >= 2) {
    businessName = clean(ogSite);
    nameSource = 'og:site_name';
  }

  if (!businessName) {
    // Schema.org name is the most reliable when present.
    $('script[type="application/ld+json"]').each((_, el) => {
      if (businessName) return;
      try {
        const parsed = JSON.parse($(el).contents().text());
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        const walk = (n: unknown) => {
          if (businessName || !n || typeof n !== 'object') return;
          const o = n as Record<string, unknown>;
          if (typeof o.name === 'string' && clean(o.name).length >= 2) {
            businessName = clean(o.name);
            nameSource = 'schema';
            return;
          }
          if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(walk);
        };
        nodes.forEach(walk);
      } catch {
        /* malformed JSON-LD */
      }
    });
  }

  if (!businessName) {
    const title = clean($('title').first().text());
    if (title) {
      const first = title.split(/[|\-–—:•]/)[0];
      if (clean(first).length >= 2 && clean(first).length <= 60) {
        businessName = clean(first);
        nameSource = 'title';
      }
    }
  }

  if (!businessName) {
    try {
      const host = new URL(finalUrl).hostname.replace(/^www\./, '');
      businessName = host
        .split('.')[0]
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      nameSource = 'domain';
    } catch {
      businessName = 'Our Business';
    }
  }

  /* ---------------- Headline / tagline ---------------- */

  const h1 = clean($('h1').first().text());
  const headline = h1.length >= 3 && h1.length <= 120 ? h1 : null;
  if (!headline) missing.push('headline');

  const metaDesc = clean($('meta[name="description"]').attr('content') ?? '');
  const tagline = metaDesc.length >= 20 && metaDesc.length <= 200 ? metaDesc : null;

  /* ---------------- Contact details ---------------- */

  const bodyText = clean($('body').text());
  const telHref = $('a[href^="tel:"]').first().attr('href');
  const phoneFromLink = telHref ? clean(telHref.replace(/^tel:/i, '')) : null;

  // Prefer a tel: link; fall back to a pattern in the text.
  const phonePattern = /(\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})/;
  const phoneMatch = bodyText.match(phonePattern);
  const phoneRaw = phoneFromLink ?? (phoneMatch ? clean(phoneMatch[0]) : null);
  // Present it the way a person writes it.
  const phone = phoneRaw
    ? (() => {
        const d = phoneRaw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
        return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phoneRaw;
      })()
    : null;
  const phoneHref = phone ? `tel:+1${phone.replace(/\D/g, '')}` : null;
  if (!phone) missing.push('phone number');

  const mailto = $('a[href^="mailto:"]').first().attr('href');
  const email = mailto ? clean(mailto.replace(/^mailto:/i, '').split('?')[0]) : null;

  // Address: look for a street pattern or a city/state/zip, and take the
  // containing element's text so we keep the whole address together.
  let address: string | null = null;
  const streetRe =
    /\d+\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|suite|ste|highway|hwy|pkwy|parkway|circle|cir|place|pl)\b/i;
  const cityStateZipRe = /[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/;

  $('address, p, div, li, span, td, footer').each((_, el) => {
    if (address) return;
    // Only consider elements that are mostly this text — a wrapper div holding
    // the whole page would otherwise swallow everything.
    const own = clean($(el).clone().children().remove().end().text());
    const full = clean($(el).text());
    const t = own.length >= 12 ? own : full;
    if (t.length < 12 || t.length > 160) return;
    if (isMergedText(t)) return;

    const street = t.match(streetRe);
    if (street) {
      const idx = street.index ?? 0;
      // Take the street plus up to 60 chars after it, stopping at a separator.
      const tail = t.slice(idx, idx + 120);
      const stop = tail.search(/[|•\n]|\s{3,}/);
      address = clean(stop > 10 ? tail.slice(0, stop) : tail);
      return;
    }
    const csz = t.match(cityStateZipRe);
    if (csz) address = clean(csz[0]);
  });
  if (!address) missing.push('street address');

  /* ---------------- Hours ---------------- */

  const hours: string[] = [];
  const dayRe =
    /\b(mon|tue|wed|thu|fri|sat|sun)(day|sday|nesday|rsday|day|urday)?\b[^|\n]{0,40}?\d{1,2}(:\d{2})?\s*(am|pm)?[^|\n]{0,20}/gi;
  $('p, li, div, span, td, address').each((_, el) => {
    const t = clean($(el).text());
    if (t.length < 8 || t.length > 400) return;
    const matches = t.match(dayRe);
    if (matches) {
      for (const m of matches) {
        const c = clean(m);
        if (c.length >= 8 && c.length <= 90 && !hours.includes(c)) hours.push(c);
      }
    }
  });
  const hoursTrimmed = hours.slice(0, 8);
  if (hoursTrimmed.length === 0) missing.push('opening hours');

  /* ---------------- Services ---------------- */

  const services: ExtractedService[] = [];
  const seenService = new Set<string>();

  const addService = (name: string, description: string | null) => {
    const n = clean(stripEmoji(name));
    const key = n.toLowerCase();
    if (!looksLikeService(n) || seenService.has(key)) return;
    seenService.add(key);
    services.push({ name: n, description: description ? clean(description).slice(0, 240) : null });
  };

  // Preferred source: short, clean nav/menu labels. These name the offering
  // without dragging in page chrome.
  $('nav a, header a, .menu a, .nav a, #nav a, [class*="menu" i] a').each((_, el) => {
    const t = clean($(el).text());
    // A nav label that is itself a link is trustworthy; require it to be short.
    if (t.length >= 3 && t.length <= 40) addService(t, null);
  });

  // Then headings, paired with a following paragraph as a description.
  $('h2, h3, h4').each((_, el) => {
    const name = clean($(el).text());
    if (!looksLikeService(name)) return;
    let desc: string | null = null;
    const next = $(el).next();
    if (next.is('p')) {
      const t = clean(next.text());
      if (t.length >= 25 && t.length <= 300) desc = t;
    }
    addService(name, desc);
  });

  // Finally list items inside a services-looking container.
  $('[class*="service" i] li, [id*="service" i] li, [class*="offering" i] li').each((_, el) => {
    const t = clean($(el).clone().children().remove().end().text()) || clean($(el).text());
    if (t.length <= 60) addService(t, null);
  });

  const servicesTrimmed = services.slice(0, 9);
  if (servicesTrimmed.length === 0) missing.push('services');

  /* ---------------- About ---------------- */

  const aboutParagraphs: string[] = [];
  $('p').each((_, el) => {
    const t = clean($(el).text());
    if (t.length < 80 || t.length > 700) return;
    if (isMergedText(t)) return;
    if (/cookie|privacy policy|terms of use|all rights reserved|©|copyright/i.test(t)) return;
    // Navigation debris: too many single-word fragments or separators.
    if (/[|·•]/.test(t)) return;
    if (t.split(' ').length < 12) return;
    if (aboutParagraphs.some((p) => p === t)) return;
    if (aboutParagraphs.length < 3) aboutParagraphs.push(t);
  });
  if (aboutParagraphs.length === 0) missing.push('about text');

  /* ---------------- Testimonials ---------------- */

  const testimonials: ExtractedTestimonial[] = [];
  const addTestimonial = (raw: string) => {
    let t = clean(raw);
    // Strip surrounding quote characters and the word "testimonial".
    t = t.replace(/^["'“”]+|["'“”]+$/g, '').replace(/^testimonial:?\s*/i, '').trim();
    // Third-party review widget chrome is not a customer quote.
    t = t
      .replace(/^posted on \w+\s*/i, '')
      .replace(/trustindex verifies[^.]*\.?/gi, '')
      .replace(/the original source of the review[^.]*\.?/gi, '')
      .replace(/verified by trustindex\.?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (/trustindex|verify|original source|posted on google|posted on yelp/i.test(t)) return;
    if (t.length < 40 || t.length > 500) return;
    if (isMergedText(t)) return;
    if (/[|•]/.test(t)) return;

    // A review widget often renders "Author Name Quote text…" as one string.
    // Split a leading name off ONLY when it is a plausible person name — two or
    // three capitalised words with no business word in them. Without this guard
    // "Chapman Electric has done two projects…" gets split into author "Chapman"
    // and a mangled quote.
    const BUSINESS_WORD = /\b(electric|electrical|plumb|hvac|services?|llc|inc|corp|company|co|group|solutions?|contracting|construction|supply|associates?|partners?)\b/i;
    const leadName = t.match(/^([A-Z][A-Za-z.'-]+(?:\s+(?:[A-Z][A-Za-z.'-]+|[A-Z]\.?)){1,2})\s+(?=[A-Z])/);
    let leadAuthor: string | null = null;
    if (leadName && !BUSINESS_WORD.test(leadName[1])) {
      const rest = t.slice(leadName[1].length).trim();
      if (rest.length >= 40 && /^[A-Z]/.test(rest)) {
        leadAuthor = leadName[1];
        t = rest;
      }
    }

    if (testimonials.some((x) => x.quote === t)) return;

    // Try to pull an attribution off the end: "— Jane D., Austin TX".
    // Require a two-word name, or a single word preceded by a dash, so we do
    // not eat the last word of a sentence.
    let author: string | null = leadAuthor;
    if (!author) {
      const attrMatch = t.match(/[\s]{1,3}([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]*){1,3}(?:,\s*[A-Za-z .]{2,30})?)$/);
      const dashMatch = t.match(/[\s]*[—–]\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]*){0,3})$/);
      const cand = dashMatch?.[1] ?? attrMatch?.[1] ?? null;
      if (cand && cand.length <= 50 && !BUSINESS_WORD.test(cand)) {
        const rest = clean(t.slice(0, t.length - (dashMatch?.[0] ?? attrMatch?.[0] ?? '').length));
        if (rest.length >= 40) {
          author = clean(cand).replace(/[.,]$/, '');
          t = rest;
        }
      }
    }
    if (t.length < 40) return;
    testimonials.push({ quote: t, author });
  };

  $('blockquote').each((_, el) => addTestimonial($(el).text()));
  $('[class*="testimonial" i], [class*="review" i], [class*="quote" i]').each((_, el) => {
    const t = clean($(el).text());
    if (t.length <= 600) addTestimonial(t);
  });
  const testimonialsTrimmed = testimonials.slice(0, 6);

  // The same quote frequently appears twice — once in the widget's hidden
  // source text and once in the visible card, sometimes with the author's name
  // prefixed. Dedupe on a key with any leading name-like tokens stripped.
  const seenQuote = new Set<string>();
  const deduped = testimonialsTrimmed.filter((t) => {
    const norm = t.quote
      .replace(/^(?:[A-Z][A-Za-z.'-]*|[A-Z]\.)\s+/g, '') // drop leading name tokens
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 60);
    if (seenQuote.has(norm)) return false;
    seenQuote.add(norm);
    return true;
  });
  // Drop quotes that are just the author's name plus a fragment.
  const cleaned = deduped.filter((t) => t.quote.split(' ').length >= 8);
  if (cleaned.length === 0) missing.push('testimonials');

  /* ---------------- Images ---------------- */

  const images: ExtractedImage[] = [];
  const seenImg = new Set<string>();
  $('img').each((_, el) => {
    const rawSrc =
      $(el).attr('src') ??
      ($(el).attr('data-src') as string | undefined) ??
      ($(el).attr('srcset') ?? '').split(',')[0]?.trim().split(' ')[0];
    if (!rawSrc) return;

    const w = Number($(el).attr('width') ?? 0) || null;
    const h = Number($(el).attr('height') ?? 0) || null;
    const alt = clean($(el).attr('alt') ?? '');
    if (!isContentImage(rawSrc, w, h, alt)) return;

    const abs = absolutise(rawSrc, finalUrl);
    if (seenImg.has(abs)) return;
    seenImg.add(abs);
    images.push({ src: abs, alt });
  });

  // Open Graph image is usually the best hero candidate.
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const abs = absolutise(ogImage, finalUrl);
    if (!seenImg.has(abs)) {
      seenImg.add(abs);
      images.unshift({ src: abs, alt: `${businessName}` });
    }
  }
  const imagesTrimmed = images.slice(0, 12);
  if (imagesTrimmed.length === 0) missing.push('photographs');

  /* ---------------- Logo ---------------- */

  let logoUrl: string | null = null;
  const logoCandidates: string[] = [];
  $('img').each((_, el) => {
    const cls = `${$(el).attr('class') ?? ''} ${$(el).attr('id') ?? ''} ${$(el).attr('alt') ?? ''}`;
    const src = $(el).attr('src');
    if (!src) return;
    if (/logo|brand/i.test(cls)) logoCandidates.push(src);
  });
  // A logo lives in the header; a third-party widget does not.
  $('header img, a[class*="logo" i] img, a[id*="logo" i] img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) logoCandidates.push(src);
  });

  for (const c of logoCandidates) {
    const abs = absolutise(c, finalUrl);
    if (LOGO_HOST_DENY.test(abs)) continue;
    if (/\.(svg|png|jpe?g|webp|gif)(\?|$)/i.test(abs) === false) continue;
    logoUrl = abs;
    break;
  }
  const hasLogo = logoUrl !== null;

  /* ---------------- Nav + social ---------------- */

  const navItems: string[] = [];
  $('nav a, header a').each((_, el) => {
    const t = clean($(el).text());
    if (/skip to|jump to|toggle|open menu|close menu/i.test(t)) return;
    if (t.length >= 2 && t.length <= 30 && !navItems.includes(t)) navItems.push(t);
  });

  const socialLinks: Array<{ label: string; href: string }> = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    try {
      const host = new URL(href, finalUrl).hostname.replace(/^www\./, '');
      const key = Object.keys(SOCIAL_LABELS).find((k) => host === k || host.endsWith('.' + k));
      if (key) {
        const label = SOCIAL_LABELS[key];
        if (!socialLinks.some((s) => s.label === label)) {
          socialLinks.push({ label, href: absolutise(href, finalUrl) });
        }
      }
    } catch {
      /* not a URL */
    }
  });
  if (socialLinks.length === 0) missing.push('social profiles');

  const existingCtas: string[] = [];
  $('a, button').each((_, el) => {
    const t = clean($(el).text());
    if (t.length >= 3 && t.length <= 40 && /contact|call|book|schedule|quote|estimate|appointment|get started/i.test(t)) {
      if (!existingCtas.includes(t)) existingCtas.push(t);
    }
  });

  return {
    sourceUrl: finalUrl,
    origin,
    businessName,
    nameSource,
    tagline,
    headline,
    aboutParagraphs,
    phone,
    phoneHref,
    email,
    address,
    hours: hoursTrimmed,
    services: servicesTrimmed,
    testimonials: cleaned,
    images: imagesTrimmed,
    navItems: navItems.slice(0, 8),
    socialLinks,
    existingCtas: existingCtas.slice(0, 5),
    hasLogo,
    logoUrl,
    missing,
  };
}
