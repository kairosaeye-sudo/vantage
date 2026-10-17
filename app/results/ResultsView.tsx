'use client';

import { useState } from 'react';
import Link from 'next/link';
import OvertakePlanner from './OvertakePlanner';
import AiAnswers, { type AiAnswerReport } from './AiAnswers';
import HeadToHead from './HeadToHead';
import Leaderboard from '../components/Leaderboard';

interface FailingFinding {
  label: string;
  detail: string;
  status: string;
}

interface Row {
  category: string;
  label: string;
  you: number;
  fieldAvg: number;
  fieldMedian: number;
  leader: number;
  delta: number;
  verdict: 'leading' | 'above' | 'below' | 'lagging';
  failingFindings: FailingFinding[];
}

interface Recommendation {
  rank: number;
  category: string;
  scoreGain: number;
  businessCase: string;
  finding: { label: string; detail: string; status: string };
}

interface NoFieldSuggestion {
  detectedIndustry: string;
  detectedIndustryStrength: number;
  detectedCity: string | null;
  detectedRegion: string | null;
  locationSource: string | null;
  suggestedFieldSlug: string;
  suggestedFieldIndustry: string;
  suggestedFieldLocation: string;
  message: string;
}

export interface Result {
  scanId?: string | null;
  measuredAt?: string;
  side: {
    you: { url: string; overall: number; grade: string; percentile: number };
    field: { siteCount: number; avg: number; median: number };
    rows: Row[];
    recommendations: Recommendation[];
    /** Absent on scans saved before the overtake planner. */
    peers?: Array<{ url: string; overall: number; categories?: Record<string, number>; where?: string }>;
    headline: string;
  };
  field: { industry: string; location: string };
  noFieldSuggestion: NoFieldSuggestion | null;
  /** Who the site was compared against, when the comparison had to search wider. */
  comparison?: {
    scope: 'local' | 'nearby' | 'wider' | 'all';
    label: string;
    note: string | null;
    places: string[];
    nearestMiles: number | null;
  } | null;
  aiAnswers?: AiAnswerReport | null;
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

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function ResultsView({ data, shared = false }: { data: Result; shared?: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const { side, field } = data;
  const { you, rows, recommendations, headline } = side;
  const scanId = data.scanId ?? null;
  const peerList = side.peers ?? [];
  const wider = Boolean(data.comparison && data.comparison.scope !== 'local');
  const leader = peerList[0] ?? null;
  // Ties go to the competitor: a tie is not a win.
  const rank = 1 + peerList.filter((p) => p.overall >= you.overall).length;
  const goGlowUp = () => {
    sessionStorage.setItem('vantage:glowup-url', you.url);
    window.location.href = '/glowup';
  };

  async function share() {
    if (!scanId) return;
    const link = `${window.location.origin}/r/${scanId}`;
    const text = `${you.overall}/100 against ${side.field.siteCount} ${field.industry.toLowerCase()} — see how it ranks`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Vantage score', text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the person dismissed the share sheet */
    }
  }

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
      {/* Score hero */}
      <div className="card p-6 mb-5">
        <p className="text-[12px] uppercase tracking-wide text-[#5a5a66] mb-3">
          {field.industry}
          {field.location && ` — ${field.location}`}
        </p>

        {peerList.length > 0 && (
          <p className="text-[22px] font-bold tracking-tight leading-tight mb-3">
            You rank <span style={{ color: gradeColor(you.grade) }}>#{rank}</span>
            <span className="text-[#5a5a66]"> of {peerList.length + 1}</span>
            {wider && <span className="block text-[13px] font-semibold text-[#b8a6ff] mt-1">among {data.comparison!.label}</span>}
            {leader && rank > 1 && (
              <span className="block text-[13px] font-normal text-[#8a8a96] mt-1">
                {domainOf(leader.url)} leads at {leader.overall}. You&rsquo;re {leader.overall - you.overall} points behind.
              </span>
            )}
          </p>
        )}

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

      {/* The comparison had to search wider than their town — say so, plainly */}
      {wider && data.comparison!.note && (
        <div className="card p-4 mb-5 border-l-2 border-l-[#7c5cff]">
          <p className="text-[12px] uppercase tracking-wide text-[#b8a6ff] font-semibold mb-1.5">
            {data.comparison!.scope === 'nearby'
              ? 'Searched nearby'
              : data.comparison!.scope === 'wider'
                ? 'Searched wider'
                : 'Searched every field'}
          </p>
          <p className="text-[13px] text-[#a0a0ac] leading-relaxed">{data.comparison!.note}</p>
          <p className="text-[12px] text-[#5a5a66] mt-2 leading-relaxed">
            We&rsquo;ve logged {field.location ? field.location : 'your area'} as a field to build — your next
            score will be against your own local competitors.
          </p>
        </div>
      )}

      {/* The field, by name */}
      {peerList.length > 0 && (
        <>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
            {wider ? `Compared with ${data.comparison!.label}` : 'Your field'}
          </h2>
          <div className="card p-3 mb-5">
            <Leaderboard peers={peerList} marks={[{ label: `You · ${domainOf(you.url)}`, score: you.overall, tone: 'you' }]} />
          </div>
        </>
      )}

      {/* The free glow-up: the hook after the hurt */}
      <div className="card p-5 mb-5" style={{ background: 'linear-gradient(135deg,#1a1430,#121215)', borderColor: '#3b2f7a' }}>
        <p className="text-[11px] uppercase tracking-wide text-[#b8a6ff] font-semibold mb-1.5">Free · about a minute</p>
        <p className="text-[18px] font-bold leading-snug mb-1.5">See your site rebuilt to beat them</p>
        <p className="text-[13px] text-[#a0a0ac] leading-relaxed mb-4">
          We redesign your homepage from your own content, then score it against the same{' '}
          {peerList.length ? `${peerList.length} competitors` : 'field'} — so you see exactly where it would rank.
        </p>
        <button className="btn-primary" onClick={goGlowUp}>
          Glow up my homepage — free
        </button>
      </div>

      {scanId && (
        <div className="flex gap-2 mb-5">
          <button className="btn-ghost flex-1" onClick={share}>
            {copied ? 'Link copied' : shared ? 'Share this report' : 'Share your report'}
          </button>
          {data.measuredAt && (
            <span className="self-center text-[11px] text-[#5a5a66] shrink-0">
              Measured {new Date(data.measuredAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      <AiAnswers
        scanId={scanId}
        initial={data.aiAnswers ?? null}
        industry={field.industry}
        location={field.location}
      />

      {/* Inline site preview */}
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
        Your site right now
      </h2>
      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-[#1c1c21] bg-[#0e0e10] px-4 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#f87171]" />
          <span className="w-2 h-2 rounded-full bg-[#fbbf24]" />
          <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
          <span className="text-[11px] text-[#5a5a66] ml-2 truncate">{you.url}</span>
        </div>
        <iframe
          src={you.url}
          className="w-full h-64 border-0 bg-white"
          sandbox="allow-same-origin allow-scripts"
          loading="lazy"
          title="Your current site"
        />
      </div>

      <HeadToHead rows={rows} you={{ url: you.url, overall: you.overall }} peers={peerList} />

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
          const isOpen = expanded[r.category] ?? false;
          const failing = (r as any).failingFindings as Array<{ label: string; detail: string; status: string }> | undefined;
          const hasFindings = failing && failing.length > 0;
          return (
            <div key={r.category} className="border-b border-[#1c1c21] last:border-0">
              <button
                className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-3.5 items-center text-left"
                onClick={() => hasFindings && setExpanded((s) => ({ ...s, [r.category]: !isOpen }))}
                disabled={!hasFindings}
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
              </button>
              {isOpen && hasFindings && (
                <div className="px-4 pb-3 space-y-2">
                  {failing.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span
                        className="shrink-0 w-1.5 h-1.5 rounded-full mt-1.5"
                        style={{
                          background: f.status === 'fail' ? '#f87171' : f.status === 'warn' ? '#fbbf24' : '#8a8a96',
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] text-[#a0a0ac] leading-snug">{f.label}</p>
                        {f.detail && (
                          <p className="text-[12px] text-[#6a6a76] leading-snug mt-0.5">{f.detail}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <OvertakePlanner
        overall={you.overall}
        recommendations={recommendations}
        peers={side.peers ?? []}
        onGlowUp={goGlowUp}
      />

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
        {shared ? 'Score your own site' : 'Score another site'}
      </Link>
      <button className="btn-primary mb-3" onClick={goGlowUp}>
        Glow up my homepage — free
      </button>
      <Link href="/watch" className="btn-ghost">
        Monitor it weekly — $149/mo
      </Link>
    </main>
  );
}
