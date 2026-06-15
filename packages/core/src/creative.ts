// Clean-room animated sponsor-line creative. Zero ASCILINE code: the schema and
// decoder below are original.
//
// The auction, witness, receipts and ledger seal the creative as a plain STRING and
// never change. Animation rides INSIDE that string as a tiny JSON spec tagged with
// `sl: 1`. The decoder turns (spec, wall-clock) into the exact bytes to emit for the
// current frame. ANSI colour is generated here, locally, at display time only — it is
// never part of the sealed creative, so the "no control chars / no terminal hijack in
// sealed inventory" boundary in campaign/inventory validation is preserved while the
// rendered line can still breathe and shimmer.
//
// Two creative kinds share one decoder (the "hybrid" schema):
//   - effect: a short text line plus a named micro-effect. ~40 bytes. Phase 1, the
//     single-row Claude Code status line.
//   - frames: a pre-rendered ASCII grid played at a fixed fps. Phase 2, an opt-in
//     `sponsorline watch` surface. The decoder already renders it; the status-line
//     caller asks for one line via `oneLine`.
//
// Privacy note: decoding is a PURE local transform of bytes the advertiser already
// shipped with the inventory. It reads no project context and makes no callback, so
// animating a creative cannot widen the egress surface.

export type CreativeEffect = "none" | "pulse" | "shimmer" | "typewriter";

// An RGB triple, each channel 0-255. Effects modulate this locally per frame.
export type Rgb = [number, number, number];

export interface EffectCreative {
  sl: 1;
  kind: "effect";
  text: string;
  fg?: Rgb; // base colour; defaults to a soft white when omitted
  effect: CreativeEffect;
  loopMs?: number; // animation period; a per-effect default applies when omitted
}

export interface FramesCreative {
  sl: 1;
  kind: "frames";
  cols: number;
  rows: number;
  fps: number;
  frames: string[]; // each frame is `rows` lines joined by "\n"
}

export type AnimatedCreative = EffectCreative | FramesCreative;

export interface DecodeOptions {
  nowMs: number; // wall-clock at this redraw; the host advances it between frames
  cols?: number; // visible-width budget; the decoded line is hard-capped to fit
  color?: boolean; // false => emit no ANSI at all (NO_COLOR / dumb terminals)
  reducedMotion?: boolean; // true => a single static frame, no motion
  oneLine?: boolean; // true => collapse to a single row (the status-line contract)
}

const DEFAULT_FG: Rgb = [216, 216, 216];
const ESC = "\x1b";
const RESET = `${ESC}[0m`;

// Strip every C0/C1 control character. Keep newlines only when the caller wants a
// grid (frames) and has NOT asked for one line — the status line is single-row.
function sanitize(s: string, keepNewlines: boolean): string {
  const re = keepNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return s.replace(re, "");
}

function truncate(s: string, cols?: number): string {
  if (cols === undefined || cols <= 0) return s;
  return [...s].length <= cols ? s : [...s].slice(0, cols).join("");
}

function fg(rgb: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `${ESC}[38;2;${c(rgb[0])};${c(rgb[1])};${c(rgb[2])}m`;
}

function scale(rgb: Rgb, k: number): Rgb {
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

// Parse a creative string into an animated spec, or null if it is plain text. A bare
// string, a number, or any object missing the `sl: 1` tag is treated as plain.
export function parseCreative(creative: string): AnimatedCreative | null {
  let v: unknown;
  try {
    v = JSON.parse(creative);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.sl !== 1) return null;
  if (o.kind === "effect" && typeof o.text === "string") return v as EffectCreative;
  if (
    o.kind === "frames" &&
    Array.isArray(o.frames) &&
    o.frames.every((f) => typeof f === "string") &&
    typeof o.fps === "number" &&
    o.fps > 0
  ) {
    return v as FramesCreative;
  }
  return null;
}

// Render the effect creative's current frame to a string (with local ANSI when colour
// is enabled). Pure in (spec, opts).
function decodeEffect(spec: EffectCreative, opts: DecodeOptions): string {
  const text = truncate(sanitize(spec.text, false), opts.oneLine ? opts.cols : undefined);
  const color = opts.color !== false;
  const base = spec.fg ?? DEFAULT_FG;
  const motion = !opts.reducedMotion;
  const t = opts.nowMs;

  if (!color) return text; // colour off: plain static text, no ANSI ever
  const effect: CreativeEffect = motion ? spec.effect : "none";

  switch (effect) {
    case "pulse": {
      const loop = spec.loopMs && spec.loopMs > 0 ? spec.loopMs : 2000;
      const k = 0.7 + 0.3 * Math.sin((2 * Math.PI * (t % loop)) / loop);
      return `${fg(scale(base, k))}${text}${RESET}`;
    }
    case "shimmer": {
      const chars = [...text];
      if (chars.length === 0) return "";
      const loop = spec.loopMs && spec.loopMs > 0 ? spec.loopMs : 1200;
      const pos = Math.floor(((t % loop) / loop) * chars.length) % chars.length;
      const dim = fg(scale(base, 0.65));
      const hot = fg([255, 255, 255]);
      let out = "";
      for (let i = 0; i < chars.length; i++) out += (i === pos ? hot : dim) + chars[i];
      return out + RESET;
    }
    case "typewriter": {
      const chars = [...text];
      const perChar = 120;
      const hold = 1500;
      const loop = spec.loopMs && spec.loopMs > 0 ? spec.loopMs : chars.length * perChar + hold;
      const phase = t % loop;
      const n = Math.min(chars.length, Math.floor(phase / perChar) + 1);
      return `${fg(base)}${chars.slice(0, n).join("")}${RESET}`;
    }
    case "none":
    default:
      return `${fg(base)}${text}${RESET}`;
  }
}

// Render the frames creative's current frame. The status-line caller passes oneLine to
// collapse the grid to its first row; the Phase-2 grid player omits it.
function decodeFrames(spec: FramesCreative, opts: DecodeOptions): string {
  const idx = opts.reducedMotion
    ? 0
    : Math.floor(opts.nowMs / (1000 / spec.fps)) % spec.frames.length;
  const frame = spec.frames[idx] ?? "";
  if (opts.oneLine) {
    const firstRow = sanitize(frame.split("\n")[0] ?? "", false);
    return truncate(firstRow, opts.cols);
  }
  return sanitize(frame, true);
}

// The one entry point. Plain creatives pass through (sanitised, and truncated when a
// width budget is given); animated specs render their current frame.
export function decodeCreative(creative: string, opts: DecodeOptions): string {
  const spec = parseCreative(creative);
  if (spec === null) {
    return truncate(sanitize(creative, !opts.oneLine), opts.oneLine ? opts.cols : undefined);
  }
  return spec.kind === "effect" ? decodeEffect(spec, opts) : decodeFrames(spec, opts);
}
