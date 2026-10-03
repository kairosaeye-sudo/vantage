/**
 * Diagnostic: show exactly which findings flipped after a glow-up.
 * Usage: npx tsx scripts/diag-glowup.ts <url>
 */
import { scoreSite } from '../lib/score-site';
import { applyGlowUp } from '../lib/glowup';
import { fetchSite } from '../lib/fetch-site';
import { extractSignals } from '../lib/signals';
import {
  scorePerformance, scoreMobile, scoreSearch, scoreTrust,
  scoreContent, scoreAiVisibility, scoreConversion, combineCategories,
} from '../lib/score';

async function main() {
  const url = process.argv[2];
  if (!url) process.exit(1);

  const before = await scoreSite(url, { skipPageSpeed: true });
  const fetched = await fetchSite(before.finalUrl);
  const res = applyGlowUp(before, fetched.html);

  const signals = await extractSignals(res.html, before.finalUrl, fetched.ttfbMs);
  const after = [
    scorePerformance(null, signals, fetched.ttfbMs, fetched.totalMs, Buffer.byteLength(res.html)),
    scoreMobile(signals),
    scoreSearch(signals),
    scoreTrust(signals, false),
    scoreContent(signals),
    scoreAiVisibility(signals),
    scoreConversion(signals),
  ];

  console.log(`\n  ${before.overall} → ${combineCategories(after)}\n`);
  console.log(`  ${'FINDING'.padEnd(34)} ${'BEFORE'.padEnd(9)} ${'AFTER'.padEnd(9)} CATEGORY`);
  console.log(`  ${'─'.repeat(74)}`);

  for (let i = 0; i < after.length; i++) {
    const b = before.categories[i];
    const a = after[i];
    const bf = new Map(b.findings.map((f) => [f.id, f]));
    for (const af of a.findings) {
      const x = bf.get(af.id);
      if (x && x.status !== af.status) {
        console.log(`  ${af.label.slice(0, 33).padEnd(34)} ${x.status.padEnd(9)} ${af.status.padEnd(9)} ${a.label}`);
      }
    }
  }

  // Anything we claimed to fix but that did not flip.
  console.log(`\n  CLAIMED BUT NOT FLIPPED:`);
  const appliedIds = new Set(res.applied.map((f) => f.findingId));
  for (let i = 0; i < after.length; i++) {
    const b = before.categories[i];
    const a = after[i];
    const bf = new Map(b.findings.map((f) => [f.id, f]));
    for (const af of a.findings) {
      const x = bf.get(af.id);
      if (appliedIds.has(af.id) && x && x.status === af.status) {
        console.log(`    · ${af.label} (${af.id}) still ${af.status} in ${a.label}`);
      }
    }
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
