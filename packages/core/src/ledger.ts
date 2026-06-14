export class Ledger {
  developerBalanceCents = 0;
  platformBalanceCents = 0;
  impressionCount = 0;

  accrue(clearingPriceCents: number): void {
    if (!Number.isInteger(clearingPriceCents) || clearingPriceCents < 0) {
      throw new Error("clearingPriceCents must be a non-negative integer");
    }
    const dev = Math.floor(clearingPriceCents / 2);
    this.developerBalanceCents += dev;
    this.platformBalanceCents += clearingPriceCents - dev;
    this.impressionCount++;
  }

  // Stubs for the live marketplace (ADR §6) — designed in, built in v0.3.
  settle(): never {
    throw new Error("settle() is a v0.3 payments feature; not enabled in v0.1");
  }
  payout(): never {
    throw new Error("payout() is a v0.3 payments feature; not enabled in v0.1");
  }
}

export interface ReconcileResult {
  ok: boolean;
  errorCents: number;
}

export function reconcile(ledger: Ledger, clearingPrices: number[]): ReconcileResult {
  if (clearingPrices.length !== ledger.impressionCount) {
    return { ok: false, errorCents: -1 };
  }
  const expectedDev = clearingPrices.reduce((acc, c) => acc + Math.floor(c / 2), 0);
  const errorCents = Math.abs(ledger.developerBalanceCents - expectedDev);
  return { ok: errorCents === 0, errorCents };
}
