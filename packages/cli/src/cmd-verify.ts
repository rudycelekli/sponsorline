import { verifyLog, validateConsent } from "@effinai/sponsorline-core";
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
  const store = new Store(input.appDir);
  // Verification uses only the PUBLISHED public key — never the salt (private-key
  // seed). A stranger can verify from a clean clone with no signing secret.
  const publicKeyHex = store.readPubKey();
  const consent = store.readConsent();
  if (!publicKeyHex || !consent) {
    return { exitCode: 2, report: { ok: false, replayedAuctions: 0, reason: "precondition: missing pubkey or consent" } };
  }
  const cv = validateConsent(consent, { publicKeyHex, now: input.now });
  if (!cv.valid && cv.reason === "signature") {
    return { exitCode: 1, report: { ok: false, replayedAuctions: 0, reason: "consent signature invalid" } };
  }

  // A corrupted/truncated witness log (partial write, disk fault, or tampering
  // by truncation) must FAIL verification cleanly — never crash the one command
  // a stranger runs to check the proof.
  let log;
  try {
    log = store.readWitness();
  } catch {
    return { exitCode: 1, report: { ok: false, replayedAuctions: 0, reason: "malformed witness log" } };
  }
  // Bind every impression to the signed consent (id, granted families, validity
  // window). A revoked/expired consent does NOT fail past impressions that were
  // logged while it was live — only signals or timestamps outside the consent do.
  const res = verifyLog(log, { publicKeyHex, consent });
  if (res.ok) return { exitCode: 0, report: res };
  return { exitCode: 1, report: res };
}
