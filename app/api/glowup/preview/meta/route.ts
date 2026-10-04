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

  // Competitors are only meaningful when the site was matched to a field.
  // Returning them for an unmatched site would let the UI show a comparison
  // that isn't about the customer's actual peer set.
  let competitors: Array<{ url: string; score: number }> = [];
  if (preview.fieldDetected) {
    try {
      // Prefer the field this run actually matched; fall back to the first field
      // for previews written before field_id was stored.
      let fieldIdToUse = preview.fieldId;
      if (!fieldIdToUse) {
        const fields = await listFields();
        fieldIdToUse = fields[0]?.id ?? null;
      }
      if (fieldIdToUse) {
        const sites = await getFieldSites(fieldIdToUse);
        competitors = sites
          .filter((s) => !s.error && s.overall !== null && s.url !== preview.url)
          .slice(0, 8)
          .map((s) => ({ url: s.url, score: s.overall ?? 0 }));
      }
    } catch {
      // Competitors are optional
    }
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
    /** True when a field was auto-detected for this glow-up. */
    fieldDetected: preview.fieldDetected ?? false,
    competitors,
    createdAt: preview.createdAt,
  });
}
