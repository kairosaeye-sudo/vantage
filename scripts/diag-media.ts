/**
 * Why are images and the address missing from the rebuild?
 * Usage: npx tsx scripts/diag-media.ts <url>
 */
import { fetchSite } from '../lib/fetch-site';
import { buildFactSheet } from '../lib/ai-copy';
import * as cheerio from 'cheerio';

const url = process.argv[2] ?? 'https://www.chapmanelectrictx.com/';

async function main() {
  const f = await fetchSite(url);
  const $ = cheerio.load(f.html);

  console.log(`\n=== ${f.finalUrl} ===\n`);

  console.log('ALL IMAGES ON THE PAGE:');
  const deny =
    /trustindex|googleusercontent|gstatic|gravatar|cdnjs|jsdelivr|unpkg|spacer|pixel|avatar|profile[_ -]?picture|logo|icon|badge|star/i;
  let kept = 0;
  let total = 0;
  $('img').each((_, el) => {
    total++;
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? '';
    if (!src) return;
    const alt = ($(el).attr('alt') ?? '').replace(/\s+/g, ' ').trim();
    const w = Number($(el).attr('width') ?? 0);
    const h = Number($(el).attr('height') ?? 0);
    const blocked = deny.test(src) || deny.test(alt) || (w > 0 && w < 150) || (h > 0 && h < 100);
    if (!blocked) kept++;
    if (total <= 30) {
      console.log(`  ${blocked ? 'SKIP' : 'KEEP'}  ${src.slice(0, 72)}`);
      if (alt) console.log(`        alt="${alt.slice(0, 60)}"`);
      if (w || h) console.log(`        ${w}x${h}`);
    }
  });
  console.log(`\n  total ${total}, kept ${kept}`);

  console.log('\nBACKGROUND IMAGES (CSS url()):');
  const cssUrls = new Set<string>();
  $('[style]').each((_, el) => {
    const s = $(el).attr('style') ?? '';
    for (const m of s.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) cssUrls.add(m[2]);
  });
  $('style').each((_, el) => {
    for (const m of $(el).contents().text().matchAll(/url\((['"]?)([^'")]+)\1\)/g)) cssUrls.add(m[2]);
  });
  for (const u of Array.from(cssUrls).slice(0, 20)) {
    console.log(`  ${deny.test(u) ? 'SKIP' : 'KEEP'}  ${u.slice(0, 78)}`);
  }
  if (cssUrls.size === 0) console.log('  (none)');

  console.log('\nADDRESS EXTRACTION:');
  const facts = buildFactSheet(f.html, f.finalUrl, 'X', null);
  console.log(`  address: ${facts.address ?? '(NOT FOUND)'}`);
  const body = $('body').text().replace(/\s+/g, ' ');
  const streetRe =
    /\d+\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|suite|ste|highway|hwy|pkwy|parkway)\b/i;
  const m = body.match(streetRe);
  console.log(`  raw body match: ${m ? `"${m[0]}"` : '(none)'}`);
  const idx = body.search(/\bBlvd\b|\bBlvd\./i);
  if (idx >= 0) console.log(`  around Blvd: "${body.slice(Math.max(0, idx - 70), idx + 40)}"`);
  console.log('');
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
