import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent, verifyLog } from "@sponsorline/core";
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

  it("constrains sealed signals to the consent's granted families (narrow consent)", async () => {
    const narrowApp = mkdtempSync(join(tmpdir(), "sl-narrow-"));
    const key = deriveDeviceKey(SALT);
    const store = new Store(narrowApp);
    const consent = createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 });
    store.writeConsent(consent);
    store.writeInventory([{ id: "a", bidCents: 500, targetSignals: ["lang:ts"], creative: "Try Acme CI" }]);
    // A project whose manifest WOULD trigger framework detection (react keyword).
    const proj = mkdtempSync(join(tmpdir(), "sl-rproj-"));
    writeFileSync(join(proj, "package.json"), '{"dependencies":{"react":"18"}}');
    await runStatusline({ appDir: narrowApp, salt: SALT, stdin: ctx(proj), now: 1, seed: 42n });
    const imp = store.readWitness()[0];
    // Only lang:* may be sealed — framework:* and task:* are outside the grant.
    for (const s of imp.payload.signals) expect(s.startsWith("lang:")).toBe(true);
    // The producer's own log must pass consent-bound verification.
    const r = verifyLog(store.readWitness(), { publicKeyHex: key.publicKeyHex, consent });
    expect(r.ok).toBe(true);
  });

  it("logs ONE billable impression per rotation window, re-displaying the cached line between", async () => {
    const rotateMs = 1000;
    const first = await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 0, seed: 42n, rotateMs });
    const second = await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 500, seed: 99n, rotateMs });
    expect(first.line).toContain("Try Acme CI");
    expect(second.line).toBe(first.line); // cached re-render, no new auction
    expect(new Store(appdir).readWitness()).toHaveLength(1); // only ONE impression billed
  });

  it("opens a new impression once the rotation window elapses", async () => {
    const rotateMs = 1000;
    await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 0, seed: 42n, rotateMs });
    await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 1500, seed: 42n, rotateMs });
    expect(new Store(appdir).readWitness()).toHaveLength(2);
  });

  it("re-renders the cached line with the CURRENT model name (not a stale one)", async () => {
    const rotateMs = 1000;
    await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 0, seed: 42n, rotateMs });
    const ctx2 = JSON.stringify({ workspace: { current_dir: projectdir }, model: { display_name: "Opus" } });
    const out = await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx2, now: 500, seed: 42n, rotateMs });
    expect(out.line).toContain("Opus");
    expect(out.line).toContain("Try Acme CI");
  });
});
