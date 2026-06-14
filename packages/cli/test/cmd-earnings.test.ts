import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent, makeImpression, type Bidder } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runEarnings } from "../src/cmd-earnings.js";

let appdir: string;
const SALT = "earn-salt";
const inv: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
];

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-earn-"));
  writeFileSync(join(appdir, "salt"), SALT);
});

describe("earnings", () => {
  it("reconciles the ledger against the witness log", async () => {
    const key = deriveDeviceKey(SALT);
    const store = new Store(appdir);
    const consent = createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 });
    store.writeConsent(consent);
    // One impression with clearing price 300c → 50/50 split → developer 150c.
    store.appendWitness(makeImpression({
      bidders: inv, signals: ["lang:ts"], seed: 1n, reserveCents: 100,
      consentId: consent.payload.id, key, now: 1, prevHash: store.readWitnessTailHash(),
    }));
    store.writeLedger({ developerBalanceCents: 150, platformBalanceCents: 150, impressionCount: 1 });
    const out = await runEarnings({ appDir: appdir });
    expect(out.exitCode).toBe(0);
    expect(out.impressionCount).toBe(1);
    expect(out.reconciled).toBe(true);
  });

  it("reports unreconciled (never throws) when the witness log is malformed", async () => {
    new Store(appdir).writeLedger({ developerBalanceCents: 150, platformBalanceCents: 150, impressionCount: 1 });
    writeFileSync(join(appdir, "witness.jsonl"), '{"truncated json\n');
    const out = await runEarnings({ appDir: appdir });
    expect(out.exitCode).toBe(0);
    expect(out.developerBalanceCents).toBe(150); // recorded balance still reported
    expect(out.reconciled).toBe(false); // but honestly flagged: proof log unreadable
  });
});
