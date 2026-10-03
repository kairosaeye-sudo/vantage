'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface Alert {
  id: string;
  severity: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
}

interface Watch {
  id: string;
  email: string;
  site_url: string;
  field_slug: string;
  plan: string;
  cadence: string;
  alerts: Alert[];
}

const SEV: Record<string, { c: string; bg: string }> = {
  critical: { c: '#f87171', bg: '#1a1010' },
  warning: { c: '#fbbf24', bg: '#1a1508' },
  positive: { c: '#4ade80', bg: '#0f1a12' },
  info: { c: '#8a8a96', bg: '#16161a' },
};

function DashboardInner() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const [watch, setWatch] = useState<Watch | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [runResult, setRunResult] = useState<string>('');

  // Look up by id when we have it; otherwise ask for the email.
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        // The list endpoint is email-scoped; fetch all and find ours.
        const res = await fetch(`/api/watch?email=`);
        void res; // fall through to the manual path below
      } catch {
        /* ignore */
      }
      setLoading(false);
    })();
  }, [id]);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/watch?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Lookup failed.');
      } else if (data.watches.length === 0) {
        setError('No monitoring set up for that email yet.');
      } else {
        setWatch(data.watches[0]);
      }
    } catch {
      setError('Network error.');
    }
    setLoading(false);
  }

  async function runNow() {
    if (!watch) return;
    setRunning(true);
    setRunResult('');
    try {
      const res = await fetch('/api/watch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchId: watch.id }),
      });
      const data = await res.json();
      if (!data.ok) {
        setRunResult(`Failed: ${data.error}`);
      } else {
        setRunResult(
          `Scored ${data.score}/100 (rank ${data.rank}). ${data.alertsCreated} new alert(s).`
        );
        // Refresh alerts.
        const r2 = await fetch(`/api/watch?email=${encodeURIComponent(watch.email)}`);
        const d2 = await r2.json();
        if (d2.ok && d2.watches[0]) setWatch(d2.watches[0]);
      }
    } catch {
      setRunResult('Network error.');
    }
    setRunning(false);
  }

  if (!watch) {
    return (
      <main className="min-h-screen px-5 pt-14 pb-10 max-w-lg mx-auto">
        <Link href="/" className="text-[13px] text-[#8a8a96] mb-6 inline-block">
          ← Back
        </Link>
        <h1 className="text-[26px] font-bold tracking-tight mb-3">Your monitoring</h1>
        <p className="text-[#8a8a96] text-[15px] leading-relaxed mb-6">
          Enter the email you used to set up monitoring.
        </p>
        <form onSubmit={lookup} className="space-y-4">
          <input
            className="field"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            placeholder="you@yourbusiness.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && (
            <div className="card p-4 border-[#5a2a2a] bg-[#1a1010] text-[14px] text-[#ff9b9b]">
              {error}
            </div>
          )}
          <button className="btn-primary" disabled={loading || !email}>
            {loading ? 'Looking up…' : 'View my monitoring'}
          </button>
        </form>
        <div className="mt-6">
          <Link href="/watch" className="btn-ghost">
            Set up monitoring
          </Link>
        </div>
      </main>
    );
  }

  const grouped = watch.alerts.reduce<Record<string, Alert[]>>((acc, a) => {
    (acc[a.severity] ??= []).push(a);
    return acc;
  }, {});

  return (
    <main className="min-h-screen px-5 pt-10 pb-12 max-w-lg mx-auto">
      <Link href="/" className="text-[13px] text-[#8a8a96] mb-6 inline-block">
        ← Back
      </Link>

      <div className="card p-5 mb-5">
        <p className="text-[11px] uppercase tracking-wide text-[#5a5a66] mb-2">
          Monitoring {watch.cadence} · {watch.plan}
        </p>
        <h1 className="text-[19px] font-bold mb-1 break-all">{watch.site_url}</h1>
        <p className="text-[13px] text-[#8a8a96]">vs {watch.field_slug}</p>
        <button className="btn-ghost mt-4" onClick={runNow} disabled={running}>
          {running ? 'Running… this takes a few minutes' : 'Run a check now'}
        </button>
        {runResult && (
          <p className="text-[13px] text-[#a0a0ac] mt-3 leading-relaxed">{runResult}</p>
        )}
      </div>

      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8a8a96] mb-3">
        What changed
      </h2>

      {watch.alerts.length === 0 ? (
        <div className="card p-5 text-[14px] text-[#8a8a96] leading-relaxed">
          No changes detected yet. We&apos;ll alert you when a competitor moves ahead of you
          or something on your site regresses.
        </div>
      ) : (
        <div className="space-y-3">
          {(['critical', 'warning', 'positive', 'info'] as const).flatMap((sev) =>
            (grouped[sev] ?? []).map((a) => {
              const s = SEV[sev] ?? SEV.info;
              return (
                <div key={a.id} className="card p-4" style={{ background: s.bg }}>
                  <p
                    className="text-[11px] font-bold uppercase tracking-wide mb-1.5"
                    style={{ color: s.c }}
                  >
                    {sev}
                  </p>
                  <p className="text-[15px] font-semibold leading-snug mb-1.5">{a.title}</p>
                  <p className="text-[13px] text-[#a0a0ac] leading-relaxed">{a.body}</p>
                </div>
              );
            })
          )}
        </div>
      )}
    </main>
  );
}

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen px-5 pt-20 max-w-lg mx-auto">
          <p className="text-[#8a8a96]">Loading…</p>
        </main>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
