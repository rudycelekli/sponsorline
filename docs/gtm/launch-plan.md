# Sponsorline launch plan

The single, ordered, do-this-then-that plan for shipping Sponsorline in public.
Everything technical is built and green. What remains is authenticated steps on
shared systems (npm, GitHub, hosting) plus the launch comms. Voice rule for all
copy below: plain, precise, confident. No em dashes.

Cross references:
- Release mechanics and smoke tests: `docs/RELEASE.md`
- Public/private code split: `docs/LICENSING.md`
- Demand-side red lines: `docs/premortem/` and the conclusions summarized here
- Long-form and short post copy: `docs/gtm/launch-post.md`
- Advertiser one-pager: `docs/gtm/advertiser-one-pager.md`

---

## Readiness snapshot (2026-06-15)

| Area | State |
|------|-------|
| Tests | 228 passing (`npx vitest run`) |
| Version | core and CLI at `0.3.0` (256-color creatives) |
| Client repo | `github.com/rudycelekli/sponsorline`, public, PolyForm Shield |
| Backend repo | `github.com/rudycelekli/sponsorline-backend`, private, proprietary |
| npm | needs `0.3.0` publish with a fresh token (old token being revoked) |
| Landing page | `site/index.html` ready; `site/vercel.json` carries CSP and HSTS |
| Marketer preview | `site/preview.html`, client-side, zero upload, linked from nav |

The verify command is the whole pitch. A stranger clones, builds, runs
`npx sponsorline verify`, and confirms zero code egress against the published
public key. Protect that property at every step below.

---

## Step 0: Security hygiene (do first, takes 2 minutes)

1. Revoke the npm token that was exposed in a prior session (prefix
   `npm_VHb7…`, full value kept out of git on purpose; it also lives in the
   local scratch file `~/Downloads/claudeAds/Untitled`). Go to npmjs.com,
   Account, Access Tokens, delete it, then confirm with `npm token list`.
   Create a fresh automation token. Delete the `Untitled` scratch file.
2. Confirm no secrets are in the public tree:
   ```bash
   git -C /Users/rudycelekli/Downloads/claudeAds/projects/sponsorline log --oneline -5
   git grep -nI "npm_" -- . ':!docs/gtm/launch-plan.md' || echo "no token strings in tree"
   ```

---

## Step 1: Confirm the public/private split is clean

The proprietary backend must never appear in public history. This was already
extracted (see `docs/LICENSING.md`), so this step is verification, not surgery.

```bash
cd /Users/rudycelekli/Downloads/claudeAds/projects/sponsorline
ls packages            # expect: core, cli, cursor  (NOT mcp)
git ls-files | grep -i "packages/mcp" || echo "no mcp files tracked in public repo"
npm run build          # all public packages build
npx vitest run         # 228 pass
```

If any `packages/mcp` file is tracked here, stop and move it to the backend repo
before continuing.

---

## Step 2: Publish the client to npm at 0.3.0

`npx sponsorline init` is dead until this resolves. Publish core first (the CLI
depends on `@effinai/sponsorline-core@0.3.0` from the registry), then the CLI.

```bash
cd /Users/rudycelekli/Downloads/claudeAds/projects/sponsorline

# Auth with the FRESH token from Step 0. The colon in the var name breaks a plain
# zsh export, so pass it inline to the publish command:
env 'npm_config_//registry.npmjs.org/:_authToken=YOUR_FRESH_TOKEN' \
  npm publish -w @effinai/sponsorline-core

env 'npm_config_//registry.npmjs.org/:_authToken=YOUR_FRESH_TOKEN' \
  npm publish -w sponsorline
```

Both packages rebuild via `prepublishOnly` and ship `dist` plus `LICENSE` only.
Verify the funnel from an empty dir on a clean path:

```bash
cd "$(mktemp -d)"
npx sponsorline@latest verify --help    # resolves and runs the published client
```

The Cursor adapter ships to the VS Code Marketplace via `vsce`/`ovsx`, not npm.
It is not on the `npx sponsorline` critical path, so it does not block launch.

---

## Step 3: Deploy the landing page and the preview

```bash
cd /Users/rudycelekli/Downloads/claudeAds/projects/sponsorline/site
vercel deploy --prod
```

`site/` is static: `index.html`, `preview.html`, and `vercel.json`. The preview
page is pure client-side, so no server work is needed. Point `sponsorline.dev`
at the deployment.

Post-deploy checks:
- [ ] `https://sponsorline.dev` loads over HTTPS with the CSP and HSTS headers.
- [ ] The `LICENSE` link in the footer resolves.
- [ ] `https://sponsorline.dev/preview.html` loads, accepts an mp4 drop, and
      renders colored frames. Confirm the page shows "0 bytes uploaded" and
      "ANSI escapes in sealed bytes: 0".
- [ ] Open DevTools Network while using the preview: no request fires when a clip
      is dropped. This is the proof for the zero-egress claim on the marketer side.

---

## Step 4: Final smoke test from a stranger's seat

Do this on a clean machine or fresh clone. If any line fails, do not announce.

```bash
cd "$(mktemp -d)"
git clone https://github.com/rudycelekli/sponsorline.git
cd sponsorline
npm install
npm run build
npx vitest run                 # expect 228 green
npx sponsorline@latest verify  # the headline command
```

---

## Step 5: Announce

Order: ship the post, then watch the first hour of replies and be present to
answer. Lead with the controlled-run capture (you toggled it on and proved it
never saw your code), not a manifesto.

1. Post the LinkedIn copy below.
2. Cross-post the X / HN short variant from `docs/gtm/launch-post.md`.
3. Pin a comment with the three commands: `init`, `why`, `verify`.
4. For marketers specifically, share the preview link: drop an mp4 and watch the
   exact thing a developer would see, translated in the browser with nothing
   uploaded.

### LinkedIn launch post (ready to paste)

> I turned on an ad network inside my coding tool, then proved it never saw my code.

> That faint "Thinking..." line your AI coding assistant shows while it works is dead space. A few tools have started selling it, and the pitch is genuinely good for developers: your status bar earns while you work, and you keep half. The problem is how some of them ship it. Patching another tool's binary and pushing unsigned auto-updates is not a footnote. It is the kind of thing that gets a tool banned from every enterprise laptop in the building.

> So we built the version a security team can actually approve.

> Sponsorline is a consent-first sponsor line for AI coding tools. You toggle it on. Your status bar earns. It never reads your code, it shows nothing until you say yes, and anyone can verify both claims from a clean clone in one command.

> Three things make it different.

> It never sees your code. The only thing that leaves your device is a coarse, allowlisted interest vector like "lang:typescript". No source, no file paths, no buffers.

> It integrates the right way. No binary patching, no unsigned updater. It plugs into the official extension points your tools already expose. The patching capability is not disabled, it does not exist in the repository by design.

> It is stranger-verifiable. Every auction is replayable and every impression is bound to a signed consent record. Run "npx sponsorline verify" against the published public key and confirm the whole history is consistent, without being able to forge a thing. The signing secret never leaves your device.

> One more piece I am proud of, for the marketers. You think in video, but the terminal renders text. So we built a preview that translates your mp4 into the exact sealed creative a developer would see, entirely in your browser. Nothing is uploaded. Same zero-egress principle, applied to your side too. Drop a clip and watch.

> Developers earn 50 percent. Enterprises get an ad surface their security team can sign off on. Everyone can check the math.

> If you build with an AI coding tool, try it today:
> npx sponsorline init
> npx sponsorline why
> npx sponsorline verify

> The verify command is the whole pitch. Run it, then decide. Link to the code and the marketer preview in the comments.

(First comment: the public repo link and the `sponsorline.dev/preview.html` link.)

---

## Hard guardrails (from the go-to-market premortem, 2026-06-14)

Carry these into every post-launch decision. They are red lines, not preferences.

1. **Ship the dev-side network on its own.** Do not launch a marketer self-serve
   portal, billing, or held balances at the same time. Scope explosion was the
   single most likely way this launch sinks. The preview page is a top-of-funnel
   demo, not a portal, and that distinction is deliberate.

2. **Supply before demand.** Do not build the marketer portal until real reach
   reports can emit on real devices, which needs roughly 200 opted-in active
   devices per targetable segment (the differential-privacy k-anon floor). Run
   early demand as a manual concierge through the existing backend tools, not
   self-serve.

3. **No Google or Meta ad-provider integration.** Routing their spend via OAuth
   and importing their audiences or attribution structurally requires their
   identity graph, which would widen the allowlist and open PII-adjacent egress.
   That detonates the zero-egress moat and breaks their terms of service. If
   demand asks for it, offer only the safe version: manual creative and budget
   import by paste or CSV, with no OAuth, no audience import, and no attribution
   callback. Pitch "we never touch your Google data" as a feature.

4. **Do not hold advertiser balances.** Holding balances and fanning out to many
   devices is the legal shape of a money transmitter, and Stripe will freeze it.
   Prefer Stripe destination charges or `on_behalf_of`. Wire W-9 and 1099 before
   flipping live payouts. Build charge, meter, and reconcile against signed
   receipts before any money UI.

5. **Be honest about the human-uniqueness gate.** Volume screening raises the
   cost of bot farming but does not prove a unique human. That gate belongs at
   payout-time identity verification, and the threat model says so plainly. Keep
   it plain in public too.

---

## What to do next, after a clean launch

In priority order, and only one at a time:
1. Drive opted-in device supply toward the 200-per-segment floor.
2. Run a single concierge advertiser end to end against signed receipts, no UI.
3. Only then revisit whether a thin, still-verifiable marketer surface is worth
   building. Re-run the premortem before committing to it.
