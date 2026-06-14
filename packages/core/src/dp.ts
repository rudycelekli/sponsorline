import { isAllowlisted } from "./interest.js";

// v0.2-C2 local differential-privacy engine. Pure: randomness is INJECTED so the
// engine is deterministic under test and crypto-random in production. The privacy
// guarantee is k-anonymity suppression (drop buckets below k) + Laplace noise on
// every released count, over the already-allowlisted taxonomy only.

export const DP_SCHEMA_VERSION = 1 as const;

export interface BucketCounters {
  impr: number;
  good: number;
  bad: number;
}
export type AggregateCounters = Record<string, BucketCounters>;

export interface ReleaseRow {
  bucket: string;
  impr: number;
  good: number;
  bad: number;
  epsilon: number; // ε spent producing this row (for cumulative-budget verification)
}

export interface AggregateRelease {
  v: typeof DP_SCHEMA_VERSION;
  epoch: number; // coarse time bucket — no finer-grained timing leaves the device
  k: number; // suppression threshold actually applied
  rows: ReleaseRow[]; // only allowlisted buckets with impr >= k, each noised
}

// scaleB is the Laplace scale b = sensitivity/ε; returns a noise sample.
export type NoiseFn = (scaleB: number) => number;

// Inverse-CDF Laplace sample from a uniform u in (-0.5, 0.5). Exposed so production
// can wrap a CSPRNG-derived uniform while tests can feed exact values.
export function laplaceFromUniform(u: number, b: number): number {
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function nonNegInt(x: number): number {
  return Math.max(0, Math.round(x));
}

export interface ComputeReleaseInput {
  counters: AggregateCounters;
  k: number;
  epsilon: number; // applied per released metric; sensitivity is 1
  epoch: number;
  noise: NoiseFn;
}

export function computeRelease(input: ComputeReleaseInput): AggregateRelease {
  const b = 1 / input.epsilon; // sensitivity 1
  const rows: ReleaseRow[] = [];
  for (const [bucket, c] of Object.entries(input.counters)) {
    if (!isAllowlisted(bucket)) continue; // defensive: never emit outside the taxonomy
    if (c.impr < input.k) continue; // k-anonymity suppression
    rows.push({
      bucket,
      impr: nonNegInt(c.impr + input.noise(b)),
      good: nonNegInt(c.good + input.noise(b)),
      bad: nonNegInt(c.bad + input.noise(b)),
      epsilon: input.epsilon,
    });
  }
  rows.sort((x, y) => (x.bucket < y.bucket ? -1 : 1));
  return { v: DP_SCHEMA_VERSION, epoch: input.epoch, k: input.k, rows };
}

export interface ReleasePolicy {
  minK: number;
  epsilonBudget: number; // max cumulative ε per bucket across all releases
}
export interface PolicyValidation {
  ok: boolean;
  errors: string[];
}

// Structural verification a stranger can run WITHOUT seeing true counts: every row
// is allowlisted, k meets the policy floor, counts are non-negative integers, and
// no bucket's cumulative ε exceeds its budget. (Whether suppression was applied
// honestly is checkable on-device by the owner, who alone holds the raw counters.)
export function validateReleasePolicy(
  release: AggregateRelease,
  policy: ReleasePolicy,
  priorEpsilon: Record<string, number> = {},
): PolicyValidation {
  const errors: string[] = [];
  if (release.k < policy.minK) {
    errors.push(`k ${release.k} is below the policy minimum ${policy.minK}`);
  }
  for (const row of release.rows) {
    if (!isAllowlisted(row.bucket)) {
      errors.push(`bucket '${row.bucket}' is not in the allowlist`);
    }
    const ints = [row.impr, row.good, row.bad];
    if (ints.some((n) => !Number.isInteger(n) || n < 0)) {
      errors.push(`bucket '${row.bucket}' has invalid (negative or non-integer) counts`);
    }
    const spent = (priorEpsilon[row.bucket] ?? 0) + row.epsilon;
    if (spent > policy.epsilonBudget + 1e-9) {
      errors.push(`bucket '${row.bucket}' exceeds ε budget (${spent} > ${policy.epsilonBudget})`);
    }
  }
  return { ok: errors.length === 0, errors };
}
