# KAI-15 — Inconsistent numbers reported by the agent

## What was reported

The issue body is a pasted agent message. The concrete claim to check:

| When | Reported |
|---|---|
| Earlier in the session | `irwinelectricatx.com 38 → 68 (+30)` |
| Later in the same session | `irwinelectricatx.com 41 → 68 (+27)` |

Same site, same field, two different before-scores. One of the two numbers was
wrong, or the score is not reproducible. Both are bad: a product whose entire
pitch is "measured, not guessed" cannot quote a different baseline for the same
site in the same session.

## What the data says

Every recorded run agrees on 41, not 38:

```
vantage_scans rows for irwinelectric: 1
  Sat Oct 03 2026 17:12:44   overall=41   https://www.irwinelectricatx.com/

vantage_previews rows: 4
  Sun Oct 04 18:25:24   before=41  after=68
  Sat Oct 03 18:37:55   before=41  after=68
  Sat Oct 03 18:35:02   before=41  after=68
  Sat Oct 03 18:16:45   before=41  after=68
```

Four independent runs, four identical baselines. **The `38` was never produced by
the scoring engine.** It was a transcription error on the agent's part — reported
as if it were measured output, which is exactly the failure mode the product
promises not to have.

## The real bug underneath

The transcription error exposed a genuine reproducibility problem worth fixing
regardless, because it *will* produce unstable numbers in normal operation.

`runGlowUp` scores the original with `skipPageSpeed: true`:

```ts
const before = await scoreSite(url, { skipPageSpeed: true });
```

That is a deliberate choice — the before/after comparison must hold the
measurement method constant, and PageSpeed adds tens of seconds. But it means
**the glow-up's "before" score is not the same number the free Check produces**
for the same site. The Check calls PageSpeed; the glow-up does not.

The two disagree because of how unmeasurable signals are handled:

```ts
const STATUS_MULTIPLIER = { pass: 1.0, warn: 0.25, fail: 0.0, unknown: 0.5 };
```

When PageSpeed is unavailable, four Performance findings — `lighthouse` (impact
10), `lcp` (9), `cls` (7), `tbt` (6) — are marked `unknown` and each scores
**0.5 instead of its real value**. Performance is 25% of the total.

So the same site legitimately scores:

- **Check (PageSpeed on):** real render measurements, e.g. a bad LCP failing at 0.0
- **Glow-up (PageSpeed off):** those same findings neutral at 0.5

That is a swing of several points on the overall score, for the same site on the
same day, with nothing about the site having changed.

### Why `unknown = 0.5` is defensible but not free

The comment in `score.ts` explains the intent: a site must never look fast merely
because PageSpeed was unavailable. Marking `unknown` as 0.5 rather than 1.0 is
the right instinct. But 0.5 is still a *guess*, and it is a guess that lands
inside a number the product presents as measured.

## What to fix

Three options, in order of how much they cost:

1. **Make the glow-up use the same method for before and after, and say so.**
   Already true — both sides skip PageSpeed — but the UI does not tell the user
   that the glow-up baseline can differ from their Check score. Label it:
   "Baseline measured without PageSpeed so before and after are comparable."

2. **Show `unknown` as excluded, not neutral.** Compute the category from the
   findings that were actually measured, and report coverage: "Performance 67
   (measured on 2 of 6 signals)". This removes the invented 0.5 entirely. The
   cost is that category scores move around as coverage changes, which is
   arguably more honest but harder to compare over time.

3. **Cache PageSpeed per URL per day** so the glow-up can afford to use it. This
   makes the two numbers genuinely identical and is the only option that fixes
   the discrepancy rather than disclosing it. Cost: a cache table and a TTL.

Recommendation: **1 now, 3 as the real fix.** Option 2 makes scores
non-comparable across runs, which breaks the monitoring product that depends on
diffing them.

## Process lesson

The agent reported a number it had not measured. Whatever the underlying
scoring question, the reporting must be fixed: **never restate a previously
reported score from memory — read it from the API or the database.** Every
number in a status message should be traceable to a tool result in the same
turn.

## Status

- Root cause of the discrepancy: identified (transcription error, not an engine bug)
- Underlying reproducibility issue: identified (PageSpeed on/off changes the score)
- Fix: **not yet implemented** — this document is the design
