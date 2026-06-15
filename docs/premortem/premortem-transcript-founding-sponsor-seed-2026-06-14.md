# Premortem Transcript — Founding-Sponsor Seed Plan

**Date:** 2026-06-14
**Project:** Sponsorline — "the only AI-dev ad network that never sees your code"
**Method:** Gary Klein prospective hindsight (8 parallel investigators)
**Relationship to prior premortem:** The 2026-06-14 GTM premortem ruled out the marketer
portal, billing-in custody, and ad-provider integration, and set supply-first sequencing.
This premortem stress-tests the *seed* plan that respects those red lines.

## Context gathered

- **What it is:** Bootstrap the two-sided network from zero WITHOUT a marketer portal,
  advertiser billing-in/custody, or ad-provider (Google/Meta) integration. Pick ONE narrow
  beachhead segment to clear the ~200-device k-anon floor; recruit ~5-10 founding sponsors
  (dev-tool companies) by concierge via the existing MCP `marketer_submit_campaign` handler;
  founding sponsors pay a flat fee up front (off-platform invoice), not a custodied balance;
  recruit the first 200-500 opted-in devs in that one segment using the verifiable-privacy
  story as the hook, keeping the supply-on -> demand-on gap to days.
- **Who it affects:** Privacy/security-minded developers (supply, the moat), dev-tool
  companies (founding demand), the founder/operator running concierge, future buyers.
- **Success:** One segment with >=200 active opted-in devs; 5-10 sponsors live via concierge;
  devs see relevant paid lines and don't toggle off; small real dollars paid out and
  reconciled against signed receipts; >=2 founding sponsors want to renew/expand
  (the "demonstrated pull" gate that unlocks building anything more).
- **Current code state:** Client public/source-available, backend private; 185 tests green;
  deterministic on-device second-price auction; Ed25519-signed hash-chained receipts;
  `SUPPLY_FLOOR_DEVICES = 200` suppresses any reach report below the floor; off-by-default
  Stripe Connect payout gateway using platform-key Transfers; `Ledger.settle()`/`payout()`
  still stubs; `reconcile()` only checks `developerBalance == sum(clearingPrices)/2` (an
  internal closed loop); money path stops at `DryRunGateway` (`live = false`).

## Premortem frame

It is ~6 months from now. The Founding-Sponsor Seed Plan failed. We are looking back to
explain why.

## Raw premortem — failure reasons

1. Sponsors won't pre-fund before reach is provable; reach can't accrue before sponsors fund.
2. The segment that clears k-anon is not a segment any sponsor wants to buy.
3. Developers opt in for the ethos, see the plain line in the gap, and churn (the core cold-start).
4. Concierge doesn't scale; the solo founder becomes the bottleneck; manual steps drift.
5. Flat-fee seed economics contradict the verifiable-auction / 50-50 / `verify` story.
6. With no attribution by design, founding sponsors treat spend as goodwill and don't renew.
7. Manual creative review is inconsistent; one off-tone line detonates the trust brand.
8. Paying first devs from a collected fee pool re-creates the custody/money-transmitter shape.

---

## Deep-dives

### 01 — Sponsors won't pre-fund; reach can't accrue first

**Story:** At recruit time the segment has ~0 opted-in devices, so `aggregateReceipts` returns
suppressed campaigns and an empty list by design. The operator opens every founding-sponsor
conversation with a verifiable-privacy pitch and a literal zero on the only number a media
buyer cares about: how many people will see this. "Trust us, the receipts will be real" is not
a line item; every friendly sponsor says "come back when you have the audience." But the
audience is exactly what the sponsor money was meant to seed. Devs asked to toggle on a sponsor
line with no sponsors see blank/filler, earn nothing, and don't stay. Reach never accretes, the
200-floor never clears, both sides wait for the other. The receipt chain's greatest virtue (it
refuses to lie about reach) becomes the thing that won't let either side go first.
**Assumption:** Founding sponsors will pay a flat fee on the *promise* of verifiable reach
rather than demanding *proven* reach before any dollars move.
**Warning signs:** First 2-3 sponsor calls end with "send me the audience numbers first";
`suppressedCampaigns > 0` and `reachDevices = 0` on every loaded campaign for weeks while the
dev opt-in curve stays flat.

### 02 — The k-anon-clearing segment is not a buyable segment

**Story:** We picked `lang:python` because it was the only thing that could clear 200 active
devs in weeks, not months. We hit 240 and emitted our first honest reach report. Then every
dev-tool sponsor asked "who are these people?" and our only truthful answer was "people who
write Python." They wanted senior backend engineers at fintechs evaluating their category;
paying for "all Python devs" is worse than the cheap hyper-qualified targeting they already get
on a newsletter or subreddit. Attempts to narrow (`framework:django` + `task:database`) dropped
the intersection to ~30 devices and the k-anon floor refused to emit. We could prove a segment
nobody pays for, or describe a segment we could never prove. The sets never intersected; zero
of two renewals closed.
**Assumption:** A privacy-provable broad segment has buyer value, when ad spend pays precisely
for the qualification the 3-prefix vocabulary and k-anon floor structurally forbid.
**Warning signs:** In sponsor calls the first question is consistently "can you narrow it to
X?" and every narrowing drops below 200 or isn't expressible in lang:/framework:/task:; sponsors
only agree to a floor flat fee framed as an "experiment" with no renewal budget line.

### 03 — Developer churn in the supply-on -> demand-on gap

**Story:** Supply was the easy sell; ~300 opt-ins in three weeks. But closing a dev-tool company
on a flat fee with no portal, no dashboard, "trust our signed receipts" took six to eight weeks
per logo, not days. "Keep the gap to days" was one founder doing two-sided sales serially. Devs
turned it on and saw the plain "Thinking..." line, honestly earning nothing. The honesty became
the weapon: because earnings are signed, hash-chained, stranger-verifiable, the disappointing
number was a quotable artifact ("$0.03 over two weeks, toggled off"). The stranger-verifiability
built as the trust moat made the cold-start emptiness *credible and screenshotable*. Evangelists
opt in once; when the first impression is empty, they don't re-toggle when sponsors arrive, and
they've already told their followers.
**Assumption:** The supply-on -> demand-on gap is a scheduling problem (days) rather than a
structural consequence of serial two-sided concierge sales (weeks-to-months).
**Warning signs:** Median days-since-opt-in with zero paid receipts climbing past ~7 across the
cohort; first public signed-receipt screenshot of trivial/$0 earnings posted to HN/Discord.

### 04 — Concierge doesn't scale; founder bottleneck + reconciliation drift

**Story:** Sponsors 1-5 felt like proof at ~3 founder-hours each (call, manual load, eyeball
review, invoice, payout note). Then the same person had to publish npm patches, fix a status-bar
bug, recruit the next 100 devs, AND onboard sponsors 6-10. Everything queued behind one human.
The quiet killer was reconciliation drift: by-hand payout matching against signed receipts is
exact work done in stolen minutes. A flat fee got entered as a daily cap, one sponsor over-served,
two payout cycles slipped during a recruiting push. Receipts were perfect and verifiable, but
the off-platform money didn't match them, and catching it needed a half-day audit the founder
didn't have. By month five a sponsor churned over a billing dispute and devs noticed inconsistent
payouts. The k-anon floor held; the operator didn't.
**Assumption:** Concierge effort scales sub-linearly, when it is fixed-cost-per-unit work
competing for the same single person's hours as engineering and supply.
**Warning signs:** Sponsor onboarding lead time creeping past one week, or a queue of "verbally
committed, not yet loaded" sponsors; the first reconciliation mismatch between off-platform
dollars and signed receipts, especially one caught by a sponsor or dev.

### 05 — Flat-fee economics make `verify` truthful about fiction

**Story:** Onboarding goes fine, but the on-device second-price auction needs bids. The flat-fee
sponsor never submitted a per-impression bid, so the operator seeds a synthetic `bidCents` (or
two, for non-trivial second-price math). Each impression records a `clearingPriceCents`, the
ledger accrues `floor(clearing/2)`, and `verify` returns exit 0. Everything is internally
consistent and entirely circular. A sharp dev runs `verify`, sees it replay both auctions and
confirm the split, then asks where the clearing prices came from. Dividing the sponsor's known
flat fee by impression count matches nothing. `reconcile()` only proves
`developerBalance == sum(clearingPrices)/2` (a tautology over operator-chosen numbers); no module
signs a link from a real dollar to any `clearingPriceCents`. The dev posts: "`verify` proves the
math is consistent with itself. It proves nothing about whether the prices are real or whether
I'm owed what it says." The seed shortcut didn't break `verify`; it made `verify` truthful about
fiction. Once "verifiable" is exposed as theater, trust does not come back.
**Assumption:** Cryptographically replaying the auction proves earnings are real, when it only
proves the recorded numbers are internally consistent with each other.
**Warning signs:** `clearingPriceCents` traces back to operator-set synthetic `bidCents`, not a
sponsor-submitted price, and `flat_fee / impressions` reconciles to no receipt price; `reconcile()`
and `verify` pass green while the money path stops at `DryRunGateway` with no external proof of
the fee.

### 06 — No attribution -> goodwill spend -> no renewal

**Story:** Eight sponsors signed on the founder's network and a clean values pitch. The flight
delivered exactly what was promised: honest signed-receipt impression counts, DP-aggregate reach,
stranger-verifiable. Then Q3 planning hit. Each marketing lead had to defend line items against a
CAC/ROAS spreadsheet, and Sponsorline's row had one number (impressions) and a blank column where
pipeline/signups belong. The champion who signed (a founder or VP who "got it") couldn't translate
goodwill into a renewal the growth team would approve. With no click, no UTM, no attributable
signup by design, there was no artifact to argue with. Five of eight churned silently; zero hit
renew/expand; the ">=2 renew" gate failed and "demonstrated pull" was never proven.
**Assumption:** Sponsors who buy on values will renew on values, when they buy on values once but
renew only against a number their finance/growth team accepts.
**Warning signs:** During the sale, sponsors ask "how will we know it worked?" and accept a vague
answer; the signing contact is a founder/VP, not the growth/performance-marketing owner who
controls recurring budget.

### 07 — Inconsistent manual creative review detonates the trust brand

**Story:** Founding sponsor #6, a Series-B with an aggressive growth team, asked a week before
launch to swap in a "punchier" line: "Ship 10x faster, your competitors already are. Try [X]
free." The operator, concierge-onboarding three sponsors that day with no codified rubric (only
the vibe of "respectful"), read it as borderline-but-acceptable and loaded it. No second reviewer,
no logged rationale. It surfaced in ~300 status bars; a dev screenshotted it directly beneath
Sponsorline's own landing copy ("addictive products earn attention, they don't demand it") and
posted the pair with "demand it, apparently." HN within hours. The thread's argument wasn't about
one line, it was that judgment-based review can't be a trust guarantee: "we hand-check every
creative" is exactly as strong as the most rushed operator on the worst day. Zero-egress was
intact and irrelevant; the story became "consent-first ad network ships dark-pattern copy."
**Assumption:** An operator's in-the-moment taste is a reliable, repeatable substitute for a
written, enforceable creative standard.
**Warning signs:** Two operators (or the same operator on different days) reach different verdicts
on a near-identical line with no written tie-breaker; any approved line uses comparative/competitor
framing, urgency, or an imperative CTA and gets loaded anyway.

### 08 — Fee pool re-creates the custody / money-transmitter shape

**Story:** Off-platform flat-fee invoices landed in Sponsorline's Stripe balance: one commingled
pool, sourced from sponsors, earmarked for devs. The "flat fee" framing changed the price
*structure* and nothing about the *flow*: sponsor dollars in, held by Sponsorline, fanned out by
Sponsorline's choice to ~300 unrelated devs via `/v1/transfers` from the platform's own key
(`stripe-gateway.ts`), the platform-as-payor signature Stripe's risk models flag. By the third or
fourth payout batch, Stripe's review saw inbound flat fees from a few payers and immediate fan-out
to hundreds of new Express accounts with no underlying marketplace transaction, and placed a
reserve/hold. Devs with signed receipts didn't get paid; "dollars paid and reconciled against
receipts" inverted to "receipts exist, dollars frozen." Meanwhile active early devs crossed $600
cumulative with no W-9/1099 pipeline; as collector-and-disburser, Sponsorline was payor of record
with a filing obligation it couldn't meet.
**Assumption:** Pricing a fee "flat" and invoicing it "off-platform" changes the regulatory shape
of the money, when only the flow (collect, hold, select, fan-out) determines it, and the flow was
unchanged.
**Warning signs:** Sponsor fee money sits in Sponsorline's Stripe balance before any dev is paid
(commingled, not pass-through); cumulative payout to any US dev approaches $600 with no W-9 on file
and no 1099 path in code.

---

## Synthesis

**Most likely failure:** The two-sided cold-start deadlock, surfacing in concierge form
(failures 01 + 03 + 04). The plan's load-bearing premise, "keep the gap to days," is false: serial
two-sided concierge sales by one founder takes weeks-to-months, and during that gap the honest,
stranger-verifiable receipt chain turns the emptiness into a credible, quotable public artifact
that burns the exact evangelist cohort the network needs. Reach can't accrue before sponsors fund;
sponsors won't fund before reach is proven.

**Most dangerous failure:** Flat-fee seed economics making `verify` attest to fiction (failure 05),
tied with a Stripe balance freeze (failure 08). 05 is the most dangerous because it is irreversible
and strikes the core: today's `verify`/`reconcile()` prove *internal consistency*, not *real-money
provenance*. The seed is the first time real money meets synthetic auction prices, so it exposes
that gap on the most scrutiny-prone cohort. Once "verifiable" is shown to be theater, the moat is
gone and does not return. 08 is the operational catastrophe that freezes every dev's earned dollar.

**The hidden assumption (the big one):** That you can seed the network with shortcuts (synthetic
auction bids, flat off-platform fees, goodwill sponsors, manual everything) without the shortcuts
dissolving the very properties the seed exists to prove: real-money-anchored verifiability,
genuine auction prices, measurable renewable value, and a clean money flow. The seed phase's
shortcuts contradict what the seed is trying to demonstrate. The deepest, most specific form:
**`verify` currently proves the math is consistent with itself, not that the money is real** -
and the seed is exactly where that bites.

**Revised plan:**
1. **Anchor money to receipts before seeding** (fixes 05, 08). Either have founding sponsors
   submit *real* per-impression bids through the MCP handler so clearing prices are real, or
   explicitly label the seed a fixed-reward pilot and stop marketing `verify` as proof of market
   earnings during seed. Add a signed settlement record linking each real sponsor payment to its
   impression batch so `reconcile()` ties to real dollars, not a tautology. Separate the two
   claims publicly: `verify` proves privacy + chain integrity (true now) vs proves you were paid a
   real market price (not true until money is anchored).
2. **Do not custody** (fixes 08). Use Stripe destination charges / `on_behalf_of` so sponsor money
   never lands in Sponsorline's balance; decide W-9/1099 before any US dev nears $600, or cap seed
   payouts well under the threshold and document the pilot-stipend posture.
3. **Choose the segment by buyer-demand AND k-anon jointly** (fixes 02). Before recruiting devs,
   confirm with 3-5 sponsors that a 200+-clearable 3-prefix segment is actually worth paying for.
   If none is, that is a product-vocabulary / business-model decision to make *before* seeding
   (accept CPM brand-sponsorship framing rather than performance targeting).
4. **Pre-sell demand to break the deadlock** (fixes 01, 03). Get written contingent commitments
   ("we fund $X when you reach 200 devices in segment Y") from 3-5 sponsors *before* recruiting
   devs, so you can honestly tell devs "real paid lines land the day we hit 200." Sequence:
   soft-circle demand -> recruit supply to the floor -> flip demand live within days.
5. **Codify the creative standard** (fixes 07). One-page written policy (no comparative/competitor
   framing, no urgency/FOMO, no imperative-shaming CTA, mandatory clear label), two-person sign-off,
   and a logged approval record enforced at submit time, not operator vibe.
6. **Sell on a renewable, privacy-safe metric, not goodwill** (fixes 06). Define what a sponsor can
   renew against without attribution (DP-aggregate reach + frequency, plus an optional consented,
   on-device, aggregate-only "interested" signal above k-anon). Sell to the growth owner and set
   the renewal metric at sale time. If no privacy-safe value metric exists, price and sell these
   honestly as brand sponsorships.
7. **Tool the concierge without building a portal** (fixes 04). Script campaign loading and a
   reconciliation check that matches off-platform payments to signed-receipt batches and flags
   drift; template onboarding. Internal tooling, not a marketer-facing product.

**Pre-launch checklist:**
- [ ] 3-5 sponsors give written contingent commitments for a specific 200+-clearable 3-prefix
      segment BEFORE dev recruiting begins.
- [ ] Real-money anchor in place: a signed settlement record links each sponsor payment to its
      impression batch and `reconcile()` ties to real dollars - OR the seed is explicitly a
      fixed-reward pilot and no marketing claims `verify` proves market earnings.
- [ ] No sponsor funds land in Sponsorline's Stripe balance (destination charges / `on_behalf_of`),
      OR seed payouts capped under tax thresholds with a documented stipend posture; W-9/1099 path
      decided.
- [ ] Written creative policy + two-person sign-off + logged approvals, enforced at submit time.
- [ ] Renewal metric agreed with each sponsor's growth owner at sale time (privacy-safe), not goodwill.
- [ ] Reconciliation script flags payment-vs-receipt drift automatically.
- [ ] Median "days opted-in with zero paid receipts" monitored; supply recruiting paced to the
      demand-live date.
