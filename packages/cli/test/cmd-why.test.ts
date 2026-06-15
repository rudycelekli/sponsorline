import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent, makeImpression, type Bidder } from "@effinai/sponsorline-core";
import { Store } from "../src/store.js";
import { runWhy } from "../src/cmd-why.js";

let appdir: string;
const SALT = "why-salt";
const inv: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
];

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-why-"));
  writeFileSync(join(appdir, "salt"), SALT);
});

describe("why", () => {
  it("explains the last impression (signals, winner, price, consent, seal)", async () => {
    const key = deriveDeviceKey(SALT);
    const store = new Store(appdir);
    const consent = createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 });
    store.writeConsent(consent);
    store.appendWitness(makeImpression({
      bidders: inv, signals: ["lang:ts"], seed: 1n, reserveCents: 100,
      consentId: consent.payload.id, key, now: 1, prevHash: store.readWitnessTailHash(),
    }));
    const out = await runWhy({ appDir: appdir });
    expect(out.exitCode).toBe(0);
    expect(out.explanation).toContain("lang:ts");
    expect(out.explanation).toContain("Winner: b");
    expect(out.explanation).toContain("Clearing price: 300c");
  });

  it("returns exit 2 (not a crash) when there are no impressions", async () => {
    const out = await runWhy({ appDir: appdir });
    expect(out.exitCode).toBe(2);
    expect(out.explanation).toBeNull();
  });

  it("returns exit 2 (never throws) on a malformed witness log", async () => {
    writeFileSync(join(appdir, "witness.jsonl"), '{"truncated json\n');
    const out = await runWhy({ appDir: appdir });
    expect(out.exitCode).toBe(2);
    expect(out.explanation).toBeNull();
  });
});
