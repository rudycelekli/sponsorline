import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deriveDeviceKey, revokeConsent } from "@effinai/sponsorline-core";
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
  // The kill switch must never fail. Consent is revoked above — that is the real
  // protection (a revoked consent makes statusline emit the plain line regardless
  // of config). Removing the statusLine block is best-effort: if settings.json is
  // missing or malformed, leave it untouched rather than clobber unparseable user
  // settings, and never throw out of the one command a user runs to opt out.
  try {
    if (existsSync(input.settingsPath)) {
      const settings = JSON.parse(readFileSync(input.settingsPath, "utf8")) as Record<string, unknown>;
      delete settings.statusLine;
      writeFileSync(input.settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch { /* malformed settings — consent revocation already disabled ads */ }
  return 0;
}
