'use client';

import { useEffect, useState, Suspense, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type View = 'before' | 'after' | 'redesign' | 'competitor' | 'compare';

interface Fix {
  findingId: string;
  label: string;
  category: string;
  points: number;
  headOnly?: boolean;
}

interface Competitor {
  url: string;
  score: number;
}

interface Meta {
  kind: 'glowup' | 'redesign';
  url: string;
  beforeScore: number;
  afterScore: number;
  verifiedGain: number;
  files: string[];
  fixes: Fix[];
  hasRedesign: boolean;
  redesign: {
    templateId: string;
    templateLabel: string;
    changes: Array<{ label: string; detail: string; kind: string }>;
    omitted: Array<{ section: string; reason: string }>;
    needsFromClient: string[];
  } | null;
  competitors: Competitor[];
}

const VIEW_LABEL: Record<View, string> = {
  before: 'Before',
  after: 'Fixes',
  redesign: 'Redesign',
  competitor: 'Competitor',
  compare: 'Compare',
};

const VIEW_HINT: Record<View, string> = {
  before: 'The site as it is today',
  after: 'Same design, technical gaps closed',
  redesign: 'Your real content in a modern design',
  competitor: 'A competitor site from your field',
  compare: 'Your glow-up next to a competitor',
};

function PreviewInner() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const [view, setView] = useState<View>('after');
  const [split, setSplit] = useState(50);
  const [wide, setWide] = useState(false);
  const [annotate, setAnnotate] = useState(true);
  const [showDesign, setShowDesign] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dragging = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/glowup/preview/meta?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setMeta(d);
        setView(d.hasRedesign ? 'redesign' : 'after');
        if (d.competitors?.length > 0) {
          setSelectedCompetitor(d.competitors[0].url);
        }
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    const move = (clientX: number, clientY: number) => {
      const el = frameRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Desktop: horizontal split. Mobile: vertical split.
      const pct = wide
        ? ((clientX - r.left) / r.width) * 100
        : ((clientY - r.top) / r.height) * 100;
      setSplit(Math.min(96, Math.max(4, pct)));
    };
    const onMove = (e: MouseEvent) => dragging.current && move(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => dragging.current && e.touches[0] && move(e.touches[0].clientX, e.touches[0].clientY);
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
  }, [wide]);

  const src = (v: View) => {
    if (v === 'competitor' && selectedCompetitor) {
      return `/api/proxy?url=${encodeURIComponent(selectedCompetitor)}`;
    }
    return `/api/glowup/preview?id=${encodeURIComponent(id)}&side=${v}` +
      (v === 'after' && !annotate ? '&annotate=0' : '');
  };

  const scrollToFix = useCallback((findingId: string) => {
    // Switch to the fixes view and scroll to the highlighted element
    setView('after');
    setAnnotate(true);
    // The iframe will load with highlights; we can't directly scroll inside it
    // due to cross-origin restrictions, but the highlight outline makes it visible
  }, []);

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

  const hasRedesign = meta?.hasRedesign ?? false;
  const views: View[] = hasRedesign ? ['before', 'after', 'redesign'] : ['before', 'after'];
  const resultView: View = view === 'before' ? (hasRedesign ? 'redesign' : 'after') : view;
  const visibleFixes = (meta?.fixes ?? []).filter((f) => !f.headOnly);
  const headFixes = (meta?.fixes ?? []).filter((f) => f.headOnly);
  const competitors = meta?.competitors ?? [];

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

          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-[#26262c] text-[#8a8a96] ml-2"
            aria-label={sidebarOpen ? 'Hide changes sidebar' : 'Show changes sidebar'}
          >
            {sidebarOpen ? 'Hide' : 'Show'} Changes
          </button>

          {wide ? (
            <div className="flex items-center gap-3 ml-auto">
              {view === 'after' && (
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
              )}
              {views.length > 2 && (
                <div className="flex rounded-lg overflow-hidden border border-[#26262c]">
                  {views.map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className="px-3 py-1.5 text-[12px] font-semibold transition-colors"
                      style={
                        view === v
                          ? { background: v === 'redesign' ? '#7c5cff' : '#3a3a44', color: '#fff' }
                          : { color: '#8a8a96' }
                      }
                    >
                      {VIEW_LABEL[v]}
                    </button>
                  ))}
                </div>
              )}
              {competitors.length > 0 && (
                <div className="flex rounded-lg overflow-hidden border border-[#26262c]">
                  <button
                    onClick={() => setView('competitor')}
                    className="px-3 py-1.5 text-[12px] font-semibold transition-colors"
                    style={
                      view === 'competitor'
                        ? { background: '#f59e0b', color: '#08080a' }
                        : { color: '#8a8a96' }
                    }
                  >
                    Competitors
                  </button>
                  <button
                    onClick={() => setView('compare')}
                    className="px-3 py-1.5 text-[12px] font-semibold transition-colors"
                    style={
                      view === 'compare'
                        ? { background: '#7c5cff', color: '#fff' }
                        : { color: '#8a8a96' }
                    }
                  >
                    Compare
                  </button>
                </div>
              )}
              <span className="text-[12px] font-semibold text-[#8a8a96]">BEFORE</span>
              <span className="text-[12px] text-[#5a5a66]">drag</span>
              <span className="text-[12px] font-semibold text-[#4ade80]">AFTER</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-auto">
              {view === 'after' && (
                <button
                  onClick={() => setAnnotate((a) => !a)}
                  className="text-[13px] font-semibold px-3 py-2 rounded-lg border"
                  style={
                    annotate
                      ? { borderColor: '#7c5cff', color: '#b8a6ff', background: '#15121f' }
                      : { borderColor: '#26262c', color: '#8a8a96' }
                  }
                >
                  {annotate ? 'Highlighted' : 'Clean'}
                </button>
              )}
              <div className="flex rounded-lg overflow-hidden border border-[#26262c]">
                {views.map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className="px-3 py-2 text-[13px] font-semibold transition-colors"
                    style={
                      view === v
                        ? {
                            background:
                              v === 'redesign' ? '#7c5cff' : v === 'after' ? '#4ade80' : '#3a3a44',
                            color: v === 'after' ? '#08080a' : '#fff',
                          }
                        : { color: '#8a8a96' }
                    }
                  >
                    {VIEW_LABEL[v]}
                  </button>
                ))}
              </div>
              {competitors.length > 0 && (
                <div className="flex rounded-lg overflow-hidden border border-[#26262c]">
                  <button
                    onClick={() => setView('competitor')}
                    className="px-3 py-2 text-[13px] font-semibold transition-colors"
                    style={
                      view === 'competitor'
                        ? { background: '#f59e0b', color: '#08080a' }
                        : { color: '#8a8a96' }
                    }
                  >
                    Competitors
                  </button>
                  <button
                    onClick={() => setView('compare')}
                    className="px-3 py-2 text-[13px] font-semibold transition-colors"
                    style={
                      view === 'compare'
                        ? { background: '#7c5cff', color: '#fff' }
                        : { color: '#8a8a96' }
                    }
                  >
                    Compare
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* What this view is */}
        <div className="border-t border-[#1c1c21] px-4 py-1.5">
          <p className="text-[11px] text-[#5a5a66] max-w-[1600px] mx-auto">{VIEW_HINT[view]}</p>
        </div>
      </div>

      {/* Main content: sidebar + preview */}
      <div className="flex flex-1">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-80 shrink-0 border-r border-[#26262c] bg-[#0d0d10] overflow-y-auto" style={{ maxHeight: 'calc(100vh - 84px)' }}>
            {/* Technical fixes */}
            {visibleFixes.length > 0 && (
              <div className="p-4 border-b border-[#1c1c21]">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#5a5a66] mb-3">
                  Technical Fixes ({visibleFixes.length})
                </h3>
                <div className="space-y-2">
                  {visibleFixes.map((f) => (
                    <button
                      key={f.findingId}
                      onClick={() => scrollToFix(f.findingId)}
                      className="w-full text-left p-3 rounded-lg border border-[#26262c] bg-[#121214] hover:border-[#7c5cff] transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-[#c9c9d2] group-hover:text-[#b8a6ff]">
                          {f.label}
                        </span>
                        <span className="text-[11px] text-[#7c5cff] font-semibold">+{f.points}</span>
                      </div>
                      <p className="text-[11px] text-[#5a5a66] mt-1">{f.category}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Design changes */}
            {meta?.redesign && meta.redesign.changes.length > 0 && (
              <div className="p-4 border-b border-[#1c1c21]">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#5a5a66] mb-3">
                  Design Changes ({meta.redesign.changes.length})
                </h3>
                <div className="space-y-2">
                  {meta.redesign.changes.map((c) => (
                    <div
                      key={c.label}
                      className="p-3 rounded-lg border border-[#26262c] bg-[#121214]"
                    >
                      <p className="text-[13px] font-semibold text-[#c9c9d2]">{c.label}</p>
                      <p className="text-[11px] text-[#8a8a96] mt-1 leading-relaxed">{c.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Head-only fixes */}
            {headFixes.length > 0 && (
              <div className="p-4 border-b border-[#1c1c21]">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#5a5a66] mb-3">
                  Code-Only Fixes ({headFixes.length})
                </h3>
                <div className="space-y-2">
                  {headFixes.map((f) => (
                    <div
                      key={f.findingId}
                      className="p-3 rounded-lg border border-[#26262c] bg-[#121214]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-[#c9c9d2]">{f.label}</span>
                        <span className="text-[11px] text-[#7c5cff] font-semibold">+{f.points}</span>
                      </div>
                      <p className="text-[11px] text-[#5a5a66] mt-1">{f.category} · not visible</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Competitors */}
            {competitors.length > 0 && (
              <div className="p-4">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#5a5a66] mb-3">
                  Competitor Sites ({competitors.length})
                </h3>
                <div className="space-y-2">
                  {competitors.map((c) => (
                    <button
                      key={c.url}
                      onClick={() => {
                        setSelectedCompetitor(c.url);
                        setView('competitor');
                      }}
                      className="w-full text-left p-3 rounded-lg border transition-colors"
                      style={{
                        borderColor: selectedCompetitor === c.url && view === 'competitor'
                          ? '#f59e0b'
                          : '#26262c',
                        background: selectedCompetitor === c.url && view === 'competitor'
                          ? '#1a1408'
                          : '#121214',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-[#c9c9d2] truncate">
                          {c.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </span>
                        <span className="text-[11px] text-[#f59e0b] font-semibold shrink-0 ml-2">
                          {c.score}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview pane */}
        <div className="flex-1 flex flex-col">
          {view === 'compare' ? (
            <div className="flex-1 flex flex-col bg-white">
              {/* Compare: glow-up result vs competitor */}
              <div className="relative flex-1 flex flex-col">
                {/* Top: Glow-up result */}
                <div className="relative bg-white" style={{ height: `${split}%` }}>
                  <iframe
                    title="Glow Up Result"
                    src={src(hasRedesign ? 'redesign' : 'after')}
                    sandbox="allow-same-origin"
                    className="w-full h-full border-0 bg-white"
                    onLoad={() => setLoaded((l) => ({ ...l, compareResult: true }))}
                  />
                  <div
                    className="absolute top-2 left-2 z-10 chip text-[10px] px-2 py-0.5"
                    style={{ background: 'rgba(0,0,0,.75)', color: '#4ade80' }}
                  >
                    Your Glow Up
                  </div>
                </div>

                {/* Divider */}
                <div
                  className="relative h-[3px] bg-[#7c5cff] cursor-ns-resize z-10 shrink-0"
                  onMouseDown={() => (dragging.current = true)}
                  onTouchStart={() => (dragging.current = true)}
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#7c5cff] flex items-center justify-center shadow-lg">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                      <polyline points="6 9 12 4 18 9" />
                      <polyline points="6 15 12 20 18 15" />
                    </svg>
                  </div>
                </div>

                {/* Bottom: Competitor */}
                <div className="relative bg-white flex-1">
                  <iframe
                    title="Competitor"
                    src={src('competitor')}
                    sandbox="allow-same-origin"
                    className="w-full h-full border-0 bg-white"
                    onLoad={() => setLoaded((l) => ({ ...l, compareCompetitor: true }))}
                  />
                  <div
                    className="absolute top-2 right-2 z-10 chip text-[10px] px-2 py-0.5"
                    style={{ background: 'rgba(0,0,0,.75)', color: '#f59e0b' }}
                  >
                    Competitor
                  </div>
                </div>

                {!loaded.compareResult && !loaded.compareCompetitor && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#121215] z-30">
                    <p className="text-[14px] text-[#8a8a96]">Loading comparison…</p>
                  </div>
                )}
              </div>
            </div>
          ) : wide ? (
            <div
              ref={frameRef}
              className="relative flex-1 bg-[#121215]"
              style={{ minHeight: 'calc(100vh - 84px)' }}
            >
              <iframe
                title={VIEW_LABEL[resultView]}
                src={src(resultView)}
                sandbox="allow-same-origin"
                className="absolute inset-0 w-full h-full border-0 bg-white"
                onLoad={() => setLoaded((l) => ({ ...l, [resultView]: true }))}
              />
              <div className="absolute inset-0 overflow-hidden bg-white" style={{ width: `${split}%` }}>
                <iframe
                  title="Before"
                  src={src('before')}
                  sandbox="allow-same-origin"
                  className="border-0 bg-white"
                  style={{
                    width: frameRef.current
                      ? `${frameRef.current.getBoundingClientRect().width}px`
                      : '100vw',
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

              <div
                className="absolute bottom-3 left-3 z-10 chip"
                style={{ background: 'rgba(0,0,0,.75)', color: '#fff' }}
              >
                Before
              </div>
              <div
                className="absolute bottom-3 right-3 z-10 chip"
                style={{
                  background: 'rgba(0,0,0,.75)',
                  color: resultView === 'redesign' ? '#b8a6ff' : resultView === 'competitor' ? '#f59e0b' : '#4ade80',
                }}
              >
                {VIEW_LABEL[resultView]}
              </div>

              {!loaded.before && !loaded[resultView] && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#121215] z-30">
                  <p className="text-[14px] text-[#8a8a96]">Loading both versions…</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col bg-white">
              {/* Mobile: vertical split with draggable divider */}
              <div className="relative flex-1 flex flex-col">
                {/* Top: Before */}
                <div className="relative bg-white" style={{ height: `${split}%` }}>
                  <iframe
                    title="Before"
                    src={src('before')}
                    sandbox="allow-same-origin"
                    className="w-full h-full border-0 bg-white"
                    onLoad={() => setLoaded((l) => ({ ...l, before: true }))}
                  />
                  <div
                    className="absolute top-2 left-2 z-10 chip text-[10px] px-2 py-0.5"
                    style={{ background: 'rgba(0,0,0,.75)', color: '#fff' }}
                  >
                    Before
                  </div>
                </div>

                {/* Divider */}
                <div
                  className="relative h-[3px] bg-[#7c5cff] cursor-ns-resize z-10 shrink-0"
                  onMouseDown={() => (dragging.current = true)}
                  onTouchStart={() => (dragging.current = true)}
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#7c5cff] flex items-center justify-center shadow-lg">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                      <polyline points="6 9 12 4 18 9" />
                      <polyline points="6 15 12 20 18 15" />
                    </svg>
                  </div>
                </div>

                {/* Bottom: Result */}
                <div className="relative bg-white flex-1">
                  <iframe
                    title={VIEW_LABEL[resultView]}
                    src={src(resultView)}
                    sandbox="allow-same-origin"
                    className="w-full h-full border-0 bg-white"
                    onLoad={() => setLoaded((l) => ({ ...l, [resultView]: true }))}
                  />
                  <div
                    className="absolute top-2 right-2 z-10 chip text-[10px] px-2 py-0.5"
                    style={{
                      background: 'rgba(0,0,0,.75)',
                      color: resultView === 'redesign' ? '#b8a6ff' : resultView === 'competitor' ? '#f59e0b' : '#4ade80',
                    }}
                  >
                    {VIEW_LABEL[resultView]}
                  </div>
                </div>

                {!loaded.before && !loaded[resultView] && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#121215] z-30">
                    <p className="text-[14px] text-[#8a8a96]">Loading both versions…</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Design rebuild details */}
          {meta?.redesign && (
            <div className="border-t border-[#26262c] bg-[#0d0d10]">
              <button
                onClick={() => setShowDesign((s) => !s)}
                className="w-full px-4 py-3 flex items-center justify-between max-w-[1600px] mx-auto"
              >
                <span className="text-[13px] font-semibold text-[#c9c9d2]">
                  Design rebuild — what changed ({meta.redesign.changes.length})
                </span>
                <span className="text-[#5a5a66] text-[13px]">{showDesign ? 'Hide' : 'Show'}</span>
              </button>
              {showDesign && (
                <div className="px-4 pb-5 max-w-[1600px] mx-auto">
                  <p className="text-[12px] text-[#5a5a66] mb-3 leading-relaxed">
                    Template: <span className="text-[#b8a6ff]">{meta.redesign.templateLabel}</span>. The
                    technical fixes are score-verified; a redesign is a design judgement, so review it
                    before sending it to a client.
                  </p>
                  <ul className="space-y-3 mb-5">
                    {meta.redesign.changes.map((c) => (
                      <li key={c.label} className="card p-3">
                        <p className="text-[13px] font-semibold">{c.label}</p>
                        <p className="text-[12px] text-[#8a8a96] leading-relaxed mt-1">{c.detail}</p>
                      </li>
                    ))}
                  </ul>

                  {meta.redesign.omitted.length > 0 && (
                    <>
                      <p className="text-[13px] font-semibold mb-1">Sections left out</p>
                      <p className="text-[12px] text-[#5a5a66] mb-3 leading-relaxed">
                        Only content that actually exists on the original site is rendered. Nothing was
                        invented.
                      </p>
                      <ul className="space-y-2 mb-5">
                        {meta.redesign.omitted.map((o) => (
                          <li key={o.section} className="text-[13px]">
                            <span className="font-medium">{o.section}</span>
                            <span className="text-[#8a8a96]"> — {o.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {meta.redesign.needsFromClient.length > 0 && (
                    <>
                      <p className="text-[13px] font-semibold mb-2">Still needed from the client</p>
                      <ul className="space-y-2">
                        {meta.redesign.needsFromClient.map((n) => (
                          <li key={n} className="text-[13px] flex gap-2">
                            <span className="text-[#7c5cff]">•</span>
                            <span>{n}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
