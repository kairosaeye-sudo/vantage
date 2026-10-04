import { NextResponse } from 'next/server';
import { listFieldGaps, listGapsSince, describeGap } from '@/lib/field-gaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Field coverage gaps — the industries and locations Vantage has been asked to
 * score but has no field for.
 *
 * GET /api/gaps                → all gaps, most-requested first
 * GET /api/gaps?since=<ISO>    → only gaps seen since that time (for polling)
 * GET /api/gaps?format=text    → a plain-text summary
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const format = params.get('format');
  const since = params.get('since');

  const gaps = since ? await listGapsSince(since) : await listFieldGaps(50);

  if (format === 'text') {
    if (gaps.length === 0) return new NextResponse('No new field gaps.', { status: 200 });
    const lines = gaps.map((g, i) => `${i + 1}. ${describeGap(g)}`);
    return new NextResponse(`New field gaps (${gaps.length}):\n${lines.join('\n')}`, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    count: gaps.length,
    gaps: gaps.map((g) => ({ ...g, summary: describeGap(g) })),
  });
}
