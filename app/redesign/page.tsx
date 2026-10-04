'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Change {
  label: string;
  detail: string;
  kind: string;
}

interface Result {
  previewId: string;
  url: string;
  template: { id: string; label: string; suitedTo: string; accent: string };
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
  changes: Change[];
  omitted: Array<{ section: string; reason: string }>;
  needsFromClient: string[];
  stats: { beforeBytes: number; afterBytes: number; sections: number };
  requiresReview: boolean;
}

const KIND_LABEL: Record<string, string> = {
  mobile: 'Mobile',
  type: 'Typography',
  colour: 'Colour',
  layout: 'Layout',
  structure: 'Structure',
  content: 'Content',
  motion: 'Motion',
};

const TEMPLATES = [
  { id: '', label: 'Auto', hint: 'Pick from the business type' },
  { id: 'trades', label: 'Trades', hint: 'Electricians, plumbers, HVAC' },
  { id: 'professional', label: 'Professional', hint: 'Accountants, lawyers, clinics' },
  { id: 'hospitality', label: 'Hospitality', hint: 'Restaurants, cafés, salons' },
];

export default function RedesignPage() {
  const [url, setUrl] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  // Arriving from the results page pre-fills the address they already scored.
  useEffect(() => {
    const carried = sessionStorage.getItem('vantage:glowup-url');
    if (carried) setUrl(carried);
  }, []);

  async function run() {
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, template: template || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Something went wrong.');
      } else {
        setResult(data);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 py-10 max-w-2xl mx-auto">
      <Link href="/" className="text-[13px] text-[#8a8a96]">
        ← Home
      </Link>

      <h1 className="text-2xl font-bold mt-5 mb-2">Redesign a site</h1>
      <p className="text-[14px] text-[#8a8a96] leading-relaxed mb-7">
        We read the real content of an existing site — its name, services, phone, hours,
        reviews and photos — then rebuild the page through a modern design system. Same
        business, same words, entirely new presentation.
      </p>

      <div className="card p-4 mb-4">
        <label htmlFor="url" className="text-[13px] font-semibold block mb-2">
          Website address
        </label>
        <input
          id="url"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="yourbusiness.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          className="w-full"
        />

        <p className="text-[13px] font-semibold mt-4 mb-2">Template</p>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id || 'auto'}
              onClick={() => setTemplate(t.id)}
              className="text-left px-3 py-2 rounded-lg border transition-colors"
              style={
                template === t.id
                  ? { borderColor: '#7c5cff', background: '#15121f' }
                  : { borderColor: '#26262c' }
              }
            >
              <span className="text-[13px] font-semibold block">{t.label}</span>
              <span className="text-[11px] text-[#5a5a66] block mt-0.5">{t.hint}</span>
            </button>
          ))}
        </div>

        <button
          onClick={run}
          disabled={busy || !url.trim()}
          className="btn-primary w-full mt-5 disabled:opacity-40"
        >
          {busy ? 'Reading the site…' : 'Redesign this site'}
        </button>
      </div>

      {error && (
        <div className="card p-4 mb-4" style={{ borderColor: '#7f1d1d' }}>
          <p className="text-[14px] text-[#fca5a5]">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold">{result.content.businessName}</p>
                <p className="text-[12px] text-[#5a5a66] mt-0.5 truncate">{result.url}</p>
              </div>
              <span
                className="text-[11px] font-semibold px-2 py-1 rounded shrink-0"
                style={{ background: '#15121f', color: '#b8a6ff' }}
              >
                {result.template.label}
              </span>
            </div>

            <Link
              href={`/glowup/preview?id=${result.previewId}`}
              className="btn-primary w-full mt-4 block text-center"
            >
              View before &amp; after
            </Link>

            <p className="text-[12px] text-[#5a5a66] mt-3 leading-relaxed">
              A redesign is a design judgement — unlike the technical check, it cannot be
              verified by re-scoring. Review it before sending it to a client.
            </p>
          </div>

          <div className="card p-4">
            <p className="text-[13px] font-semibold mb-3">Content we used (from your site)</p>
            <dl className="space-y-2 text-[13px]">
              {[
                ['Headline', result.content.headline],
                ['Phone', result.content.phone],
                ['Address', result.content.address],
                ['Services', result.content.services.length ? `${result.content.services.length} found` : null],
                ['Reviews', result.content.testimonialCount ? `${result.content.testimonialCount} found` : null],
                ['Photos', result.content.imageCount ? `${result.content.imageCount} found` : null],
                ['Hours', result.content.hoursCount ? `${result.content.hoursCount} found` : null],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-4">
                    <dt className="text-[#8a8a96] shrink-0">{k}</dt>
                    <dd className="text-right truncate">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>

          <div className="card p-4">
            <p className="text-[13px] font-semibold mb-3">
              What changed ({result.changes.length})
            </p>
            <ul className="space-y-3">
              {result.changes.map((c) => (
                <li key={c.label}>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: '#1a1428', color: '#b8a6ff' }}
                    >
                      {KIND_LABEL[c.kind] ?? c.kind}
                    </span>
                    <span className="text-[13px] font-medium">{c.label}</span>
                  </div>
                  <p className="text-[12px] text-[#8a8a96] leading-relaxed mt-1">{c.detail}</p>
                </li>
              ))}
            </ul>
          </div>

          {result.omitted.length > 0 && (
            <div className="card p-4">
              <p className="text-[13px] font-semibold mb-1">Sections left out</p>
              <p className="text-[12px] text-[#5a5a66] mb-3 leading-relaxed">
                We only render content that actually exists on your site. Nothing here was
                invented.
              </p>
              <ul className="space-y-2">
                {result.omitted.map((o) => (
                  <li key={o.section} className="text-[13px]">
                    <span className="font-medium">{o.section}</span>
                    <span className="text-[#8a8a96]"> — {o.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.needsFromClient.length > 0 && (
            <div className="card p-4">
              <p className="text-[13px] font-semibold mb-3">To finish this, we need</p>
              <ul className="space-y-2">
                {result.needsFromClient.map((n) => (
                  <li key={n} className="text-[13px] flex gap-2">
                    <span className="text-[#7c5cff]">•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
