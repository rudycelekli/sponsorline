# Security

Sponsorline is built so that an enterprise security team can approve it after reading the
code, not after trusting a vendor's word. This document is the entry point for that review:
what the system promises, how those promises are enforced in code, what is explicitly out of
scope, and how to report a problem.

## The one-line promise

**The only AI-dev ad network that never sees your code.** Raw developer context never leaves
the device. The auction sees only a coarse, versioned, allowlisted interest vector
(`lang:*`, `framework:*`, `task:*`). A stranger can verify both claims from a clean clone in
one command.

## Security properties and where they are enforced

| Property | What it means | Enforced by |
|----------|---------------|-------------|
| **Zero code egress** | No source, file path, or buffer ever leaves the device. | Only allowlisted signal atoms are ever emitted; `sponsorline verify` re-asserts 0 bytes of code/path across every recorded impression. |
| **Consent-gated display** | Nothing renders until the developer opts in, and a revoke takes effect immediately. | `validateConsent` checks a signed consent record (scope + validity window) before any sponsored line; `sponsorline off` revokes on the spot. |
| **No binary patching** | Sponsorline integrates only through official, documented extension points (Claude Code `statusLine`, Cursor adapter). It never modifies another tool's binary or ships an unsigned auto-updater. | No patching code exists in the tree; integration is a `statusLine` command entry. |
| **Stranger-verifiable history** | Anyone can replay every auction and re-check every privacy invariant against the published public key, without the ability to forge anything. | Hash-chained witness log + single Ed25519 head signature; `sponsorline verify` runs against `pubkey` only (the signing `salt` never leaves the device). |
| **Tamper-evidence** | Any insert, delete, reorder, or edit of the impression history breaks verification. | Each impression embeds the prior payload's SHA-256; one signature over the head transitively authenticates the whole ordered chain. |
| **Authentic reach reporting** | "Your brand reached N devices for M minutes" is counted from signed device receipts, never estimated. | Per-device Ed25519-sealed receipts; `aggregateReceipts` verifies each seal, deduplicates per device+epoch, and counts distinct devices. |
| **Anti-sybil screening** | Physically impossible or over-budget reach is withheld before payout. | `screenReceipts` enforces a 96-impression/day physical ceiling (one billable impression per 15-min rotation window), a per-device spend cap, and epoch freshness. |
| **No ad-network integration (enforced)** | The codebase never calls an ad-provider/tracking endpoint or imports a cross-site identity graph — the moat behind "never sees your code". | A static egress-guard test scans all source and fails the build on any external host other than `api.stripe.com`, any ad/tracking domain, or any identity token (`gclid`/`fbclid`/Customer Match). |
| **Honest reach floor** | A campaign too thin to be anonymous or meaningful is withheld, never sold as "reach". | `aggregateReceipts` applies a 200-device k-anon supply floor (`SUPPLY_FLOOR_DEVICES`), surfacing withheld campaigns as `suppressedCampaigns`. |

## How verification works (what an auditor runs)

```bash
git clone <repo> && cd sponsorline
npm install && npm run build
npx sponsorline verify    # replays every auction, asserts privacy invariants, checks the chain
```

`verify` runs only against the **published public key**. The signing secret (`salt`) never
leaves the device, so a verifier can check everything without being able to forge anything.
Under that key it proves the log is internally consistent: every auction replays to the
recorded outcome, every impression carries only allowlisted signals within the granted
consent scope and validity window, and the hash chain is unbroken.

## Cryptography

- **Signatures:** Ed25519 via `@noble/curves` (pure JS, no native build step).
- **Hashing:** SHA-256 via `@noble/hashes`.
- **Canonical bytes:** `utf8ToBytes(JSON.stringify(payload))` — deterministic input to both
  signing and chaining.
- **Device key:** derived locally from a per-device `salt`. The private key never leaves the
  device; only `publicKeyHex` is published and embedded in receipts.

## Threat model

A full threat model lives at [`docs/security/threat-model.md`](docs/security/threat-model.md).
Summary of what is and is not in scope:

**In scope (mitigated):**
- A malicious or curious platform trying to learn what a developer is coding.
- Tampering with the impression history to inflate earnings.
- A forged or replayed reach receipt inflating an advertiser's reported reach.
- A single device fabricating physically impossible impression volume.
- Terminal injection via an advertiser-controlled creative string.

**Out of scope (handled elsewhere, by design):**
- **Proof of a unique human.** An attacker can still mint many key pairs, each producing a
  plausible low-volume receipt. Screening raises the cost of farming; the final unique-identity
  gate belongs at payout-time KYC (e.g. Stripe Connect identity), not in this layer. We do not
  claim to solve it here.
- **Live money movement is off by default behind three independent controls.** Developer
  payouts have a built, tested *gate* (`payout.ts`): money may be authorized only when KYC is
  verified, a payout account is connected, the amount is in range, **and** an explicit
  per-execution operator-authorization flag is set. A live Stripe Connect gateway
  (`packages/mcp/src/stripe-gateway.ts`) now exists, but it is selected only when **both**
  `STRIPE_SECRET_KEY` is present **and** `SPONSORLINE_LIVE_PAYOUTS === "true"`; absent either,
  the dry-run gateway (which moves no real money) is used. The live gateway reads keys from the
  environment only — never from arguments or disk — and every test exercises it through an
  injected mock transport, so the suite makes zero live API calls. Advertiser billing is
  likewise not yet wired.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers rather than opening a
public issue. Include a reproduction and the affected commit SHA. We aim to acknowledge within
a few business days. Do not exfiltrate or modify data beyond what is needed to demonstrate the
issue.
