# Payments & Verifiable Settlement Design

**Status:** approved (v1 to implement now)
**Date:** 2026-06-14
**Author:** FDE + Claude
**Scope:** How advertiser money reaches developers, and how that movement is made
independently verifiable, without weakening the zero-egress invariant.

---

## 1. Executive summary

Today the verifiable layer proves a device *showed* ads at given clearing prices,
but nothing proves an advertiser *funded* those prices. We close that provenance
gap in v1 with plain fiat (Stripe, USD) plus a public, signed, hash-chained
**settlement ledger** that anyone can verify against the receipts the device
already produces. On-chain USDC escrow on Solana is the documented v2 upgrade,
reachable through adapter seams without a rewrite. We are not launching a native
token.

## 2. Problem statement

- `clearingPriceCents` (witness.ts) is derived from bidders' self-asserted bids.
- `Ledger.accrue` (ledger.ts) accrues `developerBalance = sum(floor(price/2))`.
- `reconcile()` checks `developerBalance == sum(floor(price/2))` — a tautology
  over numbers the system invented. It proves arithmetic, not funding.
- `verifyReceipt` (receipt.ts) proves a device authentically produced reach
  counts, not that money exists behind them.

So a developer must currently *trust* that the operator collected real advertiser
money off-chain. That trust gap is the headline risk for the founding-sponsor
seed (see docs/premortem). Success = a developer (or any stranger) can verify
that money out never exceeds money in, per campaign, and that no receipt was paid
twice, without trusting the operator's word.

## 3. Decisions

### 3.1 No native token (rejected)

A token developers earn, whose value derives from platform effort, is a Howey
security (SEC exposure, KYC/AML, per-payout tax events for developers). It also
*re-opens* the provenance gap: token "earnings" are not backed by advertiser
dollars, so payout value is illusory until a greater fool buys. And it is brand
incongruent: "privacy-first, enterprise-grade, never sees your code" cannot share
a sentence with "speculative ad token" for the ML-engineer and enterprise-buyer
audience. Token flywheels (Axie, STEPN, Helium) drove viral growth and then
collapsed because value was reflexive. We capture the intended virality without
the token (see 3.4).

### 3.2 Decouple funding rail from settlement rail

- **Settlement rail (fixed):** the unit of account and the verifiable record.
  v1 = the signed settlement ledger; v2 = USDC escrow on Solana. Settlement logic
  never cares how dollars entered.
- **Funding rail (advertiser's choice):** how dollars get in. Modeled as an
  adapter seam, mirroring the existing `PayoutGateway` seam in payout.ts. One seam
  for money in, one for money out, verifiable core between them.

### 3.3 Funding options (v1 ships option A)

- **A. Card / USD via Stripe Checkout** (default, friendly): advertiser pays like
  any SaaS. The private backend records a `fund` settlement entry on
  `payment_intent.succeeded`.
- **B. USDC via Stripe** (Stripe stablecoin rails): same checkout UX, conceptually
  pays in USDC. v2.
- **C. USDC direct to contract** (connect wallet): fully non-custodial, crypto
  native. v2, the only fully trustless funding path.

Honest tradeoff: A and B are custodial on the funding leg (platform-as-payor
signature Stripe risk-flags; card chargebacks can claw back after a dev is paid).
C avoids custody and chargebacks but mainstream advertisers will not use it. We
accept A's custody/chargeback surface in v1 in exchange for friendliness, and
mitigate with a clearing window (open question 6.1).

### 3.4 Founding-developer flywheel (replaces token virality)

- Founding developers (seed cohort) lock in a better revenue split forever
  (e.g. 70/30 vs standard 50/50). Real, durable first-mover advantage in dollars.
- Referrals rewarded in real value (USD credit / rev-share), not points.
- The settlement ledger is the viral artifact: public, cryptographic proof that
  developers were actually paid $X. Credible and shareable in a way a price chart
  is not.

## 4. Proposed approach (v1)

### 4.1 Verifiable settlement ledger (public, in `packages/core`)

An append-only, hash-chained log, each entry sealed by the **platform** key
(same Ed25519 primitives and head-signature-vouches-for-chain pattern as
witness.ts). Two entry kinds:

- `fund`: a campaign was funded. Carries `campaignId`, `amountCents`,
  `fundingRef` (e.g. Stripe charge id) for the funding attestation.
- `payout`: a developer was paid. Carries `devicePubKey`, `campaignId`,
  `amountCents`, `receiptHash` (binds to a specific device receipt), `payoutRef`
  (gateway reference).

`verifySettlementLog` is stranger-checkable and enforces the invariants that make
the log mean something rather than being a tautology:

1. **Authenticity:** head signature + hash chain authenticate every entry; any
   insert/edit/reorder breaks a link.
2. **Conservation (the real provenance check):** for every campaign, total
   `payout` amounts never exceed total `fund` amounts. You cannot pay out money
   that was never funded.
3. **No double-claim:** each `receiptHash` may back at most one `payout` entry.
4. **Well-formedness:** non-negative integer amounts, non-empty ids.

This does not move money (that stays in the private backend). It makes the
movement auditable. Combined with `verifyReceipt` (device signed the reach) you
get: authentic reach + authentic payment + conservation + no double-pay, all
without trusting the operator.

### 4.2 Funding attestation across the fiat boundary

`fund.fundingRef` maps each on-ledger funding entry to its Stripe charge, so the
chain card-charge to funded-campaign to dev-payout is auditable end to end. Without
it the fiat entry would be a trust black box on a verifiable backbone.

### 4.3 What stays in the private backend

Stripe Checkout, webhooks, the live PayoutGateway, KYC, and the *production* of
signed settlement entries. The public core ships the *verification* and the entry
types so anyone can check the operator's published ledger.

## 5. v2 upgrade path (documented, not built)

USDC escrow on **Solana** (chosen because device keys are Ed25519, which Solana
verifies natively and cheaply on-chain — exact fit to existing receipts). Per
4.2's seams: a campaign escrow PDA funded via the same funding adapters; the same
signed receipt becomes the on-chain settlement claim; USDC released dev-share to
the device address, platform fee skimmed by the program. Additive at the seams;
no rewrite. Needs: funded-bid binding in auction/campaign (bid capped by escrow),
settlement nonce already present as `receiptHash`, and on-chain reconciliation
turning `reconcile()` into a real cross-check against settled amounts.

## 6. Open questions

1. **Clearing window vs instant payout on the card rail.** Instant = best dev
   experience, full chargeback risk + reserve required. 7–14 day window = devs
   wait, platform only releases low-clawback money. Leaning toward a window.

## 7. Risks & mitigations

- **Card chargebacks after payout** → clearing window + reserve (6.1).
- **Platform-as-payor Stripe risk** → keep float minimal, fund-on-payment;
  consider Stripe stablecoin rails / licensed partner as volume grows.
- **Operator publishes a dishonest/partial ledger** → ledger is signed and
  hash-chained (tamper-evident); receipts are independently verifiable; v2 escrow
  removes the trust entirely. v1 is trust-but-verify, acceptable when developers
  already choose to run the code.

## 8. Appendices

- Touch points: `witness.ts` (chain + replay pattern), `receipt.ts` (the artifact
  payouts bind to), `ledger.ts` (local accrual the ledger reconciles against),
  `payout.ts` (the money-out seam this mirrors), `crypto.ts` (`seal`/`verifySeal`/
  `chainHash`).
