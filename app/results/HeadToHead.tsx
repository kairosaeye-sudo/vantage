'use client';

interface Row {
  category: string;
  label: string;
  you: number;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * You against one named rival, category by category.
 *
 * Averages are abstract; a named competitor is not. The rival is the field
 * leader — or, when you lead, the site closest behind you.
 */
export default function HeadToHead({
  rows,
  you,
  peers,
}: {
  rows: Row[];
  you: { url: string; overall: number };
  peers: Array<{ url: string; overall: number; categories?: Record<string, number> }>;
}) {
  const withCats = peers.filter((p) => p.categories && Object.keys(p.categories).length > 0);
  if (withCats.length === 0) return null;

  const leader = withCats[0];
  const youLead = you.overall > leader.overall;
  const rival = youLead ? withCats.find((p) => p.overall < you.overall) ?? leader : leader;

  const lines = rows
    .filter((r) => typeof rival.categories![r.category] === 'number')
    .map((r) => ({ ...r, them: rival.categories![r.category] }));
  const theyWin = lines.filter((l) => l.them > l.you).length;
  const biggest = [...lines].sort((a, b) => b.them - b.you - (a.them - a.you))[0];

  return (
    <>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
        Head to head
      </h2>
      <div className="card p-4 mb-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-[#5a5a66]">You</p>
            <p className="text-[24px] font-bold tabular-nums leading-tight">{you.overall}</p>
          </div>
          <span className="text-[12px] font-bold text-[#5a5a66]">VS</span>
          <div className="min-w-0 text-right">
            <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] truncate">
              {youLead ? 'Closest behind you' : 'Field leader'} · {domain(rival.url)}
            </p>
            <p className="text-[24px] font-bold tabular-nums leading-tight text-[#c9c9d2]">{rival.overall}</p>
          </div>
        </div>
        <p className="text-[13px] text-[#a0a0ac] leading-relaxed mb-4">
          {theyWin === 0
            ? `You beat ${domain(rival.url)} in every category.`
            : `${domain(rival.url)} beats you in ${theyWin} of ${lines.length} categories${
                biggest && biggest.them > biggest.you ? ` — most of all on ${biggest.label.toLowerCase()} (${biggest.them} vs ${biggest.you})` : ''
              }.`}
        </p>
        <div className="space-y-3">
          {lines.map((l) => {
            const win = l.you >= l.them;
            return (
              <div key={l.category}>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-[#c9c9d2]">{l.label}</span>
                  <span className="tabular-nums">
                    <span style={{ color: win ? '#4ade80' : '#f87171' }} className="font-semibold">
                      {l.you}
                    </span>
                    <span className="text-[#5a5a66]"> vs {l.them}</span>
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-[#1c1c21] overflow-hidden">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[#3a3a44]" style={{ width: `${l.them}%` }} />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.max(l.you, 1)}%`, background: win ? '#4ade80' : '#f87171', opacity: 0.9, height: '50%', top: '25%' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-[#5a5a66] mt-3">Thin bar: you. Wide bar: {domain(rival.url)}.</p>
      </div>
    </>
  );
}
