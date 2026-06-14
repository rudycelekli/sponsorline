# Sponsorline Threat Model

**Status:** living document
**Scope:** the Sponsorline monorepo (`@sponsorline/core`, `sponsorline` CLI, `@sponsorline/mcp`,
`sponsorline-cursor`) as of the current `main`.
**Audience:** enterprise security reviewers, integrators, and contributors.

This document follows a lightweight STRIDE-style pass over the system's trust boundaries. It
states each asset, who could attack it, what stops them in code, and what is explicitly left to
a different layer.

---

## 1. Assets

| Asset | Why it matters |
|-------|----------------|
| **Developer code / context** | The thing we promise never to exfiltrate. Highest-value asset. |
| **Consent record** | Authorizes display; defines the allowed signal scope and validity window. |
| **Witness log** | The tamper-evident record of every auction and impression; the basis of earnings. |
| **Device signing key (`salt`)** | Authority to sign impressions and receipts as a given device. |
| **Reach receipts** | The billing/sales artifact: signed proof a campaign reached N devices. |
| **The terminal/status line** | A rendering surface that executes in the developer's terminal. |

## 2. Trust boundaries

1. **Device ↔ platform.** The device emits only allowlisted signals and signed artifacts.
   Everything else stays local. This is the primary privacy boundary.
2. **Advertiser ↔ platform.** Advertiser-supplied content (creatives, targeting predicates,
   campaigns) is untrusted input and validated at ingestion.
3. **Device ↔ verifier.** A verifier holds only the published public key; it can check
   everything and forge nothing.

---

## 3. Threats, mitigations, and residual risk

### T1 — Platform learns what the developer is coding (Information disclosure)
- **Vector:** Platform tries to read code, paths, or fine-grained context from telemetry.
- **Mitigation:** Only coarse, versioned, allowlisted atoms (`lang:*`, `framework:*`, `task:*`)
  are ever emitted. `sponsorline verify` asserts 0 bytes of code/path in egress across every
  recorded impression, against the published key. Targeting predicates are allowlist-checked,
  so an advertiser cannot request a PII-bearing atom (e.g. an email).
- **Residual:** Coarse interest signals are themselves a (small) disclosure; this is the
  consented, inspectable trade and is bounded by the allowlist taxonomy.

### T2 — Earnings inflation by editing history (Tampering)
- **Vector:** A device edits, inserts, reorders, or deletes impressions to inflate earnings.
- **Mitigation:** Hash-chained witness log — each impression embeds the prior payload's
  SHA-256. A single Ed25519 signature over the head transitively authenticates the whole
  ordered chain, so any mutation breaks verification. `verify` replays every auction to its
  recorded outcome.
- **Residual:** A device can choose *not* to report (under-counting), which harms only itself.

### T3 — Forged or replayed reach receipts (Spoofing / Tampering)
- **Vector:** An attacker submits receipts to inflate an advertiser's reported reach.
- **Mitigation:** Each receipt is Ed25519-sealed and self-describes its device public key.
  `aggregateReceipts` verifies every seal (forged → rejected) and deduplicates per
  `device+epoch`, so resubmitting the same period cannot double-count.
- **Residual:** A validly-sealed but *implausible* receipt is handled by T4.

### T4 — Sybil / bot-farm reach (Spoofing at scale)
- **Vector:** An attacker mints key pairs and self-seals high-volume receipts.
- **Mitigation:** `screenReceipts` enforces a **physical ceiling of 96 impressions/day** — one
  billable impression per 15-minute rotation window, so any higher volume is provably
  fabricated regardless of how it was signed. A per-device spend cap bounds payout blast
  radius, and epoch freshness rejects future/stale receipts. Flagged receipts are surfaced
  (`flaggedReceipts`), never silently dropped.
- **Residual — explicitly out of scope:** Proof of a **unique human**. An attacker can still
  mint many keys, each producing a plausible *low-volume* receipt. Screening raises the cost of
  farming; it does not close it. The unique-identity gate belongs at **payout-time KYC**
  (e.g. Stripe Connect identity), not in this layer. We do not claim to solve it here.

### T5 — Terminal hijack via advertiser creative (Elevation / Tampering)
- **Vector:** An advertiser submits a creative containing a newline or ANSI/ESC control
  sequence to break the one-line status contract or hijack the terminal (clear screen, move
  cursor).
- **Mitigation:** Inventory ingestion rejects creatives over the length cap and any creative
  containing control characters (`\u0000–\u001F`, `\u007F`). Malicious creatives never reach
  the rendered inventory.
- **Residual:** None known for the control-character class; new rendering surfaces must apply
  the same gate.

### T6 — Supply-chain / binary tampering (Tampering — DECLINED capability)
- **Vector:** Integrating by patching another tool's binary or shipping an unsigned
  auto-updater (the failure mode of at least one competitor).
- **Mitigation:** Sponsorline integrates *only* through official, documented extension points
  (Claude Code `statusLine`, Cursor adapter). No patching code exists in the tree. This is a
  permanent design invariant, not a current limitation.
- **Residual:** None — the capability is intentionally absent.

### T7 — Consent bypass or stale consent (Elevation)
- **Vector:** Displaying sponsored content without valid consent, or after revocation.
- **Mitigation:** `validateConsent` checks a signed consent record (scope + validity window)
  before any sponsored line; invalid/expired consent falls back to the plain line.
  `sponsorline off` revokes immediately.
- **Residual:** Consent is per-device; loss of device control is outside this boundary.

### T8 — Malformed local state crashes a command (Denial of service, local)
- **Vector:** A corrupted local file (settings, inventory, witness) crashes the CLI.
- **Mitigation:** All local-file parsing is guarded; a malformed file must never crash a
  command (covered by tests, e.g. the status command's never-crash-on-malformed case).
- **Residual:** None known for the parsed-file class.

---

## 4. Out of scope (by design)

- **Unique-human identity.** Deferred to payout-time KYC (see T4).
- **Live money movement.** Developer payouts have a built, tested gate (`payout.ts`) with two
  independent controls: KYC-verified + connected account + in-range amount, AND an explicit
  operator-authorization flag (defaults off). A live Stripe Connect gateway
  (`packages/mcp/src/stripe-gateway.ts`) is now built, but it is wired behind a third control:
  it is selected only when both `STRIPE_SECRET_KEY` is set and `SPONSORLINE_LIVE_PAYOUTS` ===
  `"true"`; otherwise the dry-run gateway (no real money) is used. Keys are read from the
  environment only, and the test suite drives the gateway through a mocked transport (zero live
  API calls). So live money still cannot move implicitly — it requires KYC, operator
  authorization, a configured secret key, and an explicit live opt-in, all at once. Advertiser
  billing and tax handling (e.g. 1099) remain out of scope until explicitly enabled.
- **Outbound differential-privacy aggregate egress (the "C2" path).** Viable only above
  ~200 contributing devices (proven in `bench/dp-sim.mjs`) and gated behind explicit operator
  approval; it is not enabled by default.

## 5. Verification checklist for reviewers

- [ ] `npx sponsorline verify` passes on a clean clone.
- [ ] Egress contains only allowlisted atoms (no code, no paths).
- [ ] Editing any witness entry causes `verify` to fail.
- [ ] A creative with a control character is rejected at ingestion.
- [ ] A receipt claiming > 96 impressions/day is flagged, not aggregated.
- [ ] A forged-seal receipt is rejected.
- [ ] No code in the tree patches another tool's binary.
