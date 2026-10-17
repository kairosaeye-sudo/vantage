import { NextResponse } from 'next/server';
import { scoreSite } from '@/lib/score-site';
import { buildSideBySide } from '@/lib/compare';
import { resolveComparison } from '@/lib/comparison-set';
import { recordFieldGap } from '@/lib/field-gaps';
import { saveScan } from '@/lib/db';
import { detectFieldWithMeta } from '@/lib/field-detect';
import { guessIndustry } from '@/lib/industry-guess';
import { slugifyLocation } from '@/lib/location-detect';
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

    // What the business is and where, read from its own page — then the nearest
    // set of competitors we have measured, widening until there is one.
    const html = (await fetchSite(scored.finalUrl)).html;
    const detection = await detectFieldWithMeta(html);
    const guess = guessIndustry(html);
    const comparison = await resolveComparison({
      fieldSlug: fieldSlug || null,
      industry: guess.industry ?? detection.fieldIndustry,
      city: detection.detectedCity,
      region: detection.detectedRegion,
      selfUrl: scored.finalUrl,
    });

    if (!comparison || comparison.peers.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No fields configured. Build one first.',
        noFields: true,
      }, { status: 400 });
    }

    // Anything short of a local field is demand for one: record it so the field
    // that would have answered this person gets built (KAI-14).
    if (comparison.scope !== 'local') {
      const industry = guess.industry ?? detection.fieldIndustry?.toLowerCase() ?? null;
      void recordFieldGap({
        url: scored.finalUrl,
        industry,
        city: detection.detectedCity,
        region: detection.detectedRegion,
        locationSource: detection.locationSource,
        evidence: detection.locationEvidence ?? guess.evidence,
        suggestedSlug:
          industry && detection.detectedCity
            ? `${industry.replace(/\s+/g, '-')}-${slugifyLocation(detection.detectedCity, detection.detectedRegion)}`
            : null,
      });
    }

    const side = buildSideBySide(scored, comparison.peers, comparison.label);
    if (comparison.scope !== 'local') {
      side.peers = side.peers.map((p) => ({ ...p, where: comparison.peerWhere[p.url] }));
    }

    const primary = comparison.fields[0];
    const field = {
      id: primary.id,
      slug: comparison.scope === 'local' ? primary.slug : null,
      industry: comparison.industry,
      // AI answers and copy ask about the customer's own town, not the field's.
      location: comparison.location,
    };
    const compare = {
      scope: comparison.scope,
      label: comparison.label,
      note: comparison.note,
      places: comparison.fields.map((f) => f.location),
      nearestMiles: comparison.nearestMiles,
    };
    const noFieldSuggestion = null;

    // The whole report is stored, not just the side-by-side, so a saved scan can
    // be reopened as a shareable link and enriched later (AI answer share).
    let scanId: string | null = null;
    if (body.save) {
      try {
        scanId = await saveScan({
          url: scored.finalUrl,
          // The matched field, not the request's — an auto-detected scan used to
          // be stored with no field at all.
          fieldSlug: primary.slug,
          overall: scored.overall,
          grade: scored.grade,
          percentile: side.you.percentile,
          result: { side, field, noFieldSuggestion, comparison: compare } as unknown,
        });
      } catch {
        // Logging must never break the score the user asked for.
      }
    }

    return NextResponse.json({ ok: true, scanId, side, field, noFieldSuggestion, comparison: compare });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Scoring failed' },
      { status: 500 }
    );
  }
}
