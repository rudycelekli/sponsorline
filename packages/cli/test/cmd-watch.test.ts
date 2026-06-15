import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent } from "@effinai/sponsorline-core";
import { Store } from "../src/store.js";
import { runWatch } from "../src/cmd-watch.js";

let appdir: string;
const SALT = "test-salt";

const framesCreative = JSON.stringify({
  sl: 1,
  kind: "frames",
  cols: 2,
  rows: 1,
  fps: 10, // 100ms per frame
  frames: ["AA", "BB", "CC"],
});

function withConsent(): Store {
  const key = deriveDeviceKey(SALT);
  const store = new Store(appdir);
  store.writeConsent(createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 }));
  return store;
}

// A clock that returns a preset sequence, one value per draw.
function seqClock(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-watch-"));
});

describe("watch", () => {
  it("tells an un-set-up user to init and draws nothing", async () => {
    let out = "";
    const r = await runWatch({ appDir: appdir, write: (s) => (out += s), interactive: false, maxFrames: 5 });
    expect(r.framesDrawn).toBe(0);
    expect(out).toContain("init");
  });

  it("reports nothing-yet when consented but no creative has served", async () => {
    withConsent();
    let out = "";
    const r = await runWatch({ appDir: appdir, write: (s) => (out += s), interactive: false, maxFrames: 5 });
    expect(r.framesDrawn).toBe(0);
    expect(out).toContain("Nothing sponsored yet");
  });

  it("replays the served creative, cycling frames over the clock", async () => {
    const store = withConsent();
    store.writeRenderState({ lastImpressionAt: 0, lastCreative: framesCreative });
    const drawn: string[] = [];
    const r = await runWatch({
      appDir: appdir,
      write: (s) => drawn.push(s),
      now: seqClock([0, 100, 200]),
      interactive: false,
      fps: 1000, // fast viewer cadence so the test does not wait
      maxFrames: 3,
    });
    expect(r.framesDrawn).toBe(3);
    expect(drawn.map((d) => d.trim())).toEqual(["AA", "BB", "CC"]);
  });

  it("draws a single static frame under reduced motion (no loop)", async () => {
    const store = withConsent();
    store.writeRenderState({ lastImpressionAt: 0, lastCreative: framesCreative });
    const drawn: string[] = [];
    const r = await runWatch({
      appDir: appdir,
      write: (s) => drawn.push(s),
      now: seqClock([200]),
      reducedMotion: true,
      interactive: false,
    });
    expect(r.framesDrawn).toBe(1);
    expect(drawn.join("").trim()).toBe("AA"); // frame 0, regardless of clock
  });

  it("is a pure viewer: never bills, appends, or runs an auction", async () => {
    const store = withConsent();
    store.writeRenderState({ lastImpressionAt: 0, lastCreative: framesCreative });
    await runWatch({
      appDir: appdir,
      write: () => {},
      now: seqClock([0, 100, 200, 300]),
      interactive: false,
      fps: 1000,
      maxFrames: 4,
    });
    expect(store.readWitness()).toHaveLength(0);
    expect(store.readLedger().impressionCount).toBe(0);
  });

  it("emits no ANSI control codes when non-interactive", async () => {
    const store = withConsent();
    store.writeRenderState({ lastImpressionAt: 0, lastCreative: framesCreative });
    let out = "";
    await runWatch({
      appDir: appdir,
      write: (s) => (out += s),
      now: seqClock([0]),
      color: false,
      interactive: false,
      fps: 1000,
      maxFrames: 1,
    });
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("stops promptly when the abort signal fires", async () => {
    const store = withConsent();
    store.writeRenderState({ lastImpressionAt: 0, lastCreative: framesCreative });
    const controller = new AbortController();
    controller.abort(); // already aborted: loop must not run
    const r = await runWatch({
      appDir: appdir,
      write: () => {},
      now: seqClock([0]),
      interactive: false,
      signal: controller.signal,
    });
    expect(r.framesDrawn).toBe(0);
  });
});
