import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, validateConsent } from "@effinai/sponsorline-core";
import { Store } from "../src/store.js";
import { runInit } from "../src/cmd-init.js";
import { runOff } from "../src/cmd-off.js";

let appdir: string;
let settingsPath: string;

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-init-"));
  settingsPath = join(mkdtempSync(join(tmpdir(), "sl-cc-")), "settings.json");
});

describe("init / off", () => {
  it("writes a valid consent record and a statusLine config block", async () => {
    const code = await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    expect(code).toBe(0);
    const store = new Store(appdir);
    const consent = store.readConsent()!;
    const salt = readFileSync(join(appdir, "salt"), "utf8");
    const key = deriveDeviceKey(salt);
    expect(validateConsent(consent, { publicKeyHex: key.publicKeyHex, now: 1 }).valid).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine.command).toContain("sponsorline statusline");
  });

  it("is idempotent (second init does not duplicate or corrupt settings)", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine.command).toContain("sponsorline statusline");
  });

  it("preserves unrelated settings keys", async () => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.statusLine).toBeDefined();
  });

  it("writes the salt (private-key seed) with owner-only permissions", async () => {
    if (process.platform === "win32") return; // POSIX mode bits are not meaningful on Windows
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const mode = statSync(join(appdir, "salt")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("preserves the existing consent (stable id) across re-init", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const id1 = new Store(appdir).readConsent()!.payload.id;
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 50, ttlMs: 1e12 });
    const id2 = new Store(appdir).readConsent()!.payload.id;
    expect(id2).toBe(id1); // re-init must not orphan prior witness history
  });

  it("does not resurrect consent after off (re-init must not silently re-enable ads)", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    await runOff({ appDir: appdir, settingsPath, now: 10 });
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 20, ttlMs: 1e12 });
    const store = new Store(appdir);
    const key = deriveDeviceKey(readFileSync(join(appdir, "salt"), "utf8"));
    const r = validateConsent(store.readConsent()!, { publicKeyHex: key.publicKeyHex, now: 21 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("revoked");
  });

  it("init fails clearly on malformed settings.json and leaves the file untouched", async () => {
    const broken = "{ not valid json";
    writeFileSync(settingsPath, broken);
    await expect(
      runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 }),
    ).rejects.toThrow(/not valid JSON/);
    // The user's existing (if broken) settings must not be clobbered.
    expect(readFileSync(settingsPath, "utf8")).toBe(broken);
  });

  it("off never crashes on a malformed settings.json (kill switch still revokes)", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    writeFileSync(settingsPath, "{ this is not valid json"); // user hand-edited / mid-write
    const code = await runOff({ appDir: appdir, settingsPath, now: 10 });
    expect(code).toBe(0); // the opt-out command must succeed regardless
    const store = new Store(appdir);
    const key = deriveDeviceKey(readFileSync(join(appdir, "salt"), "utf8"));
    const r = validateConsent(store.readConsent()!, { publicKeyHex: key.publicKeyHex, now: 11 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("revoked"); // consent revoked even though settings was unparseable
  });

  it("off revokes consent and removes the statusLine block immediately", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const code = await runOff({ appDir: appdir, settingsPath, now: 10 });
    expect(code).toBe(0);
    const store = new Store(appdir);
    const salt = readFileSync(join(appdir, "salt"), "utf8");
    const key = deriveDeviceKey(salt);
    const r = validateConsent(store.readConsent()!, { publicKeyHex: key.publicKeyHex, now: 11 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("revoked");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine).toBeUndefined();
  });
});
