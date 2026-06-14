import { describe, it, expect } from "vitest";
import { deriveDeviceKey, chainHash } from "../src/crypto.js";
import { makeImpression, type Impression } from "../src/witness.js";
import { buildReceipt, type Receipt } from "../src/receipt.js";
import { aggregateReceipts } from "../src/report.js";
import type { Bidder } from "../src/auction.js";

const bidders: Bidder[] = [
  { id: "acme-ci", bidCents: 500, targetSignals: ["lang:ts"], creative: "Acme" },
  { id: "vectorhub", bidCents: 700, targetSignals: ["lang:py"], creative: "Vector" },
];

function deviceReceipt(salt: string, plan: Array<[string[], number]>, epoch = 0): { receipt: Receipt; key: ReturnType<typeof deriveDeviceKey> } {
  const key = deriveDeviceKey(salt);
  const log: Impression[] = [];
  let seed = 1n;
  for (const [signals, ts] of plan) {
    const prevHash = log.length === 0 ? "" : chainHash(log[log.length - 1].payload);
    log.push(makeImpression({ bidders, signals, seed, reserveCents: 100, consentId: "c", key, now: ts, prevHash }));
    seed += 1n;
  }
  return { receipt: buildReceipt({ log, key, epoch }), key };
}

describe("aggregateReceipts", () => {
  it("counts distinct devices as reach and sums impressions + spend per campaign", () => {
    const d1 = deviceReceipt("dev-1", [[["lang:ts"], 100], [["lang:ts"], 200]]).receipt; // acme x2
    const d2 = deviceReceipt("dev-2", [[["lang:ts"], 150], [["lang:py"], 300]]).receipt; // acme x1, vectorhub x1
    const report = aggregateReceipts([d1, d2]);
    const byId = Object.fromEntries(report.campaigns.map((c) => [c.campaignId, c]));
    expect(byId["acme-ci"]).toMatchObject({ reachDevices: 2, impressions: 3 });
    expect(byId["vectorhub"]).toMatchObject({ reachDevices: 1, impressions: 1 });
    expect(report.acceptedReceipts).toBe(2);
    expect(report.rejectedReceipts).toBe(0);
  });

  it("drops invalid receipts without corrupting the aggregate", () => {
    const good = deviceReceipt("dev-1", [[["lang:ts"], 100]]).receipt;
    const tampered = deviceReceipt("dev-2", [[["lang:ts"], 100]]).receipt;
    tampered.payload.rows[0].impressions = 9999; // breaks the seal
    const report = aggregateReceipts([good, tampered]);
    expect(report.acceptedReceipts).toBe(1);
    expect(report.rejectedReceipts).toBe(1);
    expect(report.campaigns.find((c) => c.campaignId === "acme-ci")!.impressions).toBe(1);
  });

  it("deduplicates a device that submits the same epoch twice (no double counting)", () => {
    const r1 = deviceReceipt("dev-1", [[["lang:ts"], 100]], 5).receipt;
    const r1again = deviceReceipt("dev-1", [[["lang:ts"], 100]], 5).receipt; // same device + epoch
    const report = aggregateReceipts([r1, r1again]);
    const acme = report.campaigns.find((c) => c.campaignId === "acme-ci")!;
    expect(acme.reachDevices).toBe(1);
    expect(acme.impressions).toBe(1);
    expect(report.acceptedReceipts).toBe(1);
  });

  it("returns an empty report for no receipts", () => {
    const report = aggregateReceipts([]);
    expect(report.campaigns).toEqual([]);
    expect(report.acceptedReceipts).toBe(0);
  });
});
