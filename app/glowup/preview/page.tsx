'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Side = 'before' | 'after';

interface Fix {
  findingId: string;
  label: string;
  category: string;
  points: number;
  headOnly?: boolean;
}

interface Meta {
  url: string;
  beforeScore: number;
  afterScore: number;
  verifiedGain: number;
  files: string[];
  fixes: Fix[];
}

function PreviewInner() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const [view, setView] = useState<Side>('after');
  const [split, setSplit] = useState(50);
  const [wide, setWide] = useState(false);
  const [annotate, setAnnotate] = useState(true);
  const [showList, setShowList] = useState(false);
  const [loaded, setLoaded] = useState({ before: false, after: false });
  const [meta, setMeta] = useState<Meta | null>(null);
  const dragging = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);

  // Desktop gets the split view; phones get a toggle (a split is unusable on a
  // narrow screen).
  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // What changed — drives the legend and the head-only list.
  useEffect(() => {
    if (!id) return;
    fetch(`/api/glowup/preview/meta?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => d.ok && setMeta(d))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    const move = (clientX: number) => {
      const el = frameRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pct = ((clientX - r.left) / r.width) * 100;
      setSplit(Math.min(96, Math.max(4, pct)));
    };
    const onMove = (e: MouseEvent) => dragging.current && move(e.clientX);
    const onTouch = (e: TouchEvent) => dragging.current && e.touches[0] && move(e.touches[0].clientX);
    const stop = () => (dragging.current = false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchend', stop);
    };
  }, []);

  const src = (side: Side) =>
    `/api/glowup/preview?id=${encodeURIComponent(id)}&side=${side}` +
    (side === 'after' && !annotate ? '&annotate=0' : '');

  if (!id) {
    return (
      <main className="min-h-screen px-5 pt-20 max-w-lg mx-auto text-center">
        <p className="text-[#8a8a96] mb-6">No preview specified.</p>
        <Link href="/glowup" className="btn-primary inline-flex">
          Run a glow up
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Control bar */}
      <div className="sticky top-0 z-20 bg-[#08080a] border-b border-[#26262c]">
        <div className="px-4 py-3 max-w-[1600px] mx-auto flex items-center gap-3 flex-wrap">
          <Link href="/glowup" className="text-[13px] text-[#8a8a96] shrink-0">
            ← Back
          </Link>

          {meta && (
            <span className="text-[13px] tabular-nums shrink-0">
              <span className="text-[#8a8a96]">{meta.beforeScore}</span>
              <span className="text-[#5a5a66] mx-1.5">→</span>
              <span className="text-[#4ade80] font-semibold">{meta.afterScore}</span>
              <span className="text-[#4ade80] text-[12px] ml-1.5">+{meta.verifiedGain}</span>
            </span>
          )}

          {wide ? (
            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={() => setAnnotate((a) => !a)}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                style={
                  annotate
                    ? { borderColor: '#7c5cff', color: '#b8a6ff', background: '#15121f' }
                    : { borderColor: '#26262c', color: '#8a8a96' }
                }
              >
                {annotate ? 'Highlights on' : 'Highlights off'}
              </button>
              <span className="text-[12px] font-semibold text-[#8a8a96]">BEFORE</span>
              <span className="text-[12px] text-[#5a5a66]">drag</span>
              <span className="text-[12px] font-semibold text-[#4ade80]">AFTER</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setAnnotate((a) => !a)}
                title={annotate ? 'Highlights on' : 'Highlights off'}
                className="text-[13px] font-semibold px-3 py-2 rounded-lg border"
                style={
                  annotate
                    ? { borderColor: '#7c5cff', color: '#b8a6ff', background: '#15121f' }
                    : { borderColor: '#26262c', color: '#8a8a96' }
                }
              >
                {annotate ? 'Highlighted' : 'Clean'}
              </button>
              <div className="flex rounded-lg overflow-hidden border border-[#26262c]">
                {(['before', 'after'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setView(s)}
                    className="px-4 py-2 text-[13px] font-semibold transition-colors"
                    style={
                      view === s
                        ? { background: s === 'after' ? '#4ade80' : '#3a3a44', color: s === 'after' ? '#08080a' : '#fff' }
                        : { color: '#8a8a96' }
                    }
                  >
                    {s === 'before' ? 'Before' : 'After'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Legend: what the outlines mean */}
        {annotate && view === 'after' && (meta?.fixes ?? []).filter((f) => !f.headOnly).length > 0 && (
          <div className="border-t border-[#1c1c21] px-4 py-2 overflow-x-auto">
            <div className="flex gap-2 max-w-[1600px] mx-auto items-center">
              <span className="text-[11px] text-[#5a5a66] shrink-0">
                Highlighted changes:
              </span>
              {(meta?.fixes ?? [])
                .filter((f) => !f.headOnly)
                .map((f) => (
                  <span
                    key={f.findingId}
                    className="text-[11px] font-semibold shrink-0 px-2 py-1 rounded"
                    style={{ background: '#1a1428', color: '#b8a6ff' }}
                  >
                    {f.label}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Frames */}
      {wide ? (
        <div ref={frameRef} className="relative flex-1 bg-[#121215]" style={{ minHeight: 'calc(100vh - 57px)' }}>
          {/* AFTER underneath, BEFORE clipped to the left of the divider */}
          <iframe
            title="After"
            src={src('after')}
            sandbox="allow-same-origin"
            className="absolute inset-0 w-full h-full border-0 bg-white"
            onLoad={() => setLoaded((l) => ({ ...l, after: true }))}
          />
          <div
            className="absolute inset-0 overflow-hidden bg-white"
            style={{ width: `${split}%` }}
          >
            <iframe
              title="Before"
              src={src('before')}
              sandbox="allow-same-origin"
              className="border-0 bg-white"
              style={{
                width: frameRef.current ? `${frameRef.current.getBoundingClientRect().width}px` : '100vw',
                height: '100%',
              }}
              onLoad={() => setLoaded((l) => ({ ...l, before: true }))}
            />
          </div>

          {/* Divider */}
          <div
            className="absolute top-0 bottom-0 w-[3px] bg-[#7c5cff] cursor-ew-resize z-10"
            style={{ left: `calc(${split}% - 1.5px)` }}
            onMouseDown={() => (dragging.current = true)}
            onTouchStart={() => (dragging.current = true)}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#7c5cff] flex items-center justify-center shadow-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                <polyline points="9 6 4 12 9 18" />
                <polyline points="15 6 20 12 15 18" />
              </svg>
            </div>
          </div>

          <div className="absolute bottom-3 left-3 z-10 chip" style={{ background: 'rgba(0,0,0,.75)', color: '#fff' }}>
            Before
          </div>
          <div className="absolute bottom-3 right-3 z-10 chip" style={{ background: 'rgba(0,0,0,.75)', color: '#4ade80' }}>
            After
          </div>

          {(!loaded.before || !loaded.after) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#121215] z-30">
              <p className="text-[14px] text-[#8a8a96]">Loading both versions…</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white">
          <iframe
            title={view === 'after' ? 'After' : 'Before'}
            src={src(view)}
            sandbox="allow-same-origin"
            className="w-full border-0 bg-white"
            style={{ height: 'calc(100vh - 57px)' }}
          />
        </div>
      )}

      {/* Head-level changes: real, but not visible on the rendered page. */}
      {(meta?.fixes ?? []).filter((f) => f.headOnly).length > 0 && (
        <div className="border-t border-[#26262c] bg-[#0d0d10]">
          <button
            onClick={() => setShowList((s) => !s)}
            className="w-full px-4 py-3 flex items-center justify-between max-w-[1600px] mx-auto"
          >
            <span className="text-[13px] font-semibold text-[#c9c9d2]">
              Also changed in the page code ({(meta?.fixes ?? []).filter((f) => f.headOnly).length})
            </span>
            <span className="text-[#5a5a66] text-[13px]">{showList ? 'Hide' : 'Show'}</span>
          </button>
          {showList && (
            <div className="px-4 pb-4 max-w-[1600px] mx-auto space-y-2">
              {(meta?.fixes ?? [])
                .filter((f) => f.headOnly)
                .map((f) => (
                  <div key={f.findingId} className="card p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{f.label}</p>
                      <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mt-0.5">
                        {f.category} · not visible on the page
                      </p>
                    </div>
                    <span className="text-[12px] text-[#7c5cff] font-semibold shrink-0">
                      +{f.points}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default function Preview() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[#8a8a96]">Loading preview…</p>
        </main>
      }
    >
      <PreviewInner />
    </Suspense>
  );
}
