# Sponsorline for advertisers

**Reach developers inside their AI coding tools, on a surface their security team approves, with reach you can verify.**

---

## The offer

Your brand appears as a clearly labeled sponsor line in the status bar of AI coding tools, shown only to developers who opted in, and only when your targeting matches their coarse, consented interest signals. You pay for reach you can prove, not reach you are told to trust.

## Why it is different

- **Code-blind by construction.** Sponsorline never sees developer code. Targeting runs on a coarse allowlisted interest vector (language, framework, task type). You cannot request, and we cannot serve on, anything more granular.
- **Enterprise-safe delivery.** No binary patching. No unsigned auto-updaters. Integration is through the official extension points the tools already expose. This is the version that passes security review instead of getting blocked.
- **Deterministic, replayable auctions.** Every placement is decided by a deterministic second-price auction that anyone can replay and confirm.

## The sales artifact: signed reach receipts

Reach is not estimated. Each device produces an Ed25519-signed receipt of what it actually showed. We verify every seal, deduplicate per device and time period, and screen out physically impossible volume before anything is counted. Your report reads:

> "Your campaign reached **N distinct devices**, **X total impressions**, over **M minutes**, all backed by signed receipts."

Anyone on your side can independently verify those receipts against the devices' published public keys. The numbers are cryptographic, not promotional.

## Anti-fraud, stated honestly

| Control | What it stops |
|---------|---------------|
| Seal verification | Forged or tampered receipts (rejected) |
| Per device + period dedupe | Resubmission / double counting |
| 96 impressions/day physical ceiling | Fabricated high-volume reach (flagged) |
| Per-device spend cap | Runaway payout blast radius |

We are explicit that screening raises the cost of bot farming but does not by itself prove a unique human. That final gate is payout-time identity verification (KYC). We would rather tell you that than overstate the guarantee.

## Targeting taxonomy

Allowlisted atoms only, combined with boolean predicates (all / any / not):

- `lang:*` (e.g. `lang:rust`, `lang:typescript`)
- `framework:*` (e.g. `framework:react`)
- `task:*` (e.g. `task:testing`)

Predicates are size-bounded and validated at submission. Requests for any non-allowlisted or PII-bearing atom are rejected.

## Pricing model

- Second-price (Vickrey) auction; you never pay more than one cent above the next-highest bid.
- Reserve floor applies.
- Revenue share: developers keep 50 percent of cleared spend.

## How to start

1. Submit inventory or a campaign (creative, bid, budget, targeting, flight window).
2. We validate it (length, control-character safety, predicate legality, budget vs bid).
3. It competes in the live auction alongside all other bidders.
4. You receive a verifiable reach report built from signed device receipts.

> Note: live billing and developer payouts are wired behind identity verification and operator authorization before any money moves. Pilot reach reporting is available now.
