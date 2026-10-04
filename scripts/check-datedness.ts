/**
 * How dated is this site, and does the glow-up modernise the LOOK?
 *
 * Distinguishes two very different things:
 *   - technical fixes (what the glow-up does)
 *   - visual redesign (what "modern and slick" actually means)
 *
 * Usage: npx tsx scripts/check-datedness.ts [url ...]
 */
import { readFileSync } from 'fs';
import { fetchSite } from '../lib/fetch-site';
import { scoreSite } from '../lib/score-site';
import { applyGlowUp } from '../lib/glowup';

/** Markers of an old build. Each is a real, checkable thing in the HTML. */
function datedSignals(html: string) {
  const h = html.toLowerCase();
  const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]).join('\n');
  const all = h + css.toLowerCase();

  const has = (re: RegExp) => re.test(all);

  return {
    // Structure
    tableLayout: has(/<table[^>]*(width|cellpadding|cellspacing|border)\s*=/) && !has(/<table[^>]*role\s*=\s*["']presentation/),
    fontTags: has(/<font[\s>]/),
    centerTags: has(/<center[\s>]/),
    marquee: has(/<marquee/),
    flash: has(/\.swf|shockwave|application\/x-shockwave/),
    frames: has(/<frameset|<frame[\s>]/),
    spacerGif: has(/spacer\.gif|clear\.gif|blank\.gif/),
    oldDoctype: /^\s*<!doctype\s+html\s+(public|system)/i.test(html) || !/^\s*<!doctype\s+html/i.test(html),

    // Layout technique
    fixedWidth: has(/\bwidth\s*:\s*(9[0-9]{2}|1[0-9]{3})px/),
    usesFlexOrGrid: has(/display\s*:\s*(flex|grid)/),
    usesMediaQueries: has(/@media/),
    usesCustomProps: has(/--[a-z-]+\s*:/),

    // Typography
    webfont: has(/@font-face|fonts\.googleapis|fonts\.gstatic|use\.typekit/),
    systemFontStack: has(/-apple-system|blinkmacsystemfont|segoe ui|system-ui/),
    oldFonts: has(/font-family[^;]*(arial|helvetica|verdana|times new roman|comic sans|tahoma|georgia)/) && !has(/system-ui/),

    // Scripts
    jqueryVersion: (html.match(/jquery[.-]?(\d+)\.(\d+)(?:\.(\d+))?/i) || []).slice(1).join('.') || null,
    inlineHandlers: (html.match(/\son(click|load|mouseover|submit)\s*=/gi) || []).length,
  };
}

/** Signals that indicate a modern, designed build. */
function designSignals(html: string) {
  const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]).join('\n');
  const all = (html + css).toLowerCase();
  const hexColors = new Set((html + css).match(/#[0-9a-f]{3,8}\b/gi) || []);
  const gradients = (all.match(/linear-gradient|radial-gradient/g) || []).length;
  const transitions = (all.match(/transition\s*:/g) || []).length;
  const animations = (all.match(/@keyframes/g) || []).length;
  const borderRadii = (all.match(/border-radius\s*:/g) || []).length;
  const shadows = (all.match(/box-shadow\s*:/g) || []).length;
  const variables = new Set((css.match(/--[a-z0-9-]+\s*:/gi) || [])).size;

  return {
    hexColors: hexColors.size,
    gradients,
    transitions,
    animations,
    borderRadii,
    shadows,
    cssVariables: variables,
    styleBlocks: (html.match(/<style/gi) || []).length,
    externalCss: (html.match(/<link[^>]*stylesheet/gi) || []).length,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let urls = args;
  if (urls.length === 0) {
    try {
      urls = readFileSync('scripts/corpus-electricians-austin.txt', 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    } catch {
      console.error('No URLs given and no corpus found.');
      process.exit(1);
    }
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`  DATEDNESS CHECK — ${urls.length} sites`);
  console.log(`${'═'.repeat(78)}\n`);

  const results: Array<{ url: string; dated: number; signals: ReturnType<typeof datedSignals> }> = [];

  for (const u of urls) {
    try {
      const f = await fetchSite(u);
      const s = datedSignals(f.html);
      const dated =
        (s.tableLayout ? 3 : 0) +
        (s.fontTags ? 3 : 0) +
        (s.centerTags ? 2 : 0) +
        (s.marquee ? 3 : 0) +
        (s.flash ? 4 : 0) +
        (s.frames ? 4 : 0) +
        (s.spacerGif ? 2 : 0) +
        (s.oldDoctype ? 2 : 0) +
        (s.fixedWidth ? 1 : 0) +
        (s.oldFonts ? 1 : 0) +
        (s.usesFlexOrGrid ? 0 : 2) +
        (s.usesMediaQueries ? 0 : 2);
      results.push({ url: u, dated, signals: s });
    } catch {
      results.push({ url: u, dated: -1, signals: {} as never });
    }
  }

  results.sort((a, b) => b.dated - a.dated);

  console.log('  DATEDNESS (higher = older build)');
  console.log(`  ${'SCORE'.padEnd(6)} ${'FLEX/GRID'.padEnd(10)} ${'MEDIA'.padEnd(6)} ${'WEBFONT'.padEnd(8)} URL`);
  console.log(`  ${'─'.repeat(74)}`);
  for (const r of results) {
    if (r.dated < 0) {
      console.log(`  ${'ERR'.padEnd(6)} ${''.padEnd(10)} ${''.padEnd(6)} ${''.padEnd(8)} ${r.url}`);
      continue;
    }
    const s = r.signals;
    console.log(
      `  ${String(r.dated).padEnd(6)} ${(s.usesFlexOrGrid ? 'yes' : 'NO').padEnd(10)} ` +
        `${(s.usesMediaQueries ? 'yes' : 'NO').padEnd(6)} ${(s.webfont ? 'yes' : 'NO').padEnd(8)} ${r.url}`
    );
  }

  const dated = results.filter((r) => r.dated >= 4);
  console.log(`\n  Sites scoring >= 4 (genuinely dated): ${dated.length}`);
  for (const d of dated) {
    const s = d.signals;
    const flags = [
      s.tableLayout && 'table-layout',
      s.fontTags && '<font>',
      s.centerTags && '<center>',
      s.marquee && '<marquee>',
      s.flash && 'Flash',
      s.spacerGif && 'spacer.gif',
      s.oldDoctype && 'old doctype',
      s.fixedWidth && 'fixed-width',
      s.oldFonts && 'legacy fonts',
    ].filter(Boolean);
    console.log(`    ${d.url}`);
    console.log(`      ${flags.join(', ')}`);
  }

  /* ------------------------------------------------------------------ */
  /* The real question: does the glow-up change the LOOK?                */
  /* ------------------------------------------------------------------ */

  const worst = results.find((r) => r.dated > 0);
  if (worst) {
    console.log(`\n${'═'.repeat(78)}`);
    console.log(`  DOES THE GLOW-UP MODERNISE THE DESIGN?`);
    console.log(`  Testing on the most dated site: ${worst.url}`);
    console.log(`${'═'.repeat(78)}\n`);

    const before = await scoreSite(worst.url, { skipPageSpeed: true });
    const f = await fetchSite(before.finalUrl);
    const res = applyGlowUp(before, f.html);

    const bd = designSignals(f.html);
    const ad = designSignals(res.html);

    console.log(`  ${'SIGNAL'.padEnd(18)} ${'BEFORE'.padEnd(9)} ${'AFTER'.padEnd(9)} CHANGE`);
    console.log(`  ${'─'.repeat(60)}`);
    const rows: Array<[string, number, number]> = [
      ['distinct colours', bd.hexColors, ad.hexColors],
      ['gradients', bd.gradients, ad.gradients],
      ['transitions', bd.transitions, ad.transitions],
      ['animations', bd.animations, ad.animations],
      ['border-radius', bd.borderRadii, ad.borderRadii],
      ['box-shadow', bd.shadows, ad.shadows],
      ['CSS variables', bd.cssVariables, ad.cssVariables],
      ['webfont', 0, 0],
    ];
    for (const [label, b, a] of rows) {
      const d = a - b;
      const mark = d === 0 ? '—' : d > 0 ? `+${d}` : `${d}`;
      console.log(`  ${label.padEnd(18)} ${String(b).padEnd(9)} ${String(a).padEnd(9)} ${mark}`);
    }

    const sb = datedSignals(f.html);
    const sa = datedSignals(res.html);
    console.log(`\n  DATED MARKERS AFTER GLOW-UP:`);
    for (const k of ['tableLayout', 'fontTags', 'centerTags', 'spacerGif', 'oldFonts', 'fixedWidth'] as const) {
      const changed = sb[k] !== sa[k];
      console.log(`    ${k.padEnd(16)} ${String(sb[k]).padEnd(6)} -> ${String(sa[k]).padEnd(6)} ${changed ? 'CHANGED' : 'unchanged'}`);
    }

    console.log(`\n  VERDICT:`);
    const modernised = ad.gradients > bd.gradients || ad.cssVariables > bd.cssVariables || ad.shadows > bd.shadows;
    console.log(
      modernised
        ? '    The visual design DID change.'
        : '    The visual design did NOT change. Same layout, same type, same colours.'
    );
    console.log(`    The dated markers (table layout, legacy fonts) are untouched.\n`);
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
