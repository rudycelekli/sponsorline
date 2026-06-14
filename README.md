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
npx sponsorline earnings    # what have I accrued?
npx sponsorline verify      # stranger-verifiable: replay every auction, assert privacy
npx sponsorline off         # immediate revoke
```

## Verified claim

> Sponsorline showed 1000 relevant sponsor lines across 3 project types with 0 bytes of code or path in egress, 100% reproducible auctions, 100% of invalid-consent cases correctly gated to the plain line, exact ledger reconciliation (error 0), and stranger verification in 11ms p95.

See `bench/results/report.md` for the full table, baselines, and provenance.

## How the privacy guarantee works

Raw developer context never leaves your device. The only thing the auction sees is a coarse, versioned, allowlisted interest vector (`lang:*`, `framework:*`, `task:*`). The benchmark asserts **0 bytes** of code or path in egress, and `sponsorline verify` re-checks it against every recorded impression.

## How verification stays fast as you earn

The witness log is a hash chain: each impression embeds the previous payload's hash. A single Ed25519 signature over the head payload therefore vouches for the entire ordered history, so `verify` costs O(n) cheap hashing plus **one** signature check instead of one check per impression. Verification stays well under the 2-second target even at multi-year volume (≈58ms at 8,760 impressions, ≈158ms at 26,280). Any insert, delete, reorder, or edit of an entry breaks a chain link.

## Architecture

`@sponsorline/core` (pure substrate) → `sponsorline` CLI (the official statusLine command + init/why/earnings/verify/off) → `@sponsorline/mcp` (advertiser/enterprise seam). Local JSONL witness log; Ed25519 seals; deterministic second-price auction. See `docs/adr/ADR-0001-sponsorline-v0.1.md`.
