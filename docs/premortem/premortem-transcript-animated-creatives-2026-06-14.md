# Premortem Transcript — Sponsorline Animated Creative Format

**Date:** 2026-06-14
**Frame:** It is December 2026. The animated sponsor-line creative format has failed.

## Context

- **What it is:** The animated sponsor-line creative format. A `sl:1` tagged JSON spec embedded inside the sealed creative string. Two kinds: `effect` (short text + micro-effect: none|pulse|shimmer|typewriter, rendered in the single-row Claude Code status line, Phase 1) and `frames` (pre-rendered ASCII grid played at fps, shown only by the opt-in `sponsorline watch` full-screen player, Phase 2). A pure local decoder turns (spec, wall-clock now) into truecolor ANSI at display time only. Honors `NO_COLOR` and `SPONSORLINE_REDUCED_MOTION`; caps to terminal width.
- **Who it's for / affects:** Supply = developers using Claude Code who opted in (the status line is their always-on primary workspace). Demand = advertisers submitting creatives. Trust of privacy-skeptical developers is the moat.
- **What success looks like:** Animation lifts attention/recall for sponsors (higher bids) without annoying developers, breaking terminals, compromising the zero-egress promise, or opening a new abuse surface; opt-in retention stays high.

## Raw premortem — failure reasons

1. Terminal incompatibility / corruption: truecolor ANSI + clock-driven frame selection produces flicker, smeared escape codes, or frozen-wrong frames across diverse hosts; developers see garbage and disable.
2. Host doesn't redraw on a timer: animation depends on the host re-invoking the status line with a fresh clock; Claude Code redraws on events, not a cadence, so "animation" is static or jerky.
3. Motion is perceived as annoying/distracting in a deep-focus workspace; developers who tolerated a static line churn because of the movement.
4. "Premium animated inventory" is a billing fiction: validation labels it premium but the auction/billing charge identically and no lift is measured.
5. `sponsorline watch` is a feature nobody uses, so the `frames` kind (the complex, security-sensitive half of the schema) has no real surface.
6. Advertiser abuse via motion: within the allowlist, fast pulse/high chroma or near-30fps frame flips create a photosensitive-epilepsy hazard (WCAG 2.3.1) and brand/legal liability.
7. Trust erosion through perception: a moving, color-shifting (visibly busy-redrawing) line reads as "active / tracking me" to skeptics even though the decoder is provably pure.
8. Schema/maintenance complexity outran its payoff: a large security-sensitive surface built for unproven lift; an audit burden that scares enterprise reviewers and slows the roadmap.

---

## Agent deep-dives

### 1. Terminal incompatibility and corruption

**Failure story:** The first cracks showed three weeks after `effect` shipped. The decoder gates ANSI on a single check — `color: !process.env.NO_COLOR` — then emits truecolor `ESC[38;2;r;g;b` unconditionally, never probing `TERM`, `COLORTERM`, or `isTTY` on the statusline path. On hosts that don't set `NO_COLOR` but can't render 24-bit color (older tmux without `Tc`, basic SSH `TERM=xterm`, Git Bash, JetBrains terminals), the raw `[38;2;216;216;216m` leaked as literal text. Shimmer was worst: it emits a fresh escape per character, so one line became dozens of visible escape fragments. Second wave: flicker and frozen-wrong frames, because frame selection is pure on `input.now` but the host owns the redraw clock — pulse/typewriter sampled at irregular instants, froze mid-reveal, strobed under tmux batching; `watch`'s `CLEAR_HOME` + per-frame redraws over SSH tore. Kill shot: non-interactive capture — the statusline always emits ANSI regardless of sink, so CI/log-pipe users accumulated megabytes of escape codes. A shared "Sponsorline broke my terminal" screenshot spiked opt-out before the zero-egress story was heard.

**Underlying assumption:** That honoring `NO_COLOR` is equivalent to detecting terminal capability.

**Early warning signs:** (a) Opt-out rate correlated with terminal type — if opt-out among non-truecolor/non-TTY environments runs >2x the truecolor-TTY baseline in 30 days, the decoder is leaking escapes. (b) Redraw-cadence mismatch — if p50 host redraw interval exceeds the creative's frame period (e.g. >150ms against 12fps/83ms), animations are undersampled.

### 2. Host doesn't redraw often enough to animate

**Failure story:** The math was correct: feed `decodeEffect` a fresh `now` and pulse/shimmer/typewriter advance smoothly. The demo — run through `sponsorline watch` with its own 12fps loop — looked gorgeous, and advertisers paid the animated premium. Nobody noticed the deck's motion came from the one surface with its own timer, not the status line they were buying. In production the status line has no loop; it renders once per host invocation keyed off whatever `now` Claude Code passes. The host redraws on events (message, tool call, model turn), not a cadence. An engineer reading a long generation saw the same frame frozen 20-40s, then a jump. The 15-minute rotation cap meant idle sessions re-emitted the cached creative with stale phase math, so shimmer teleported rather than flowed. By December, recall lift never materialized; advertisers diffed rendered bytes across redraws and found 60-80% of impressions byte-identical to the prior frame. The premium tier got reclassified as static; refunds issued; trust cost bled into the base format.

**Underlying assumption:** That an event-driven host redraws often and regularly enough to look like animation — when frame advancement is hostage to a cadence Sponsorline neither controls nor measures.

**Early warning signs:** (a) Inter-redraw interval — median gap between `runStatusline` calls; >~200ms (5fps) reads as stutter, tens of seconds means static. (b) Frame-identity rate — % of consecutive emissions whose decoded bytes are identical; >~30% means advertisers pay for inventory that isn't moving.

### 3. Motion perceived as annoying / distracting

**Failure story:** `shimmer` shipped as the showcase — a white highlight sweeping on a 1200ms loop. It tested beautifully in demos. Missed: motion is keyed to `input.now` and runs on every host repaint, decoupled from the 15-minute billing rotation, and Claude Code repaints on nearly every keystroke/tool event. The sweep never stopped — it pulsed in peripheral vision through every debugging session. The static-line cohort had bargained for a quiet, dead line in exchange for getting paid; motion broke that bargain unilaterally. By October the churn pattern was clear: developers hunted for `SPONSORLINE_REDUCED_MOTION` and posted "make the ad stop moving," but it was opt-in and under-documented, so most just uninstalled. `pulse` read as a notification, training glances down for nothing. Supply eroded fastest among the most engaged power users — exactly the high-value inventory sponsors paid for.

**Underlying assumption:** That developers who tolerated a static line had consented to attention capture, when they had consented precisely to its absence of motion.

**Early warning signs:** (a) `SPONSORLINE_REDUCED_MOTION` adoption climbing among retained users (annoyed but not yet gone). (b) Uninstall/`sponsorline off` rate for the animated cohort exceeding the static-cohort baseline within 7 days of exposure.

### 4. "Premium animated inventory" is a billing fiction

**Failure story:** The split opened in the code: `validateAnimated` gated effects/frames/fps/grid behind comments calling animation a "premium inventory class," but `campaignToBidder` flattened every campaign into one `bidCents` field feeding the same deterministic Vickrey auction. Two creatives, one price path; the device still billed one impression per 15-minute rotation, indifferent to kind. "Premium" lived only in a validation message. In Q3 the first advertisers paid up because the portal framed animation as premium. By October they asked for the lift report — there was none; billing seals the creative as an opaque string and the ledger can prove an impression fired but never that animation outperformed text. Buyers reverted to plain-text bids, which cleared the identical auction at the identical price. For advertisers who never paid extra, the elaborate allowlist/caps earned zero incremental revenue while adding maintenance and review cost. The economic case collapsed in both directions.

**Underlying assumption:** That labeling a creative "premium" would translate into willingness-to-pay, without any billing tier or lift measurement to make it real or provable.

**Early warning signs:** (a) Effective CPM for animated vs plain within the same cohort stays within noise (<5% delta). (b) Advertiser renewal/repeat-bid rate on animated campaigns falls below plain-text campaigns.

### 5. `sponsorline watch` is a feature nobody uses

**Failure story:** `watch` shipped clean — a pure local viewer, no auction/witness/network, exactly as specced. The launch demo was gorgeous. Then nothing. September metrics: `watch` invocations were 0.3% of opted-in installs, 80% single-run — curiosity, "neat," never again. Developers use Claude Code to write code, not watch ads; there was never a moment a developer's job benefited from watching a pre-rendered grid loop. Meanwhile the `frames` half — cols/rows/fps caps, the 240-frame limit, per-frame control-char sanitization, per-row width enforcement — was the most security-sensitive code in the project, because frames are the only path emitting multi-row terminal output with newlines preserved (`sanitize(frame, true)`). Every audit re-litigated terminal-injection risk on a feature with no audience. No advertiser shipped a real `frames` creative either, because they knew no one was watching: the validation guarded an empty highway.

**Underlying assumption:** That building a surface for `frames` would create demand for `frames`, when the developer had no reason to look at it.

**Early warning signs:** (a) `watch` invocations per opted-in install per week under ~1, repeat-run rate under 10%. (b) Zero `frames`-kind creatives submitted by advertisers post-launch — `effect` is 100% of served inventory.

### 6. Advertiser abuse via motion (accessibility / brand-safety)

**Failure story:** The validator did exactly what it was told: `fps <= 30`, `frames <= 240`, `loopMs > 0`, grid `<= 200`. An advertiser shipped a perfectly valid `frames` creative — two frames, `fps: 30`, alternating pure `[0,0,0]` and `[255,255,255]`. `decodeFrames` flipped between them: a 15 Hz full-field black/white strobe, 5x the WCAG 2.3.1 ceiling of 3 flashes/sec. Nothing flagged it because no rule ties frame deltas to flash frequency. `pulse` was abused too: `loopMs` can go to 1ms, and base `[255,0,0]` becomes a high-frequency red flash. `SPONSORLINE_REDUCED_MOTION` was off by default and unset. The creatives passed review, sealed into inventory, rendered live. Invisible to us for weeks — the animation is a pure local transform, so we had zero server-side telemetry on displayed motion. Then a photosensitive developer running `watch` had a seizure; a colleague filmed it, posted "Sponsorline gave my coworker a seizure," front page in 48 hours, demand letter alongside. Root cause: treating "within the allowlist" as "safe." Caps bounded resource use, not photosensitivity.

**Underlying assumption:** That enforcing structural caps (fps, frame count, loopMs) is equivalent to enforcing perceptual safety — when flash hazard is a function of luminance-delta and frequency, neither measured.

**Early warning signs:** (a) Flash frequency in served creatives — statically analyze each frames/pulse creative for luminance transitions/sec >3 (or pulse effective period <333ms); count should be exactly 0. (b) Share of approved creatives with frame-to-frame relative-luminance delta >10% AND effective flash period <333ms — nonzero and rising is the strobe-attack signature.

### 7. Trust erosion through perception

**Failure story:** Animation shipped on-by-default. The decoder is wall-clock driven, so to make pulse/shimmer move, the status line redraws on a timer — ~every 80ms for shimmer. The first skeptic who ran `strace`/`dtruss` saw the sponsorline process waking dozens of times a second, repainting. The decode was pure and local — no syscall left the box — but "constantly active, constantly redrawing" looks identical to a beacon to someone primed to distrust. A "Sponsorline's 'calm' ad line repaints 12x/sec — why?" thread got the busy-loop screenshot; top comment: "If it's just displaying text the advertiser already shipped, why is it running a render loop at all?" Nobody read the honest comment block. The undocumented, default-off opt-out made it worse: the calm-trust cohort — the entire moat — experienced the loud version first and had to hunt to stop it, reversing the original opt-in psychology. The source-available proof became a liability: skeptics who read the code found a render loop and a color generator, confirmed "active," and posted "told you so." Churn concentrated among the privacy-skeptical supply the network couldn't replace.

**Underlying assumption:** That trust comes from the code being provably pure, when it actually comes from the tool behaving inert — and a wall-clock-driven redraw loop visibly is not inert.

**Early warning signs:** (a) Rising `SPONSORLINE_REDUCED_MOTION=1` adoption plus a spike in uninstalls within 48h of first animated render. (b) Any external observation (HN/issue/Slack) of redraw frequency/CPU wakeups framed as suspicion ("why is it running constantly?").

### 8. Complexity outran payoff

**Failure story:** Everything shipped clean and well-tested — the decoder, four effects, the hybrid union, the validator (allowlist, 240-frame cap, fps≤30, control-char rejection on inner text and every frame row), the `watch` player, ~885 lines of source-plus-test for animation alone, with an honest purity proof. None of it was wrong. It was never needed: lift over a static line was never proven before or after building it, because the format predated any traffic to A/B against. The break came at the first enterprise security review in Q3: a reviewer who'd have rubber-stamped a plain string instead opened `creative.ts`, saw raw `\x1b[38;2` truecolor generation and a `frames` kind that emits multi-row grids with newlines deliberately kept, and escalated. Every sign-off now had to reason about terminal-escape injection, the two-kind union, and `watch`. The dual control-char regexes (one strips newlines, one preserves them) became the fixation — proving the boundary held took three meetings plain text would have skipped. By December the format was a tax: every audit reopened the ANSI/decoder surface, the frames/watch half had near-zero adoption, and the roadmap slipped re-defending an unquantifiable feature.

**Underlying assumption:** That animation would deliver enough engagement lift to justify a permanent expansion of the security-audit surface — believed strongly enough to build on but never measured.

**Early warning signs:** (a) Adoption skew — frames-kind creatives near 0% while effect-kind is ~100%, so half the audited surface carries no traffic. (b) Audit drag — enterprise reviews citing `creative.ts`/ANSI/decoder average 2+ extra cycles vs plain-text inventory, sign-off time trending up.

---

## Synthesis — Premortem Report

### The Most Likely Failure
**The animation doesn't actually animate (and renders as garbage on a meaningful slice of terminals).** Two architectural facts make this near-certain: (1) frame advancement is hostage to a redraw cadence the host owns and Sponsorline never measures, and (2) `color` is gated on `!NO_COLOR` alone, with truecolor emitted unconditionally and no `COLORTERM`/`TERM`/`isTTY` probe. On most real machines the status-line "animation" is a frozen or jittering single frame; on non-truecolor or non-TTY hosts it leaks raw escape codes. This is the first thing to fix because it is both the most probable and it silently nullifies the entire premise (motion you paid a premium for that does not move).

### The Most Dangerous Failure
**A photosensitive-epilepsy strobe served through valid, allowlisted inventory.** Low probability, catastrophic impact. The validator caps fps, frame count, and loopMs — none of which bound flash frequency or luminance delta. A two-frame 30fps black/white `frames` creative, or a 1ms-loop high-chroma `pulse`, is a WCAG 2.3.1 violation that passes validation today. Because rendering is a pure local transform, we would have zero server-side telemetry that it ever happened until someone is harmed. For a network whose entire brand is trust and safety, one viral incident plus a demand letter is existential. Worth insuring against even if it never fires.

### The Hidden Assumption
**That Sponsorline controls the rendering environment.** It controls none of the three things this format depends on: the *host* owns redraw cadence (so motion may not happen, or may busy-loop visibly), the *terminal* owns color/escape capability (so output may corrupt), and the *developer* owns perception (so the same motion reads as either annoyance or surveillance). Every one of the 8 failure modes traces back to assuming control over an environment that belongs to someone else.

### The Revised Plan
1. **Ship motion OFF by default in the status line.** Static is the contract opted-in developers actually agreed to. Make motion explicit opt-in via a documented flag surfaced in `init` output. This single change defuses the annoyance churn (#3), the "busy-loop = tracking" perception (#7), and removes the default redraw loop entirely. (maps to #3, #7)
2. **Detect terminal capability before emitting ANSI.** Gate on a real probe — `COLORTERM=truecolor` for 24-bit, downgrade to 256-color, then to none; respect `isTTY` so non-interactive sinks never get escapes. Never emit truecolor unconditionally. (maps to #1)
3. **Stop selling/charging "premium" until lift is measured.** Remove the "premium inventory class" framing from `campaign.ts`; animated and plain clear the same auction. Keep the size/effect caps — they are justified as safety regardless of pricing. Introduce a tier only after a controlled A/B shows real lift. (maps to #4, #8)
4. **Add WCAG 2.3.1 flash-safety validation.** Reject `pulse` with effective period <333ms (a `loopMs` floor), and reject `frames` whose consecutive relative-luminance delta exceeds ~10% more than 3 times/sec. Cap chroma/contrast swing. Add tests that the 30fps black/white strobe and the 1ms-loop red pulse are REJECTED. (maps to #6)
5. **Feature-flag or shelve `frames`/`watch` until an advertiser actually wants frames.** Do not carry the most security-sensitive, newline-preserving half of the schema in the audited default surface for zero traffic. Keep `effect` as the live format; gate `frames` behind a flag that is off by default. (maps to #5, #8)

### The Pre-Launch Checklist
- [ ] **Terminal capability matrix test** across tmux (no `Tc`), `xterm`, Git Bash, VS Code integrated, JetBrains, SSH, and a CI log-pipe: confirm zero raw-escape leakage and zero corrupted renders. (#1)
- [ ] **Instrument inter-redraw interval and frame-identity rate** in a canary before charging anything for animation: only call motion "real" if frame-identity is <30% and median redraw interval beats the frame period. (#2, #4)
- [ ] **Flash-safety validator with red-team tests**: the black/white 30fps strobe and the 1ms-loopMs high-chroma pulse must fail validation; add these as committed test cases. (#6)
- [ ] **Default-off motion + documented opt-in**: verify `init` output explains the motion flag and `SPONSORLINE_REDUCED_MOTION`, and that a fresh install shows a static line. (#3, #7)
- [ ] **Explicit keep/shelve decision on `frames`/`watch`**: if kept, it ships behind an off-by-default flag and is excluded from the default audit surface until there is advertiser demand and proven `effect`-lift. (#5, #8)
