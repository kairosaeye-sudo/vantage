/**
 * Score one site against a built field.
 *
 * Usage: npx tsx scripts/compare.ts <url> <field-slug> [--no-pagespeed]
 *   e.g. npx tsx scripts/compare.ts https://example.com electricians-austin-tx
 *
 * Run `npx tsx scripts/list-fields.ts` to see available fields.
 */
import { scoreSite } from '../lib/score-site';
import { loadField, fieldToPeers, fieldLabel } from '../lib/field-store';
import { buildSideBySide } from '../lib/compare';
import { parseArgs } from '../lib/field-config';

const BAR = (n: number, w = 20) => '█'.repeat(Math.round((n / 100) * w)).padEnd(w, '░');

function verdictTag(v: string) {
  return { leading: 'LEADING', above: 'ABOVE', below: 'BELOW', lagging: 'LAGGING' }[v] ?? v;
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const args = parseArgs(process.argv.slice(2));
  const [url, fieldName] = positional;

  if (!url || !fieldName) {
    console.error('Usage: npx tsx scripts/compare.ts <url> <field-slug> [--no-pagespeed]');
    console.error('  e.g. npx tsx scripts/compare.ts https://example.com electricians-austin-tx');
    process.exit(1);
  }

  const field = loadField(fieldName);
  if (!field) {
    console.error(`Field "${fieldName}" not found. Looked for data/field-${fieldName}.json`);
    console.error('Run `npx tsx scripts/list-fields.ts` to see what exists.');
    process.exit(1);
  }

  const label = `${field.industry ?? field.vertical} — ${field.location ?? 'unknown location'}`;
  console.log(`\nScoring ${url}`);
  console.log(`Against: ${label} (${field.siteCount} sites)\n`);

  const you = await scoreSite(url, { skipPageSpeed: args['no-pagespeed'] === true });
  if (you.error) {
    console.error(`Could not score ${url}: ${you.error}`);
    process.exit(1);
  }

  const peers = fieldToPeers(field);
  const sbs = buildSideBySide(you, peers, fieldLabel(field));

  console.log('═'.repeat(76));
  console.log(`${sbs.you.url}`);
  console.log(`vs ${label}`);
  console.log('═'.repeat(76));
  console.log(`\n  ${sbs.you.overall}/100  [${sbs.you.grade.toUpperCase()}]  ${BAR(sbs.you.overall)}`);
  console.log(`  ${sbs.headline}\n`);

  console.log('  SIDE BY SIDE');
  console.log(`  ${'Category'.padEnd(20)} ${'You'.padStart(4)} ${'Field'.padStart(6)} ${'Leader'.padStart(7)}  ${'Δ'.padStart(5)}  Verdict`);
  console.log('  ' + '─'.repeat(70));
  for (const r of sbs.rows) {
    const d = (r.delta > 0 ? '+' : '') + r.delta;
    console.log(
      `  ${r.label.padEnd(20)} ${String(r.you).padStart(4)} ${String(r.fieldAvg).padStart(6)} ${String(r.leader).padStart(7)}  ${d.padStart(5)}  ${verdictTag(r.verdict)}`
    );
  }

  console.log(`\n  FIELD: ${label} — avg ${sbs.field.avg}, median ${sbs.field.median}, range ${sbs.field.min}–${sbs.field.max}`);

  console.log('\n  RECOMMENDED FIXES (ranked by score impact)');
  console.log('  ' + '─'.repeat(70));
  for (const r of sbs.recommendations) {
    const tag = r.finding.status === 'fail' ? 'FAIL' : 'WARN';
    console.log(`\n  ${r.rank}. [+${r.scoreGain} pts] [${tag}] ${r.finding.label}  (${r.category})`);
    console.log(`     Now: ${r.finding.detail}`);
    console.log(`     Why: ${r.businessCase}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
