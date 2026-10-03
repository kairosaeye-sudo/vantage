'use client';

import { useEffect, useState } from 'react';

interface Field {
  slug: string;
  industry: string;
  location: string;
  siteCount: number;
  avg: number | null;
}

export default function Home() {
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldSlug, setFieldSlug] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingFields, setLoadingFields] = useState(true);

  useEffect(() => {
    fetch('/api/fields')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setFields(d.fields);
          if (d.fields.length > 0) setFieldSlug(d.fields[0].slug);
        }
      })
      .catch(() => setError('Could not load fields.'))
      .finally(() => setLoadingFields(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, fieldSlug, save: true }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Something went wrong.');
        setLoading(false);
        return;
      }
      // Hand the result to the results page via sessionStorage so the back
      // button behaves and the result survives a refresh.
      sessionStorage.setItem('vantage:result', JSON.stringify(data));
      window.location.href = '/results';
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  const selected = fields.find((f) => f.slug === fieldSlug);

  return (
    <main className="min-h-screen px-5 pt-14 pb-10 max-w-lg mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#7c5cff] flex items-center justify-center font-bold text-sm">
            V
          </div>
          <span className="font-semibold tracking-tight">Vantage</span>
        </div>
        <h1 className="text-[32px] leading-[1.15] font-bold tracking-tight mb-3">
          See how you rank
          <br />
          against your field.
        </h1>
        <p className="text-[#8a8a96] text-[15px] leading-relaxed">
          Measured, not guessed. Seven categories, scored against real competitors.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="url">
            Your website
          </label>
          <input
            id="url"
            className="field"
            type="text"
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

        <div>
          <label className="label" htmlFor="field">
            Your field
          </label>
          {loadingFields ? (
            <div className="field text-[#5a5a66]">Loading fields…</div>
          ) : fields.length === 0 ? (
            <div className="card p-4 text-[14px] text-[#8a8a96]">
              No fields yet.{' '}
              <a href="/build" className="text-[#7c5cff] font-semibold">
                Build one →
              </a>
            </div>
          ) : (
            <select
              id="field"
              className="field appearance-none"
              value={fieldSlug}
              onChange={(e) => setFieldSlug(e.target.value)}
            >
              {fields.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.industry} — {f.location} ({f.siteCount} sites)
                </option>
              ))}
            </select>
          )}
          {selected && (
            <p className="text-[12px] text-[#5a5a66] mt-2">
              Comparing you against {selected.siteCount} {selected.industry.toLowerCase()} sites
              {selected.avg !== null && ` · field average ${selected.avg}`}
            </p>
          )}
        </div>

        {error && (
          <div className="card p-4 border-[#5a2a2a] bg-[#1a1010] text-[14px] text-[#ff9b9b]">
            {error}
          </div>
        )}

        <button className="btn-primary" disabled={loading || !fieldSlug || !url}>
          {loading ? 'Scoring… this takes ~20s' : 'Score my site'}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-[#1c1c21]">
        <a href="/build" className="btn-ghost">
          Build a new field
        </a>
        <p className="text-[12px] text-[#5a5a66] mt-4 leading-relaxed">
          Enter your industry, location, and the sites you compete with. Vantage scores
          everyone and shows you exactly where you stand.
        </p>
      </div>
    </main>
  );
}
