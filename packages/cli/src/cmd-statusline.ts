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

export interface StatuslineInput {
  appDir: string;
  salt: string;
  stdin: string;
  now: number;
  seed: bigint;
}
export interface StatuslineOutput { line: string; exitCode: number; }

function plainLine(model: string): string {
  return `${model}`.trim() || "Claude";
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

    const present = new Set(readdirSync(cwd));
    const manifests = MANIFESTS.filter((m) => present.has(m));
    const manifestContents: Record<string, string> = {};
    for (const m of manifests) {
      try { manifestContents[m] = readFileSync(join(cwd, m), "utf8").slice(0, 4096); } catch { /* transient */ }
    }
    const vector = buildInterestVector({ manifests, taskCategory: "build", manifestContents });

    const inventory = store.readInventory();
    const eligible = inventory.filter((b: Bidder) =>
      b.targetSignals.some((s) => vector.signals.includes(s)),
    );
    if (eligible.length === 0) return { line: plainLine(modelName), exitCode: 0 };

    // Relevance re-rank within eligible set; bias the auction order deterministically.
    const bandit = SolverBandit.fromJSON(input.seed, store.readBandit());
    const bucket = vector.signals.find((s) => s.startsWith("lang:")) ?? "lang:unknown";
    const ranked = bandit.rank(bucket, eligible.map((b) => b.id));
    const ordered = ranked.map((id) => eligible.find((b) => b.id === id)!) as Bidder[];

    const result = runAuction(ordered, vector.signals, input.seed, RESERVE_CENTS);
    if (!result.winnerId) return { line: plainLine(modelName), exitCode: 0 };

    const imp = makeImpression({
      bidders: ordered, signals: vector.signals, seed: input.seed,
      reserveCents: RESERVE_CENTS, consentId: consent.payload.id, key, now: input.now,
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

    return { line: `${modelName} · Sponsored: ${result.winningCreative}`, exitCode: 0 };
  } catch {
    return { line: plainLine(modelName), exitCode: 0 };
  }
}
