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
  const side = params.get('side') === 'after' ? 'after' : 'before';

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

  const raw = side === 'after' ? preview.after : preview.before;
  const doc = makeRenderable(raw, preview.url);

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

/** Rewrite a page so it renders standalone inside an iframe. */
function makeRenderable(html: string, baseUrl: string): string {
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

  return out;
}
