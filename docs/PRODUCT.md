# PRODUCT.md — Sponsorline

**register: brand**

## What it is

Sponsorline is the only AI-dev ad network that never sees your code. It places a
single, consent-gated sponsored line in the status bar of AI coding tools (Claude
Code `statusLine`, a Cursor adapter) and shares revenue 50/50 with the developer.
Raw developer context never leaves the device. The auction sees only a coarse,
versioned, allowlisted interest vector (`lang:*`, `framework:*`, `task:*`). A
stranger can verify both claims from a clean clone in one command:
`npx sponsorline verify`.

## Who it is for

The landing page speaks to two readers at once, in priority order:

1. **The enterprise security reviewer** who must approve a developer tool before
   the team installs it. They are skeptical by default, have been burned by
   telemetry-laden dev tools, and trust code they can run over claims they are
   told. They are reading at a desk, in daylight, deciding whether to sign off.
2. **The individual developer** who would happily earn from a tasteful sponsor
   line, but only if they are certain it cannot exfiltrate their work.

Both share one trait: they do not want to be told the product is private. They
want to be *shown*, in a way they can re-run themselves.

## Product purpose

Turn "trust us" into "run it." Every privacy promise is a tested, enforced
invariant in the open codebase, not a policy page. The product's whole reason to
exist is that the proof is mechanical: clone, build, verify.

## Brand & tone

- Technically precise, confident, calm. The voice of an auditor's report, not a
  growth-hack landing page. No hype, no exclamation marks, no "revolutionary."
- Honest about scope. We state what `verify` proves AND what it does not
  (unique-human identity is deferred to payout-time KYC; live money movement is
  off behind multiple controls). Stating the boundary is the credibility.
- We say "we" as Sponsorline, "you" to the developer/reviewer.
- No em dashes anywhere. No `--`. Use commas, colons, periods, parentheses.

## Strategic principles (load-bearing, never violate)

- Raw developer context NEVER leaves the device.
- No binary patching. Official, documented extension points only.
- The moat is "never integrates an ad-network identity graph," and it is enforced
  in CI by a static egress guard, not merely promised.
- Honest reach floor: a campaign too thin to be anonymous or meaningful is
  withheld, never sold as reach (200-device k-anon supply floor).

## Anti-references (what this must NOT look or sound like)

- The category-reflex AI dev-tool landing page: dark OLED background, navy +
  neon-green accent, monospace-everything, a hero metric in a gradient. That is
  training-data slop and the exact opposite of the trust we are selling.
- A crypto/web3 aesthetic. This is cryptography in the boring, auditable,
  enterprise sense, not the speculative one.
- Vague privacy marketing ("your data is safe with us"). We never ask to be
  believed; we hand over the command.

## The one thing to get right

A reviewer should reach the verify command within the first screen, understand
that they (a stranger) can run it and forge nothing, and feel the page itself
behaves like the product: precise, inspectable, quietly confident.
