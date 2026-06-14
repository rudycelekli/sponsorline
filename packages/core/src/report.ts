import { verifyReceipt, type Receipt } from "./receipt.js";
import { screenReceipts, type AntiFraudPolicy } from "./antifraud.js";

// Marketer-facing reach report, built purely from signed device receipts. The
// platform (or the marketer) ingests receipts, throws out anything that fails its
// seal, deduplicates per device+epoch so a resubmission cannot inflate numbers, and
// rolls the survivors up per campaign. "Reach" is the count of DISTINCT signed
// devices — the honest "your brand was in front of N people" — never a guess.
//
// When an AntiFraudPolicy is supplied, receipts are screened FIRST: anything that is
// physically impossible (volume over the per-device ceiling), over the spend cap, or
// out of the epoch window is withheld before aggregation. This keeps fabricated reach
// out of the numbers a marketer pays against. The count of withheld receipts is
// surfaced as flaggedReceipts so the screening is auditable, never silent.

// k-anonymity / supply floor. Below this many distinct contributing devices a
// per-campaign "reach" number is both deanonymizing (it can point at a near-unique
// device population) and statistically meaningless. It is the same floor the DP
// engine enforces for aggregate release; the marketer reach report uses it so a
// cold-start campaign with thin inventory can never be presented as a deliverable.
export const SUPPLY_FLOOR_DEVICES = 200;

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
  rejectedReceipts: number; // failed the seal check (tampered / forged)
  flaggedReceipts: number; // sealed but withheld by anti-fraud screening (0 when no policy)
  suppressedCampaigns: number; // withheld for not meeting the k-anon supply floor (0 when no floor)
}

export interface ReportOptions {
  // Minimum distinct devices a campaign must reach before it appears in a report.
  // A campaign below this floor is withheld from `campaigns` and counted in
  // `suppressedCampaigns` instead, so thin/empty inventory can never be paid against.
  // Default 0 = no floor; the platform boundary sets the real floor (SUPPLY_FLOOR_DEVICES).
  minReachDevices?: number;
}

interface Accum {
  devices: Set<string>;
  impressions: number;
  spentCents: number;
  firstTs: number;
  lastTs: number;
}

export function aggregateReceipts(
  receipts: Receipt[],
  policy?: AntiFraudPolicy,
  opts: ReportOptions = {},
): MarketerReport {
  // Optional anti-fraud gate: withhold implausible receipts before they can influence
  // reach or spend. We keep two failure modes distinct: a broken/forged seal is a
  // REJECT (counted below in the aggregation loop, so the numbers match the no-policy
  // path), while a sealed-but-implausible receipt is a FLAG. To do that we only screen
  // receipts that already pass their seal, leaving seal failures to the loop's reject
  // counter.
  let flagged = 0;
  let pool = receipts;
  if (policy) {
    const sealOk: Receipt[] = [];
    const sealBad: Receipt[] = [];
    for (const r of receipts) (verifyReceipt(r).ok ? sealOk : sealBad).push(r);
    const screened = screenReceipts(sealOk, policy);
    flagged = screened.flagged.length;
    // Re-attach seal-failed receipts so the loop below still counts them as rejected.
    pool = [...screened.clean, ...sealBad];
  }

  // Dedupe by device+epoch first: a device submitting the same period twice must not
  // double-count. First valid receipt for a (pubkey, epoch) pair wins.
  const seen = new Set<string>();
  let accepted = 0;
  let rejected = 0;
  const byCampaign = new Map<string, Accum>();

  for (const r of pool) {
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

  const allCampaigns: CampaignReport[] = [...byCampaign.entries()]
    .map(([campaignId, a]) => ({
      campaignId,
      reachDevices: a.devices.size,
      impressions: a.impressions,
      spentCents: a.spentCents,
      firstTs: a.firstTs,
      lastTs: a.lastTs,
    }))
    .sort((x, y) => (x.campaignId < y.campaignId ? -1 : 1));

  // k-anon supply floor: a campaign that did not reach enough distinct devices is
  // withheld (not paid against) and counted, never presented as a thin "result".
  const floor = opts.minReachDevices ?? 0;
  const campaigns = allCampaigns.filter((c) => c.reachDevices >= floor);
  const suppressedCampaigns = allCampaigns.length - campaigns.length;

  return {
    campaigns,
    acceptedReceipts: accepted,
    rejectedReceipts: rejected,
    flaggedReceipts: flagged,
    suppressedCampaigns,
  };
}
