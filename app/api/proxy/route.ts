import { NextResponse } from 'next/server';
import { fetchSite } from '@/lib/fetch-site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxy endpoint for loading competitor sites in the preview iframe.
 *
 * Many sites block iframe embedding via X-Frame-Options, so we fetch the
 * HTML server-side and serve it from our origin. This lets the preview
 * pane show competitor sites alongside our redesign.
 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return NextResponse.json({ ok: false, error: 'url required' }, { status: 400 });
  }

  try {
    const f = await fetchSite(url);
    return new NextResponse(f.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': "frame-ancestors 'self'",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not fetch site' }, { status: 422 });
  }
}
