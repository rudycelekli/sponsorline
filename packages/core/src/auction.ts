import { makeRng } from "./prng.js";
import { evalPredicate, type TargetPredicate } from "./targeting.js";

export interface Bidder {
  id: string;
  bidCents: number; // integer cents
  targetSignals: string[]; // legacy: matches if ANY signal intersects the vector
  creative: string;
  target?: TargetPredicate; // precise boolean targeting; takes precedence over targetSignals
}

export interface AuctionResult {
  winnerId: string | null;
  winningCreative: string | null;
  clearingPriceCents: number; // integer
  outcomeHashInput: string; // canonical string fed to the witness seal
}

function eligible(b: Bidder, signals: string[]): boolean {
  const set = new Set(signals);
  // A precise predicate, when present, takes precedence; otherwise fall back to the
  // legacy ANY-intersection over targetSignals so v0.1/v0.2 campaigns are unchanged.
  if (b.target) return evalPredicate(b.target, set);
  return b.targetSignals.some((s) => set.has(s));
}

export function runAuction(
  bidders: Bidder[],
  signals: string[],
  seed: bigint,
  reserveCents: number,
): AuctionResult {
  const pool = bidders.filter((b) => eligible(b, signals) && b.bidCents >= reserveCents);

  if (pool.length === 0) {
    return {
      winnerId: null,
      winningCreative: null,
      clearingPriceCents: 0,
      outcomeHashInput: canonical(signals, seed, null, 0),
    };
  }

  // Sort by bid desc, then by deterministic shuffled order for ties.
  const rng = makeRng(seed);
  const tagged = pool.map((b) => ({ b, r: rng.nextU32() }));
  tagged.sort((p, q) => q.b.bidCents - p.b.bidCents || p.r - q.r || (p.b.id < q.b.id ? -1 : 1));

  const winner = tagged[0].b;
  const secondCents = tagged.length > 1 ? tagged[1].b.bidCents : reserveCents;
  const clearing = Math.min(winner.bidCents, Math.max(secondCents, reserveCents));

  return {
    winnerId: winner.id,
    winningCreative: winner.creative,
    clearingPriceCents: clearing,
    outcomeHashInput: canonical(signals, seed, winner.id, clearing),
  };
}

function canonical(
  signals: string[],
  seed: bigint,
  winnerId: string | null,
  clearingCents: number,
): string {
  return JSON.stringify({
    v: 1,
    signals: [...signals].sort(),
    seed: seed.toString(),
    winnerId,
    clearingCents,
  });
}
