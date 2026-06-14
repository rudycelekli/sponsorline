import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent, makeImpression, type Bidder } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runVerify } from "../src/cmd-verify.js";

let appdir: string;
const SALT = "verify-salt";
const inv: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
];

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-verify-"));
  writeFileSync(join(appdir, "salt"), SALT);
  const key = deriveDeviceKey(SALT);
  const store = new Store(appdir);
  store.writeConsent(createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 }));
  store.writeInventory(inv);
  // Append as the real statusline path does: each entry chains off the current head.
  store.appendWitness(makeImpression({ bidders: inv, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c", key, now: 1, prevHash: store.readWitnessTailHash() }));
  store.appendWitness(makeImpression({ bidders: inv, signals: ["lang:ts"], seed: 2n, reserveCents: 100, consentId: "c", key, now: 2, prevHash: store.readWitnessTailHash() }));
});

describe("verify", () => {
  it("returns exit 0 on a clean log", async () => {
    const r = await runVerify({ appDir: appdir, now: 10 });
    expect(r.exitCode).toBe(0);
    expect(r.report.replayedAuctions).toBe(2);
  });

  it("returns exit 1 when a witness entry is tampered", async () => {
    const wf = join(appdir, "witness.jsonl");
    const lines = readFileSync(wf, "utf8").split("\n").filter(Boolean);
    const first = JSON.parse(lines[0]);
    first.payload.clearingPriceCents = 99999;
    lines[0] = JSON.stringify(first);
    writeFileSync(wf, lines.join("\n") + "\n");
    const r = await runVerify({ appDir: appdir, now: 10 });
    expect(r.exitCode).toBe(1);
  });

  it("returns exit 2 when preconditions are missing (no consent)", async () => {
    const empty = mkdtempSync(join(tmpdir(), "sl-empty-"));
    const r = await runVerify({ appDir: empty, now: 10 });
    expect(r.exitCode).toBe(2);
  });
});
