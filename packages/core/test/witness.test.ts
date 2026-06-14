import { describe, it, expect } from "vitest";
import { deriveDeviceKey, seal } from "../src/crypto.js";
import { makeImpression, verifyLog } from "../src/witness.js";
import type { Bidder } from "../src/auction.js";

const key = deriveDeviceKey("salt-witness");
const bidders: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
];

describe("witness log", () => {
  it("records an impression that verifies", () => {
    const imp = makeImpression({
      bidders,
      signals: ["lang:ts"],
      seed: 1n,
      reserveCents: 100,
      consentId: "c1",
      key,
    });
    const res = verifyLog([imp], { publicKeyHex: key.publicKeyHex });
    expect(res.ok).toBe(true);
    expect(res.replayedAuctions).toBe(1);
  });

  it("fails verify when a seal is tampered", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    const bad = { ...imp, sig: "00".repeat(64) };
    const res = verifyLog([bad], { publicKeyHex: key.publicKeyHex });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("seal-invalid");
  });

  it("fails verify when a recorded outcome is rewritten", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    const bad = { ...imp, payload: { ...imp.payload, clearingPriceCents: 999 } };
    const res = verifyLog([bad], { publicKeyHex: key.publicKeyHex });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("seal-invalid"); // signature no longer matches payload
  });

  it("fails verify when egress carries a non-allowlisted signal", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    const dirtyPayload = { ...imp.payload, signals: ["path:/Users/secret"] };
    const resealed = seal(dirtyPayload, key);
    const res = verifyLog([{ payload: dirtyPayload, sig: resealed.sig }], {
      publicKeyHex: key.publicKeyHex,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("privacy-violation");
  });

  it("re-derives clearing price on replay", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    expect(imp.payload.clearingPriceCents).toBe(300);
  });

  it("seals the full bidder snapshot so settled impressions verify forever", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    // The snapshot (incl. losing bids) lives inside the sealed payload — a proper
    // Vickrey receipt. Replay must NOT depend on the live inventory.
    expect(imp.payload.bidders).toHaveLength(2);
    const r = verifyLog([imp], { publicKeyHex: key.publicKeyHex });
    expect(r.ok).toBe(true);
    expect(r.replayedAuctions).toBe(1);
  });

  it("detects a forged winner via intrinsic snapshot replay (even if re-sealed)", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    // Attacker rewrites the winner and re-seals with the device key. The seal is
    // valid, but replaying the SEALED snapshot exposes the lie.
    const forged = { ...imp.payload, winnerId: "a", winningCreative: "A" };
    const resealed = seal(forged, key);
    const r = verifyLog([{ payload: forged, sig: resealed.sig }], { publicKeyHex: key.publicKeyHex });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("replay-mismatch");
  });
});
