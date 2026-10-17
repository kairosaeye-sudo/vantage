import type { SiteScore } from './types';
import { getFieldSites, listFields, rowsToPeers, type DbField } from './field-from-db';

/**
 * Who a site is compared against — widened step by step until there is a field.
 *
 * The comparison is the product, so "we have no field for your town" must not
 * end in no comparison, and must never end in a comparison against the wrong
 * industry presented as if it were local. The rings, in order:
 *
 *   local   — same industry, same city. The real thing.
 *   nearby  — same industry, within driving range (same state, or a nearby one).
 *   wider   — same industry, anywhere we have measured it, nearest first.
 *   all     — every site we have measured, any industry. Only when the industry
 *             has no field anywhere, and always labelled as such.
 *
 * Every ring states its scope in plain words, so the owner always knows what
 * "#3 of 25" is out of.
 */

export type CompareScope = 'local' | 'nearby' | 'wider' | 'all';

export interface ComparisonSet {
  scope: CompareScope;
  /** Fields pooled into the comparison, nearest first. */
  fields: DbField[];
  /** Pooled, de-duplicated peer scores. */
  peers: SiteScore[];
  /** Where each peer is, by URL — shown beside its name outside the local ring. */
  peerWhere: Record<string, string>;
  /** The industry the comparison is about, as a display noun ("Electricians"). */
  industry: string;
  /** The customer's own location; the field's only for a local match; else empty. */
  location: string;
  /** What the comparison is out of: "electricians in Austin, TX". */
  label: string;
  /** Plain-words explanation when the ring is wider than local; null when local. */
  note: string | null;
  /** Miles from the customer's state to the nearest pooled field, when known. */
  nearestMiles: number | null;
}

/** Approximate geographic centre of each state (lat, lng). Good to ~100 miles,
 *  which is all "nearest field first" needs. */
const STATE_CENTRE: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [64.7, -152.3], AZ: [34.3, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4],
  GA: [32.7, -83.4], HI: [20.3, -156.4], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3],
  IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
  MD: [39.1, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9],
  WY: [43.0, -107.6],
};

/** Within this many miles of the customer's state, a field counts as nearby. */
const NEARBY_MILES = 350;

/** 1103 → "1,100": a distance between state centres is not precise to the mile. */
function roundMiles(m: number): string {
  return (Math.round(m / 50) * 50).toLocaleString('en-US');
}

function miles(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(h));
}

/** "Austin, TX" → { city: "austin", state: "TX" }. */
function parseLocation(loc: string): { city: string; state: string | null } {
  const [city, rest] = loc.split(',').map((s) => s.trim());
  const state = rest?.match(/\b([A-Z]{2})\b/)?.[1] ?? null;
  return { city: (city ?? '').toLowerCase(), state };
}

/** "Electricians" and "electricians" and "electrician" are one industry. */
export function sameIndustry(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = (s: string) => s.toLowerCase().trim().replace(/s$/, '');
  return n(a) === n(b);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function listPlaces(fields: DbField[]): string {
  const places = fields.map((f) => f.location);
  if (places.length <= 3) {
    return places.length <= 1 ? places.join('') : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
  }
  return `${places.length} cities`;
}

export async function resolveComparison(input: {
  /** A field the customer chose explicitly — always used as-is. */
  fieldSlug?: string | null;
  /** What the business is, from the page. */
  industry: string | null;
  /** Where the business is, from the page. */
  city: string | null;
  region: string | null;
  /** The customer's own site, excluded from its peers. */
  selfUrl: string;
}): Promise<ComparisonSet | null> {
  const all = await listFields();
  if (all.length === 0) return null;

  const self = domainOf(input.selfUrl);
  const where = input.city ? `${input.city}${input.region ? `, ${input.region}` : ''}` : input.region;

  const pool = async (fields: DbField[]) => {
    const peers: SiteScore[] = [];
    const peerWhere: Record<string, string> = {};
    const seen = new Set<string>([self]);
    for (const f of fields) {
      for (const p of rowsToPeers(await getFieldSites(f.id))) {
        const d = domainOf(p.finalUrl);
        if (seen.has(d)) continue;
        seen.add(d);
        peers.push(p);
        peerWhere[p.finalUrl] = f.location;
      }
    }
    return { peers, peerWhere };
  };

  const build = async (
    scope: CompareScope,
    fields: DbField[],
    industry: string,
    label: string,
    note: string | null,
    nearestMiles: number | null
  ): Promise<ComparisonSet> => {
    const { peers, peerWhere } = await pool(fields);
    return {
      scope,
      fields,
      peers,
      peerWhere,
      industry,
      // Never borrow the field's town as the customer's: AI answers would ask
      // "best electricians in Austin" about a business that is not in Austin.
      location: where ?? '',
      label,
      note,
      nearestMiles,
    };
  };

  // An explicit choice is respected exactly.
  if (input.fieldSlug) {
    const f = all.find((x) => x.slug === input.fieldSlug);
    if (f) {
      const set = await build('local', [f], f.industry, `${f.industry.toLowerCase()} in ${f.location}`, null, null);
      return { ...set, location: f.location };
    }
  }

  const sameInd = input.industry ? all.filter((f) => sameIndustry(f.industry, input.industry)) : [];
  const industryNoun = sameInd[0]?.industry ?? (input.industry ? input.industry.replace(/^\w/, (c) => c.toUpperCase()) : 'Local businesses');
  const lowerNoun = industryNoun.toLowerCase();

  // Ring 1: same industry, same city.
  if (input.city) {
    const local = sameInd.filter((f) => parseLocation(f.location).city === input.city!.toLowerCase());
    if (local.length) {
      const set = await build('local', local, industryNoun, `${lowerNoun} in ${local[0].location}`, null, 0);
      return { ...set, location: local[0].location };
    }
  }

  if (sameInd.length) {
    // Order the industry's fields by distance from the customer, when we know
    // where they are; otherwise by how much of the field we have measured.
    const origin = input.region ? STATE_CENTRE[input.region.toUpperCase()] : undefined;
    const withDist = sameInd
      .map((f) => {
        const st = parseLocation(f.location).state;
        const c = st ? STATE_CENTRE[st] : undefined;
        return { f, d: origin && c ? Math.round(miles(origin, c)) : null };
      })
      .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || b.f.siteCount - a.f.siteCount);

    // No idea where they are: the industry is still the right comparison.
    if (!where) {
      const fields = withDist.map((x) => x.f);
      return build(
        'wider',
        fields,
        industryNoun,
        `${lowerNoun} in ${listPlaces(fields)}`,
        `We couldn't tell where you're based from your site, so you're compared with every ${lowerNoun.replace(/s$/, '')} we've measured — in ${listPlaces(fields)}.`,
        null
      );
    }

    // Ring 2: nearby.
    const near = withDist.filter((x) => x.d !== null && x.d <= NEARBY_MILES);
    if (near.length) {
      const fields = near.map((x) => x.f);
      return build(
        'nearby',
        fields,
        industryNoun,
        `${lowerNoun} near ${where}`,
        `We haven't built a field for ${where} yet, so you're compared with the nearest ${lowerNoun} we've measured — in ${listPlaces(fields)}.`,
        near[0].d
      );
    }

    // Ring 3: anywhere, nearest first.
    const fields = withDist.map((x) => x.f);
    return build(
      'wider',
      fields,
      industryNoun,
      `${lowerNoun} in ${listPlaces(fields)}`,
      `There's no ${lowerNoun.replace(/s$/, '')} field near ${where} yet, so we searched wider: you're compared with ${lowerNoun} in ${listPlaces(fields)}${withDist[0].d !== null ? ` (the nearest is about ${roundMiles(withDist[0].d)} miles away)` : ''}.`,
      withDist[0].d
    );
  }

  // Ring 4: the industry has no field anywhere. Every category in the rubric
  // applies to any local business site, so the whole corpus is still a fair
  // yardstick — as long as it is called what it is.
  const fields = [...all].sort((a, b) => b.siteCount - a.siteCount);
  const set = await build(
    'all',
    fields,
    industryNoun,
    'local business sites we have measured',
    `We don't have a ${input.industry ? `${input.industry.replace(/s$/, '')} ` : ''}field yet${where ? ` for ${where} or anywhere else` : ''}, so you're compared with every local business site we've measured — ${fields
      .map((f) => `${f.industry.toLowerCase()} in ${f.location}`)
      .join(', ')}. The categories are the same for any local business; the names are not your direct competitors.`,
    null
  );
  return set;
}
