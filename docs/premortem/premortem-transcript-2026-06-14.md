# Premortem Transcript — Marketer Portal + Ad-Provider Integration

**Date:** 2026-06-14
**Project:** Sponsorline — "the only AI-dev ad network that never sees your code"
**Method:** Gary Klein prospective hindsight (9 parallel investigators)

## Context gathered

- **What is it:** Build a marketer self-serve web portal (sign up → fund a balance → build a
  campaign → set bid/budget/targeting → launch → read reach reports) **plus** integrations into
  existing ad providers (Google Ads, Meta) to route/aggregate ad spend into Sponsorline.
- **Who it affects:** Marketers/advertisers (demand), opted-in developers (supply, the moat),
  enterprise security reviewers.
- **Success:** Marketers self-serve onboard, fund, and run campaigns; spend flows in; the network
  grows on both sides without breaking the "never sees your code" promise.
- **Current state (from the codebase):** Headless monorepo (core, cli, mcp, cursor), ~178 passing
  tests, deterministic local auction, Ed25519-signed receipts, off-by-default Stripe Connect
  *payout* gateway. No marketer UI. No advertiser billing-in. `Ledger.settle()`/`payout()` are
  stubs. Allowlist is a 3-prefix array (`lang:`, `framework:`, `task:`). DP egress floor ≈ 200
  devices. "Unique human" deferred to payout KYC.

## Premortem frame

It is late 2026. The marketer portal + ad-provider integration shipped. It failed. We are looking
back to explain why.

## Raw premortem — failure reasons

1. Empty-inventory cold start (marketer funds, finds no audience, churns publicly).
2. Billing-in is the real product and it's unbuilt/underestimated.
3. Ad-provider integration silently breaks the core privacy promise.
4. A hosted portal contradicts "stranger-verifiable, no vendor trust."
5. Auction/fraud integrity collapses once real money flows.
6. Built the wrong side first (demand before supply).
7. Ad-provider ToS / platform-dependency risk.
8. Scope explosion sinks the launch.
9. Money-transmitter / payment-facilitator regulatory exposure.

---

## Deep-dives

### 01 — Empty-inventory cold start

**Story:** The portal shipped beautiful in Q3. First real campaign: `lang:python / framework:react
/ task:refactor`, $2,000 budget, Launch. The deterministic auction had almost nothing to match —
low-hundreds of opted-in devices, mostly idle; the segment matched ~40. The polished reach screen
rendered a flat line. Refund on day three (honored — payouts are real now). "Vaporware" spread in a
marketing Slack and a podcast. The signed-receipt count was honest, so it couldn't be fudged: it
became the murder weapon. Two more funded marketers hit the wall before a reach floor was added; the
exact early-advocate cohort had already churned and warned peers.
**Assumption:** Developer supply would exist (or self-arrive) by the time marketers showed up.
**Warning signs:** Targetable-segment device counts in the dozens–low-hundreds yet launch allowed
with no floor; first campaigns show available-reach far below requested; dry-run auctions already
returning near-empty winner sets.

### 02 — Billing-in unbuilt (the real product)

**Story:** The visible builder looked done, so GA was pulled forward. Nobody pointed at
`packages/core/src/ledger.ts`: `settle()`/`payout()` were `never`-returning "v0.3" stubs; `Ledger`
only *accrued* impressions, with no advertiser-funded balance to debit. The money-out side (Stripe
Transfers) existed; money-in was assumed symmetric. It wasn't — no charge primitive, no escrow, no
hold. "Almost done" lasted four months: real-time debit against late, out-of-order, replayed signed
receipts; prorating paused campaigns; chargebacks after dev payout cleared; reconciliation drift
`reconcile()` flagged but couldn't fix. Production ran dry-run; three design partners invoiced by
hand. No self-serve money flowed. Provider integrations never started (assumed a funded-balance API
that didn't exist).
**Assumption:** Taking money in is the mirror image of paying money out.
**Warning signs:** `Ledger.settle()`/`payout()` still stubs with no funded-balance field while the
builder ships launch/budget UI; only working real-money path is money out; partners invoiced by hand.

### 03 — Ad integration breaks the privacy promise

**Story:** The breach didn't come through `validatePredicate` — it held. It came through the
Google/Meta sync adapter. "Import my audiences" added a fourth allowlist prefix, `audience:`,
mapping Customer Match / Custom Audience IDs (hashed-email-derived) into atoms; `isAllowlisted`
waved them through. Then ROAS parity demands added an attribution callback firing gclid/fbclid back
to Meta CAPI and Google offline-conversions — an outbound channel of cross-network identifiers,
past the C2 DP-egress gate because it wasn't classified as DP egress. A reviewer diffed
`targeting.ts`, found `audience:` and the CAPI POST, screenshotted both next to "no such data
exists." The deeper rot: "fungible with Google/Meta" structurally requires their join keys — the
identity graph Sponsorline exists to refuse.
**Assumption:** Spend can be made interoperable with Google/Meta without importing their
identity-and-attribution substrate.
**Warning signs:** Any PR adding to `ALLOWLIST.prefixes` or a mapping layer feeding `isAllowlisted`;
any outbound call to `*.facebook.com`/`googleadservices.com` outside the DP-egress gate carrying a
receipt/gclid/fbclid/hashed-email.

### 04 — Hosted portal contradicts "no vendor trust"

**Story:** To populate dashboards with balances and reach delivered, the server became source of
truth for spend (you can't reconcile across thousands of devices live from a portal). Instantly the
"secret never leaves your device / verify proves origin" paragraph stopped describing the marketer's
experience: devs still ran `verify`; marketers got a number to trust. Month four, a championing dev
asked on HN what `verify` proves now that the auction and 50% split are server-side from a DB they
can't clone. Honest answer: "you trust the server." By month six the founding wedge was gone — the
pitch was "a dashboard plus integrations," which an incumbent with 10× demand copies in a quarter.
**Assumption:** Verifiability is a dev-side feature you can keep on one side of the market.
**Warning signs:** A design doc/PR makes "server is source of truth for balances/spend"; a developer
publicly asks what `verify` proves now.

### 05 — Fraud integrity collapses with real money

**Story:** Live payouts on in week one. The 96/day ceiling became the farming target: keys minting
40–80 plausible impressions/day stay in `clean[]` forever (the deliberately out-of-scope low-volume
sybil gap). With 50/50 split and $10 minimum, break-even was tiny — thousands of synthetic devs,
each indistinguishable from a light real user. KYC verifies a human, not that receipts were earned;
farms ran rings of real/rented identities. Self-dealing was worse: a marketer funds a balance,
colluding devs emit clean receipts inside every cap, `aggregateReceipts` dedupes per device+epoch,
the 50% flows back — laundering spend, nothing forged. Marketers with lawyers demanded an audit:
provably sealed and under-ceiling, but not provably distinct humans or real exposures. The ceiling
became an indefensible billing formula; chargebacks/clawbacks hit a treasury already paid out.
**Assumption:** Cryptographic authenticity + a physical ceiling is sufficient fraud control (it
never proved *economic* legitimacy).
**Warning signs:** Rising share of `clean[]` receipts clustered just under 96; new pubkeys
outpacing plausible install growth; fund-side and payout-side resolving to overlapping
Connect/identity/IP/timing clusters.

### 06 — Built the wrong side first

**Story:** Demand is easy to build against fixtures, so the monetization spine (builder, receipts,
screening, payout gateway) raced ahead — all signing against the same thin pilot sliver. Provider
integrations created the *appearance* of demand traction, justifying more demand spend and starving
supply further. First real marketer asked the only question that matters: "how many opted-in devs,
and can you prove the number isn't synthetic?" Honest answer: a few hundred — below the DP k-anon
floor (~200) the engine needs to emit a single aggregate. The verifiable status line was real and
shippable, but the distribution loop (install friction, the consent moment, dev-side "why turn this
on") never got the budget.
**Assumption:** Demand would pull supply into existence.
**Warning signs:** `marketer-backend` commit velocity rising while active device count stays under
~200; first real reach query returns "below k-anonymity threshold, cannot emit."

### 07 — Ad-provider ToS / dependency risk

**Story:** "Route your Google budget into Sponsorline" shipped month two, top channel within weeks:
OAuth into Google Ads/Meta, read campaign structures + audiences + spend, auto-generate equivalent
Sponsorline campaigns, recommend a split. Onboarding dropped 40 min → 4. Nobody read the developer
terms: both platforms prohibit using API data to build/improve a competing product and exporting
audience data to a third-party ad system — Sponsorline did both and advertised it. A Google Ads API
compliance review (month four, triggered by the public landing copy + loud LinkedIn posts) issued a
30-day Terms-violation notice. No remediation possible — the feature *was* the violation. Access
downgraded to read-only, then suspended; Meta app review rejected; cease-and-desist arrived. The
headline feature was pulled; the channel died. Growth had been built on the incumbents' land.
**Assumption:** Platform API access is a neutral utility, not a revocable permission controlled by
the competitor whose revenue you're taking.
**Warning signs:** The feature's core action appears in the providers' prohibited-uses clauses (at
design time); one integration-dependent feature exceeds ~40% of signups while OAuth scopes expand
and reviews lengthen.

### 08 — Scope explosion sinks the launch

**Story:** "Demand side as one push" became `auth`, `payments`, campaign-builder, bidding service,
and Google/Meta adapter stubs — five fronts at once, each tractable alone, none finished. The
killers: integrations stalled on external OAuth/review/sandbox gates (weeks waiting, not coding);
the bid loop needed real-time auction state that collided with the deterministic `auction`/`prng`
invariants in core (weaken guarantees or build a parallel system — both ate time). The 178-test
discipline slipped to "backfill later." By month four nothing was launch-ready, and the polished
dev-side network couldn't ship because it was coupled to half-built demand parts. One driver,
no extra hands.
**Assumption:** A two-sided market must launch with both sides complete, so all five demand products
precede shipping the finished supply side.
**Warning signs:** Test-to-surface ratio inverts (new packages land sparse/skipped while core stays
~178); standups fill with external blockers instead of owned progress.

### 09 — Money-transmitter / regulatory exposure

**Story:** Live for eleven good days. Advertisers funded balances; the `Ledger` accrued the split;
Transfers fired clean. Then a German developer onboarded and Stripe's risk engine saw the textbook
unlicensed-money-transmission shape: customer money into the platform balance, held days, fanned to
unrelated third parties across borders. Stripe placed a review hold and froze the balance — every
funded-but-undisbursed advertiser dollar locked; devs "pending" indefinitely; advertisers couldn't
refund. The payout side had three gates; the funding side (pay-in, custody) had none — `Ledger` ran
in-memory, `settle()`/`payout()` threw, so there was no merchant-of-record posture, no advertiser
KYB, no reserve. Tax: ~140 US devs paid, several over $600, zero W-9s, no 1099-NEC pipeline (threat
model said tax was out-of-scope until enabled; nobody enabled it before flipping live). Because
Sponsorline held the balance and chose who got paid, it looked like the payor, not Stripe. The
freeze took six weeks to answer (no compliance counsel); advertisers charged back; trust evaporated.
**Assumption:** Stripe Connect's payout-side mitigations also absolve custodying advertiser funds
and being de facto payor.
**Warning signs:** Stripe "verify your business model" email / fund-flow request / rolling reserve
appearing; first US dev crosses $600 cumulative with no W-9 on file and no 1099 generated.

---

## Synthesis

**Most likely failure:** Building the demand side onto a supply base that doesn't yet clear the
DP k-anon floor (~200 devices/segment). Two investigators converged here. Self-serve makes the
emptiness public.

**Most dangerous failure:** The ad-provider integration detonating the privacy moat — irreversible
brand death, and structurally entangled with the "siphon spend" idea because interoperating with
Google/Meta requires their identity graph. Tied: a Stripe balance freeze from custodying funds.

**Hidden assumption (the big one):** That you can bolt a conventional ad-network demand side (hosted
portal, provider integrations, held balances) onto Sponsorline without it becoming a conventional ad
network — i.e., without dissolving the trustless, zero-identity verifiability that is the entire
reason it exists.

**Revised plan:**
1. Supply-first; no portal until real reach reports emit on real devices (≥ ~200/segment).
2. Demand concierge (manual onboarding via existing MCP handlers), not self-serve, until pull is proven.
3. Kill "siphon via Google/Meta APIs"; replace with manual creative+budget import (no OAuth, no audience import, no attribution callback). Make "we never touch your Google data" the feature.
4. Trust-boundary tripwire: CI blocks changes to `ALLOWLIST.prefixes` and outbound ad-provider calls.
5. Decide fund-custody posture before money-in; prefer not holding balances (destination charges / `on_behalf_of`); wire W-9/1099 before live payouts.
6. Build charge/escrow/meter (the real 80%) separate from any UI; replace `Ledger` stubs with receipt-reconciled implementations first.
7. Adversarial sybil + self-dealing simulation with real-money incentives; fund-to-payout correlation detection before launch.

**Pre-launch checklist:**
- [ ] Active devices/segment ≥ ~200; real reach query emits.
- [ ] No new allowlist prefixes; no ad-provider egress carrying receipts/IDs (CI green).
- [ ] Fund-custody posture reviewed by counsel; W-9/1099 pipeline live before payout.
- [ ] `Ledger.settle()`/`payout()` implemented with reconciliation — no stubs in the money path.
- [ ] Adversarial fraud simulation run; correlation detection in place.
