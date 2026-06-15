// Live, local Sponsorline creative demo. Run it and WATCH your terminal:
//
//   npm run build && npm run demo
//
// Everything here is a PURE local transform of a creative string. There is no network,
// no project read, no auction, no billing — just the decoder turning (creative, clock)
// into the exact bytes for the current frame, exactly as the status line does on-device.
// That is the whole point: animation cannot widen the zero-egress surface.

import { decodeCreative, detectColorLevel, validateCampaign } from "../packages/core/dist/index.js";

const ESC = "\x1b";
const CLEAR_LINE = `${ESC}[2K\r`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The colour level your terminal actually advertises. The decoder never emits truecolor
// unless this says so — at a 256-colour terminal it downsamples, at a pipe it emits nothing.
const level = detectColorLevel(process.env, Boolean(process.stdout.isTTY));

function rule(title) {
  process.stdout.write(`\n${ESC}[1m${title}${ESC}[0m\n`);
}

// Animate one creative in place for `ms` milliseconds at `fps`, advancing a virtual clock.
async function animate(label, creative, { ms = 2600, fps = 30, opts = {} } = {}) {
  process.stdout.write(`  ${label}\n  `);
  const start = Date.now();
  const frameMs = 1000 / fps;
  while (Date.now() - start < ms) {
    const nowMs = Date.now() - start;
    const line = decodeCreative(creative, { nowMs, oneLine: true, cols: 48, colorLevel: level, ...opts });
    process.stdout.write(CLEAR_LINE + "  " + line);
    await sleep(frameMs);
  }
  process.stdout.write("\n");
}

const eff = (effect, extra = {}) =>
  JSON.stringify({ sl: 1, kind: "effect", text: "Try Acme CI — fast TS builds", effect, ...extra });

async function main() {
  process.stdout.write(`${ESC}[1mSponsorline creative demo${ESC}[0m  (terminal colour level: ${level})\n`);

  rule("1. The four effects (motion is opt-in; this demo opts in)");
  await animate('pulse     — gentle brightness breathing', eff("pulse"));
  await animate('shimmer   — a highlight sweeps the text', eff("shimmer"));
  await animate('typewriter— reveals one char at a time', eff("typewriter"));
  await animate('none      — a plain coloured line', eff("none"), { ms: 1200 });

  rule("2. A frames creative (opt-in grid surface)");
  const spinner = JSON.stringify({
    sl: 1, kind: "frames", cols: 24, rows: 1, fps: 8,
    frames: ["[=     ] building", "[==    ] building", "[===   ] building", "[====  ] building", "[===== ] building", "[======] ready   "],
  });
  await animate("watch surface, collapsed to one row", spinner, { ms: 3000, fps: 12 });

  rule("3. Same creative, three colour capabilities (no escapes leak to a dumb terminal)");
  const sample = eff("none");
  for (const lvl of ["truecolor", "ansi256", "none"]) {
    const out = decodeCreative(sample, { nowMs: 0, oneLine: true, cols: 48, colorLevel: lvl });
    process.stdout.write(`  ${lvl.padEnd(10)} bytes: ${JSON.stringify(out)}\n`);
  }

  rule("4. Flash-safety gate (WCAG 2.3.1) rejects strobing creatives at the source");
  const base = {
    id: "demo", advertiser: "Acme CI", bidCents: 500, budgetCents: 50000,
    targetSignals: ["lang:ts"], startsAt: 0, endsAt: 1e12,
  };
  const policy = { reserveCents: 100, maxCreative: 120, allowFrames: true };
  const strobe = JSON.stringify({ sl: 1, kind: "frames", cols: 2, rows: 1, fps: 30, frames: ["  ", "\u2588\u2588"] });
  const fastPulse = eff("pulse", { loopMs: 1 });
  for (const [name, creative] of [["30fps black/white strobe", strobe], ["1ms-loop pulse", fastPulse]]) {
    const v = validateCampaign({ ...base, creative }, policy);
    process.stdout.write(`  ${name.padEnd(26)} -> ok=${v.ok}  ${v.errors.join("; ")}\n`);
  }

  process.stdout.write("\nNo network was touched. No project files were read. Decode is pure and local.\n");
}

main();
