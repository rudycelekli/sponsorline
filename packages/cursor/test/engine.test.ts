import { describe, it, expect } from "vitest";
import { buildStatuslineStdin, computeSponsorLine, type CliRunner } from "../src/engine.js";

const ok = (stdout: string): CliRunner => async () => ({ stdout, code: 0 });

describe("buildStatuslineStdin", () => {
  it("emits the Claude Code statusline contract shape", () => {
    const ctx = JSON.parse(buildStatuslineStdin("/repo/app", "Cursor"));
    expect(ctx.workspace.current_dir).toBe("/repo/app");
    expect(ctx.model.display_name).toBe("Cursor");
  });
});

describe("computeSponsorLine", () => {
  it("invokes `sponsorline statusline` with the context on stdin and returns its line", async () => {
    let seen: { command: string; args: string[]; stdin: string } | null = null;
    const run: CliRunner = async (inv) => {
      seen = inv;
      return { stdout: "Cursor · Sponsored: Acme\n", code: 0 };
    };
    const line = await computeSponsorLine({ command: "sponsorline", cwd: "/r", modelName: "Cursor", run });
    expect(line).toBe("Cursor · Sponsored: Acme");
    expect(seen!.command).toBe("sponsorline");
    expect(seen!.args).toEqual(["statusline"]);
    expect(JSON.parse(seen!.stdin).workspace.current_dir).toBe("/r");
  });

  it("returns only the first stdout line, trimmed", async () => {
    const line = await computeSponsorLine({ command: "sponsorline", cwd: "/r", modelName: "Cursor", run: ok("  A · Sponsored: X  \nnoise\n") });
    expect(line).toBe("A · Sponsored: X");
  });

  it("degrades to the plain model name when the CLI exits nonzero", async () => {
    const run: CliRunner = async () => ({ stdout: "garbage", code: 1 });
    expect(await computeSponsorLine({ command: "sponsorline", cwd: "/r", modelName: "Cursor", run })).toBe("Cursor");
  });

  it("degrades to the plain model name when the CLI is missing (runner throws)", async () => {
    const run: CliRunner = async () => { throw new Error("ENOENT"); };
    expect(await computeSponsorLine({ command: "nope", cwd: "/r", modelName: "Cursor", run })).toBe("Cursor");
  });

  it("degrades to the plain model name on empty stdout", async () => {
    expect(await computeSponsorLine({ command: "sponsorline", cwd: "/r", modelName: "Cursor", run: ok("\n") })).toBe("Cursor");
  });
});
