import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, type PayoutAccount } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runPayout } from "../src/cmd-payout.js";

let appdir: string;
const SALT = "payout-salt";

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-payout-"));
});

function setLedger(developerBalanceCents: number) {
  new Store(appdir).writeLedger({ developerBalanceCents, platformBalanceCents: developerBalanceCents, impressionCount: 1 });
}
function setAccount(a: Partial<PayoutAccount>) {
  const devicePubKey = deriveDeviceKey(SALT).publicKeyHex;
  new Store(appdir).writePayoutAccount({ devicePubKey, kycStatus: "unverified", alreadyPaidCents: 0, ...a });
}

describe("runPayout", () => {
  it("defaults to unverified with no payout account and tells the dev to verify", () => {
    setLedger(5000);
    const out = runPayout({ appDir: appdir, salt: SALT });
    expect(out.payableCents).toBe(5000);
    expect(out.kycStatus).toBe("unverified");
    expect(out.eligible).toBe(false);
    expect(out.nextStep).toMatch(/verify your identity/i);
  });

  it("is eligible once KYC is verified, an account is connected, and the balance clears the floor", () => {
    setLedger(5000);
    setAccount({ kycStatus: "verified", connectAccountId: "acct_1" });
    const out = runPayout({ appDir: appdir, salt: SALT });
    expect(out.eligible).toBe(true);
    expect(out.connected).toBe(true);
    expect(out.nextStep).toMatch(/withdraw 5000c/i);
  });

  it("subtracts already-paid amounts from the payable balance", () => {
    setLedger(5000);
    setAccount({ kycStatus: "verified", connectAccountId: "acct_1", alreadyPaidCents: 4500 });
    const out = runPayout({ appDir: appdir, salt: SALT });
    expect(out.payableCents).toBe(500);
    expect(out.eligible).toBe(false); // below the 1000c floor
    expect(out.nextStep).toMatch(/minimum payout/i);
  });

  it("never crashes on a malformed payout file (safe degraded report)", () => {
    setLedger(5000);
    writeFileSync(join(appdir, "payout.json"), "{ not json");
    const out = runPayout({ appDir: appdir, salt: SALT });
    expect(out.exitCode).toBe(0);
    expect(out.kycStatus).toBe("unverified");
  });
});
