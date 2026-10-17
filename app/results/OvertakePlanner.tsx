'use client';

import { useMemo, useState } from 'react';

interface Rec {
  rank: number;
  category: string;
  scoreGain: number;
  finding: { label: string };
}

interface Peer {
  url: string;
  overall: number;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function percentile(score: number, peers: Peer[]): number {
  if (peers.length === 0) return 50;
  return Math.round((peers.filter((p) => p.overall < score).length / peers.length) * 100);
}

/**
 * Overtake planner — pick fixes, see who you pass.
 *
 * The recommendations already carry each fix's measured weight in the overall
 * score; this sums the ones selected and re-ranks against the real field. It
 * turns "here are 8 problems" into "fix these 3 and you pass beckettelectrical
 * for #4", which is the sentence that makes an owner act.
 */
export default function OvertakePlanner({
  overall,
  recommendations,
  peers,
  onGlowUp,
}: {
  overall: number;
  recommendations: Rec[];
  peers: Peer[];
  onGlowUp: () => void;
}) {
  const fixable = recommendations.filter((r) => r.scoreGain > 0);
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(fixable.slice(0, 3).map((r) => r.rank))
  );

  const plan = useMemo(() => {
    const gain = fixable.filter((r) => picked.has(r.rank)).reduce((s, r) => s + r.scoreGain, 0);
    const projected = Math.min(100, Math.round(overall + gain));
    const rankNow = 1 + peers.filter((p) => p.overall > overall).length;
    const rankThen = 1 + peers.filter((p) => p.overall > projected).length;
    const passed = peers.filter((p) => p.overall >= overall && p.overall < projected);
    const nextTarget = [...peers].reverse().find((p) => p.overall >= projected) ?? null;
    return {
      gain: Math.round(gain * 10) / 10,
      projected,
      rankNow,
      rankThen,
      passed,
      nextTarget,
      pctNow: percentile(overall, peers),
      pctThen: percentile(projected, peers),
    };
  }, [picked, fixable, overall, peers]);

  if (fixable.length === 0) return null;

  const toggle = (rank: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(rank)) n.delete(rank);
      else n.add(rank);
      return n;
    });

  const field = peers.length + 1;
  const hasField = peers.length > 0;

  return (
    <>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
        Overtake planner
      </h2>
      <div className="card mb-5 overflow-hidden">
        <div className="p-4 border-b border-[#1c1c21]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mb-1">Projected score</p>
              <p className="text-[34px] leading-none font-bold tabular-nums">
                <span className="text-[#5a5a66] text-[20px] font-semibold">{overall} → </span>
                <span className="text-[#b8a6ff]">{plan.projected}</span>
              </p>
            </div>
            {hasField && (
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mb-1">Rank</p>
                <p className="text-[22px] leading-none font-bold tabular-nums">
                  <span className="text-[#5a5a66] text-[15px]">#{plan.rankNow} → </span>#{plan.rankThen}
                  <span className="text-[#5a5a66] text-[13px] font-normal"> of {field}</span>
                </p>
              </div>
            )}
          </div>

          {hasField && (
            <div className="mt-4 space-y-1.5">
              {plan.passed.length > 0 ? (
                <p className="text-[13px] text-[#c9c9d2] leading-snug">
                  You&rsquo;d pass{' '}
                  {plan.passed.map((p, i) => (
                    <span key={p.url}>
                      {i > 0 && (i === plan.passed.length - 1 ? ' and ' : ', ')}
                      <span className="font-semibold text-white">{domain(p.url)}</span>
                      <span className="text-[#5a5a66]"> ({p.overall})</span>
                    </span>
                  ))}
                  .
                </p>
              ) : (
                <p className="text-[13px] text-[#8a8a96]">
                  {plan.gain > 0
                    ? 'Not enough to pass anyone yet — but it closes the gap.'
                    : 'Pick fixes below to see who you\u2019d pass.'}
                </p>
              )}
              {plan.nextTarget && (
                <p className="text-[12px] text-[#6a6a76]">
                  {plan.nextTarget.overall - plan.projected + 1} more{' '}
                  {plan.nextTarget.overall - plan.projected + 1 === 1 ? 'point' : 'points'} to pass{' '}
                  {domain(plan.nextTarget.url)} ({plan.nextTarget.overall}).
                </p>
              )}
              {!plan.nextTarget && plan.rankThen === 1 && (
                <p className="text-[12px] text-[#4ade80]">That puts you at the top of your field.</p>
              )}
              <p className="text-[12px] text-[#6a6a76]">
                Ahead of {plan.pctNow}% of the field today → {plan.pctThen}% after.
              </p>
            </div>
          )}
        </div>

        <div>
          {fixable.map((r) => {
            const on = picked.has(r.rank);
            return (
              <label
                key={r.rank}
                className="flex items-center gap-3 px-4 py-3 border-b border-[#1c1c21] last:border-0 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(r.rank)}
                  className="w-4 h-4 accent-[#7c5cff] shrink-0"
                />
                <span className={`flex-1 min-w-0 text-[14px] leading-snug ${on ? 'text-white' : 'text-[#8a8a96]'}`}>
                  {r.finding.label}
                  <span className="block text-[11px] uppercase tracking-wide text-[#5a5a66] mt-0.5">
                    {r.category}
                  </span>
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-[#7c5cff]">+{r.scoreGain}</span>
              </label>
            );
          })}
        </div>

        <div className="p-4 border-t border-[#1c1c21]">
          <button className="btn-primary" onClick={onGlowUp}>
            Have Vantage make these fixes
          </button>
          <p className="text-[11px] text-[#5a5a66] mt-2 leading-relaxed">
            Projection sums each fix&rsquo;s measured weight in your score, ranked against the field&rsquo;s
            last measured scores. The glow-up re-scores the result so the gain is verified, not assumed.
          </p>
        </div>
      </div>
    </>
  );
}
