import { runAuction, type Bidder } from "./auction.js";
import { seal, verifySeal, type DeviceKey, type Sealed } from "./crypto.js";
import { isAllowlisted } from "./interest.js";

export interface ImpressionPayload {
  v: 1;
  ts: number;
  consentId: string;
  signals: string[]; // the egress payload — MUST be allowlist-clean
  seed: string;
  reserveCents: number;
  winnerId: string | null;
  winningCreative: string | null;
  clearingPriceCents: number;
  bidders: Bidder[]; // full snapshot present at auction time — a self-contained Vickrey receipt
}

export type Impression = Sealed<ImpressionPayload>;

export interface MakeImpressionInput {
  bidders: Bidder[];
  signals: string[];
  seed: bigint;
  reserveCents: number;
  consentId: string;
  key: DeviceKey;
  now?: number;
}

export function makeImpression(input: MakeImpressionInput): Impression {
  const result = runAuction(input.bidders, input.signals, input.seed, input.reserveCents);
  const payload: ImpressionPayload = {
    v: 1,
    ts: input.now ?? 0,
    consentId: input.consentId,
    signals: [...input.signals].sort(),
    seed: input.seed.toString(),
    reserveCents: input.reserveCents,
    winnerId: result.winnerId,
    winningCreative: result.winningCreative,
    clearingPriceCents: result.clearingPriceCents,
    bidders: input.bidders.map((b) => ({
      id: b.id,
      bidCents: b.bidCents,
      targetSignals: [...b.targetSignals],
      creative: b.creative,
    })),
  };
  return seal(payload, input.key);
}

export interface VerifyOpts {
  publicKeyHex: string;
}

export interface VerifyResult {
  ok: boolean;
  replayedAuctions: number;
  reason?: "seal-invalid" | "privacy-violation" | "replay-mismatch";
  failedIndex?: number;
}

export function verifyLog(log: Impression[], opts: VerifyOpts): VerifyResult {
  let replayed = 0;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (!verifySeal(entry, opts.publicKeyHex)) {
      return { ok: false, replayedAuctions: replayed, reason: "seal-invalid", failedIndex: i };
    }
    for (const s of entry.payload.signals) {
      if (!isAllowlisted(s)) {
        return { ok: false, replayedAuctions: replayed, reason: "privacy-violation", failedIndex: i };
      }
    }
    // Intrinsic replay: re-run the auction from the SEALED snapshot, never from the
    // mutable live inventory. A settled impression is thus permanently self-verifying.
    const r = runAuction(
      entry.payload.bidders,
      entry.payload.signals,
      BigInt(entry.payload.seed),
      entry.payload.reserveCents,
    );
    if (
      r.winnerId !== entry.payload.winnerId ||
      r.clearingPriceCents !== entry.payload.clearingPriceCents ||
      r.winningCreative !== entry.payload.winningCreative
    ) {
      return { ok: false, replayedAuctions: replayed, reason: "replay-mismatch", failedIndex: i };
    }
    replayed++;
  }
  return { ok: true, replayedAuctions: replayed };
}
