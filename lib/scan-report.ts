import { getScan } from './db';
import type { SideBySide } from './compare';
import type { AiAnswerReport } from './ai-answers';

/**
 * A saved scan in the shape the results view renders.
 *
 * Scans saved before the full report was stored hold only the side-by-side, so
 * the field is recovered from its vertical label ("Electricians in Austin, TX").
 */
export interface ScanReport {
  scanId: string;
  measuredAt: string;
  side: SideBySide;
  field: { slug: string | null; industry: string; location: string };
  noFieldSuggestion: unknown;
  aiAnswers: AiAnswerReport | null;
}

export async function loadScanReport(id: string): Promise<ScanReport | null> {
  // Scan ids are UUIDs; anything else is not worth a query.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const scan = await getScan(id);
  if (!scan) return null;

  const r = scan.result as Record<string, unknown>;
  const side = (r.side ?? r) as SideBySide;
  if (!side?.you || !Array.isArray(side.rows)) return null;

  let field = r.field as ScanReport['field'] | undefined;
  if (!field) {
    const [industry, location] = String(side.field?.vertical ?? '').split(' in ');
    field = { slug: null, industry: industry || 'Your field', location: location ?? '' };
  }

  return {
    scanId: scan.id,
    measuredAt: new Date(scan.createdAt).toISOString(),
    side: { ...side, peers: side.peers ?? [] },
    field: { slug: field.slug ?? null, industry: field.industry, location: field.location },
    noFieldSuggestion: r.noFieldSuggestion ?? null,
    aiAnswers: (r.aiAnswers as AiAnswerReport | undefined) ?? null,
  };
}
