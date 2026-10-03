/**
 * Push a locally-built field (data/field-<slug>.json) into Supabase.
 *
 * Usage: npx tsx scripts/sync-field.ts <slug>
 *   e.g. npx tsx scripts/sync-field.ts electricians-austin-tx
 */
import { readFileSync } from 'fs';
import path from 'path';
import { loadField } from '../lib/field-store';
import { saveField, listStoredFields, getFieldSites, closeDb } from '../lib/db';

function loadEnv(): void {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  loadEnv();
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) {
    console.error('Usage: npx tsx scripts/sync-field.ts <slug>');
    process.exit(1);
  }

  const field = loadField(slug);
  if (!field) {
    console.error(`No built field at data/field-${slug}.json — run build-field.ts first.`);
    process.exit(1);
  }

  // Reconstruct SiteScore-shaped rows from the stored field for persistence.
  const results = field.sites.map((s) => ({
    url: s.url,
    finalUrl: s.url,
    overall: s.overall,
    grade: s.grade as never,
    categories: Object.entries(s.categories).map(([key, score]) => ({
      key: key as never,
      label: key,
      weight: 0,
      score,
      findings: [],
    })),
    topFixes: [] as never[],
    measuredAt: field.builtAt,
    fetch: { status: 200, ttfbMs: s.ttfbMs, totalMs: s.ttfbMs, bytes: s.bytes },
    pagespeed: null,
    error: s.error,
  })) as never[];

  console.log(`\nSyncing "${slug}" to Supabase...`);
  const { fieldId, sitesWritten } = await saveField(field, results);
  console.log(`  field id : ${fieldId}`);
  console.log(`  sites    : ${sitesWritten} written`);

  const stored = await listStoredFields();
  console.log(`\n  Fields now in database (${stored.length}):`);
  for (const f of stored) {
    console.log(`    ${f.slug.padEnd(26)} ${f.industry} — ${f.location}  ${f.siteCount} sites  avg ${f.avg}`);
  }

  const sites = await getFieldSites(fieldId);
  console.log(`\n  Verified read-back of ${sites.length} sites (top 5):`);
  for (const s of sites.slice(0, 5)) {
    console.log(`    ${String(s.overall).padStart(3)}  ${s.domain}`);
  }

  await closeDb();
  console.log('\n  Done.\n');
}

main().catch(async (e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
