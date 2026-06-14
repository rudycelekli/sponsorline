import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { deriveDeviceKey, createConsent } from "@sponsorline/core";
import { Store } from "./store.js";

export interface InitInput {
  appDir: string;
  settingsPath: string;
  acceptDefaults: boolean;
  now: number;
  ttlMs: number;
}

const DEFAULT_SIGNALS = ["lang", "framework", "task"];

function ensureSalt(appDir: string): string {
  mkdirSync(appDir, { recursive: true });
  const saltPath = join(appDir, "salt");
  if (existsSync(saltPath)) return readFileSync(saltPath, "utf8");
  const salt = randomBytes(32).toString("hex");
  writeFileSync(saltPath, salt);
  return salt;
}

export async function runInit(input: InitInput): Promise<number> {
  const salt = ensureSalt(input.appDir);
  const key = deriveDeviceKey(salt);
  const store = new Store(input.appDir);
  store.writeConsent(createConsent({ grantedSignals: DEFAULT_SIGNALS, key, now: input.now, ttlMs: input.ttlMs }));

  mkdirSync(dirname(input.settingsPath), { recursive: true });
  const settings = existsSync(input.settingsPath)
    ? (JSON.parse(readFileSync(input.settingsPath, "utf8")) as Record<string, unknown>)
    : {};
  settings.statusLine = { type: "command", command: "sponsorline statusline" };
  writeFileSync(input.settingsPath, JSON.stringify(settings, null, 2));
  return 0;
}
