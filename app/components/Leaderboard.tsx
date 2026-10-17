'use client';

export interface LeaderPeer {
  url: string;
  overall: number;
  /** Where the peer is, shown when the comparison spans several places. */
  where?: string;
}

export interface LeaderMark {
  /** Shown in place of a domain, e.g. "You" or "Your glow-up". */
  label: string;
  score: number;
  tone: 'you' | 'glow' | 'dim';
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const TONE: Record<LeaderMark['tone'], { bar: string; text: string; bg: string }> = {
  you: { bar: '#f87171', text: '#ffffff', bg: 'rgba(248,113,113,.08)' },
  dim: { bar: '#5a5a66', text: '#a0a0ac', bg: 'rgba(255,255,255,.03)' },
  glow: { bar: '#7c5cff', text: '#ffffff', bg: 'rgba(124,92,255,.12)' },
};

type Row = { key: string; name: string; score: number; where?: string; mark?: LeaderMark };

/**
 * The field as a ranked list of named competitors, with the customer slotted in.
 *
 * Seeing "#14 — beckettelectrical.com, 73" next to your own 41 is the moment the
 * score becomes personal. Marks (you today, your glow-up) are ranked among the
 * real peers; ties go to the peer, because a tie is not a win.
 */
export default function Leaderboard({
  peers,
  marks,
  top = 3,
  around = 1,
}: {
  peers: LeaderPeer[];
  marks: LeaderMark[];
  /** Always show this many leaders. */
  top?: number;
  /** Peers to show either side of each mark. */
  around?: number;
}) {
  const rows: Row[] = [
    ...peers.map((p): Row => ({ key: p.url, name: domain(p.url), score: p.overall, where: p.where })),
    ...marks.map((m): Row => ({ key: `mark:${m.label}`, name: m.label, score: m.score, mark: m })),
  ].sort((a, b) => b.score - a.score || (a.mark ? 1 : 0) - (b.mark ? 1 : 0));

  // A mark is ranked as if it were the only extra site, so "You today" and "You,
  // glowed up" never push each other down. A peer is pushed down by the marks
  // that are really in the race (not a dimmed "before" mark), so the numbers add
  // up to "of N" with no two sites sharing a rank.
  const rankOf = (r: Row) =>
    r.mark
      ? 1 + peers.filter((p) => p.overall >= r.score).length
      : 1 + rows.filter((x) => x.score > r.score && (!x.mark || x.mark.tone !== 'dim')).length;

  const keep = new Set<number>();
  rows.forEach((r, i) => {
    if (i < top) keep.add(i);
    if (r.mark) for (let j = i - around; j <= i + around; j++) if (j >= 0 && j < rows.length) keep.add(j);
  });

  const max = Math.max(100, ...rows.map((r) => r.score));
  const out: Array<Row | 'gap'> = [];
  rows.forEach((r, i) => {
    if (!keep.has(i)) {
      if (out[out.length - 1] !== 'gap') out.push('gap');
      return;
    }
    out.push(r);
  });

  return (
    <div className="space-y-1">
      {out.map((r, i) =>
        r === 'gap' ? (
          <div key={`gap-${i}`} className="text-center text-[#3a3a44] text-[13px] leading-none py-1">
            ⋮
          </div>
        ) : (
          <div
            key={r.key}
            className="grid grid-cols-[2.2rem_1fr_2.2rem] items-center gap-2 px-2 py-1.5 rounded-lg"
            style={r.mark ? { background: TONE[r.mark.tone].bg } : undefined}
          >
            <span className="text-[12px] tabular-nums text-[#5a5a66] font-semibold">#{rankOf(r)}</span>
            <div className="min-w-0">
              <p
                className={`text-[13px] truncate mb-1 ${r.mark ? 'font-semibold' : ''}`}
                style={{ color: r.mark ? TONE[r.mark.tone].text : '#c9c9d2' }}
              >
                {r.name}
                {r.where && <span className="text-[#5a5a66] font-normal"> · {r.where}</span>}
              </p>
              <div className="h-1.5 rounded-full bg-[#1c1c21] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (r.score / max) * 100)}%`,
                    background: r.mark ? TONE[r.mark.tone].bar : '#3a3a44',
                  }}
                />
              </div>
            </div>
            <span
              className="text-[14px] font-bold tabular-nums text-right"
              style={{ color: r.mark ? TONE[r.mark.tone].text : '#8a8a96' }}
            >
              {r.score}
            </span>
          </div>
        )
      )}
    </div>
  );
}
