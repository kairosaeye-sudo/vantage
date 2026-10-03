/**
 * Add the glow-up table.
 * Run with: npx tsx scripts/init-glowup.ts
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
    console.log('\nCreating glow-up table...\n');

    await sql`
      CREATE TABLE IF NOT EXISTS vantage_glowups (
        id            TEXT PRIMARY KEY,
        watch_id      TEXT REFERENCES vantage_watches(id) ON DELETE CASCADE,
        url           TEXT NOT NULL,
        before_score  INTEGER NOT NULL,
        after_score   INTEGER NOT NULL,
        verified_gain INTEGER NOT NULL,
        plan          JSONB,
        applied_count INTEGER NOT NULL DEFAULT 0,
        skipped       JSONB,
        files         JSONB,
        html          TEXT,
        artifacts     JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  vantage_glowups   ok');

    await sql`CREATE INDEX IF NOT EXISTS vantage_glowups_watch_idx ON vantage_glowups(watch_id, created_at DESC)`;
    console.log('  indexes           ok');

    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'vantage_%'
      ORDER BY table_name
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
