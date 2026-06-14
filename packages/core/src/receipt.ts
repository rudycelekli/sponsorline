import { seal, verifySeal, type DeviceKey, type Sealed } from "./crypto.js";
import type { Impression } from "./witness.js";

// A per-device reach receipt: the OPT-IN egress artifact. The device folds its own
// signed witness log down to per-campaign counts — impressions, spend, and a coarse
// time span — then seals the summary with the device key. It carries NO signals and
// NO code context, only which campaigns were shown and how often. This is what lets a
// marketer learn "your brand reached this many signed devices" without anything raw
// ever leaving the machine, and without trusting the platform: the seal proves the
// receipt came from the device that holds the matching private key.

export const RECEIPT_SCHEMA_VERSION = 1 as const;

export interface CampaignReachRow {
  campaignId: string; // the winning campaign/bidder id from the impression
  impressions: number; // count of impressions this device rendered for the campaign
  spentCents: number; // sum of clearing prices actually charged for those impressions
  firstTs: number; // earliest impression timestamp
  lastTs: number; // latest impression timestamp
}

export interface ReceiptPayload {
  v: typeof RECEIPT_SCHEMA_VERSION;
  devicePubKey: string; // self-describing trust anchor: the seal is checked against this
  epoch: number; // coarse reporting period this receipt covers
  rows: CampaignReachRow[];
}

export type Receipt = Sealed<ReceiptPayload>;

export interface BuildReceiptInput {
  log: Impression[];
  key: DeviceKey;
  epoch: number;
}

export function buildReceipt(input: BuildReceiptInput): Receipt {
  const byCampaign = new Map<string, CampaignReachRow>();
  for (const entry of input.log) {
    const id = entry.payload.winnerId;
    if (id === null) continue; // no winner → nothing was shown, nothing to report
    const ts = entry.payload.ts;
    const existing = byCampaign.get(id);
    if (existing) {
      existing.impressions += 1;
      existing.spentCents += entry.payload.clearingPriceCents;
      existing.firstTs = Math.min(existing.firstTs, ts);
      existing.lastTs = Math.max(existing.lastTs, ts);
    } else {
      byCampaign.set(id, {
        campaignId: id,
        impressions: 1,
        spentCents: entry.payload.clearingPriceCents,
        firstTs: ts,
        lastTs: ts,
      });
    }
  }
  const rows = [...byCampaign.values()].sort((a, b) => (a.campaignId < b.campaignId ? -1 : 1));
  const payload: ReceiptPayload = {
    v: RECEIPT_SCHEMA_VERSION,
    devicePubKey: input.key.publicKeyHex,
    epoch: input.epoch,
    rows,
  };
  return seal(payload, input.key);
}

export interface ReceiptValidation {
  ok: boolean;
  errors: string[];
}

// Stranger-checkable: anyone holding only the receipt can confirm it is authentic
// (sealed by the claimed device) and structurally sound. A swapped pubkey or any
// edited count breaks the seal, because the seal covers the entire payload.
export function verifyReceipt(r: Receipt): ReceiptValidation {
  const errors: string[] = [];
  if (!verifySeal(r, r.payload.devicePubKey)) {
    errors.push("seal invalid (signature does not match the claimed devicePubKey)");
    return { ok: false, errors };
  }
  for (const row of r.payload.rows) {
    if (typeof row.campaignId !== "string" || row.campaignId.length === 0) {
      errors.push("row has an empty campaignId");
    }
    const ints = [row.impressions, row.spentCents];
    if (ints.some((n) => !Number.isInteger(n) || n < 0)) {
      errors.push(`campaign '${row.campaignId}' has invalid (negative or non-integer) counts`);
    }
    if (row.firstTs > row.lastTs) {
      errors.push(`campaign '${row.campaignId}' has firstTs after lastTs`);
    }
  }
  return { ok: errors.length === 0, errors };
}
