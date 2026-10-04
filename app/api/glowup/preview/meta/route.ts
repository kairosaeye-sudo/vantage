import { NextResponse } from 'next/server';
import { getPreview } from '@/lib/preview-store';
import { getFieldSites, listFields } from '@/lib/field-from-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Metadata for a glow-up preview: the changes that were applied, so the UI can
 * list them and explain which ones are visible in the page versus in <head>.
 *
 * GET /api/glowup/preview/meta?id=<previewId>
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  }

  const preview = await getPreview(id);
  if (!preview) {
    return NextResponse.json({ ok: false, error: 'Preview not found or expired.' }, { status: 404 });
  }

  // Load competitor sites from the first available field
  let competitors: Array<{ url: string; score: number }> = [];
  try {
    const fields = await listFields();
    if (fields.length > 0) {
      const sites = await getFieldSites(fields[0].id);
      competitors = sites
        .filter((s) => !s.error && s.overall !== null && s.url !== preview.url)
        .slice(0, 8)
        .map((s) => ({ url: s.url, score: s.overall ?? 0 }));
    }
  } catch {
    // Competitors are optional
  }

  return NextResponse.json({
    ok: true,
    kind: preview.kind ?? 'glowup',
    url: preview.url,
    beforeScore: preview.beforeScore,
    afterScore: preview.afterScore,
    verifiedGain: preview.afterScore - preview.beforeScore,
    files: Object.keys(preview.files ?? {}),
    fixes: preview.fixes ?? [],
    redesign: preview.redesign ?? null,
    /** True when a third, redesigned view exists. */
    hasRedesign: Boolean(preview.redesigned),
    competitors,
    createdAt: preview.createdAt,
  });
}
