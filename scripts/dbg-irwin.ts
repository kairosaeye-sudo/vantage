import { readFileSync } from 'fs';
import { db } from '../lib/db';

function loadEnv(): void {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}

async function main(): Promise<void> {
  loadEnv();
  const sql = db();
  const rows = await sql`
    SELECT url, overall, created_at
    FROM vantage_scans
    WHERE url ILIKE '%irwinelectric%'
    ORDER BY created_at DESC
    LIMIT 20
  `;
  console.log(`vantage_scans rows for irwinelectric: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.created_at}  overall=${r.overall}  ${r.url}`);

  // Any table holding before/after for this site
  const prev = await sql`
    SELECT url, before_score, after_score, created_at
    FROM vantage_previews
    WHERE url ILIKE '%irwinelectric%'
    ORDER BY created_at DESC LIMIT 20
  `;
  console.log(`\nvantage_previews rows: ${prev.length}`);
  for (const r of prev) console.log(`  ${r.created_at}  before=${r.before_score} after=${r.after_score}  ${r.url}`);
}
main().catch(e => { console.error(e); process.exit(1); });
