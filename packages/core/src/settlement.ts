import { seal, verifySeal, chainHash, type DeviceKey, type Sealed } from "./crypto.js";

// The public, verifiable settlement ledger. It is the answer to "can a developer
// trust their earnings are real?" without trusting the operator's word.
//
// The operator (platform) appends two kinds of signed entry to an append-only,
// hash-chained log: a `fund` when an advertiser funds a campaign, and a `payout`
// when a developer is paid against a specific device receipt. The log is sealed
// with the PLATFORM key (not a device key) and chained exactly like the witness
// log: a single signature over the HEAD payload transitively authenticates the
// whole history, so verification is O(n) cheap hashing + ONE Ed25519 check.
//
// This module does NOT move money — that lives in the private backend. It makes
// the movement auditable. Anyone holding the published log can confirm:
//   1. authenticity   — nothing was inserted, edited, or reordered;
//   2. conservation   — per campaign, money out never exceeds money in (this is
//                       the real provenance check, not a tautology over self-
//                       asserted prices);
//   3. no double-claim — each device receipt backs at most one payout.
//
// Combined with verifyReceipt (the device authentically produced the reach), a
// stranger gets: authentic reach + authentic payment + conservation + no double
// pay, with no trust in the operator beyond "they published this log".

export const SETTLEMENT_SCHEMA_VERSION = 1 as const;

// A campaign was funded by an advertiser. `fundingRef` is the funding attestation
// that maps this on-ledger entry back to its real-world source (e.g. a Stripe
// charge id, or later a Solana funding tx), so the chain card-charge -> funded
// campaign -> dev payout is auditable across the fiat boundary.
export interface FundEntry {
  kind: "fund";
  campaignId: string;
  amountCents: number;
  fundingRef: string;
}

// A developer was paid. `receiptHash` binds the payout to one specific device
// receipt (the chainHash of that receipt's payload), which is what makes the
// double-claim guard possible. `payoutRef` is the money-out gateway reference.
export interface PayoutEntry {
  kind: "payout";
  campaignId: string;
  devicePubKey: string;
  amountCents: number;
  receiptHash: string;
  payoutRef: string;
}

export type SettlementBody = FundEntry | PayoutEntry;

export interface SettlementPayload {
  v: typeof SETTLEMENT_SCHEMA_VERSION;
  platformPubKey: string; // self-describing trust anchor: the seal is checked against this
  ts: number;
  prevHash: string; // chainHash of the previous payload ("" for genesis) — links the log
  body: SettlementBody;
}

export type SettlementEntry = Sealed<SettlementPayload>;

export interface AppendInput {
  log: SettlementEntry[];
  key: DeviceKey; // the platform key
  body: SettlementBody;
  now?: number;
}

// Append a signed, chained entry to the ledger. Returns the new entry; the caller
// concatenates it onto the log. The prevHash is taken from the current head, so
// the chain stays intact.
export function appendSettlement(input: AppendInput): SettlementEntry {
  const prevHash = input.log.length === 0 ? "" : chainHash(input.log[input.log.length - 1].payload);
  const payload: SettlementPayload = {
    v: SETTLEMENT_SCHEMA_VERSION,
    platformPubKey: input.key.publicKeyHex,
    ts: input.now ?? 0,
    prevHash,
    body: input.body,
  };
  return seal(payload, input.key);
}

export interface CampaignSettlement {
  fundedCents: number;
  paidCents: number;
}

export interface SettlementVerifyResult {
  ok: boolean;
  entries: number;
  // Per-campaign funded vs paid totals, populated as far as verification got.
  byCampaign: Record<string, CampaignSettlement>;
  reason?:
    | "seal-invalid"
    | "chain-broken"
    | "platform-key-mismatch"
    | "malformed"
    | "overspend" // a campaign paid out more than it was funded
    | "double-claim"; // a receipt backed more than one payout
  failedIndex?: number;
}

function isNonNegInt(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function nonEmptyString(s: unknown): boolean {
  return typeof s === "string" && s.length > 0;
}

// Stranger-checkable end to end. Authenticate the head with the single platform
// signature, walk the hash chain (any tamper breaks a link), and enforce the
// economic invariants as we go: conservation per campaign and one-payout-per
// receipt. Returns per-campaign totals so callers can display the proof.
export function verifySettlementLog(
  log: SettlementEntry[],
  platformPubKey: string,
): SettlementVerifyResult {
  const byCampaign: Record<string, CampaignSettlement> = {};
  if (log.length === 0) return { ok: true, entries: 0, byCampaign };

  // 1. Authenticate the HEAD with the single platform signature.
  const head = log[log.length - 1];
  if (!verifySeal(head, platformPubKey)) {
    return { ok: false, entries: 0, byCampaign, reason: "seal-invalid", failedIndex: log.length - 1 };
  }

  const seenReceipts = new Set<string>();
  let prev = "";
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    const p = entry.payload;

    // The head's prevHash is signed, so a matching chain transitively
    // authenticates every payload. Pin each entry to the verified platform key.
    if (p.platformPubKey !== platformPubKey) {
      return { ...fail(byCampaign, "platform-key-mismatch", i) };
    }
    if (p.prevHash !== prev) {
      return { ...fail(byCampaign, "chain-broken", i) };
    }

    const body = p.body;
    if (body.kind === "fund") {
      if (!nonEmptyString(body.campaignId) || !isNonNegInt(body.amountCents) || !nonEmptyString(body.fundingRef)) {
        return { ...fail(byCampaign, "malformed", i) };
      }
      const c = (byCampaign[body.campaignId] ??= { fundedCents: 0, paidCents: 0 });
      c.fundedCents += body.amountCents;
    } else if (body.kind === "payout") {
      if (
        !nonEmptyString(body.campaignId) ||
        !nonEmptyString(body.devicePubKey) ||
        !isNonNegInt(body.amountCents) ||
        !nonEmptyString(body.receiptHash) ||
        !nonEmptyString(body.payoutRef)
      ) {
        return { ...fail(byCampaign, "malformed", i) };
      }
      // No double-claim: a given receipt may back at most one payout.
      if (seenReceipts.has(body.receiptHash)) {
        return { ...fail(byCampaign, "double-claim", i) };
      }
      seenReceipts.add(body.receiptHash);
      const c = (byCampaign[body.campaignId] ??= { fundedCents: 0, paidCents: 0 });
      c.paidCents += body.amountCents;
      // Conservation: you cannot pay out more than was funded for a campaign.
      if (c.paidCents > c.fundedCents) {
        return { ...fail(byCampaign, "overspend", i) };
      }
    } else {
      return { ...fail(byCampaign, "malformed", i) };
    }

    prev = chainHash(p);
  }

  return { ok: true, entries: log.length, byCampaign };
}

function fail(
  byCampaign: Record<string, CampaignSettlement>,
  reason: NonNullable<SettlementVerifyResult["reason"]>,
  failedIndex: number,
): SettlementVerifyResult {
  return { ok: false, entries: failedIndex, byCampaign, reason, failedIndex };
}
