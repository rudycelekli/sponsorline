import { describe, it, expect } from "vitest";
import { deriveDeviceKey, chainHash } from "../src/crypto.js";
import { makeImpression, type Impression } from "../src/witness.js";
import { buildReceipt, type Receipt } from "../src/receipt.js";
import { screenReceipts, DEFAULT_ANTIFRAUD_POLICY } from "../src/antifraud.js";
import type { Bidder } from "../src/auction.js";

const bidders: Bidder[] = [{ id: "acme-ci", bidCents: 500, targetSignals: ["lang:ts"], creative: "Acme" }];

function receiptOf(salt: string, impressions: number, epoch = 0): Receipt {
  const key = deriveDeviceKey(salt);
  const log: Impression[] = [];
  for (let i = 0; i < impressions; i++) {
    const prevHash = log.length === 0 ? "" : chainHash(log[log.length - 1].payload);
    log.push(makeImpression({ bidders, signals: ["lang:ts"], seed: BigInt(i + 1), reserveCents: 100, consentId: "c", key, now: 1000 + i, prevHash }));
  }
  return buildReceipt({ log, key, epoch });
}

describe("screenReceipts", () => {
  it("passes a plausible receipt and flags a physically impossible one", () => {
    const ok = receiptOf("dev-1", 10);
    // Forge >96 impressions on a single device: tamper then re-seal so the SEAL is
    // valid but the volume is physically impossible under the 15-min rotation cap.
    const k = deriveDeviceKey("dev-2");
    const forged = buildReceipt({ log: [], key: k, epoch: 0 });
    forged.payload.rows = [{ campaignId: "acme-ci", impressions: 500, spentCents: 1000, firstTs: 0, lastTs: 1 }];
    // re-seal over the inflated payload (an attacker controls their own key)
    const resealed = buildReceiptResealed(k, forged.payload);

    const r = screenReceipts([ok, resealed], DEFAULT_ANTIFRAUD_POLICY);
    expect(r.clean).toHaveLength(1);
    expect(r.clean[0].payload.devicePubKey).toBe(deriveDeviceKey("dev-1").publicKeyHex);
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0].reason).toMatch(/physical ceiling/i);
  });

  it("flags a receipt whose seal does not match", () => {
    const bad = receiptOf("dev-1", 5);
    bad.payload.rows[0].impressions = 4; // breaks the seal without re-signing
    const r = screenReceipts([bad], DEFAULT_ANTIFRAUD_POLICY);
    expect(r.clean).toHaveLength(0);
    expect(r.flagged[0].reason).toMatch(/seal/i);
  });

  it("flags future and stale epochs when currentEpoch is set", () => {
    const future = receiptOf("dev-1", 2, 10);
    const stale = receiptOf("dev-2", 2, 1);
    const fresh = receiptOf("dev-3", 2, 5);
    const r = screenReceipts([future, stale, fresh], { ...DEFAULT_ANTIFRAUD_POLICY, currentEpoch: 5, maxEpochAge: 1 });
    expect(r.clean.map((x) => x.payload.devicePubKey)).toEqual([deriveDeviceKey("dev-3").publicKeyHex]);
    expect(r.flagged.map((f) => f.reason).join(" ")).toMatch(/future/i);
    expect(r.flagged.map((f) => f.reason).join(" ")).toMatch(/stale/i);
  });

  it("flags spend over the per-device cap", () => {
    const k = deriveDeviceKey("whale");
    const payload = { v: 1 as const, devicePubKey: k.publicKeyHex, epoch: 0, rows: [{ campaignId: "acme-ci", impressions: 1, spentCents: 999_999, firstTs: 0, lastTs: 0 }] };
    const resealed = buildReceiptResealed(k, payload);
    const r = screenReceipts([resealed], DEFAULT_ANTIFRAUD_POLICY);
    expect(r.clean).toHaveLength(0);
    expect(r.flagged[0].reason).toMatch(/spend/i);
  });
});

// Helper: re-seal an arbitrary payload with a key the "attacker" controls, so the
// seal is valid but the contents are adversarial. Mirrors what a malicious client
// could legitimately produce — which is exactly what screening must catch.
import { seal } from "../src/crypto.js";
import type { ReceiptPayload } from "../src/receipt.js";
function buildReceiptResealed(key: ReturnType<typeof deriveDeviceKey>, payload: ReceiptPayload): Receipt {
  return seal(payload, key);
}
