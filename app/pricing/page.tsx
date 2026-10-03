'use client';

import Link from 'next/link';

const PLANS = [
  {
    name: 'Free Check',
    price: '$0',
    period: 'one time',
    blurb: 'See where you stand right now.',
    features: [
      'Score across 7 categories',
      'Side-by-side against your field',
      'Ranked list of what to fix',
      'No account needed',
    ],
    cta: 'Score my site',
    href: '/',
    highlight: false,
  },
  {
    name: 'Glow Up',
    price: '$499',
    period: 'one time',
    blurb: 'We rebuild the page and prove the gain.',
    features: [
      'Everything in Free Check',
      'We fix what the check found',
      'Re-scored to verify the improvement',
      'robots.txt, sitemap, schema, FAQ added',
      'Honest list of what a rebuild cannot fix',
    ],
    cta: 'Glow up my site',
    href: '/glowup',
    highlight: false,
  },
  {
    name: 'Watch',
    price: '$149',
    period: 'per month',
    blurb: 'Glow up, then keep ahead of your field.',
    features: [
      'Everything in Glow Up',
      'Re-scored weekly against your field',
      'Alert when a competitor overtakes you',
      'Alert when something on your site regresses',
      'Next round of fixes when the field moves',
      'Rank movement for every competitor',
    ],
    cta: 'Start watching',
    href: '/watch',
    highlight: true,
  },
  {
    name: 'Agency',
    price: '$499',
    period: 'per month',
    blurb: 'For agencies and multi-location businesses.',
    features: [
      'Everything in Watch',
      'Daily monitoring',
      'Up to 10 sites under one account',
      'Monthly written report',
      'Competitor change history',
    ],
    cta: 'Start watching',
    href: '/watch',
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <main className="min-h-screen px-5 pt-10 pb-14 max-w-lg mx-auto">
      <Link href="/" className="text-[13px] text-[#8a8a96] mb-6 inline-block">
        ← Back
      </Link>

      <h1 className="text-[28px] font-bold tracking-tight mb-2">Plans</h1>
      <p className="text-[#8a8a96] text-[15px] leading-relaxed mb-8">
        The check is free. Staying ahead is the subscription.
      </p>

      <div className="space-y-4">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className="card p-5"
            style={p.highlight ? { borderColor: '#7c5cff' } : undefined}
          >
            {p.highlight && (
              <span className="chip mb-3" style={{ color: '#b8a6ff', background: '#1a1428' }}>
                Most popular
              </span>
            )}
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[15px] font-semibold">{p.name}</span>
            </div>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-[34px] font-bold tracking-tight">{p.price}</span>
              <span className="text-[13px] text-[#5a5a66]">{p.period}</span>
            </div>
            <p className="text-[14px] text-[#8a8a96] leading-relaxed mb-4">{p.blurb}</p>

            <ul className="space-y-2 mb-5">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-[14px] text-[#c9c9d2] leading-snug">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="shrink-0 mt-1"
                  >
                    <path
                      d="M4 10.5l4 4 8-9"
                      stroke={p.highlight ? '#7c5cff' : '#4a4a56'}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Link href={p.href} className={p.highlight ? 'btn-primary' : 'btn-ghost'}>
              {p.cta}
            </Link>
          </div>
        ))}
      </div>

      <p className="text-[12px] text-[#5a5a66] mt-6 leading-relaxed">
        Prices shown are proposed and not yet billed. Stripe checkout is not wired up.
      </p>
    </main>
  );
}
