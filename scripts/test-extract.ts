/**
 * Verify content extraction against real sites.
 * Usage: npx tsx scripts/test-extract.ts [url ...]
 */
import { fetchSite } from '../lib/fetch-site';
import { extractContent } from '../lib/extract-content';

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const urls =
    args.length > 0
      ? args
      : [
          'https://www.irwinelectricatx.com/',
          'https://beckettelectrical.com/',
          'https://jumbo-electric.com/',
          'https://www.chapmanelectrictx.com/',
        ];

  for (const u of urls) {
    console.log(`\n${'═'.repeat(76)}`);
    console.log(`  ${u}`);
    console.log(`${'═'.repeat(76)}`);
    try {
      const f = await fetchSite(u);
      const c = extractContent(f.html, f.finalUrl);

      console.log(`  businessName   ${c.businessName}   [via ${c.nameSource}]`);
      console.log(`  headline       ${c.headline ?? '(none)'}`);
      console.log(`  tagline        ${c.tagline ? c.tagline.slice(0, 90) : '(none)'}`);
      console.log(`  phone          ${c.phone ?? '(none)'}`);
      console.log(`  email          ${c.email ?? '(none)'}`);
      console.log(`  address        ${c.address ?? '(none)'}`);
      console.log(`  logo           ${c.hasLogo ? c.logoUrl : '(none)'}`);
      console.log(`  hours (${c.hours.length})     ${c.hours.slice(0, 3).join(' | ') || '(none)'}`);
      console.log(`  about paras    ${c.aboutParagraphs.length}`);
      console.log(`  nav items      ${c.navItems.join(', ') || '(none)'}`);

      console.log(`\n  SERVICES (${c.services.length}):`);
      for (const s of c.services) {
        console.log(`    • ${s.name}${s.description ? `\n        ${s.description.slice(0, 80)}…` : ''}`);
      }

      console.log(`\n  TESTIMONIALS (${c.testimonials.length}):`);
      for (const t of c.testimonials) {
        console.log(`    • "${t.quote.slice(0, 100)}${t.quote.length > 100 ? '…' : ''}"${t.author ? ` — ${t.author}` : ''}`);
      }

      console.log(`\n  IMAGES (${c.images.length}):`);
      for (const i of c.images.slice(0, 6)) {
        console.log(`    • ${i.src.slice(0, 78)}`);
        if (i.alt) console.log(`        alt: ${i.alt.slice(0, 70)}`);
      }

      console.log(`\n  SOCIAL         ${c.socialLinks.map((s) => s.label).join(', ') || '(none)'}`);
      console.log(`  EXISTING CTAs  ${c.existingCtas.join(' / ') || '(none)'}`);
      console.log(`\n  MISSING        ${c.missing.join(', ') || '(nothing)'}`);
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
