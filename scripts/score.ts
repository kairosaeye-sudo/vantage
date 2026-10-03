/**
 * CLI harness: score real websites and print the results.
 * Usage: npx tsx scripts/score.ts <url> [url2] ...
 *        npx tsx scripts/score.ts --file scripts/urls.txt
 */
import { scoreSite } from '../lib/score-site';
import { percentileAgainst } from '../lib/score';
import type { SiteScore } from '../lib/types';
import { readFileSync } from 'fs';

function bar(score: number, width = 24): string {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function gradeTag(g: string): string {
  return { elite: 'ELITE', strong: 'STRONG', developing: 'DEVELOPING', critical: 'CRITICAL' }[g] ?? g;
}

function printSite(s: SiteScore, fieldScores: number[]): void {
  console.log('\n' + '═'.repeat(72));
  console.log(`${s.finalUrl}`);
  console.log('═'.repeat(72));

  if (s.error) {
    console.log(`  ERROR: ${s.error}`);
    return;
  }

  const pct = percentileAgainst(s.overall, fieldScores);
  console.log(`\n  OVERALL  ${s.overall}/100  [${gradeTag(s.grade)}]   ${bar(s.overall)}`);
  console.log(`  Percentile in field: ${pct}th`);
  console.log(`  Fetched: HTTP ${s.fetch.status} · TTFB ${s.fetch.ttfbMs}ms · total ${s.fetch.totalMs}ms · ${Math.round(s.fetch.bytes / 1024)}KB`);
  if (s.pagespeed?.ok && s.pagespeed.performanceScore !== null) {
    console.log(`  Lighthouse perf: ${s.pagespeed.performanceScore}/100 · LCP ${s.pagespeed.lcpMs ? (s.pagespeed.lcpMs / 1000).toFixed(2) + 's' : 'n/a'} · CLS ${s.pagespeed.cls?.toFixed(3) ?? 'n/a'}`);
  } else if (s.pagespeed?.error) {
    console.log(`  Lighthouse: unavailable (${s.pagespeed.error})`);
  }

  console.log('\n  CATEGORIES');
  for (const c of s.categories) {
    const label = c.label.padEnd(20);
    console.log(`    ${label} ${String(c.score).padStart(3)}/100  ${bar(c.score, 18)}  (weight ${Math.round(c.weight * 100)}%)`);
  }

  console.log('\n  TOP FIXES');
  s.topFixes.forEach((f, i) => {
    const tag = f.status === 'fail' ? 'FAIL' : 'WARN';
    console.log(`    ${i + 1}. [${tag}] ${f.label}`);
    console.log(`       ${f.detail}`);
  });
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  let urls: string[] = [];

  if (args[0] === '--file') {
    const content = readFileSync(args[1], 'utf8');
    urls = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } else {
    urls = args.filter((a) => !a.startsWith('--'));
  }

  if (urls.length === 0) {
    console.error('Usage: npx tsx scripts/score.ts <url> [url2] ...');
    console.error('       npx tsx scripts/score.ts --file scripts/urls.txt');
    process.exit(1);
  }

  const skipPs = args.includes('--no-pagespeed');
  console.log(`Scoring ${urls.length} site(s)${skipPs ? ' (PageSpeed skipped)' : ''}...\n`);

  const results: SiteScore[] = [];
  for (const u of urls) {
    process.stdout.write(`  → ${u} ... `);
    const s = await scoreSite(u, { skipPageSpeed: skipPs });
    results.push(s);
    console.log(s.error ? `ERROR (${s.error})` : `${s.overall}/100`);
  }

  const fieldScores = results.filter((r) => !r.error).map((r) => r.overall);

  for (const s of results) printSite(s, fieldScores);

  // Field summary
  const ok = results.filter((r) => !r.error);
  if (ok.length > 1) {
    const avg = Math.round(fieldScores.reduce((a, b) => a + b, 0) / fieldScores.length);
    const sorted = [...fieldScores].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log('═'.repeat(72));
    console.log(`FIELD SUMMARY — ${ok.length} sites scored`);
    console.log(`  Average: ${avg}/100   Median: ${median}/100   Range: ${sorted[0]}–${sorted[sorted.length - 1]}`);
    console.log(`  Field average is the benchmark every customer is measured against.`);
    console.log('═'.repeat(72) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
