import { verifyReceipt, type Receipt } from "./receipt.js";

// Anti-sybil / abuse screening for reach receipts. This is the gate that must sit in
// front of any payout so the seeding budget funds real developers, not bot farms.
//
// What this layer CAN prove cheaply and honestly:
//   - Authenticity: the receipt is sealed by the device that claims it (verifyReceipt).
//   - Physical plausibility: the device serves at most ONE billable impression per
//     rotation window (15 min), so a one-day epoch can hold at most 96 impressions.
//     A receipt claiming more is provably fabricated, regardless of how it was signed.
//   - Payout safety: a per-device, per-epoch spend ceiling caps blast radius.
//   - Freshness: receipts must be for the current epoch window, not future or stale.
//
// What it deliberately does NOT claim to solve: proof of a UNIQUE HUMAN. An attacker
// can still mint many key pairs, each producing a plausible low-volume receipt. That
// final unique-identity gate belongs at payout-time KYC (Stripe Connect identity),
// not here. Screening raises the cost of farming; KYC closes it.

export interface AntiFraudPolicy {
  maxImpressionsPerEpoch: number; // physical ceiling per device per epoch
  maxSpentCentsPerEpoch: number; // payout-safety spend cap per device per epoch
  currentEpoch?: number; // when set, reject future epochs and anything older than maxEpochAge
  maxEpochAge?: number; // how many epochs back are still acceptable (default 1)
}

// Default day-epoch policy: 24h / 15-min rotation = 96 impressions is the hard
// physical maximum. The spend cap is a generous runaway backstop, not a billing rule.
export const DEFAULT_ANTIFRAUD_POLICY: AntiFraudPolicy = {
  maxImpressionsPerEpoch: 96,
  maxSpentCentsPerEpoch: 100_000,
};

export interface ScreenFlag {
  devicePubKey: string;
  epoch: number;
  reason: string;
}

export interface ScreenResult {
  clean: Receipt[]; // receipts that passed every check — safe to aggregate / pay out
  flagged: ScreenFlag[]; // receipts withheld, with the reason they were withheld
}

export function screenReceipts(receipts: Receipt[], policy: AntiFraudPolicy): ScreenResult {
  const clean: Receipt[] = [];
  const flagged: ScreenFlag[] = [];
  const maxAge = policy.maxEpochAge ?? 1;

  for (const r of receipts) {
    const devicePubKey = r.payload?.devicePubKey ?? "unknown";
    const epoch = r.payload?.epoch ?? -1;
    const flag = (reason: string) => flagged.push({ devicePubKey, epoch, reason });

    if (!verifyReceipt(r).ok) {
      flag("seal invalid");
      continue;
    }

    if (policy.currentEpoch !== undefined) {
      if (epoch > policy.currentEpoch) {
        flag(`epoch ${epoch} is in the future (current ${policy.currentEpoch})`);
        continue;
      }
      if (epoch < policy.currentEpoch - maxAge) {
        flag(`epoch ${epoch} is stale (older than ${maxAge} epoch(s) before ${policy.currentEpoch})`);
        continue;
      }
    }

    const totalImpr = r.payload.rows.reduce((s, row) => s + row.impressions, 0);
    if (totalImpr > policy.maxImpressionsPerEpoch) {
      flag(`${totalImpr} impressions exceeds the physical ceiling of ${policy.maxImpressionsPerEpoch}/epoch`);
      continue;
    }

    const totalSpent = r.payload.rows.reduce((s, row) => s + row.spentCents, 0);
    if (totalSpent > policy.maxSpentCentsPerEpoch) {
      flag(`${totalSpent}c spend exceeds the per-device cap of ${policy.maxSpentCentsPerEpoch}c/epoch`);
      continue;
    }

    clean.push(r);
  }

  return { clean, flagged };
}
