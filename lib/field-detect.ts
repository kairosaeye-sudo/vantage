import * as cheerio from 'cheerio';
import { listFields, type DbField } from './field-from-db';

/**
 * Auto-detect which field a site belongs to.
 *
 * Matches the site's content against field metadata (industry, location).
 * Returns the best matching field ID, or null if no field matches.
 */

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  electricians: ['electrician', 'electrical', 'wiring', 'outlet', 'panel', 'circuit', 'breaker', 'lighting installation', 'ceiling fan', 'ev charger', 'generator'],
  dentists: ['dentist', 'dental', 'teeth', 'orthodontist', 'oral', 'cavity', 'filling', 'crown', 'veneer', 'whitening', 'root canal', 'extraction'],
  plumbers: ['plumber', 'plumbing', 'pipe', 'drain', 'water heater', 'faucet', 'toilet', 'leak', 'sewer', 'sump pump'],
  roofers: ['roofer', 'roofing', 'shingle', 'gutter', 'siding', 'chimney', 'skylight', 'roof repair', 'roof replacement'],
  hvac: ['hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'ac repair', 'thermostat', 'ductwork', 'ventilation'],
  landscapers: ['landscaping', 'lawn', 'garden', 'tree', 'hedge', 'mulch', 'sod', 'irrigation', 'landscape design'],
  painters: ['painter', 'painting', 'interior painting', 'exterior painting', 'drywall', 'wallpaper', 'stain'],
  cleaners: ['cleaning', 'maid', 'janitorial', 'carpet cleaning', 'window cleaning', 'pressure washing'],
  lawyers: ['lawyer', 'attorney', 'legal', 'litigation', 'contract', 'personal injury', 'family law', 'criminal defense'],
  accountants: ['accountant', 'accounting', 'tax', 'bookkeeping', 'audit', 'cpa', 'payroll', 'financial'],
};

const LOCATION_KEYWORDS: Record<string, string[]> = {
  'austin': ['austin', 'tx', 'texas', 'round rock', 'cedar park', 'pflugerville', 'lakeway', 'georgetown', 'san marcus'],
  'denver': ['denver', 'co', 'colorado', 'boulder', 'aurora', 'lakewood', 'arvada', 'westminster', 'thornton'],
  'boulder': ['boulder', 'co', 'colorado', 'louisville', 'lafayette', 'erie', 'broomfield', 'longmont'],
};

function extractText(html: string): string {
  const $ = cheerio.load(html);
  // Remove script and style tags
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').toLowerCase();
}

function scoreField(text: string, field: DbField): number {
  let score = 0;

  // Industry match
  const industryKeywords = INDUSTRY_KEYWORDS[field.industry.toLowerCase()] ?? [];
  for (const kw of industryKeywords) {
    if (text.includes(kw)) {
      score += 10;
    }
  }

  // Location match
  const locationParts = field.location.toLowerCase().split(/[,\s]+/).filter(Boolean);
  for (const part of locationParts) {
    if (text.includes(part)) {
      score += 5;
    }
  }

  // Slug match (e.g., "electricians-austin-tx")
  const slugParts = field.slug.toLowerCase().split('-');
  for (const part of slugParts) {
    if (part.length > 2 && text.includes(part)) {
      score += 3;
    }
  }

  return score;
}

export async function detectField(html: string): Promise<string | null> {
  const fields = await listFields();
  if (fields.length === 0) return null;

  const text = extractText(html);

  let bestField: DbField | null = null;
  let bestScore = 0;

  for (const field of fields) {
    const score = scoreField(text, field);
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  // Require a minimum score to avoid false positives
  if (bestScore >= 10 && bestField) {
    return bestField.id;
  }

  return null;
}

export async function detectFieldWithMeta(html: string): Promise<{
  fieldId: string | null;
  fieldSlug: string | null;
  fieldIndustry: string | null;
  fieldLocation: string | null;
  score: number;
}> {
  const fields = await listFields();
  if (fields.length === 0) {
    return { fieldId: null, fieldSlug: null, fieldIndustry: null, fieldLocation: null, score: 0 };
  }

  const text = extractText(html);

  let bestField: DbField | null = null;
  let bestScore = 0;

  for (const field of fields) {
    const score = scoreField(text, field);
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  if (bestScore >= 10 && bestField) {
    return {
      fieldId: bestField.id,
      fieldSlug: bestField.slug,
      fieldIndustry: bestField.industry,
      fieldLocation: bestField.location,
      score: bestScore,
    };
  }

  return { fieldId: null, fieldSlug: null, fieldIndustry: null, fieldLocation: null, score: bestScore };
}
