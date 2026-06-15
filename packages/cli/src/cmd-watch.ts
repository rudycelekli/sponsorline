import { decodeCreative, detectColorLevel, type ColorLevel } from "@effinai/sponsorline-core";
import { Store } from "./store.js";

// `sponsorline watch` — the opt-in Phase 2 surface. It REPLAYS the creative that was
// already auctioned and sealed by the status-line path, as a real-time grid/animation.
//
// It is a pure local viewer: no auction, no witness append, no ledger accrual, no
// inventory read, no network. Billing stays exactly where it belongs — one impression
// per rotation window from the status line. Watching costs nothing and reveals nothing,
// so the zero-egress promise is untouched. The frames are bytes the advertiser already
// shipped with the inventory; the decoder is a pure local transform of them.

const ESC = "\x1b";
const CLEAR_HOME = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

export interface WatchInput {
  appDir: string;
  // Injectable for tests; default to real wall-clock / stdout / env.
  now?: () => number;
  write?: (s: string) => void;
  colorLevel?: ColorLevel; // terminal colour capability; takes precedence over `color`
  color?: boolean; // legacy: false => none, true => truecolor
  reducedMotion?: boolean;
  cols?: number;
  fps?: number; // viewer redraw cadence (default 12)
  interactive?: boolean; // emit cursor/clear control codes (default: stdout is a TTY)
  maxFrames?: number; // bound the loop (tests / non-interactive); undefined = until signal
  signal?: AbortSignal; // stop the loop (Ctrl-C wiring lives in the caller)
}

export interface WatchOutput { framesDrawn: number; exitCode: number; }

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export async function runWatch(input: WatchInput): Promise<WatchOutput> {
  const write = input.write ?? ((s: string) => process.stdout.write(s));
  const now = input.now ?? (() => Date.now());
  // Resolve colour capability the same way the status line does: precise level wins,
  // legacy boolean maps, else sniff the environment so truecolor never reaches a
  // terminal that cannot render it.
  const colorLevel: ColorLevel =
    input.colorLevel ??
    (input.color === false
      ? "none"
      : input.color === true
        ? "truecolor"
        : detectColorLevel(process.env, Boolean(process.stdout.isTTY)));
  const reducedMotion = input.reducedMotion ?? Boolean(process.env.SPONSORLINE_REDUCED_MOTION);
  const cols = input.cols ?? (process.stdout.columns || undefined);
  const fps = input.fps && input.fps > 0 ? input.fps : 12;
  const interactive = input.interactive ?? Boolean(process.stdout.isTTY);

  const store = new Store(input.appDir);
  if (!store.readConsent()) {
    write("Sponsorline is not set up. Run `sponsorline init` first.\n");
    return { framesDrawn: 0, exitCode: 0 };
  }
  const render = store.readRenderState();
  if (!render) {
    write("Nothing sponsored yet — use your editor for a bit, then try again.\n");
    return { framesDrawn: 0, exitCode: 0 };
  }

  const creative = render.lastCreative;
  const draw = (): string => decodeCreative(creative, { nowMs: now(), colorLevel, reducedMotion, cols });

  // Reduced motion: one static frame, no loop. Nothing to animate, so don't spin.
  if (reducedMotion) {
    write((interactive ? CLEAR_HOME : "") + draw() + "\n");
    return { framesDrawn: 1, exitCode: 0 };
  }

  if (interactive) write(HIDE_CURSOR);
  let framesDrawn = 0;
  try {
    const frameMs = 1000 / fps;
    while (!input.signal?.aborted) {
      write((interactive ? CLEAR_HOME : "") + draw() + (interactive ? "" : "\n"));
      framesDrawn += 1;
      if (input.maxFrames !== undefined && framesDrawn >= input.maxFrames) break;
      await sleep(frameMs, input.signal);
    }
  } finally {
    if (interactive) write(SHOW_CURSOR);
  }
  return { framesDrawn, exitCode: 0 };
}
