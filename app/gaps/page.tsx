'use client';

import { useEffect, useState } from 'react';

interface Gap {
  id: string;
  kind: 'no-field' | 'no-field-area';
  url: string;
  industry: string | null;
  city: string | null;
  region: string | null;
  locationSource: string | null;
  evidence: string | null;
  suggestedSlug: string | null;
  hits: number;
  firstSeenAt: string;
  lastSeenAt: string;
  summary: string;
}

export default function GapsPage() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/gaps')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setGaps(d.gaps);
        else setError(d.error ?? 'Could not load gaps.');
      })
      .catch(() => setError('Network error.'))
      .finally(() => setLoading(false));
  }, []);

  const buildable = gaps.filter((g) => g.suggestedSlug);

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-2xl mx-auto">
      <h1 className="text-[26px] font-bold tracking-tight mb-2">Field gaps</h1>
      <p className="text-[#8a8a96] text-[14px] leading-relaxed mb-7">
        Sites Vantage was asked to score but had no field for. Ordered by how many times
        each gap has been seen — this is the build queue.
      </p>

      {loading && <p className="text-[#5a5a66] text-[14px]">Loading…</p>}

      {error && (
        <div className="card p-4 border-[#5a2a2a] bg-[#1a1010] text-[14px] text-[#ff9b9b]">
          {error}
        </div>
      )}

      {!loading && !error && gaps.length === 0 && (
        <div className="card p-5">
          <p className="text-[14px] font-semibold mb-1">No gaps recorded yet</p>
          <p className="text-[13px] text-[#8a8a96] leading-relaxed">
            Every site that matches no field is recorded here automatically. Run a glow-up on
            a business outside your existing fields and it will appear.
          </p>
        </div>
      )}

      {buildable.length > 0 && (
        <>
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#5a5a66] mb-3">
            Ready to build ({buildable.length})
          </h2>
          <div className="space-y-3 mb-8">
            {buildable.map((g) => (
              <div key={g.id} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold">{g.summary}</p>
                    <p className="text-[12px] text-[#5a5a66] mt-0.5 break-all">{g.url}</p>
                  </div>
                  {g.hits > 1 && (
                    <span
                      className="text-[11px] font-bold px-2 py-1 rounded shrink-0"
                      style={{ background: '#1a1428', color: '#b8a6ff' }}
                    >
                      {g.hits}×
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {g.industry && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: '#15121f', color: '#b8a6ff' }}
                    >
                      {g.industry}
                    </span>
                  )}
                  {g.locationSource && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: '#101a14', color: '#4ade80' }}
                    >
                      {g.locationSource}
                    </span>
                  )}
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: '#1a1a1e', color: '#8a8a96' }}
                  >
                    {g.kind}
                  </span>
                </div>

                {g.evidence && (
                  <p className="text-[12px] text-[#8a8a96] mb-3 leading-relaxed">
                    Evidence: {g.evidence}
                  </p>
                )}

                <code className="block text-[11px] text-[#b8a6ff] bg-[#101014] p-2 rounded overflow-x-auto">
                  npx tsx scripts/build-field.ts --industry &quot;{g.industry}&quot; --location
                  &quot;{[g.city, g.region].filter(Boolean).join(', ')}&quot;
                </code>
              </div>
            ))}
          </div>
        </>
      )}

      {gaps.length > buildable.length && (
        <>
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#5a5a66] mb-3">
            Needs review ({gaps.length - buildable.length})
          </h2>
          <div className="space-y-2">
            {gaps
              .filter((g) => !g.suggestedSlug)
              .map((g) => (
                <div key={g.id} className="card p-3">
                  <p className="text-[13px]">{g.summary}</p>
                  <p className="text-[11px] text-[#5a5a66] mt-1 break-all">{g.url}</p>
                </div>
              ))}
          </div>
          <p className="text-[12px] text-[#5a5a66] mt-3 leading-relaxed">
            These matched no field and we could not read a location or industry with enough
            confidence to name a field. Usually a thin or JavaScript-rendered site.
          </p>
        </>
      )}
    </main>
  );
}
