import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, makeImpression, verifyReceipt, chainHash, type Bidder, type Impression } from "@effinai/sponsorline-core";
import { Store } from "../src/store.js";
import { runReceipt } from "../src/cmd-receipt.js";

let appDir: string;
const SALT = "receipt-cli-salt";
const bidders: Bidder[] = [{ id: "acme-ci", bidCents: 500, targetSignals: ["lang:ts"], creative: "Acme" }];

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "sl-receipt-"));
});

function seedWitness() {
  const key = deriveDeviceKey(SALT);
  const store = new Store(appDir);
  const log: Impression[] = [];
  for (const [seed, ts] of [[1n, 1000], [2n, 2000]] as Array<[bigint, number]>) {
    const prevHash = log.length === 0 ? "" : chainHash(log[log.length - 1].payload);
    const imp = makeImpression({ bidders, signals: ["lang:ts"], seed, reserveCents: 100, consentId: "c", key, now: ts, prevHash });
    log.push(imp);
    store.appendWitness(imp);
  }
}

describe("runReceipt", () => {
  it("produces a signed, verifiable receipt from the witness log", () => {
    seedWitness();
    const r = runReceipt({ appDir, salt: SALT, now: 0, epoch: 3 });
    expect(r.exitCode).toBe(0);
    expect(verifyReceipt(r.receipt).ok).toBe(true);
    expect(r.receipt.payload.epoch).toBe(3);
    const acme = r.receipt.payload.rows.find((x) => x.campaignId === "acme-ci")!;
    expect(acme.impressions).toBe(2);
  });

  it("produces an empty but valid receipt when the device has never served", () => {
    const r = runReceipt({ appDir, salt: SALT, now: 0, epoch: 0 });
    expect(r.exitCode).toBe(0);
    expect(r.receipt.payload.rows).toEqual([]);
    expect(verifyReceipt(r.receipt).ok).toBe(true);
  });

  it("derives a coarse day-epoch from now when not overridden", () => {
    const oneDay = 1000 * 60 * 60 * 24;
    const r = runReceipt({ appDir, salt: SALT, now: oneDay * 5 + 123 });
    expect(r.receipt.payload.epoch).toBe(5);
  });
});
