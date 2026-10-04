/**
 * Measure the redesign against the same rubric as the live site.
 *
 * The redesign has never been scored. Until it is, "modern and elite" is an
 * opinion, not a claim. This compares three things:
 *
 *   original  — the site as it is
 *   glowup    — technical fixes only (same design)
 *   redesign  — rebuilt through the design system
 *
 * Usage: npx tsx scripts/measure-redesign.ts [url ...]
 */
import { fetchSite } from '../lib/fetch-site';
import { scoreSite, scoreHtml } from '../lib/score-site';
import { applyGlowUp } from '../lib/glowup';
import { buildRedesign } from '../lib/redesign';

const urls =
  process.argv.slice(2).filter((a) => !a.startsWith('--')).length > 0
    ? process.argv.slice(2).filter((a) => !a.startsWith('--'))
    : [
        'https://beckettelectrical.com/',
        'https://www.chapmanelectrictx.com/',
        'https://www.irwinelectricatx.com/',
        'https://jumbo-electric.com/',
      ];

async function main() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  REDESIGN SCORE — the number nobody has measured');
  console.log(`${'═'.repeat(80)}\n`);

  const rows: Array<{
    url: string;
    original: number;
    glowup: number;
    redesign: number;
    cats: Array<{ label: string; o: number; g: number; r: number }>;
  }> = [];

  for (const u of urls) {
    try {
      const base = await scoreSite(u, { skipPageSpeed: true });
      if (base.error) {
        console.log(`  ${u}\n    FAILED: ${base.error}\n`);
        continue;
      }
      const f = await fetchSite(base.finalUrl);

      // Technical fixes only.
      const fixed = applyGlowUp(base, f.html);
      const glow = await scoreHtml(fixed.html, base.finalUrl, { skipPageSpeed: true });

      // Visual rebuild.
      const rd = await buildRedesign(f.html, base.finalUrl);
      const red = await scoreHtml(rd.html, base.finalUrl, { skipPageSpeed: true });

      const cats = base.categories.map((c, i) => ({
        label: c.label,
        o: c.score,
        g: glow.categories[i]?.score ?? 0,
        r: red.categories[i]?.score ?? 0,
      }));

      rows.push({
        url: base.finalUrl,
        original: base.overall,
        glowup: glow.overall,
        redesign: red.overall,
        cats,
      });
    } catch (e) {
      console.log(`  ${u}\n    FAILED: ${e instanceof Error ? e.message : e}\n`);
    }
  }

  console.log(`  ${'SITE'.padEnd(38)} ${'ORIG'.padEnd(6)} ${'FIXED'.padEnd(7)} ${'REDESIGN'.padEnd(9)} VERDICT`);
  console.log(`  ${'─'.repeat(76)}`);
  for (const r of rows) {
    const host = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 36);
    const better = r.redesign > r.glowup ? 'redesign wins' : r.redesign === r.glowup ? 'tie' : 'GLOWUP BETTER';
    console.log(
      `  ${host.padEnd(38)} ${String(r.original).padEnd(6)} ${String(r.glowup).padEnd(7)} ${String(r.redesign).padEnd(9)} ${better}`
    );
  }

  if (rows.length === 0) return;

  const avg = (k: 'original' | 'glowup' | 'redesign') =>
    Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);

  console.log(`\n  AVERAGE${' '.repeat(31)} ${String(avg('original')).padEnd(6)} ${String(avg('glowup')).padEnd(7)} ${String(avg('redesign')).padEnd(9)}`);

  // Where the redesign loses, and by how much.
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  CATEGORY BREAKDOWN (avg across sites)');
  console.log(`${'═'.repeat(80)}\n`);
  const labels = rows[0].cats.map((c) => c.label);
  console.log(`  ${'CATEGORY'.padEnd(16)} ${'ORIG'.padEnd(6)} ${'FIXED'.padEnd(7)} ${'REDESIGN'.padEnd(9)} REDESIGN vs FIXED`);
  console.log(`  ${'─'.repeat(72)}`);
  for (let i = 0; i < labels.length; i++) {
    const o = Math.round(rows.reduce((s, r) => s + r.cats[i].o, 0) / rows.length);
    const g = Math.round(rows.reduce((s, r) => s + r.cats[i].g, 0) / rows.length);
    const rd = Math.round(rows.reduce((s, r) => s + r.cats[i].r, 0) / rows.length);
    const d = rd - g;
    const mark = d === 0 ? '—' : d > 0 ? `+${d}` : `${d}  <-- WORSE`;
    console.log(`  ${labels[i].padEnd(16)} ${String(o).padEnd(6)} ${String(g).padEnd(7)} ${String(rd).padEnd(9)} ${mark}`);
  }

  // The biggest loss per site, so we know exactly what to fix.
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  WHERE THE REDESIGN LOSES POINTS (worst first)');
  console.log(`${'═'.repeat(80)}\n`);
  const losses: Array<{ label: string; delta: number; site: string }> = [];
  for (const r of rows) {
    for (const c of r.cats) {
      const d = c.r - c.g;
      if (d < 0) losses.push({ label: c.label, delta: d, site: r.url.replace(/^https?:\/\//, '').slice(0, 30) });
    }
  }
  losses.sort((a, b) => a.delta - b.delta);
  for (const l of losses.slice(0, 14)) {
    console.log(`  ${String(l.delta).padStart(4)}  ${l.label.padEnd(16)} ${l.site}`);
  }
  if (losses.length === 0) console.log('  (none — the redesign loses nothing)');
  console.log('');
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
