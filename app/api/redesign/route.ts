import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { fetchSite } from '@/lib/fetch-site';
import { buildRedesign } from '@/lib/redesign';
import { savePreview } from '@/lib/preview-store';
import { TEMPLATES } from '@/lib/design-system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Redesign a site: keep its real content, rebuild the presentation.
 *
 * This is a visual redesign, NOT the technical glow-up. It cannot be verified by
 * re-scoring — "modern" is a design judgement — so the response is explicit that
 * a human must review the result before it goes to a client.
 */
export async function POST(req: Request) {
  let body: { url?: string; template?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw = (body.url ?? '').trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'A url is required' }, { status: 400 });
  }

  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: 'That does not look like a valid URL' }, { status: 400 });
  }

  if (body.template && !(body.template in TEMPLATES)) {
    return NextResponse.json(
      { ok: false, error: `Unknown template. Use one of: ${Object.keys(TEMPLATES).join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const fetched = await fetchSite(url);

    // A redesign needs real content to work with. If we can barely read the
    // page, say so rather than rendering an empty shell.
    const result = buildRedesign(fetched.html, fetched.finalUrl, { templateId: body.template });

    const c = result.content;
    const realFacts = [c.headline, c.phone, c.address, ...c.services.map((s) => s.name)].filter(Boolean).length;
    if (realFacts === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'We could not read enough content from that page to rebuild it. The site may render entirely with JavaScript, or it may be blocking automated requests.',
        },
        { status: 422 }
      );
    }

    const previewId = randomUUID();
    try {
      await savePreview(previewId, {
        kind: 'redesign',
        before: fetched.html,
        after: result.html,
        files: {},
        url: fetched.finalUrl,
        beforeScore: 0,
        afterScore: 0,
        fixes: [],
        redesign: {
          templateId: result.template.id,
          templateLabel: result.template.label,
          changes: result.changes,
          omitted: result.omitted,
          needsFromClient: result.needsFromClient,
        },
      });
    } catch {
      // Persisting the preview is a convenience; never lose the result over it.
    }

    return NextResponse.json({
      ok: true,
      previewId,
      url: fetched.finalUrl,
      template: {
        id: result.template.id,
        label: result.template.label,
        suitedTo: result.template.suitedTo,
        accent: result.template.palette.accent,
      },
      /** Real content lifted from the original page. */
      content: {
        businessName: c.businessName,
        headline: c.headline,
        phone: c.phone,
        address: c.address,
        services: c.services.map((s) => s.name),
        testimonialCount: c.testimonials.length,
        imageCount: c.images.length,
        hoursCount: c.hours.length,
      },
      changes: result.changes,
      omitted: result.omitted,
      needsFromClient: result.needsFromClient,
      stats: result.stats,
      /** The redesign is a design judgement and must be seen before it ships. */
      requiresReview: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Redesign failed';
    const friendly = /403|401/.test(msg)
      ? 'That site blocked our request. We cannot read it, so we cannot rebuild it.'
      : /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(msg)
        ? 'That domain could not be resolved. Check the address and try again.'
        : /timeout|ETIMEDOUT/i.test(msg)
          ? 'That site took too long to respond. Try again in a moment.'
          : msg;
    return NextResponse.json({ ok: false, error: friendly }, { status: 502 });
  }
}
