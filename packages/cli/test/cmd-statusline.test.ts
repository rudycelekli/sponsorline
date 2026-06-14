import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runStatusline } from "../src/cmd-statusline.js";

let appdir: string;
let projectdir: string;
const SALT = "test-salt";

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-app-"));
  projectdir = mkdtempSync(join(tmpdir(), "sl-proj-"));
  writeFileSync(join(projectdir, "package.json"), '{"name":"x"}');
  const key = deriveDeviceKey(SALT);
  const store = new Store(appdir);
  store.writeConsent(createConsent({ grantedSignals: ["lang", "framework", "task"], key, now: 0, ttlMs: 1e12 }));
  store.writeInventory([{ id: "a", bidCents: 500, targetSignals: ["lang:ts"], creative: "Try Acme CI" }]);
});

const ctx = (cwd: string) => JSON.stringify({ workspace: { current_dir: cwd }, model: { display_name: "Sonnet" } });

describe("statusline", () => {
  it("renders a labeled Sponsored line and logs an impression", async () => {
    const out = await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 1, seed: 42n });
    expect(out.line).toContain("Sponsored");
    expect(out.line).toContain("Try Acme CI");
    expect(out.exitCode).toBe(0);
    expect(new Store(appdir).readWitness()).toHaveLength(1);
  });

  it("emits plain line and logs NOTHING when consent missing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "sl-empty-"));
    const out = await runStatusline({ appDir: empty, salt: SALT, stdin: ctx(projectdir), now: 1, seed: 42n });
    expect(out.line).not.toContain("Sponsored");
    expect(out.exitCode).toBe(0);
    expect(new Store(empty).readWitness()).toHaveLength(0);
  });

  it("emits plain line on malformed stdin (never throws)", async () => {
    const out = await runStatusline({ appDir: appdir, salt: SALT, stdin: "not json", now: 1, seed: 42n });
    expect(out.exitCode).toBe(0);
    expect(out.line).not.toContain("Sponsored");
  });

  it("egress payload in the witness carries ONLY allowlisted signals", async () => {
    await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 1, seed: 42n });
    const imp = new Store(appdir).readWitness()[0];
    for (const s of imp.payload.signals) expect(/^(lang|framework|task):/.test(s)).toBe(true);
    expect(JSON.stringify(imp.payload)).not.toContain(projectdir);
  });
});
