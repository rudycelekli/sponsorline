# Sponsorline v0.2-A — On-Device Relevance Feedback Loop

**Status:** Approved (autonomy grant) · **Date:** 2026-06-14 · **Builds on:** ADR-0001 (v0.1)

## Goal

Close the bandit reward loop *on-device* so sponsor-line relevance actually improves
over time, using an explicit, developer-controlled feedback signal. No new egress, no
inferred surveillance, no money.

## Problem

`SolverBandit` (Thompson sampling) is already wired into auction re-ranking
(`cmd-statusline.ts`), but **nothing ever calls `bandit.update()` or `writeBandit()`**.
Priors stay uniform (alpha=1, beta=1) forever, so ranking degenerates to a deterministic
tiebreak and "developers get relevant ads" is never realized. The reward loop is the
single missing piece.

## Privacy invariant (unchanged, load-bearing)

- The reward is an **explicit** developer action, never inferred from behavior/content.
- Feedback is **local-only**: it shapes which ads win on *this device*. It is never
  witness-logged, never signed, never exported. No new data leaves the machine.
- Attribution data persisted is only the already-public advertiser id + the coarse
  allowlisted bucket (e.g. `lang:ts`) — the same signals consent already covers.

## Design

### New command: `sponsorline feedback <good|bad> [--json]`

Rewards/penalizes the **last displayed** advertiser for its bucket, then persists bandit
state. Exit codes: `0` success; `2` usage error (missing/invalid verdict); `0` with a
"nothing shown yet" message when there is no render state to attribute.

### Attribution requires richer render state

`render.json` currently stores only `{ lastImpressionAt, lastCreative }`. To attribute
feedback to the correct bandit slot we persist the winner's **advertiser id** and the
**bucket** used for ranking. `RenderState` gains `lastAdvertiserId: string` and
`lastBucket: string`. `cmd-statusline.ts` writes them when it logs a billable impression.

Back-compat: a render state written by v0.1 lacks these fields. `feedback` treats a
missing `lastAdvertiserId`/`lastBucket` as "nothing attributable yet" and exits 0 with a
message — it never throws.

### Reward mapping

- `good` → `bandit.update(bucket, advertiserId, true)`  (alpha += 1)
- `bad`  → `bandit.update(bucket, advertiserId, false)` (beta += 1)

Then `store.writeBandit(bandit.toJSON())`.

### Concurrency

Feedback mutates only `bandit.json` (advisory learning data, independent of the witness
hash chain). It does **not** take the witness lock. A torn/lost concurrent update at worst
costs one learning increment — recoverable, never an integrity violation. Keeping it
lock-free means a developer's explicit feedback always succeeds without stalling.

### Determinism / reproducibility (bench R: 100% repro)

Bandit state is already a declared *input* to ranking. Same state + same seed → same
ranking → same auction outcome. Reproducibility holds because a fresh app dir starts with
empty bandit state. Learning changes future outcomes by changing the input, not by adding
nondeterminism.

## Files

- Modify `packages/cli/src/store.ts` — extend `RenderState` with `lastAdvertiserId`, `lastBucket`.
- Modify `packages/cli/src/cmd-statusline.ts` — persist advertiser id + bucket into render state.
- Create `packages/cli/src/cmd-feedback.ts` — the new command.
- Modify `packages/cli/src/main.ts` — wire `feedback` subcommand + usage string.
- Create `packages/cli/test/cmd-feedback.test.ts` — tests.
- No `@sponsorline/core` change (bandit already exposes `update`/`toJSON`/`fromJSON`).

## Testing

1. `feedback good` after a shown impression increments the shown advertiser's alpha and persists.
2. `feedback bad` increments beta.
3. Invalid verdict → exit 2, no bandit mutation.
4. No render state → exit 0 with message, no throw, no bandit file written.
5. v0.1 render state (no advertiser id) → exit 0 with message, no throw.
6. Learning changes ranking: after repeated `good` for advertiser B (lower bid) it can
   out-rank a higher-bid A in a subsequent auction — proving the loop is live.

## Out of scope (later phases)

Implicit/dwell rewards (kept out for honesty); Codex/Cursor adapters (v0.2-B);
anonymized aggregate intel + enterprise intake (v0.2-C, privacy-sensitive); payments (v0.3).
