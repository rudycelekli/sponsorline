# Sponsorline v0.2-C2 — Anonymized Aggregate Intel (the egress checkpoint)

**Status:** Design / DECISION REQUIRED · **Date:** 2026-06-14 · **Builds on:** v0.2-C1

## Why this doc exists before any code

Every prior subsystem produced **zero new egress**. C2 is different: it is the first
feature that proposes sending *anything* derived from the device *outward* to
advertisers. That crosses the project's central promise — "the only AI-dev ad network
that never sees your code" — so it gets a design + decision gate before implementation.
Nothing here ships until the privacy math below is judged strong enough.

## The business pull (what advertisers actually want)

Advertisers fund campaigns blind: they pick `target` predicates but never learn
whether `lang:rust ∧ task:test` is a population of 5 or 50,000, nor which buckets
convert. Without *some* aggregate signal they overpay for dead audiences and
underfund live ones — which also means developers see less-relevant lines. The value
of C2 is a coarse, privacy-preserved "audience size + engagement by bucket" report.

## The hard rule this must never break

Raw developer context never leaves the device. C2 may only ever emit **aggregate
counts over the already-allowlisted taxonomy** (`lang:`/`framework:`/`task:`),
and only after passing the privacy gates below. No per-device record, no timestamps
finer than a coarse epoch, no free-form fields, ever.

## Proposed mechanism (candidate, not yet accepted)

A **local-first, threshold-gated, DP-noised aggregate**:

1. **On-device counting only.** Each device maintains local counters per allowlisted
   bucket (e.g., `lang:rust` → impressions, good-feedback, bad-feedback). These never
   leave as-is.
2. **k-anonymity threshold (suppression).** A bucket is *eligible to contribute* to
   any outbound aggregate only if its count ≥ **k** (candidate k = 50). Buckets below
   k are suppressed entirely — no row emitted.
3. **Differential privacy (noise).** Before any value leaves, add calibrated noise
   (Laplace mechanism, candidate ε per release = 1.0, sensitivity 1) to each released
   count, with a per-bucket **release budget** so repeated releases can't average the
   noise away. Track cumulative ε on-device; stop releasing a bucket once its budget
   is spent.
4. **Coarse time + no joins.** Releases are bucketed to a coarse epoch (e.g., weekly),
   carry no device id, no session id, no ordering — nothing that supports linkage.
5. **Consent-scoped + opt-in.** Outbound aggregation is OFF by default and requires a
   distinct, explicit consent grant separate from the "show me sponsor lines" grant.
   The kill switch (`off`) halts it immediately.
6. **Witnessed + verifiable.** Every outbound aggregate is recorded in the existing
   hash-chained witness log with its k-threshold and ε spent, so `verify` can assert:
   no row below k was emitted, no bucket exceeded its ε budget, and no non-allowlisted
   key ever appeared. The privacy guarantee becomes *stranger-checkable*, like the rest.

## Open decisions (need a call before build)

- **Where does aggregation happen?** Pure on-device local DP (each device noises its
  own counts, server sums) is the strongest honesty story but noisiest at low N. A
  trusted-aggregator / secure-aggregation variant is tighter but adds a server trust
  assumption. **Recommendation: start pure local-DP** — it keeps the "never trust the
  network" stance and degrades gracefully (suppression handles low N).
- **Parameters k and ε.** Candidates k=50, ε=1.0/release with a small fixed budget.
  These are policy knobs; they should be config + witnessed, not hardcoded silently.
- **Is the juice worth it?** If local-DP noise at realistic single-developer volumes
  makes the aggregate near-useless, C2 may not be worth the egress at all — in which
  case the honest answer is to NOT ship outward intel and keep C1's on-device
  precision as the whole story. This doc must be validated against simulated volumes
  before committing.

## Recommendation

Build a **simulation harness first** (no egress): feed realistic impression
distributions through the proposed k-suppression + Laplace pipeline and measure
utility (relative error of released counts) vs. privacy (ε spent) vs. honesty (rows
suppressed). Only if the simulation shows useful signal at defensible (k, ε) do we
implement the opt-in outbound path. If not, we publish the negative result and keep
zero-egress as a permanent product virtue.

## Out of scope

Real-money settlement / payouts / KYC (v0.3-D); advertiser identity & auth; any
non-aggregate or per-device telemetry (permanently excluded).
