/**
 * Build a Field — an industry benchmark for one location.
 *
 * Usage:
 *   # From a saved config
 *   npx tsx scripts/build-field.ts --config electricians-austin-tx
 *
 *   # Ad hoc: any industry, any location, sites from a file or inline
 *   npx tsx scripts/build-field.ts --industry "Plumbers" --location "Austin, TX" --sites plumbers.txt
 *   npx tsx scripts/build-field.ts --industry "Dentists" --location "Denver, CO" \
 *       --sites "https://a.com, https://b.com, https://c.com"
 *
 * Flags:
 *   --config <slug|path>   load industry/location/sites from a saved config
 *   --industry <name>      industry label (required unless --config)
 *   --location <place>     location label (required unless --config)
 *   --sites <file|list>    site URLs: a file path, or comma/newline separated
 *   --save-config          persist the config to fields/<slug>.json for reuse
 *   --no-pagespeed         skip PageSpeed Insights (faster; render metrics unmeasured)
 *   --append <file|list>   add more sites to an existing config
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { scoreSite } from '../lib/score-site';
import { gradeFor } from '../lib/score';
import type { SiteScore } from '../lib/types';
import {
  type FieldConfig,
  loadConfig,
  saveConfig,
  slugify,
  resolveSites,
  parseArgs,
} from '../lib/field-config';

const DATA_DIR = path.join(process.cwd(), 'data');

function buildConfig(args: Record<string, string | boolean>): FieldConfig {
  if (typeof args.config === 'string') {
    const cfg = loadConfig(args.config);
    if (typeof args.append === 'string') {
      const extra = resolveSites(args.append);
      cfg.sites = [...new Set([...cfg.sites, ...extra])];
    }
    return cfg;
  }

  const industry = typeof args.industry === 'string' ? args.industry : '';
  const location = typeof args.location === 'string' ? args.location : '';
  if (!industry || !location) {
    console.error('Need --industry and --location (or --config <slug>).');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/build-field.ts --config electricians-austin-tx');
    console.error('  npx tsx scripts/build-field.ts --industry "Plumbers" --location "Austin, TX" --sites plumbers.txt');
    process.exit(1);
  }

  const sites = typeof args.sites === 'string' ? resolveSites(args.sites) : [];
  if (sites.length === 0) {
    console.error('No sites supplied. Pass --sites <file|comma-separated-list>.');
    process.exit(1);
  }

  return {
    slug: slugify(industry, location),
    industry,
    location,
    sites,
    createdAt: new Date().toISOString(),
  };
}

function statsOf(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return {
    avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    median: at(0.5),
    min: s[0],
    max: s[s.length - 1],
    p25: at(0.25),
    p75: at(0.75),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const skipPageSpeed = args['no-pagespeed'] === true;
  const cfg = buildConfig(args);

  console.log('');
  console.log(`  Industry : ${cfg.industry}`);
  console.log(`  Location : ${cfg.location}`);
  console.log(`  Sites    : ${cfg.sites.length}`);
  console.log(`  Slug     : ${cfg.slug}`);
  console.log(`  PageSpeed: ${skipPageSpeed ? 'skipped' : 'enabled'}`);
  console.log('');

  if (args['save-config'] === true) {
    const p = saveConfig(cfg);
    console.log(`  Saved config -> ${path.relative(process.cwd(), p)}\n`);
  }

  const results: SiteScore[] = [];
  for (let i = 0; i < cfg.sites.length; i++) {
    const u = cfg.sites[i];
    process.stdout.write(`  [${i + 1}/${cfg.sites.length}] ${u} ... `);
    try {
      const s = await scoreSite(u, { skipPageSpeed });
      results.push(s);
      console.log(s.error ? `ERROR (${s.error})` : `${s.overall}/100`);
    } catch (e) {
      console.log(`THREW (${e instanceof Error ? e.message : e})`);
    }
  }

  const ok = results.filter((r) => !r.error);
  if (ok.length === 0) {
    console.error('\n  No sites scored successfully. Check the URLs.\n');
    process.exit(1);
  }

  const categoryStats: Record<string, ReturnType<typeof statsOf>> = {};
  for (const key of ok[0].categories.map((c) => c.key)) {
    const vals = ok.map((r) => r.categories.find((c) => c.key === key)?.score ?? 0);
    categoryStats[key] = statsOf(vals);
  }

  const overalls = ok.map((r) => r.overall);
  const field = {
    slug: cfg.slug,
    industry: cfg.industry,
    location: cfg.location,
    builtAt: new Date().toISOString(),
    siteCount: ok.length,
    failedCount: results.length - ok.length,
    pagespeed: !skipPageSpeed,
    overall: statsOf(overalls),
    categories: categoryStats,
    distribution: {
      elite: overalls.filter((s) => gradeFor(s) === 'elite').length,
      strong: overalls.filter((s) => gradeFor(s) === 'strong').length,
      developing: overalls.filter((s) => gradeFor(s) === 'developing').length,
      critical: overalls.filter((s) => gradeFor(s) === 'critical').length,
    },
    sites: results.map((r) => ({
      url: r.finalUrl,
      overall: r.overall,
      grade: r.grade,
      error: r.error,
      categories: Object.fromEntries(r.categories.map((c) => [c.key, c.score])),
      topFixes: r.topFixes.map((f) => f.label),
      ttfbMs: r.fetch.ttfbMs,
      bytes: r.fetch.bytes,
    })),
  };

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const outPath = path.join(DATA_DIR, `field-${cfg.slug}.json`);
  writeFileSync(outPath, JSON.stringify(field, null, 2));

  console.log('\n' + '═'.repeat(70));
  console.log(`${cfg.industry.toUpperCase()} — ${cfg.location}`);
  console.log('═'.repeat(70));
  console.log(`Sites scored: ${field.siteCount}  (failed: ${field.failedCount})`);
  console.log(`\nOverall  avg ${field.overall.avg}  median ${field.overall.median}  range ${field.overall.min}–${field.overall.max}`);
  console.log(`         p25 ${field.overall.p25}   p75 ${field.overall.p75}`);
  console.log(`\nDistribution:`);
  console.log(`  Elite (80+):        ${field.distribution.elite}`);
  console.log(`  Strong (60-79):     ${field.distribution.strong}`);
  console.log(`  Developing (35-59): ${field.distribution.developing}`);
  console.log(`  Critical (<35):     ${field.distribution.critical}`);
  console.log(`\nCategory averages:`);
  for (const [k, v] of Object.entries(categoryStats)) {
    console.log(`  ${k.padEnd(14)} avg ${String(v.avg).padStart(3)}  median ${String(v.median).padStart(3)}  range ${v.min}–${v.max}`);
  }
  console.log(`\nWrote ${path.relative(process.cwd(), outPath)}`);
  console.log('═'.repeat(70) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
