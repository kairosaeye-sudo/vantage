'use client';

import { useEffect, useRef, useState } from 'react';

type Device = 'desktop' | 'phone';

const VIRTUAL: Record<Device, { w: number; h: number }> = {
  desktop: { w: 1280, h: 800 },
  phone: { w: 390, h: 760 },
};

/**
 * Drag to compare the site today with its glow-up.
 *
 * Both pages render live at their true width (1280px desktop, 390px phone) and
 * are scaled to fit, so what the owner sees is the real page, not a mock-up.
 * The divider sits over the frames and owns the pointer; the frames are inert
 * here, and the full preview is one tap away for scrolling around.
 */
export default function BeforeAfter({ beforeSrc, afterSrc }: { beforeSrc: string; afterSrc: string }) {
  const [device, setDevice] = useState<Device>('desktop');
  const [pct, setPct] = useState(50);
  const [scale, setScale] = useState(0.3);
  const [hinted, setHinted] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const v = VIRTUAL[device];

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / v.w);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [v.w]);

  // A short sweep on arrival shows the divider moves — most people never find
  // a slider they were not shown.
  useEffect(() => {
    if (hinted) return;
    const t1 = setTimeout(() => setPct(28), 900);
    const t2 = setTimeout(() => setPct(50), 1700);
    const t3 = setTimeout(() => setHinted(true), 1800);
    return () => [t1, t2, t3].forEach(clearTimeout);
  }, [hinted]);

  const moveTo = (clientX: number) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPct(Math.min(98, Math.max(2, ((clientX - r.left) / r.width) * 100)));
  };

  const frame = (src: string, title: string) => (
    <iframe
      src={src}
      title={title}
      sandbox="allow-same-origin"
      scrolling="no"
      className="absolute top-0 left-0 border-0 bg-white pointer-events-none origin-top-left"
      style={{ width: v.w, height: v.h, transform: `scale(${scale})` }}
    />
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex rounded-lg bg-[#16161a] p-1 border border-[#26262c]">
          {(['desktop', 'phone'] as Device[]).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-semibold capitalize ${
                device === d ? 'bg-[#7c5cff] text-white' : 'text-[#8a8a96]'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-[#5a5a66]">Drag to compare</span>
      </div>

      <div className={device === 'phone' ? 'max-w-[300px] mx-auto' : ''}>
        <div
          ref={boxRef}
          className={`relative overflow-hidden bg-white select-none touch-none border border-[#26262c] ${
            device === 'phone' ? 'rounded-[28px] border-[6px] border-[#26262c]' : 'rounded-xl'
          }`}
          style={{ height: v.h * scale, cursor: 'ew-resize' }}
          onPointerDown={(e) => {
            dragging.current = true;
            setHinted(true);
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            moveTo(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          {frame(beforeSrc, 'Your site today')}
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pct}%)`, transition: hinted ? 'none' : 'clip-path .6s ease' }}>
            {frame(afterSrc, 'Your site after the glow-up')}
          </div>

          {/* Divider */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,.15)]"
            style={{ left: `${pct}%`, transition: hinted ? 'none' : 'left .6s ease' }}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center text-[#111] text-[15px] font-bold">
              ⇆
            </div>
          </div>
          <span className="absolute top-3 left-3 text-[11px] font-bold tracking-wide px-2 py-1 rounded bg-black/70 text-white">
            TODAY
          </span>
          <span className="absolute top-3 right-3 text-[11px] font-bold tracking-wide px-2 py-1 rounded bg-[#7c5cff] text-white">
            GLOW-UP
          </span>
        </div>
      </div>
    </div>
  );
}
