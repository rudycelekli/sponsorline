# Launch post

> Channel: LinkedIn / X / HN. Voice: technically precise, confident, plain. No em-dashes.
> One idea per paragraph. Lead with the controlled-run capture, not a manifesto.

---

## Primary post (long form)

I toggled on an ad network inside my coding tool and then proved it never saw my code.

That little "Thinking..." line your AI coding assistant shows while it works is dead space. A few tools have started selling it. The pitch is good for developers: your status bar earns while you work, and you keep half the revenue. The problem is how some of them ship. Patching another tool's binary and pushing unsigned auto-updates is not a footnote. It is the kind of thing that gets a tool banned from every enterprise laptop in the building.

So we built the version a security team can actually approve.

Sponsorline is a consent-first sponsor line for AI coding tools. You toggle it on. Your status bar earns. It never reads your code, it shows nothing until you say yes, and anyone can verify both claims from a clean clone in one command.

Three things make it different:

It never sees your code. The only thing that leaves your device is a coarse, allowlisted interest vector like "lang:typescript" or "framework:react". No source, no file paths, no buffers. The verify command re-checks zero bytes of code in egress against every impression on record.

It integrates the right way. No binary patching. No unsigned updater. It plugs into the official extension points your tools already expose. There is no patching code in the repository because that capability does not exist by design.

It is stranger-verifiable. Every auction is replayable and every impression is bound to a signed consent record. A complete stranger can run "npx sponsorline verify" against the published public key and confirm the whole history is consistent, without ever being able to forge a thing. The signing secret stays on your device.

For advertisers, the reach report is not an estimate. It is built from per-device signed receipts. "Your brand reached N devices for M minutes" is counted from cryptographic proof, deduplicated per device, and screened for physically impossible volume before anyone is billed.

We are honest about the edge. Screening raises the cost of bot farming. It does not by itself prove a unique human. That final gate belongs at payout-time identity verification, and we say so plainly in the threat model rather than hiding it.

Developers earn 50 percent. Enterprises get an ad surface their security team can sign off on. Everyone can check the math.

If you build with an AI coding tool, you can try it today:

  npx sponsorline init
  npx sponsorline why
  npx sponsorline verify

The verify command is the whole pitch. Run it. Then decide.

---

## Short variant (X / HN title + first comment)

**Title:** Sponsorline: an AI-dev ad network that never sees your code (and you can prove it)

**First comment:**
The sponsor line in your AI coding tool can earn you money. The catch with existing tools is delivery: some patch binaries and ship unsigned auto-updates, which is a non-starter in any enterprise. We built the code-blind, no-patching version. Only allowlisted interest signals ever leave the device, every auction is replayable, and "npx sponsorline verify" lets a stranger confirm zero code egress against the published public key without being able to forge anything. Reach reporting for advertisers is counted from per-device signed receipts, deduplicated and screened for impossible volume before billing. We are also upfront that screening is not proof of a unique human; that gate is payout-time KYC, documented in the threat model. Developers keep 50 percent. Feedback welcome.
