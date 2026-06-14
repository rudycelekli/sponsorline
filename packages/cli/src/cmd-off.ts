import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deriveDeviceKey, revokeConsent } from "@sponsorline/core";
import { Store } from "./store.js";

export interface OffInput { appDir: string; settingsPath: string; now: number; }

export async function runOff(input: OffInput): Promise<number> {
  const store = new Store(input.appDir);
  const consent = store.readConsent();
  const saltPath = join(input.appDir, "salt");
  if (consent && existsSync(saltPath)) {
    const key = deriveDeviceKey(readFileSync(saltPath, "utf8"));
    store.writeConsent(revokeConsent(consent, key, input.now));
  }
  if (existsSync(input.settingsPath)) {
    const settings = JSON.parse(readFileSync(input.settingsPath, "utf8")) as Record<string, unknown>;
    delete settings.statusLine;
    writeFileSync(input.settingsPath, JSON.stringify(settings, null, 2));
  }
  return 0;
}
