import { deriveDeviceKey, buildReceipt, type Receipt } from "@sponsorline/core";
import { Store } from "./store.js";

// `sponsorline receipt` — the OPT-IN egress action. It folds this device's signed
// witness log into a per-campaign reach receipt and seals it. Nothing is sent
// anywhere: the command only PRODUCES the artifact (printed to stdout). The
// developer decides whether to hand it to a marketer/platform to claim payout.
// This is the single deliberate seam where aggregate counts can leave the device,
// and it carries no signals or code context — only campaign ids, counts, and spend.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface ReceiptInput {
  appDir: string;
  salt: string;
  now: number;
  epoch?: number; // override the coarse day-epoch (mainly for tests)
}

export interface ReceiptOutput {
  exitCode: number;
  receipt: Receipt;
}

export function runReceipt(input: ReceiptInput): ReceiptOutput {
  const store = new Store(input.appDir);
  const key = deriveDeviceKey(input.salt);
  const epoch = input.epoch ?? Math.floor(input.now / MS_PER_DAY);
  // readWitness already tolerates a missing log (returns []), so a device that has
  // never served an impression simply produces an empty, still-valid receipt.
  const receipt = buildReceipt({ log: store.readWitness(), key, epoch });
  return { exitCode: 0, receipt };
}
