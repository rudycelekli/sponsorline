import { describe, it, expect } from "vitest";
import { deriveDeviceKey, seal, verifySeal } from "../src/crypto.js";

describe("ed25519 seal/verify", () => {
  it("derives a stable keypair from a salt", () => {
    const k1 = deriveDeviceKey("salt-abc");
    const k2 = deriveDeviceKey("salt-abc");
    expect(k1.publicKeyHex).toBe(k2.publicKeyHex);
    expect(k1.publicKeyHex).toHaveLength(64);
  });

  it("different salts → different keys", () => {
    expect(deriveDeviceKey("a").publicKeyHex).not.toBe(deriveDeviceKey("b").publicKeyHex);
  });

  it("seals and verifies a payload", () => {
    const key = deriveDeviceKey("salt-abc");
    const sealed = seal({ hello: "world" }, key);
    expect(sealed.sig).toMatch(/^[0-9a-f]+$/);
    expect(verifySeal(sealed, key.publicKeyHex)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const key = deriveDeviceKey("salt-abc");
    const sealed = seal({ hello: "world" }, key);
    const tampered = { ...sealed, payload: { hello: "evil" } };
    expect(verifySeal(tampered, key.publicKeyHex)).toBe(false);
  });
});
