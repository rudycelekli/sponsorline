import { describe, it, expect } from "vitest";
import { deriveDeviceKey, chainHash } from "../src/crypto.js";
import { makeImpression, type Impression } from "../src/witness.js";
import { buildReceipt, verifyReceipt } from "../src/receipt.js";
import type { Bidder } from "../src/auction.js";

const key = deriveDeviceKey("receipt-salt");
const bidders: Bidder[] = [
  { id: "acme-ci", bidCents: 500, targetSignals: ["lang:ts"], creative: "Acme" },
  { id: "vectorhub", bidCents: 700, targetSignals: ["lang:py"], creative: "Vector" },
];

// Build a small witness chain: 2 impressions won by acme-ci (lang:ts), 1 by vectorhub (lang:py).
function chain(): Impression[] {
  const log: Impression[] = [];
  const push = (signals: string[], seed: bigint, ts: number) => {
    const prevHash = log.length === 0 ? "" : chainHash(log[log.length - 1].payload);
    log.push(makeImpression({ bidders, signals, seed, reserveCents: 100, consentId: "c1", key, now: ts, prevHash }));
  };
  push(["lang:ts"], 1n, 1000);
  push(["lang:ts"], 2n, 2000);
  push(["lang:py"], 3n, 3000);
  return log;
}

describe("buildReceipt", () => {
  it("aggregates the witness log into per-campaign reach + spend, sealed by the device", () => {
    const r = buildReceipt({ log: chain(), key, epoch: 7 });
    expect(r.payload.devicePubKey).toBe(key.publicKeyHex);
    expect(r.payload.epoch).toBe(7);
    const byId = Object.fromEntries(r.payload.rows.map((x) => [x.campaignId, x]));
    expect(byId["acme-ci"]).toMatchObject({ impressions: 2, firstTs: 1000, lastTs: 2000 });
    expect(byId["vectorhub"]).toMatchObject({ impressions: 1, firstTs: 3000, lastTs: 3000 });
    // spend is the sum of clearing prices actually charged
    expect(byId["acme-ci"].spentCents).toBeGreaterThan(0);
  });

  it("ignores impressions with no winner", () => {
    // signal that matches nobody → winnerId null, excluded from receipt
    const log = [makeImpression({ bidders, signals: ["lang:rust"], seed: 1n, reserveCents: 100, consentId: "c1", key, now: 1, prevHash: "" })];
    const r = buildReceipt({ log, key, epoch: 0 });
    expect(r.payload.rows).toEqual([]);
  });

  it("produces rows sorted by campaignId", () => {
    const r = buildReceipt({ log: chain(), key, epoch: 0 });
    expect(r.payload.rows.map((x) => x.campaignId)).toEqual(["acme-ci", "vectorhub"]);
  });
});

describe("verifyReceipt", () => {
  it("accepts a genuine receipt", () => {
    const r = buildReceipt({ log: chain(), key, epoch: 1 });
    const v = verifyReceipt(r);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects a tampered row (seal no longer matches)", () => {
    const r = buildReceipt({ log: chain(), key, epoch: 1 });
    r.payload.rows[0].impressions = 9999;
    const v = verifyReceipt(r);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/seal|signature/i);
  });

  it("rejects a receipt whose pubkey was swapped to claim another device", () => {
    const r = buildReceipt({ log: chain(), key, epoch: 1 });
    r.payload.devicePubKey = deriveDeviceKey("other").publicKeyHex;
    const v = verifyReceipt(r);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/seal|signature/i);
  });

  it("rejects negative or non-integer counts", () => {
    const r = buildReceipt({ log: chain(), key, epoch: 1 });
    r.payload.rows[0].impressions = -1;
    const v = verifyReceipt(r);
    expect(v.ok).toBe(false);
  });
});
