import { readFileSync } from 'fs';
import { fetchSite } from '../lib/fetch-site';
import { detectFieldWithMeta } from '../lib/field-detect';
import { guessIndustry } from '../lib/industry-guess';

function loadEnv(): void {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

async function main(): Promise<void> {
  loadEnv();
  for (const url of process.argv.slice(2)) {
    try {
      const { html } = await fetchSite(url);
      const f = await detectFieldWithMeta(html);
      const ind = guessIndustry(html);
      console.log(`${url}`);
      console.log(`  field: ${f.fieldSlug ?? 'NONE'} (score ${f.score})`);
      console.log(`  location: ${f.detectedCity ?? '-'}, ${f.detectedRegion ?? '-'} [${f.locationSource}]`);
      console.log(`  industry guess: ${ind.industry ?? 'NONE'} (strength ${ind.strength}, "${ind.evidence}")`);
      console.log();
    } catch (e) {
      console.log(`${url}\n  ERROR: ${e instanceof Error ? e.message : e}\n`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
