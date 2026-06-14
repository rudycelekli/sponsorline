import { validatePredicate, type TargetPredicate } from "./targeting.js";
import type { Bidder } from "./auction.js";

// A marketer-facing campaign: richer than the raw auction Bidder. It carries the
// advertiser identity, a spend budget, and a flight window so a marketer can run a
// bounded, self-serve campaign that flows into the same deterministic auction the
// device already runs. Targeting stays inside the allowlisted taxonomy — a campaign
// can never name anything outside it, so it cannot be used to probe raw context.

export interface Campaign {
  id: string;
  advertiser: string; // marketer display identity (shown in reports, never to the dev)
  creative: string; // the sponsor line rendered on-device
  bidCents: number; // integer cents, must clear the reserve
  budgetCents: number; // integer cents, total spend cap across all impressions
  target?: TargetPredicate; // precise boolean targeting; takes precedence
  targetSignals?: string[]; // legacy ANY-intersection fallback
  startsAt: number; // inclusive flight start (ms epoch)
  endsAt: number; // exclusive flight end (ms epoch)
}

export interface CampaignPolicy {
  reserveCents: number;
  maxCreative: number;
}

export interface CampaignValidation {
  ok: boolean;
  errors: string[];
}

export function validateCampaign(c: Campaign, policy: CampaignPolicy): CampaignValidation {
  const errors: string[] = [];

  if (typeof c.id !== "string" || c.id.length === 0) errors.push("campaign id must be a non-empty string");
  if (typeof c.advertiser !== "string" || c.advertiser.length === 0) errors.push("advertiser must be a non-empty string");

  if (typeof c.creative !== "string") {
    errors.push("creative must be a string");
  } else {
    if (c.creative.length > policy.maxCreative) errors.push(`creative exceeds ${policy.maxCreative} chars`);
    // The creative is rendered straight into the terminal status line — reject control
    // characters so a campaign cannot inject newlines (breaking the one-line contract)
    // or ANSI escape sequences (terminal hijack). Same boundary as inventory submission.
    if (/[\u0000-\u001F\u007F]/.test(c.creative)) errors.push("creative contains control characters");
  }

  if (!Number.isInteger(c.bidCents) || c.bidCents < policy.reserveCents) {
    errors.push(`bidCents must be an integer >= reserve (${policy.reserveCents})`);
  }
  if (!Number.isInteger(c.budgetCents) || c.budgetCents < c.bidCents) {
    errors.push("budgetCents must be an integer >= bidCents (at least one impression of headroom)");
  }

  if (!Number.isFinite(c.startsAt) || !Number.isFinite(c.endsAt) || c.endsAt <= c.startsAt) {
    errors.push("flight window invalid: endsAt must be greater than startsAt");
  }

  const hasPredicate = c.target !== undefined;
  const hasLegacy = Array.isArray(c.targetSignals) && c.targetSignals.length > 0;
  if (!hasPredicate && !hasLegacy) {
    errors.push("campaign must specify a target predicate or non-empty targetSignals");
  }
  if (hasPredicate) {
    const v = validatePredicate(c.target as TargetPredicate);
    if (!v.ok) errors.push(`invalid target predicate: ${v.errors.join("; ")}`);
  }

  return { ok: errors.length === 0, errors };
}

// Project a campaign onto the auction's Bidder shape so it competes in the same
// deterministic Vickrey auction as any other inventory.
export function campaignToBidder(c: Campaign): Bidder {
  return {
    id: c.id,
    bidCents: c.bidCents,
    targetSignals: c.targetSignals ? [...c.targetSignals] : [],
    creative: c.creative,
    ...(c.target !== undefined ? { target: c.target } : {}),
  };
}

// A campaign is eligible to serve only inside its flight window and while it has
// budget left. spentCents is the campaign's reported spend so far (from receipts).
export function isCampaignLive(c: Campaign, now: number, spentCents: number): boolean {
  if (now < c.startsAt || now >= c.endsAt) return false;
  if (spentCents >= c.budgetCents) return false;
  return true;
}
