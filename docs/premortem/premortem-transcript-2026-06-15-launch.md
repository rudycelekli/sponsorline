# Sponsorline Launch Premortem — Transcript (2026-06-15)

Method: Gary Klein prospective hindsight. Frame: it is December 2026, the public
launch has failed, explain why. Seven failure modes, one investigator each, run
in parallel.

## Context gathered

- **What:** the public launch of Sponsorline, a consent-first, zero-egress ad
  network inside AI coding tools. Launch = publish npm packages at 0.3.0, deploy
  the landing page with the in-browser mp4 preview, announce on LinkedIn / X / HN.
- **Who:** developers (supply side, earn 50%), enterprises (security can approve
  the surface), marketers (demand side, roadmap only at launch).
- **Success:** a clean launch where the `verify` claim survives scrutiny,
  developers opt in, and there is no trust, platform, or legal blowup.

Sources: `docs/gtm/launch-plan.md`, `docs/premortem/` priors, the public client
packages, and the standing project mandate/invariants in memory.

## Raw premortem — the seven failure reasons

1. **Host-tool platform risk.** Anthropic/Cursor ToS may forbid third-party ads
   in their status line, or the API may not durably support the surface.
2. **`verify` proves the wrong thing.** Ledger consistency is not proof of zero
   network egress; the headline overclaims.
3. **Two-sided cold start.** Verify once, turn off; supply never reaches the
   ~200-device per-segment k-anon floor; no sellable reach; flywheel never turns.
4. **"Ads in my editor" backlash.** The category, not the implementation, becomes
   the story; durable reputational damage.
5. **Trust failure on a trust product.** The exposed npm token or a leaked
   backend secret detonates a brand whose only moat is trust.
6. **Solo-founder bandwidth collapse.** One person can't defend HN, fix launch
   bugs, and run demand in the same 48 hours.
7. **"Earn 50%" outruns payout reality.** No live payout rail; KYC/tax/threshold
   friction; or money-transmitter exposure freezes payouts.

---

## Investigator deep-dives

### 01 — Host-tool platform risk

**Failure story.** Sponsorline launched on the assumption that "official extension
point" equals "permitted use." It does not. The Claude Code `statusLine` hook
(`type: "command"`, session JSON to stdin, one line of stdout) and Cursor's
`createStatusBarItem` are both real and unpatched, but they were built so a
developer can show *their own* context, not so a third party can sell that pixel.
When the HN post hit the front page with "an ad network inside Claude Code," it
surfaced the integration to the platform teams. Within days the usage policy and
marketplace terms were quoted back, both carrying the standard clause prohibiting
serving third-party advertising without authorization. The animated-creative
ambition depends on the host not stripping escapes and on a redraw frequency the
host never promised; motion shipping off-by-default was already an admission the
surface is fragile. Anthropic did not even need to ban anything: a routine release
that sandboxes statusLine output or rate-limits redraws silently zeroes the
inventory. Cursor's marketplace gave them a review gate and a remove button. By
December the verify cryptography was flawless and irrelevant; the enterprise pitch
collapsed because a security reviewer's first call is to the vendor, who confirms
it's unsanctioned.

**Underlying assumption.** That a documented, unpatched extension point is also a
contractually and durably permitted one for third-party monetization, when the
host vendor controls both the terms and the next release.

**Early warning signs.**
- No written platform authorization on file, only extension-point mechanics.
- The surface is host-governed (redraw cadence, line length, escape handling all
  decided by the host each frame); a single upstream changelog line disables it.

### 02 — verify proves the wrong thing

**Failure story.** Sponsorline led with "The verify command is the whole pitch."
Within an hour a reader read `cmd-verify.ts`: it does three things, all on a local
ledger the client itself wrote — `validateConsent`, `verifyLog` (replays the
hash-chained witness log), and re-asserting allowlisted signals. The top comment:
"This proves the log you kept is internally consistent and signed. It says nothing
about what the process actually put on the wire. You're verifying your own diary."
The headline claimed verification of *both* claims (consent AND zero code egress);
egress is the one `verify` cannot touch. SECURITY.md's own table attributes
zero-egress to a source-property ("only allowlisted signal atoms are ever
emitted") while `verify` is sold as the proof. Real egress proof would be
tcpdump/strace or an audit of every network call path — neither of which `verify`
performs. The kill shot: the backend is private, so the server side that receives
the interest vector is entirely unauditable. By December the narrative had
hardened into "Sponsorline got caught calling a signature-check a network-privacy
guarantee." The demo meant to win the security crowd became the artifact used to
discredit it.

**Underlying assumption.** That cryptographic consistency of a client-authored,
signed ledger is interchangeable with a guarantee about what the client process
actually transmitted over the network.

**Early warning signs.**
- SECURITY.md conflates a source-property and a `verify`-property under one claim.
- `cmd-verify.ts` reads exclusively from local store with no network capture or
  egress-path analysis, yet copy says it verifies the egress claim.

### 03 — Two-sided cold start

**Failure story.** The launch went fine; the HN post hit the front page on the
privacy story and `verify` was genuinely delightful. A few thousand installed. But
verify is a one-time party trick; the status line is a daily tax. Within a week
most ran `sponsorline off` or uninstalled, because there was no countervailing
reason to leave it on. `earnings` showed $0.00 — and it *had* to, because no
segment had crossed the 200-device k-anon floor, so nothing was sellable, so there
was no concierge advertiser, so no impressions to pay for. The dog could not eat
until it had already eaten. The floor turned a hard cold-start into an impossible
one: installs smeared thinly across `lang:* / framework:* / task:*` cells;
`lang:typescript` briefly touched ~60 active devices, `lang:rust + axum` had four;
no cell held 200 simultaneously-active devices, and churn emptied the ones that
filled. By December the repo had stars, a beautiful verify demo, and zero dollars
transacted. The privacy engineering was irrelevant because the market never
reached the threshold where privacy even mattered.

**Underlying assumption.** That developers will keep an in-editor ad opted-in on
the promise of future earnings, when the k-anon floor guarantees those earnings
are exactly zero until a single segment hits a density no honest organic launch
reaches.

**Early warning signs.**
- Verify-to-retain collapse: high week-1 init/verify, day-7 retention in the low
  single digits ("neat, then off").
- The max active-device count across all segment cells plateaus far below 200
  even as total installs climb.

### 04 — "Ads in my editor" backlash

**Failure story.** The LinkedIn post lands fine; LinkedIn rewards founder
confidence. The cross-post to HN is where it dies. Within ninety minutes the top
comment is not about zero-egress, it is "an ad network in your editor is a
sentence that should have ended a startup before it started." The thread becomes a
referendum on the category, not the implementation. Every defense reads as a
guilty man explaining the alibi. The 50% split gets reread as "selling your
attention back to you for pennies," and "inevitable trend" gets clipped as the
smoking gun. X amplifies the dunk because dunking is the native verb of X. The
animated sealed-frame creative, the genuinely clever part, becomes the meme asset.
Because brand and founder name are the same surface, the backlash is personal and
durable and searchable; six months later "Sponsorline" autocompletes to
"Sponsorline controversy." The damage is poisoned trust: opted-in devs stay quiet
to avoid association; sign-ups stall because the social cost exceeds fifty cents
a day.

**Underlying assumption.** That developers will judge the product on how cleanly
the ads are implemented, rather than on the fact that there are ads at all.

**Early warning signs.**
- Pre-launch: describing the project in one sentence makes a dev friend wince or
  joke, not ask how it works.
- Launch hour: top comments and the dunk-to-question ratio are about the category,
  not the mechanism. If nobody engages with verify, the framing war is lost.

### 05 — Trust failure on a trust product

**Failure story.** The token was the kill shot. The runbook had "Step 0: revoke
the exposed npm token," but Step 0 was treated as a checkbox, not a blocker. The
plaintext token lived in an untracked, non-gitignored scratch file (`Untitled`)
one directory above the repo root, holding the literal token (prefix
`npm_VHb7…`, full value deliberately not reproduced here). On launch day a wide `git add` from
the parent directory, or pasting the folder into a gist/CI context, carried it
along; because it was never revoked at the registry, it was live. An attacker
published a malicious `sponsorline@0.3.1`. The irony is total: a product whose
pitch is "never sees your code — verify it" now ships a postinstall script that
*does* see code, hitting the exact security-conscious audience. Ed25519 did not
save it: npm publish trust is the token, not the seal, and the two trust chains
were never connected. By December "Sponsorline" returns a GitHub Security Advisory
and an npm malware notice as its top results. For a trust vendor this is terminal.

**Underlying assumption.** That security hygiene is a launch task to complete
rather than a gate that must be proven — "I'll revoke it" treated as equivalent to
"it is revoked and no copy exists anywhere on disk."

**Early warning signs.**
- A live secret in plaintext, outside the repo and outside .gitignore:
  `/Users/rudycelekli/Downloads/claudeAds/Untitled` contains the token and is not
  git-ignored (verified during this premortem).
- Two disconnected trust chains presented as one: the Ed25519 key secures consent
  receipts; npm publish authority rests entirely on the token. The runbook never
  proves the token dead (`npm token list`) before publish.

### 06 — Solo-founder bandwidth collapse

**Failure story.** The post went live at 9:14 AM. By 10:15 the HN thread had 140
comments; the top one sharply challenged the zero-egress claim. It was answerable,
but the founder was in a different fire: `npx sponsorline init` was throwing
because the core/CLI version pin resolved against a registry cache that hadn't
propagated. The headline command worked; the install funnel didn't. Fixing it
meant a republish, smoke test, and propagation wait — none doable while typing
careful security replies. So the thread drifted; the unanswered top comment
hardened into the accepted read. The founder surfaced around 1 PM, posted a
thorough correction, but the votes had already sorted and the LinkedIn replies
were three hours cold. The entire demand/supply motion sat untouched; the
concierge intros the spike should have generated were a Slack DM and two emails
never opened. By December Sponsorline isn't dead, it's inert: stars, no sustained
installs. There was one window where attention, scrutiny, and curiosity peaked at
once, and one person could occupy only one room at a time.

**Underlying assumption.** That launch-day attention, security defense,
bug-fixing, and the demand/supply motion would arrive sequentially rather than
collide in the same 48 hours.

**Early warning signs.**
- The runbook assigns one person to "be present to answer" while the steps most
  likely to break (npm propagation, deploy, smoke test) happen at announce time,
  with no second human named.
- A hostile top HN comment on the core claim sitting unanswered for more than ~30
  minutes during peak traffic.

### 07 — "Earn 50%" outruns payout reality

**Failure story.** The launch post landed well; "Developers earn 50 percent" was
the line that traveled, and thousands toggled it on. Behind it, the only payout
gateway in the repo was `DryRunGateway` — `live = false`, moves no real money, by
design. The live Stripe Connect rail (Connect onboarding for individuals,
W-9/1099, KYC, fraud screening) was the deliberately-unbuilt seam. Balances
accrued and the settlement log proved them real, but nothing could leave an
account. `minPayoutCents` is 1000 ($10), but most early devs accrued cents to low
single dollars, and the honest "human-uniqueness belongs at payout-time KYC" line
meant the first real payout interaction was a government-ID flow for $3. Devs
posted "I have to do KYC and connect Stripe to withdraw $3 I can't even reach the
minimum for." "Earn 50%" read as a money promise; the trust brand could not honor
the one number that mattered. The kill shot was structural: either payouts never
went live (so "earn" was true in the ledger and false in the bank), or funds got
pooled and fanned out — the money-transmitter shape — and Stripe froze the account
mid-engagement.

**Underlying assumption.** That cryptographically proving a developer is *owed*
money is the hard part, when the hard part is the unbuilt legal/operational rail
that actually *pays* them at amounts too small to justify KYC, tax forms, and
Connect onboarding.

**Early warning signs.**
- The shipped code is the tell: `payout.ts` ships only `DryRunGateway`
  (`live = false`) while `launch-post.md` commits to "earn 50%."
- Accrued-vs-paid divergence: settlement `paidCents` stays 0 while balances climb,
  median balance below the $10 floor.

---

## Synthesis

**Most likely failure — two-sided cold start.** Verify once, turn off; earnings
are structurally $0 until a segment crosses the ~200-device k-anon floor; density
never forms; the flywheel never turns. Most probable because it needs no villain.

**Most dangerous failure — trust failure on a trust product.** Confirmed live: the
exposed npm token is still in plaintext in `~/Downloads/claudeAds/Untitled`,
unrevoked. A hijacked package version would be permanent reputational death for a
"don't trust, verify" brand. Insure against it before anything ships.

**The hidden assumption (the real lesson).** Across every mode, the project
substitutes "we built / asserted X" for "X is independently verified or
permitted": documented extension point = permitted ad surface; signed ledger =
proof of zero egress; "I'll revoke it" = it is revoked; "earn 50%" = devs can be
paid. Ironic for a product whose pitch is *don't trust, verify*. Turn that lens
inward.

**Revised plan.**
1. Verify the token is dead, don't assert it: revoke, `npm token list` to confirm,
   delete `Untitled`, npm 2FA + provenance, publish from a clean env.
2. Get platform permission in writing (Anthropic + Cursor) or publicly disclose
   the platform risk and reframe as a developer-owned, opt-in monetized surface.
3. Stop claiming `verify` proves zero-egress; back the egress claim with the
   auditable open-source client, a reproducible build, and an audit invitation;
   drop "verify both claims in one command."
4. Reframe the headline away from "I turned on an ad network"; pre-seed trusted
   devs who engage on mechanism.
5. Don't promise money you can't pay: reword "earn 50%" to conditional/forward;
   show a live "devices per segment" counter; earnings after density.
6. Protect the one-person window: freeze + smoke-test the npm funnel hours before
   announce; pre-write top-5 objection replies; no concierge sales in first 48h.

**Pre-launch checklist.**
- [ ] `npm token list` shows the exposed token gone; `Untitled` deleted; 2FA on;
  publishing from clean env.
- [ ] Written platform answer (or public risk disclosure) on status-line sponsor
  content for both Claude Code and Cursor.
- [ ] Launch copy no longer says `verify` proves zero-egress; egress backed by
  auditable client + reproducible build + audit invitation.
- [ ] "Earn 50%" reworded to conditional; no unpayable balances accrue.
- [ ] npm funnel smoke-tested from a fresh machine ≥3h before announce; top-5 HN
  objection replies pre-written.
