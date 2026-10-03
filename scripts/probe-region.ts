/**
 * Discover which Supabase pooler region this project lives in.
 *
 * Tries each candidate pooler host with the real credentials and reports which
 * one authenticates. Prints ONLY the region name — never the password or the
 * connection string.
 *
 * Usage: npx tsx scripts/probe-region.ts
 */
import { readFileSync } from 'fs';
import postgres from 'postgres';

const PROJECT_REF = 'fdbzdelubyyugosgbmrq';

function loadPassword(): string {
  // Read from env if present, else from the scratch file written alongside.
  if (process.env.SUPABASE_DB_PASSWORD) return process.env.SUPABASE_DB_PASSWORD;
  const p = process.env.PROBE_PW_FILE ?? '';
  if (p) return readFileSync(p, 'utf8').trim();
  throw new Error('No password available (set SUPABASE_DB_PASSWORD or PROBE_PW_FILE)');
}

const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-central-1',
  'eu-west-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'sa-east-1',
];

async function tryRegion(region: string, password: string): Promise<{ region: string; ok: boolean; note: string }> {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const url = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${host}:6543/postgres`;

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    sql = postgres(url, {
      max: 1,
      connect_timeout: 8,
      idle_timeout: 1,
      ssl: 'require',
    });
    const rows = await sql`SELECT current_database() AS db, version() AS v`;
    const v = String(rows[0]?.v ?? '');
    const short = v.match(/PostgreSQL\s+[\d.]+/)?.[0] ?? 'connected';
    await sql.end();
    return { region, ok: true, note: short };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (sql) {
      try {
        await sql.end();
      } catch {
        /* ignore */
      }
    }
    // Distinguish "wrong region" from "right region, bad password".
    const note = /tenant|not found|ENOTFOUND|getaddrinfo|no such host/i.test(msg)
      ? 'no such tenant'
      : /password|authentication|SASL|credentials/i.test(msg)
        ? 'AUTH FAILED (region likely correct)'
        : /timeout|ETIMEDOUT|ECONNREFUSED/i.test(msg)
          ? 'timeout'
          : msg.slice(0, 60);
    return { region, ok: false, note };
  }
}

async function main() {
  const password = loadPassword();
  console.log(`\nProbing ${REGIONS.length} pooler regions for project ${PROJECT_REF}...\n`);

  const results = [];
  for (const r of REGIONS) {
    process.stdout.write(`  ${r.padEnd(16)} ... `);
    const res = await tryRegion(r, password);
    results.push(res);
    console.log(res.ok ? `CONNECTED  (${res.note})` : res.note);
  }

  const winners = results.filter((r) => r.ok);
  const authFail = results.filter((r) => !r.ok && r.note.includes('AUTH FAILED'));

  console.log('');
  if (winners.length > 0) {
    console.log(`  RESULT: project is in ${winners.map((w) => w.region).join(', ')}`);
  } else if (authFail.length > 0) {
    console.log(`  RESULT: reached the tenant in ${authFail.map((w) => w.region).join(', ')} but the password was rejected.`);
    console.log(`          The password may be wrong, or it may not have been reset since project creation.`);
  } else {
    console.log('  RESULT: no region matched. The project ref may be wrong, or the project is paused.');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
