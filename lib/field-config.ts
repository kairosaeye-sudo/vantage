import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import path from 'path';

/**
 * A Field is one industry in one location, plus the set of sites that make it up.
 *
 * This is the unit of configuration. Everything downstream — the benchmark, the
 * percentile, the side-by-side — is derived from a FieldConfig.
 */
export interface FieldConfig {
  /** Stable id derived from industry + location, e.g. "electricians-austin-tx". */
  slug: string;
  /** Free-form industry label, e.g. "Electricians", "Plumbers", "Dentists". */
  industry: string;
  /** Free-form location, e.g. "Austin, TX", "Denver, CO", "Remote / US". */
  location: string;
  /** Manually supplied sites. Order does not matter. */
  sites: string[];
  createdAt?: string;
  notes?: string;
}

const FIELDS_DIR = path.join(process.cwd(), 'fields');

/** "Electricians" + "Austin, TX" -> "electricians-austin-tx" */
export function slugify(industry: string, location: string): string {
  return `${industry}-${location}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function configPath(slug: string): string {
  return path.join(FIELDS_DIR, `${slug}.json`);
}

export function saveConfig(cfg: FieldConfig): string {
  if (!existsSync(FIELDS_DIR)) mkdirSync(FIELDS_DIR, { recursive: true });
  const p = configPath(cfg.slug);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

/** Accepts a slug ("electricians-austin-tx") or a path to a .json config. */
export function loadConfig(slugOrPath: string): FieldConfig {
  const p = slugOrPath.endsWith('.json') ? slugOrPath : configPath(slugOrPath);
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as FieldConfig;
  if (!cfg.slug) cfg.slug = slugify(cfg.industry, cfg.location);
  return cfg;
}

export function listConfigs(): FieldConfig[] {
  try {
    return readdirSync(FIELDS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(FIELDS_DIR, f), 'utf8')) as FieldConfig);
  } catch {
    return [];
  }
}

/**
 * Parse manually entered sites. Accepts newline- or comma-separated input, and
 * ignores blanks, comments, and duplicates so pasting a messy list just works.
 */
export function parseSites(input: string): string[] {
  const raw = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
  return [...new Set(raw)];
}

/** Read sites from a file if the path exists, otherwise treat as inline input. */
export function resolveSites(value: string): string[] {
  if (existsSync(value)) {
    return parseSites(readFileSync(value, 'utf8'));
  }
  return parseSites(value);
}

/** Minimal argument parser — avoids a dependency for a handful of flags. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
