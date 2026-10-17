import { NextResponse } from 'next/server';
import { scoreSite } from '@/lib/score-site';
import { buildSideBySide } from '@/lib/compare';
import { getFieldBySlug, getFieldSites, listFields, rowsToPeers } from '@/lib/field-from-db';
import { saveScan } from '@/lib/db';
import { detectFieldWithMeta } from '@/lib/field-detect';
import { guessIndustry } from '@/lib/industry-guess';
import { detectLocation } from '@/lib/location-detect';
import { fetchSite } from '@/lib/fetch-site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Score one site against a field.
 *
 * POST { url, fieldSlug, save? }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string; fieldSlug?: string; save?: boolean };
    const url = (body.url ?? '').trim();
    const fieldSlug = (body.fieldSlug ?? '').trim();

    if (!url) {
      return NextResponse.json({ ok: false, error: 'Enter a website URL.' }, { status: 400 });
    }
    let field = fieldSlug ? await getFieldBySlug(fieldSlug) : null;

    // Score the submitted site with the full engine (real fetch + signals).
    const scored = await scoreSite(url, { skipPageSpeed: true });
    if (scored.error) {
      return NextResponse.json(
        {
          ok: false,
          error: `Couldn't reach that site — ${scored.error}. It may block automated requests.`,
          unreachable: true,
        },
        { status: 422 }
      );
    }

    // No field for this industry+location: build a suggested one from what we
    // can detect from the site itself, then score against the closest real field.
    let noFieldSuggestion = null;
    if (!field) {
      const fetched = await fetchSite(scored.finalUrl);
      const html = fetched.html;
      const detection = await detectFieldWithMeta(html);
      const industry = guessIndustry(html);

      const allFields = await listFields();
      const detectedRegion = detection.detectedRegion;
      const closest = allFields
        .filter((f) => f.industry === (detection.fieldIndustry ?? industry.industry))
        .sort((a, b) => {
          const aMatch = detectedRegion && a.location.toLowerCase().includes(detectedRegion.toLowerCase()) ? 1 : 0;
          const bMatch = detectedRegion && b.location.toLowerCase().includes(detectedRegion.toLowerCase()) ? 1 : 0;
          return bMatch - aMatch;
        })[0] ?? allFields[0];

      if (closest) {
        noFieldSuggestion = {
          detectedIndustry: industry.industry,
          detectedIndustryStrength: industry.strength,
          detectedCity: detection.detectedCity,
          detectedRegion,
          locationSource: detection.locationSource,
          suggestedFieldSlug: closest.slug,
          suggestedFieldIndustry: closest.industry,
          suggestedFieldLocation: closest.location,
          message: `We don't have a ${industry.industry} field for ${detection.detectedCity ?? detectedRegion ?? 'your area'} yet. Showing you ${closest.industry} in ${closest.location} as the closest comparison.`,
        };
        field = closest;
      }
    }

    if (!field) {
      return NextResponse.json({
        ok: false,
        error: 'No fields configured. Build one first.',
        noFields: true,
      }, { status: 400 });
    }

    const siteRows = await getFieldSites(field.id);
    const peers = rowsToPeers(siteRows);
    const vertical = `${field.industry} in ${field.location}`;
    const side = buildSideBySide(scored, peers, vertical);

    // The whole report is stored, not just the side-by-side, so a saved scan can
    // be reopened as a shareable link and enriched later (AI answer share).
    let scanId: string | null = null;
    if (body.save) {
      try {
        scanId = await saveScan({
          url: scored.finalUrl,
          // The matched field, not the request's — an auto-detected scan used to
          // be stored with no field at all.
          fieldSlug: field.slug,
          overall: scored.overall,
          grade: scored.grade,
          percentile: side.you.percentile,
          result: { side, field, noFieldSuggestion } as unknown,
        });
      } catch {
        // Logging must never break the score the user asked for.
      }
    }

    return NextResponse.json({ ok: true, scanId, side, field, noFieldSuggestion });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Scoring failed' },
      { status: 500 }
    );
  }
}
