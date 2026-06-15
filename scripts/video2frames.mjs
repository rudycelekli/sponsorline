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
  const a = { cols: 64, fps: 12, ramp: " .:-=+*#%@" };
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

// The fixed 64-entry colour cube the index grids address: 4 levels per channel (0,85,170,255)
// = 4^3 = 64 colours, one per COLOR_ALPHABET character. The decoder reads this palette to
// regenerate ANSI locally; it is data, never escapes, so the sealed creative stays clean.
function colorCube() {
  const p = [];
  for (let i = 0; i < 64; i++) p.push([((i >> 4) & 3) * 85, ((i >> 2) & 3) * 85, (i & 3) * 85]);
  return p;
}

// Turn the RGB byte stream into BOTH layers: grayscale ramp glyphs (the always-safe surface)
// and a parallel index grid into the 64-colour cube. Grids share geometry, so glyph cell
// (y,x) lines up with colour cell (y,x). Quantise each channel to 2 bits (>>6) for the cube.
function gridToColorFrames(buf, cols, rows, ramp, invert) {
  const cell = cols * rows;
  const stride = cell * 3;
  const count = Math.floor(buf.length / stride);
  const ramps = [...ramp];
  const frames = [];
  const colors = [];
  for (let f = 0; f < count; f++) {
    const off = f * stride;
    const glyphLines = [];
    const colorLines = [];
    for (let y = 0; y < rows; y++) {
      let gl = "";
      let cl = "";
      for (let x = 0; x < cols; x++) {
        const p = off + (y * cols + x) * 3;
        const r = buf[p];
        const g = buf[p + 1];
        const b = buf[p + 2];
        let lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (invert) lum = 1 - lum;
        let idx = Math.floor(lum * ramps.length);
        if (idx >= ramps.length) idx = ramps.length - 1;
        if (idx < 0) idx = 0;
        gl += ramps[idx];
        cl += COLOR_ALPHABET[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)];
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
    ({ frames, colors } = gridToColorFrames(rgb, cols, rows, a.ramp, a.invert));
    palette = colorCube();
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
