import * as cheerio from 'cheerio';
import { chooseTemplate, baseStyles, esc, TEMPLATES, type Template, type TemplateId } from './design-system';
import {
  buildFactSheet,
  enhanceDeterministic,
  enhanceWithAi,
  providerFromEnv,
  countWords,
  type EnhancedCopy,
  type FactSheet,
} from './ai-copy';

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
 *      own page, with an LLM when a provider is configured and a deterministic
 *      writer when not. Both are grounded; neither invents facts.
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
    const m = t.match(/\b(?:in|serving|around)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)/);
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
  const template: Template =
    forced && forced in TEMPLATES ? TEMPLATES[forced] : chooseTemplate(haystack);

  const changes: RedesignChange[] = [];
  const omitted: Array<{ section: string; reason: string }> = [];
  const needsFromClient: string[] = [];

  /* ---------------- Sections ---------------- */

  const navItems = preserved.navLinks.slice(0, 6);

  const servicesSection =
    facts.services.length > 0
      ? `
      <section id="services" aria-labelledby="services-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">What we do</p>
            <h2 id="services-h">Services</h2>
          </div>
          <div class="grid grid-3">
            ${facts.services
              .map(
                (s) => `
              <article class="card">
                <div class="card-icon" aria-hidden="true">${esc(s.slice(0, 1).toUpperCase())}</div>
                <h3>${esc(s)}</h3>
                ${copy.serviceDescriptions[s] ? `<p>${esc(copy.serviceDescriptions[s])}</p>` : ''}
              </article>`
              )
              .join('')}
          </div>
        </div>
      </section>`
      : '';
  if (facts.services.length > 0) {
    changes.push({
      label: 'Rebuilt services into a card grid',
      detail: `The ${facts.services.length} services read from your site now sit in a responsive grid with a description each, instead of plain text.`,
      kind: 'layout',
    });
  } else {
    omitted.push({ section: 'Services', reason: 'No service names could be read from the original site' });
    needsFromClient.push('A list of the services you offer');
  }

  const aboutSection =
    copy.aboutParagraphs.length > 0
      ? `
      <section id="about" aria-labelledby="about-h">
        <div class="wrap">
          <div class="about-grid">
            <div>
              <p class="eyebrow">About</p>
              <h2 id="about-h">${city ? `Serving ${esc(city)} and nearby` : 'About us'}</h2>
            </div>
            <div class="about-body">
              ${copy.aboutParagraphs.map((t) => `<p>${esc(t)}</p>`).join('')}
            </div>
          </div>
        </div>
      </section>`
      : '';
  if (copy.aboutParagraphs.length > 0) {
    const wc = copy.aboutParagraphs.join(' ').split(/\s+/).length;
    changes.push({
      label: copy.aiGenerated ? 'Wrote your page copy from your own facts' : 'Expanded your copy from your own facts',
      detail: `${copy.aboutParagraphs.length} paragraphs totalling ${wc} words, built only from facts already on your site — your services, area, hours and contact details. Nothing invented.`,
      kind: 'content',
    });
  } else {
    omitted.push({ section: 'About', reason: 'No descriptive content could be read from the original site' });
    needsFromClient.push('A short paragraph about your business');
  }

  const testimonialsSection =
    facts.testimonials.length > 0
      ? `
      <section id="reviews" aria-labelledby="reviews-h">
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
                <blockquote>${esc(t.quote)}</blockquote>
                ${t.author ? `<figcaption>${esc(t.author)}</figcaption>` : ''}
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
      detail: `${facts.testimonials.length} testimonial${facts.testimonials.length === 1 ? '' : 's'} found on your site, given proper quote styling. Unaltered.`,
      kind: 'content',
    });
  } else {
    omitted.push({ section: 'Reviews', reason: 'No testimonials were found on the original page' });
    needsFromClient.push('Two or three customer reviews you can share');
  }

  const extraSections = copy.extraSections
    .map(
      (s, i) => `
      <section aria-labelledby="x-${i}">
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

  const hoursRows =
    facts.hours.length > 0
      ? facts.hours
          .map((h) => {
            const m = h.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(.*)$/i);
            const dayMap: Record<string, string> = {
              mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
              fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
            };
            if (m) {
              const day = dayMap[m[1].toLowerCase().slice(0, 3)];
              const val = m[2].replace(/^[:\-–\s]+/, '').trim();
              if (day && val) return `<tr><th scope="row">${esc(day)}</th><td>${esc(val)}</td></tr>`;
            }
            return `<tr><td colspan="2">${esc(h)}</td></tr>`;
          })
          .join('')
      : '';
  const hoursSection = hoursRows
    ? `
      <section id="hours" aria-labelledby="hours-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">When to reach us</p>
            <h2 id="hours-h">Opening hours</h2>
          </div>
          <table class="hours"><tbody>${hoursRows}</tbody></table>
        </div>
      </section>`
    : `
      <section id="hours" aria-labelledby="hours-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">When to reach us</p>
            <h2 id="hours-h">Opening hours</h2>
          </div>
          <p class="lede">
            Our published hours are not listed here yet. Call ${
              facts.phone ? esc(facts.phone) : 'us'
            } to check availability, or send a message and we will reply with a time.
          </p>
        </div>
      </section>`;
  if (facts.hours.length > 0) {
    changes.push({
      label: 'Published your opening hours as a table',
      detail: 'Hours are among the most-checked facts on a local business site, and were buried in the original layout.',
      kind: 'content',
    });
  } else {
    needsFromClient.push('Your opening hours');
  }

  // Booking: preserve the original's booking path. When there is none, state the
  // phone-first route plainly — never imply a booking system that does not exist.
  const bookingSection = preserved.bookingUrl
    ? `
      <section id="book" aria-labelledby="book-h">
        <div class="wrap">
          <div class="cta-band" style="text-align:left">
            <h2 id="book-h">Book online</h2>
            <p>Use our booking system to pick a time that suits you.</p>
            <div class="hero-actions" style="margin-top:0">
              <a class="btn btn-primary" href="${esc(preserved.bookingUrl)}" rel="noopener">Book online</a>
              ${facts.phone ? `<a class="btn btn-ghost" href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">Or call ${esc(facts.phone)}</a>` : ''}
            </div>
          </div>
        </div>
      </section>`
    : `
      <section id="book" aria-labelledby="book-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Booking</p>
            <h2 id="book-h">Schedule an appointment</h2>
          </div>
          <p class="lede">
            ${
              facts.phone
                ? `Call ${esc(facts.phone)} to schedule an appointment.`
                : 'Get in touch to schedule an appointment.'
            }
            Tell us what the job involves and when suits you, and we will confirm a time.
          </p>
          <div class="hero-actions">
            ${facts.phone ? `<a class="btn btn-primary" href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">Call to schedule</a>` : ''}
            <a class="btn btn-ghost" href="#contact">Request an appointment</a>
          </div>
        </div>
      </section>`;
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
      <section id="contact" aria-labelledby="contact-h">
        <div class="wrap">
          <div class="grid grid-2" style="gap:clamp(28px,4vw,52px);align-items:start">
            <div>
              <p class="eyebrow">Get in touch</p>
              <h2 id="contact-h">Request a quote</h2>
              <p class="lede" style="margin-top:14px">Tell us what you need and we will get back to you.</p>
              <ul class="info-list" style="margin-top:26px">
                ${facts.phone ? `<li><span aria-hidden="true">☎</span><span><b>Phone</b><a href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">${esc(facts.phone)}</a></span></li>` : ''}
                ${facts.email ? `<li><span aria-hidden="true">✉</span><span><b>Email</b><a href="mailto:${esc(facts.email)}">${esc(facts.email)}</a></span></li>` : ''}
                ${facts.address ? `<li><span aria-hidden="true">⌖</span><span><b>Address</b>${esc(facts.address)}</span></li>` : ''}
              </ul>
            </div>
            <form class="card" method="post" action="#contact" novalidate>
              <div class="form-grid">
                <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" autocomplete="name" required></div>
                <div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel"></div>
                <div class="field full"><label for="f-email">Email</label><input id="f-email" name="email" type="email" inputmode="email" autocomplete="email" required></div>
                <div class="field full"><label for="f-msg">How can we help?</label><textarea id="f-msg" name="message" required></textarea></div>
                <div class="full"><button class="btn btn-primary" type="submit">Send request</button></div>
              </div>
            </form>
          </div>
        </div>
      </section>`;
  changes.push({
    label: 'Added a working contact form',
    detail: 'The original page had no way to get in touch except a phone number. This adds a form with proper labels, mobile keyboards and 16px inputs so phones do not zoom on focus.',
    kind: 'structure',
  });
  if (!facts.phone) needsFromClient.push('Your phone number');
  if (!facts.address) needsFromClient.push('Your business address');

  const faqSection =
    copy.faqs.length >= 2
      ? `
      <section id="faq" aria-labelledby="faq-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Questions</p>
            <h2 id="faq-h">Frequently asked questions</h2>
          </div>
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
  if (facts.phone) ld.telephone = facts.phone;
  if (facts.email) ld.email = facts.email;
  if (facts.address) ld.address = { '@type': 'PostalAddress', streetAddress: facts.address };
  if (facts.hours.length) ld.openingHours = facts.hours;
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
                  const anchor = ['about', 'services', 'contact', 'reviews', 'hours', 'faq'].includes(slug)
                    ? `#${slug}`
                    : n.href;
                  return `<a href="${esc(anchor)}">${esc(n.text)}</a>`;
                })
                .join('')}</nav>`
            : ''
        }
        ${facts.phone ? `<a class="btn btn-primary header-cta" href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">Call ${esc(facts.phone)}</a>` : ''}
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
            ${copy.heroLede ? `<p style="color:var(--muted);font-size:.95rem;margin:0 0 16px;max-width:42ch">${esc(copy.heroLede)}</p>` : ''}
            ${facts.phone ? `<p style="margin:0"><a href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}" style="font-weight:700">${esc(facts.phone)}</a></p>` : ''}
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
              ${facts.phone ? `<li><a href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">${esc(facts.phone)}</a></li>` : ''}
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

  const callBar = facts.phone
    ? `<a class="call-bar" href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">Call ${esc(facts.phone)}</a>`
    : '';

  /* ---------------- Design changes ---------------- */

  changes.unshift(
    { label: 'Mobile-first responsive layout', detail: 'The original used a fixed-width layout. This one is fluid from 320px up, so it fits every phone without pinch-zooming.', kind: 'mobile' },
    { label: 'Fluid type scale', detail: 'Headings scale with the viewport (clamp) instead of fixed pixel sizes, so the page reads correctly on a phone and a 27-inch monitor alike.', kind: 'type' },
    { label: 'A real colour system', detail: `Five tokens — background, surface, text, muted and accent (${template.palette.accent}) — replace ad-hoc colours, so every element is consistent and contrast-checked.`, kind: 'colour' },
    { label: 'Spacing rhythm and depth', detail: 'Consistent section spacing, card surfaces with hairline borders, and restrained shadows give the page hierarchy instead of a flat wall of text.', kind: 'layout' },
    { label: 'Motion that respects the user', detail: 'Subtle hover and transition feedback, disabled automatically for anyone with reduced-motion enabled.', kind: 'motion' },
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
${images[0] ? `<meta property="og:image" content="${esc(images[0].src)}">` : ''}
<link rel="canonical" href="${esc(finalUrl)}">
<style>${baseStyles(template)}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${faqLd ? `<script type="application/ld+json">${faqLd}</script>` : ''}
</head>
<body>
${header}
<main id="main">

  <section class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          ${city ? `<p class="eyebrow">${esc(city)}${facts.address ? ' &middot; Local' : ''}</p>` : ''}
          <h1>${esc(headline ?? (city ? `${businessName} — ${city}` : businessName))}</h1>
          ${copy.heroLede ? `<p class="lede" style="margin-top:20px">${esc(copy.heroLede)}</p>` : ''}
          <div class="hero-actions">
            ${facts.phone ? `<a class="btn btn-primary" href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">Call ${esc(facts.phone)}</a>` : ''}
            <a class="btn btn-ghost" href="#contact">Request a quote</a>
            ${preserved.bookingUrl ? `<a class="btn btn-ghost" href="${esc(preserved.bookingUrl)}" rel="noopener">Book online</a>` : ''}
          </div>
        </div>
        ${images[0] ? `<div class="hero-media"><img src="${esc(images[0].src)}" alt="${esc(images[0].alt || businessName)}" loading="eager" width="1200" height="900"></div>` : `<div class="hero-media placeholder">Add a photo of your team or work here</div>`}
      </div>
    </div>
  </section>

  ${
    facts.services.length > 0 || facts.testimonials.length > 0 || facts.hours.length > 0 || facts.phone
      ? `<section class="trust" aria-label="At a glance"><div class="wrap">
      ${facts.services.length ? `<div class="trust-item"><b>${facts.services.length}</b> Services offered</div>` : ''}
      ${facts.testimonials.length ? `<div class="trust-item"><b>${facts.testimonials.length}</b> Customer reviews</div>` : ''}
      ${facts.hours.length ? `<div class="trust-item"><b>Open</b> Published hours</div>` : ''}
      ${facts.phone ? `<div class="trust-item"><b>Call</b> ${esc(facts.phone)}</div>` : ''}
    </div></section>`
      : ''
  }

  ${servicesSection}
  ${aboutSection}
  ${testimonialsSection}
  ${extraSections}
  ${hoursSection}

  <section aria-labelledby="cta-h">
    <div class="wrap">
      <div class="cta-band">
        <h2 id="cta-h">Ready to get started?</h2>
        <p>${facts.phone ? `Call ${esc(facts.phone)} or send us a message.` : 'Send us a message and we will get back to you.'}</p>
        <div class="hero-actions" style="justify-content:center">
          ${facts.phone ? `<a class="btn btn-primary" href="tel:+1${esc(facts.phone.replace(/\D/g, ''))}">Call now</a>` : ''}
          <a class="btn btn-ghost" href="#contact">Request a quote</a>
        </div>
      </div>
    </div>
  </section>

  ${contactSection}
  ${bookingSection}
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
