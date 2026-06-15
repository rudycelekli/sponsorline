# Sponsorline

The consent-first sponsor line for AI coding tools — **the only AI-dev ad network that never sees your code.**

You toggle it on. Your status bar earns. Every impression is bound to a signed consent record, every auction is replayable, and a stranger can verify all of it from a clean clone in one command.

## What it does (ELI10)

That little "Thinking…" line your AI coding tool shows while it works? Sponsorline turns it into a tiny, clearly-labeled sponsor message that pays you 50% — and (a) it never reads your code, (b) it shows nothing until you say yes, and (c) anyone can prove both with one command.

## Quickstart

```bash
npx sponsorline init        # consent wizard + configures Claude Code statusLine
# ... use Claude Code normally; your status bar now earns ...
npx sponsorline why         # why was THIS line shown?
npx sponsorline feedback good   # tune relevance on-device (good|bad); never leaves the machine
npx sponsorline earnings    # what have I accrued?
npx sponsorline verify      # stranger-verifiable: replay every auction, assert privacy
npx sponsorline off         # immediate revoke
```

## Verified claim

> Sponsorline showed 1000 relevant sponsor lines across 3 project types with 0 bytes of code or path in egress, 100% reproducible auctions, 100% of invalid-consent cases correctly gated to the plain line, exact ledger reconciliation (error 0), and stranger verification in 12ms p95 (reference run; the deterministic invariants are machine-independent, latency is not).

See `bench/results/report.md` for the full table, baselines, and provenance.

## How the privacy guarantee works

Raw developer context never leaves your device. The only thing the auction sees is a coarse, versioned, allowlisted interest vector (`lang:*`, `framework:*`, `task:*`). The benchmark asserts **0 bytes** of code or path in egress, and `sponsorline verify` re-checks it against every recorded impression.

## How verification stays fast as you earn

The witness log is a hash chain: each impression embeds the previous payload's hash. A single Ed25519 signature over the head payload therefore vouches for the entire ordered history, so `verify` costs O(n) cheap hashing plus **one** signature check instead of one check per impression. Verification stays well under the 2-second target even at multi-year volume (≈58ms at 8,760 impressions, ≈158ms at 26,280). Any insert, delete, reorder, or edit of an entry breaks a chain link.

## What verification does — and doesn't — prove

`sponsorline verify` runs only against the **published public key** (`pubkey`); the signing secret (`salt`) never leaves your device, so a verifier can check everything without being able to forge anything. Under that key, verify proves the log is internally consistent: every auction replays to the recorded outcome, every impression carries only allowlisted signals **within your granted consent scope and validity window**, and the hash chain is unbroken.

What it does **not** prove on its own is *whose* device produced the log. The public key travels in the same bundle as the witness, so a third party could substitute their own key and re-sign a fabricated log — it would verify against *that* key. To bind the key to you, publish your `pubkey` through a channel the verifier already trusts (your repo, your site, a signed release). Verify then proves authenticity-of-origin, not just internal consistency. This is the standard public-key trust-anchor model, stated plainly.

## Architecture

`@effinai/sponsorline-core` (pure substrate) → `sponsorline` CLI (the official statusLine command + init/why/feedback/earnings/verify/off) → `@sponsorline/mcp` (advertiser/enterprise seam). `sponsorline-cursor` is a thin Cursor/VS Code status-bar adapter that invokes the same CLI engine over the identical stdin-JSON/stdout-line contract Claude Code uses — no binary patching, shared on-device state. Local JSONL witness log; Ed25519 seals; deterministic second-price auction. See `docs/adr/ADR-0001-sponsorline-v0.1.md`.

## Licensing

The on-device client you actually audit and run, `@effinai/sponsorline-core`, the `sponsorline` CLI, and the `sponsorline-cursor` adapter, is **source-available under the [PolyForm Shield License 1.0.0](LICENSE)**. You may read, run, audit, and verify it for any purpose, including independently checking the privacy guarantees. You may not use it to ship a competing ad network.

The advertiser/marketer/billing/payout backend (`@sponsorline/mcp`) is proprietary and is being extracted into a separate private repository. A reviewer never needs it: the only code that runs on a developer's machine and touches developer context is the public client. See [`docs/LICENSING.md`](docs/LICENSING.md) for the boundary and rationale.
