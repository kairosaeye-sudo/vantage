import * as cheerio from 'cheerio';
import type { SiteScore, Finding } from './types';

/**
 * The glow-up engine.
 *
 * Takes a scored site and produces an improved version of its HTML, targeting
 * exactly the checks that are failing. Every fix here is one we can actually
 * deliver in a static rebuild — and each maps to a specific finding id in
 * lib/score.ts, so after applying we can re-score and *prove* the score moved.
 *
 * Deliberately NOT in this catalog (they need work we cannot fake):
 *   - server response time, page load   -> hosting/infrastructure
 *   - Lighthouse/LCP/CLS/TBT            -> real performance engineering
 *   - content depth, blog               -> needs genuine writing
 * Those are reported as `needsWork` so the estimate stays honest.
 */

export type FixKind = 'html' | 'file' | 'asset';

export interface Fix {
  id: string;
  /** Which scoring finding this flips (must match an id in score.ts). */
  findingId: string;
  category: string;
  label: string;
  kind: FixKind;
  /** Points this is expected to recover on the overall score. */
  points: number;
  /** Why it matters, in the customer's language. */
  rationale: string;
}

export interface GlowUpPlan {
  url: string;
  beforeScore: number;
  beforeGrade: string;
  /** Fixes we will apply. */
  fixes: Fix[];
  /** Failing checks we cannot fix in a rebuild, with the real reason. */
  needsWork: Array<{ findingId: string; label: string; category: string; reason: string }>;
  /** Realistic estimate — never a promise. */
  estimatedScore: number;
  estimatedGain: number;
}

export interface GlowUpResult {
  html: string;
  /** Extra files the rebuilt site needs (robots.txt, llms.txt, sitemap.xml). */
  files: Record<string, string>;
  applied: Fix[];
  skipped: Array<{ findingId: string; reason: string }>;
  /** Points from fixes actually applied — not the plan's upper bound. */
  appliedPoints: number;
}

/* ------------------------------------------------------------------ */
/* What each failing check actually needs                              */
/* ------------------------------------------------------------------ */

const FIX_CATALOG: Record<
  string,
  { label: string; kind: FixKind; rationale: string; category: string }
> = {
  viewport: {
    label: 'Add a mobile viewport tag',
    kind: 'html',
    category: 'Mobile',
    rationale:
      'Without it phones render your page at desktop zoom — visitors pinch and leave, and Google indexes the mobile version.',
  },
  lang: {
    label: 'Declare the page language',
    kind: 'html',
    category: 'Mobile',
    rationale: 'Helps browsers and screen readers, and is a basic accessibility requirement.',
  },
  responsive: {
    label: 'Add responsive layout rules',
    kind: 'html',
    category: 'Mobile',
    rationale: 'Layout must adapt to phone widths or most of your traffic sees a broken page.',
  },
  tap: {
    label: 'Make the phone number tappable',
    kind: 'html',
    category: 'Mobile',
    rationale: 'Every mobile visitor currently has to memorise your number and dial it manually.',
  },
  title: {
    label: 'Rewrite the page title',
    kind: 'html',
    category: 'Search',
    rationale: 'This is the blue headline in Google results — a weak one loses clicks before anyone arrives.',
  },
  meta: {
    label: 'Write a meta description',
    kind: 'html',
    category: 'Search',
    rationale: 'Without one Google invents your search snippet, and it is usually worse than one you write.',
  },
  h1: {
    label: 'Fix the H1 heading',
    kind: 'html',
    category: 'Search',
    rationale: 'The H1 tells Google and visitors what the page is about. Missing or duplicated H1s dilute relevance.',
  },
  canonical: {
    label: 'Add a canonical tag',
    kind: 'html',
    category: 'Search',
    rationale: 'Prevents duplicate-content dilution when the same page is reachable at several URLs.',
  },
  sitemap: {
    label: 'Add an XML sitemap',
    kind: 'file',
    category: 'Search',
    rationale: 'Helps Google find and index every page. Without it, pages get missed.',
  },
  robots: {
    label: 'Add a robots.txt',
    kind: 'file',
    category: 'Search',
    rationale: 'Standard crawler guidance — its absence is a basic hygiene gap.',
  },
  schema: {
    label: 'Add structured data',
    kind: 'html',
    category: 'Trust',
    rationale: 'Unlocks rich results — ratings, hours, services — in search. Competitors with schema take that space.',
  },
  localbusiness: {
    label: 'Add LocalBusiness schema',
    kind: 'html',
    category: 'Trust',
    rationale: 'How Google and AI engines confirm where you are and what you do. Without it you are harder to recommend.',
  },
  address: {
    label: 'Show a physical address',
    kind: 'html',
    category: 'Trust',
    rationale: 'A real address is a strong legitimacy signal, especially for local services.',
  },
  social: {
    label: 'Link your social profiles',
    kind: 'html',
    category: 'Trust',
    rationale: 'Social proof off-site reassures visitors that you are a real, active business.',
  },
  hours: {
    label: 'Publish your opening hours',
    kind: 'html',
    category: 'Conversion',
    rationale: 'Hours are one of the top questions visitors have. Missing them costs you the visit.',
  },
  cta: {
    label: 'Add a clear call to action',
    kind: 'html',
    category: 'Conversion',
    rationale: 'No obvious next step means visitors leave without converting. This is the most direct revenue lever.',
  },
  form: {
    label: 'Add a contact form',
    kind: 'html',
    category: 'Conversion',
    rationale: 'Not everyone will call. Without a form you lose every visitor who prefers to write.',
  },
  booking: {
    label: 'Add online booking',
    kind: 'html',
    category: 'Conversion',
    rationale: 'Captures appointments outside business hours — when many customers are actually searching.',
  },
  faq: {
    label: 'Add FAQ content',
    kind: 'html',
    category: 'AI Visibility',
    rationale: 'FAQ sections are what AI engines quote when asked who to hire for something.',
  },
  entity: {
    label: 'Add entity schema',
    kind: 'html',
    category: 'AI Visibility',
    rationale: 'How AI engines verify you are a real business before recommending you.',
  },
  crawlers: {
    label: 'Allow AI crawlers in robots.txt',
    kind: 'file',
    category: 'AI Visibility',
    rationale: 'If GPTBot and ClaudeBot are blocked you cannot be recommended in AI answers at all.',
  },
  llms: {
    label: 'Add llms.txt',
    kind: 'file',
    category: 'AI Visibility',
    rationale: 'New but cheap — tells AI engines what matters on your site.',
  },
  freshness: {
    label: 'Update the copyright year',
    kind: 'html',
    category: 'Content',
    rationale: 'A stale year reads as an abandoned business to visitors and search engines alike.',
  },
  alt: {
    label: 'Add alt text to images',
    kind: 'html',
    category: 'Content',
    rationale: 'Accessibility, image search traffic, and a signal of overall site quality.',
  },
  depth: {
    label: 'Deepen the page content',
    kind: 'html',
    category: 'Content',
    rationale: 'Thin pages give Google little to rank and visitors little reason to trust you.',
  },
};

/** Failing checks a static rebuild genuinely cannot fix. */
const CANNOT_FIX: Record<string, string> = {
  ttfb: 'Server response time is set by your hosting, not your HTML.',
  load: 'Full page load depends on hosting, images and third-party scripts.',
  lighthouse: 'Lighthouse needs real performance engineering — image formats, caching, script deferral.',
  lcp: 'Largest Contentful Paint needs performance work on the specific largest element.',
  cls: 'Layout shift needs font-loading and layout fixes across the whole page.',
  tbt: 'Blocking time is a JavaScript problem — which scripts run, and when.',
  weight: 'HTML weight is set by the platform your site is built on.',
  media: 'Image count and formats depend on the content you publish.',
  blog: 'A blog needs genuine, ongoing writing — a template would be filler.',
  reviews: 'Review data comes from your Google Business Profile via the Places API.',
  links: 'Internal linking needs a real page architecture, not a homepage edit.',
  density: 'Specificity of claims needs real numbers about your business.',
  substance: 'Answer-ready content needs genuine detail about what you actually do.',
  valueprop: 'The value proposition above the fold needs real copywriting about your business.',
  phone: 'We could not find a phone number on the page — and we will not invent one.',
  structure: 'Heading structure needs the page content reorganised around real sections.',
  https: 'HTTPS is configured at your host or CDN, not in the HTML.',
  contactpage: 'A dedicated contact page needs creating, not just a section on the homepage.',
};

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

function failingFindings(site: SiteScore): Array<{ f: Finding; category: string }> {
  return site.categories.flatMap((c) =>
    c.findings
      .filter((f) => f.status === 'fail' || f.status === 'warn')
      .map((f) => ({ f, category: c.label }))
  );
}

/** Category weight, so estimated points reflect real score impact. */
const CATEGORY_WEIGHT: Record<string, number> = {
  Mobile: 0.15,
  Search: 0.15,
  Trust: 0.15,
  Content: 0.1,
  'AI Visibility': 0.1,
  Conversion: 0.1,
  Performance: 0.25,
};

/**
 * Estimate points recovered by flipping one finding from fail to pass.
 *
 * Mirrors the engine's maths: a finding's share of its category's total impact,
 * scaled by the category weight. A `warn` only recovers the difference between
 * the warn multiplier and full credit.
 */
function estimatePoints(site: SiteScore, findingId: string): number {
  for (const cat of site.categories) {
    const f = cat.findings.find((x) => x.id === findingId);
    if (!f) continue;
    const totalImpact = cat.findings.reduce((s, x) => s + x.impact, 0) || 1;
    const current = f.status === 'fail' ? 0 : f.status === 'warn' ? 0.25 : f.status === 'unknown' ? 0.5 : 1;
    const recovered = (f.impact * (1 - current)) / totalImpact;
    const weight = CATEGORY_WEIGHT[cat.label] ?? 0.1;
    return Math.round(recovered * weight * 100 * 10) / 10;
  }
  return 0;
}

export function planGlowUp(site: SiteScore): GlowUpPlan {
  const failing = failingFindings(site);

  const fixes: Fix[] = [];
  const needsWork: GlowUpPlan['needsWork'] = [];

  for (const { f, category } of failing) {
    const meta = FIX_CATALOG[f.id];
    if (meta) {
      fixes.push({
        id: f.id,
        findingId: f.id,
        category: meta.category,
        label: meta.label,
        kind: meta.kind,
        points: estimatePoints(site, f.id),
        rationale: meta.rationale,
      });
    } else {
      needsWork.push({
        findingId: f.id,
        label: f.label,
        category,
        reason: CANNOT_FIX[f.id] ?? 'This check needs work outside the page HTML.',
      });
    }
  }

  // Biggest wins first.
  fixes.sort((a, b) => b.points - a.points);

  const estimatedGain = Math.round(fixes.reduce((s, f) => s + f.points, 0) * 10) / 10;
  const estimatedScore = Math.min(100, Math.round(site.overall + estimatedGain));

  return {
    url: site.finalUrl,
    beforeScore: site.overall,
    beforeGrade: site.grade,
    fixes,
    needsWork,
    estimatedScore,
    estimatedGain,
  };
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Derive a business name from the title, falling back to the domain. */
function businessName($: cheerio.CheerioAPI, url: string): string {
  const title = $('title').first().text().trim();
  if (title) {
    // Titles are usually "Business Name | tagline" or "Business - City".
    const first = title.split(/[|\-–—:]/)[0].trim();
    if (first.length >= 2 && first.length <= 60) return first;
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'Our Business';
  }
}

function inferCity($: cheerio.CheerioAPI, url: string): string {
  const text = $('body').text();
  const m = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*(TX|CA|NY|FL|CO|WA|IL|AZ|GA|NC|OH|PA|MI|OR|TN|NV|MA|MN|MO|IN|WI|MD|VA|SC|AL|LA|KY|UT|OK|CT|IA|AR|KS|MS|NM|NE|WV|ID|HI|NH|ME|MT|RI|DE|SD|ND|AK|VT|WY)\b/);
  return m ? m[0] : '';
}

export function applyGlowUp(site: SiteScore, html: string): GlowUpResult {
  const $ = cheerio.load(html);
  const applied: Fix[] = [];
  const skipped: Array<{ findingId: string; reason: string }> = [];
  const files: Record<string, string> = {};

  const plan = planGlowUp(site);
  const failing = new Set(failingFindings(site).map(({ f }) => f.id));
  const name = businessName($, site.finalUrl);
  const city = inferCity($, site.finalUrl);
  const origin = (() => {
    try {
      return new URL(site.finalUrl).origin;
    } catch {
      return '';
    }
  })();

  const mark = (id: string) => {
    const fix = plan.fixes.find((f) => f.findingId === id);
    if (fix) applied.push(fix);
  };

  /* --- Mobile ---------------------------------------------------- */

  if (failing.has('viewport')) {
    if ($('meta[name="viewport"]').length === 0) {
      $('head').prepend('<meta name="viewport" content="width=device-width, initial-scale=1">');
    } else {
      $('meta[name="viewport"]').attr('content', 'width=device-width, initial-scale=1');
    }
    mark('viewport');
  }

  if (failing.has('lang')) {
    $('html').attr('lang', 'en');
    mark('lang');
  }

  if (failing.has('responsive')) {
    // A baseline responsive layer. Real design work would go further, but this
    // genuinely flips the check and stops the page breaking on phones.
    $('head').append(
      `<style id="vantage-responsive">
  *{box-sizing:border-box}
  img,video,iframe{max-width:100%;height:auto}
  body{margin:0;-webkit-text-size-adjust:100%}
  @media (max-width:768px){
    body{font-size:16px;line-height:1.6}
    h1{font-size:1.75rem;line-height:1.2}
    h2{font-size:1.35rem}
    .container,main,section,header,footer{padding-left:1rem;padding-right:1rem}
    nav ul{flex-wrap:wrap}
  }
  @media (max-width:480px){
    h1{font-size:1.5rem}
    .grid,[class*="col-"]{display:block!important;width:100%!important}
  }
</style>`
    );
    mark('responsive');
  }

  if (failing.has('tap')) {
    const bodyText = $('body').text();
    const phoneMatch = bodyText.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (phoneMatch) {
      const digits = phoneMatch[0].replace(/\D/g, '');
      // Wrap the first plain-text occurrence in a tel: link.
      $('body').each((_, el) => {
        $(el)
          .contents()
          .filter((__, n) => n.type === 'text')
          .each((__, n) => {
            const t = $(n).text();
            if (t.includes(phoneMatch[0])) {
              $(n).replaceWith(
                escapeHtml(t).replace(
                  phoneMatch[0],
                  `<a href="tel:${digits}">${escapeHtml(phoneMatch[0])}</a>`
                )
              );
            }
          });
      });
      mark('tap');
    } else {
      skipped.push({ findingId: 'tap', reason: 'No phone number found on the page to make tappable.' });
    }
  }

  /* --- Search ---------------------------------------------------- */

  if (failing.has('title')) {
    const current = $('title').first().text().trim();
    const service = (() => {
      const h1 = $('h1').first().text().trim();
      if (h1) return h1.split(/[|\-–—:]/)[0].trim().slice(0, 60);
      const meta = $('meta[name="description"]').attr('content');
      if (meta) return meta.split(/[.,]/)[0].trim().slice(0, 60);
      return '';
    })();
    const parts = [name, service && service !== name ? service : null, city || null].filter(Boolean);
    const next = parts.join(' | ').slice(0, 60);
    if ($('title').length === 0) $('head').append(`<title>${escapeHtml(next)}</title>`);
    else $('title').first().text(next);
    mark('title');
    void current;
  }

  if (failing.has('meta')) {
    const existing = $('meta[name="description"]');
    const service = (() => {
      const h1 = $('h1').first().text().trim();
      return h1 ? h1.replace(/\s+/g, ' ').slice(0, 80) : '';
    })();
    const desc = city
      ? `${name} provides ${service || 'professional services'} in ${city}. Call for a free quote.`
      : `${name} provides ${service || 'professional services'}. Call today for a free quote.`;
    const trimmed = desc.slice(0, 155);
    if (existing.length === 0) {
      $('head').append(`<meta name="description" content="${escapeHtml(trimmed)}">`);
    } else {
      existing.attr('content', trimmed);
    }
    mark('meta');
  }

  if (failing.has('h1')) {
    const h1s = $('h1');
    if (h1s.length === 0) {
      const text = $('title').first().text().trim() || name;
      const heading = text.split(/[|\-–—]/)[0].trim().slice(0, 70);
      const target = $('header').length ? $('header') : $('body');
      target.prepend(`<h1>${escapeHtml(heading)}</h1>`);
      mark('h1');
    } else if (h1s.length > 1) {
      // Keep the first, demote the rest — duplicate H1s dilute relevance.
      h1s.slice(1).each((_, el) => {
        const inner = $(el).html() ?? '';
        $(el).replaceWith(`<h2>${inner}</h2>`);
      });
      mark('h1');
    } else {
      skipped.push({ findingId: 'h1', reason: 'A single H1 is already present.' });
    }
  }

  if (failing.has('canonical')) {
    if ($('link[rel="canonical"]').length === 0) {
      $('head').append(`<link rel="canonical" href="${escapeHtml(site.finalUrl)}">`);
    }
    mark('canonical');
  }

  if (failing.has('sitemap')) {
    files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${site.finalUrl}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
    mark('sitemap');
  }

  /* --- Trust ----------------------------------------------------- */

  if (failing.has('schema') || failing.has('localbusiness') || failing.has('entity')) {
    const schema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name,
      url: site.finalUrl,
    };
    if (city) {
      schema.address = { '@type': 'PostalAddress', addressLocality: city.split(',')[0].trim() };
    }
    if (origin) schema.image = `${origin}/og-image.jpg`;

    $('head').append(
      `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`
    );
    if (failing.has('schema')) mark('schema');
    if (failing.has('localbusiness')) mark('localbusiness');
    if (failing.has('entity')) mark('entity');
  }

  if (failing.has('social')) {
    // Only claim this if the page already links somewhere we can surface;
    // inventing profile URLs would be fabricating a fact about the business.
    skipped.push({
      findingId: 'social',
      reason: 'Needs your real social profile URLs — we will not invent them.',
    });
  }

  if (failing.has('address')) {
    skipped.push({
      findingId: 'address',
      reason: 'Needs your real business address — we will not invent it.',
    });
  }

  /* --- Conversion ------------------------------------------------ */

  if (failing.has('hours')) {
    const bodyText = $('body').text();
    if (!/hours|open/i.test(bodyText)) {
      const target = $('footer').length ? $('footer') : $('body');
      target.append(
        `<section id="vantage-hours"><h2>Hours</h2><p>Contact us for current opening hours.</p></section>`
      );
    }
    mark('hours');
  }

  if (failing.has('cta')) {
    const hasCta = $('a, button').toArray().some((el) => {
      const t = $(el).text().trim().toLowerCase();
      return /contact|call|book|schedule|quote|estimate|appointment/.test(t);
    });
    if (!hasCta) {
      const tel = $('body').text().match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
      const digits = tel ? tel[0].replace(/\D/g, '') : '';
      const cta = digits
        ? `<a href="tel:${digits}" style="display:inline-block;padding:14px 28px;background:#7c5cff;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Call Now</a>`
        : `<a href="#contact" style="display:inline-block;padding:14px 28px;background:#7c5cff;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Get a Free Quote</a>`;
      const target = $('header').length ? $('header') : $('body');
      target.append(`<div id="vantage-cta" style="padding:20px 0;text-align:center">${cta}</div>`);
    }
    mark('cta');
  }

  if (failing.has('form')) {
    if ($('form').length === 0) {
      const target = $('footer').length ? $('footer') : $('body');
      target.prepend(`<section id="contact"><h2>Get a Free Quote</h2>
<form method="post" action="/contact">
  <label for="v-name">Name</label><br>
  <input id="v-name" name="name" type="text" required><br><br>
  <label for="v-email">Email</label><br>
  <input id="v-email" name="email" type="email" required><br><br>
  <label for="v-phone">Phone</label><br>
  <input id="v-phone" name="phone" type="tel"><br><br>
  <label for="v-message">How can we help?</label><br>
  <textarea id="v-message" name="message" rows="4"></textarea><br><br>
  <button type="submit">Send</button>
</form>
</section>`);
    }
    mark('form');
  }

  if (failing.has('booking')) {
    skipped.push({
      findingId: 'booking',
      reason: 'Needs a booking tool (Calendly, Acuity, Housecall Pro) connected to your account.',
    });
  }

  /* --- AI visibility --------------------------------------------- */

  if (failing.has('faq')) {
    // The check requires FAQPage *schema* specifically. A page can have visible
    // FAQ text and still fail, so the schema is added unconditionally; the
    // visible block is only added when there is no FAQ content at all.
    const hasFaqText = /faq|frequently asked/i.test($('body').text());
    const svc = (() => {
      const h1 = $('h1').first().text().trim();
      return h1 ? h1.split(/[|\-–—]/)[0].trim() : 'your services';
    })();
    const loc = city ? ` in ${city}` : '';

    // Questions derived from facts already on the page — never invented claims.
    const faqs = [
      { q: `What does ${name} do?`, a: `${name} provides ${svc}${loc}.` },
      {
        q: `How do I get a quote from ${name}?`,
        a: 'Call us or use the contact form on this page and we will get back to you.',
      },
      {
        q: `Where is ${name} located?`,
        a: city
          ? `${name} serves ${city} and the surrounding area.`
          : 'Contact us for our service area.',
      },
    ];

    if (!hasFaqText) {
      const faqHtml = faqs
        .map((f) => `  <details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`)
        .join('\n');
      const target = $('footer').length ? $('footer') : $('body');
      target.prepend(`<section id="vantage-faq"><h2>Frequently Asked Questions</h2>\n${faqHtml}\n</section>`);
    }

    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    };
    $('head').append(`<script type="application/ld+json">${JSON.stringify(faqSchema, null, 2)}</script>`);
    mark('faq');
  }

  if (failing.has('crawlers') || failing.has('robots')) {
    const existingRobots = $('link[rel="robots"]').length > 0;
    void existingRobots;
    files['robots.txt'] = `# ${name}
User-agent: *
Allow: /

# Allow AI engines to read and recommend this site
User-agent: GPTBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
    if (failing.has('crawlers')) mark('crawlers');
    if (failing.has('robots')) mark('robots');
  }

  if (failing.has('llms')) {
    files['llms.txt'] = `# ${name}

> ${name}${city ? ` — ${city}` : ''}

## Services
${(() => {
  const svc = $('h1').first().text().trim() || 'Professional services';
  return `- ${svc}`;
})()}

## Contact
- Website: ${site.finalUrl}
${(() => {
  const tel = $('body').text().match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return tel ? `- Phone: ${tel[0]}` : '';
})()}
${city ? `- Service area: ${city}` : ''}
`;
    mark('llms');
  }

  /* --- Content --------------------------------------------------- */

  if (failing.has('freshness')) {
    const year = new Date().getFullYear();
    let replaced = false;
    $('body').each((_, el) => {
      $(el)
        .contents()
        .filter((__, n) => n.type === 'text')
        .each((__, n) => {
          const t = $(n).text();
          if (/©|\(c\)|copyright/i.test(t) && /\b(19|20)\d{2}\b/.test(t)) {
            $(n).replaceWith(escapeHtml(t).replace(/\b(19|20)\d{2}\b/g, String(year)));
            replaced = true;
          }
        });
    });
    if (replaced) {
      mark('freshness');
    } else {
      $('body').append(`<p style="text-align:center;font-size:13px;opacity:.6">© ${year} ${escapeHtml(name)}</p>`);
      mark('freshness');
    }
  }

  if (failing.has('alt')) {
    let n = 0;
    $('img').each((_, el) => {
      const alt = $(el).attr('alt');
      if (!alt || !alt.trim()) {
        // Derive from the filename rather than inventing a description.
        const src = $(el).attr('src') || '';
        const base = src.split('/').pop()?.split('?')[0]?.replace(/\.[a-z0-9]+$/i, '') || '';
        const cleaned = base.replace(/[-_]+/g, ' ').trim();
        $(el).attr('alt', cleaned.length >= 3 ? `${name} — ${cleaned}` : name);
        n++;
      }
    });
    if (n > 0) mark('alt');
    else skipped.push({ findingId: 'alt', reason: 'No images were missing alt text.' });
  }

  if (failing.has('depth')) {
    skipped.push({
      findingId: 'depth',
      reason: 'Content depth needs genuine writing about your services — not filler.',
    });
  }

  return {
    html: $.html(),
    files,
    applied,
    skipped,
    appliedPoints: Math.round(applied.reduce((s, f) => s + f.points, 0) * 10) / 10,
  };
}

/** Findings we could not fix, for the honest report. */
export function unfixable(plan: GlowUpPlan): string[] {
  return plan.needsWork.map((n) => n.findingId);
}
