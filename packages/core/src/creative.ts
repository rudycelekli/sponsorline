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
  // OPTIONAL colour layer. The glyph `frames` above stay the sealed, auditable, plain-text
  // surface that degrades to grayscale on NO_COLOR / a pipe. Colour rides alongside as a
  // small fixed palette plus, per frame, a grid of palette-index characters (same geometry
  // as the glyph frame). The decoder pairs glyph cell (y,x) with index cell (y,x) and emits
  // ANSI LOCALLY at display time. No escape ever enters the sealed creative, so the
  // zero-egress / no-terminal-hijack boundary holds exactly as for the monochrome path.
  palette?: Rgb[]; // colour table; index chars in `colors` address into this
  colors?: string[]; // parallel to `frames`; each is an index-grid (see COLOR_ALPHABET)
}

// The character alphabet a `colors` index-grid uses: one char per palette index, so a grid
// cell aligns 1:1 with its glyph cell. The first 64 entries are the original base64 order, so
// every colour layer authored before the 256-colour expansion still decodes identically;
// indices 64..255 extend into a contiguous block of Latin code points (U+0100..U+01BF). Every
// entry is a single BMP code unit, non-control, and non-space, so an index-grid stays as clean
// and cell-aligned as a glyph frame and survives sanitize() unchanged. 256 entries is the
// useful ceiling: ansi256 terminals top out there and truecolor renders each entry exactly.
const COLOR_ALPHABET_BASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const COLOR_ALPHABET_EXT = Array.from({ length: 192 }, (_, i) => String.fromCharCode(0x100 + i)).join("");
export const COLOR_ALPHABET = COLOR_ALPHABET_BASE + COLOR_ALPHABET_EXT;
const COLOR_INDEX: ReadonlyMap<string, number> = new Map([...COLOR_ALPHABET].map((ch, i) => [ch, i]));

// Map a single index character to its palette index, or -1 if it is not in the alphabet.
export function colorIndexOf(ch: string): number {
  const i = COLOR_INDEX.get(ch);
  return i === undefined ? -1 : i;
}

export type AnimatedCreative = EffectCreative | FramesCreative;

// How much colour the destination terminal can actually render. Emitting 24-bit
// truecolor escapes at a terminal that cannot decode them leaks raw "[38;2;..m"
// text into the line, so the caller detects capability (see detectColorLevel) and
// the decoder emits only what the level supports.
export type ColorLevel = "truecolor" | "ansi256" | "none";

export interface DecodeOptions {
  nowMs: number; // wall-clock at this redraw; the host advances it between frames
  cols?: number; // visible-width budget; the decoded line is hard-capped to fit
  colorLevel?: ColorLevel; // terminal colour capability; takes precedence over `color`
  color?: boolean; // legacy boolean: false => "none", true/undefined => "truecolor"
  reducedMotion?: boolean; // true => a single static frame, no motion
  oneLine?: boolean; // true => collapse to a single row (the status-line contract)
}

// Resolve the effective colour level for a decode. A caller that knows the terminal
// capability passes colorLevel; the legacy boolean still works (false => none).
function resolveLevel(opts: DecodeOptions): ColorLevel {
  if (opts.colorLevel) return opts.colorLevel;
  if (opts.color === false) return "none";
  return "truecolor";
}

// Detect what colour the terminal can render from the environment. Pure in (env, isTTY)
// so it is fully testable and never reads ambient globals itself. The rule is deliberately
// conservative: emit truecolor ONLY when the terminal explicitly advertises it, fall back
// to widely-supported 256-colour for any other real terminal, and emit nothing at all when
// colour is disabled, the terminal is "dumb", or the sink is not a TTY (a pipe / log file /
// CI capture must never accumulate escape codes).
export function detectColorLevel(env: Record<string, string | undefined>, isTTY: boolean): ColorLevel {
  if (env.NO_COLOR) return "none"; // present and non-empty disables colour (no-color.org)
  if (!isTTY) return "none"; // non-interactive sink: never emit escapes
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  const term = (env.TERM ?? "").toLowerCase();
  if (term === "" || term === "dumb") return "none";
  if (term.includes("truecolor") || term.includes("24bit")) return "truecolor";
  return "ansi256"; // any real terminal: 256-colour is safe; truecolor was not confirmed
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

// Quantise an 8-bit-per-channel colour to the xterm 256-colour palette index.
function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}

// Foreground SGR for the given colour at the terminal's capability level. "none"
// emits nothing (plain text); "ansi256" downsamples so no truecolor escape ever
// reaches a terminal that cannot render it.
function fg(rgb: Rgb, level: ColorLevel): string {
  if (level === "none") return "";
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const [r, g, b] = [c(rgb[0]), c(rgb[1]), c(rgb[2])];
  if (level === "ansi256") return `${ESC}[38;5;${rgbToAnsi256(r, g, b)}m`;
  return `${ESC}[38;2;${r};${g};${b}m`;
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
  const level = resolveLevel(opts);
  const base = spec.fg ?? DEFAULT_FG;
  const motion = !opts.reducedMotion;
  const t = opts.nowMs;

  if (level === "none") return text; // colour off: plain static text, no ANSI ever
  const effect: CreativeEffect = motion ? spec.effect : "none";

  switch (effect) {
    case "pulse": {
      const loop = spec.loopMs && spec.loopMs > 0 ? spec.loopMs : 2000;
      const k = 0.7 + 0.3 * Math.sin((2 * Math.PI * (t % loop)) / loop);
      return `${fg(scale(base, k), level)}${text}${RESET}`;
    }
    case "shimmer": {
      const chars = [...text];
      if (chars.length === 0) return "";
      const loop = spec.loopMs && spec.loopMs > 0 ? spec.loopMs : 1200;
      const pos = Math.floor(((t % loop) / loop) * chars.length) % chars.length;
      const dim = fg(scale(base, 0.65), level);
      const hot = fg([255, 255, 255], level);
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
      return `${fg(base, level)}${chars.slice(0, n).join("")}${RESET}`;
    }
    case "none":
    default:
      return `${fg(base, level)}${text}${RESET}`;
  }
}

// Colourise one grid row: pair each glyph cell with its palette colour and emit ANSI
// locally. Run-length: a colour escape is emitted only when it changes, spaces carry no
// colour (the cell is blank), and a single RESET closes the row so colour never bleeds
// into the next line. At level "none", fg() returns "" so this yields plain text.
function colorizeRow(glyphRow: string, colorRow: string, palette: Rgb[], level: ColorLevel): string {
  const glyphs = [...glyphRow];
  const idxs = [...colorRow];
  let out = "";
  let active = ""; // the escape currently in effect on the terminal
  for (let x = 0; x < glyphs.length; x++) {
    const ch = glyphs[x];
    let esc = "";
    if (ch !== " ") {
      const ci = colorIndexOf(idxs[x] ?? "");
      const rgb = ci >= 0 && ci < palette.length ? palette[ci] : DEFAULT_FG;
      esc = fg(rgb, level);
    }
    if (esc !== "" && esc !== active) {
      out += esc;
      active = esc;
    }
    out += ch;
  }
  return active === "" ? out : out + RESET;
}

// Render the frames creative's current frame. The status-line caller passes oneLine to
// collapse the grid to its first row; the Phase-2 grid player omits it. When the creative
// carries a colour layer and the terminal can render colour, glyphs are colourised locally;
// otherwise the plain grayscale glyphs serve unchanged (the always-safe fallback).
function decodeFrames(spec: FramesCreative, opts: DecodeOptions): string {
  const idx = opts.reducedMotion
    ? 0
    : Math.floor(opts.nowMs / (1000 / spec.fps)) % spec.frames.length;
  const frame = spec.frames[idx] ?? "";
  const level = resolveLevel(opts);
  const palette = Array.isArray(spec.palette) ? spec.palette : null;
  const colorFrame = palette && Array.isArray(spec.colors) ? spec.colors[idx] ?? "" : null;
  const canColor = level !== "none" && palette !== null && colorFrame !== null;

  if (opts.oneLine) {
    const glyphRow = truncate(sanitize(frame.split("\n")[0] ?? "", false), opts.cols);
    if (!canColor) return glyphRow;
    const colorRow = sanitize(colorFrame.split("\n")[0] ?? "", false);
    return colorizeRow(glyphRow, colorRow, palette, level);
  }
  if (!canColor) return sanitize(frame, true);
  const glyphRows = sanitize(frame, true).split("\n");
  const colorRows = sanitize(colorFrame, true).split("\n");
  return glyphRows.map((g, y) => colorizeRow(g, colorRows[y] ?? "", palette, level)).join("\n");
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
