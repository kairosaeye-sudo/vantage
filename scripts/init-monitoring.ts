/**
 * Monitoring schema.
 *
 * Run with: npx tsx scripts/init-monitoring.ts
 *
 * Design notes:
 *  - `vantage_watches` is the subscription: one customer site + the field it is
 *    watched against. `plan` gates what the customer can see.
 *  - `vantage_snapshots` stores a full score per site per run. Storing the whole
 *    SiteScore (as JSONB) rather than just the number is what makes finding-level
 *    diffing possible later — we can say exactly which check flipped.
 *  - `vantage_alerts` dedupes: a regression that persists across runs must not
 *    email the customer every single time.
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
    console.log('\nCreating monitoring schema...\n');

    // The subscription.
    await sql`
      CREATE TABLE IF NOT EXISTS vantage_watches (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        site_url      TEXT NOT NULL,
        field_id      TEXT REFERENCES vantage_fields(id) ON DELETE SET NULL,
        field_slug    TEXT NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'watch',
        status        TEXT NOT NULL DEFAULT 'active',
        cadence       TEXT NOT NULL DEFAULT 'weekly',
        last_run_at   TIMESTAMPTZ,
        next_run_at   TIMESTAMPTZ,
        last_score    INTEGER,
        last_grade    TEXT,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  vantage_watches    ok');

    // Every scored site in every run.
    await sql`
      CREATE TABLE IF NOT EXISTS vantage_snapshots (
        id           TEXT PRIMARY KEY,
        watch_id     TEXT REFERENCES vantage_watches(id) ON DELETE CASCADE,
        field_id     TEXT REFERENCES vantage_fields(id) ON DELETE SET NULL,
        run_id       TEXT NOT NULL,
        url          TEXT NOT NULL,
        domain       TEXT NOT NULL,
        is_self      BOOLEAN NOT NULL DEFAULT FALSE,
        overall      INTEGER,
        grade        TEXT,
        categories   JSONB,
        findings     JSONB,
        score        JSONB,
        error        TEXT,
        captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  vantage_snapshots  ok');

    // Notifications, deduped by (watch, fingerprint).
    await sql`
      CREATE TABLE IF NOT EXISTS vantage_alerts (
        id            TEXT PRIMARY KEY,
        watch_id      TEXT REFERENCES vantage_watches(id) ON DELETE CASCADE,
        fingerprint   TEXT NOT NULL,
        severity      TEXT NOT NULL,
        kind          TEXT NOT NULL,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL,
        payload       JSONB,
        emailed_at    TIMESTAMPTZ,
        seen_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (watch_id, fingerprint)
      )
    `;
    console.log('  vantage_alerts     ok');

    // Monthly reports.
    await sql`
      CREATE TABLE IF NOT EXISTS vantage_reports (
        id           TEXT PRIMARY KEY,
        watch_id     TEXT REFERENCES vantage_watches(id) ON DELETE CASCADE,
        period_start TIMESTAMPTZ NOT NULL,
        period_end   TIMESTAMPTZ NOT NULL,
        score_start  INTEGER,
        score_end    INTEGER,
        summary      TEXT,
        body         JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  vantage_reports    ok');

    await sql`CREATE INDEX IF NOT EXISTS vantage_watches_next_idx ON vantage_watches(next_run_at) WHERE status = 'active'`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_watches_email_idx ON vantage_watches(email)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_snapshots_watch_idx ON vantage_snapshots(watch_id, captured_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_snapshots_run_idx ON vantage_snapshots(run_id)`;
    await sql`CREATE INDEX IF NOT EXISTS vantage_alerts_watch_idx ON vantage_alerts(watch_id, created_at DESC)`;
    console.log('  indexes            ok');

    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'vantage_%'
      ORDER BY table_name
    `;
    console.log(`\n  Tables (${tables.length}):`);
    for (const t of tables) console.log(`    - ${t.table_name}`);
    console.log('\n  Monitoring schema ready.\n');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
