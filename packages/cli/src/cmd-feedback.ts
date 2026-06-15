import { SolverBandit } from "@effinai/sponsorline-core";
import { Store } from "./store.js";

export interface FeedbackInput {
  appDir: string;
  verdict: string;
  // Only affects sampling in rank(), never update() — feedback is seed-independent.
  seed?: bigint;
}
export interface FeedbackOutput {
  exitCode: number;
  applied: boolean;
  advertiserId: string | null;
  bucket: string | null;
  message: string;
}

// Closes the relevance reward loop entirely on-device. The reward is an explicit
// developer action (good/bad), never inferred. It updates only bandit.json, which
// shapes which ads win locally and is never witness-logged, signed, or exported.
// No witness lock: bandit state is advisory learning data independent of the hash
// chain, so a lost concurrent increment is recoverable and never an integrity issue.
export async function runFeedback(input: FeedbackInput): Promise<FeedbackOutput> {
  const verdict = input.verdict;
  if (verdict !== "good" && verdict !== "bad") {
    return {
      exitCode: 2,
      applied: false,
      advertiserId: null,
      bucket: null,
      message: "Usage: sponsorline feedback <good|bad>",
    };
  }

  const store = new Store(input.appDir);
  const render = store.readRenderState();
  // No render state, or a v0.1 state lacking attribution → nothing to score. Never throw.
  if (!render || !render.lastAdvertiserId || !render.lastBucket) {
    return {
      exitCode: 0,
      applied: false,
      advertiserId: null,
      bucket: null,
      message: "No sponsor line has been shown yet — nothing to give feedback on.",
    };
  }

  // bandit.json is advisory learning data, not integrity-critical. A torn or
  // hand-edited file must not crash the command (same robustness contract as
  // off/why/earnings/init): self-heal from empty state and re-persist.
  let prior: Record<string, Record<string, { alpha: number; beta: number }>>;
  try { prior = store.readBandit(); } catch { prior = {}; }
  const bandit = SolverBandit.fromJSON(input.seed ?? 0n, prior);
  bandit.update(render.lastBucket, render.lastAdvertiserId, verdict === "good");
  store.writeBandit(bandit.toJSON());

  return {
    exitCode: 0,
    applied: true,
    advertiserId: render.lastAdvertiserId,
    bucket: render.lastBucket,
    message: `Recorded '${verdict}' for ${render.lastAdvertiserId} in ${render.lastBucket}.`,
  };
}
