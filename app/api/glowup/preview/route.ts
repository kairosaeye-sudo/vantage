import { getPreview } from '@/lib/preview-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serve one side of a glow-up preview as a real, renderable HTML document.
 *
 * GET /api/glowup/preview?id=<previewId>&side=before|after
 *
 * The rebuilt HTML is served in a sandboxed iframe on the preview page. Because
 * it is the customer's own page markup, we rewrite root-relative asset paths to
 * absolute so images and CSS still resolve, and inject a <base> tag for the
 * same reason. Scripts are stripped — a preview should never execute the
 * original site's JavaScript.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const rawSide = params.get('side');
  // Three views: the original, the technical fix, and the visual rebuild.
  const side: 'before' | 'after' | 'redesign' =
    rawSide === 'after' ? 'after' : rawSide === 'redesign' ? 'redesign' : 'before';
  // `annotate=0` lets the UI show the clean rebuilt page without outlines.
  const annotate = params.get('annotate') !== '0';

  if (!id) {
    return new Response('id required', { status: 400 });
  }

  const preview = await getPreview(id);
  if (!preview) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#888">
         Preview not found or expired.</body>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const source =
    side === 'after' ? preview.after : side === 'redesign' ? preview.redesigned : preview.before;

  if (side === 'redesign' && !source) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#888">
         No redesigned version for this run.</body>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const doc = makeRenderable(source ?? '', preview.url, side === 'after' && annotate);

  return new Response(doc, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cache: previews are per-run and contain the customer's content.
      'Cache-Control': 'no-store, max-age=0',
      // Defence in depth alongside the iframe sandbox.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'none'; img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; frame-ancestors 'self'",
    },
  });
}

/**
 * Highlights injected into the AFTER preview.
 *
 * Each applied fix is marked in the rebuilt HTML with
 * `data-vantage-fix="<findingId>"` plus a human label. Here we turn those marks
 * into a visible outline, a numbered badge, and an annotation callout, so the
 * customer can see exactly what changed instead of comparing two screenshots.
 *
 * The marks are attributes in the delivered HTML, so they cost nothing to carry
 * and this layer is purely presentational.
 */
const HIGHLIGHT_CSS = `
  [data-vantage-fix] {
    position: relative !important;
    outline: 3px solid #7c5cff !important;
    outline-offset: 3px !important;
    border-radius: 4px !important;
    animation: vantage-pulse 2.4s ease-in-out infinite;
  }
  [data-vantage-fix]::before {
    content: attr(data-vantage-fix-label);
    position: absolute !important;
    top: -11px !important;
    left: -3px !important;
    transform: translateY(-100%) !important;
    background: #7c5cff !important;
    color: #fff !important;
    font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    padding: 3px 8px !important;
    border-radius: 5px !important;
    white-space: nowrap !important;
    z-index: 2147483646 !important;
    pointer-events: none !important;
    box-shadow: 0 2px 8px rgba(0,0,0,.28) !important;
    letter-spacing: .2px !important;
    text-transform: none !important;
  }
  @keyframes vantage-pulse {
    0%, 100% { outline-color: #7c5cff; }
    50%      { outline-color: rgba(124,92,255,.35); }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-vantage-fix] { animation: none !important; }
  }
`;

function injectHighlights(html: string): string {
  const style = `<style id="vantage-highlights">${HIGHLIGHT_CSS}</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  }
  return style + html;
}

/** Rewrite a page so it renders standalone inside an iframe. */
function makeRenderable(html: string, baseUrl: string, highlight = false): string {
  let out = html;

  // Strip EXECUTABLE scripts only. JSON-LD (`application/ld+json`) is data, not
  // code — and it is frequently the very thing a glow-up adds (LocalBusiness,
  // FAQPage schema). Stripping it would hide the fix in the preview and make
  // the before/after comparison lie.
  const NON_EXECUTABLE = /application\/(ld\+json|json)|text\/template/i;
  out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs: string, body: string) => {
    if (NON_EXECUTABLE.test(attrs)) return match; // keep structured data intact
    void body;
    return '';
  });
  // Self-closing executable scripts with no type attribute.
  out = out.replace(/<script\b(?![^>]*type\s*=\s*["'][^"']*application\/(?:ld\+json|json))[^>]*\/>/gi, '');

  // Make root-relative URLs absolute so assets resolve from the origin.
  // (Guard against a double slash when baseUrl already ends with one.)
  const origin = baseUrl.replace(/\/+$/, '');
  out = out.replace(
    /(\s(?:href|src|action|poster)\s*=\s*)(["'])\/(?!\/)/gi,
    (_m, pre, q) => `${pre}${q}${origin}/`
  );

  // A <base> tag catches anything the regex missed (srcset, inline url()).
  const baseTag = `<base href="${origin}/">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  } else {
    out = `<head>${baseTag}</head>` + out;
  }

  // Only the AFTER view gets the change annotations.
  if (highlight) out = injectHighlights(out);

  return out;
}
