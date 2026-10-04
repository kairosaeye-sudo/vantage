import * as cheerio from 'cheerio';
import { extractContent } from './extract-content';

/**
 * Detect where a business is located, from the site itself.
 *
 * The glow-up needs a location to decide which field to measure against. Before
 * this, location matching only worked for cities we had already hardcoded
 * keywords for — so a plumber in Tulsa could never match a field, and the
 * glow-up fell back to generic best practices even though the site said
 * plainly where it was.
 *
 * Order of evidence, strongest first:
 *
 *   1. Structured data — LocalBusiness / PostalAddress in JSON-LD. If the site
 *      publishes its address as data, that is the most reliable signal.
 *   2. A full address in the visible text — "Austin, TX 78704".
 *   3. City + state near a phone number or the word "serving".
 *   4. A bare city name that appears repeatedly, with a state code beside it.
 *
 * Returns the city, the two-letter state code where found, and the evidence
 * that produced them, so the caller can show the user why it chose a location
 * rather than silently guessing.
 */

export interface DetectedLocation {
  city: string | null;
  region: string | null;
  /** 'structured-data' | 'address' | 'city-state' | 'repeated-city' | null */
  source: string | null;
  /** The raw text the detection was based on. */
  evidence: string | null;
}

/** US state codes, used to validate a state abbreviation and to build the
 *  city+state patterns below. */
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const STATE_SET = new Set(US_STATES);

/** Words that look like a city but are not one. */
const NOT_A_CITY = new Set([
  'contact', 'about', 'services', 'service', 'home', 'welcome', 'menu', 'blog', 'news',
  'reviews', 'gallery', 'projects', 'our', 'the', 'new', 'free', 'get', 'call', 'today',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'privacy', 'terms', 'careers', 'faq', 'quote',
  'emergency', 'licensed', 'insured', 'residential', 'commercial', 'industrial',
  'north', 'south', 'east', 'west', 'central', 'downtown', 'greater', 'area',
]);

function isPlausibleCity(word: string): boolean {
  if (word.length < 3 || word.length > 24) return false;
  if (NOT_A_CITY.has(word.toLowerCase())) return false;
  // A city name is a single capitalised word or two, not an ALL-CAPS banner.
  if (word === word.toUpperCase() && word.length > 3) return false;
  return /^[A-Z][a-z]+$/.test(word);
}

/** Pull LocalBusiness / PostalAddress out of JSON-LD blocks. */
function fromStructuredData(html: string): DetectedLocation | null {
  const $ = cheerio.load(html);
  const blocks: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw) blocks.push(raw);
  });

  for (const raw of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const found = walkForAddress(parsed);
    if (found) return found;
  }
  return null;
}

/** Recursively look for a PostalAddress anywhere in a JSON-LD tree. */
function walkForAddress(node: unknown): DetectedLocation | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = walkForAddress(item);
      if (r) return r;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;

  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];

  const address = obj.address as Record<string, unknown> | undefined;
  if (address && typeof address === 'object') {
    const city = typeof address.addressLocality === 'string' ? address.addressLocality.trim() : null;
    const region = typeof address.addressRegion === 'string' ? address.addressRegion.trim() : null;
    if (city && (types.includes('PostalAddress') || types.length > 0)) {
      return {
        city,
        region: region && STATE_SET.has(region.toUpperCase()) ? region.toUpperCase() : region,
        source: 'structured-data',
        evidence: [city, region].filter(Boolean).join(', '),
      };
    }
  }

  // LocalBusiness often puts the city in `areaServed` instead of a full address.
  const areaServed = obj.areaServed;
  if (areaServed && types.some((t) => t.includes('LocalBusiness') || t.includes('Organization'))) {
    const names: string[] = [];
    const collect = (a: unknown) => {
      if (typeof a === 'string') names.push(a);
      else if (a && typeof a === 'object') {
        const n = (a as Record<string, unknown>).name;
        if (typeof n === 'string') names.push(n);
      }
    };
    if (Array.isArray(areaServed)) areaServed.forEach(collect);
    else collect(areaServed);
    const city = names.find((n) => isPlausibleCity(n.trim()));
    if (city) {
      return { city: city.trim(), region: null, source: 'structured-data', evidence: city.trim() };
    }
  }

  for (const value of Object.values(obj)) {
    const r = walkForAddress(value);
    if (r) return r;
  }
  return null;
}

export async function detectLocation(html: string): Promise<DetectedLocation> {
  const empty: DetectedLocation = { city: null, region: null, source: null, evidence: null };

  // 1. Structured data.
  const structured = fromStructuredData(html);
  if (structured?.city) return structured;

  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ');

  // 2. A full "City, ST 12345" address in the visible text.
  const cityStateZip = text.match(/\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
  if (cityStateZip && STATE_SET.has(cityStateZip[2]) && isPlausibleCity(cityStateZip[1])) {
    return {
      city: cityStateZip[1],
      region: cityStateZip[2],
      source: 'address',
      evidence: cityStateZip[0],
    };
  }

  // 3. "City, ST" with no zip — common in footers and service-area copy.
  const cityState = text.match(/\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?),\s*([A-Z]{2})\b(?!\s*\d)/);
  if (cityState && STATE_SET.has(cityState[2]) && isPlausibleCity(cityState[1])) {
    return {
      city: cityState[1],
      region: cityState[2],
      source: 'city-state',
      evidence: cityState[0],
    };
  }

  // 4. Fall back to the content extractor's address parsing, which looks at
  //    individual elements and is better at partial addresses. It wants a URL
  //    only to resolve relative links, which address parsing does not use.
  try {
    const content = extractContent(html, 'https://example.invalid/');
    if (content.address) {
      const m = content.address.match(/\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?),\s*([A-Z]{2})\b/);
      if (m && STATE_SET.has(m[2]) && isPlausibleCity(m[1])) {
        return { city: m[1], region: m[2], source: 'address', evidence: content.address };
      }
    }
  } catch {
    // Extraction is best-effort.
  }

  // 5. Last resort: the most-repeated plausible city name in the text.
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z.'-]{2,23})\b/g)) {
    const word = m[1];
    if (!isPlausibleCity(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [word, count] of counts) {
    if (count > bestCount) {
      best = word;
      bestCount = count;
    }
  }
  // Require the name to appear at least three times — once is a coincidence.
  if (best && bestCount >= 3) {
    return { city: best, region: null, source: 'repeated-city', evidence: `${best} (×${bestCount})` };
  }

  return empty;
}

/** A field slug for an industry + location, matching the existing convention
 *  (e.g. "electricians-austin-tx"). */
export function slugifyLocation(city: string, region: string | null): string {
  const cityPart = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return region ? `${cityPart}-${region.toLowerCase()}` : cityPart;
}
