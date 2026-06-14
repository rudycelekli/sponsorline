import { describe, it, expect } from "vitest";
import {
  buildInterestVector,
  ALLOWLIST,
  isAllowlisted,
  INTEREST_SCHEMA_VERSION,
} from "../src/interest.js";

describe("interest vector", () => {
  it("maps TS manifests to lang:ts", () => {
    const v = buildInterestVector({
      manifests: ["package.json", "tsconfig.json"],
      taskCategory: "refactor",
    });
    expect(v.schemaVersion).toBe(INTEREST_SCHEMA_VERSION);
    expect(v.signals).toContain("lang:ts");
    expect(v.signals).toContain("task:refactor");
  });

  it("maps python ML manifests to lang:py + framework:pytorch", () => {
    const v = buildInterestVector({
      manifests: ["requirements.txt", "pyproject.toml"],
      taskCategory: "build",
      manifestContents: { "requirements.txt": "torch==2.2.0\nnumpy" },
    });
    expect(v.signals).toContain("lang:py");
    expect(v.signals).toContain("framework:pytorch");
  });

  it("emits ONLY allowlisted signals — never paths or code", () => {
    const v = buildInterestVector({
      manifests: ["package.json"],
      taskCategory: "build",
      manifestContents: { "package.json": '{"name":"secret-internal-repo"}' },
    });
    for (const s of v.signals) expect(isAllowlisted(s)).toBe(true);
    const blob = JSON.stringify(v);
    expect(blob).not.toContain("secret-internal-repo");
    expect(blob).not.toContain("/Users/");
  });

  it("allowlist enumerates only coarse prefixes", () => {
    expect(ALLOWLIST.prefixes).toEqual(["lang:", "framework:", "task:"]);
  });
});
