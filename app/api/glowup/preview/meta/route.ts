import { NextResponse } from 'next/server';
import { getPreview } from '@/lib/preview-store';

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

  return NextResponse.json({
    ok: true,
    url: preview.url,
    beforeScore: preview.beforeScore,
    afterScore: preview.afterScore,
    verifiedGain: preview.afterScore - preview.beforeScore,
    files: Object.keys(preview.files ?? {}),
    fixes: preview.fixes ?? [],
    createdAt: preview.createdAt,
  });
}
