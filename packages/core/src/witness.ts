import { runAuction, type Bidder } from "./auction.js";
import { seal, verifySeal, chainHash, type DeviceKey, type Sealed } from "./crypto.js";
import { isAllowlisted } from "./interest.js";

export interface ImpressionPayload {
  v: 1;
  ts: number;
  consentId: string;
  prevHash: string; // chainHash of the previous payload ("" for genesis) — links the log
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
  prevHash?: string; // chainHash of the prior entry; "" (default) for the genesis impression
}

export function makeImpression(input: MakeImpressionInput): Impression {
  const result = runAuction(input.bidders, input.signals, input.seed, input.reserveCents);
  const payload: ImpressionPayload = {
    v: 1,
    ts: input.now ?? 0,
    consentId: input.consentId,
    prevHash: input.prevHash ?? "",
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
  reason?: "seal-invalid" | "privacy-violation" | "replay-mismatch" | "chain-broken";
  failedIndex?: number;
}

// Verification cost is O(n) cheap hashing + replay plus exactly ONE Ed25519 check
// (the head). The hash chain makes the single head signature transitively vouch for
// every prior payload, so verify stays fast as the log grows to tens of thousands.
export function verifyLog(log: Impression[], opts: VerifyOpts): VerifyResult {
  if (log.length === 0) return { ok: true, replayedAuctions: 0 };

  // 1. Authenticate the HEAD with the single device signature.
  const head = log[log.length - 1];
  if (!verifySeal(head, opts.publicKeyHex)) {
    return { ok: false, replayedAuctions: 0, reason: "seal-invalid", failedIndex: log.length - 1 };
  }

  // 2. Walk the hash chain. The head's prevHash is signed, so a matching chain
  //    transitively authenticates every payload back to genesis. Any insert,
  //    delete, reorder, or edit of a non-head entry breaks a link here.
  let prev = "";
  let replayed = 0;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry.payload.prevHash !== prev) {
      return { ok: false, replayedAuctions: replayed, reason: "chain-broken", failedIndex: i };
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
    prev = chainHash(entry.payload);
    replayed++;
  }
  return { ok: true, replayedAuctions: replayed };
}
