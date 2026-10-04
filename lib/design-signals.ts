import * as cheerio from 'cheerio';

/**
 * Design signal extractor.
 *
 * Pulls visual and structural design signals from HTML so the redesign can
 * match or exceed what the best competitors in a field actually look like.
 *
 * This is not about copying — it's about understanding the visual language
 * of an industry and using it as a baseline.
 */

export interface DesignSignals {
  /* Colors */
  colors: {
    backgrounds: string[];
    surfaces: string[];
    texts: string[];
    accents: string[];
    borders: string[];
  };

  /* Typography */
  typography: {
    fontFamilies: string[];
    fontSizes: number[];
    fontWeights: number[];
    lineHeights: number[];
    letterSpacings: number[];
  };

  /* Layout */
  layout: {
    maxWidth: number | null;
    gridColumns: number[];
    containerPadding: number[];
    sectionPadding: number[];
    cardPadding: number[];
    gaps: number[];
  };

  /* Visual effects */
  effects: {
    gradients: string[];
    shadows: string[];
    transitions: string[];
    animations: string[];
    borderRadius: number[];
    borderStyles: string[];
  };

  /* Components */
  components: {
    hasHero: boolean;
    hasCards: boolean;
    hasTestimonials: boolean;
    hasContactForm: boolean;
    hasNav: boolean;
    hasFooter: boolean;
    hasCTA: boolean;
    hasFAQ: boolean;
    hasTrustBar: boolean;
    hasStats: boolean;
  };

  /* Design tokens */
  tokens: {
    customProperties: Record<string, string>;
    mediaQueries: number[];
  };

  /* Raw counts */
  counts: {
    fontTags: number;
    styleTags: number;
    scriptTags: number;
    images: number;
    buttons: number;
    links: number;
    sections: number;
    divs: number;
  };
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function parseColor(s: string): string | null {
  const c = clean(s).toLowerCase();
  if (!c || c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'unset') return null;
  // Hex
  if (/^#[0-9a-f]{3,8}$/.test(c)) return c;
  // rgb/rgba
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(c)) return c;
  // hsl/hsla
  if (/^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+\s*)?\)$/.test(c)) return c;
  // Named colors (common ones)
  const named: Record<string, string> = {
    white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000',
    blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
    pink: '#ffc0cb', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
    navy: '#000080', teal: '#008080', cyan: '#00ffff', magenta: '#ff00ff',
    lime: '#00ff00', maroon: '#800000', olive: '#808000', aqua: '#00ffff',
  };
  return named[c] ?? null;
}

function parsePx(s: string): number | null {
  const m = clean(s).match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? parseFloat(m[1]) : null;
}

function parseNumber(s: string): number | null {
  const m = clean(s).match(/^(-?\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]) : null;
}

function parseRem(s: string): number | null {
  const m = clean(s).match(/^(-?\d+(?:\.\d+)?)rem$/);
  return m ? parseFloat(m[1]) * 16 : null;
}

function parseSize(s: string): number | null {
  return parsePx(s) ?? parseRem(s) ?? parseNumber(s);
}

function parseFontFamily(s: string): string | null {
  const c = clean(s);
  if (!c || c === 'inherit' || c === 'initial' || c === 'unset') return null;
  // Take first font in stack
  const first = c.split(',')[0].replace(/['"]/g, '').trim();
  return first.length >= 2 ? first : null;
}

function parseFontWeight(s: string): number | null {
  const c = clean(s).toLowerCase();
  const named: Record<string, number> = {
    normal: 400, bold: 700, lighter: 300, bolder: 800,
  };
  if (c in named) return named[c];
  const n = parseInt(c, 10);
  return isNaN(n) ? null : n;
}

function parseLineHeight(s: string): number | null {
  const c = clean(s);
  if (c === 'normal') return 1.5;
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

function parseLetterSpacing(s: string): number | null {
  return parsePx(s) ?? parseNumber(s);
}

function parseBorderRadius(s: string): number | null {
  return parsePx(s) ?? parseRem(s) ?? parseNumber(s);
}

function parseGradient(s: string): string | null {
  const c = clean(s).toLowerCase();
  if (c.includes('gradient') && c.length > 10) return c;
  return null;
}

function parseShadow(s: string): string | null {
  const c = clean(s).toLowerCase();
  if (c === 'none' || c === 'inherit' || c === 'initial' || c === 'unset') return null;
  if (c.includes('px') && c.length > 5) return c;
  return null;
}

function parseTransition(s: string): string | null {
  const c = clean(s).toLowerCase();
  if (c === 'none' || c === 'inherit' || c === 'initial' || c === 'unset') return null;
  if (c.includes('ms') || c.includes('s') || c.includes('ease') || c.includes('linear')) return c;
  return null;
}

function parseAnimation(s: string): string | null {
  const c = clean(s).toLowerCase();
  if (c === 'none' || c === 'inherit' || c === 'initial' || c === 'unset') return null;
  if (c.includes('animation') || c.includes('@keyframes') || c.includes('infinite')) return c;
  return null;
}

function parseBorderStyle(s: string): string | null {
  const c = clean(s).toLowerCase();
  if (c === 'none' || c === 'inherit' || c === 'initial' || c === 'unset') return null;
  if (c.includes('solid') || c.includes('dashed') || c.includes('dotted') || c.includes('double')) return c;
  return null;
}

function parseGridColumns(s: string): number | null {
  const c = clean(s).toLowerCase();
  // "repeat(3, 1fr)" or "1fr 1fr 1fr" or "3"
  const repeat = c.match(/repeat\((\d+)/);
  if (repeat) return parseInt(repeat[1], 10);
  const fr = c.match(/(\d+)\s*fr/);
  if (fr) return parseInt(fr[1], 10);
  const n = parseInt(c, 10);
  return isNaN(n) ? null : n;
}

function parseMaxWidth(s: string): number | null {
  return parsePx(s) ?? parseRem(s);
}

function parsePadding(s: string): number[] {
  const parts = clean(s).split(/\s+/);
  return parts.map(parseSize).filter((n): n is number => n !== null);
}

function parseGap(s: string): number | null {
  return parsePx(s) ?? parseRem(s);
}

export function extractDesignSignals(html: string): DesignSignals {
  const $ = cheerio.load(html);

  const colors = {
    backgrounds: new Set<string>(),
    surfaces: new Set<string>(),
    texts: new Set<string>(),
    accents: new Set<string>(),
    borders: new Set<string>(),
  };

  const typography = {
    fontFamilies: new Set<string>(),
    fontSizes: new Set<number>(),
    fontWeights: new Set<number>(),
    lineHeights: new Set<number>(),
    letterSpacings: new Set<number>(),
  };

  const layout = {
    maxWidth: null as number | null,
    gridColumns: new Set<number>(),
    containerPadding: new Set<number>(),
    sectionPadding: new Set<number>(),
    cardPadding: new Set<number>(),
    gaps: new Set<number>(),
  };

  const effects = {
    gradients: new Set<string>(),
    shadows: new Set<string>(),
    transitions: new Set<string>(),
    animations: new Set<string>(),
    borderRadius: new Set<number>(),
    borderStyles: new Set<string>(),
  };

  const components = {
    hasHero: false,
    hasCards: false,
    hasTestimonials: false,
    hasContactForm: false,
    hasNav: false,
    hasFooter: false,
    hasCTA: false,
    hasFAQ: false,
    hasTrustBar: false,
    hasStats: false,
  };

  const tokens = {
    customProperties: {} as Record<string, string>,
    mediaQueries: new Set<number>(),
  };

  const counts = {
    fontTags: $('font').length,
    styleTags: $('style').length,
    scriptTags: $('script').length,
    images: $('img').length,
    buttons: $('button, .btn, [role="button"]').length,
    links: $('a').length,
    sections: $('section').length,
    divs: $('div').length,
  };

  // Extract from inline styles
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const declarations = style.split(';').map((d) => d.trim()).filter(Boolean);

    for (const decl of declarations) {
      const [prop, ...valParts] = decl.split(':');
      if (!prop || valParts.length === 0) continue;
      const value = valParts.join(':').trim();
      const p = prop.trim().toLowerCase();

      // Colors
      if (p === 'background' || p === 'background-color') {
        const c = parseColor(value);
        if (c) colors.backgrounds.add(c);
      }
      if (p === 'color') {
        const c = parseColor(value);
        if (c) colors.texts.add(c);
      }
      if (p === 'border-color') {
        const c = parseColor(value);
        if (c) colors.borders.add(c);
      }
      if (p === 'background-image' || p === 'background') {
        const g = parseGradient(value);
        if (g) effects.gradients.add(g);
      }

      // Typography
      if (p === 'font-family') {
        const f = parseFontFamily(value);
        if (f) typography.fontFamilies.add(f);
      }
      if (p === 'font-size') {
        const s = parseSize(value);
        if (s) typography.fontSizes.add(s);
      }
      if (p === 'font-weight') {
        const w = parseFontWeight(value);
        if (w) typography.fontWeights.add(w);
      }
      if (p === 'line-height') {
        const l = parseLineHeight(value);
        if (l) typography.lineHeights.add(l);
      }
      if (p === 'letter-spacing') {
        const l = parseLetterSpacing(value);
        if (l) typography.letterSpacings.add(l);
      }

      // Layout
      if (p === 'max-width') {
        const w = parseMaxWidth(value);
        if (w) layout.maxWidth = w;
      }
      if (p === 'grid-template-columns') {
        const c = parseGridColumns(value);
        if (c) layout.gridColumns.add(c);
      }
      if (p === 'padding') {
        for (const n of parsePadding(value)) {
          layout.containerPadding.add(n);
          layout.sectionPadding.add(n);
          layout.cardPadding.add(n);
        }
      }
      if (p === 'gap' || p === 'grid-gap') {
        const g = parseGap(value);
        if (g) layout.gaps.add(g);
      }

      // Effects
      if (p === 'box-shadow') {
        const s = parseShadow(value);
        if (s) effects.shadows.add(s);
      }
      if (p === 'transition') {
        const t = parseTransition(value);
        if (t) effects.transitions.add(t);
      }
      if (p === 'animation') {
        const a = parseAnimation(value);
        if (a) effects.animations.add(a);
      }
      if (p === 'border-radius') {
        const r = parseBorderRadius(value);
        if (r) effects.borderRadius.add(r);
      }
      if (p === 'border-style') {
        const b = parseBorderStyle(value);
        if (b) effects.borderStyles.add(b);
      }
    }
  });

  // Extract from <style> tags
  $('style').each((_, el) => {
    const css = $(el).contents().text();

    // Colors
    for (const m of css.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi)) {
      const c = parseColor(m[1]);
      if (c) colors.backgrounds.add(c);
    }
    for (const m of css.matchAll(/(?:^|[\s;])color\s*:\s*([^;]+)/gi)) {
      const c = parseColor(m[1]);
      if (c) colors.texts.add(c);
    }
    for (const m of css.matchAll(/border-color\s*:\s*([^;]+)/gi)) {
      const c = parseColor(m[1]);
      if (c) colors.borders.add(c);
    }

    // Typography
    for (const m of css.matchAll(/font-family\s*:\s*([^;]+)/gi)) {
      const f = parseFontFamily(m[1]);
      if (f) typography.fontFamilies.add(f);
    }
    for (const m of css.matchAll(/font-size\s*:\s*([^;]+)/gi)) {
      const s = parseSize(m[1]);
      if (s) typography.fontSizes.add(s);
    }
    for (const m of css.matchAll(/font-weight\s*:\s*([^;]+)/gi)) {
      const w = parseFontWeight(m[1]);
      if (w) typography.fontWeights.add(w);
    }

    // Effects
    for (const m of css.matchAll(/background(?:-image)?\s*:\s*([^;]+)/gi)) {
      const g = parseGradient(m[1]);
      if (g) effects.gradients.add(g);
    }
    for (const m of css.matchAll(/box-shadow\s*:\s*([^;]+)/gi)) {
      const s = parseShadow(m[1]);
      if (s) effects.shadows.add(s);
    }
    for (const m of css.matchAll(/transition\s*:\s*([^;]+)/gi)) {
      const t = parseTransition(m[1]);
      if (t) effects.transitions.add(t);
    }
    for (const m of css.matchAll(/animation\s*:\s*([^;]+)/gi)) {
      const a = parseAnimation(m[1]);
      if (a) effects.animations.add(a);
    }
    for (const m of css.matchAll(/border-radius\s*:\s*([^;]+)/gi)) {
      const r = parseBorderRadius(m[1]);
      if (r) effects.borderRadius.add(r);
    }

    // Media queries
    for (const m of css.matchAll(/@media[^{]*max-width\s*:\s*(\d+)px/gi)) {
      tokens.mediaQueries.add(parseInt(m[1], 10));
    }

    // Custom properties
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      tokens.customProperties[m[1]] = clean(m[2]);
    }
  });

  // Component detection
  components.hasHero = $('section:first, .hero, [class*="hero"], [id*="hero"]').length > 0;
  components.hasCards = $('[class*="card"], [class*="service"], [class*="feature"]').length >= 3;
  components.hasTestimonials = $('[class*="testimonial"], [class*="review"], [class*="quote"]').length > 0;
  components.hasContactForm = $('form').length > 0;
  components.hasNav = $('nav, header nav, [class*="nav"]').length > 0;
  components.hasFooter = $('footer, [class*="footer"]').length > 0;
  components.hasCTA = $('[class*="cta"], [class*="call-to-action"], [class*="btn-primary"]').length > 0;
  components.hasFAQ = $('[class*="faq"], details, [class*="accordion"]').length > 0;
  components.hasTrustBar = $('[class*="trust"], [class*="stats"], [class*="metric"]').length > 0;
  components.hasStats = $('[class*="stat"], [class*="number"], [class*="count"]').length > 0;

  // Accent colors: look for buttons, links, highlights
  $('a, button, [role="button"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const bgMatch = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bgMatch) {
      const c = parseColor(bgMatch[1]);
      if (c) colors.accents.add(c);
    }
    const colorMatch = style.match(/(?:^|[\s;])color\s*:\s*([^;]+)/i);
    if (colorMatch) {
      const c = parseColor(colorMatch[1]);
      if (c) colors.accents.add(c);
    }
  });

  // Surfaces: look for cards, sections with different bg
  $('[class*="card"], [class*="section"], [class*="box"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const bgMatch = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bgMatch) {
      const c = parseColor(bgMatch[1]);
      if (c) colors.surfaces.add(c);
    }
  });

  return {
    colors: {
      backgrounds: Array.from(colors.backgrounds),
      surfaces: Array.from(colors.surfaces),
      texts: Array.from(colors.texts),
      accents: Array.from(colors.accents),
      borders: Array.from(colors.borders),
    },
    typography: {
      fontFamilies: Array.from(typography.fontFamilies),
      fontSizes: Array.from(typography.fontSizes).sort((a, b) => a - b),
      fontWeights: Array.from(typography.fontWeights).sort((a, b) => a - b),
      lineHeights: Array.from(typography.lineHeights).sort((a, b) => a - b),
      letterSpacings: Array.from(typography.letterSpacings).sort((a, b) => a - b),
    },
    layout: {
      maxWidth: layout.maxWidth,
      gridColumns: Array.from(layout.gridColumns).sort((a, b) => a - b),
      containerPadding: Array.from(layout.containerPadding).sort((a, b) => a - b),
      sectionPadding: Array.from(layout.sectionPadding).sort((a, b) => a - b),
      cardPadding: Array.from(layout.cardPadding).sort((a, b) => a - b),
      gaps: Array.from(layout.gaps).sort((a, b) => a - b),
    },
    effects: {
      gradients: Array.from(effects.gradients),
      shadows: Array.from(effects.shadows),
      transitions: Array.from(effects.transitions),
      animations: Array.from(effects.animations),
      borderRadius: Array.from(effects.borderRadius).sort((a, b) => a - b),
      borderStyles: Array.from(effects.borderStyles),
    },
    components,
    tokens: {
      customProperties: tokens.customProperties,
      mediaQueries: Array.from(tokens.mediaQueries).sort((a, b) => a - b),
    },
    counts,
  };
}
