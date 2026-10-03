import type {
  CategoryKey,
  CategoryScore,
  Finding,
  FindingStatus,
  Grade,
  OnPageSignals,
  PageSpeedResult,
} from './types';

export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  performance: 0.25,
  mobile: 0.15,
  search: 0.15,
  trust: 0.15,
  content: 0.1,
  aiVisibility: 0.1,
  conversion: 0.1,
};

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  performance: 'Performance',
  mobile: 'Mobile',
  search: 'Search Foundations',
  trust: 'Trust & Credibility',
  content: 'Content',
  aiVisibility: 'AI Visibility',
  conversion: 'Conversion',
};

function finding(
  id: string,
  label: string,
  status: FindingStatus,
  detail: string,
  impact: number
): Finding {
  return { id, label, status, detail, impact };
}

/**
 * Status multipliers.
 *
 * These are deliberately harsh. A "warn" is a real, unfixed problem — paying it
 * half credit inflates every score. An earlier version used warn=0.5 and the
 * resulting field average was 82/100 with zero sites in the Critical band, which
 * is inconsistent with published research (borahlabs: 46% of electrician sites
 * fail page-speed thresholds; chatready: home services average 14/100).
 *
 * "unknown" stays neutral at 0.5 so a site is never punished for a signal we
 * could not measure (e.g. review data before the Places API is connected).
 */
const STATUS_MULTIPLIER: Record<FindingStatus, number> = {
  pass: 1.0,
  warn: 0.25,
  fail: 0.0,
  unknown: 0.5,
};

/**
 * Impact-weighted scoring.
 *
 * Count-weighted scoring treats a missing viewport tag (critical on mobile) the
 * same as a missing lang attribute (cosmetic). Weighting by each finding's impact
 * means the score reflects what actually costs the business money.
 */
function scoreFromFindings(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  const totalImpact = findings.reduce((sum, f) => sum + f.impact, 0);
  if (totalImpact === 0) return 0;
  const earned = findings.reduce((sum, f) => sum + f.impact * STATUS_MULTIPLIER[f.status], 0);
  return Math.round((earned / totalImpact) * 100);
}

/* ------------------------------------------------------------------ */
/* Performance — uses PageSpeed when available, else measured timing.  */
/* ------------------------------------------------------------------ */
export function scorePerformance(
  ps: PageSpeedResult | null,
  signals: OnPageSignals,
  ttfbMs: number,
  totalMs: number,
  bytes: number
): CategoryScore {
  const findings: Finding[] = [];

  if (ps?.ok && ps.performanceScore !== null) {
    const s = ps.performanceScore;
    findings.push(
      finding(
        'lighthouse',
        'Lighthouse performance score',
        s >= 90 ? 'pass' : s >= 50 ? 'warn' : 'fail',
        `${s}/100 from Google PageSpeed Insights`,
        10
      )
    );

    if (ps.lcpMs !== null) {
      findings.push(
        finding(
          'lcp',
          'Largest Contentful Paint',
          ps.lcpMs <= 2500 ? 'pass' : ps.lcpMs <= 4000 ? 'warn' : 'fail',
          `${(ps.lcpMs / 1000).toFixed(2)}s (Google target: under 2.50s)`,
          9
        )
      );
    }
    if (ps.cls !== null) {
      findings.push(
        finding(
          'cls',
          'Cumulative Layout Shift',
          ps.cls <= 0.1 ? 'pass' : ps.cls <= 0.25 ? 'warn' : 'fail',
          `${ps.cls.toFixed(3)} (Google target: under 0.100)`,
          7
        )
      );
    }
    if (ps.tbtMs !== null) {
      findings.push(
        finding(
          'tbt',
          'Total Blocking Time',
          ps.tbtMs <= 200 ? 'pass' : ps.tbtMs <= 600 ? 'warn' : 'fail',
          `${Math.round(ps.tbtMs)}ms (target: under 200ms)`,
          6
        )
      );
    }
  } else {
    // No PageSpeed — fall back to what we measured ourselves. Still real data,
    // but we can only judge server speed and page weight, not render performance.
    // Findings we cannot measure are marked 'unknown' (neutral) rather than
    // silently passed, so a site never looks fast just because PageSpeed was off.
    findings.push(
      finding(
        'ttfb',
        'Server response time',
        ttfbMs <= 600 ? 'pass' : ttfbMs <= 1800 ? 'warn' : 'fail',
        `${ttfbMs}ms to first byte (target: under 600ms)`,
        9
      )
    );
    findings.push(
      finding(
        'load',
        'Full page load',
        totalMs <= 2500 ? 'pass' : totalMs <= 5000 ? 'warn' : 'fail',
        `${(totalMs / 1000).toFixed(2)}s total (target: under 2.50s)`,
        8
      )
    );
    findings.push(
      finding(
        'lighthouse',
        'Lighthouse performance score',
        'unknown',
        'Not measured — PageSpeed Insights unavailable for this run',
        10
      )
    );
    findings.push(
      finding(
        'lcp',
        'Largest Contentful Paint',
        'unknown',
        'Not measured — requires PageSpeed Insights',
        9
      )
    );
    findings.push(
      finding(
        'cls',
        'Cumulative Layout Shift',
        'unknown',
        'Not measured — requires PageSpeed Insights',
        7
      )
    );
    findings.push(
      finding(
        'tbt',
        'Total Blocking Time',
        'unknown',
        'Not measured — requires PageSpeed Insights',
        6
      )
    );
  }

  // Page weight is always measurable
  const kb = Math.round(bytes / 1024);
  findings.push(
    finding(
      'weight',
      'HTML page weight',
      kb <= 150 ? 'pass' : kb <= 400 ? 'warn' : 'fail',
      `${kb}KB of HTML (target: under 150KB)`,
      4
    )
  );

  // Render-blocking / heavy asset hints
  findings.push(
    finding(
      'media',
      'Responsive images / media',
      signals.imageCount === 0
        ? 'warn'
        : signals.imageCount <= 40
          ? 'pass'
          : 'warn',
      `${signals.imageCount} images on the homepage`,
      3
    )
  );

  return {
    key: 'performance',
    label: CATEGORY_LABELS.performance,
    weight: CATEGORY_WEIGHTS.performance,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Mobile                                                              */
/* ------------------------------------------------------------------ */
export function scoreMobile(signals: OnPageSignals): CategoryScore {
  const findings: Finding[] = [];

  findings.push(
    finding(
      'viewport',
      'Mobile viewport declared',
      signals.viewport ? 'pass' : 'fail',
      signals.viewport
        ? `Found: ${signals.viewport}`
        : 'No viewport meta tag — phones render this at desktop zoom',
      10
    )
  );

  findings.push(
    finding(
      'responsive',
      'Responsive layout rules',
      signals.hasMediaQueries ? 'pass' : 'fail',
      signals.hasMediaQueries
        ? 'CSS media queries detected'
        : 'No @media rules found — layout likely breaks on phones',
      9
    )
  );

  findings.push(
    finding(
      'tap',
      'Click-to-call on mobile',
      signals.hasTelLink ? 'pass' : signals.phoneInText ? 'warn' : 'fail',
      signals.hasTelLink
        ? 'Phone number is tappable'
        : signals.phoneInText
          ? 'Phone number shown as plain text — not tappable on mobile'
          : 'No phone number found',
      7
    )
  );

  findings.push(
    finding(
      'lang',
      'Language declared',
      signals.lang ? 'pass' : 'warn',
      signals.lang ? `html lang="${signals.lang}"` : 'No lang attribute on <html>',
      3
    )
  );

  return {
    key: 'mobile',
    label: CATEGORY_LABELS.mobile,
    weight: CATEGORY_WEIGHTS.mobile,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Search foundations                                                  */
/* ------------------------------------------------------------------ */
export function scoreSearch(signals: OnPageSignals): CategoryScore {
  const findings: Finding[] = [];

  const tLen = signals.titleLength;
  findings.push(
    finding(
      'title',
      'Page title',
      !signals.title ? 'fail' : tLen >= 30 && tLen <= 65 ? 'pass' : 'warn',
      signals.title
        ? `"${signals.title.slice(0, 70)}" (${tLen} chars, ideal 30–65)`
        : 'Missing <title> tag',
      9
    )
  );

  const dLen = signals.metaDescriptionLength;
  findings.push(
    finding(
      'meta',
      'Meta description',
      !signals.metaDescription ? 'fail' : dLen >= 70 && dLen <= 165 ? 'pass' : 'warn',
      signals.metaDescription
        ? `${dLen} chars (ideal 70–165)`
        : 'Missing meta description — Google invents your search snippet',
      7
    )
  );

  findings.push(
    finding(
      'h1',
      'Single H1 heading',
      signals.h1Count === 1 ? 'pass' : signals.h1Count === 0 ? 'fail' : 'warn',
      signals.h1Count === 1
        ? `"${(signals.h1Text || '').slice(0, 60)}"`
        : `${signals.h1Count} H1 tags found (should be exactly 1)`,
      7
    )
  );

  findings.push(
    finding(
      'canonical',
      'Canonical tag',
      signals.canonical ? 'pass' : 'warn',
      signals.canonical ? 'Canonical URL declared' : 'No canonical tag — duplicate-content risk',
      4
    )
  );

  findings.push(
    finding(
      'sitemap',
      'XML sitemap',
      signals.hasSitemap ? 'pass' : 'fail',
      signals.hasSitemap ? 'sitemap.xml found' : 'No sitemap.xml — slows indexing',
      6
    )
  );

  findings.push(
    finding(
      'robots',
      'robots.txt',
      signals.hasRobots ? 'pass' : 'warn',
      signals.hasRobots ? 'robots.txt found' : 'No robots.txt',
      4
    )
  );

  const altMissing = signals.imagesMissingAlt;
  findings.push(
    finding(
      'alt',
      'Image alt text',
      signals.imageCount === 0
        ? 'warn'
        : altMissing === 0
          ? 'pass'
          : altMissing / signals.imageCount <= 0.2
            ? 'warn'
            : 'fail',
      `${altMissing} of ${signals.imageCount} images missing alt text`,
      6
    )
  );

  findings.push(
    finding(
      'schema',
      'Structured data (schema.org)',
      signals.jsonLdTypes.length === 0
        ? 'fail'
        : signals.jsonLdTypes.length >= 2
          ? 'pass'
          : 'warn',
      signals.jsonLdTypes.length
        ? `Found: ${signals.jsonLdTypes.slice(0, 6).join(', ')}`
        : 'No JSON-LD — Google cannot show rich results for you',
      8
    )
  );

  return {
    key: 'search',
    label: CATEGORY_LABELS.search,
    weight: CATEGORY_WEIGHTS.search,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Trust                                                               */
/* ------------------------------------------------------------------ */
export function scoreTrust(signals: OnPageSignals, hasReviews: boolean): CategoryScore {
  const findings: Finding[] = [];

  findings.push(
    finding(
      'https',
      'HTTPS / SSL',
      signals.https ? 'pass' : 'fail',
      signals.https ? 'Served over HTTPS' : 'No HTTPS — browsers show a "Not Secure" warning',
      10
    )
  );

  findings.push(
    finding(
      'localbusiness',
      'Local business schema',
      signals.hasLocalBusinessSchema ? 'pass' : 'fail',
      signals.hasLocalBusinessSchema
        ? 'LocalBusiness/ProfessionalService schema present'
        : 'No local business schema — weakens local search and AI answers',
      8
    )
  );

  findings.push(
    finding(
      'address',
      'Physical address shown',
      signals.addressSignals ? 'pass' : 'warn',
      signals.addressSignals
        ? 'Street address or ZIP detected'
        : 'No clear address — hurts local trust and NAP consistency',
      7
    )
  );

  findings.push(
    finding(
      'phone',
      'Phone number visible',
      signals.phoneInText || signals.hasTelLink ? 'pass' : 'fail',
      signals.phoneInText || signals.hasTelLink
        ? 'Phone number found on the page'
        : 'No phone number found',
      8
    )
  );

  findings.push(
    finding(
      'social',
      'Social presence linked',
      signals.socialLinks.length >= 2 ? 'pass' : signals.socialLinks.length === 1 ? 'warn' : 'fail',
      signals.socialLinks.length
        ? `Links to: ${signals.socialLinks.join(', ')}`
        : 'No social profiles linked from the site',
      5
    )
  );

  findings.push(
    finding(
      'reviews',
      'Reviews / social proof',
      hasReviews ? 'pass' : 'unknown',
      hasReviews
        ? 'Review data available'
        : 'Review data not yet connected (Places API pending)',
      9
    )
  );

  findings.push(
    finding(
      'contactpage',
      'Contact route',
      signals.formCount > 0 || signals.hasMailtoLink ? 'pass' : 'warn',
      signals.formCount > 0
        ? `${signals.formCount} contact form(s) present`
        : signals.hasMailtoLink
          ? 'Email link present, no form'
          : 'No form or email link found',
      7
    )
  );

  return {
    key: 'trust',
    label: CATEGORY_LABELS.trust,
    weight: CATEGORY_WEIGHTS.trust,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */
export function scoreContent(signals: OnPageSignals, currentYear = new Date().getFullYear()): CategoryScore {
  const findings: Finding[] = [];

  const wc = signals.wordCount;
  findings.push(
    finding(
      'depth',
      'Homepage content depth',
      wc >= 500 ? 'pass' : wc >= 250 ? 'warn' : 'fail',
      `${wc} words on the homepage (target: 500+)`,
      8
    )
  );

  const year = signals.copyrightYear;
  const stale = year !== null && currentYear - year >= 3;
  findings.push(
    finding(
      'freshness',
      'Content freshness',
      year === null
        ? 'warn'
        : currentYear - year <= 1
          ? 'pass'
          : currentYear - year <= 2
            ? 'warn'
            : 'fail',
      year === null
        ? 'No copyright year found — cannot judge freshness'
        : stale
          ? `Site shows ${year} — ${currentYear - year} years stale, reads as abandoned`
          : `Site shows ${year} — looks maintained`,
      9
    )
  );

  findings.push(
    finding(
      'blog',
      'Blog / resources section',
      signals.hasBlogLink ? 'pass' : 'fail',
      signals.hasBlogLink
        ? 'Blog or resources section linked'
        : 'No blog/resources — nothing for search engines to index beyond a few pages',
      8
    )
  );

  findings.push(
    finding(
      'structure',
      'Heading structure',
      signals.h2Count >= 3 ? 'pass' : signals.h2Count >= 1 ? 'warn' : 'fail',
      `${signals.h2Count} H2 subheadings (target: 3+)`,
      5
    )
  );

  findings.push(
    finding(
      'density',
      'Specificity of claims',
      signals.numericDensity >= 0.01 ? 'pass' : signals.numericDensity > 0 ? 'warn' : 'fail',
      `${(signals.numericDensity * 100).toFixed(1)}% of words are numbers — vague copy without specifics`,
      6
    )
  );

  findings.push(
    finding(
      'links',
      'Internal linking',
      signals.internalLinks >= 15 ? 'pass' : signals.internalLinks >= 6 ? 'warn' : 'fail',
      `${signals.internalLinks} internal links`,
      5
    )
  );

  return {
    key: 'content',
    label: CATEGORY_LABELS.content,
    weight: CATEGORY_WEIGHTS.content,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* AI visibility                                                       */
/* ------------------------------------------------------------------ */
export function scoreAiVisibility(signals: OnPageSignals): CategoryScore {
  const findings: Finding[] = [];

  findings.push(
    finding(
      'crawlers',
      'AI crawlers allowed',
      signals.robotsAllowsAi ? 'pass' : 'fail',
      signals.robotsAllowsAi
        ? 'GPTBot / ClaudeBot / PerplexityBot are not blocked'
        : 'robots.txt blocks AI crawlers — you cannot appear in AI answers',
      10
    )
  );

  findings.push(
    finding(
      'llms',
      'llms.txt',
      signals.hasLlmsTxt ? 'pass' : 'warn',
      signals.hasLlmsTxt
        ? 'llms.txt published — helps AI engines understand the site'
        : 'No llms.txt (optional, but early adopters are using it)',
      5
    )
  );

  findings.push(
    finding(
      'faq',
      'FAQ / question content',
      signals.hasFaqSchema ? 'pass' : 'fail',
      signals.hasFaqSchema
        ? 'FAQPage schema present — directly answerable by AI'
        : 'No FAQ schema — AI engines have nothing structured to quote',
      9
    )
  );

  findings.push(
    finding(
      'entity',
      'Entity / organization schema',
      signals.hasOrganizationSchema ? 'pass' : 'fail',
      signals.hasOrganizationSchema
        ? 'Organization or LocalBusiness entity declared'
        : 'No entity schema — AI engines cannot verify who you are',
      9
    )
  );

  findings.push(
    finding(
      'substance',
      'Answer-ready content',
      signals.wordCount >= 500 && signals.h2Count >= 3 ? 'pass' : signals.wordCount >= 250 ? 'warn' : 'fail',
      `${signals.wordCount} words across ${signals.h2Count} subheadings — AI needs chunkable, factual content`,
      7
    )
  );

  return {
    key: 'aiVisibility',
    label: CATEGORY_LABELS.aiVisibility,
    weight: CATEGORY_WEIGHTS.aiVisibility,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Conversion                                                          */
/* ------------------------------------------------------------------ */
export function scoreConversion(signals: OnPageSignals): CategoryScore {
  const findings: Finding[] = [];

  findings.push(
    finding(
      'cta',
      'Clear call to action',
      signals.ctaTexts.length >= 2 ? 'pass' : signals.ctaTexts.length === 1 ? 'warn' : 'fail',
      signals.ctaTexts.length
        ? `CTAs found: ${signals.ctaTexts.slice(0, 4).join(' / ')}`
        : 'No clear call to action detected',
      10
    )
  );

  findings.push(
    finding(
      'form',
      'Contact / quote form',
      signals.formCount > 0 ? 'pass' : 'fail',
      signals.formCount > 0
        ? `${signals.formCount} form(s) on the homepage`
        : 'No form — visitors have no way to convert',
      9
    )
  );

  findings.push(
    finding(
      'clickcall',
      'Click-to-call',
      signals.hasTelLink ? 'pass' : 'fail',
      signals.hasTelLink
        ? 'Tappable tel: link present'
        : 'No tel: link — mobile visitors must copy the number by hand',
      8
    )
  );

  findings.push(
    finding(
      'booking',
      'Online booking / scheduling',
      signals.bookingSignals ? 'pass' : 'fail',
      signals.bookingSignals
        ? 'Booking or scheduling flow detected'
        : 'No online booking — every appointment needs a phone call',
      8
    )
  );

  findings.push(
    finding(
      'hours',
      'Hours / availability',
      signals.hoursSignals ? 'pass' : 'warn',
      signals.hoursSignals ? 'Hours or availability stated' : 'No hours shown',
      5
    )
  );

  findings.push(
    finding(
      'valueprop',
      'Value proposition above the fold',
      signals.h1Count === 1 && (signals.h1Text?.length ?? 0) > 10 ? 'pass' : 'warn',
      signals.h1Count === 1
        ? 'Clear headline stating what they do'
        : 'Unclear or missing headline',
      6
    )
  );

  return {
    key: 'conversion',
    label: CATEGORY_LABELS.conversion,
    weight: CATEGORY_WEIGHTS.conversion,
    score: scoreFromFindings(findings),
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Roll-up                                                             */
/* ------------------------------------------------------------------ */
/**
 * Grade bands.
 *
 * Calibrated against published third-party research rather than picked arbitrarily:
 *   - borahlabs.us: 46% of electrician sites land in the "Critical" page-speed tier
 *   - chatready.io (1,000 businesses): home services average 14/100, 84% in red zone
 *   - whatsmygeoscore.com: ~60% of all scanned sites score below 40
 *
 * A rubric where most real small-business sites rate "Strong" is useless — it
 * cannot differentiate, and it cannot sell. These bands are set so that an
 * average small-business site lands in "developing" or "critical", which is
 * what the independent data says is true.
 */
export function gradeFor(score: number): Grade {
  if (score >= 80) return 'elite';
  if (score >= 60) return 'strong';
  if (score >= 35) return 'developing';
  return 'critical';
}

export function combineCategories(categories: CategoryScore[]): number {
  const total = categories.reduce((sum, c) => sum + c.score * c.weight, 0);
  const weightSum = categories.reduce((sum, c) => sum + c.weight, 0);
  return Math.round(total / weightSum);
}

/** Top fixes = highest-impact non-passing findings across all categories. */
export function rankFixes(categories: CategoryScore[], limit = 5): Finding[] {
  return categories
    .flatMap((c) => c.findings.map((f) => ({ ...f, category: c.label })))
    .filter((f) => f.status === 'fail' || f.status === 'warn')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'fail' ? -1 : 1;
      return b.impact - a.impact;
    })
    .slice(0, limit);
}

export function percentileAgainst(score: number, fieldScores: number[]): number {
  if (fieldScores.length === 0) return 50;
  const below = fieldScores.filter((s) => s < score).length;
  return Math.round((below / fieldScores.length) * 100);
}
