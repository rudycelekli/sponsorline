# Sponsorline v0.2-C1 — Precise On-Device Targeting Predicates

**Status:** Design · **Date:** 2026-06-14 · **Builds on:** v0.1, v0.2-A, v0.2-B

## Goal

Let enterprises express *precise* audiences ("show to `lang:rust` AND `task:test`,
but NOT `framework:react`") while keeping every privacy invariant: the predicate
ships **to** the device, is evaluated **on** the device against the local interest
vector, and references **only allowlisted atoms**. No raw context leaves; no new
egress. This is the honest revenue lever — better precision means advertisers pay
for relevance and developers see ads that actually fit.

## Why now / what it is not

Today eligibility is `targetSignals.some((s) => vector.has(s))` — a flat OR. An
advertiser can say "anyone touching Rust" but not "Rust testers who aren't on React."
That bluntness both wastes advertiser spend and shows developers less relevant lines.

This is **not** the anonymized-intel piece (v0.2-C2). C2 sends aggregate stats
*outward* and is the one place that touches egress; it gets its own design with
k-anonymity / differential privacy. C1 adds zero egress and is fully buildable today.

## The predicate language

A minimal, closed boolean tree over allowlisted signal atoms:

```ts
export type TargetPredicate =
  | { atom: string }              // matches if the atom is in the device vector
  | { all: TargetPredicate[] }    // AND  (empty = vacuously true)
  | { any: TargetPredicate[] }    // OR   (empty = vacuously false)
  | { not: TargetPredicate };     // NOT
```

Only these four node shapes exist. There is no field access, no regex, no
user-supplied code — it cannot express anything beyond boolean logic over the fixed
taxonomy, so it cannot exfiltrate or probe raw context by construction.

### Evaluation

`evalPredicate(p, vectorSet)` walks the tree against a `Set<string>` of the device's
signals. Deterministic, side-effect-free, pure. `all([])` is `true`, `any([])` is
`false` (standard identities).

### Validation (the privacy + safety gate)

`validatePredicate(p)` returns `{ ok, errors }` and is the trust boundary for
advertiser-submitted campaigns. It rejects:

- any `atom` that is **not** `isAllowlisted` (the privacy-taxonomy guard — a campaign
  can never target outside `lang:`/`framework:`/`task:`),
- unknown node shapes / malformed JSON (defense against a hostile submission),
- trees exceeding **maxDepth = 16** or **maxNodes = 64** (bounded eval — a malicious
  campaign cannot ship a pathological tree that burns CPU on every status-line tick).

Validation runs at MCP intake (reject bad campaigns up front) and is cheap enough to
re-assert at eval time.

## Backward compatibility

`Bidder` gains an optional `target?: TargetPredicate`. Eligibility:

- if `target` is present → `evalPredicate(target, vectorSet)`;
- else → existing `targetSignals` ANY-intersection (unchanged).

Every v0.1/v0.2 campaign keeps working untouched; the predicate is purely additive.

## Determinism / witness / verify

Predicate evaluation only decides *eligibility* (who enters the pool). The auction's
canonical outcome hash already encodes `signals + seed + winnerId + clearingCents`,
so `verify` replays exactly as before — no witness format change, no migration. The
deterministic-auction and stranger-verifiability invariants are untouched.

## Files

- `packages/core/src/targeting.ts` — `TargetPredicate`, `evalPredicate`,
  `validatePredicate` (pure; no I/O). Exported from `index.ts`.
- `packages/core/src/auction.ts` — `eligible()` uses the predicate when present.
- `packages/mcp/src/server.ts` — `advertiser_submit_inventory` validates `target`
  (when present) via `validatePredicate`, rejecting with a clear reason.

## Testing

- `targeting.test.ts` — atom hit/miss; AND/OR/NOT truth tables; empty-all/empty-any
  identities; nested composition; allowlist rejection; depth/node-cap rejection;
  malformed-node rejection.
- `auction.test.ts` — predicate eligibility selects/excludes correctly; absence of
  `target` preserves legacy ANY-intersection behavior.
- `server.test.ts` — intake accepts a valid predicate campaign and rejects one that
  references a non-allowlisted atom and one that exceeds the node cap.

## Out of scope

Anonymized aggregate intel / outward telemetry (v0.2-C2, separate design with DP);
campaign budgets/pacing/frequency capping; advertiser auth/billing (v0.3-D).
