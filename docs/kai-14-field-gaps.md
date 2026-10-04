# KAI-14 — Field gap detection and notification

## The problem

Vantage can only score a site against a field we have built. Fields are
industry + location peer sets — `electricians-austin-tx`,
`dentists-boulder-co`.

When a site matches no field, the glow-up falls back to generic best practices.
The customer gets a worse result, and — more expensively — **nobody finds out
that the market asked for coverage we don't have.** The demand signal is thrown
away at the exact moment it is strongest: someone cared enough to submit a real
URL and wait for a result.

KAI-14 makes those misses visible and turns them into a build queue.

## What counts as a gap

Two kinds, because they mean different things:

| Kind | Meaning | What to do |
|---|---|---|
| `no-field-area` | We know the industry and the place, but have no field for that area. E.g. a plumber in Cincinnati when fields exist only for Austin electricians. | Build the field. Highest-value gap — both halves are known. |
| `no-field` | We can't even tell what the business does. | Usually a thin or JS-rendered site. Look before acting. |

A gap with neither a city nor an industry is **not recorded** — it is noise, not
a lead, and recording it would train us to build fields nobody asked for.

## How a gap is detected

The glow-up already fetched and scored the site. Detection reuses that work:

1. **Field detection fails** — no field scored above the match threshold.
2. **Location detection** (`lib/location-detect.ts`) reads where the business is,
   in order of evidence strength:
   - `structured-data` — `PostalAddress` / `areaServed` in JSON-LD. Most reliable.
   - `address` — a full "Austin, TX 78704" in the visible text.
   - `city-state` — "Austin, TX" with no zip.
   - `repeated-city` — a capitalised name appearing 3+ times.
3. **Industry guess** (`lib/industry-guess.ts`) labels what the business does,
   weighting title and headings 3× over body text. A single body-text keyword hit
   is too weak to act on and returns `null`.
4. **Suggested slug** — `plumbers-cincinnati-oh`, ready to hand to the field builder.

The gap is recorded with the evidence that produced it, so a human can judge
whether the read was right before building anything.

## Deduplication

Gaps are keyed on `kind|industry|city|region`, not on the URL. Ten people from
ten Cincinnati plumbing companies produce **one row with `hits = 10`**, ordered
first in the dashboard. The URL keeps the most recent example.

This is the point: the ordering is the prioritisation. Build what the most
people asked for.

## Notification

`GET /api/cron/report-gaps` posts a digest to a Discord webhook — one message
listing the new gaps, not one message per gap. Each gap is reported once:
`notified` is set only after Discord accepts the message, so a failed post
retries rather than silently losing the gap.

The Hermes cron job `Vantage Field Gaps` (hourly) watches the gaps API through a
monitor gate — the agent only wakes when the list actually changes, so an
unchanged hour costs no model tokens. New gaps are delivered as a Discord DM to
the user, with the exact `build-field.ts` command for each.

## Why this shape

- **Recorded inside the glow-up, not a separate job.** The evidence is already in
  memory; a separate crawler would have to re-fetch and re-derive it.
- **Never breaks the customer's run.** Both `recordFieldGap` and the industry
  guess swallow their own errors. A gap-tracking failure must not cost someone
  the glow-up they asked for.
- **Evidence travels with the gap.** The notification says *why* it thinks the
  business is a Cincinnati plumber. A bare "unmatched site" report would be
  unusable.
- **One row per gap, not per request.** Raw hit rows would grow without bound and
  hide the signal in the volume.

## Files

- `lib/field-gaps.ts` — record, list, dedupe, describe
- `lib/location-detect.ts` — read the city from the site
- `lib/industry-guess.ts` — label the industry when no field matched
- `app/api/gaps/route.ts` — JSON and text views, `?since=` for polling
- `app/api/cron/report-gaps/route.ts` — Discord digest, `CRON_SECRET`-gated
- `scripts/init-gaps.ts` — table
- `scripts/test-detect.ts` — field + location + industry on any URL

## Bugs found and fixed while building this

Field detection had two false-positive bugs that this work exposed, because
gaps only appear if detection correctly *fails*:

1. **Substring state codes.** Location matching used `text.includes("co")`, which
   matches inside "company". Every site with the word "company" scored points
   toward a Colorado field. `roto-rooter.com` — a plumber in Cincinnati — matched
   `dentists-boulder-co`. Fixed: whole-word matching for location parts.

2. **Ambiguous keywords.** `extraction` scored 10 points as a dental term, but it
   is also what a drain-cleaning company calls water extraction. Fixed: a weak-keyword
   set that scores 3 instead of 10, and a match threshold raised from 10 to 13 so
   no single weak hit can carry a field on its own.

Both were invisible before because a wrong match looks like a success.
