'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Row {
  category: string;
  label: string;
  you: number;
  fieldAvg: number;
  fieldMedian: number;
  leader: number;
  delta: number;
  verdict: 'leading' | 'above' | 'below' | 'lagging';
}

interface Recommendation {
  rank: number;
  category: string;
  scoreGain: number;
  businessCase: string;
  finding: { label: string; detail: string; status: string };
}

interface Result {
  ok: boolean;
  side: {
    you: { url: string; overall: number; grade: string; percentile: number };
    field: { siteCount: number; avg: number; median: number };
    rows: Row[];
    recommendations: Recommendation[];
    headline: string;
  };
  field: { industry: string; location: string };
}

const VERDICT_STYLE: Record<string, { color: string; bg: string; text: string }> = {
  leading: { color: '#4ade80', bg: '#0f1a12', text: 'LEADING' },
  above: { color: '#86efac', bg: '#0f1a12', text: 'ABOVE' },
  below: { color: '#fbbf24', bg: '#1a1508', text: 'BELOW' },
  lagging: { color: '#f87171', bg: '#1a1010', text: 'LAGGING' },
};

function gradeColor(grade: string): string {
  if (grade === 'elite') return '#4ade80';
  if (grade === 'strong') return '#a3e635';
  if (grade === 'developing') return '#fbbf24';
  return '#f87171';
}

export default function Results() {
  const [data, setData] = useState<Result | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('vantage:result');
    if (!raw) {
      setMissing(true);
      return;
    }
    try {
      setData(JSON.parse(raw));
    } catch {
      setMissing(true);
    }
  }, []);

  if (missing) {
    return (
      <main className="min-h-screen px-5 pt-20 max-w-lg mx-auto text-center">
        <p className="text-[#8a8a96] mb-6">No result to show.</p>
        <Link href="/" className="btn-primary inline-flex">
          Score a site
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen px-5 pt-20 max-w-lg mx-auto">
        <p className="text-[#8a8a96]">Loading…</p>
      </main>
    );
  }

  const { side, field } = data;
  const { you, rows, recommendations, headline } = side;

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
      {/* Score hero */}
      <div className="card p-6 mb-5">
        <p className="text-[12px] uppercase tracking-wide text-[#5a5a66] mb-3">
          {field.industry} — {field.location}
        </p>

        <div className="flex items-end gap-3 mb-1">
          <span
            className="text-[56px] leading-none font-bold tracking-tight"
            style={{ color: gradeColor(you.grade) }}
          >
            {you.overall}
          </span>
          <span className="text-[#5a5a66] text-lg mb-1">/100</span>
          <span
            className="chip mb-2 ml-auto"
            style={{
              color: gradeColor(you.grade),
              background: 'rgba(255,255,255,0.05)',
            }}
          >
            {you.grade}
          </span>
        </div>

        {/* Percentile bar */}
        <div className="mt-4 mb-2 h-2 rounded-full bg-[#1c1c21] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(you.percentile, 2)}%`,
              background: gradeColor(you.grade),
            }}
          />
        </div>
        <p className="text-[13px] text-[#8a8a96] leading-relaxed">{headline}</p>
        <p className="text-[12px] text-[#5a5a66] mt-2 break-all">{you.url}</p>
      </div>

      {/* Side by side */}
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
        Side by side
      </h2>
      <div className="card mb-5 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-3 border-b border-[#1c1c21] text-[11px] uppercase tracking-wide text-[#5a5a66]">
          <span>Category</span>
          <span className="w-9 text-right">You</span>
          <span className="w-9 text-right">Field</span>
          <span className="w-11 text-right">Best</span>
        </div>
        {rows.map((r) => {
          const v = VERDICT_STYLE[r.verdict] ?? VERDICT_STYLE.below;
          return (
            <div
              key={r.category}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-3.5 border-b border-[#1c1c21] last:border-0 items-center"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium truncate">{r.label}</p>
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: v.color }}>
                  {v.text}
                  {r.delta !== 0 && (
                    <span className="text-[#5a5a66] font-normal">
                      {' '}
                      {r.delta > 0 ? '+' : ''}
                      {r.delta}
                    </span>
                  )}
                </p>
              </div>
              <span
                className="w-9 text-right text-[15px] font-semibold tabular-nums"
                style={{ color: v.color }}
              >
                {r.you}
              </span>
              <span className="w-9 text-right text-[15px] text-[#8a8a96] tabular-nums">
                {r.fieldAvg}
              </span>
              <span className="w-11 text-right text-[15px] text-[#5a5a66] tabular-nums">
                {r.leader}
              </span>
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
            What to fix first
          </h2>
          <div className="space-y-3 mb-8">
            {recommendations.slice(0, 6).map((rec) => (
              <div key={rec.rank} className="card p-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="shrink-0 w-6 h-6 rounded-md bg-[#7c5cff] text-white text-[12px] font-bold flex items-center justify-center">
                    {rec.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold leading-snug">{rec.finding.label}</p>
                    <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mt-1">
                      {rec.category}
                      {rec.scoreGain > 0 && (
                        <span className="text-[#7c5cff]"> · +{rec.scoreGain} pts</span>
                      )}
                    </p>
                  </div>
                </div>
                {rec.finding.detail && (
                  <p className="text-[13px] text-[#a0a0ac] leading-relaxed mb-2">
                    {rec.finding.detail}
                  </p>
                )}
                <p className="text-[12px] text-[#6a6a76] leading-relaxed italic">
                  {rec.businessCase}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <Link href="/" className="btn-ghost mb-3">
        Score another site
      </Link>
      <button
        className="btn-primary mb-3"
        onClick={() => {
          sessionStorage.setItem('vantage:glowup-url', you.url);
          window.location.href = '/glowup';
        }}
      >
        Glow up this site
      </button>
      <Link href="/watch" className="btn-ghost">
        Monitor it weekly — $49/mo
      </Link>
    </main>
  );
}
