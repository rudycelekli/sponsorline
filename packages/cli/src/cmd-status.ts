import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateConsent, type ConsentRecord, type KycStatus } from "@sponsorline/core";
import { Store } from "./store.js";
import { runPayout } from "./cmd-payout.js";

// Pilot-diagnostic readiness probe: "is Sponsorline actually wired up on this
// machine?" Every check degrades gracefully — a malformed local file flips its
// own check to false and is reported, never thrown (the never-crash contract that
// governs every command that touches on-device state).

export interface StatusCheck {
  name: "cli" | "statusline" | "consent" | "inventory";
  ok: boolean;
  detail: string;
}

export interface StatusInput {
  appDir: string;
  salt: string;
  settingsPath: string;
  now: number;
  cliOnPath: boolean;
}

export interface PayoutSummary {
  kycStatus: KycStatus;
  payableCents: number;
  eligible: boolean;
}

export interface StatusResult {
  ready: boolean; // ready to EARN (the 4 checks). Payout readiness is separate, below.
  exitCode: number;
  checks: StatusCheck[];
  payout: PayoutSummary; // informational — getting paid is gated on KYC, not on earning
  nextStep: string; // the single most useful action to take right now
}

function checkStatusline(settingsPath: string): StatusCheck {
  if (!existsSync(settingsPath)) {
    return { name: "statusline", ok: false, detail: "no settings.json — run `sponsorline init`" };
  }
  try {
    const s = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      statusLine?: { type?: string; command?: string };
    };
    const sl = s.statusLine;
    const ok = sl?.type === "command" && typeof sl.command === "string" && sl.command.includes("sponsorline statusline");
    return {
      name: "statusline",
      ok,
      detail: ok ? "statusLine hook points at sponsorline" : "statusLine not wired to `sponsorline statusline`",
    };
  } catch {
    return { name: "statusline", ok: false, detail: "settings.json is malformed JSON" };
  }
}

function checkConsent(appDir: string, now: number): StatusCheck {
  try {
    const store = new Store(appDir);
    const consent = store.readConsent();
    const pubKey = store.readPubKey();
    if (!consent || !pubKey) {
      return { name: "consent", ok: false, detail: "no consent on file — run `sponsorline init`" };
    }
    const v = validateConsent(consent as ConsentRecord, { publicKeyHex: pubKey, now });
    return {
      name: "consent",
      ok: v.valid,
      detail: v.valid ? "consent is valid" : `consent invalid: ${v.reason}`,
    };
  } catch {
    return { name: "consent", ok: false, detail: "consent.json is malformed" };
  }
}

function checkInventory(appDir: string): StatusCheck {
  const f = join(appDir, "inventory.json");
  if (!existsSync(f)) {
    return { name: "inventory", ok: false, detail: "no inventory.json — no sponsor lines will appear" };
  }
  try {
    const items = JSON.parse(readFileSync(f, "utf8")) as unknown[];
    const ok = Array.isArray(items) && items.length > 0;
    return { name: "inventory", ok, detail: ok ? `${items.length} inventory item(s)` : "inventory is empty" };
  } catch {
    return { name: "inventory", ok: false, detail: "inventory.json is malformed" };
  }
}

// The single most useful next action, computed from the readiness checks first
// (you cannot earn until you are wired up) and then payout readiness (you cannot get
// paid until KYC clears). This is the heart of the onboarding flow: a developer should
// never have to guess what to do next.
function computeNextStep(checks: StatusCheck[], payout: PayoutSummary): string {
  const failed = checks.find((c) => !c.ok);
  if (failed) {
    switch (failed.name) {
      case "cli": return "Install sponsorline on your PATH (`npm link` or install globally), then re-run `sponsorline status`.";
      case "statusline": return "Run `sponsorline init` to wire the status line into your editor.";
      case "consent": return "Run `sponsorline init` to grant consent and start earning.";
      case "inventory": return "You're wired up. No sponsors are available yet — nothing to do; your status line earns as inventory arrives.";
    }
  }
  // Fully wired and earning. Steer toward getting paid.
  if (payout.eligible) return `You're earning and eligible for payout — withdraw your ${payout.payableCents}c balance.`;
  if (payout.kycStatus !== "verified" && payout.payableCents > 0) return "You're earning. Verify your identity (`sponsorline payout`) to enable withdrawals.";
  return "You're earning. Run `sponsorline earnings` to see your balance.";
}

export function runStatus(input: StatusInput): StatusResult {
  const checks: StatusCheck[] = [
    {
      name: "cli",
      ok: input.cliOnPath,
      detail: input.cliOnPath ? "sponsorline resolves on PATH" : "sponsorline not on PATH — `npm link` or install globally",
    },
    checkStatusline(input.settingsPath),
    checkConsent(input.appDir, input.now),
    checkInventory(input.appDir),
  ];
  const ready = checks.every((c) => c.ok);
  const p = runPayout({ appDir: input.appDir, salt: input.salt });
  const payout: PayoutSummary = { kycStatus: p.kycStatus, payableCents: p.payableCents, eligible: p.eligible };
  const nextStep = computeNextStep(checks, payout);
  return { ready, exitCode: ready ? 0 : 1, checks, payout, nextStep };
}
