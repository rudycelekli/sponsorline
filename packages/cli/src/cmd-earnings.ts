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
  const log = store.readWitness();
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
