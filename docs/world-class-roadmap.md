# Vantage — product review and the path to world class

## What Vantage is

A competitive website-intelligence product for local service businesses. Enter a
URL; Vantage measures the site on seven weighted categories, places it against a
**field** (an industry + location peer set it has already measured), and ranks
what to fix. The funnel is **free score → Glow Up ($499 one-time rebuild) → Watch
($149/mo monitoring)**.

The real assets are:

1. **The field.** Every competitor tool compares you to three sites you name.
   Vantage has measured the whole local peer set, and every customer sharpens it.
2. **Measured, not guessed.** Every number comes from the engine; unmeasurable
   signals are neutral, never assumed. The Glow Up re-scores its own output, so
   "better" is verified.
3. **The loop.** Score → rebuild → re-score weekly → alert on overtakes and
   regressions → next round of fixes. Most tools stop at the report.

## What is strong today

- A defensible, documented scoring model with impact-weighted findings.
- A glow-up that preserves content signals and verifies its own gain.
- Monitoring with change diffs, overtake detection and rank movement.
- Field-gap capture that turns unmatched scans into a build queue (KAI-14).
- An honesty culture in the code (KAI-15) that is rare and worth protecting.

## Gaps found in review

| # | Gap | Why it matters | Status |
|---|---|---|---|
| 1 | **The README promises "does AI recommend them or a rival?" but nothing measures it.** AI Visibility scored only the *inputs* (robots, llms.txt, schema). | It is the most urgent question an owner has in 2026, and the most differentiated. | **Shipped — AI Answer Share** |
| 2 | Results lived only in `sessionStorage` — gone on tab close, impossible to forward. | The lead magnet could not spread. Every forwarded report is a free acquisition. | **Shipped — `/r/[id]` shareable reports** |
| 3 | Recommendations listed problems but never said *who you would pass*. | "Fix 3 things, pass beckettelectrical" is what makes an owner buy. | **Shipped — Overtake Planner** |
| 4 | Auto-detected scans were saved with no field (`fieldSlug` from the request, not the match). | Lost data for every no-field-picked scan. | **Fixed** |
| 5 | **`/api/proxy` and `/api/score` fetch any URL, including internal addresses** (`127.0.0.1`, `169.254.169.254`). `/api/proxy` then serves the fetched HTML as `text/html` from Vantage's own origin. | SSRF, and anyone can host a page with script and have it run on the Vantage origin via a proxy link. | **Open — fix before launch** (block private/link-local IPs after DNS resolution; serve proxied HTML from a separate sandbox origin or with `Content-Security-Policy: sandbox`) |
| 6 | No auth, no billing ("Stripe checkout is not wired up"). | Nothing can be sold yet. | Open |
| 7 | Public endpoints that spend money (scoring, glow-up, AI answers) have no rate limits. | Cost and abuse exposure once public. | Open — AI answers is at least keyed to a saved scan and cached |
| 8 | Fields are tiny (17 / 8 / 2 sites) and built by hand. | "Compared to 200 electricians" is the pitch; the data is not there yet. | Open — see roadmap |

## Shipped in this change

### AI Answer Share — "Does AI recommend you?"
`lib/ai-answers.ts`, `POST /api/ai-answers`, results card.

Asks the configured Vantage AI model four buyer-intent questions ("who are the best
electricians in Austin, TX?", trust, urgency, reviews), records the businesses it
names in order, and matches them to the field by website or business name. Reports:

- how many answers name you, and how often first;
- AI share of voice for every field competitor;
- **rivals AI recommends that are not in your field yet** — a field-building lead
  and a competitor the owner did not know about.

Honesty rules match the rest of the engine: errored probes leave the denominator,
name matching is prefix-based so a shared generic word ("electric") cannot create
a mention, and with no provider configured the card says so rather than guessing.
The endpoint only accepts a saved `scanId`, so it cannot be used as an open model
relay; a successful report is cached on the scan.

### Shareable reports — `/r/[id]`
Every saved scan is a permanent link with Open Graph metadata
("irwinelectricatx.com scored 38/100"). The results page has a Share button (native
share sheet on phones, copy elsewhere). The scan now stores the full report — side
by side, field and no-field suggestion — and older side-only scans still render.

### Overtake Planner
Tick fixes, see projected score, rank and percentile move, which named competitors
you pass, and how many points to the next one. It sums each recommendation's
measured weight in the score and ranks against the field's stored scores; the
glow-up is the verified version of the same projection.

## The free hook: score and glow-up (second pass)

The two free steps are the whole funnel, so both now lead with the competitive
picture and the visible result:

- **Score:** "You rank #17 of 18" in the hero, a named leaderboard of the field
  with you slotted in, a head-to-head against the field leader category by
  category, and the free glow-up offered right after the leaderboard.
- **Glow-up:** opens on a drag-to-compare slider of the site today against the
  rebuild (live pages, desktop and phone), then the measured jump and the new
  rank in the field ("#17 → #1 of 18, passing 16 competitors").
- **The rebuild itself:** a full-bleed photo hero with a real review and the
  site's own credentials, a facts band, service cards with matching photos and
  links to the real service pages, gallery, review wall, service-area chips,
  and contact with hours and a service picker.
- **Extraction fixed:** services listed under a heading, hours split by `<br>`,
  review attribution, full addresses, and grounded credentials (founding year,
  licence number, licensed and insured, family-owned, emergency service,
  service areas).
- **Honesty fixes:** the fallback writer no longer promises policies the site
  never states, titles are no longer hard-wired to electricians, and the
  "design matched to your field" claim no longer appears when competitor sites
  could not be fetched.

## Roadmap — the ground-breaking features, in order

**1. AI Answer Share across engines, tracked weekly (Watch).**
Run the probes against several model families on the Watch schedule; chart share of
voice over time; alert "ChatGPT stopped recommending you this week; Mister Sparky
took the slot." Tie each change to site changes from the snapshot diff so the owner
sees cause and effect. Nobody sells this per local field today.

**2. Fix-it-for-me, not just tell-me.**
The glow-up already generates robots.txt, sitemap, schema, FAQ and llms.txt. Ship
them as a one-click install: a WordPress/Wix/Squarespace connector or a hosted
snippet, then re-score to confirm. Closing the "now what?" gap is the difference
between a report and a product.

**3. Mystery shopper agent.**
A headless browser on a phone viewport that tries to do what a customer does: find
the phone number, submit the quote form, book a slot after hours. Report the real
lead path in taps and seconds, with a recording, next to the best competitor's.
It measures conversion the way a customer experiences it rather than by markup.

**4. Field autopilot.**
Build fields automatically from Places API category search plus the AI-named rivals
above, refresh monthly, and let every scan in an unbuilt area queue the build
(KAI-14 already captures the demand). This is how "200 electricians" becomes true
in every metro without a human.

**5. Revenue at stake, with the assumptions on screen.**
Translate the gap to the leader into estimated monthly leads using editable
inputs (average job value, close rate, monthly search volume from a keyword API).
Keep it explicitly an estimate with every input visible — the product's credibility
is the measured score, and this must not borrow it.

**6. Agency mode.**
White-labelled shareable reports (`/r/[id]` with the agency's brand), a portfolio
view across clients, and PDF export. Agencies are the distribution channel for a
services-heavy product.

**7. Launch blockers.**
SSRF and proxy-origin fix (gap 5), Stripe checkout for Glow Up and Watch, accounts
with email magic links, and per-IP rate limits on score, glow-up and AI answers.
