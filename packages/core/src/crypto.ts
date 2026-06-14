import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

// @noble/ed25519 v2 requires a sync sha512 to be wired for sync APIs.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface DeviceKey {
  privateKey: Uint8Array;
  publicKeyHex: string;
}

export interface Sealed<T> {
  payload: T;
  sig: string; // hex
}

export function deriveDeviceKey(salt: string): DeviceKey {
  const privateKey = sha256(utf8ToBytes(`sponsorline-device-key:${salt}`)); // 32 bytes
  const publicKey = ed.getPublicKey(privateKey);
  return { privateKey, publicKeyHex: bytesToHex(publicKey) };
}

function canonicalBytes(payload: unknown): Uint8Array {
  return utf8ToBytes(JSON.stringify(payload));
}

export function seal<T>(payload: T, key: DeviceKey): Sealed<T> {
  const sig = ed.sign(canonicalBytes(payload), key.privateKey);
  return { payload, sig: bytesToHex(sig) };
}

export function verifySeal<T>(sealed: Sealed<T>, publicKeyHex: string): boolean {
  try {
    return ed.verify(hexToBytes(sealed.sig), canonicalBytes(sealed.payload), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

// Content hash of a payload, used to hash-chain the witness log. Each impression
// embeds the previous payload's chainHash, so a single signature over the HEAD
// payload transitively authenticates the entire ordered history — verification
// is O(n) cheap hashing + ONE Ed25519 check instead of O(n) signature checks.
export function chainHash(payload: unknown): string {
  return bytesToHex(sha256(canonicalBytes(payload)));
}
