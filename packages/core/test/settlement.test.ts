import { describe, it, expect } from "vitest";
import { deriveDeviceKey, chainHash } from "../src/crypto.js";
import {
  appendSettlement,
  verifySettlementLog,
  type SettlementEntry,
} from "../src/settlement.js";

const platform = deriveDeviceKey("platform-settlement-salt");
const other = deriveDeviceKey("some-other-key");

// A receipt hash is just the chainHash of a receipt payload; for these tests any
// distinct content stands in for distinct receipts.
const receiptHash = (id: string) => chainHash({ receipt: id });

// Build a small healthy ledger: fund acme $50, pay one dev $3 against r1.
function healthy(): SettlementEntry[] {
  const log: SettlementEntry[] = [];
  log.push(appendSettlement({ log, key: platform, now: 1000, body: { kind: "fund", campaignId: "acme", amountCents: 5000, fundingRef: "ch_001" } }));
  log.push(appendSettlement({ log, key: platform, now: 2000, body: { kind: "payout", campaignId: "acme", devicePubKey: "devA", amountCents: 300, receiptHash: receiptHash("r1"), payoutRef: "po_001" } }));
  return log;
}

describe("verifySettlementLog", () => {
  it("accepts an authentic, conserved log and reports per-campaign totals", () => {
    const res = verifySettlementLog(healthy(), platform.publicKeyHex);
    expect(res.ok).toBe(true);
    expect(res.entries).toBe(2);
    expect(res.byCampaign["acme"]).toEqual({ fundedCents: 5000, paidCents: 300 });
  });

  it("accepts an empty log", () => {
    expect(verifySettlementLog([], platform.publicKeyHex)).toMatchObject({ ok: true, entries: 0 });
  });

  it("rejects a log sealed by a different platform key", () => {
    const res = verifySettlementLog(healthy(), other.publicKeyHex);
    expect(res).toMatchObject({ ok: false, reason: "seal-invalid" });
  });

  it("detects tampering of a non-head entry (broken chain)", () => {
    const log = healthy();
    // Edit the funding amount of entry 0; its content hash changes, so entry 1's
    // signed prevHash no longer matches.
    log[0] = { ...log[0], payload: { ...log[0].payload, body: { ...log[0].payload.body, amountCents: 999999 } as any } };
    const res = verifySettlementLog(log, platform.publicKeyHex);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("chain-broken");
    // The tamper is on entry 0, but it surfaces at entry 1: entry 1's signed
    // prevHash no longer matches the recomputed hash of the edited entry 0.
    expect(res.failedIndex).toBe(1);
  });

  it("rejects overspend: paying out more than a campaign was funded", () => {
    const log: SettlementEntry[] = [];
    log.push(appendSettlement({ log, key: platform, body: { kind: "fund", campaignId: "acme", amountCents: 100, fundingRef: "ch_x" } }));
    log.push(appendSettlement({ log, key: platform, body: { kind: "payout", campaignId: "acme", devicePubKey: "devA", amountCents: 101, receiptHash: receiptHash("r1"), payoutRef: "po_x" } }));
    const res = verifySettlementLog(log, platform.publicKeyHex);
    expect(res).toMatchObject({ ok: false, reason: "overspend", failedIndex: 1 });
  });

  it("rejects a payout against an unfunded campaign", () => {
    const log: SettlementEntry[] = [];
    log.push(appendSettlement({ log, key: platform, body: { kind: "payout", campaignId: "ghost", devicePubKey: "devA", amountCents: 1, receiptHash: receiptHash("r1"), payoutRef: "po_g" } }));
    expect(verifySettlementLog(log, platform.publicKeyHex)).toMatchObject({ ok: false, reason: "overspend" });
  });

  it("rejects double-claim: the same receipt backing two payouts", () => {
    const log: SettlementEntry[] = [];
    const rh = receiptHash("r1");
    log.push(appendSettlement({ log, key: platform, body: { kind: "fund", campaignId: "acme", amountCents: 5000, fundingRef: "ch_001" } }));
    log.push(appendSettlement({ log, key: platform, body: { kind: "payout", campaignId: "acme", devicePubKey: "devA", amountCents: 300, receiptHash: rh, payoutRef: "po_1" } }));
    log.push(appendSettlement({ log, key: platform, body: { kind: "payout", campaignId: "acme", devicePubKey: "devA", amountCents: 300, receiptHash: rh, payoutRef: "po_2" } }));
    expect(verifySettlementLog(log, platform.publicKeyHex)).toMatchObject({ ok: false, reason: "double-claim", failedIndex: 2 });
  });

  it("rejects malformed entries (negative amount)", () => {
    const log: SettlementEntry[] = [];
    log.push(appendSettlement({ log, key: platform, body: { kind: "fund", campaignId: "acme", amountCents: -1, fundingRef: "ch_001" } }));
    expect(verifySettlementLog(log, platform.publicKeyHex)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("allows funded payouts up to exactly the funded amount across multiple receipts", () => {
    const log: SettlementEntry[] = [];
    log.push(appendSettlement({ log, key: platform, body: { kind: "fund", campaignId: "acme", amountCents: 600, fundingRef: "ch_001" } }));
    log.push(appendSettlement({ log, key: platform, body: { kind: "payout", campaignId: "acme", devicePubKey: "devA", amountCents: 300, receiptHash: receiptHash("r1"), payoutRef: "po_1" } }));
    log.push(appendSettlement({ log, key: platform, body: { kind: "payout", campaignId: "acme", devicePubKey: "devB", amountCents: 300, receiptHash: receiptHash("r2"), payoutRef: "po_2" } }));
    const res = verifySettlementLog(log, platform.publicKeyHex);
    expect(res.ok).toBe(true);
    expect(res.byCampaign["acme"]).toEqual({ fundedCents: 600, paidCents: 600 });
  });
});
