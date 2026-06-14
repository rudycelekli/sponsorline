import { describe, it, expect } from "vitest";
import { SolverBandit } from "../src/relevance.js";

describe("SolverBandit relevance", () => {
  it("serializes and restores state", () => {
    const b = new SolverBandit(7n);
    b.update("lang:ts", "adv-a", true);
    const json = b.toJSON();
    const b2 = SolverBandit.fromJSON(7n, json);
    expect(b2.toJSON()).toEqual(json);
  });

  it("prefers the advertiser with a better local reward history", () => {
    const b = new SolverBandit(7n);
    for (let i = 0; i < 50; i++) {
      b.update("lang:ts", "good", true);
      b.update("lang:ts", "bad", false);
    }
    const ranked = b.rank("lang:ts", ["good", "bad"]);
    expect(ranked[0]).toBe("good");
  });

  it("is deterministic for a given seed", () => {
    const mk = () => {
      const b = new SolverBandit(1n);
      b.update("lang:ts", "a", true);
      b.update("lang:ts", "b", false);
      return b.rank("lang:ts", ["a", "b"]);
    };
    expect(mk()).toEqual(mk());
  });
});
