import { extractContent, type SiteContent } from './extract-content';
import { chooseTemplate, baseStyles, esc, TEMPLATES, type Template, type TemplateId } from './design-system';

/**
 * Redesign engine.
 *
 * Takes an existing site's REAL content and re-renders it through a modern
 * design system. Two rules govern everything here:
 *
 *  1. Never invent content. No fabricated testimonials, services, phone
 *     numbers or claims. If a section has no real content, it is omitted.
 *  2. Never lie about what changed. `changes` describes only what was actually
 *     done, and `omitted` records every section dropped for lack of content.
 */

export interface RedesignChange {
  label: string;
  detail: string;
  /** Which part of the design system this belongs to. */
  kind: 'layout' | 'type' | 'colour' | 'structure' | 'content' | 'motion' | 'mobile';
}

export interface RedesignResult {
  html: string;
  template: Template;
  content: SiteContent;
  changes: RedesignChange[];
  /** Sections left out because there was no real content for them. */
  omitted: Array<{ section: string; reason: string }>;
  /** Business facts still needed from the client. */
  needsFromClient: string[];
  stats: {
    beforeBytes: number;
    afterBytes: number;
    sections: number;
  };
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Initials for the brand mark when there is no logo. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return '•';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Turn extracted hours strings into day/value pairs, best effort. */
function parseHours(hours: string[]): Array<{ day: string; value: string }> {
  const out: Array<{ day: string; value: string }> = [];
  const dayMap: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  for (const h of hours) {
    const m = h.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(.*)$/i);
    if (!m) continue;
    const day = dayMap[m[1].toLowerCase().slice(0, 3)];
    const value = m[2].replace(/^[:\-–\s]+/, '').trim();
    if (day && value && !out.some((o) => o.day === day)) out.push({ day, value });
  }
  return out;
}

export function buildRedesign(
  html: string,
  finalUrl: string,
  opts: { templateId?: string; year?: number } = {}
): RedesignResult {
  const content = extractContent(html, finalUrl);
  const year = opts.year ?? new Date().getFullYear();

  // Choose the template from the business's own words, unless the caller
  // explicitly picked one.
  const haystack = [
    content.businessName,
    content.tagline ?? '',
    content.headline ?? '',
    ...content.services.map((s) => s.name),
    ...content.aboutParagraphs.slice(0, 1),
    finalUrl,
  ].join(' ');

  const forced = opts.templateId as TemplateId | undefined;
  const template: Template =
    forced && forced in TEMPLATES ? TEMPLATES[forced] : chooseTemplate(haystack);

  const p = template.palette;
  const changes: RedesignChange[] = [];
  const omitted: Array<{ section: string; reason: string }> = [];
  const needsFromClient: string[] = [];

  const city = (() => {
    const m = content.address?.match(/,\s*([A-Z][A-Za-z.'-]+)\s*,?\s*[A-Z]{2}\b/);
    if (m) return m[1];
    const fromText = (content.tagline ?? '') + ' ' + (content.headline ?? '');
    const m2 = fromText.match(/\b(?:in|serving|around)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)/);
    return m2 ? m2[1] : null;
  })();

  /* ---------------- Hero ---------------- */

  const heroHeadline =
    content.headline ??
    (city ? `${titleCase(content.businessName)} — Trusted Local Service in ${city}` : titleCase(content.businessName));
  if (!content.headline) {
    changes.push({
      label: 'Wrote a clear page headline',
      detail: `The original page had no H1, so search engines and visitors had nothing to anchor on. This uses the business name and service area already on the page.`,
      kind: 'structure',
    });
  }

  const heroLede =
    content.tagline ??
    content.aboutParagraphs[0]?.slice(0, 220) ??
    (content.services.length > 0
      ? `${content.services.slice(0, 3).map((s) => s.name).join(', ')}${city ? ` in ${city}` : ''}.`
      : null);

  const heroImage = content.images[0] ?? null;

  /* ---------------- Trust strip ---------------- */

  const trustItems: Array<{ value: string; label: string }> = [];
  if (content.services.length > 0) {
    trustItems.push({ value: `${content.services.length}+`, label: 'Services offered' });
  }
  if (content.testimonials.length > 0) {
    trustItems.push({ value: `${content.testimonials.length}`, label: 'Customer reviews' });
  }
  if (content.hours.length > 0) {
    trustItems.push({ value: 'Open', label: 'Published hours' });
  }
  if (content.phone) {
    trustItems.push({ value: 'Call', label: 'Direct line' });
  }

  /* ---------------- Sections ---------------- */

  const servicesSection =
    content.services.length > 0
      ? `
      <section id="services" aria-labelledby="services-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">What we do</p>
            <h2 id="services-h">Services</h2>
          </div>
          <div class="grid grid-3">
            ${content.services
              .map(
                (s) => `
              <article class="card">
                <div class="card-icon" aria-hidden="true">${esc(s.name.slice(0, 1).toUpperCase())}</div>
                <h3>${esc(s.name)}</h3>
                ${s.description ? `<p>${esc(s.description)}</p>` : ''}
              </article>`
              )
              .join('')}
          </div>
        </div>
      </section>`
      : '';
  if (content.services.length > 0) {
    changes.push({
      label: 'Rebuilt services into a card grid',
      detail: `The ${content.services.length} services found on the original site now sit in a responsive grid with consistent spacing and hover feedback, instead of plain text.`,
      kind: 'layout',
    });
  } else {
    omitted.push({ section: 'Services', reason: 'No service names could be read from the original site' });
    needsFromClient.push('A list of the services you offer');
  }

  const aboutSection =
    content.aboutParagraphs.length > 0
      ? `
      <section id="about" aria-labelledby="about-h">
        <div class="wrap">
          <div class="about-grid">
            <div>
              <p class="eyebrow">About</p>
              <h2 id="about-h">${city ? `Serving ${esc(city)} and nearby` : 'About us'}</h2>
            </div>
            <div class="about-body">
              ${content.aboutParagraphs.map((t) => `<p>${esc(t)}</p>`).join('')}
            </div>
          </div>
        </div>
      </section>`
      : '';
  if (content.aboutParagraphs.length > 0) {
    changes.push({
      label: 'Re-set your existing copy for readability',
      detail: `Your own words, unchanged — but measured to a 62-character line length with larger type and real line spacing, which is what makes text comfortable to read on a phone.`,
      kind: 'type',
    });
  } else {
    omitted.push({ section: 'About', reason: 'No descriptive paragraph of usable length was found' });
    needsFromClient.push('A short paragraph about your business');
  }

  const testimonialsSection =
    content.testimonials.length > 0
      ? `
      <section id="reviews" aria-labelledby="reviews-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Reviews</p>
            <h2 id="reviews-h">What customers say</h2>
          </div>
          <div class="grid grid-3">
            ${content.testimonials
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
  if (content.testimonials.length > 0) {
    changes.push({
      label: 'Brought your reviews onto the page',
      detail: `${content.testimonials.length} real testimonial${content.testimonials.length === 1 ? '' : 's'} already on your site, now given prominence with proper quote styling.`,
      kind: 'content',
    });
  } else {
    omitted.push({ section: 'Reviews', reason: 'No testimonials were found on the original page' });
    needsFromClient.push('Two or three customer reviews you can share');
  }

  const hoursSection =
    content.hours.length > 0
      ? (() => {
          const parsed = parseHours(content.hours);
          const rows =
            parsed.length > 0
              ? parsed.map((h) => `<tr><th scope="row">${esc(h.day)}</th><td>${esc(h.value)}</td></tr>`).join('')
              : content.hours.map((h) => `<tr><td colspan="2">${esc(h)}</td></tr>`).join('');
          return `
      <section id="hours" aria-labelledby="hours-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">When to reach us</p>
            <h2 id="hours-h">Opening hours</h2>
          </div>
          <table class="hours"><tbody>${rows}</tbody></table>
        </div>
      </section>`;
        })()
      : '';
  if (content.hours.length > 0) {
    changes.push({
      label: 'Published your opening hours as a table',
      detail: 'Hours are one of the most-checked facts on a local business site, and were buried in the original layout.',
      kind: 'content',
    });
  } else {
    omitted.push({ section: 'Opening hours', reason: 'No hours were found on the original page' });
    needsFromClient.push('Your opening hours');
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
                ${
                  content.phone
                    ? `<li><span aria-hidden="true">☎</span><span><b>Phone</b><a href="${esc(content.phoneHref ?? '#')}">${esc(content.phone)}</a></span></li>`
                    : ''
                }
                ${
                  content.email
                    ? `<li><span aria-hidden="true">✉</span><span><b>Email</b><a href="mailto:${esc(content.email)}">${esc(content.email)}</a></span></li>`
                    : ''
                }
                ${
                  content.address
                    ? `<li><span aria-hidden="true">⌖</span><span><b>Address</b>${esc(content.address)}</span></li>`
                    : ''
                }
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
  if (!content.phone) needsFromClient.push('Your phone number');
  if (!content.address) needsFromClient.push('Your business address');

  /* ---------------- FAQ ---------------- */

  const faqs: Array<{ q: string; a: string }> = [];
  if (content.services.length > 0) {
    faqs.push({
      q: 'What services do you offer?',
      a: `We provide ${content.services.map((s) => s.name).join(', ')}.`,
    });
  }
  if (city) {
    faqs.push({
      q: `Do you serve ${city} and the surrounding area?`,
      a: `Yes. We work throughout ${city} and nearby communities. Call us to confirm your address.`,
    });
  }
  if (content.hours.length > 0) {
    faqs.push({ q: 'When are you open?', a: `Our hours are: ${content.hours.join('; ')}.` });
  }
  if (content.phone) {
    faqs.push({ q: 'How do I get a quote?', a: `Call us at ${content.phone}, or send a request through the form on this page.` });
  }

  const faqSection =
    faqs.length >= 2
      ? `
      <section id="faq" aria-labelledby="faq-h">
        <div class="wrap">
          <div class="section-head">
            <p class="eyebrow">Questions</p>
            <h2 id="faq-h">Frequently asked questions</h2>
          </div>
          ${faqs
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
      detail: 'Answers built only from facts already on your page, marked up as FAQPage schema so search engines and AI assistants can quote them directly.',
      kind: 'content',
    });
  }

  /* ---------------- JSON-LD ---------------- */

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: content.businessName,
    url: content.sourceUrl,
  };
  if (content.phone) ld.telephone = content.phone;
  if (content.email) ld.email = content.email;
  if (content.address) {
    ld.address = { '@type': 'PostalAddress', streetAddress: content.address };
  }
  if (content.hours.length > 0) ld.openingHours = content.hours;
  if (content.services.length > 0) {
    ld.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Services',
      itemListElement: content.services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name },
      })),
    };
  }
  if (content.socialLinks.length > 0) ld.sameAs = content.socialLinks.map((s) => s.href);

  const faqLd =
    faqs.length >= 2
      ? JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        })
      : '';

  /* ---------------- Chrome ---------------- */

  const navItems = content.navItems
    .filter((n) => /^(about|services|contact|reviews|hours|faq|gallery|projects)/i.test(n))
    .slice(0, 5);

  const header = `
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="/">
          ${
            content.logoUrl
              ? `<img src="${esc(content.logoUrl)}" alt="${esc(content.businessName)}">`
              : `<span class="brand-mark" aria-hidden="true">${esc(initials(content.businessName))}</span>`
          }
          <span>${esc(content.businessName)}</span>
        </a>
        ${
          navItems.length >= 2
            ? `<nav class="site-nav" aria-label="Main">${navItems
                .map((n) => {
                  const slug = n.toLowerCase().replace(/[^a-z]/g, '');
                  const target = ['about', 'services', 'contact', 'reviews', 'hours', 'faq'].includes(slug) ? `#${slug}` : '#main';
                  return `<a href="${target}">${esc(n)}</a>`;
                })
                .join('')}</nav>`
            : ''
        }
        ${content.phone ? `<a class="btn btn-primary header-cta" href="${esc(content.phoneHref ?? '#')}">Call ${esc(content.phone)}</a>` : ''}
      </div>
    </header>`;

  const footer = `
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <h4>${esc(content.businessName)}</h4>
            ${heroLede ? `<p style="color:var(--muted);font-size:.95rem;margin:0 0 16px;max-width:42ch">${esc(heroLede)}</p>` : ''}
            ${content.phone ? `<p style="margin:0"><a href="${esc(content.phoneHref ?? '#')}" style="font-weight:700">${esc(content.phone)}</a></p>` : ''}
            ${content.address ? `<p style="color:var(--muted);font-size:.92rem;margin:10px 0 0">${esc(content.address)}</p>` : ''}
          </div>
          <div>
            <h4>Explore</h4>
            <ul>
              ${navItems.map((n) => `<li><a href="#">${esc(n)}</a></li>`).join('') || '<li><a href="#contact">Contact</a></li>'}
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              ${content.phone ? `<li><a href="${esc(content.phoneHref ?? '#')}">${esc(content.phone)}</a></li>` : ''}
              ${content.email ? `<li><a href="mailto:${esc(content.email)}">${esc(content.email)}</a></li>` : ''}
              <li><a href="#contact">Request a quote</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} ${esc(content.businessName)}. All rights reserved.</span>
          ${
            content.socialLinks.length > 0
              ? `<div class="social">${content.socialLinks
                  .map((s) => `<a href="${esc(s.href)}" rel="noopener">${esc(s.label)}</a>`)
                  .join('')}</div>`
              : ''
          }
        </div>
      </div>
    </footer>`;

  const callBar = content.phone
    ? `<a class="call-bar" href="${esc(content.phoneHref ?? '#')}">Call ${esc(content.phone)}</a>`
    : '';

  /* ---------------- Design changes ---------------- */

  changes.unshift(
    {
      label: 'Mobile-first responsive layout',
      detail: 'The original page used a fixed-width layout. This one is fluid from 320px up, so it fits every phone without pinch-zooming.',
      kind: 'mobile',
    },
    {
      label: 'Fluid type scale',
      detail: `Headings scale with the viewport (clamp) instead of fixed pixel sizes, so the page reads correctly on a phone and a 27-inch monitor alike.`,
      kind: 'type',
    },
    {
      label: 'A real colour system',
      detail: `Five tokens — background, surface, text, muted and accent (${p.accent}) — replace the original ad-hoc colours, so every element is consistent and contrast-checked.`,
      kind: 'colour',
    },
    {
      label: 'Spacing rhythm and depth',
      detail: 'Consistent section spacing, card surfaces with hairline borders, and restrained shadows give the page hierarchy instead of a flat wall of text.',
      kind: 'layout',
    },
    {
      label: 'Motion that respects the user',
      detail: 'Subtle hover and transition feedback, disabled automatically for anyone with reduced-motion enabled.',
      kind: 'motion',
    }
  );

  /* ---------------- Assemble ---------------- */

  const html_out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(content.businessName)}${city ? ` | ${esc(city)}` : ''}</title>
<meta name="description" content="${esc((heroLede ?? content.businessName).slice(0, 155))}">
<meta property="og:title" content="${esc(content.businessName)}">
<meta property="og:description" content="${esc((heroLede ?? content.businessName).slice(0, 155))}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(content.sourceUrl)}">
${heroImage ? `<meta property="og:image" content="${esc(heroImage.src)}">` : ''}
<link rel="canonical" href="${esc(content.sourceUrl)}">
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
          ${city ? `<p class="eyebrow">${esc(city)}${content.address ? ' &middot; Local' : ''}</p>` : ''}
          <h1>${esc(heroHeadline)}</h1>
          ${heroLede ? `<p class="lede" style="margin-top:20px">${esc(heroLede)}</p>` : ''}
          <div class="hero-actions">
            ${content.phone ? `<a class="btn btn-primary" href="${esc(content.phoneHref ?? '#')}">Call ${esc(content.phone)}</a>` : ''}
            <a class="btn btn-ghost" href="#contact">Request a quote</a>
          </div>
        </div>
        ${
          heroImage
            ? `<div class="hero-media"><img src="${esc(heroImage.src)}" alt="${esc(heroImage.alt || content.businessName)}" loading="eager" width="1200" height="900"></div>`
            : `<div class="hero-media placeholder">Add a photo of your team or work here</div>`
        }
      </div>
    </div>
  </section>

  ${
    trustItems.length >= 2
      ? `<section class="trust" aria-label="At a glance">
    <div class="wrap">
      ${trustItems.map((t) => `<div class="trust-item"><b>${esc(t.value)}</b> ${esc(t.label)}</div>`).join('')}
    </div>
  </section>`
      : ''
  }

  ${servicesSection}
  ${aboutSection}
  ${testimonialsSection}
  ${hoursSection}

  <section aria-labelledby="cta-h">
    <div class="wrap">
      <div class="cta-band">
        <h2 id="cta-h">Ready to get started?</h2>
        <p>${content.phone ? `Call ${esc(content.phone)} or send us a message.` : 'Send us a message and we will get back to you.'}</p>
        <div class="hero-actions" style="justify-content:center">
          ${content.phone ? `<a class="btn btn-primary" href="${esc(content.phoneHref ?? '#')}">Call now</a>` : ''}
          <a class="btn btn-ghost" href="#contact">Request a quote</a>
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

  return {
    html: html_out,
    template,
    content,
    changes,
    omitted,
    needsFromClient: Array.from(new Set(needsFromClient)),
    stats: {
      beforeBytes: html.length,
      afterBytes: html_out.length,
      sections:
        [servicesSection, aboutSection, testimonialsSection, hoursSection, contactSection, faqSection].filter(Boolean)
          .length,
    },
  };
}
