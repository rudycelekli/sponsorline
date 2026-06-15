import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { deriveDeviceKey, createConsent } from "@effinai/sponsorline-core";
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
  // The salt is the Ed25519 private-key seed. Restrict to owner-only so another
  // local user cannot read it and forge impressions under this device key.
  writeFileSync(saltPath, salt, { mode: 0o600 });
  chmodSync(saltPath, 0o600); // enforce even if a loose umask widened the create mode
  return salt;
}

export async function runInit(input: InitInput): Promise<number> {
  const salt = ensureSalt(input.appDir);
  const key = deriveDeviceKey(salt);
  const store = new Store(input.appDir);
  // Publish the public key as the verification trust anchor. The salt (private-key
  // seed) stays on-device and is never required to verify.
  store.writePubKey(key.publicKeyHex);
  // Consent is minted exactly once. Re-running init must never overwrite an
  // existing consent: doing so would orphan the prior witness history (its
  // consentId would no longer match) and — worse — silently resurrect ads the
  // user had revoked via `off`. Re-granting after revoke is a deliberate future
  // action, not a side effect of re-init.
  if (!store.readConsent()) {
    store.writeConsent(createConsent({ grantedSignals: DEFAULT_SIGNALS, key, now: input.now, ttlMs: input.ttlMs }));
  }

  mkdirSync(dirname(input.settingsPath), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(input.settingsPath)) {
    // init must merge into the existing Claude Code settings to preserve the
    // user's other keys. If the file is malformed we must NOT clobber it (that
    // would destroy their config) and must NOT dump a stack trace on the very
    // first command — fail with a clear, actionable message and touch nothing.
    try {
      settings = JSON.parse(readFileSync(input.settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Cannot parse ${input.settingsPath}: it is not valid JSON. Fix or remove that file, then re-run 'sponsorline init'. Your settings were left untouched.`,
      );
    }
  }
  settings.statusLine = { type: "command", command: "sponsorline statusline" };
  writeFileSync(input.settingsPath, JSON.stringify(settings, null, 2));
  return 0;
}
