/**
 * Create the Vantage schema in Supabase and verify the connection.
 *
 * Usage: npx tsx scripts/init-db.ts
 *   (reads DATABASE_URL from .env.local)
 */
import { readFileSync } from 'fs';
import postgres from 'postgres';

// Minimal .env.local loader — avoids a dotenv dependency.
function loadEnv(): void {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on the real environment */
  }
}

async function main() {
  loadEnv();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Add it to .env.local');
    process.exit(1);
  }

  const host = url.match(/@([^:/]+)/)?.[1] ?? 'unknown';
  const port = url.match(/:(\d+)\/postgres/)?.[1] ?? 'unknown';
  console.log(`\nConnecting to ${host}:${port} ...`);

  const sql = postgres(url, { max: 1, connect_timeout: 12, ssl: 'require' });

  try {
    const info = await sql`SELECT current_database() AS db, version() AS v`;
    console.log(`  Connected: ${String(info[0].v).split(',')[0]}`);
    console.log(`  Database : ${info[0].db}\n`);

    console.log('  Creating schema...');

    await sql`
      CREATE TABLE IF NOT EXISTS vantage_fields (
        id            TEXT PRIMARY KEY,
        slug          TEXT UNIQUE NOT NULL,
        industry      TEXT NOT NULL,
        location      TEXT NOT NULL,
        site_count    INTEGER NOT NULL DEFAULT 0,
        failed_count  INTEGER NOT NULL DEFAULT 0,
        avg_score     INTEGER,
        median_score  INTEGER,
        p25_score     INTEGER,
        p75_score     INTEGER,
        min_score     INTEGER,
        max_score     INTEGER,
        stats         JSONB,
        built_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('    vantage_fields    ok');

    await sql`
      CREATE TABLE IF NOT EXISTS vantage_sites (
        id             TEXT PRIMARY KEY,
        field_id       TEXT REFERENCES vantage_fields(id) ON DELETE CASCADE,
        url            TEXT NOT NULL,
        domain         TEXT NOT NULL,
        business_name  TEXT,
        overall        INTEGER,
        grade          TEXT,
        categories     JSONB,
        top_fixes      JSONB,
        ttfb_ms        INTEGER,
        bytes          INTEGER,
        error          TEXT,
        scored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('    vantage_sites     ok');

    await sql`
      CREATE TABLE IF NOT EXISTS vantage_scans (
        id           TEXT PRIMARY KEY,
        url          TEXT NOT NULL,
        field_id     TEXT REFERENCES vantage_fields(id) ON DELETE SET NULL,
        overall      INTEGER,
        grade        TEXT,
        percentile   INTEGER,
        result       JSONB NOT NULL,
        email        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('    vantage_scans     ok');

    await sql`CREATE INDEX IF NOT EXISTS vantage_sites_field_idx ON vantage_sites(field_id)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_sites_domain_idx ON vantage_sites(domain)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_scans_url_idx ON vantage_scans(url)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_scans_created_idx ON vantage_scans(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_fields_slug_idx ON vantage_fields(slug)`;
    console.log('    indexes           ok');

    // Verify the tables actually exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'vantage_%'
      ORDER BY table_name
    `;
    console.log(`\n  Tables present (${tables.length}):`);
    for (const t of tables) console.log(`    - ${t.table_name}`);

    console.log('\n  Schema ready.\n');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
