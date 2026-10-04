/**
 * Add the preview table used to render before/after glow-up previews.
 * Run with: npx tsx scripts/init-preview.ts
 */
import { readFileSync } from 'fs';
import postgres from 'postgres';

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
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, connect_timeout: 12, ssl: 'require' });

  try {
    console.log('\nCreating preview table...\n');
    await sql`
      CREATE TABLE IF NOT EXISTS vantage_previews (
        id           TEXT PRIMARY KEY,
        before_html  TEXT NOT NULL,
        after_html   TEXT NOT NULL,
        files        JSONB,
        url          TEXT NOT NULL,
        before_score INTEGER NOT NULL,
        after_score  INTEGER NOT NULL,
        fixes        JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  vantage_previews  ok');

    // Existing installs predate the `fixes` column.
    await sql`ALTER TABLE vantage_previews ADD COLUMN IF NOT EXISTS fixes JSONB`;
    console.log('  fixes column      ok');
    // Redesign previews share the table; `kind` separates them from glow-ups.
    await sql`ALTER TABLE vantage_previews ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'glowup'`;
    await sql`ALTER TABLE vantage_previews ADD COLUMN IF NOT EXISTS redesign JSONB`;
    // The redesigned page is a third view alongside before/after.
    await sql`ALTER TABLE vantage_previews ADD COLUMN IF NOT EXISTS redesigned_html TEXT`;
    // Whether a field was auto-detected for this glow-up.
    await sql`ALTER TABLE vantage_previews ADD COLUMN IF NOT EXISTS field_detected BOOLEAN NOT NULL DEFAULT false`;
    console.log('  redesign columns  ok');

    await sql`CREATE INDEX IF NOT EXISTS vantage_previews_created_idx ON vantage_previews(created_at DESC)`;
    console.log('  indexes           ok');

    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'vantage_%' ORDER BY table_name
    `;
    console.log(`\n  Tables (${tables.length}):`);
    for (const t of tables) console.log(`    - ${t.table_name}`);
    console.log('\n  Ready.\n');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
