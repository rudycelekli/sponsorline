import { Store } from "./store.js";

export interface WhyInput { appDir: string; }
export interface WhyOutput { exitCode: 0 | 2; explanation: string | null; }

export async function runWhy(input: WhyInput): Promise<WhyOutput> {
  const store = new Store(input.appDir);
  // A corrupted/truncated witness log must not crash `why` — same robustness
  // contract as `verify` (R10). No explainable impression → exit 2, no throw.
  let log;
  try { log = store.readWitness(); }
  catch { return { exitCode: 2, explanation: null }; }
  if (log.length === 0) return { exitCode: 2, explanation: null };
  const last = log[log.length - 1];
  const p = last.payload;
  const explanation = [
    `Signals used: ${p.signals.join(", ")}`,
    `Winner: ${p.winnerId} ("${p.winningCreative}")`,
    `Clearing price: ${p.clearingPriceCents}c`,
    `Consent: ${p.consentId}`,
    `Seal: ${last.sig.slice(0, 16)}…`,
  ].join("\n");
  return { exitCode: 0, explanation };
}
