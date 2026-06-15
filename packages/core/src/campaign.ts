import { validatePredicate, type TargetPredicate } from "./targeting.js";
import { parseCreative, type AnimatedCreative, type CreativeEffect, type Rgb } from "./creative.js";
import type { Bidder } from "./auction.js";

// A marketer-facing campaign: richer than the raw auction Bidder. It carries the
// advertiser identity, a spend budget, and a flight window so a marketer can run a
// bounded, self-serve campaign that flows into the same deterministic auction the
// device already runs. Targeting stays inside the allowlisted taxonomy — a campaign
// can never name anything outside it, so it cannot be used to probe raw context.

export interface Campaign {
  id: string;
  advertiser: string; // marketer display identity (shown in reports, never to the dev)
  creative: string; // the sponsor line rendered on-device
  bidCents: number; // integer cents, must clear the reserve
  budgetCents: number; // integer cents, total spend cap across all impressions
  target?: TargetPredicate; // precise boolean targeting; takes precedence
  targetSignals?: string[]; // legacy ANY-intersection fallback
  startsAt: number; // inclusive flight start (ms epoch)
  endsAt: number; // exclusive flight end (ms epoch)
}

export interface CampaignPolicy {
  reserveCents: number;
  maxCreative: number; // cap for a plain creative AND the inner text of an effect creative
  // Animated creatives carry extra attack surface (more bytes, motion, colour), so they get
  // their own safety bounds. All optional; sane defaults apply so existing callers keep
  // working unchanged. These are limits, not a pricing tier — animation is not premium.
  maxAnimatedChars?: number; // cap on the whole animated spec JSON string (default 4096)
  maxFrames?: number; // cap on frame count for a frames creative (default 240)
  maxFrameChars?: number; // cap on the chars of a single frame (default 1024)
  maxFps?: number; // upper fps bound for a frames creative (default 30)
  maxGrid?: number; // upper bound on cols/rows for a frames creative (default 200)
  allowFrames?: boolean; // frames are opt-in inventory; default false (effect creatives always allowed)
}

export interface CampaignValidation {
  ok: boolean;
  errors: string[];
}

// The only effects a campaign may name. parseCreative accepts any `kind:"effect"` spec
// with a string `text`, so the allowlist is enforced here at the marketer-facing gate.
const ALLOWED_EFFECTS: ReadonlySet<CreativeEffect> = new Set(["none", "pulse", "shimmer", "typewriter"]);

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/; // every C0/C1 control char incl. newline
const CONTROL_CHARS_KEEP_NL = /[\u0000-\u0009\u000B-\u001F\u007F]/; // control chars except "\n"

// WCAG 2.3.1 (general flash threshold): nothing may flash more than 3 times/sec. We
// enforce that at the marketer gate so an unsafe creative can never be sealed, not just
// suppressed at render time.
const MIN_FLASH_PERIOD_MS = 333; // a pulse modulates whole-line brightness; floor its period at ~3 cycles/sec
const MAX_FLASHES_PER_SEC = 3; // ceiling on bright transitions for a looping frames creative
const FLASH_LUMINANCE_DELTA = 0.1; // minimum luminance jump that counts as a flash edge

function isRgb(v: unknown): v is Rgb {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

// Approximate a frame's relative luminance as the share of non-space cells: an all-filled
// grid reads as "bright", an all-space grid as "dark". Newlines (row separators) are not
// cells and are ignored. This is a proxy, not photometry, but it catches the strobe shape
// a flash attack needs: alternating dark and bright grids.
function frameLuminance(frame: string): number {
  let total = 0;
  let lit = 0;
  for (const ch of frame) {
    if (ch === "\n") continue;
    total += 1;
    if (ch !== " ") lit += 1;
  }
  return total === 0 ? 0 : lit / total;
}

// Estimate how many times a looping frames creative flashes bright per second. A flash
// needs a rising luminance edge, so we count edges where luminance jumps by more than the
// delta threshold, including the wraparound from the last frame back to the first (the loop
// repeats forever), then scale by how many times the whole loop plays each second.
function flashesPerSecond(frames: string[], fps: number): number {
  if (frames.length < 2 || !(fps > 0)) return 0;
  const lum = frames.map(frameLuminance);
  let risingEdges = 0;
  for (let i = 0; i < lum.length; i++) {
    const next = lum[(i + 1) % lum.length];
    if (next - lum[i] > FLASH_LUMINANCE_DELTA) risingEdges += 1;
  }
  const loopsPerSecond = fps / frames.length;
  return risingEdges * loopsPerSecond;
}

// Does this string at least CLAIM to be a tagged creative? Used to tell a genuinely
// plain text line apart from a malformed `sl:1` spec, so the marketer gets an actionable
// "your animation is malformed" error instead of having raw JSON served as plain text.
function looksTagged(creative: string): boolean {
  try {
    const v = JSON.parse(creative);
    return typeof v === "object" && v !== null && (v as Record<string, unknown>).sl === 1;
  } catch {
    return false;
  }
}

// Validate an animated creative's INNER content. The outer string already passed JSON
// parse via parseCreative; here we bound size, effect names, grid geometry, and reject
// control characters in the inner text/frames so what a marketer submits is exactly what
// serves (the decoder is defensive, but we keep sealed inventory clean at the source).
function validateAnimated(spec: AnimatedCreative, creative: string, policy: CampaignPolicy, errors: string[]): void {
  const maxAnimated = policy.maxAnimatedChars ?? 4096;
  if (creative.length > maxAnimated) errors.push(`animated creative exceeds ${maxAnimated} chars`);

  if (spec.kind === "effect") {
    if (!ALLOWED_EFFECTS.has(spec.effect)) errors.push(`effect "${spec.effect}" is not allowed`);
    if (spec.text.length === 0) errors.push("effect text must be non-empty");
    if (spec.text.length > policy.maxCreative) errors.push(`effect text exceeds ${policy.maxCreative} chars`);
    if (CONTROL_CHARS.test(spec.text)) errors.push("effect text contains control characters");
    if (spec.fg !== undefined && !isRgb(spec.fg)) errors.push("fg must be an [r,g,b] triple of integers 0-255");
    if (spec.loopMs !== undefined && (!Number.isFinite(spec.loopMs) || spec.loopMs <= 0 || spec.loopMs > 60_000)) {
      errors.push("loopMs must be a positive number <= 60000");
    }
    // A pulse modulates the whole line's brightness once per loop, so a short period
    // strobes. Floor it at MIN_FLASH_PERIOD_MS (WCAG 2.3.1). An omitted loopMs uses a safe
    // 2000ms default, so this only catches an explicit too-fast value.
    if (
      spec.effect === "pulse" &&
      spec.loopMs !== undefined &&
      Number.isFinite(spec.loopMs) &&
      spec.loopMs > 0 &&
      spec.loopMs < MIN_FLASH_PERIOD_MS
    ) {
      errors.push(`loopMs must be >= ${MIN_FLASH_PERIOD_MS} for a pulse effect (flash-safety, WCAG 2.3.1)`);
    }
    return;
  }

  // frames kind
  // Frames are opt-in inventory: a multi-row animated grid is a far bigger surface than a
  // single status line, and most hosts never render it. Off by default; a campaign may only
  // use frames where the policy explicitly enables them. We still run every structural check
  // below so the marketer sees all problems at once, not just the gate.
  if (!(policy.allowFrames ?? false)) {
    errors.push("frames creatives are not enabled for this inventory (allowFrames is off)");
  }
  const maxFrames = policy.maxFrames ?? 240;
  const maxFrameChars = policy.maxFrameChars ?? 1024;
  const maxFps = policy.maxFps ?? 30;
  const maxGrid = policy.maxGrid ?? 200;

  if (!Number.isInteger(spec.cols) || spec.cols <= 0 || spec.cols > maxGrid) errors.push(`cols must be an integer in 1..${maxGrid}`);
  if (!Number.isInteger(spec.rows) || spec.rows <= 0 || spec.rows > maxGrid) errors.push(`rows must be an integer in 1..${maxGrid}`);
  if (!(spec.fps > 0 && spec.fps <= maxFps)) errors.push(`fps must be in (0, ${maxFps}]`);
  if (spec.frames.length === 0) errors.push("frames must contain at least one frame");
  if (spec.frames.length > maxFrames) errors.push(`frames exceed the ${maxFrames}-frame cap`);

  for (let i = 0; i < spec.frames.length; i++) {
    const f = spec.frames[i];
    if (f.length > maxFrameChars) {
      errors.push(`frame ${i} exceeds ${maxFrameChars} chars`);
      continue;
    }
    // Newlines separate grid rows and are allowed; any other control char is a hijack risk.
    if (CONTROL_CHARS_KEEP_NL.test(f)) errors.push(`frame ${i} contains control characters`);
    const rows = f.split("\n");
    if (Number.isInteger(spec.rows) && rows.length > spec.rows) errors.push(`frame ${i} has more than ${spec.rows} rows`);
    if (Number.isInteger(spec.cols) && rows.some((r) => [...r].length > spec.cols)) {
      errors.push(`frame ${i} has a row wider than ${spec.cols} cols`);
    }
  }

  // WCAG 2.3.1 flash-safety: a frames creative that alternates dark and bright grids is a
  // strobe. Estimate its flash rate at the declared fps and reject anything over the limit
  // so an epileptogenic creative can never be sealed into inventory.
  const flashes = flashesPerSecond(spec.frames, spec.fps);
  if (flashes > MAX_FLASHES_PER_SEC) {
    errors.push(
      `frames flash ${flashes.toFixed(1)} times/sec, over the ${MAX_FLASHES_PER_SEC}/sec flash-safety limit (WCAG 2.3.1)`,
    );
  }
}

export function validateCampaign(c: Campaign, policy: CampaignPolicy): CampaignValidation {
  const errors: string[] = [];

  if (typeof c.id !== "string" || c.id.length === 0) errors.push("campaign id must be a non-empty string");
  if (typeof c.advertiser !== "string" || c.advertiser.length === 0) errors.push("advertiser must be a non-empty string");

  if (typeof c.creative !== "string") {
    errors.push("creative must be a string");
  } else {
    const spec = parseCreative(c.creative);
    if (spec !== null) {
      // Animated creative: validate the inner spec against its safety bounds, not the
      // JSON wrapper. Same control-char / length boundary as plain text, plus motion limits.
      validateAnimated(spec, c.creative, policy, errors);
    } else if (looksTagged(c.creative)) {
      // It claims `sl:1` but did not parse into a valid effect/frames spec. Reject with a
      // clear message rather than silently serving the raw JSON as plain text.
      errors.push("creative is a malformed animated spec (sl:1 but not a valid effect/frames creative)");
    } else {
      // Plain text creative. It is rendered straight into the terminal status line — reject
      // control characters so a campaign cannot inject newlines (breaking the one-line
      // contract) or ANSI escape sequences (terminal hijack). Same boundary as inventory.
      if (c.creative.length > policy.maxCreative) errors.push(`creative exceeds ${policy.maxCreative} chars`);
      if (CONTROL_CHARS.test(c.creative)) errors.push("creative contains control characters");
    }
  }

  if (!Number.isInteger(c.bidCents) || c.bidCents < policy.reserveCents) {
    errors.push(`bidCents must be an integer >= reserve (${policy.reserveCents})`);
  }
  if (!Number.isInteger(c.budgetCents) || c.budgetCents < c.bidCents) {
    errors.push("budgetCents must be an integer >= bidCents (at least one impression of headroom)");
  }

  if (!Number.isFinite(c.startsAt) || !Number.isFinite(c.endsAt) || c.endsAt <= c.startsAt) {
    errors.push("flight window invalid: endsAt must be greater than startsAt");
  }

  const hasPredicate = c.target !== undefined;
  const hasLegacy = Array.isArray(c.targetSignals) && c.targetSignals.length > 0;
  if (!hasPredicate && !hasLegacy) {
    errors.push("campaign must specify a target predicate or non-empty targetSignals");
  }
  if (hasPredicate) {
    const v = validatePredicate(c.target as TargetPredicate);
    if (!v.ok) errors.push(`invalid target predicate: ${v.errors.join("; ")}`);
  }

  return { ok: errors.length === 0, errors };
}

// Project a campaign onto the auction's Bidder shape so it competes in the same
// deterministic Vickrey auction as any other inventory.
export function campaignToBidder(c: Campaign): Bidder {
  return {
    id: c.id,
    bidCents: c.bidCents,
    targetSignals: c.targetSignals ? [...c.targetSignals] : [],
    creative: c.creative,
    ...(c.target !== undefined ? { target: c.target } : {}),
  };
}

// A campaign is eligible to serve only inside its flight window and while it has
// budget left. spentCents is the campaign's reported spend so far (from receipts).
export function isCampaignLive(c: Campaign, now: number, spentCents: number): boolean {
  if (now < c.startsAt || now >= c.endsAt) return false;
  if (spentCents >= c.budgetCents) return false;
  return true;
}
