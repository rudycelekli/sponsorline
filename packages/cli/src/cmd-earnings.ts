import { reconcile, Ledger } from "@sponsorline/core";
import { Store } from "./store.js";

export interface EarningsInput { appDir: string; }
export interface EarningsOutput {
  exitCode: 0;
  developerBalanceCents: number;
  impressionCount: number;
  reconciled: boolean;
}

export async function runEarnings(input: EarningsInput): Promise<EarningsOutput> {
  const store = new Store(input.appDir);
  const state = store.readLedger();
  // A corrupt/truncated witness log must not crash earnings (R10/R17 contract);
  // it is also surfaced through the MCP earnings_summary tool. If the proof log
  // is unreadable, report the recorded ledger balance but honestly mark it
  // unreconciled — you cannot reconcile earnings against a log you cannot read.
  let log;
  try { log = store.readWitness(); }
  catch {
    return { exitCode: 0, developerBalanceCents: state.developerBalanceCents, impressionCount: state.impressionCount, reconciled: false };
  }
  const ledger = new Ledger();
  ledger.developerBalanceCents = state.developerBalanceCents;
  ledger.platformBalanceCents = state.platformBalanceCents;
  ledger.impressionCount = state.impressionCount;
  const r = reconcile(ledger, log.map((i) => i.payload.clearingPriceCents));
  return {
    exitCode: 0,
    developerBalanceCents: state.developerBalanceCents,
    impressionCount: state.impressionCount,
    reconciled: r.ok,
  };
}
