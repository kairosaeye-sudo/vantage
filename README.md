# Vantage — Website Intelligence for Small Business

**What it is:** An industry-aware website intelligence platform. A business enters their
industry and location; Vantage assembles their competitive set, scores them side-by-side
against it, and returns ranked recommendations on what to fix.

**Vantage** — see how you rank against your field.

*"Field" is the concept (your competitive set), not the brand.*

---

## The scoring model — this is the actual IP

Seven categories, weighted by what actually moves a small business. Every signal is
**measured**, not guessed. Each scores 0–100; categories roll up by weight; the overall
score also gets a **percentile against the vertical**.

| Category | Weight | What it measures |
|---|---|---|
| Performance | 25% | Core Web Vitals — LCP, CLS, INP, TTFB, page weight |
| Mobile | 15% | Viewport, responsive layout, tap targets, mobile speed |
| Search foundations | 15% | Title, meta, H1, canonical, schema, sitemap, robots, alt text |
| Trust | 15% | HTTPS, reviews + rating, NAP, contact/about/privacy pages, socials |
| Content | 10% | Freshness, depth, service pages, blog/resources presence |
| AI visibility | 10% | AI-crawler access, llms.txt, FAQ structure, entity schema, factual density |
| Conversion | 10% | Primary CTA, clickable phone, form, hours, booking, clear value prop |

## How we measure it — all legitimate sources

- **Direct HTML fetch** → on-page signals: meta, schema, freshness, links, forms, alt text.
  Public data, no ToS problem. Covers ~80% of the rubric with **zero external dependencies**.
- **PageSpeed Insights API** (Google, official, free) → real Core Web Vitals.
- **Google Places API** (official) → review count and rating. Requires billing enabled.
- **LLM queries** → "best electrician in Austin" — does AI recommend them or a rival?
- **Seed corpus crawl** → the industry averages that make percentiles real.

We do **not** scrape Yelp, Google, or Meta review pages — that violates their ToS and
would put the product at legal risk. Official APIs only.

## The moat

Every competitor tool compares you to the 3 sites you named. Vantage compares you to your
**entire peer set** — because it has seen 200 electrician websites, not 3.

That compounds: every new customer in a vertical sharpens the benchmark for that vertical.
Customer 50 in "plumbers" gets a better product than customer 5 did.

## The lead magnet

"See how your site scores against 200 other electricians" is a free public tool.

This is the thing that makes the business work — it solves the lead problem that caused
the pivot away from the agency model. Someone enters their URL, gets a score, sees they're
at 34 while the local leader is at 78, and now wants to close the gap. No sales call needed.

**Funnel:** free industry score → Glow Up (one-time build) → Monitoring subscription (recurring).

## Configuration

Any industry, any location, sites you choose.

```bash
# See every field you have defined
npx tsx scripts/list-fields.ts

# Build a field from a saved config
npx tsx scripts/build-field.ts --config electricians-austin-tx

# Or define one ad hoc — industry and location are free-form
npx tsx scripts/build-field.ts \
  --industry "Plumbers" --location "Austin, TX" \
  --sites plumbers.txt --save-config

# Sites can also be passed inline (comma or newline separated)
npx tsx scripts/build-field.ts \
  --industry "Dentists" --location "Denver, CO" \
  --sites "https://a.com, https://b.com, https://c.com"

# Score one site against a built field
npx tsx scripts/compare.ts https://example.com electricians-austin-tx
```

Configs live in `fields/<slug>.json`; built benchmarks land in `data/field-<slug>.json`.
Slugs are derived from industry + location (`electricians-austin-tx`).

Flags: `--save-config` persist for reuse · `--append <file|list>` add sites later ·
`--no-pagespeed` skip Lighthouse (faster, render metrics marked unmeasured).

## Stack

Next.js 14 + TypeScript + Tailwind on Vercel, matching the Kairos aesthetic.
Postgres for persistence. `cheerio` for HTML parsing.

---

## Phases

1. ~~**Foundation** — repo, scaffold, scoring rubric defined.~~ **Done**
2. ~~**Scoring engine** — URL in, real measured signals out. No external keys needed.~~ **Done**
3. ~~**The industry space** — seed real businesses so the benchmarks are real.~~ **Done**
   (Austin electricians 17 sites, Denver electricians 8, Boulder dentists 2)
4. ~~**Side-by-side + recommendations** — comparison across all categories, ranked fixes.~~ **Done**
5. **Free public score tool** — the lead magnet. *(next)*
6. **Monitoring subscription** — scheduled re-scoring, change detection, monthly report.
7. **Deploy, verify, present.**

Phases 1–5 are the MVP. Phase 6 is the recurring revenue layer.

---

## Resolved

1. **Database → Supabase.** Connection string pending; engine currently reads/writes
   JSON on disk so nothing is blocked.
2. **Google Places API → later.** Reviews report as `unknown` (neutral) until connected.
   Sites are never penalised for a signal we cannot yet measure.

## Known risks

- **Auto-discovering competitors is unreliable.** The AI proposes, the customer confirms.
  Getting this wrong makes every downstream comparison garbage.
- **Corpus selection bias.** Sites found via search are the ones already ranking well, so a
  vertical baseline built from them skews flattering. The product's real comparison is
  customer-vs-their-own-named-competitors, which is always fair; the corpus only supplies
  the vertical average.
- **Some sites block crawlers** (403). The UI must show "couldn't reach this site" rather
  than silently dropping it.
- **Most small-business sites are bad enough that the honest answer is "rebuild it."**
  That's fine — it's the glow-up service. Sequence is score → rebuild → monitor.
- **Vitamin, not painkiller.** Most owners don't wake up wanting competitive analysis.
  The free score has to *create* the pain by showing them a specific competitor beating them.
  That's why the side-by-side is the emotional hook, not a feature.
- **Not pure SaaS.** This is a services business with software leverage. 50 clients at
  $400/mo is $240k/yr — a real company, but it won't scale to thousands without humans.
