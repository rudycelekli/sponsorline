import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInterestVector,
  runAuction,
  deriveDeviceKey,
  validateConsent,
  makeImpression,
  decodeCreative,
  detectColorLevel,
  Ledger,
  SolverBandit,
  type Bidder,
  type ColorLevel,
} from "@effinai/sponsorline-core";
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
  // Render hints for the animated creative. Defaulted from the environment when the
  // caller omits them so the decoder stays pure and the command stays testable.
  cols?: number; // terminal width budget
  colorLevel?: ColorLevel; // terminal colour capability; takes precedence over `color`
  color?: boolean; // legacy: false => no ANSI (honors NO_COLOR); true => truecolor
  reducedMotion?: boolean; // true => a single static frame (honors SPONSORLINE_REDUCED_MOTION)
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
  // Display-time decode of the (possibly animated) creative. The sealed creative
  // string in the witness/ledger is never touched; this only shapes the bytes shown
  // on THIS redraw, keyed off the wall-clock the host passes each frame. Defaults are
  // read from the environment so reduced-motion and NO_COLOR are honored out of the box.
  const show = (creative: string): string => {
    // Resolve terminal colour capability. A precise colorLevel wins; the legacy
    // boolean still maps (false => none, true => truecolor); otherwise sniff the
    // environment so we never emit truecolor at a terminal that cannot decode it.
    const colorLevel: ColorLevel =
      input.colorLevel ??
      (input.color === false
        ? "none"
        : input.color === true
          ? "truecolor"
          : detectColorLevel(process.env, Boolean(process.stdout.isTTY)));
    // Status-line motion is OFF by default. This is editor chrome that redraws
    // constantly; it must not move unless the developer opts in. Animate ONLY when
    // SPONSORLINE_MOTION is set and reduced-motion has not been requested.
    const motionOptIn = Boolean(process.env.SPONSORLINE_MOTION) && !process.env.SPONSORLINE_REDUCED_MOTION;
    const reducedMotion = input.reducedMotion ?? !motionOptIn;
    return decodeCreative(creative, {
      nowMs: input.now,
      oneLine: true,
      cols: input.cols ?? (process.stdout.columns || undefined),
      colorLevel,
      reducedMotion,
    });
  };
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
      return { line: sponsorLine(modelName, show(render.lastCreative)), exitCode: 0 };
    }

    // A new billable impression mutates the witness hash chain AND the ledger.
    // Guard that critical section with an exclusive lock: concurrent statusline
    // invocations must not read the same tail hash and fork the chain (which would
    // break verify for an honest user) or double-bill. A caller that cannot acquire
    // degrades gracefully — show the cached/plain line, log nothing.
    if (!store.tryLock()) {
      return { line: render ? sponsorLine(modelName, show(render.lastCreative)) : plainLine(modelName), exitCode: 0 };
    }
    try {
      // Re-check rotation after acquiring: another process may have just logged the
      // window's impression while we waited. If so, display its creative and append
      // nothing — this is what makes the impression exactly-once under concurrency.
      const fresh = store.readRenderState();
      if (fresh && input.now - fresh.lastImpressionAt < rotateMs) {
        return { line: sponsorLine(modelName, show(fresh.lastCreative)), exitCode: 0 };
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

      store.writeRenderState({
        lastImpressionAt: input.now,
        lastCreative: result.winningCreative!,
        lastAdvertiserId: result.winnerId,
        lastBucket: bucket,
      });

      return { line: sponsorLine(modelName, show(result.winningCreative!)), exitCode: 0 };
    } finally {
      store.unlock();
    }
  } catch {
    return { line: plainLine(modelName), exitCode: 0 };
  }
}
