/**
 * Why does the redesign lose points? Show the exact failing checks.
 *
 * Usage: npx tsx scripts/diag-redesign.ts <url>
 */
import { fetchSite } from '../lib/fetch-site';
import { scoreSite, scoreHtml } from '../lib/score-site';
import { applyGlowUp } from '../lib/glowup';
import { buildRedesign } from '../lib/redesign';
import type { SiteScore } from '../lib/types';

const url = process.argv[2] ?? 'https://beckettelectrical.com/';

function findings(s: SiteScore) {
  const out: Array<{ cat: string; id: string; label: string; verdict: string; impact: number; detail: string }> = [];
  for (const c of s.categories) {
    for (const f of c.findings) {
      out.push({
        cat: c.label,
        id: f.id,
        label: f.label,
        verdict: f.status,
        impact: f.impact,
        detail: f.detail ?? '',
      });
    }
  }
  return out;
}

async function main() {
  const base = await scoreSite(url, { skipPageSpeed: true });
  if (base.error) throw new Error(base.error);
  const f = await fetchSite(base.finalUrl);

  const fixed = applyGlowUp(base, f.html);
  const glow = await scoreHtml(fixed.html, base.finalUrl, { skipPageSpeed: true });

  const rd = await buildRedesign(f.html, base.finalUrl);
  const red = await scoreHtml(rd.html, base.finalUrl, { skipPageSpeed: true });

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`  ${base.finalUrl}`);
  console.log(`  original ${base.overall} | fixed ${glow.overall} | redesign ${red.overall}`);
  console.log(`${'═'.repeat(78)}`);

  const gf = findings(glow);
  const rf = findings(red);
  const gMap = new Map(gf.map((x) => [x.id, x]));
  const rMap = new Map(rf.map((x) => [x.id, x]));

  console.log('\n  CHECKS THE REDESIGN FAILS BUT THE FIXES PASS (the loss):\n');
  for (const [id, g] of gMap) {
    const r = rMap.get(id);
    if (!r) continue;
    const gPass = g.verdict === 'pass';
    const rPass = r.verdict === 'pass';
    if (gPass && !rPass) {
      console.log(`  [${g.cat}] ${id}`);
      console.log(`     label:    ${g.label}`);
      console.log(`     fixed:    ${g.verdict}`);
      console.log(`     redesign: ${r.verdict}   <-- REGRESSED`);
      if (r.detail) console.log(`     why:      ${r.detail.slice(0, 160)}`);
      console.log('');
    }
  }

  console.log('\n  ALL REDESIGN FAILURES:\n');
  for (const r of rf) {
    if (r.verdict === 'pass') continue;
    const g = gMap.get(r.id);
    const wasPassing = g?.verdict === 'pass';
    console.log(
      `  ${String(r.verdict).padEnd(5)} impact ${String(r.impact).padStart(2)}  ${r.id.padEnd(22)} ${wasPassing ? '<-- WAS PASSING' : ''}`
    );
    console.log(`        [${r.cat}] ${r.label}`);
    if (r.detail) console.log(`        ${r.detail.slice(0, 140)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
