import { readFileSync } from 'fs';
import { db } from '../lib/db';

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
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local not found
  }
}

loadEnv();

const sql = db();

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS vantage_progress (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      message TEXT NOT NULL,
      percent INTEGER NOT NULL DEFAULT 0,
      metadata JSONB DEFAULT '{}',
      stage_history JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Add stage_history column if it doesn't exist (idempotent migration)
  await sql`
    ALTER TABLE vantage_progress
    ADD COLUMN IF NOT EXISTS stage_history JSONB DEFAULT '[]'
  `;
  console.log('vantage_progress table ready');
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
