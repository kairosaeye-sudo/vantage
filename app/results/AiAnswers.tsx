'use client';

import { useState } from 'react';

interface Row {
  url: string;
  isSelf: boolean;
  appearances: number;
  firstPlace: number;
  share: number;
  avgPosition: number | null;
}

interface Probe {
  question: string;
  mentions: Array<{ name: string; position: number; matchedUrl: string | null }>;
  error?: string;
}

export interface AiAnswerReport {
  ok: boolean;
  reason?: string;
  model: string | null;
  industry: string;
  location: string;
  answered: number;
  probes: Probe[];
  rows: Row[];
  you: Row | null;
  unlistedRivals: Array<{ name: string; website: string | null; appearances: number }>;
  verdict: string;
  measuredAt: string;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * "Does AI recommend you?" — the output side of AI Visibility.
 *
 * Runs on demand rather than with the score: it costs model calls, and the
 * moment someone clicks to ask is the moment they care about the answer.
 */
export default function AiAnswers({
  scanId,
  initial,
  industry,
  location,
}: {
  scanId: string | null;
  initial: AiAnswerReport | null;
  industry: string;
  location: string;
}) {
  const [report, setReport] = useState<AiAnswerReport | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showProbes, setShowProbes] = useState(false);

  async function run() {
    if (!scanId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai-answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? 'Could not ask the AI.');
      else setReport(data.report);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const where = location || 'your area';

  return (
    <>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
        Does AI recommend you?
      </h2>
      <div className="card mb-5 overflow-hidden">
        {!report || !report.ok ? (
          <div className="p-4">
            <p className="text-[14px] text-[#c9c9d2] leading-relaxed mb-1">
              Customers now ask ChatGPT, Claude and Gemini &ldquo;who&rsquo;s the best{' '}
              {industry.toLowerCase()} in {where}?&rdquo;
            </p>
            <p className="text-[13px] text-[#8a8a96] leading-relaxed mb-4">
              We ask an AI assistant four ways a customer would, and show who it names — you, or your
              competitors.
            </p>
            {report && !report.ok && (
              <p className="text-[13px] text-[#fbbf24] mb-3">{report.verdict}</p>
            )}
            {error && <p className="text-[13px] text-[#ff9b9b] mb-3">{error}</p>}
            {scanId ? (
              <button className="btn-ghost" onClick={run} disabled={loading || report?.reason === 'not-configured'}>
                {loading ? 'Asking the AI… ~15s' : 'Ask the AI who it recommends'}
              </button>
            ) : (
              <p className="text-[12px] text-[#5a5a66]">Available on saved reports.</p>
            )}
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-[#1c1c21]">
              <div className="flex items-end gap-2 mb-2">
                <span
                  className="text-[40px] leading-none font-bold tabular-nums"
                  style={{ color: (report.you?.appearances ?? 0) > 0 ? '#4ade80' : '#f87171' }}
                >
                  {report.you?.appearances ?? 0}
                </span>
                <span className="text-[#5a5a66] text-[15px] mb-1">
                  of {report.answered} answers name you
                </span>
              </div>
              <p className="text-[13px] text-[#a0a0ac] leading-relaxed">{report.verdict}</p>
            </div>

            {report.rows.length > 0 && (
              <div className="px-4 py-3 border-b border-[#1c1c21] space-y-2.5">
                {report.rows.slice(0, 8).map((r) => (
                  <div key={r.url}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className={`text-[13px] truncate ${r.isSelf ? 'font-semibold text-white' : 'text-[#c9c9d2]'}`}>
                        {r.isSelf ? `You · ${domain(r.url)}` : domain(r.url)}
                      </span>
                      <span className="text-[12px] tabular-nums text-[#8a8a96] shrink-0">
                        {r.share}%{r.firstPlace > 0 && <span className="text-[#5a5a66]"> · #1 ×{r.firstPlace}</span>}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#1c1c21] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(r.share, 2)}%`,
                          background: r.isSelf ? '#7c5cff' : '#4a4a56',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {report.unlistedRivals.length > 0 && (
              <div className="px-4 py-3 border-b border-[#1c1c21]">
                <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mb-2">
                  Recommended by AI, not yet in your field
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {report.unlistedRivals.map((r) => (
                    <span key={r.name} className="chip text-[#c9c9d2] bg-[#1a1a1f]">
                      {r.name}
                      <span className="text-[#5a5a66] ml-1">×{r.appearances}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              className="w-full px-4 py-3 text-left text-[12px] text-[#8a8a96]"
              onClick={() => setShowProbes((s) => !s)}
            >
              {showProbes ? 'Hide' : 'Show'} what the AI was asked
            </button>
            {showProbes && (
              <div className="px-4 pb-4 space-y-3">
                {report.probes.map((p) => (
                  <div key={p.question}>
                    <p className="text-[13px] text-[#c9c9d2] mb-1">&ldquo;{p.question}&rdquo;</p>
                    {p.error ? (
                      <p className="text-[12px] text-[#5a5a66]">No answer — excluded from the count.</p>
                    ) : p.mentions.length === 0 ? (
                      <p className="text-[12px] text-[#5a5a66]">Named no businesses.</p>
                    ) : (
                      <ol className="text-[12px] text-[#8a8a96] space-y-0.5">
                        {p.mentions.map((m) => (
                          <li key={m.position}>
                            {m.position}. {m.name}
                            {m.matchedUrl && <span className="text-[#5a5a66]"> — {domain(m.matchedUrl)}</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-[#5a5a66] leading-relaxed">
                  Answered by {report.model ?? 'the configured model'} on{' '}
                  {new Date(report.measuredAt).toLocaleDateString()}. Recorded as given; names are matched to
                  field sites by website or business name.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
