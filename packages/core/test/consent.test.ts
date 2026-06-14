import { describe, it, expect } from "vitest";
import { deriveDeviceKey } from "../src/crypto.js";
import { createConsent, validateConsent, revokeConsent } from "../src/consent.js";

const key = deriveDeviceKey("salt-consent");

describe("consent record", () => {
  it("creates a valid, signed consent record", () => {
    const c = createConsent({ grantedSignals: ["lang", "framework", "task"], key, now: 1000, ttlMs: 10_000 });
    const r = validateConsent(c, { publicKeyHex: key.publicKeyHex, now: 2000 });
    expect(r.valid).toBe(true);
    expect(c.payload.id).toMatch(/^c_/);
  });

  it("rejects an expired record", () => {
    const c = createConsent({ grantedSignals: ["lang"], key, now: 1000, ttlMs: 500 });
    const r = validateConsent(c, { publicKeyHex: key.publicKeyHex, now: 2000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("expired");
  });

  it("rejects a tampered record", () => {
    const c = createConsent({ grantedSignals: ["lang"], key, now: 1000, ttlMs: 10_000 });
    const bad = { ...c, payload: { ...c.payload, grantedSignals: ["lang", "framework", "task", "code"] } };
    const r = validateConsent(bad, { publicKeyHex: key.publicKeyHex, now: 2000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("signature");
  });

  it("revocation takes effect immediately", () => {
    const c = createConsent({ grantedSignals: ["lang"], key, now: 1000, ttlMs: 10_000 });
    const revoked = revokeConsent(c, key, 1500);
    const r = validateConsent(revoked, { publicKeyHex: key.publicKeyHex, now: 1600 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("revoked");
  });
});
