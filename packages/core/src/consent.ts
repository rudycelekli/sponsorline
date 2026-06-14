import { seal, verifySeal, type DeviceKey, type Sealed } from "./crypto.js";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export interface ConsentPayload {
  v: 1;
  id: string;
  grantedSignals: string[]; // coarse families: "lang" | "framework" | "task"
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export type ConsentRecord = Sealed<ConsentPayload>;

export interface CreateConsentInput {
  grantedSignals: string[];
  key: DeviceKey;
  now: number;
  ttlMs: number;
}

export function createConsent(input: CreateConsentInput): ConsentRecord {
  const idSeed = `${input.now}:${input.grantedSignals.join(",")}:${input.key.publicKeyHex}`;
  const id = "c_" + bytesToHex(sha256(utf8ToBytes(idSeed))).slice(0, 16);
  const payload: ConsentPayload = {
    v: 1,
    id,
    grantedSignals: [...input.grantedSignals].sort(),
    issuedAt: input.now,
    expiresAt: input.now + input.ttlMs,
    revokedAt: null,
  };
  return seal(payload, input.key);
}

export function revokeConsent(record: ConsentRecord, key: DeviceKey, now: number): ConsentRecord {
  return seal({ ...record.payload, revokedAt: now }, key);
}

export interface ValidateOpts { publicKeyHex: string; now: number; }
export interface ValidateResult {
  valid: boolean;
  reason?: "signature" | "expired" | "revoked";
}

export function validateConsent(record: ConsentRecord, opts: ValidateOpts): ValidateResult {
  if (!verifySeal(record, opts.publicKeyHex)) return { valid: false, reason: "signature" };
  if (record.payload.revokedAt !== null && opts.now >= record.payload.revokedAt) {
    return { valid: false, reason: "revoked" };
  }
  if (opts.now >= record.payload.expiresAt) return { valid: false, reason: "expired" };
  return { valid: true };
}
