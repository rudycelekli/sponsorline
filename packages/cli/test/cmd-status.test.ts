import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runStatus } from "../src/cmd-status.js";

let appDir: string;
let settingsPath: string;
const SALT = "status-salt";

function seedConsent(ttlMs: number) {
  const key = deriveDeviceKey(SALT);
  const store = new Store(appDir);
  store.writePubKey(key.publicKeyHex);
  store.writeConsent(createConsent({ grantedSignals: ["lang", "framework", "task"], key, now: 0, ttlMs }));
}

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "sl-status-"));
  settingsPath = join(appDir, "settings.json");
  writeFileSync(join(appDir, "salt"), SALT);
});

describe("runStatus", () => {
  it("reports ready when CLI resolves, statusLine is wired, consent is valid, and inventory exists", () => {
    seedConsent(1e12);
    new Store(appDir).writeInventory([{ id: "x", bidCents: 200, targetSignals: ["lang:ts"], creative: "X" }]);
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: "command", command: "sponsorline statusline" } }));

    const r = runStatus({ appDir, salt: SALT, settingsPath, now: 1000, cliOnPath: true });
    expect(r.ready).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("flags every missing piece without throwing", () => {
    // no consent, no inventory, no settings file, CLI not on PATH
    const r = runStatus({ appDir, salt: SALT, settingsPath, now: 1000, cliOnPath: false });
    expect(r.ready).toBe(false);
    expect(r.exitCode).toBe(1);
    const byName = Object.fromEntries(r.checks.map((c) => [c.name, c.ok]));
    expect(byName.cli).toBe(false);
    expect(byName.statusline).toBe(false);
    expect(byName.consent).toBe(false);
    expect(byName.inventory).toBe(false);
  });

  it("flags expired consent as not ready", () => {
    seedConsent(500); // expires at t=500
    new Store(appDir).writeInventory([{ id: "x", bidCents: 200, targetSignals: ["lang:ts"], creative: "X" }]);
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: "command", command: "sponsorline statusline" } }));

    const r = runStatus({ appDir, salt: SALT, settingsPath, now: 1000, cliOnPath: true });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.name === "consent")!.ok).toBe(false);
  });

  it("never crashes on a malformed settings file or inventory", () => {
    seedConsent(1e12);
    writeFileSync(settingsPath, "{ not json");
    writeFileSync(join(appDir, "inventory.json"), "{ also not json");
    const r = runStatus({ appDir, salt: SALT, settingsPath, now: 1000, cliOnPath: true });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.name === "statusline")!.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "inventory")!.ok).toBe(false);
  });
});
