/**
 * Prove the glow-up works: score a site, apply fixes, re-score, compare.
 *
 * This is the only honest way to claim the score improves — the rebuilt HTML is
 * fed back through the same scoring engine as the original.
 *
 * Usage:
 *   npx tsx scripts/test-glowup.ts <url> [--save]
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { scoreSite } from '../lib/score-site';
import { planGlowUp, applyGlowUp } from '../lib/glowup';
import { fetchSite } from '../lib/fetch-site';
import { extractSignals } from '../lib/signals';
import { combineCategories, gradeFor } from '../lib/score';

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const save = args.includes('--save');

  if (!url) {
    console.error('Usage: npx tsx scripts/test-glowup.ts <url> [--save]');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(74)}`);
  console.log(`  GLOW-UP TEST — ${url}`);
  console.log(`${'═'.repeat(74)}\n`);

  // 1. Score the original.
  const before = await scoreSite(url, { skipPageSpeed: true });
  if (before.error) {
    console.error(`  Could not fetch: ${before.error}`);
    process.exit(1);
  }
  console.log(`  BEFORE   ${before.overall}/100  [${before.grade}]`);

  // 2. Plan and apply.
  const plan = planGlowUp(before);
  console.log(`\n  PLAN — ${plan.fixes.length} fixable, ${plan.needsWork.length} not fixable here`);
  console.log(`  Estimated: ${plan.beforeScore} → ${plan.estimatedScore} (+${plan.estimatedGain})\n`);

  for (const f of plan.fixes.slice(0, 12)) {
    console.log(`    +${String(f.points).padStart(4)}  ${f.label}  [${f.category}]`);
  }
  if (plan.needsWork.length > 0) {
    console.log(`\n  NOT FIXABLE IN A REBUILD:`);
    for (const n of plan.needsWork.slice(0, 8)) {
      console.log(`    · ${n.label} — ${n.reason}`);
    }
  }

  // 3. Rebuild the HTML.
  const fetched = await fetchSite(before.finalUrl);
  const result = applyGlowUp(before, fetched.html);
  console.log(`\n  APPLIED ${result.applied.length} fixes (+${result.appliedPoints} est. points)`);
  if (result.skipped.length > 0) {
    console.log(`  SKIPPED ${result.skipped.length}:`);
    for (const s of result.skipped) console.log(`    · ${s.findingId}: ${s.reason}`);
  }

  // 4. Re-score the REBUILT html through the real engine.
  const signals = await extractSignals(result.html, before.finalUrl, fetched.ttfbMs);
  const cats = [
    (await import('../lib/score')).scorePerformance(null, signals, fetched.ttfbMs, fetched.totalMs, Buffer.byteLength(result.html)),
    (await import('../lib/score')).scoreMobile(signals),
    (await import('../lib/score')).scoreSearch(signals),
    (await import('../lib/score')).scoreTrust(signals, false),
    (await import('../lib/score')).scoreContent(signals),
    (await import('../lib/score')).scoreAiVisibility(signals),
    (await import('../lib/score')).scoreConversion(signals),
  ];
  const afterOverall = combineCategories(cats);
  const afterGrade = gradeFor(afterOverall);

  console.log(`\n${'─'.repeat(74)}`);
  console.log(`  AFTER    ${afterOverall}/100  [${afterGrade}]`);
  const delta = afterOverall - before.overall;
  console.log(`  CHANGE   ${delta >= 0 ? '+' : ''}${delta} points`);
  console.log(`  ESTIMATE was +${plan.estimatedGain} — ${Math.abs(delta - plan.estimatedGain) <= 8 ? 'ACCURATE' : 'OFF by ' + Math.abs(delta - plan.estimatedGain)}`);
  console.log(`${'─'.repeat(74)}\n`);

  console.log('  BY CATEGORY');
  for (let i = 0; i < cats.length; i++) {
    const b = before.categories[i];
    const a = cats[i];
    if (!b) continue;
    const d = a.score - b.score;
    const bar = d > 0 ? `▲ +${d}` : d < 0 ? `▼ ${d}` : '—';
    console.log(`    ${b.label.padEnd(22)} ${String(b.score).padStart(3)} → ${String(a.score).padStart(3)}   ${bar}`);
  }

  if (save) {
    const dir = path.join(process.cwd(), 'glowup-output');
    mkdirSync(dir, { recursive: true });
    const slug = before.finalUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
    writeFileSync(path.join(dir, `${slug}.html`), result.html);
    for (const [name, content] of Object.entries(result.files)) {
      writeFileSync(path.join(dir, `${slug}.${name}`), content);
    }
    writeFileSync(path.join(dir, `${slug}.plan.json`), JSON.stringify({ plan, delta, afterOverall }, null, 2));
    console.log(`\n  Saved to glowup-output/${slug}.*\n`);
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
