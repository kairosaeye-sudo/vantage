'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function Build() {
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');
  const [sites, setSites] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ slug: string; siteCount: number; failedCount: number; avg: number | null } | null>(null);

  const parsed = sites
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/fields/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry, location, sites }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Build failed.');
        setLoading(false);
        return;
      }
      setDone({ slug: data.slug, ...data.field });
    } catch {
      setError('Network error. Try again.');
    }
    setLoading(false);
  }

  if (done) {
    return (
      <main className="min-h-screen px-5 pt-14 pb-10 max-w-lg mx-auto">
        <div className="card p-6 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#0f1a12] border border-[#1f3a26] flex items-center justify-center mb-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 10.5l4 4 8-9" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-[22px] font-bold mb-2">Field built</h1>
          <p className="text-[14px] text-[#8a8a96] leading-relaxed mb-5">
            Scored {done.siteCount} site{done.siteCount === 1 ? '' : 's'}
            {done.failedCount > 0 && ` (${done.failedCount} couldn't be reached)`}
            {done.avg !== null && ` · field average ${done.avg}`}.
          </p>
          <Link href="/" className="btn-primary mb-3">
            Score a site against it
          </Link>
        </div>
        <Link href="/build" className="btn-ghost" onClick={() => setDone(null)}>
          Build another field
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
      <Link href="/" className="text-[13px] text-[#8a8a96] mb-6 inline-block">
        ← Back
      </Link>

      <h1 className="text-[28px] font-bold tracking-tight mb-2">Build a field</h1>
      <p className="text-[#8a8a96] text-[15px] leading-relaxed mb-7">
        Pick any industry and location, then enter the sites you compete with. Vantage
        scores them all and makes that your benchmark.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="industry">
            Industry
          </label>
          <input
            id="industry"
            className="field"
            placeholder="Electricians"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="location">
            Location
          </label>
          <input
            id="location"
            className="field"
            placeholder="Austin, TX"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="sites">
            Competitor websites
          </label>
          <textarea
            id="sites"
            className="field font-mono text-[14px]"
            rows={7}
            placeholder={'competitor1.com\ncompetitor2.com\ncompetitor3.com'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={sites}
            onChange={(e) => setSites(e.target.value)}
          />
          <p className="text-[12px] text-[#5a5a66] mt-2">
            One per line, or comma-separated. {parsed.length > 0 && `${parsed.length} entered. `}
            Minimum 2, maximum 25.
          </p>
        </div>

        {error && (
          <div className="card p-4 border-[#5a2a2a] bg-[#1a1010] text-[14px] text-[#ff9b9b]">
            {error}
          </div>
        )}

        <button className="btn-primary" disabled={loading || parsed.length < 2 || !industry || !location}>
          {loading
            ? `Scoring ${parsed.length} sites… (~${parsed.length * 8}s)`
            : 'Build this field'}
        </button>
      </form>
    </main>
  );
}
