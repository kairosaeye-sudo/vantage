import * as cheerio from 'cheerio';

/**
 * Free previews show the outcome, never the means.
 *
 * The free glow-up has to sell: the owner sees their own site rebuilt, scored and
 * ranked against their field. What it must not do is hand over the work — the
 * markup, the copy Vantage AI wrote, the structured data, the exact fixes — so
 * that a nephew with a text editor can paste it in and skip the Glow Up.
 *
 * Everything here is applied server-side, at serve time. Redacted copy is not
 * hidden with CSS, it is not in the document at all, so "view source" and "save
 * page as" get the same skeleton the eye does. The stored originals are
 * untouched: scoring, the paid deliverable and internal review all use them.
 *
 * What stays real, because it is what makes the preview worth looking at and
 * none of it is ours to withhold: the layout and look, the hero, their own
 * reviews, photos, services, hours and credentials.
 */

/** Watermark, ribbon and anti-copy CSS shared by every protected view. */
function shield(label: string): { style: string; ribbon: string } {
  const mark = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' transform='rotate(-24 210 130)' font-family='Arial, sans-serif' font-size='22' font-weight='700' fill='rgba(124,92,255,0.16)' letter-spacing='4'>VANTAGE PREVIEW</text></svg>`
  );
  const style = `<style id="vx-shield">
    html,body{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
    img{-webkit-user-drag:none!important;user-drag:none!important}
    body::after{content:"";position:fixed;inset:0;z-index:2147483600;pointer-events:none;background-image:url("data:image/svg+xml,${mark}");background-repeat:repeat}
    .vx-ribbon{position:fixed;left:0;right:0;top:0;z-index:2147483601;display:flex;justify-content:center;gap:8px;align-items:center;padding:7px 12px;background:#7c5cff;color:#fff;font:600 12px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:.2px;pointer-events:none;text-align:center}
    body{margin-top:30px!important}
    .vx-redact{display:block;height:.72em;margin:.55em 0;border-radius:6px;background:linear-gradient(90deg,rgba(127,127,140,.22),rgba(127,127,140,.12));width:var(--w,100%)}
    .vx-lock{display:inline-flex;align-items:center;gap:8px;margin:14px 0 0;padding:8px 13px;border-radius:999px;font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#5b3fe0;background:rgba(124,92,255,.1);border:1px solid rgba(124,92,255,.28)}
    details.faq[open] p{display:block}
  </style>`;
  const ribbon = `<div class="vx-ribbon" aria-hidden="true">${label}</div>`;
  return { style, ribbon };
}

/** Skeleton lines roughly the length of the text they replace. */
function skeleton(text: string): string {
  const lines = Math.max(1, Math.min(6, Math.ceil(text.trim().length / 70)));
  let out = '';
  for (let i = 0; i < lines; i++) {
    const w = i === lines - 1 && lines > 1 ? 45 + ((text.length * 7 + i * 13) % 35) : 92 + ((i * 17) % 8);
    out += `<span class="vx-redact" style="--w:${w}%"></span>`;
  }
  return out;
}

const LOCK = (what: string) => `<p class="vx-lock">🔒 ${what} — unlocks with your Glow Up</p>`;

/** Remove what search engines and AI assistants read: it is the fix, not the look. */
function stripHead($: cheerio.CheerioAPI, title: string): void {
  $('script').remove(); // JSON-LD included: schema is part of what is paid for
  $('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]').remove();
  $('title').remove();
  $('head').append(`<title>${title}</title><meta name="robots" content="noindex, nofollow, noarchive">`);
}

/** Links do nothing in a preview: it is a picture of a site, not a site. */
function deadLinks($: cheerio.CheerioAPI): void {
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href.startsWith('#')) $(el).attr('href', '#');
  });
  $('form').removeAttr('action').removeAttr('method');
}

function inject($: cheerio.CheerioAPI, label: string): void {
  const { style, ribbon } = shield(label);
  $('head').append(style);
  $('body').prepend(ribbon);
}

/**
 * The redesign, as a free preview: the full look, the hero, their own content —
 * with the copy we wrote and the code that ranks replaced by skeletons and locks.
 */
export function protectRedesign(html: string, businessName: string): string {
  const $ = cheerio.load(html);
  stripHead($, `${businessName} — preview by Vantage`);

  // Service descriptions are ours; the service names are theirs.
  let servicesRedacted = false;
  $('.service p').each((_, el) => {
    $(el).html(skeleton($(el).text()));
    servicesRedacted = true;
  });
  $('.service .more').remove();
  if (servicesRedacted) $('#services .section-head').append(LOCK('Service descriptions written by Vantage AI'));

  // About and extra sections: paragraphs are drafted copy.
  $('.about-body').each((_, body) => {
    $(body)
      .find('p')
      .each((__, p) => {
        $(p).html(skeleton($(p).text()));
      });
    $(body).after(LOCK('Your full About copy'));
  });

  // FAQ: the questions sell the idea, the answers are the AI-visibility content.
  let faqRedacted = false;
  $('details.faq').each((_, d) => {
    $(d).attr('open', '');
    $(d)
      .find('p')
      .each((__, p) => {
        $(p).html(skeleton($(p).text()));
        faqRedacted = true;
      });
  });
  if (faqRedacted) $('#faq .section-head').append(LOCK('FAQ answers and FAQ schema'));

  deadLinks($);
  inject($, 'Free preview by Vantage · copy, code and schema are delivered with your Glow Up');
  return $.html();
}

/**
 * The fixes-only view, as a free preview: their own page with the changes
 * outlined where they land — but not the changes themselves. The head goes back
 * to the original (title, description, schema, viewport were all fixes), and
 * copy we injected into the body is replaced with skeletons.
 */
export function protectFixed(afterHtml: string, beforeHtml: string, businessName: string): string {
  const $ = cheerio.load(afterHtml);
  const $before = cheerio.load(beforeHtml);

  // Head: the original's, minus scripts. Every head-level fix disappears.
  $('head').html($before('head').html() ?? '');
  $('head script').remove();
  $('head title').remove();
  $('head').append(`<title>${businessName} — preview by Vantage</title><meta name="robots" content="noindex, nofollow, noarchive">`);
  $('body script').remove();

  // Each fix stays visible as an outline, labelled generically: the label used
  // to say exactly what to do ("Click-to-call added").
  $('[data-vantage-fix]').each((_, el) => {
    $(el).attr('data-vantage-fix-label', 'Fixed by Vantage');
    const text = $(el).text().trim();
    if (text.length > 60) {
      $(el)
        .find('p, dd, li, summary')
        .each((__, p) => {
          $(p).html(skeleton($(p).text()));
        });
    }
  });

  deadLinks($);
  inject($, 'Free preview by Vantage · the fixes themselves are delivered with your Glow Up');
  return $.html();
}
