import { describe, it, expect } from "vitest";
import {
  decodeCreative,
  parseCreative,
  COLOR_ALPHABET,
  type EffectCreative,
  type FramesCreative,
  type Rgb,
} from "../src/creative.js";

// Visible text with all ANSI SGR sequences removed — what the eye actually reads.
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const hasAnsi = (s: string) => /\x1b\[/.test(s);

describe("parseCreative", () => {
  it("treats plain text as not animated", () => {
    expect(parseCreative("Try Acme CI")).toBeNull();
  });

  it("treats JSON without the sl tag as not animated", () => {
    expect(parseCreative('{"kind":"effect","text":"hi"}')).toBeNull();
    expect(parseCreative("42")).toBeNull();
  });

  it("parses a tagged effect spec", () => {
    const spec = parseCreative('{"sl":1,"kind":"effect","text":"hi","effect":"none"}');
    expect(spec).not.toBeNull();
    expect((spec as EffectCreative).kind).toBe("effect");
  });

  it("parses a tagged frames spec and rejects malformed ones", () => {
    expect(parseCreative('{"sl":1,"kind":"frames","cols":2,"rows":1,"fps":2,"frames":["ab","cd"]}')).not.toBeNull();
    expect(parseCreative('{"sl":1,"kind":"frames","fps":0,"frames":["x"]}')).toBeNull();
  });
});

describe("decodeCreative — plain creatives", () => {
  it("passes plain text through unchanged when colour is on", () => {
    expect(decodeCreative("Try Acme CI", { nowMs: 0, color: true, oneLine: true })).toBe("Try Acme CI");
  });

  it("truncates plain text to the column budget", () => {
    expect(decodeCreative("abcdefgh", { nowMs: 0, oneLine: true, cols: 4 })).toBe("abcd");
  });

  it("strips control characters from plain text (no terminal hijack)", () => {
    const out = decodeCreative("a\u001b[31mX\u0007b", { nowMs: 0, oneLine: true });
    expect(out).toBe("a[31mXb");
    expect(hasAnsi(out)).toBe(false);
  });
});

describe("decodeCreative — effect kind", () => {
  const eff = (effect: EffectCreative["effect"], extra: Partial<EffectCreative> = {}): string =>
    JSON.stringify({ sl: 1, kind: "effect", text: "Acme CI", effect, ...extra } as EffectCreative);

  it("none emits a base colour and resets, preserving the text", () => {
    const out = decodeCreative(eff("none"), { nowMs: 0, color: true, oneLine: true });
    expect(hasAnsi(out)).toBe(true);
    expect(out.endsWith("\x1b[0m")).toBe(true);
    expect(visible(out)).toBe("Acme CI");
  });

  it("emits no ANSI at all when colour is disabled", () => {
    const out = decodeCreative(eff("pulse"), { nowMs: 500, color: false, oneLine: true });
    expect(hasAnsi(out)).toBe(false);
    expect(out).toBe("Acme CI");
  });

  it("pulse changes the rendered colour over time", () => {
    const a = decodeCreative(eff("pulse"), { nowMs: 0, color: true, oneLine: true });
    const b = decodeCreative(eff("pulse"), { nowMs: 500, color: true, oneLine: true });
    expect(a).not.toBe(b);
    expect(visible(a)).toBe(visible(b)); // same text, different colour only
  });

  it("reduced motion freezes the animation regardless of wall-clock", () => {
    const opts = { color: true, oneLine: true, reducedMotion: true };
    const a = decodeCreative(eff("pulse"), { ...opts, nowMs: 0 });
    const b = decodeCreative(eff("pulse"), { ...opts, nowMs: 500 });
    expect(a).toBe(b);
    expect(visible(a)).toBe("Acme CI");
  });

  it("shimmer moves the highlight but keeps the full text readable", () => {
    const a = decodeCreative(eff("shimmer"), { nowMs: 0, color: true, oneLine: true });
    const b = decodeCreative(eff("shimmer"), { nowMs: 600, color: true, oneLine: true });
    expect(a).not.toBe(b);
    expect(visible(a)).toBe("Acme CI");
    expect(visible(b)).toBe("Acme CI");
  });

  it("typewriter reveals progressively from the start", () => {
    const early = decodeCreative(eff("typewriter"), { nowMs: 0, color: true, oneLine: true });
    const later = decodeCreative(eff("typewriter"), { nowMs: 300, color: true, oneLine: true });
    expect(visible(early)).toBe("A");
    expect(visible(later).length).toBeGreaterThan(visible(early).length);
    expect("Acme CI".startsWith(visible(later))).toBe(true);
  });
});

describe("decodeCreative — frames kind", () => {
  const frames = (): string => {
    const spec: FramesCreative = { sl: 1, kind: "frames", cols: 2, rows: 1, fps: 2, frames: ["AA", "BB", "CC"] };
    return JSON.stringify(spec);
  };

  it("selects the frame by fps and wall-clock", () => {
    // fps 2 => 500ms per frame. t=0 -> frame 0, t=600 -> frame 1, t=1100 -> frame 2.
    expect(decodeCreative(frames(), { nowMs: 0, oneLine: true })).toBe("AA");
    expect(decodeCreative(frames(), { nowMs: 600, oneLine: true })).toBe("BB");
    expect(decodeCreative(frames(), { nowMs: 1100, oneLine: true })).toBe("CC");
  });

  it("loops the frame sequence", () => {
    // 3 frames * 500ms = 1500ms period; t=1600 wraps to frame 0.
    expect(decodeCreative(frames(), { nowMs: 1600, oneLine: true })).toBe("AA");
  });

  it("reduced motion pins to the first frame", () => {
    expect(decodeCreative(frames(), { nowMs: 1100, oneLine: true, reducedMotion: true })).toBe("AA");
  });

  it("collapses a multi-row grid to its first row when oneLine is set", () => {
    const grid: FramesCreative = { sl: 1, kind: "frames", cols: 2, rows: 2, fps: 1, frames: ["AA\nBB"] };
    expect(decodeCreative(JSON.stringify(grid), { nowMs: 0, oneLine: true })).toBe("AA");
    expect(decodeCreative(JSON.stringify(grid), { nowMs: 0 })).toBe("AA\nBB");
  });
});

describe("decodeCreative — frames colour layer", () => {
  // A 2x1 grid with a colour layer: index "A" -> palette[0] red, index "B" -> palette[1] green.
  const colored = (): string => {
    const spec: FramesCreative = {
      sl: 1,
      kind: "frames",
      cols: 2,
      rows: 1,
      fps: 2,
      frames: ["##", "##"],
      palette: [
        [255, 0, 0],
        [0, 255, 0],
      ],
      colors: ["AB", "BA"],
    };
    return JSON.stringify(spec);
  };

  it("emits ANSI from the palette when colour is on, and the visible glyphs are unchanged", () => {
    const out = decodeCreative(colored(), { nowMs: 0, colorLevel: "truecolor" });
    expect(hasAnsi(out)).toBe(true);
    expect(visible(out)).toBe("##");
    // frame 0 colours: cell0=red, cell1=green
    expect(out).toContain("\x1b[38;2;255;0;0m");
    expect(out).toContain("\x1b[38;2;0;255;0m");
  });

  it("emits NO ANSI at colour level none, just the grayscale glyphs", () => {
    const out = decodeCreative(colored(), { nowMs: 0, colorLevel: "none" });
    expect(hasAnsi(out)).toBe(false);
    expect(out).toBe("##");
  });

  it("downsamples to 256-colour escapes at the ansi256 level (never truecolor)", () => {
    const out = decodeCreative(colored(), { nowMs: 0, colorLevel: "ansi256" });
    expect(out).toContain("\x1b[38;5;");
    expect(out).not.toContain("\x1b[38;2;");
    expect(visible(out)).toBe("##");
  });

  it("colourises the collapsed first row under oneLine without changing the visible text", () => {
    const out = decodeCreative(colored(), { nowMs: 0, oneLine: true, cols: 2, colorLevel: "truecolor" });
    expect(hasAnsi(out)).toBe(true);
    expect(visible(out)).toBe("##");
  });

  it("addresses palette indices beyond 64 via the extended alphabet", () => {
    // The first 64 alphabet entries are base64; index 64 is the first extended char. Build a
    // palette big enough to need it and point a cell at exactly index 64.
    const palette: Rgb[] = Array.from({ length: 70 }, (_, i) => [i, 0, 0] as Rgb);
    palette[64] = [7, 200, 13];
    const ch64 = COLOR_ALPHABET[64];
    expect(ch64).toBe("\u0100"); // first extended code point, a single BMP unit
    const spec: FramesCreative = {
      sl: 1,
      kind: "frames",
      cols: 1,
      rows: 1,
      fps: 1,
      frames: ["#"],
      palette,
      colors: [ch64],
    };
    const out = decodeCreative(JSON.stringify(spec), { nowMs: 0, colorLevel: "truecolor" });
    expect(visible(out)).toBe("#");
    expect(out).toContain("\x1b[38;2;7;200;13m"); // resolved to palette[64], not a base64 index
  });
});
