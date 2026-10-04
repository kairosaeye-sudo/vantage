import type { DesignSignals } from './design-signals';

/**
 * Field design aggregator.
 *
 * Takes design signals from every site in a field and computes what "elite"
 * looks like for that industry. The redesign uses this as a baseline — not to
 * copy, but to ensure the glow-up result is at least as modern as the best
 * competitor.
 */

export interface FieldDesignBrief {
  /* What the top performers share */
  elite: {
    colors: {
      backgrounds: string[];
      surfaces: string[];
      texts: string[];
      accents: string[];
    };
    typography: {
      fontFamilies: string[];
      fontSizes: { min: number; max: number; median: number };
      fontWeights: number[];
      lineHeights: { min: number; max: number; median: number };
    };
    layout: {
      maxWidth: number | null;
      gridColumns: number[];
      sectionPadding: { min: number; max: number; median: number };
      cardPadding: { min: number; max: number; median: number };
      gaps: { min: number; max: number; median: number };
    };
    effects: {
      gradients: boolean;
      shadows: boolean;
      transitions: boolean;
      animations: boolean;
      borderRadius: { min: number; max: number; median: number };
    };
    components: {
      hero: number;
      cards: number;
      testimonials: number;
      contactForm: number;
      nav: number;
      footer: number;
      cta: number;
      faq: number;
      trustBar: number;
      stats: number;
    };
  };

  /* What the bottom performers lack */
  laggard: {
    missingComponents: string[];
    missingEffects: string[];
    outdatedPatterns: string[];
  };

  /* Field-wide stats */
  stats: {
    totalSites: number;
    eliteCount: number;
    laggardCount: number;
    avgScore: number;
    eliteAvgScore: number;
    laggardAvgScore: number;
  };

  /* Design tokens for the redesign */
  tokens: {
    colorScheme: 'light' | 'dark' | 'mixed';
    dominantBackground: string | null;
    dominantAccent: string | null;
    borderRadiusScale: 'sharp' | 'medium' | 'rounded';
    spacingScale: 'compact' | 'comfortable' | 'spacious';
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function min(arr: number[]): number {
  return arr.length ? Math.min(...arr) : 0;
}

function max(arr: number[]): number {
  return arr.length ? Math.max(...arr) : 0;
}

function mode<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function topN<T>(arr: T[], n: number): T[] {
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

function isDarkColor(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

export interface FieldSite {
  url: string;
  score: number;
  signals: DesignSignals;
}

export function buildFieldDesignBrief(sites: FieldSite[]): FieldDesignBrief {
  if (sites.length === 0) {
    return {
      elite: {
        colors: { backgrounds: [], surfaces: [], texts: [], accents: [] },
        typography: {
          fontFamilies: [],
          fontSizes: { min: 0, max: 0, median: 0 },
          fontWeights: [],
          lineHeights: { min: 0, max: 0, median: 0 },
        },
        layout: {
          maxWidth: null,
          gridColumns: [],
          sectionPadding: { min: 0, max: 0, median: 0 },
          cardPadding: { min: 0, max: 0, median: 0 },
          gaps: { min: 0, max: 0, median: 0 },
        },
        effects: {
          gradients: false,
          shadows: false,
          transitions: false,
          animations: false,
          borderRadius: { min: 0, max: 0, median: 0 },
        },
        components: {
          hero: 0, cards: 0, testimonials: 0, contactForm: 0,
          nav: 0, footer: 0, cta: 0, faq: 0, trustBar: 0, stats: 0,
        },
      },
      laggard: { missingComponents: [], missingEffects: [], outdatedPatterns: [] },
      stats: { totalSites: 0, eliteCount: 0, laggardCount: 0, avgScore: 0, eliteAvgScore: 0, laggardAvgScore: 0 },
      tokens: { colorScheme: 'light', dominantBackground: null, dominantAccent: null, borderRadiusScale: 'medium', spacingScale: 'comfortable' },
    };
  }

  // Split into elite (top 25%) and laggard (bottom 25%)
  const sorted = [...sites].sort((a, b) => b.score - a.score);
  const eliteCount = Math.max(1, Math.ceil(sorted.length * 0.25));
  const laggardCount = Math.max(1, Math.ceil(sorted.length * 0.25));
  const elite = sorted.slice(0, eliteCount);
  const laggards = sorted.slice(-laggardCount);

  // Aggregate elite signals
  const eliteBg = elite.flatMap((s) => s.signals.colors.backgrounds);
  const eliteSurface = elite.flatMap((s) => s.signals.colors.surfaces);
  const eliteText = elite.flatMap((s) => s.signals.colors.texts);
  const eliteAccent = elite.flatMap((s) => s.signals.colors.accents);

  const eliteFonts = elite.flatMap((s) => s.signals.typography.fontFamilies);
  const eliteFontSizes = elite.flatMap((s) => s.signals.typography.fontSizes);
  const eliteFontWeights = elite.flatMap((s) => s.signals.typography.fontWeights);
  const eliteLineHeights = elite.flatMap((s) => s.signals.typography.lineHeights);

  const eliteMaxWidths = elite.map((s) => s.signals.layout.maxWidth).filter((n): n is number => n !== null);
  const eliteGridCols = elite.flatMap((s) => s.signals.layout.gridColumns);
  const eliteSectionPad = elite.flatMap((s) => s.signals.layout.sectionPadding);
  const eliteCardPad = elite.flatMap((s) => s.signals.layout.cardPadding);
  const eliteGaps = elite.flatMap((s) => s.signals.layout.gaps);

  const eliteGradients = elite.filter((s) => s.signals.effects.gradients.length > 0).length;
  const eliteShadows = elite.filter((s) => s.signals.effects.shadows.length > 0).length;
  const eliteTransitions = elite.filter((s) => s.signals.effects.transitions.length > 0).length;
  const eliteAnimations = elite.filter((s) => s.signals.effects.animations.length > 0).length;
  const eliteRadius = elite.flatMap((s) => s.signals.effects.borderRadius);

  // Component adoption rates among elite
  const eliteComponents = {
    hero: elite.filter((s) => s.signals.components.hasHero).length / elite.length,
    cards: elite.filter((s) => s.signals.components.hasCards).length / elite.length,
    testimonials: elite.filter((s) => s.signals.components.hasTestimonials).length / elite.length,
    contactForm: elite.filter((s) => s.signals.components.hasContactForm).length / elite.length,
    nav: elite.filter((s) => s.signals.components.hasNav).length / elite.length,
    footer: elite.filter((s) => s.signals.components.hasFooter).length / elite.length,
    cta: elite.filter((s) => s.signals.components.hasCTA).length / elite.length,
    faq: elite.filter((s) => s.signals.components.hasFAQ).length / elite.length,
    trustBar: elite.filter((s) => s.signals.components.hasTrustBar).length / elite.length,
    stats: elite.filter((s) => s.signals.components.hasStats).length / elite.length,
  };

  // What laggards lack
  const laggardMissing: string[] = [];
  const laggardEffects: string[] = [];
  const laggardOutdated: string[] = [];

  if (laggards.filter((s) => !s.signals.components.hasCards).length > laggards.length * 0.5) {
    laggardMissing.push('card-based layouts');
  }
  if (laggards.filter((s) => !s.signals.components.hasTestimonials).length > laggards.length * 0.5) {
    laggardMissing.push('testimonials');
  }
  if (laggards.filter((s) => !s.signals.components.hasContactForm).length > laggards.length * 0.5) {
    laggardMissing.push('contact forms');
  }
  if (laggards.filter((s) => !s.signals.components.hasFAQ).length > laggards.length * 0.5) {
    laggardMissing.push('FAQ sections');
  }
  if (laggards.filter((s) => !s.signals.components.hasTrustBar).length > laggards.length * 0.5) {
    laggardMissing.push('trust indicators');
  }

  if (laggards.filter((s) => s.signals.effects.gradients.length === 0).length > laggards.length * 0.5) {
    laggardEffects.push('gradients');
  }
  if (laggards.filter((s) => s.signals.effects.shadows.length === 0).length > laggards.length * 0.5) {
    laggardEffects.push('shadows');
  }
  if (laggards.filter((s) => s.signals.effects.transitions.length === 0).length > laggards.length * 0.5) {
    laggardEffects.push('transitions');
  }

  if (laggards.filter((s) => s.signals.counts.fontTags > 0).length > laggards.length * 0.3) {
    laggardOutdated.push('font tags (deprecated HTML)');
  }
  if (laggards.filter((s) => s.signals.tokens.mediaQueries.length === 0).length > laggards.length * 0.5) {
    laggardOutdated.push('no media queries (not responsive)');
  }

  // Color scheme
  const allBg = sites.flatMap((s) => s.signals.colors.backgrounds);
  const darkBg = allBg.filter(isDarkColor).length;
  const lightBg = allBg.length - darkBg;
  const colorScheme: 'light' | 'dark' | 'mixed' =
    darkBg > lightBg * 2 ? 'dark' : lightBg > darkBg * 2 ? 'light' : 'mixed';

  const dominantBg = mode(allBg);
  const allAccent = sites.flatMap((s) => s.signals.colors.accents);
  const dominantAccent = mode(allAccent);

  // Border radius scale
  const allRadius = sites.flatMap((s) => s.signals.effects.borderRadius);
  const medRadius = median(allRadius);
  const borderRadiusScale: 'sharp' | 'medium' | 'rounded' =
    medRadius < 4 ? 'sharp' : medRadius < 12 ? 'medium' : 'rounded';

  // Spacing scale
  const allSectionPad = sites.flatMap((s) => s.signals.layout.sectionPadding);
  const medSectionPad = median(allSectionPad);
  const spacingScale: 'compact' | 'comfortable' | 'spacious' =
    medSectionPad < 32 ? 'compact' : medSectionPad < 64 ? 'comfortable' : 'spacious';

  const avgScore = sites.reduce((sum, s) => sum + s.score, 0) / sites.length;
  const eliteAvgScore = elite.reduce((sum, s) => sum + s.score, 0) / elite.length;
  const laggardAvgScore = laggards.reduce((sum, s) => sum + s.score, 0) / laggards.length;

  return {
    elite: {
      colors: {
        backgrounds: topN(eliteBg, 5),
        surfaces: topN(eliteSurface, 5),
        texts: topN(eliteText, 5),
        accents: topN(eliteAccent, 5),
      },
      typography: {
        fontFamilies: topN(eliteFonts, 5),
        fontSizes: { min: min(eliteFontSizes), max: max(eliteFontSizes), median: median(eliteFontSizes) },
        fontWeights: topN(eliteFontWeights, 5),
        lineHeights: { min: min(eliteLineHeights), max: max(eliteLineHeights), median: median(eliteLineHeights) },
      },
      layout: {
        maxWidth: mode(eliteMaxWidths),
        gridColumns: topN(eliteGridCols, 3),
        sectionPadding: { min: min(eliteSectionPad), max: max(eliteSectionPad), median: median(eliteSectionPad) },
        cardPadding: { min: min(eliteCardPad), max: max(eliteCardPad), median: median(eliteCardPad) },
        gaps: { min: min(eliteGaps), max: max(eliteGaps), median: median(eliteGaps) },
      },
      effects: {
        gradients: eliteGradients > elite.length * 0.5,
        shadows: eliteShadows > elite.length * 0.5,
        transitions: eliteTransitions > elite.length * 0.5,
        animations: eliteAnimations > elite.length * 0.3,
        borderRadius: { min: min(eliteRadius), max: max(eliteRadius), median: median(eliteRadius) },
      },
      components: eliteComponents,
    },
    laggard: {
      missingComponents: laggardMissing,
      missingEffects: laggardEffects,
      outdatedPatterns: laggardOutdated,
    },
    stats: {
      totalSites: sites.length,
      eliteCount: elite.length,
      laggardCount: laggards.length,
      avgScore: Math.round(avgScore),
      eliteAvgScore: Math.round(eliteAvgScore),
      laggardAvgScore: Math.round(laggardAvgScore),
    },
    tokens: {
      colorScheme,
      dominantBackground: dominantBg,
      dominantAccent,
      borderRadiusScale,
      spacingScale,
    },
  };
}
