import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadScanReport } from '@/lib/scan-report';
import ResultsView, { type Result } from '../../results/ResultsView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A saved scan as a permanent, shareable link.
 *
 * The score used to live only in the scorer's sessionStorage, so it died with
 * the tab and could not be forwarded to a business partner or web designer.
 * Every share is someone else seeing a site scored against its field — the
 * lead magnet working without us.
 */

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const report = await loadScanReport(params.id).catch(() => null);
  if (!report) return { title: 'Report not found — Vantage' };
  const { you, field } = report.side;
  const title = `${domain(you.url)} scored ${you.overall}/100 — Vantage`;
  const description = `${report.side.headline} Measured against ${field.siteCount} ${report.field.industry.toLowerCase()}${report.field.location ? ` in ${report.field.location}` : ''}.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function SharedReport({ params }: { params: { id: string } }) {
  const report = await loadScanReport(params.id).catch(() => null);
  if (!report) notFound();

  const data: Result = {
    scanId: report.scanId,
    measuredAt: report.measuredAt,
    side: report.side as unknown as Result['side'],
    field: report.field,
    noFieldSuggestion: report.noFieldSuggestion as Result['noFieldSuggestion'],
    aiAnswers: report.aiAnswers as Result['aiAnswers'],
  };
  return <ResultsView data={data} shared />;
}
