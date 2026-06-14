import { verifyReceipt, type Receipt } from "./receipt.js";

// Marketer-facing reach report, built purely from signed device receipts. The
// platform (or the marketer) ingests receipts, throws out anything that fails its
// seal, deduplicates per device+epoch so a resubmission cannot inflate numbers, and
// rolls the survivors up per campaign. "Reach" is the count of DISTINCT signed
// devices — the honest "your brand was in front of N people" — never a guess.

export interface CampaignReport {
  campaignId: string;
  reachDevices: number; // distinct device public keys that showed this campaign
  impressions: number; // total renders across all devices
  spentCents: number; // total cleared spend across all devices
  firstTs: number;
  lastTs: number;
}

export interface MarketerReport {
  campaigns: CampaignReport[];
  acceptedReceipts: number;
  rejectedReceipts: number;
}

interface Accum {
  devices: Set<string>;
  impressions: number;
  spentCents: number;
  firstTs: number;
  lastTs: number;
}

export function aggregateReceipts(receipts: Receipt[]): MarketerReport {
  // Dedupe by device+epoch first: a device submitting the same period twice must not
  // double-count. First valid receipt for a (pubkey, epoch) pair wins.
  const seen = new Set<string>();
  let accepted = 0;
  let rejected = 0;
  const byCampaign = new Map<string, Accum>();

  for (const r of receipts) {
    if (!verifyReceipt(r).ok) {
      rejected++;
      continue;
    }
    const dedupeKey = `${r.payload.devicePubKey}:${r.payload.epoch}`;
    if (seen.has(dedupeKey)) continue; // silent dupe — already represented, not an error
    seen.add(dedupeKey);
    accepted++;

    for (const row of r.payload.rows) {
      const acc = byCampaign.get(row.campaignId);
      if (acc) {
        acc.devices.add(r.payload.devicePubKey);
        acc.impressions += row.impressions;
        acc.spentCents += row.spentCents;
        acc.firstTs = Math.min(acc.firstTs, row.firstTs);
        acc.lastTs = Math.max(acc.lastTs, row.lastTs);
      } else {
        byCampaign.set(row.campaignId, {
          devices: new Set([r.payload.devicePubKey]),
          impressions: row.impressions,
          spentCents: row.spentCents,
          firstTs: row.firstTs,
          lastTs: row.lastTs,
        });
      }
    }
  }

  const campaigns: CampaignReport[] = [...byCampaign.entries()]
    .map(([campaignId, a]) => ({
      campaignId,
      reachDevices: a.devices.size,
      impressions: a.impressions,
      spentCents: a.spentCents,
      firstTs: a.firstTs,
      lastTs: a.lastTs,
    }))
    .sort((x, y) => (x.campaignId < y.campaignId ? -1 : 1));

  return { campaigns, acceptedReceipts: accepted, rejectedReceipts: rejected };
}
