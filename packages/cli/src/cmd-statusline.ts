import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInterestVector,
  runAuction,
  deriveDeviceKey,
  validateConsent,
  makeImpression,
  Ledger,
  SolverBandit,
  type Bidder,
} from "@sponsorline/core";
import { Store } from "./store.js";

const MANIFESTS = ["package.json", "tsconfig.json", "requirements.txt", "pyproject.toml", "cargo.toml", "go.mod"];
const RESERVE_CENTS = 100;
const DEFAULT_ROTATE_MS = 1000 * 60 * 15; // one billable impression per 15-min window

export interface StatuslineInput {
  appDir: string;
  salt: string;
  stdin: string;
  now: number;
  seed: bigint;
  rotateMs?: number;
}
export interface StatuslineOutput { line: string; exitCode: number; }

function plainLine(model: string): string {
  return `${model}`.trim() || "Claude";
}

function sponsorLine(model: string, creative: string): string {
  return `${model} · Sponsored: ${creative}`;
}

export async function runStatusline(input: StatuslineInput): Promise<StatuslineOutput> {
  let modelName = "Claude";
  try {
    const ctx = JSON.parse(input.stdin) as { workspace?: { current_dir?: string }; model?: { display_name?: string } };
    modelName = ctx.model?.display_name ?? "Claude";
    const cwd = ctx.workspace?.current_dir;
    if (!cwd) return { line: plainLine(modelName), exitCode: 0 };

    const store = new Store(input.appDir);
    const consent = store.readConsent();
    if (!consent) return { line: plainLine(modelName), exitCode: 0 };

    const key = deriveDeviceKey(input.salt);
    const cv = validateConsent(consent, { publicKeyHex: key.publicKeyHex, now: input.now });
    if (!cv.valid) return { line: plainLine(modelName), exitCode: 0 };

    // Rotation cap: at most ONE billable impression per window. Between windows,
    // re-display the cached creative (re-composed with the CURRENT model name) and
    // log NOTHING — this keeps the witness log bounded and the ledger billing-honest.
    const rotateMs = input.rotateMs ?? DEFAULT_ROTATE_MS;
    const render = store.readRenderState();
    if (render && input.now - render.lastImpressionAt < rotateMs) {
      return { line: sponsorLine(modelName, render.lastCreative), exitCode: 0 };
    }

    const present = new Set(readdirSync(cwd));
    const manifests = MANIFESTS.filter((m) => present.has(m));
    const manifestContents: Record<string, string> = {};
    for (const m of manifests) {
      try { manifestContents[m] = readFileSync(join(cwd, m), "utf8").slice(0, 4096); } catch { /* transient */ }
    }
    const vector = buildInterestVector({ manifests, taskCategory: "build", manifestContents });

    // Honor the granted scope at the SOURCE: only signal families the user
    // consented to may ever be used or sealed. This keeps the producer in
    // lockstep with consent-bound verify — a narrow consent (e.g. lang-only)
    // genuinely constrains egress, not just the advisory check downstream.
    const granted = new Set(consent.payload.grantedSignals);
    const signals = vector.signals.filter((s) => granted.has(s.slice(0, s.indexOf(":"))));
    if (signals.length === 0) return { line: plainLine(modelName), exitCode: 0 };

    const inventory = store.readInventory();
    const eligible = inventory.filter((b: Bidder) =>
      b.targetSignals.some((s) => signals.includes(s)),
    );
    if (eligible.length === 0) return { line: plainLine(modelName), exitCode: 0 };

    // Relevance re-rank within eligible set; bias the auction order deterministically.
    const bandit = SolverBandit.fromJSON(input.seed, store.readBandit());
    const bucket = signals.find((s) => s.startsWith("lang:")) ?? "lang:unknown";
    const ranked = bandit.rank(bucket, eligible.map((b) => b.id));
    const ordered = ranked.map((id) => eligible.find((b) => b.id === id)!) as Bidder[];

    const result = runAuction(ordered, signals, input.seed, RESERVE_CENTS);
    if (!result.winnerId) return { line: plainLine(modelName), exitCode: 0 };

    const imp = makeImpression({
      bidders: ordered, signals, seed: input.seed,
      reserveCents: RESERVE_CENTS, consentId: consent.payload.id, key, now: input.now,
      prevHash: store.readWitnessTailHash(),
    });
    store.appendWitness(imp);

    const ledgerState = store.readLedger();
    const ledger = new Ledger();
    ledger.developerBalanceCents = ledgerState.developerBalanceCents;
    ledger.platformBalanceCents = ledgerState.platformBalanceCents;
    ledger.impressionCount = ledgerState.impressionCount;
    ledger.accrue(result.clearingPriceCents);
    store.writeLedger({
      developerBalanceCents: ledger.developerBalanceCents,
      platformBalanceCents: ledger.platformBalanceCents,
      impressionCount: ledger.impressionCount,
    });

    store.writeRenderState({ lastImpressionAt: input.now, lastCreative: result.winningCreative! });

    return { line: sponsorLine(modelName, result.winningCreative!), exitCode: 0 };
  } catch {
    return { line: plainLine(modelName), exitCode: 0 };
  }
}
