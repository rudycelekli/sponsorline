import { describe, it, expect } from "vitest";
import { makeRng } from "../src/prng.js";

describe("splitmix64 prng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(42n);
    const b = makeRng(42n);
    const seqA = [a.nextU32(), a.nextU32(), a.nextU32()];
    const seqB = [b.nextU32(), b.nextU32(), b.nextU32()];
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = makeRng(1n).nextU32();
    const b = makeRng(2n).nextU32();
    expect(a).not.toEqual(b);
  });

  it("nextInt(n) stays within [0, n)", () => {
    const r = makeRng(7n);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});
