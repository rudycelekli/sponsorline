import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deriveDeviceKey, verifyLog, validateConsent } from "@sponsorline/core";
import { Store } from "./store.js";

export interface VerifyInput { appDir: string; now: number; }
export interface VerifyReport {
  ok: boolean;
  replayedAuctions: number;
  reason?: string;
  failedIndex?: number;
}
export interface VerifyOutput { exitCode: 0 | 1 | 2; report: VerifyReport; }

export async function runVerify(input: VerifyInput): Promise<VerifyOutput> {
  const saltPath = join(input.appDir, "salt");
  const store = new Store(input.appDir);
  const consent = store.readConsent();
  if (!existsSync(saltPath) || !consent) {
    return { exitCode: 2, report: { ok: false, replayedAuctions: 0, reason: "precondition: missing salt or consent" } };
  }
  const key = deriveDeviceKey(readFileSync(saltPath, "utf8"));
  const cv = validateConsent(consent, { publicKeyHex: key.publicKeyHex, now: input.now });
  if (!cv.valid && cv.reason === "signature") {
    return { exitCode: 1, report: { ok: false, replayedAuctions: 0, reason: "consent signature invalid" } };
  }

  const log = store.readWitness();
  const res = verifyLog(log, { publicKeyHex: key.publicKeyHex });
  if (res.ok) return { exitCode: 0, report: res };
  return { exitCode: 1, report: res };
}
