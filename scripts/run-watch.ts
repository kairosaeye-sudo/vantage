/**
 * Run a monitoring watch.
 *
 * Usage:
 *   npx tsx scripts/run-watch.ts --create --email me@x.com --site https://mysite.com --field electricians-austin-tx
 *   npx tsx scripts/run-watch.ts --list
 *   npx tsx scripts/run-watch.ts --run <watchId>
 *   npx tsx scripts/run-watch.ts --run-due
 *   npx tsx scripts/run-watch.ts --alerts <watchId>
 *   npx tsx scripts/run-watch.ts --simulate-regression <watchId>
 */
import { readFileSync } from 'fs';
import { createWatch, runWatch, dueWatches, watchAlerts, type WatchRow } from '../lib/monitor';
import { db, closeDb } from '../lib/db';
import { parseArgs } from '../lib/field-config';

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

const SEV_COLOR: Record<string, string> = {
  critical: '\x1b[31m',
  warning: '\x1b[33m',
  positive: '\x1b[32m',
  info: '\x1b[90m',
};
const RESET = '\x1b[0m';

function report(r: Awaited<ReturnType<typeof runWatch>>) {
  console.log(`\n${'═'.repeat(74)}`);
  console.log(`  ${r.siteUrl}`);
  console.log(`${'═'.repeat(74)}\n`);

  const delta =
    r.previousScore === null
      ? 'first scan'
      : `${r.previousScore} → ${r.score} (${r.score - r.previousScore >= 0 ? '+' : ''}${r.score - r.previousScore})`;
  console.log(`  Score      ${r.score}/100  [${r.grade}]   ${delta}`);
  console.log(`  Rank       ${r.rank} of ${r.stayAhead.field.siteCount}`);
  console.log(`  Headline   ${r.stayAhead.headline}`);

  if (r.diff) {
    console.log(`\n  CHANGE  ${r.diff.summary}`);
    for (const c of r.diff.regressions) {
      console.log(`    ${SEV_COLOR.critical}▼ ${c.label}${RESET}  ${c.from} → ${c.to}  (${c.category})`);
    }
    for (const c of r.diff.improvements) {
      console.log(`    ${SEV_COLOR.positive}▲ ${c.label}${RESET}  ${c.from} → ${c.to}  (${c.category})`);
    }
  } else {
    console.log(`\n  CHANGE  none — this is the baseline run.`);
  }

  if (r.overtakes.length > 0) {
    console.log(`\n  ${SEV_COLOR.critical}OVERTAKEN${RESET}`);
    for (const o of r.overtakes) {
      console.log(`    ${o.overtaker}  ${o.overtakerScore} vs your ${o.overtakenScore}  (+${o.delta})`);
    }
  }

  console.log(`\n  STAY AHEAD PLAN`);
  for (const a of r.stayAhead.advice.slice(0, 4)) {
    const tag = a.kind.toUpperCase().padEnd(8);
    const color = a.kind === 'defend' ? SEV_COLOR.critical : a.kind === 'attack' ? SEV_COLOR.warning : SEV_COLOR.positive;
    console.log(`\n    ${color}${tag}${RESET} ${a.title}`);
    console.log(`             ${a.you} vs field ${a.fieldAvg} (best ${a.leader})` + (a.upside > 0 ? `  +${a.upside} pts available` : ''));
    for (const act of a.actions.slice(0, 2)) console.log(`             · ${act}`);
  }

  console.log(`\n  Alerts created: ${r.alertsCreated}${r.failed.length ? `   Failed: ${r.failed.length}` : ''}`);
  console.log('');
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.create) {
    const id = await createWatch({
      email: String(args.email ?? 'test@example.com'),
      siteUrl: String(args.site ?? ''),
      fieldSlug: String(args.field ?? ''),
      cadence: String(args.cadence ?? 'weekly'),
    });
    console.log(`\n  Watch created: ${id}\n`);
  }

  if (args.list) {
    const sql = db();
    const rows = await sql<WatchRow[]>`
      SELECT id, email, site_url, field_id, field_slug, plan, cadence FROM vantage_watches ORDER BY created_at DESC
    `;
    console.log(`\n  WATCHES (${rows.length})\n`);
    for (const w of rows) {
      console.log(`    ${w.id}`);
      console.log(`      ${w.site_url}  vs  ${w.field_slug}  [${w.plan}/${w.cadence}]  ${w.email}`);
    }
    console.log('');
  }

  if (args['run-due']) {
    const due = await dueWatches(5);
    console.log(`\n  ${due.length} watch(es) due`);
    for (const w of due) {
      const r = await runWatch(w);
      report(r);
    }
  } else if (args.run) {
    const sql = db();
    const rows = await sql<WatchRow[]>`
      SELECT id, email, site_url, field_id, field_slug, plan, cadence
      FROM vantage_watches WHERE id = ${String(args.run)} LIMIT 1
    `;
    if (rows.length === 0) {
      console.error('Watch not found');
      process.exit(1);
    }
    report(await runWatch(rows[0]));
  }

  if (args.alerts) {
    const a = await watchAlerts(String(args.alerts), 15);
    console.log(`\n  ALERTS (${a.length})\n`);
    for (const x of a) {
      const c = SEV_COLOR[String(x.severity)] ?? '';
      console.log(`    ${c}[${String(x.severity).toUpperCase()}]${RESET} ${x.title}`);
      console.log(`      ${String(x.body).slice(0, 120)}`);
    }
    console.log('');
  }

  // Prove the diff engine detects real change: take the most recent snapshot,
  // pretend a previously-passing check had failed, and re-run. A regression
  // alert must appear.
  if (args['simulate-regression']) {
    const sql = db();
    const wid = String(args['simulate-regression']);
    const snap = await sql<Array<{ id: string; score: unknown }>>`
      SELECT id, score FROM vantage_snapshots
      WHERE watch_id = ${wid} AND is_self = TRUE
      ORDER BY captured_at DESC LIMIT 1
    `;
    if (snap.length === 0) {
      console.error('No snapshot to modify');
      process.exit(1);
    }
    const score = snap[0].score as Record<string, unknown>;
    const cats = score.categories as Array<{ key: string; findings: Array<{ id: string; status: string }> }>;

    // Downgrade every currently-passing finding to a fail, and drop the score,
    // so the next run has something real to detect.
    let flipped = 0;
    for (const c of cats) {
      for (const f of c.findings) {
        if (f.status === 'pass') {
          f.status = 'fail';
          flipped++;
        }
      }
    }
    const before = Number(score.overall);
    score.overall = Math.max(0, before - 15);

    await sql`
      UPDATE vantage_snapshots SET score = ${sql.json(score as never)}, overall = ${Number(score.overall)}
      WHERE id = ${snap[0].id}
    `;
    console.log(`\n  Simulated regression: flipped ${flipped} passing checks to fail, overall ${before} → ${score.overall}`);
    console.log(`  Re-run the watch to see it detected.\n`);
  }

  await closeDb();
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
