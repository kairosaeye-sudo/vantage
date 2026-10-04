/**
 * Design system for redesigned sites.
 *
 * Three templates, each a complete modern stylesheet + page shell. The point is
 * that a 2010-era site and a modern one differ in ways that are describable:
 * type scale, spacing rhythm, colour tokens, responsive grid, motion, depth.
 *
 * Every template is:
 *   - mobile-first, fluid from 320px up
 *   - token-driven (CSS custom properties) so a palette swap is one edit
 *   - self-contained (no external CSS, no JS, no webfont request required)
 *   - accessible (focus rings, reduced-motion, semantic landmarks, contrast)
 *
 * Fonts are system stacks by default. A redesign must not depend on a network
 * request to look right, and a font swap is a visual decision the client should
 * make, not something imposed silently.
 */

export type TemplateId = 'trades' | 'professional' | 'hospitality';

export interface Palette {
  /** Page background. */
  bg: string;
  /** Card / raised surface. */
  surface: string;
  /** Body text. */
  text: string;
  /** Secondary text. */
  muted: string;
  /** Brand accent. */
  accent: string;
  /** Accent for text on the accent colour. */
  onAccent: string;
  /** Hairline borders. */
  line: string;
}

export interface Template {
  id: TemplateId;
  label: string;
  /** When this template suits a business. */
  suitedTo: string;
  palette: Palette;
  /** Google Fonts family name, if the client wants it later. */
  suggestedFont: string;
  radius: string;
  /** Headline weight — trades want heavy, hospitality wants lighter. */
  headingWeight: number;
  letterSpacing: string;
}

export const TEMPLATES: Record<TemplateId, Template> = {
  trades: {
    id: 'trades',
    label: 'Trades & Field Services',
    suitedTo: 'Electricians, plumbers, HVAC, contractors, landscaping, roofing',
    palette: {
      bg: '#ffffff',
      surface: '#f7f8fa',
      text: '#111827',
      muted: '#5b6472',
      accent: '#0f5ea8',
      onAccent: '#ffffff',
      line: '#e3e7ed',
    },
    suggestedFont: 'Inter',
    radius: '10px',
    headingWeight: 800,
    letterSpacing: '-0.022em',
  },
  professional: {
    id: 'professional',
    label: 'Professional Services',
    suitedTo: 'Accountants, lawyers, consultants, agencies, clinics',
    palette: {
      bg: '#ffffff',
      surface: '#f8f9fb',
      text: '#141821',
      muted: '#5f6675',
      accent: '#1f4d3d',
      onAccent: '#ffffff',
      line: '#e5e8ee',
    },
    suggestedFont: 'Source Sans 3',
    radius: '6px',
    headingWeight: 700,
    letterSpacing: '-0.015em',
  },
  hospitality: {
    id: 'hospitality',
    label: 'Hospitality & Retail',
    suitedTo: 'Restaurants, cafés, salons, boutiques, studios',
    palette: {
      bg: '#fffdfa',
      surface: '#f8f2ea',
      text: '#221c17',
      muted: '#6d6259',
      accent: '#9c3d2e',
      onAccent: '#ffffff',
      line: '#ece2d7',
    },
    suggestedFont: 'Fraunces',
    radius: '14px',
    headingWeight: 600,
    letterSpacing: '-0.01em',
  },
};

/**
 * Pick a template from what the business actually is.
 *
 * Reads the extracted content only — never guesses beyond the evidence. Falls
 * back to `trades` because that is where the small-business long tail sits.
 */
export function chooseTemplate(haystack: string): Template {
  const s = haystack.toLowerCase();

  const hospitality = /\b(restaurant|cafe|café|coffee|bakery|bistro|bar|grill|kitchen|pizz|taco|salon|spa|barber|boutique|shop|store|florist|catering|deli|diner|brewery|winery|juice|smoothie)\b/;
  const professional = /\b(account|bookkeep|law|legal|attorney|lawyer|consult|advis|clinic|dental|dentist|therap|medical|insurance|finance|financial|tax|realty|real estate|architect|design studio|agency|marketing)\b/;
  const trades = /\b(electric|plumb|hvac|heating|cooling|air condition|roof|contractor|construction|landscap|lawn|paint|handyman|flooring|remodel|concrete|fenc|pest|clean|garage|window|solar|masonry|excavat|welding|mechanic|auto|tow)\b/;

  if (hospitality.test(s)) return TEMPLATES.hospitality;
  if (professional.test(s)) return TEMPLATES.professional;
  if (trades.test(s)) return TEMPLATES.trades;

  return TEMPLATES.trades;
}

/** Escape text destined for HTML. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The stylesheet every template shares.
 *
 * This is the actual "modern" part — the things a dated site is missing:
 * a type scale with fluid sizing, generous whitespace, a real grid, restrained
 * depth, motion that respects user preference, and mobile-first breakpoints.
 */
export function baseStyles(t: Template): string {
  const p = t.palette;
  return `
    *,*::before,*::after{box-sizing:border-box}
    :root{
      --bg:${p.bg};
      --surface:${p.surface};
      --text:${p.text};
      --muted:${p.muted};
      --accent:${p.accent};
      --on-accent:${p.onAccent};
      --line:${p.line};
      --radius:${t.radius};
      --shadow-sm:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);
      --shadow-md:0 4px 12px rgba(16,24,40,.07),0 2px 4px rgba(16,24,40,.05);
      --shadow-lg:0 16px 40px rgba(16,24,40,.10);
      --maxw:1140px;
      --gutter:clamp(18px,4vw,32px);
    }
    html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
    @media (prefers-reduced-motion:reduce){
      html{scroll-behavior:auto}
      *,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}
    }
    body{
      margin:0;
      background:var(--bg);
      color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
      font-size:clamp(16px,1.05vw,17px);
      line-height:1.65;
      -webkit-font-smoothing:antialiased;
      text-rendering:optimizeLegibility;
    }
    img{max-width:100%;height:auto;display:block}
    a{color:var(--accent);text-underline-offset:3px}
    :focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}

    .wrap{max-width:var(--maxw);margin:0 auto;padding:0 var(--gutter)}
    .skip{position:absolute;left:-9999px}
    .skip:focus{left:var(--gutter);top:8px;z-index:100;background:var(--accent);color:var(--on-accent);padding:10px 16px;border-radius:var(--radius);text-decoration:none}

    /* ---- Type scale: fluid, not fixed ---- */
    h1,h2,h3{font-weight:${t.headingWeight};letter-spacing:${t.letterSpacing};line-height:1.12;margin:0}
    h1{font-size:clamp(2.1rem,6vw,3.9rem)}
    h2{font-size:clamp(1.6rem,3.6vw,2.5rem)}
    h3{font-size:clamp(1.1rem,1.6vw,1.3rem);letter-spacing:-.01em;line-height:1.3}
    .lede{font-size:clamp(1.05rem,1.7vw,1.3rem);color:var(--muted);line-height:1.6;max-width:62ch}
    .eyebrow{font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}

    section{padding:clamp(52px,8vw,104px) 0}
    .section-head{max-width:64ch;margin-bottom:clamp(30px,4vw,54px)}

    /* ---- Header ---- */
    .site-header{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
    .site-header .wrap{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:70px}
    .brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:-.02em;font-size:1.06rem;color:var(--text);text-decoration:none}
    .brand img{height:38px;width:auto}
    .brand-mark{width:38px;height:38px;border-radius:9px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:800;font-size:1.1rem}
    .site-nav{display:none;gap:26px;align-items:center}
    .site-nav a{color:var(--muted);text-decoration:none;font-size:.94rem;font-weight:500}
    .site-nav a:hover{color:var(--text)}
    @media(min-width:860px){.site-nav{display:flex}}
    .header-cta{display:none}
    @media(min-width:600px){.header-cta{display:inline-flex}}

    /* ---- Buttons ---- */
    .btn{
      display:inline-flex;align-items:center;justify-content:center;gap:9px;
      padding:14px 26px;border-radius:var(--radius);
      font-weight:700;font-size:.97rem;text-decoration:none;
      border:1px solid transparent;cursor:pointer;
      transition:transform .16s ease,box-shadow .16s ease,background-color .16s ease;
      min-height:48px;
    }
    .btn-primary{background:var(--accent);color:var(--on-accent);box-shadow:var(--shadow-sm)}
    .btn-primary:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
    .btn-ghost{background:transparent;color:var(--text);border-color:var(--line)}
    .btn-ghost:hover{background:var(--surface)}

    /* ---- Hero ---- */
    .hero{padding:clamp(58px,9vw,116px) 0 clamp(44px,6vw,80px)}
    .hero-grid{display:grid;gap:clamp(30px,5vw,60px);align-items:center}
    @media(min-width:920px){.hero-grid{grid-template-columns:1.08fr .92fr}}
    .hero-actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:32px}
    .hero-media{border-radius:calc(var(--radius) * 1.6);overflow:hidden;box-shadow:var(--shadow-lg);aspect-ratio:4/3;background:var(--surface)}
    .hero-media img{width:100%;height:100%;object-fit:cover}
    .hero-media.placeholder{display:grid;place-items:center;color:var(--muted);font-size:.85rem;text-align:center;padding:24px}

    /* ---- Trust strip ---- */
    .trust{border-block:1px solid var(--line);background:var(--surface)}
    .trust .wrap{display:flex;flex-wrap:wrap;gap:clamp(20px,4vw,52px);padding-block:26px;justify-content:center}
    .trust-item{display:flex;align-items:center;gap:10px;font-size:.92rem;font-weight:600;color:var(--muted)}
    .trust-item b{color:var(--text);font-weight:800;font-size:1.15rem}

    /* ---- Cards ---- */
    .grid{display:grid;gap:clamp(16px,2.4vw,26px)}
    .grid-2{grid-template-columns:1fr}
    .grid-3{grid-template-columns:1fr}
    @media(min-width:640px){.grid-2{grid-template-columns:repeat(2,1fr)}}
    @media(min-width:840px){.grid-3{grid-template-columns:repeat(3,1fr)}}
    .card{
      background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);
      padding:clamp(22px,2.6vw,30px);box-shadow:var(--shadow-sm);
      transition:transform .18s ease,box-shadow .18s ease;
    }
    .card:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)}
    .card h3{margin-bottom:9px}
    .card p{margin:0;color:var(--muted);font-size:.96rem}
    .card-icon{width:44px;height:44px;border-radius:10px;background:var(--surface);color:var(--accent);display:grid;place-items:center;margin-bottom:18px;font-weight:800}

    /* ---- About ---- */
    .about-grid{display:grid;gap:clamp(28px,4vw,56px)}
    @media(min-width:880px){.about-grid{grid-template-columns:1fr 1fr;align-items:start}}
    .about-body p{color:var(--muted);margin:0 0 18px;font-size:1.02rem}
    .about-body p:last-child{margin-bottom:0}

    /* ---- Testimonials ---- */
    .quote{
      background:var(--surface);border-radius:var(--radius);padding:clamp(24px,3vw,34px);
      border:1px solid var(--line);margin:0;display:flex;flex-direction:column;gap:16px;height:100%;
    }
    .quote blockquote{margin:0;font-size:1.02rem;line-height:1.6;color:var(--text)}
    .quote figcaption{font-size:.9rem;font-weight:700;color:var(--muted);margin-top:auto}

    /* ---- CTA band ---- */
    .cta-band{background:var(--accent);color:var(--on-accent);border-radius:calc(var(--radius) * 1.4);padding:clamp(34px,5vw,62px);text-align:center}
    .cta-band h2{color:var(--on-accent);margin-bottom:14px}
    .cta-band p{color:color-mix(in srgb,var(--on-accent) 82%,transparent);max-width:56ch;margin:0 auto 28px;font-size:1.05rem}
    .cta-band .btn-primary{background:var(--on-accent);color:var(--accent)}
    .cta-band .btn-ghost{color:var(--on-accent);border-color:color-mix(in srgb,var(--on-accent) 45%,transparent)}
    .cta-band .btn-ghost:hover{background:color-mix(in srgb,var(--on-accent) 12%,transparent)}

    /* ---- Contact form ---- */
    .form-grid{display:grid;gap:16px}
    @media(min-width:640px){.form-grid{grid-template-columns:1fr 1fr}.form-grid .full{grid-column:1/-1}}
    .field{display:flex;flex-direction:column;gap:7px}
    .field label{font-size:.88rem;font-weight:600}
    .field input,.field textarea,.field select{
      font:inherit;font-size:16px;padding:13px 15px;border-radius:var(--radius);
      border:1px solid var(--line);background:var(--bg);color:var(--text);width:100%;
    }
    .field textarea{min-height:120px;resize:vertical}
    .field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}

    /* ---- Info list ---- */
    .info-list{list-style:none;padding:0;margin:0;display:grid;gap:14px}
    .info-list li{display:flex;gap:13px;align-items:flex-start;font-size:.97rem}
    .info-list b{display:block;font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:2px}

    /* ---- Hours table ---- */
    .hours{width:100%;border-collapse:collapse;font-size:.95rem}
    .hours th,.hours td{text-align:left;padding:11px 0;border-bottom:1px solid var(--line)}
    .hours th{font-weight:600;color:var(--text);width:45%}
    .hours td{color:var(--muted)}
    .hours tr:last-child th,.hours tr:last-child td{border-bottom:0}

    /* ---- FAQ ---- */
    details.faq{border-bottom:1px solid var(--line);padding:20px 0}
    details.faq summary{font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:18px;align-items:center;font-size:1.02rem}
    details.faq summary::-webkit-details-marker{display:none}
    details.faq summary::after{content:"+";font-size:1.5rem;color:var(--accent);line-height:1;flex-shrink:0}
    details.faq[open] summary::after{content:"–"}
    details.faq p{color:var(--muted);margin:12px 0 0;max-width:70ch}

    /* ---- Footer ---- */
    .site-footer{background:var(--surface);border-top:1px solid var(--line);padding:clamp(40px,5vw,64px) 0 30px;margin-top:0}
    .footer-grid{display:grid;gap:32px;margin-bottom:36px}
    @media(min-width:760px){.footer-grid{grid-template-columns:1.6fr 1fr 1fr}}
    .site-footer h4{font-size:.82rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 14px}
    .site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}
    .site-footer a{color:var(--muted);text-decoration:none;font-size:.94rem}
    .site-footer a:hover{color:var(--accent)}
    .footer-bottom{border-top:1px solid var(--line);padding-top:22px;display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;font-size:.86rem;color:var(--muted)}
    .social{display:flex;gap:14px;flex-wrap:wrap}

    /* ---- Sticky mobile call bar ---- */
    .call-bar{
      position:fixed;left:0;right:0;bottom:0;z-index:60;
      background:var(--accent);color:var(--on-accent);
      padding:12px 16px calc(12px + env(safe-area-inset-bottom));
      display:flex;gap:12px;justify-content:center;align-items:center;
      font-weight:700;text-decoration:none;font-size:1rem;
      box-shadow:0 -4px 20px rgba(16,24,40,.14);
    }
    .call-bar:hover{color:var(--on-accent)}
    @media(min-width:860px){.call-bar{display:none}}
    body{padding-bottom:64px}
    @media(min-width:860px){body{padding-bottom:0}}
  `;
}
