import { NextResponse } from 'next/server';
import { measureAnswerShare } from '@/lib/ai-answers';
import { loadScanReport } from '@/lib/scan-report';
import { setScanResultKey } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * AI Answer Share for a saved scan.
 *
 * POST { scanId, refresh? }
 *
 * Keyed on a scan rather than free-form input so the endpoint cannot be used as
 * an open model relay: the industry, location and competitor list all come from
 * what was already measured. A successful report is stored on the scan, so a
 * shared link shows it without paying for the model again.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { scanId?: string; refresh?: boolean };
    const report = body.scanId ? await loadScanReport(body.scanId) : null;
    if (!report) {
      return NextResponse.json({ ok: false, error: 'Scan not found.' }, { status: 404 });
    }
    if (report.aiAnswers?.ok && !body.refresh) {
      return NextResponse.json({ ok: true, report: report.aiAnswers, cached: true });
    }
    if (!report.field.location) {
      return NextResponse.json(
        { ok: false, error: 'This scan has no location to ask about.' },
        { status: 422 }
      );
    }

    const sites = [
      { url: report.side.you.url, isSelf: true },
      ...report.side.peers.map((p) => ({ url: p.url, isSelf: false })),
    ];
    const answers = await measureAnswerShare({
      industry: report.field.industry,
      location: report.field.location,
      sites,
    });

    if (answers.ok) {
      try {
        await setScanResultKey(report.scanId, 'aiAnswers', answers);
      } catch {
        // Caching is an optimisation; the customer still gets the answer.
      }
    }

    return NextResponse.json({ ok: true, report: answers, cached: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'AI answer check failed' },
      { status: 500 }
    );
  }
}
