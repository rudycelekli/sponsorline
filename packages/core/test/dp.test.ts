import { describe, it, expect } from "vitest";
import {
  computeRelease, validateReleasePolicy, laplaceFromUniform,
  type AggregateCounters,
} from "../src/dp.js";

const counters: AggregateCounters = {
  "lang:rust": { impr: 120, good: 30, bad: 5 },
  "lang:py": { impr: 40, good: 10, bad: 2 }, // below k=50 → suppressed
  "task:test": { impr: 200, good: 80, bad: 10 },
  "email:leak": { impr: 999, good: 1, bad: 0 }, // non-allowlisted → never emitted
};

const noNoise = () => 0;

describe("computeRelease", () => {
  it("suppresses buckets below k and drops non-allowlisted buckets", () => {
    const r = computeRelease({ counters, k: 50, epsilon: 1, epoch: 7, noise: noNoise });
    const buckets = r.rows.map((x) => x.bucket);
    expect(buckets).toContain("lang:rust");
    expect(buckets).toContain("task:test");
    expect(buckets).not.toContain("lang:py"); // below k
    expect(buckets).not.toContain("email:leak"); // not allowlisted
  });

  it("with zero noise the released counts equal the true counts (rows sorted)", () => {
    const r = computeRelease({ counters, k: 50, epsilon: 1, epoch: 7, noise: noNoise });
    expect(r.rows.map((x) => x.bucket)).toEqual(["lang:rust", "task:test"]);
    const rust = r.rows.find((x) => x.bucket === "lang:rust")!;
    expect(rust).toMatchObject({ impr: 120, good: 30, bad: 5, epsilon: 1 });
    expect(r).toMatchObject({ v: 1, epoch: 7, k: 50 });
  });

  it("adds noise and floors released counts at zero", () => {
    const plus5 = computeRelease({ counters, k: 50, epsilon: 1, epoch: 0, noise: () => 5 });
    expect(plus5.rows.find((x) => x.bucket === "lang:rust")!.impr).toBe(125);
    const huge = computeRelease({ counters, k: 50, epsilon: 1, epoch: 0, noise: () => -1000 });
    expect(huge.rows.find((x) => x.bucket === "lang:rust")!.impr).toBe(0);
  });
});

describe("validateReleasePolicy", () => {
  it("accepts a clean release within budget", () => {
    const r = computeRelease({ counters, k: 50, epsilon: 1, epoch: 0, noise: noNoise });
    const v = validateReleasePolicy(r, { minK: 50, epsilonBudget: 3 });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("flags k below the policy minimum", () => {
    const r = computeRelease({ counters, k: 10, epsilon: 1, epoch: 0, noise: noNoise });
    const v = validateReleasePolicy(r, { minK: 50, epsilonBudget: 3 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/k .*minimum|below/i);
  });

  it("flags cumulative epsilon over budget", () => {
    const r = computeRelease({ counters, k: 50, epsilon: 1, epoch: 0, noise: noNoise });
    const v = validateReleasePolicy(r, { minK: 50, epsilonBudget: 3 }, { "lang:rust": 2.5 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/budget/i);
  });

  it("flags a non-allowlisted or negative row injected after the fact", () => {
    const r = computeRelease({ counters, k: 50, epsilon: 1, epoch: 0, noise: noNoise });
    r.rows.push({ bucket: "ssn:123", impr: -4, good: 0, bad: 0, epsilon: 1 });
    const v = validateReleasePolicy(r, { minK: 50, epsilonBudget: 3 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/allowlist/i);
    expect(v.errors.join(" ")).toMatch(/invalid|negative/i);
  });
});

describe("laplaceFromUniform", () => {
  it("is zero at the distribution center and antisymmetric", () => {
    expect(laplaceFromUniform(0, 1)).toBeCloseTo(0, 10);
    expect(laplaceFromUniform(0.25, 1)).toBeCloseTo(-laplaceFromUniform(-0.25, 1), 10);
  });
});
