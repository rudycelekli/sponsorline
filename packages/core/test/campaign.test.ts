import { describe, it, expect } from "vitest";
import { validateCampaign, campaignToBidder, isCampaignLive, type Campaign } from "../src/campaign.js";

const base: Campaign = {
  id: "acme-ci",
  advertiser: "Acme CI",
  creative: "Acme CI — fast TS builds",
  bidCents: 500,
  budgetCents: 50_000,
  targetSignals: ["lang:ts"],
  startsAt: 0,
  endsAt: 1_000_000,
};

const POLICY = { reserveCents: 100, maxCreative: 120 };

describe("validateCampaign", () => {
  it("accepts a well-formed campaign", () => {
    const v = validateCampaign(base, POLICY);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects a bid below the reserve", () => {
    const v = validateCampaign({ ...base, bidCents: 50 }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/reserve|bid/i);
  });

  it("rejects a budget smaller than a single bid", () => {
    const v = validateCampaign({ ...base, budgetCents: 100 }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/budget/i);
  });

  it("rejects a creative with control characters (statusline-injection guard)", () => {
    const v = validateCampaign({ ...base, creative: "evil\u001b[2Jline" }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/control/i);
  });

  it("rejects a creative over the length cap", () => {
    const v = validateCampaign({ ...base, creative: "x".repeat(200) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/length|chars/i);
  });

  it("rejects an inverted flight window", () => {
    const v = validateCampaign({ ...base, startsAt: 100, endsAt: 50 }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/window|flight|end/i);
  });

  it("rejects a non-allowlisted target predicate", () => {
    const v = validateCampaign({ ...base, target: { atom: "email:leak" }, targetSignals: undefined }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/predicate|allowlist/i);
  });

  it("requires either a predicate or legacy targetSignals", () => {
    const v = validateCampaign({ ...base, target: undefined, targetSignals: undefined }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/target/i);
  });
});

describe("validateCampaign — animated creatives", () => {
  const effect = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({ sl: 1, kind: "effect", text: "Acme CI", effect: "pulse", ...over });
  const frames = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({ sl: 1, kind: "frames", cols: 2, rows: 1, fps: 4, frames: ["AA", "BB"], ...over });
  // Frames are opt-in inventory (Item 5); enable them for the frames-specific structural tests.
  const FRAMES_POLICY = { ...POLICY, allowFrames: true };

  it("accepts a well-formed effect creative", () => {
    const v = validateCampaign({ ...base, creative: effect() }, POLICY);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("accepts a well-formed frames creative when frames are enabled", () => {
    const v = validateCampaign({ ...base, creative: frames() }, FRAMES_POLICY);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects a frames creative when frames are not enabled (default off)", () => {
    const v = validateCampaign({ ...base, creative: frames() }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/not enabled|allowFrames/i);
  });

  it("rejects an effect outside the allowlist", () => {
    const v = validateCampaign({ ...base, creative: effect({ effect: "explode" }) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/effect .*not allowed/i);
  });

  it("rejects effect text over the length cap", () => {
    const v = validateCampaign({ ...base, creative: effect({ text: "x".repeat(200) }) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/effect text exceeds/i);
  });

  it("rejects control characters in the inner effect text", () => {
    const v = validateCampaign({ ...base, creative: effect({ text: "evil\u001b[2Jx" }) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/control/i);
  });

  it("rejects a malformed fg triple", () => {
    const v = validateCampaign({ ...base, creative: effect({ fg: [255, 0] }) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/fg/i);
  });

  it("rejects an out-of-range loopMs", () => {
    const v = validateCampaign({ ...base, creative: effect({ loopMs: -5 }) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/loopMs/i);
  });

  it("rejects an fps above the cap", () => {
    const v = validateCampaign({ ...base, creative: frames({ fps: 120 }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/fps/i);
  });

  it("rejects too many frames", () => {
    const many = Array.from({ length: 300 }, () => "AA");
    const v = validateCampaign({ ...base, creative: frames({ frames: many }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/frame.*cap/i);
  });

  it("rejects a frame wider than the declared grid", () => {
    const v = validateCampaign({ ...base, creative: frames({ frames: ["AAAA", "BB"] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/wider than .* cols/i);
  });

  it("rejects a frame with more rows than declared", () => {
    const v = validateCampaign({ ...base, creative: frames({ rows: 1, frames: ["AA\nBB"] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/more than .* rows/i);
  });

  it("rejects control characters inside a frame (but allows newlines)", () => {
    const v = validateCampaign({ ...base, creative: frames({ rows: 2, frames: ["AA\u0007", "BB"] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/control/i);
  });

  it("rejects a frames spec exceeding the animated byte cap", () => {
    const big = Array.from({ length: 50 }, () => "A".repeat(20));
    const v = validateCampaign({ ...base, creative: frames({ cols: 20, frames: big }) }, { ...FRAMES_POLICY, maxAnimatedChars: 100 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/animated creative exceeds/i);
  });

  it("rejects a strobing frames creative (WCAG 2.3.1 flash-safety)", () => {
    // A dark grid alternating with a fully-lit grid at 30fps flashes ~15 times/sec.
    const v = validateCampaign({ ...base, creative: frames({ cols: 2, rows: 1, fps: 30, frames: ["  ", "\u2588\u2588"] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/flash/i);
  });

  it("rejects a pulse with a strobe-fast loop (WCAG 2.3.1 flash-safety)", () => {
    const v = validateCampaign({ ...base, creative: effect({ effect: "pulse", loopMs: 1 }) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/flash|loopMs/i);
  });

  it("rejects a malformed sl:1 spec instead of serving it as plain text", () => {
    const v = validateCampaign({ ...base, creative: '{"sl":1,"kind":"frames","fps":0,"frames":["x"]}' }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/malformed animated spec/i);
  });

  it("still treats untagged JSON as plain text under the plain rules", () => {
    const v = validateCampaign({ ...base, creative: '{"kind":"effect","text":"hi"}' }, POLICY);
    expect(v.ok).toBe(true);
  });
});

describe("validateCampaign — frames colour layer", () => {
  const FRAMES_POLICY = { ...POLICY, allowFrames: true };
  // A 2x1 colour frames creative: palette of two colours, index grids parallel to frames.
  const colored = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      sl: 1,
      kind: "frames",
      cols: 2,
      rows: 1,
      fps: 4,
      frames: ["##", "##"],
      palette: [
        [255, 0, 0],
        [0, 255, 0],
      ],
      colors: ["AB", "BA"],
      ...over,
    });

  it("accepts a well-formed colour layer", () => {
    const v = validateCampaign({ ...base, creative: colored() }, FRAMES_POLICY);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects a palette entry that is not an rgb triple", () => {
    const v = validateCampaign({ ...base, creative: colored({ palette: [[255, 0, 0], [0, 300, 0]] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/palette entries must be/i);
  });

  it("rejects colors whose length does not match frames", () => {
    const v = validateCampaign({ ...base, creative: colored({ colors: ["AB"] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/parallel to frames/i);
  });

  it("rejects an index that points outside the palette", () => {
    // "C" is alphabet index 2, but the palette has only 2 entries (0,1).
    const v = validateCampaign({ ...base, creative: colored({ colors: ["AC", "BA"] }) }, FRAMES_POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/index outside/i);
  });

  it("rejects a palette over the configured cap", () => {
    const big = Array.from({ length: 5 }, () => [1, 1, 1]);
    const v = validateCampaign({ ...base, creative: colored({ palette: big }) }, { ...FRAMES_POLICY, maxPalette: 4 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/palette exceeds/i);
  });

  it("catches a colour-only strobe that glyph occupancy alone would miss (WCAG 2.3.1)", () => {
    // Identical glyphs every frame (same occupancy), but the colour flips between black and
    // white at 30fps — invisible to a glyph-occupancy metric, caught by palette luminance.
    const v = validateCampaign(
      {
        ...base,
        creative: JSON.stringify({
          sl: 1,
          kind: "frames",
          cols: 2,
          rows: 1,
          fps: 30,
          frames: ["##", "##"],
          palette: [
            [0, 0, 0],
            [255, 255, 255],
          ],
          colors: ["AA", "BB"],
        }),
      },
      FRAMES_POLICY,
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/flash/i);
  });
});

describe("campaignToBidder", () => {
  it("maps a campaign into the auction Bidder shape", () => {
    const b = campaignToBidder(base);
    expect(b).toMatchObject({ id: "acme-ci", bidCents: 500, creative: "Acme CI — fast TS builds", targetSignals: ["lang:ts"] });
  });

  it("carries a precise predicate through when present", () => {
    const b = campaignToBidder({ ...base, target: { atom: "lang:ts" } });
    expect(b.target).toEqual({ atom: "lang:ts" });
  });
});

describe("isCampaignLive", () => {
  it("is live inside the flight window with budget remaining", () => {
    expect(isCampaignLive(base, 500, 0)).toBe(true);
    expect(isCampaignLive(base, 500, 49_000)).toBe(true);
  });

  it("is not live before it starts or after it ends", () => {
    expect(isCampaignLive({ ...base, startsAt: 1000 }, 500, 0)).toBe(false);
    expect(isCampaignLive(base, 1_000_000, 0)).toBe(false);
  });

  it("is not live once spend meets or exceeds budget", () => {
    expect(isCampaignLive(base, 500, 50_000)).toBe(false);
    expect(isCampaignLive(base, 500, 60_000)).toBe(false);
  });
});
