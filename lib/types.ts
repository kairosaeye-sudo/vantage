export type Grade = 'elite' | 'strong' | 'developing' | 'critical';
export type FindingStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export type CategoryKey =
  | 'performance'
  | 'mobile'
  | 'search'
  | 'trust'
  | 'content'
  | 'aiVisibility'
  | 'conversion';

export interface Finding {
  id: string;
  label: string;
  status: FindingStatus;
  detail: string;
  impact: number; // 0-10, how much fixing this moves the score
}

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  weight: number; // 0-1
  score: number; // 0-100
  findings: Finding[];
}

export interface FetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  error?: string;
}

export interface PageSpeedResult {
  ok: boolean;
  performanceScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  error?: string;
}

export interface OnPageSignals {
  url: string;
  origin: string;
  https: boolean;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1Count: number;
  h1Text: string | null;
  h2Count: number;
  canonical: string | null;
  lang: string | null;
  viewport: string | null;
  jsonLdTypes: string[];
  hasOrganizationSchema: boolean;
  hasFaqSchema: boolean;
  hasLocalBusinessSchema: boolean;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  socialLinks: string[];
  formCount: number;
  hasTelLink: boolean;
  hasMailtoLink: boolean;
  phoneInText: boolean;
  addressSignals: boolean;
  hoursSignals: boolean;
  bookingSignals: boolean;
  ctaTexts: string[];
  wordCount: number;
  copyrightYear: number | null;
  hasBlogLink: boolean;
  hasMediaQueries: boolean;
  hasSitemap: boolean;
  hasRobots: boolean;
  robotsAllowsAi: boolean;
  hasLlmsTxt: boolean;
  numericDensity: number;
}

export interface SiteScore {
  url: string;
  finalUrl: string;
  overall: number;
  grade: Grade;
  categories: CategoryScore[];
  topFixes: Finding[];
  measuredAt: string;
  fetch: { status: number; ttfbMs: number; totalMs: number; bytes: number };
  pagespeed: PageSpeedResult | null;
  error?: string;
}
