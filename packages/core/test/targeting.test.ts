import { describe, it, expect } from "vitest";
import { evalPredicate, validatePredicate, type TargetPredicate } from "../src/targeting.js";

const vec = new Set(["lang:rust", "task:test"]);

describe("evalPredicate", () => {
  it("atom matches when present, misses when absent", () => {
    expect(evalPredicate({ atom: "lang:rust" }, vec)).toBe(true);
    expect(evalPredicate({ atom: "lang:py" }, vec)).toBe(false);
  });

  it("all is AND; any is OR; not negates", () => {
    expect(evalPredicate({ all: [{ atom: "lang:rust" }, { atom: "task:test" }] }, vec)).toBe(true);
    expect(evalPredicate({ all: [{ atom: "lang:rust" }, { atom: "framework:react" }] }, vec)).toBe(false);
    expect(evalPredicate({ any: [{ atom: "lang:py" }, { atom: "task:test" }] }, vec)).toBe(true);
    expect(evalPredicate({ any: [{ atom: "lang:py" }, { atom: "lang:go" }] }, vec)).toBe(false);
    expect(evalPredicate({ not: { atom: "framework:react" } }, vec)).toBe(true);
    expect(evalPredicate({ not: { atom: "lang:rust" } }, vec)).toBe(false);
  });

  it("empty all is true; empty any is false (boolean identities)", () => {
    expect(evalPredicate({ all: [] }, vec)).toBe(true);
    expect(evalPredicate({ any: [] }, vec)).toBe(false);
  });

  it("evaluates the spec example: rust AND test AND NOT react", () => {
    const p: TargetPredicate = {
      all: [{ atom: "lang:rust" }, { atom: "task:test" }, { not: { atom: "framework:react" } }],
    };
    expect(evalPredicate(p, vec)).toBe(true);
    expect(evalPredicate(p, new Set(["lang:rust", "task:test", "framework:react"]))).toBe(false);
  });
});

describe("validatePredicate", () => {
  it("accepts a well-formed allowlisted tree", () => {
    const r = validatePredicate({ all: [{ atom: "lang:rust" }, { not: { atom: "framework:react" } }] });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an atom outside the allowlist (privacy-taxonomy guard)", () => {
    const r = validatePredicate({ atom: "email:user@example.com" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/allowlist/i);
  });

  it("rejects malformed / unknown node shapes", () => {
    expect(validatePredicate({ wat: [] } as unknown as TargetPredicate).ok).toBe(false);
    expect(validatePredicate(null as unknown as TargetPredicate).ok).toBe(false);
    expect(validatePredicate({ atom: 5 } as unknown as TargetPredicate).ok).toBe(false);
  });

  it("rejects trees exceeding the node cap (bounded eval)", () => {
    const many = { any: Array.from({ length: 65 }, () => ({ atom: "lang:rust" })) };
    const r = validatePredicate(many);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/node|size|cap/i);
  });

  it("rejects trees exceeding the depth cap", () => {
    let p: TargetPredicate = { atom: "lang:rust" };
    for (let i = 0; i < 17; i++) p = { not: p };
    const r = validatePredicate(p);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/depth/i);
  });
});
