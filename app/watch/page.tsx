'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Field {
  slug: string;
  industry: string;
  location: string;
  siteCount: number;
}

export default function WatchPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [email, setEmail] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [fieldSlug, setFieldSlug] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/fields')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setFields(d.fields);
          if (d.fields.length) setFieldSlug(d.fields[0].slug);
        }
      })
      .catch(() => setError('Could not load fields.'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, siteUrl, fieldSlug, cadence }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Could not start monitoring.');
        setLoading(false);
        return;
      }
      sessionStorage.setItem('vantage:watchId', data.watchId);
      setDone(data.watchId);
    } catch {
      setError('Network error. Try again.');
    }
    setLoading(false);
  }

  if (done) {
    return (
      <main className="min-h-screen px-5 pt-14 pb-10 max-w-lg mx-auto">
        <div className="card p-6 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#0f1a12] border border-[#1f3a26] flex items-center justify-center mb-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 10.5l4 4 8-9" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-[22px] font-bold mb-2">Monitoring is on</h1>
          <p className="text-[14px] text-[#8a8a96] leading-relaxed mb-1">
            We&apos;ll re-score your site and every competitor{' '}
            {cadence === 'daily' ? 'every day' : 'every week'}.
          </p>
          <p className="text-[13px] text-[#5a5a66] leading-relaxed mb-5">
            You&apos;ll hear from us when a competitor moves ahead of you, when something on
            your site regresses, and when a fix lands.
          </p>
          <a href={`/watch/dashboard?id=${done}`} className="btn-primary">
            Open my dashboard
          </a>
        </div>
        <Link href="/" className="btn-ghost">
          Back to scoring
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
      <Link href="/" className="text-[13px] text-[#8a8a96] mb-6 inline-block">
        ← Back
      </Link>

      <h1 className="text-[28px] font-bold tracking-tight mb-2">Stay ahead</h1>
      <p className="text-[#8a8a96] text-[15px] leading-relaxed mb-7">
        We re-score your site and your competitors on a schedule. When someone moves ahead
        of you, you&apos;ll know — and what to do about it.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="field"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="you@yourbusiness.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="site">
            Your website
          </label>
          <input
            id="site"
            className="field"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="yourbusiness.com"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="field">
            Monitor against
          </label>
          <select
            id="field"
            className="field appearance-none"
            value={fieldSlug}
            onChange={(e) => setFieldSlug(e.target.value)}
          >
            {fields.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.industry} — {f.location} ({f.siteCount} competitors)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">How often</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { v: 'weekly', t: 'Weekly', d: 'Every 7 days' },
              { v: 'daily', t: 'Daily', d: 'Every 24 hours' },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setCadence(o.v)}
                className={`card p-4 text-left transition-colors ${
                  cadence === o.v ? 'border-[#7c5cff] bg-[#15121f]' : ''
                }`}
              >
                <p className="text-[15px] font-semibold mb-1">{o.t}</p>
                <p className="text-[12px] text-[#5a5a66]">{o.d}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="card p-4 border-[#5a2a2a] bg-[#1a1010] text-[14px] text-[#ff9b9b]">
            {error}
          </div>
        )}

        <button className="btn-primary" disabled={loading || !email || !siteUrl || !fieldSlug}>
          {loading ? 'Starting…' : 'Start monitoring'}
        </button>
      </form>
    </main>
  );
}
