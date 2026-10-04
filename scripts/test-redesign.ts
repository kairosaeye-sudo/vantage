/**
 * Prove the redesign works on real sites.
 *
 * Writes each rebuilt page to data/redesigns/ so it can be opened in a browser,
 * and reports what content was used, what was omitted, and what changed.
 *
 * Usage: npx tsx scripts/test-redesign.ts [url ...]
 */
import { writeFileSync, mkdirSync } from 'fs';
import { fetchSite } from '../lib/fetch-site';
import { buildRedesign } from '../lib/redesign';

const OUT = 'data/redesigns';

function slug(u: string): string {
  return u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const urls =
    args.length > 0
      ? args
      : [
          'https://beckettelectrical.com/',
          'https://www.irwinelectricatx.com/',
          'https://www.chapmanelectrictx.com/',
        ];

  mkdirSync(OUT, { recursive: true });

  for (const u of urls) {
    console.log(`\n${'═'.repeat(76)}`);
    console.log(`  ${u}`);
    console.log(`${'═'.repeat(76)}`);
    try {
      const f = await fetchSite(u);
      const r = buildRedesign(f.html, f.finalUrl);

      const file = `${OUT}/${slug(u)}.html`;
      writeFileSync(file, r.html, 'utf8');

      console.log(`  template       ${r.template.label}  (${r.template.id})`);
      console.log(`  suited to      ${r.template.suitedTo}`);
      console.log(`  accent         ${r.template.palette.accent}`);
      console.log(`  size           ${(r.stats.beforeBytes / 1024).toFixed(1)}KB -> ${(r.stats.afterBytes / 1024).toFixed(1)}KB`);
      console.log(`  sections       ${r.stats.sections}`);
      console.log(`  wrote          ${file}`);

      console.log(`\n  CONTENT USED (real, from the original page):`);
      console.log(`    business     ${r.content.businessName}`);
      console.log(`    headline     ${r.content.headline ?? '(none found)'}`);
      console.log(`    phone        ${r.content.phone ?? '(none found)'}`);
      console.log(`    address      ${r.content.address ?? '(none found)'}`);
      console.log(`    services     ${r.content.services.length}`);
      console.log(`    testimonials ${r.content.testimonials.length}`);
      console.log(`    hours        ${r.content.hours.length}`);
      console.log(`    images       ${r.content.images.length}`);
      console.log(`    social       ${r.content.socialLinks.map((s) => s.label).join(', ') || '(none)'}`);

      console.log(`\n  CHANGES CLAIMED (${r.changes.length}):`);
      for (const c of r.changes) {
        console.log(`    [${c.kind}] ${c.label}`);
      }

      console.log(`\n  SECTIONS OMITTED (${r.omitted.length}):`);
      for (const o of r.omitted) console.log(`    ${o.section}: ${o.reason}`);

      console.log(`\n  STILL NEEDED FROM CLIENT (${r.needsFromClient.length}):`);
      for (const n of r.needsFromClient) console.log(`    • ${n}`);

      // Sanity: does the output actually contain modern CSS?
      const has = (s: string) => r.html.includes(s);
      console.log(`\n  MODERN CSS PRESENT:`);
      console.log(`    @media queries      ${(r.html.match(/@media/g) || []).length}`);
      console.log(`    clamp() type scale  ${(r.html.match(/clamp\(/g) || []).length}`);
      console.log(`    CSS custom props    ${(r.html.match(/--[a-z-]+:/g) || []).length}`);
      console.log(`    transitions         ${(r.html.match(/transition:/g) || []).length}`);
      console.log(`    reduced-motion      ${has('prefers-reduced-motion') ? 'yes' : 'NO'}`);
      console.log(`    JSON-LD blocks      ${(r.html.match(/application\/ld\+json/g) || []).length}`);
      console.log(`    viewport meta       ${has('width=device-width') ? 'yes' : 'NO'}`);
      console.log(`    skip link           ${has('Skip to content') ? 'yes' : 'NO'}`);
    } catch (e) {
      console.log(`  FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
