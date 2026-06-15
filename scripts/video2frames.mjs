// Marketer creative transcoder (prototype): video / gif  ->  sealed `frames` creative.
//
// A marketer thinks in video. The device can only render text into a terminal. This tool
// does the "translation" entirely OFFLINE, the way the real ingest pipeline would:
//
//   source clip ──► [ffmpeg: fps + scale + grayscale] ──► cols×rows luminance grid per
//   frame ──► map each cell to an ASCII ramp char ──► {sl:1,kind:"frames",...} JSON
//
// That JSON string IS the sealed creative — the exact bytes the auction, witness chain and
// ledger commit to. On-device, the SAME pure decoder this script imports (decodeCreative)
// just advances a clock over those frames. The video itself never reaches the device, and
// nothing phones home: animating a creative cannot widen the zero-egress surface.
//
// The transcode also runs through validateCampaign before anything plays, so an oversized,
// malformed, or strobing (WCAG 2.3.1) creative is rejected at the source exactly as a real
// marketer submission would be.
//
//   node scripts/video2frames.mjs <input.mp4|input.gif> [options]
//
//   --cols N      output grid width in cells           (default 64)
//   --rows N      output grid height in cells          (default: from source aspect)
//   --fps N       playback frames per second           (default 12, capped at 30)
//   --seconds S   trim the source to the first S secs  (default: whole clip)
//   --ramp STR    luminance ramp, dark→light           (default " .:-=+*#%@")
//   --invert      flip the ramp (for light terminals)
//   --color       also seal a colour layer (palette + per-frame index grid). The glyph
//                 frames stay grayscale-safe; colour is generated locally at display time
//                 and degrades to grayscale on NO_COLOR / a pipe.
//   --oneline     preview the status-line collapse (first row only)
//   --json        print only the sealed creative JSON, do not play
//   --out FILE    write the sealed creative JSON to FILE
//   --no-play     transcode + validate, but do not animate

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { decodeCreative, validateCampaign, detectColorLevel, COLOR_ALPHABET } from "../packages/core/dist/index.js";

const ESC = "\x1b";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { cols: 120, fps: 12, ramp: " .,:;irsXA253hMHGS#9B&@", colors: 256 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--invert") a.invert = true;
    else if (t === "--color") a.color = true;
    else if (t === "--oneline") a.oneline = true;
    else if (t === "--json") a.json = true;
    else if (t === "--no-play") a.noPlay = true;
    else if (t === "--cols") a.cols = Number(argv[++i]);
    else if (t === "--rows") a.rows = Number(argv[++i]);
    else if (t === "--fps") a.fps = Number(argv[++i]);
    else if (t === "--seconds") a.seconds = Number(argv[++i]);
    else if (t === "--ramp") a.ramp = argv[++i];
    else if (t === "--colors") a.colors = Math.max(2, Math.min(256, Number(argv[++i]) || 256));
    else if (t === "--out") a.out = argv[++i];
    else rest.push(t);
  }
  a.input = rest[0];
  return a;
}

function ffmpegOk() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

// Read source pixel dimensions so we can pick a row count that preserves aspect. A
// terminal cell is roughly twice as tall as it is wide, so we halve the pixel ratio.
function probeAspect(input) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", input],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const [w, h] = r.stdout.trim().split(/[x,\n]/).map(Number);
  return w > 0 && h > 0 ? { w, h } : null;
}

// Decode the source into a flat stream of single-byte grayscale pixels: ffmpeg does the
// fps resampling, area-averaged downscale, and color->gray conversion for us, so each
// output frame is exactly cols*rows bytes of luminance (0..255). One tested path covers
// both mp4 and gif.
function decodeGrayFrames(input, cols, rows, fps, seconds) {
  const args = ["-i", input, "-vf", `fps=${fps},scale=${cols}:${rows}:flags=area,format=gray`];
  if (Number.isFinite(seconds) && seconds > 0) args.push("-t", String(seconds));
  args.push("-f", "rawvideo", "-pix_fmt", "gray", "-");
  const r = spawnSync("ffmpeg", args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error("ffmpeg failed:\n" + (r.stderr ? r.stderr.toString() : "(no stderr)"));
  return r.stdout;
}

// Same decode as grayscale, but keep the three colour channels: each output frame is
// cols*rows*3 bytes (R,G,B per cell). We derive BOTH the grayscale glyph (from luminance)
// and the colour index (from a quantised RGB cube) from these bytes, so the two layers stay
// perfectly cell-aligned.
function decodeRgbFrames(input, cols, rows, fps, seconds) {
  const args = ["-i", input, "-vf", `fps=${fps},scale=${cols}:${rows}:flags=area,format=rgb24`];
  if (Number.isFinite(seconds) && seconds > 0) args.push("-t", String(seconds));
  args.push("-f", "rawvideo", "-pix_fmt", "rgb24", "-");
  const r = spawnSync("ffmpeg", args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error("ffmpeg failed:\n" + (r.stderr ? r.stderr.toString() : "(no stderr)"));
  return r.stdout;
}

// Build an adaptive colour palette from the clip itself: median-cut quantisation over a
// sample of the RGB pixels yields up to 64 representative colours (the COLOR_ALPHABET cap),
// far closer to the source than a fixed even cube. The palette is plain RGB data sealed into
// the creative; the decoder regenerates ANSI from it locally, so the sealed bytes stay clean.
function medianCutPalette(buf, maxColors) {
  // Sample pixels (cap the working set so quantisation stays fast on long/large clips).
  const pxCount = Math.floor(buf.length / 3);
  const target = 40000;
  const step = Math.max(1, Math.floor(pxCount / target));
  const px = [];
  for (let i = 0; i < pxCount; i += step) {
    const p = i * 3;
    px.push([buf[p], buf[p + 1], buf[p + 2]]);
  }
  if (px.length === 0) return [[0, 0, 0]];

  const boxes = [px];
  while (boxes.length < maxColors) {
    // Pick the box with the largest single-channel spread to split next.
    let bi = -1;
    let bestRange = -1;
    let bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const q of box) {
          if (q[ch] < lo) lo = q[ch];
          if (q[ch] > hi) hi = q[ch];
        }
        const range = hi - lo;
        if (range > bestRange) {
          bestRange = range;
          bi = i;
          bestCh = ch;
        }
      }
    }
    if (bi < 0) break; // nothing left to split
    const box = boxes[bi];
    box.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }

  // Each box collapses to its average colour.
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const q of box) {
      r += q[0];
      g += q[1];
      b += q[2];
    }
    const n = box.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

// sRGB byte -> linear-light component.
function srgb2lin(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Linear sRGB -> OKLab. OKLab is perceptually uniform, so Euclidean distance in it
// tracks how different two colours LOOK, not just how far apart their raw bytes are.
// Matching in this space lets a 64-entry palette read far truer to the source.
function rgb2oklab(r, g, b) {
  const lr = srgb2lin(r);
  const lg = srgb2lin(g);
  const lb = srgb2lin(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

// Nearest palette entry for an OKLab triple (perceptual squared distance).
// `paletteLab` is the palette pre-converted to OKLab so this stays a tight inner loop.
function nearestColor(paletteLab, L, A, B) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < paletteLab.length; i++) {
    const c = paletteLab[i];
    const dL = L - c[0];
    const dA = A - c[1];
    const dB = B - c[2];
    const d = dL * dL + dA * dA + dB * dB;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Turn the RGB byte stream into BOTH layers: grayscale ramp glyphs (the always-safe surface)
// and a parallel index grid into the adaptive palette. Grids share geometry, so glyph cell
// (y,x) lines up with colour cell (y,x); each colour cell maps to its nearest palette entry.
function gridToColorFrames(buf, cols, rows, ramp, invert, palette) {
  const cell = cols * rows;
  const stride = cell * 3;
  const count = Math.floor(buf.length / stride);
  const ramps = [...ramp];
  // Pre-convert the palette to OKLab once; the per-pixel match reuses it.
  const paletteLab = palette.map((c) => rgb2oklab(c[0], c[1], c[2]));
  const frames = [];
  const colors = [];
  for (let f = 0; f < count; f++) {
    const off = f * stride;
    // Float working copy of this frame's RGB so Floyd-Steinberg error diffusion can spread
    // quantisation error into not-yet-visited cells. Dithering the colour layer trades a
    // little spatial noise for the elimination of flat colour banding, so a 64-entry palette
    // reads far closer to the source. The glyph layer stays keyed to the ORIGINAL luminance
    // (undithered) so the audit-safe text surface is deterministic.
    const work = new Float32Array(stride);
    for (let i = 0; i < stride; i++) work[i] = buf[off + i];
    const diffuse = (xx, yy, er, eg, eb, w) => {
      if (xx < 0 || xx >= cols || yy < 0 || yy >= rows) return;
      const q = (yy * cols + xx) * 3;
      work[q] += er * w;
      work[q + 1] += eg * w;
      work[q + 2] += eb * w;
    };
    const glyphLines = [];
    const colorLines = [];
    for (let y = 0; y < rows; y++) {
      let gl = "";
      let cl = "";
      for (let x = 0; x < cols; x++) {
        const base = (y * cols + x) * 3;
        const p = off + base;
        let lum = (0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2]) / 255;
        if (invert) lum = 1 - lum;
        let idx = Math.floor(lum * ramps.length);
        if (idx >= ramps.length) idx = ramps.length - 1;
        if (idx < 0) idx = 0;
        gl += ramps[idx];

        const r = work[base];
        const g = work[base + 1];
        const b = work[base + 2];
        const lab = rgb2oklab(r, g, b);
        const ci = nearestColor(paletteLab, lab[0], lab[1], lab[2]);
        cl += COLOR_ALPHABET[ci];
        const pc = palette[ci];
        const er = r - pc[0];
        const eg = g - pc[1];
        const eb = b - pc[2];
        diffuse(x + 1, y, er, eg, eb, 7 / 16);
        diffuse(x - 1, y + 1, er, eg, eb, 3 / 16);
        diffuse(x, y + 1, er, eg, eb, 5 / 16);
        diffuse(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
      glyphLines.push(gl);
      colorLines.push(cl);
    }
    frames.push(glyphLines.join("\n"));
    colors.push(colorLines.join("\n"));
  }
  return { frames, colors };
}

// Turn the grayscale byte stream into `frames` strings: one ramp char per cell, rows joined
// by newlines. This is the actual "video -> ASCII" mapping.
function gridToFrames(buf, cols, rows, ramp, invert) {
  const cell = cols * rows;
  const count = Math.floor(buf.length / cell);
  const ramps = [...ramp];
  const frames = [];
  for (let f = 0; f < count; f++) {
    const off = f * cell;
    const lines = [];
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        let lum = buf[off + y * cols + x] / 255;
        if (invert) lum = 1 - lum;
        let idx = Math.floor(lum * ramps.length);
        if (idx >= ramps.length) idx = ramps.length - 1;
        if (idx < 0) idx = 0;
        line += ramps[idx];
      }
      lines.push(line);
    }
    frames.push(lines.join("\n"));
  }
  return frames;
}

// Animate a frames creative in place by replaying it through the on-device decoder. Each
// redraw moves the cursor back up over the previous grid so the clip plays without scrolling.
async function play(creative, rows, fps, cols, oneLine, frameCount, colorLevel) {
  const loopMs = (frameCount / fps) * 1000;
  const durationMs = Math.max(4000, loopMs); // play through once (clips can be long)
  const start = Date.now();
  process.stdout.write(ESC + "[?25l"); // hide cursor
  let first = true;
  try {
    while (Date.now() - start < durationMs) {
      const nowMs = Date.now() - start;
      const out = decodeCreative(
        creative,
        oneLine
          ? { nowMs, reducedMotion: false, oneLine: true, cols, colorLevel }
          : { nowMs, reducedMotion: false, colorLevel },
      );
      const drawnRows = oneLine ? 1 : rows;
      if (!first) process.stdout.write(`${ESC}[${drawnRows}F`); // cursor back to grid top
      const lines = out.split("\n");
      for (let r = 0; r < drawnRows; r++) {
        process.stdout.write(`${ESC}[2K${lines[r] ?? ""}\n`);
      }
      first = false;
      await sleep(1000 / fps);
    }
  } finally {
    process.stdout.write(ESC + "[?25h"); // restore cursor
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.input) {
    process.stderr.write("usage: node scripts/video2frames.mjs <input.mp4|input.gif> [--cols N] [--rows N] [--fps N] [--seconds S] [--ramp STR] [--invert] [--color] [--oneline] [--json] [--out FILE] [--no-play]\n");
    process.exit(2);
  }
  if (!ffmpegOk()) {
    process.stderr.write("ffmpeg is required to transcode. Install it (e.g. `brew install ffmpeg`) and retry.\n");
    process.exit(1);
  }

  const cols = Math.max(1, Math.round(a.cols));
  const fps = Math.max(1, Math.min(30, Math.round(a.fps)));
  let rows = a.rows;
  if (!Number.isFinite(rows)) {
    const asp = probeAspect(a.input);
    rows = asp ? Math.max(1, Math.round((cols * asp.h) / asp.w / 2)) : 12;
  }
  rows = Math.max(1, Math.round(rows));

  const log = (s) => process.stderr.write(s + "\n");
  log(`Transcoding ${a.input}  ->  ${cols}x${rows} cells @ ${fps}fps${a.color ? " (colour)" : ""}${a.seconds ? ` (first ${a.seconds}s)` : ""}`);

  let frames;
  let palette;
  let colors;
  if (a.color) {
    const rgb = decodeRgbFrames(a.input, cols, rows, fps, a.seconds);
    palette = medianCutPalette(rgb, a.colors);
    ({ frames, colors } = gridToColorFrames(rgb, cols, rows, a.ramp, a.invert, palette));
  } else {
    const gray = decodeGrayFrames(a.input, cols, rows, fps, a.seconds);
    frames = gridToFrames(gray, cols, rows, a.ramp, a.invert);
  }
  if (frames.length === 0) {
    log("No frames decoded. Is the input a valid video/gif?");
    process.exit(1);
  }

  const creative = JSON.stringify(
    a.color ? { sl: 1, kind: "frames", cols, rows, fps, frames, palette, colors } : { sl: 1, kind: "frames", cols, rows, fps, frames },
  );

  // Validate exactly as a marketer submission would be: frames opt-in, generous-but-bounded
  // size caps for a prototype, and the WCAG 2.3.1 flash gate active. Let the gate speak.
  const campaign = {
    id: "video-preview",
    advertiser: "preview",
    creative,
    bidCents: 500,
    budgetCents: 50_000,
    targetSignals: ["lang:ts"],
    startsAt: 0,
    endsAt: 1e12,
  };
  const policy = {
    reserveCents: 100,
    maxCreative: 120,
    allowFrames: true,
    maxFrames: 600,
    maxFrameChars: cols * rows + rows + 16,
    maxFps: 30,
    maxGrid: 512,
    maxAnimatedChars: 4_000_000,
  };
  const v = validateCampaign(campaign, policy);

  const kb = (creative.length / 1024).toFixed(1);
  log(`Frames: ${frames.length}   sealed creative size: ${kb} KB   valid: ${v.ok}`);
  if (!v.ok) {
    log("Rejected at the marketer gate:");
    for (const e of v.errors) log("  - " + e);
    log("Tip: lower --fps, shrink --cols, or trim with --seconds to fit the inventory bounds.");
    process.exit(1);
  }
  if (creative.length > 256 * 1024) {
    log("Note: this is large for sealed inventory. Real campaigns trim with --seconds / lower --fps / smaller --cols.");
  }

  if (a.out) {
    writeFileSync(a.out, creative);
    log(`Wrote sealed creative to ${a.out}`);
  }
  if (a.json) {
    process.stdout.write(creative + "\n");
    return;
  }
  if (a.noPlay) return;

  const level = detectColorLevel(process.env, Boolean(process.stdout.isTTY));
  log(`Playing through the on-device decoder (Ctrl-C to stop)... terminal colour: ${level}`);
  await play(creative, rows, fps, cols, a.oneline, frames.length, level);
  log("Done. The device renders exactly these bytes; no video was ever sent to it.");
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exit(1);
});
