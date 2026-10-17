import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { runGlowUp, saveGlowUp, listGlowUps, rescoreHtml } from '@/lib/glowup-run';
import { savePreview } from '@/lib/preview-store';
import { fetchSite } from '@/lib/fetch-site';
import { buildRedesign } from '@/lib/redesign';
import { TEMPLATES } from '@/lib/design-system';
import { extractDesignSignals } from '@/lib/design-signals';
import { buildFieldDesignBrief, type FieldSite } from '@/lib/field-design';
import { listFields } from '@/lib/field-from-db';
import { resolveComparison, type ComparisonSet } from '@/lib/comparison-set';
import { detectFieldWithMeta } from '@/lib/field-detect';
import { createProgress, updateProgress } from '@/lib/progress';
import { recordFieldGap } from '@/lib/field-gaps';
import { guessIndustry } from '@/lib/industry-guess';
import { slugifyLocation } from '@/lib/location-detect';
import { notifyDiscord, glowUpMessage } from '@/lib/notify';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Run a glow-up.
 *
 * POST { url, watchId?, redesign?, template? }
 *
 * A glow-up is one job with two halves:
 *   1. Technical fixes — measured, re-scored, verified.
 *   2. Visual rebuild — real content re-rendered through the design system.
 *
 * Both run by default and come back together, because that is what "glow up
 * this site" means to a customer. `redesign: false` skips the rebuild for a
 * fast, score-only run.
 *
 * The HTML is never returned inline — it is too large for JSON. A `previewId`
 * is returned instead and each view is streamed from /api/glowup/preview.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      url?: string;
      watchId?: string;
      redesign?: boolean;
      template?: string;
      progressId?: string;
      fieldId?: string;
    };
    const url = (body.url ?? '').trim();
    if (!url) {
      return NextResponse.json({ ok: false, error: 'Enter a website URL.' }, { status: 400 });
    }

    const wantRedesign = body.redesign !== false;
    if (body.template && !(body.template in TEMPLATES)) {
      return NextResponse.json(
        { ok: false, error: `Unknown template. Use one of: ${Object.keys(TEMPLATES).join(', ')}` },
        { status: 400 }
      );
    }

    const progressId = typeof body.progressId === 'string' && body.progressId ? body.progressId : randomUUID();
    await createProgress(progressId);
    await updateProgress(progressId, { stage: 'scoring', message: 'Scoring the original site…', percent: 5 });
    await sleep(800);

    const { record, before, after, files, html, applied } = await runGlowUp(url);
    await updateProgress(progressId, { stage: 'scored', message: `Original scored: ${before.overall}/100`, percent: 20, metadata: { beforeScore: before.overall } });
    await sleep(600);

    // Fetch the original once — the preview needs it, and so does the redesign.
    let originalHtml = '';
    await updateProgress(progressId, { stage: 'fetching', message: 'Fetching original site…', percent: 25 });
    await sleep(500);
    try {
      const fetched = await fetchSite(before.finalUrl);
      originalHtml = fetched.html;
    } catch {
      originalHtml = '<!doctype html><p>Could not retrieve the original page for preview.</p>';
    }

    /* ---------------- Field auto-detection ---------------- */

    let detectedField: {
      fieldId: string | null;
      fieldSlug: string | null;
      fieldIndustry: string | null;
      fieldLocation: string | null;
      score: number;
      detectedCity: string | null;
      detectedRegion: string | null;
      locationSource: string | null;
      locationEvidence: string | null;
    } = {
      fieldId: null, fieldSlug: null, fieldIndustry: null, fieldLocation: null, score: 0,
      detectedCity: null, detectedRegion: null, locationSource: null, locationEvidence: null,
    };

    // Who this site is compared against: its local field when we have one,
    // otherwise the nearest same-industry fields, widening until there is one.
    // Detection alone is not enough — it can match the right industry in the
    // wrong city, and that must never be presented as local competition.
    let comparison: ComparisonSet | null = null;
    await updateProgress(progressId, { stage: 'detecting', message: 'Finding your competitors…', percent: 30 });
    await sleep(700);
    if (originalHtml) detectedField = await detectFieldWithMeta(originalHtml);
    const industryGuess = originalHtml ? guessIndustry(originalHtml) : { industry: null, evidence: null };
    try {
      const explicit = body.fieldId ? (await listFields()).find((f) => f.id === body.fieldId) : undefined;
      comparison = await resolveComparison({
        fieldSlug: explicit?.slug ?? null,
        industry: industryGuess.industry ?? detectedField.fieldIndustry,
        city: detectedField.detectedCity,
        region: detectedField.detectedRegion,
        selfUrl: before.finalUrl,
      });
    } catch {
      comparison = null; // the rebuild does not depend on a comparison
    }
    const localField = comparison?.scope === 'local' ? comparison.fields[0] : null;

    if (localField) {
      await updateProgress(progressId, {
        stage: 'detected',
        message: `Competitors found: ${comparison!.peers.length} ${comparison!.label}`,
        percent: 35,
        metadata: {
          fieldSlug: localField.slug,
          fieldIndustry: localField.industry,
          fieldLocation: localField.location,
          detectedCity: detectedField.detectedCity,
          detectedRegion: detectedField.detectedRegion,
          locationSource: detectedField.locationSource,
          competitorCount: comparison!.peers.length,
        },
      });
    } else {
      // Not a local field: record the demand so the right field gets built.
      const suggestedSlug =
        industryGuess.industry && detectedField.detectedCity
          ? `${industryGuess.industry.replace(/\s+/g, '-')}-${slugifyLocation(
              detectedField.detectedCity,
              detectedField.detectedRegion
            )}`
          : null;
      await recordFieldGap({
        url: before.finalUrl,
        industry: industryGuess.industry,
        city: detectedField.detectedCity,
        region: detectedField.detectedRegion,
        locationSource: detectedField.locationSource,
        evidence: detectedField.locationEvidence ?? industryGuess.evidence,
        suggestedSlug,
      });
      await updateProgress(progressId, {
        stage: comparison ? 'widened' : 'no-field',
        message: comparison
          ? `No local field yet — searched wider: ${comparison.peers.length} ${comparison.label}`
          : 'No matching field found — doing a general glow-up with best practices.',
        percent: 35,
        metadata: {
          detectedCity: detectedField.detectedCity,
          detectedRegion: detectedField.detectedRegion,
          locationSource: detectedField.locationSource,
          competitorCount: comparison?.peers.length ?? 0,
        },
      });
    }
    await sleep(500);

    const fieldIdToUse = localField?.id ?? null;

    /* ---------------- Field design brief ---------------- */

    // Design cues come from the same industry only — a dentist's palette says
    // nothing about what an electrician's customers expect.
    let fieldBrief = null;
    const briefSites = comparison && comparison.scope !== 'all' ? comparison.peers.slice(0, 20) : [];
    if (briefSites.length) {
      try {
        await updateProgress(progressId, { stage: 'analyzing', message: 'Analyzing competitor sites…', percent: 40 });
        const sitesWithSignals: FieldSite[] = [];
        for (const peer of briefSites) {
          try {
            const f = await fetchSite(peer.finalUrl);
            // fetchSite reports failure rather than throwing. An unreachable
            // competitor must not enter the brief as a blank page — the redesign
            // would then claim to be based on sites it never saw.
            if (!f.ok || !f.html) continue;
            const signals = extractDesignSignals(f.html);
            sitesWithSignals.push({ url: peer.finalUrl, score: peer.overall, signals });
          } catch {
            // Skip sites that can't be fetched
          }
        }
        if (sitesWithSignals.length > 0) {
          fieldBrief = buildFieldDesignBrief(sitesWithSignals);
          await updateProgress(progressId, { stage: 'analyzed', message: `Analyzed ${sitesWithSignals.length} competitor sites`, percent: 50, metadata: { competitorCount: sitesWithSignals.length } });
          await sleep(600);
        }
      } catch {
        // Field brief is optional — proceed without it
      }
    }

    /* ---------------- Visual rebuild ---------------- */

    let redesign: {
      html: string;
      template: { id: string; label: string; suitedTo: string; accent: string };
      changes: Array<{ label: string; detail: string; kind: string }>;
      omitted: Array<{ section: string; reason: string }>;
      needsFromClient: string[];
      content: {
        businessName: string;
        headline: string | null;
        phone: string | null;
        address: string | null;
        services: string[];
        testimonialCount: number;
        imageCount: number;
        hoursCount: number;
      };
      stats: { beforeBytes: number; afterBytes: number; sections: number };
      /** Vantage AI: the LLM that drafted the page copy. */
      vantageAi?: {
        used: boolean;
        model: string | null;
        wordCount: number;
        groundedOn: string[];
      };
    } | null = null;

    let redesignError: string | null = null;

    if (wantRedesign && originalHtml) {
      try {
        await updateProgress(progressId, { stage: 'redesigning', message: 'Rebuilding design from your content…', percent: 60 });
        const r = await buildRedesign(originalHtml, before.finalUrl, { templateId: body.template, fieldBrief });
        const c = r.content;
        // A redesign needs real content. If the page is JS-rendered or blocked we
        // get nothing usable — report that rather than render an empty shell.
        const realFacts = [c.headline, c.phone, c.address, ...c.services].filter(
          Boolean
        ).length;
        if (realFacts === 0) {
          redesignError =
            'We could not read enough content to rebuild the design. The site may render entirely with JavaScript, or it may be blocking automated requests. The technical fixes above still apply.';
        } else {
          redesign = {
            html: r.html,
            template: {
              id: r.template.id,
              label: r.template.label,
              suitedTo: r.template.suitedTo,
              accent: r.template.palette.accent,
            },
            changes: r.changes,
            omitted: r.omitted,
            needsFromClient: r.needsFromClient,
            content: {
              businessName: c.businessName,
              headline: c.headline,
              phone: c.phone,
              address: c.address,
              services: c.services,
              testimonialCount: c.testimonialCount,
              imageCount: c.imageCount,
              hoursCount: c.hoursCount,
            },
            stats: r.stats,
            /** Vantage AI: the LLM that drafted the page copy. */
            vantageAi: {
              used: r.copy.aiGenerated,
              model: r.copy.model ?? null,
              wordCount: r.copy.wordCount,
              groundedOn: r.copy.groundedOn,
            },
          };
        }
      } catch (e) {
        redesignError = e instanceof Error ? e.message : 'The visual rebuild failed.';
      }
    }

    /* ---------------- Where the rebuild would rank ---------------- */

    // The redesign is scored through the same engine, PageSpeed off, exactly like
    // the before score — and fields are built the same way — so its rank in the
    // field is a like-for-like measurement, not a projection.
    let redesignScore: { overall: number; categories: Array<{ label: string; score: number }> } | null = null;
    if (redesign) {
      try {
        const rs = await rescoreHtml(redesign.html, before.finalUrl, before.fetch.ttfbMs, before.fetch.totalMs);
        redesignScore = { overall: rs.overall, categories: rs.categories.map((c) => ({ label: c.label, score: c.score })) };
      } catch {
        // The rank card is a bonus; the glow-up stands without it.
      }
    }

    let fieldRank: {
      label: string;
      scope: string;
      note: string | null;
      peers: Array<{ url: string; overall: number; where?: string }>;
    } | null = null;
    if (comparison && comparison.peers.length) {
      fieldRank = {
        label: comparison.label,
        scope: comparison.scope,
        note: comparison.note,
        peers: comparison.peers
          .map((p) => ({
            url: p.finalUrl,
            overall: p.overall,
            where: comparison!.scope === 'local' ? undefined : comparison!.peerWhere[p.finalUrl],
          }))
          .sort((x, y) => y.overall - x.overall),
      };
    }

    /* ---------------- Preview ---------------- */

    const previewId = randomUUID();
    try {
      // Ground truth, not the plan. `record.plan.fixes` is everything we COULD
      // fix; `applied` is what actually changed, and the markers present in the
      // rebuilt HTML are what the customer will actually see outlined. Anything
      // else would be the UI claiming a change that does not exist.
      const appliedIds = new Set(applied.map((f) => f.findingId));
      const markedIds = new Set(
        Array.from(html.matchAll(/data-vantage-fix="([^"]+)"/g)).map((m) => m[1])
      );

      const fixes = record.plan.fixes
        .filter((f) => appliedIds.has(f.findingId))
        .map((f) => ({
          findingId: f.findingId,
          label: f.label,
          category: f.category,
          points: f.points,
          // Visible = we actually stamped a highlight marker into the page.
          headOnly: markedIds.has(f.findingId) ? undefined : true,
        }));

      await savePreview(previewId, {
        kind: 'glowup',
        before: originalHtml,
        after: html,
        redesigned: redesign?.html ?? null,
        files,
        url: before.finalUrl,
        beforeScore: before.overall,
        afterScore: after.overall,
        fixes,
        redesign: redesign
          ? {
              templateId: redesign.template.id,
              templateLabel: redesign.template.label,
              changes: redesign.changes,
              omitted: redesign.omitted,
              needsFromClient: redesign.needsFromClient,
            }
          : null,
        fieldDetected: Boolean(fieldIdToUse),
        fieldId: fieldIdToUse ?? null,
      });
    } catch {
      // A preview-store failure must not lose the result the user asked for.
    }

    if (body.watchId) {
      try {
        await saveGlowUp(body.watchId, record, '', files);
      } catch {
        // Persisting must not break the result the user asked for.
      }
    }

    // Tell Discord the run finished. Fire-and-forget: a notification failure
    // must never fail a glow-up that already succeeded, so this is not awaited
    // into the response path's error handling.
    void notifyDiscord(
      glowUpMessage({
        url: record.url,
        beforeScore: record.beforeScore,
        afterScore: record.afterScore,
        appliedCount: record.appliedCount,
        hasRedesign: redesign !== null,
        fieldSlug: localField?.slug ?? null,
        previewId,
      })
    );

    return NextResponse.json({
      ok: true,
      previewId,
      progressId,
      record: {
        id: record.id,
        url: record.url,
        beforeScore: record.beforeScore,
        afterScore: record.afterScore,
        verifiedGain: record.verifiedGain,
        appliedCount: record.appliedCount,
        skipped: record.skipped,
        files: record.files,
        createdAt: record.createdAt,
      },
      plan: record.plan,
      before: {
        overall: before.overall,
        grade: before.grade,
        categories: before.categories.map((c) => ({ label: c.label, score: c.score })),
      },
      after: {
        overall: after.overall,
        grade: after.grade,
        categories: after.categories.map((c) => ({ label: c.label, score: c.score })),
      },
      /** The visual rebuild, when one was produced. */
      redesign,
      /** The rebuild scored through the same engine as `before`. */
      redesignScore,
      /** The field's measured scores, for ranking before / after. */
      fieldRank,
      redesignError,
      /** A redesign is a design judgement and must be seen before it ships. */
      redesignRequiresReview: redesign !== null,
      /**
       * How the before/after scores were measured.
       *
       * The glow-up scores both sides with PageSpeed disabled so the comparison
       * is like-for-like. The free Check does call PageSpeed, so it can report a
       * different figure for the same site — this field exists so a caller never
       * has to guess which method produced a number.
       */
      scoringMethod: {
        pageSpeed: false,
        note: 'Before and after are both measured without PageSpeed Insights so they are comparable. The free Check calls PageSpeed and may report a different figure for the same site.',
      },
      /** Field auto-detection result. */
      detectedField: localField
        ? {
            ...detectedField,
            fieldId: localField.id,
            fieldSlug: localField.slug,
            fieldIndustry: localField.industry,
            fieldLocation: localField.location,
          }
        : null,
      /** Where the site says it is, even when no field matched. */
      detectedLocation: detectedField.detectedCity
        ? {
            city: detectedField.detectedCity,
            region: detectedField.detectedRegion,
            source: detectedField.locationSource,
            evidence: detectedField.locationEvidence,
          }
        : null,
      /** Message when no field was detected — the glow-up uses general best practices. */
      noFieldMessage: !fieldIdToUse
        ? comparison?.note ??
          (detectedField.detectedCity
            ? `No field built for ${detectedField.detectedCity}${detectedField.detectedRegion ? `, ${detectedField.detectedRegion}` : ''} yet — doing a general glow-up with best practices and modern design.`
            : 'No matching field found — doing a general glow-up with best practices and modern design')
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Glow-up failed',
        unreachable: true,
      },
      { status: 422 }
    );
  }
}

/** List past glow-ups for a watch. */
export async function GET(req: Request) {
  try {
    const watchId = new URL(req.url).searchParams.get('watchId');
    if (!watchId) {
      return NextResponse.json({ ok: false, error: 'watchId required' }, { status: 400 });
    }
    const rows = await listGlowUps(watchId);
    return NextResponse.json({ ok: true, glowups: rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
