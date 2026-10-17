'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ResultsView, { type Result } from './ResultsView';

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

  return <ResultsView data={data} />;
}
