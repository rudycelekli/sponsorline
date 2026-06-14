import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SolverBandit } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runFeedback } from "../src/cmd-feedback.js";

let appdir: string;

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-fb-"));
});

function showed(advertiserId: string, bucket: string) {
  new Store(appdir).writeRenderState({
    lastImpressionAt: 1,
    lastCreative: "C",
    lastAdvertiserId: advertiserId,
    lastBucket: bucket,
  });
}

describe("feedback", () => {
  it("'good' rewards the last-shown advertiser (alpha++) and persists", async () => {
    showed("b", "lang:ts");
    const out = await runFeedback({ appDir: appdir, verdict: "good" });
    expect(out.exitCode).toBe(0);
    expect(out.applied).toBe(true);
    expect(out.advertiserId).toBe("b");
    const state = new Store(appdir).readBandit();
    expect(state["lang:ts"]["b"]).toEqual({ alpha: 2, beta: 1 });
  });

  it("'bad' penalizes the last-shown advertiser (beta++) and persists", async () => {
    showed("b", "lang:ts");
    const out = await runFeedback({ appDir: appdir, verdict: "bad" });
    expect(out.exitCode).toBe(0);
    expect(out.applied).toBe(true);
    const state = new Store(appdir).readBandit();
    expect(state["lang:ts"]["b"]).toEqual({ alpha: 1, beta: 2 });
  });

  it("rejects an invalid verdict (exit 2) and mutates nothing", async () => {
    showed("b", "lang:ts");
    const out = await runFeedback({ appDir: appdir, verdict: "meh" });
    expect(out.exitCode).toBe(2);
    expect(out.applied).toBe(false);
    const state = new Store(appdir).readBandit();
    expect(state).toEqual({}); // untouched
  });

  it("exits 0 without throwing when nothing has been shown yet", async () => {
    const out = await runFeedback({ appDir: appdir, verdict: "good" });
    expect(out.exitCode).toBe(0);
    expect(out.applied).toBe(false);
    expect(out.advertiserId).toBeNull();
  });

  it("treats a v0.1 render state (no advertiser id) as not-yet-attributable", async () => {
    // v0.1 wrote only lastImpressionAt + lastCreative.
    new Store(appdir).writeRenderState({ lastImpressionAt: 1, lastCreative: "C" } as never);
    const out = await runFeedback({ appDir: appdir, verdict: "good" });
    expect(out.exitCode).toBe(0);
    expect(out.applied).toBe(false);
  });

  it("self-heals (never crashes) when bandit.json is malformed", async () => {
    showed("b", "lang:ts");
    writeFileSync(join(appdir, "bandit.json"), "{ not valid json");
    const out = await runFeedback({ appDir: appdir, verdict: "good" });
    expect(out.exitCode).toBe(0);
    expect(out.applied).toBe(true);
    // recovered from empty state, then recorded the new signal
    expect(new Store(appdir).readBandit()["lang:ts"]["b"]).toEqual({ alpha: 2, beta: 1 });
  });

  it("the loop is live: repeated 'good' makes the learned advertiser win the vast majority", async () => {
    showed("b", "lang:ts");
    for (let i = 0; i < 25; i++) await runFeedback({ appDir: appdir, verdict: "good" });
    const state = new Store(appdir).readBandit();
    // Thompson sampling is stochastic per seed; assert the learned preference
    // dominates across many seeds rather than cherry-picking one.
    let bFirst = 0;
    for (let seed = 0n; seed < 50n; seed++) {
      if (SolverBandit.fromJSON(seed, state).rank("lang:ts", ["a", "b"])[0] === "b") bFirst++;
    }
    expect(bFirst).toBeGreaterThan(45); // ~uniform prior on 'a' spikes only rarely
  });
});
