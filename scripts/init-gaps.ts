import { readFileSync } from 'fs';
import { db } from '../lib/db';

// Minimal .env.local loader — avoids a dotenv dependency.
function loadEnv(): void {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env.local — rely on the real environment.
  }
}

async function main(): Promise<void> {
  loadEnv();
  const sql = db();

  await sql`
    CREATE TABLE IF NOT EXISTS vantage_field_gaps (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      industry TEXT,
      city TEXT,
      region TEXT,
      location_source TEXT,
      evidence TEXT,
      suggested_slug TEXT,
      hits INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notified BOOLEAN NOT NULL DEFAULT false
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS vantage_field_gaps_last_seen_idx
    ON vantage_field_gaps(last_seen_at DESC)
  `;

  console.log('vantage_field_gaps table ready');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
