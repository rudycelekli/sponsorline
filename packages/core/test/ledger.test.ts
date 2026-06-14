import { describe, it, expect } from "vitest";
import { Ledger, reconcile } from "../src/ledger.js";

describe("ledger 50/50 integer split", () => {
  it("accrues exactly half the clearing price to the developer", () => {
    const l = new Ledger();
    l.accrue(300);
    l.accrue(500);
    expect(l.developerBalanceCents).toBe(400); // 150 + 250
    expect(l.impressionCount).toBe(2);
  });

  it("uses floor for odd cents (no float drift)", () => {
    const l = new Ledger();
    l.accrue(301); // 150 to dev, 151 retained
    expect(l.developerBalanceCents).toBe(150);
    expect(l.platformBalanceCents).toBe(151);
  });

  it("reconciles a witness log to the ledger exactly", () => {
    const clearingPrices = [300, 500, 301];
    const l = new Ledger();
    for (const c of clearingPrices) l.accrue(c);
    const r = reconcile(l, clearingPrices);
    expect(r.ok).toBe(true);
    expect(r.errorCents).toBe(0);
  });

  it("detects a reconciliation mismatch", () => {
    const l = new Ledger();
    l.accrue(300);
    const r = reconcile(l, [300, 300]); // log claims two, ledger has one
    expect(r.ok).toBe(false);
  });
});
