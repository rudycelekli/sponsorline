import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateConsent, type ConsentRecord } from "@sponsorline/core";
import { Store } from "./store.js";

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

export interface StatusResult {
  ready: boolean;
  exitCode: number;
  checks: StatusCheck[];
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
  return { ready, exitCode: ready ? 0 : 1, checks };
}
