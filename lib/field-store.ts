import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { SiteScore } from './types';
import { type FieldStats } from './compare';

/**
 * Load a previously-built field from disk.
 *
 * In production this comes from Supabase. During development we read the JSON
 * that scripts/build-field.ts writes, so the comparison engine can be exercised
 * without a database.
 *
 * `vertical` and `industry` are both accepted: older field files written before
 * industry/location were configurable only carry `vertical`.
 */
export interface FieldFile {
  slug?: string;
  /** Preferred label, e.g. "Electricians". */
  industry?: string;
  /** Location label, e.g. "Austin, TX". */
  location?: string;
  /** Legacy field name, e.g. "corpus-electricians-austin". */
  vertical?: string;
  builtAt: string;
  siteCount: number;
  failedCount?: number;
  pagespeed?: boolean;
  overall: { avg: number; median: number; min: number; max: number; p25: number; p75: number };
  categories: Record<string, { avg: number; median: number; min: number; max: number }>;
  distribution: { elite: number; strong: number; developing: number; critical: number };
  sites: Array<{
    url: string;
    overall: number;
    grade: string;
    error?: string;
    categories: Record<string, number>;
    topFixes: string[];
    ttfbMs: number;
    bytes: number;
  }>;
}

const FIELD_DIR = path.join(process.cwd(), 'data');

/** Human-readable label for a field, tolerant of old and new shapes. */
export function fieldLabel(field: FieldFile): string {
  if (field.industry && field.location) return `${field.industry} — ${field.location}`;
  return field.industry ?? field.vertical ?? 'unknown field';
}

export function listFieldFiles(): string[] {
  try {
    return readdirSync(FIELD_DIR).filter((f) => f.startsWith('field-') && f.endsWith('.json'));
  } catch {
    return [];
  }
}

export function listFields(): Array<{ slug: string; label: string; siteCount: number; builtAt: string }> {
  return listFieldFiles()
    .map((f) => loadField(f))
    .filter((f): f is FieldFile => f !== null)
    .map((f) => ({
      slug: f.slug ?? (f.vertical ?? 'unknown'),
      label: fieldLabel(f),
      siteCount: f.siteCount,
      builtAt: f.builtAt,
    }));
}

export function loadField(name: string): FieldFile | null {
  try {
    const file = name.endsWith('.json') ? name : `field-${name}.json`;
    const raw = readFileSync(path.join(FIELD_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as FieldFile;
    if (!parsed.slug) parsed.slug = parsed.vertical ?? name.replace(/^field-/, '').replace(/\.json$/, '');
    return parsed;
  } catch {
    return null;
  }
}

/** Reconstruct minimal SiteScore-shaped peers from a field file for comparison. */
export function fieldToPeers(field: FieldFile): SiteScore[] {
  return field.sites
    .filter((s) => !s.error)
    .map((s) => ({
      url: s.url,
      finalUrl: s.url,
      overall: s.overall,
      grade: s.grade as SiteScore['grade'],
      categories: Object.entries(s.categories).map(([key, score]) => ({
        key: key as never,
        label: key,
        weight: 0,
        score,
        findings: [],
      })),
      topFixes: [],
      measuredAt: field.builtAt,
      fetch: { status: 200, ttfbMs: s.ttfbMs, totalMs: s.ttfbMs, bytes: s.bytes },
      pagespeed: null,
    }));
}

export function fieldStatsFrom(field: FieldFile): FieldStats {
  return {
    vertical: fieldLabel(field),
    siteCount: field.siteCount,
    avg: field.overall.avg,
    median: field.overall.median,
    p25: field.overall.p25,
    p75: field.overall.p75,
    min: field.overall.min,
    max: field.overall.max,
    categories: Object.fromEntries(
      Object.entries(field.categories).map(([k, v]) => [
        k,
        { avg: v.avg, median: v.median, p25: v.avg, p75: v.avg },
      ])
    ),
  };
}
