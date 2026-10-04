'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Fix {
  findingId: string;
  label: string;
  category: string;
  points: number;
  rationale: string;
}

interface CatScore {
  label: string;
  score: number;
}

interface RedesignInfo {
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
}

interface Result {
  previewId?: string;
  record: {
    url: string;
    beforeScore: number;
    afterScore: number;
    verifiedGain: number;
    appliedCount: number;
    skipped: Array<{ findingId: string; reason: string }>;
    files: string[];
  };
  plan: {
    fixes: Fix[];
    needsWork: Array<{ findingId: string; label: string; category: string; reason: string }>;
    estimatedScore: number;
    estimatedGain: number;
  };
  before: { overall: number; grade: string; categories: CatScore[] };
  after: { overall: number; grade: string; categories: CatScore[] };
  redesign: RedesignInfo | null;
  redesignError: string | null;
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

export default function GlowUp() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    const prefill = sessionStorage.getItem('vantage:glowup-url');
    if (prefill) {
      setUrl(prefill);
      sessionStorage.removeItem('vantage:glowup-url');
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const watchId = sessionStorage.getItem('vantage:watchId') ?? undefined;
      const r = await fetch('/api/glowup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, watchId }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Glow-up failed.');
        setLoading(false);
        return;
      }
      setRes(data);
    } catch {
      setError('Network error. Try again.');
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen px-5 pt-20 max-w-lg mx-auto text-center">
        <div className="card p-6">
          <p className="text-[15px] font-semibold mb-2">Glowing up your site…</p>
          <p className="text-[13px] text-[#8a8a96] leading-relaxed">
            Scoring the original, applying fixes, re-scoring to verify the gain, then rebuilding
            the design from your real content. About 45 seconds.
          </p>
        </div>
      </main>
    );
  }

  if (res) {
    const { record, before, after, plan } = res;
    const gained = record.verifiedGain;

    return (
      <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
        {/* Verified result */}
        <div className="card p-6 mb-5">
          <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mb-3">
            Verified result
          </p>
          <div className="flex items-center gap-4 mb-3">
            <div>
              <p className="text-[36px] font-bold leading-none text-[#8a8a96]">
                {before.overall}
              </p>
              <p className="text-[11px] text-[#5a5a66] mt-1">BEFORE</p>
            </div>
            <span className="text-[24px] text-[#5a5a66]">→</span>
            <div>
              <p className="text-[36px] font-bold leading-none text-[#4ade80]">
                {after.overall}
              </p>
              <p className="text-[11px] text-[#5a5a66] mt-1">AFTER</p>
            </div>
            <div className="ml-auto text-right">
              <p
                className="text-[24px] font-bold leading-none"
                style={{ color: gained > 0 ? '#4ade80' : '#8a8a96' }}
              >
                {gained > 0 ? '+' : ''}
                {gained}
              </p>
              <p className="text-[11px] text-[#5a5a66] mt-1">POINTS</p>
            </div>
          </div>
          <p className="text-[12px] text-[#5a5a66] leading-relaxed">
            Measured by re-scoring the rebuilt page through the same engine — not an estimate.
            {record.appliedCount} fixes applied.
          </p>

          {res.previewId && (
            <a
              href={`/glowup/preview?id=${res.previewId}`}
              className="btn-primary mt-4"
            >
              View before &amp; after
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
          )}
        </div>

        {/* Visual rebuild — the other half of the glow-up */}
        {res.redesign && (
          <>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
              Modern redesign
            </h2>
            <div className="card p-4 mb-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{res.redesign.template.label}</p>
                  <p className="text-[12px] text-[#5a5a66] mt-0.5">
                    {res.redesign.content.businessName} — {res.redesign.stats.sections} sections
                    rebuilt
                  </p>
                </div>
                <span
                  className="text-[11px] font-semibold px-2 py-1 rounded shrink-0"
                  style={{ background: '#15121f', color: '#b8a6ff' }}
                >
                  {res.redesign.changes.length} changes
                </span>
              </div>

              <p className="text-[12px] text-[#8a8a96] leading-relaxed mb-3">
                Your real content — services, reviews, photos, phone — re-rendered in a modern
                layout. Nothing invented.
              </p>

              <div className="space-y-1.5 mb-3">
                {[
                  ['Services', res.redesign.content.services.length],
                  ['Reviews', res.redesign.content.testimonialCount],
                  ['Photos', res.redesign.content.imageCount],
                  ['Hours', res.redesign.content.hoursCount],
                ]
                  .filter(([, n]) => (n as number) > 0)
                  .map(([k, n]) => (
                    <div key={k as string} className="flex justify-between text-[13px]">
                      <span className="text-[#8a8a96]">{k} used</span>
                      <span className="tabular-nums">{n}</span>
                    </div>
                  ))}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {Array.from(new Set(res.redesign.changes.map((c) => c.kind))).map((k) => (
                  <span
                    key={k}
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: '#1a1428', color: '#b8a6ff' }}
                  >
                    {KIND_LABEL[k] ?? k}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {res.redesignError && (
          <div className="card p-4 mb-5" style={{ background: '#16161a' }}>
            <p className="text-[13px] font-semibold mb-1">Design rebuild not available</p>
            <p className="text-[12px] text-[#8a8a96] leading-relaxed">{res.redesignError}</p>
          </div>
        )}

        {/* Category movement */}
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
          What moved
        </h2>
        <div className="card mb-5 overflow-hidden">
          {after.categories.map((c, i) => {
            const b = before.categories[i]?.score ?? 0;
            const d = c.score - b;
            return (
              <div
                key={c.label}
                className="flex items-center justify-between px-4 py-3 border-b border-[#1c1c21] last:border-0"
              >
                <span className="text-[14px]">{c.label}</span>
                <span className="text-[13px] tabular-nums text-[#8a8a96]">
                  {b} → {c.score}
                  <span
                    className="ml-2 font-semibold"
                    style={{ color: d > 0 ? '#4ade80' : d < 0 ? '#f87171' : '#5a5a66' }}
                  >
                    {d > 0 ? `+${d}` : d === 0 ? '—' : d}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Applied */}
        {plan.fixes.length > 0 && (
          <>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
              Fixes applied
            </h2>
            <div className="space-y-2 mb-5">
              {plan.fixes.map((f) => (
                <div key={f.findingId} className="card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[14px] font-medium leading-snug">{f.label}</span>
                    <span className="text-[12px] text-[#7c5cff] font-semibold shrink-0">
                      +{f.points}
                    </span>
                  </div>
                  <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mt-1">
                    {f.category}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Honest limits */}
        {(plan.needsWork.length > 0 || record.skipped.length > 0) && (
          <>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
              What a rebuild can&apos;t fix
            </h2>
            <div className="space-y-2 mb-5">
              {plan.needsWork.map((n) => (
                <div key={n.findingId} className="card p-3.5" style={{ background: '#16161a' }}>
                  <p className="text-[14px] font-medium leading-snug mb-1">{n.label}</p>
                  <p className="text-[12px] text-[#8a8a96] leading-relaxed">{n.reason}</p>
                </div>
              ))}
              {record.skipped.map((s) => (
                <div key={s.findingId} className="card p-3.5" style={{ background: '#16161a' }}>
                  <p className="text-[12px] text-[#8a8a96] leading-relaxed">{s.reason}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {record.files.length > 0 && (
          <div className="card p-4 mb-5">
            <p className="text-[13px] font-semibold mb-1">Also generated</p>
            <p className="text-[12px] text-[#8a8a96] font-mono">
              {record.files.join(' · ')}
            </p>
          </div>
        )}

        <div className="card p-4 mb-5" style={{ background: '#15121f', borderColor: '#7c5cff' }}>
          <p className="text-[14px] font-semibold mb-1.5">Keep going</p>
          <p className="text-[13px] text-[#a0a0ac] leading-relaxed mb-3">
            Monitoring re-checks this weekly. When the field moves ahead again, you&apos;ll get the
            next round of fixes.
          </p>
          <Link href="/watch" className="btn-primary">
            Start monitoring — $49/mo
          </Link>
        </div>

        <Link href="/glowup" className="btn-ghost" onClick={() => setRes(null)}>
          Glow up another site
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
      <Link href="/" className="text-[13px] text-[#8a8a96] mb-6 inline-block">
        ← Back
      </Link>

      <h1 className="text-[28px] font-bold tracking-tight mb-2">Glow up</h1>
      <p className="text-[#8a8a96] text-[15px] leading-relaxed mb-7">
        We fix what the check found, then rebuild the page in a modern design — keeping your real
        content. You get both versions side by side.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="url">
            Your website
          </label>
          <input
            id="url"
            className="field"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="yourbusiness.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="card p-4 border-[#5a2a2a] bg-[#1a1010] text-[14px] text-[#ff9b9b]">
            {error}
          </div>
        )}

        <button className="btn-primary" disabled={loading || !url}>
          {loading ? 'Rebuilding…' : 'Glow up my site'}
        </button>
      </form>

      <p className="text-[12px] text-[#5a5a66] mt-5 leading-relaxed">
        We will not invent facts about your business. Anything needing your real address,
        phone number, social profiles or booking tool is listed as a gap instead.
      </p>
    </main>
  );
}
