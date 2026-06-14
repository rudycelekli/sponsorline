import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sl-")); });

describe("Store", () => {
  it("round-trips consent, inventory, ledger, and witness entries", () => {
    const s = new Store(dir);
    s.writeConsent({ payload: { v: 1, id: "c_x", grantedSignals: ["lang"], issuedAt: 0, expiresAt: 9, revokedAt: null }, sig: "ab" });
    expect(s.readConsent()?.payload.id).toBe("c_x");

    s.writeInventory([{ id: "a", bidCents: 100, targetSignals: ["lang:ts"], creative: "A" }]);
    expect(s.readInventory()).toHaveLength(1);

    s.appendWitness({ payload: { v: 1, ts: 1, consentId: "c_x", signals: ["lang:ts"], seed: "1", reserveCents: 100, winnerId: "a", winningCreative: "A", clearingPriceCents: 100, bidders: [{ id: "a", bidCents: 100, targetSignals: ["lang:ts"], creative: "A" }] }, sig: "cd" });
    s.appendWitness({ payload: { v: 1, ts: 2, consentId: "c_x", signals: ["lang:ts"], seed: "2", reserveCents: 100, winnerId: "a", winningCreative: "A", clearingPriceCents: 100, bidders: [{ id: "a", bidCents: 100, targetSignals: ["lang:ts"], creative: "A" }] }, sig: "ef" });
    expect(s.readWitness()).toHaveLength(2);
  });

  it("returns null consent when none written", () => {
    expect(new Store(dir).readConsent()).toBeNull();
  });
});
