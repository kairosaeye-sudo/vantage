import { NextResponse } from 'next/server';
import { getPreview } from '@/lib/preview-store';
import { buildZip, type ZipEntry } from '@/lib/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Download a glow-up as a ZIP.
 *
 * A glow-up produced files that had no way out of the product — the HTML and
 * the three generated files lived in the preview store and could only be looked
 * at in an iframe. This is the handover step: `?variant=redesign` (the visual
 * rebuild) or `?variant=after` (technical fixes only, original design).
 *
 * The README is generated per download rather than stored, so it can state what
 * the run actually did — including that the redesign has NOT been verified.
 */

/** Files that ship alongside the page, in the order they appear in the archive. */
const SUPPORT_FILES = ['sitemap.xml', 'robots.txt', 'llms.txt'];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'your-site';
  }
}

function readme(
  url: string,
  variant: 'redesign' | 'after',
  before: number | null,
  after: number | null,
  fixes: number,
  files: string[]
): string {
  const host = hostOf(url);
  const included = SUPPORT_FILES.filter((f) => files.includes(f));
  const verified = variant === 'after';

  const lines = [
    `# Glow-up for ${host}`,
    '',
    `Source: ${url}`,
    `Variant: ${variant === 'redesign' ? 'visual rebuild' : 'technical fixes (original design)'}`,
    `Score: ${before ?? '?'} → ${after ?? '?'}`,
    `Technical fixes applied: ${fixes}`,
    '',
    '## What to do with these files',
    '',
    '1. Back up your current site. Keep a copy of the files you are replacing —',
    '   you will want them if you roll back.',
    '2. Upload `index.html` to your web root, replacing the existing page.',
    ...(included.length
      ? [
          `3. Upload ${included.map((f) => `\`${f}\``).join(', ')} to the web root as well.`,
          '4. Open your site in a browser and check the page renders and the forms work.',
        ]
      : ['3. Open your site in a browser and check the page renders and the forms work.']),
    '',
    '## Before you publish — read this',
    '',
    verified
      ? [
          'The score above was measured by re-scoring this exact HTML through the same',
          'engine that produced the original score, so the gain is real and reproducible.',
          '',
          'The technical fixes are measured. The page keeps your original design, so',
          'nothing about how the site looks should change.',
        ].join('\n')
      : [
          '**This variant has NOT been verified by re-scoring.** It is a visual rebuild:',
          'your real content re-rendered through a modern design system. Score movement',
          'is not a meaningful measure of it, so none is claimed.',
          '',
          'A human must review this before it goes live. Specifically:',
          '',
          '- Check every phone number, address and email is still correct.',
          '- Check opening hours and any prices.',
          '- Check the contact form still submits to the right place.',
          '- Check your logo and photos look right — where an image could not be read',
          '  from your site, the rebuild omits it rather than substituting a stock photo.',
        ].join('\n'),
    '',
    '## Files',
    '',
    '- `index.html` — the page',
    ...included.map((f) => `- \`${f}\` — ${f === 'llms.txt' ? 'helps AI assistants describe your business accurately' : f === 'sitemap.xml' ? 'helps search engines find your pages' : 'search engine crawl instructions'}`),
    '- `README.md` — this file (safe to delete after reading)',
    '',
    '## Not included, and why',
    '',
    'This archive contains the page and the crawl files. It does not include your',
    'images or any sub-pages, which stay on your server and are referenced by URL.',
    'Nothing here invents content: every fact in the page came from your own site.',
    '',
  ];

  return lines.join('\n');
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const variant = searchParams.get('variant') === 'after' ? 'after' : 'redesign';

  if (!id) {
    return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  }

  const preview = await getPreview(id);
  if (!preview) {
    return NextResponse.json({ ok: false, error: 'Glow-up not found' }, { status: 404 });
  }

  const page = variant === 'after' ? preview.after : preview.redesigned ?? preview.after;
  if (!page) {
    return NextResponse.json(
      { ok: false, error: `No ${variant} output exists for this run` },
      { status: 404 }
    );
  }

  const support = Object.keys(preview.files ?? {});
  const fixes = Array.isArray(preview.fixes) ? preview.fixes.length : 0;

  const entries: ZipEntry[] = [
    { name: 'index.html', content: page },
    ...SUPPORT_FILES.filter((f) => preview.files?.[f]).map((f) => ({
      name: f,
      content: preview.files[f],
    })),
    {
      name: 'README.md',
      content: readme(
        preview.url,
        variant,
        preview.beforeScore,
        preview.afterScore,
        fixes,
        support
      ),
    },
  ];

  const zip = buildZip(entries);
  const host = hostOf(preview.url).replace(/[^a-z0-9.-]/gi, '');
  const filename = `${host}-glowup-${variant}.zip`;

  return new NextResponse(zip as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
      'Cache-Control': 'no-store',
    },
  });
}
