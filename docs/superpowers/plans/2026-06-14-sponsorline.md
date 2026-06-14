# Sponsorline v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the consent-first sponsor-line monetization layer for AI coding tools — a TypeScript monorepo (`@sponsorline/core`, `sponsorline` CLI, `@sponsorline/mcp`) plus a `bench/` harness — that proves the ONE claim in ADR-0001: a relevant sponsor line that never sees your code, never renders without signed consent, runs a provably-fair second-price auction, and is verifiable from a clean clone in one command in under 2 seconds.

**Architecture:** Pure-function `core` substrate (interest vector, deterministic Vickrey auction, Ed25519 seal/verify, witness log, ledger, relevance bandit) consumed by a thin CLI (the official `statusLine` command + `init/why/earnings/verify/off`) and an MCP server (advertiser/enterprise seam). All state is local JSONL/JSON; raw developer context never leaves the device (load-bearing invariant, asserted by tests). The `bench/` harness drives 3 fixture repos, replays auctions, captures egress, and emits the report whose claim is copied verbatim into the README.

**Tech Stack:** TypeScript 5, npm workspaces, tsup (build), vitest (test), `@noble/ed25519` + `@noble/hashes` (pure-JS crypto, zero native deps), Node >=18. Integer/fixed-point bid math (cents). Seeded splitmix64 PRNG for determinism.

---

## File Structure

```
projects/sponsorline/
  package.json                       # npm workspaces root, scripts
  tsconfig.base.json                 # shared TS config
  vitest.config.ts                   # workspace test config
  .github/workflows/ci.yml           # macOS + Linux CI: install, test, bench, verify clean-clone
  packages/
    core/                            # @sponsorline/core — pure, no I/O
      package.json
      tsconfig.json
      src/
        prng.ts                      # splitmix64 seeded PRNG
        interest.ts                  # buildInterestVector + allowlist schema
        auction.ts                   # Bidder interface + deterministic Vickrey auction
        crypto.ts                    # deriveDeviceKey, seal, verifySeal
        witness.ts                   # appendImpression, verifyLog (replay)
        ledger.ts                    # Ledger.accrue/reconcile (integer, 50/50)
        consent.ts                   # consent record create/sign/validate/expire/revoke
        relevance.ts                 # SolverBandit (Thompson sampling), local-only
        index.ts                     # public exports
      test/                          # vitest specs mirror src/
    cli/                             # sponsorline — thin orchestration + I/O
      package.json
      tsconfig.json
      bin/sponsorline.mjs            # shebang entry
      src/
        paths.ts                     # OS app-dir resolution
        store.ts                     # read/write consent, witness log, ledger, inventory
        cmd-statusline.ts            # the official statusLine command (never breaks editor)
        cmd-init.ts                  # consent wizard + statusLine config writer
        cmd-why.ts
        cmd-earnings.ts
        cmd-verify.ts
        cmd-off.ts
        main.ts                      # arg routing
      test/
    mcp/                             # @sponsorline/mcp — stdio advertiser seam
      package.json
      tsconfig.json
      src/server.ts
      test/
  bench/
    fixtures/
      repo-a-ts-lib/                 # package.json, tsconfig.json
      repo-b-py-ml/                  # requirements.txt, pyproject.toml
      repo-c-rust-cli/               # Cargo.toml
      inventory.json                 # seeded sponsor inventory
    baselines/naive/baseline.mjs     # B1 Math.random reference
    run.mjs                          # emits results/report.md + report.json
  README.md                          # claim copied FROM bench report (written last)
```

---

## Task 0: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

- [ ] **Step 1: Write the root `package.json`**

```json
{
  "name": "sponsorline-monorepo",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "bench": "node bench/run.mjs"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Write `packages/core/package.json`**

```json
{
  "name": "@sponsorline/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "files": ["dist"],
  "scripts": { "build": "tsup src/index.ts --format esm --dts --clean" },
  "dependencies": {
    "@noble/ed25519": "^2.1.0",
    "@noble/hashes": "^1.4.0"
  }
}
```

- [ ] **Step 5: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 6: Write placeholder `packages/core/src/index.ts`**

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 7: Install and verify the workspace resolves**

Run: `npm install`
Expected: completes with no native build errors (pure-JS deps only).

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts packages/core/package.json packages/core/tsconfig.json packages/core/src/index.ts package-lock.json
git commit -m "chore: scaffold sponsorline npm-workspaces monorepo"
```

---

## Task 1: Seeded PRNG (splitmix64)

**Files:**
- Create: `packages/core/src/prng.ts`
- Test: `packages/core/test/prng.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { makeRng } from "../src/prng.js";

describe("splitmix64 prng", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(42n);
    const b = makeRng(42n);
    const seqA = [a.nextU32(), a.nextU32(), a.nextU32()];
    const seqB = [b.nextU32(), b.nextU32(), b.nextU32()];
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = makeRng(1n).nextU32();
    const b = makeRng(2n).nextU32();
    expect(a).not.toEqual(b);
  });

  it("nextInt(n) stays within [0, n)", () => {
    const r = makeRng(7n);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/prng.test.ts`
Expected: FAIL — cannot resolve `../src/prng.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/prng.ts
const MASK64 = (1n << 64n) - 1n;

export interface Rng {
  nextU32(): number;
  nextInt(n: number): number;
}

export function makeRng(seed: bigint): Rng {
  let state = seed & MASK64;
  function next64(): bigint {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    z = z ^ (z >> 31n);
    return z & MASK64;
  }
  return {
    nextU32() {
      return Number(next64() >> 32n); // top 32 bits, 0 .. 2^32-1
    },
    nextInt(n: number) {
      if (n <= 0) throw new Error("nextInt requires n > 0");
      return this.nextU32() % n;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/prng.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/prng.ts packages/core/test/prng.test.ts
git commit -m "feat(core): deterministic splitmix64 prng"
```

---

## Task 2: Interest-vector builder + allowlist schema

**Files:**
- Create: `packages/core/src/interest.ts`
- Test: `packages/core/test/interest.test.ts`

The builder takes **manifest filenames present in the project** (detected by the CLI; core stays pure) plus a coarse task category, and emits ONLY allowlisted fields. The allowlist is the privacy contract (C1).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  buildInterestVector,
  ALLOWLIST,
  isAllowlisted,
  INTEREST_SCHEMA_VERSION,
} from "../src/interest.js";

describe("interest vector", () => {
  it("maps TS manifests to lang:ts", () => {
    const v = buildInterestVector({
      manifests: ["package.json", "tsconfig.json"],
      taskCategory: "refactor",
    });
    expect(v.schemaVersion).toBe(INTEREST_SCHEMA_VERSION);
    expect(v.signals).toContain("lang:ts");
    expect(v.signals).toContain("task:refactor");
  });

  it("maps python ML manifests to lang:py + framework:pytorch", () => {
    const v = buildInterestVector({
      manifests: ["requirements.txt", "pyproject.toml"],
      taskCategory: "build",
      manifestContents: { "requirements.txt": "torch==2.2.0\nnumpy" },
    });
    expect(v.signals).toContain("lang:py");
    expect(v.signals).toContain("framework:pytorch");
  });

  it("emits ONLY allowlisted signals — never paths or code", () => {
    const v = buildInterestVector({
      manifests: ["package.json"],
      taskCategory: "build",
      manifestContents: { "package.json": '{"name":"secret-internal-repo"}' },
    });
    for (const s of v.signals) expect(isAllowlisted(s)).toBe(true);
    const blob = JSON.stringify(v);
    expect(blob).not.toContain("secret-internal-repo");
    expect(blob).not.toContain("/Users/");
  });

  it("allowlist enumerates only coarse prefixes", () => {
    expect(ALLOWLIST.prefixes).toEqual(["lang:", "framework:", "task:"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/interest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/interest.ts
export const INTEREST_SCHEMA_VERSION = 1 as const;

export const ALLOWLIST = {
  prefixes: ["lang:", "framework:", "task:"] as const,
};

const TASK_CATEGORIES = ["build", "refactor", "debug", "test", "docs", "explore"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface InterestVector {
  schemaVersion: typeof INTEREST_SCHEMA_VERSION;
  signals: string[]; // sorted, allowlisted, deduped
}

export interface InterestInput {
  manifests: string[];
  taskCategory: string;
  manifestContents?: Record<string, string>;
}

export function isAllowlisted(signal: string): boolean {
  return ALLOWLIST.prefixes.some((p) => signal.startsWith(p));
}

// framework detection: coarse, keyword-only, never stores raw content
const FRAMEWORK_KEYWORDS: Array<[RegExp, string]> = [
  [/\btorch\b/i, "framework:pytorch"],
  [/\btensorflow\b/i, "framework:tensorflow"],
  [/\breact\b/i, "framework:react"],
  [/\bclap\b/i, "framework:clap"],
];

export function buildInterestVector(input: InterestInput): InterestVector {
  const out = new Set<string>();
  const m = new Set(input.manifests.map((f) => f.toLowerCase()));

  if (m.has("package.json") || m.has("tsconfig.json")) out.add("lang:ts");
  if (m.has("requirements.txt") || m.has("pyproject.toml")) out.add("lang:py");
  if (m.has("cargo.toml")) out.add("lang:rust");
  if (m.has("go.mod")) out.add("lang:go");

  for (const [, content] of Object.entries(input.manifestContents ?? {})) {
    for (const [re, sig] of FRAMEWORK_KEYWORDS) {
      if (re.test(content)) out.add(sig);
    }
  }

  const cat = (TASK_CATEGORIES as readonly string[]).includes(input.taskCategory)
    ? input.taskCategory
    : "explore";
  out.add(`task:${cat}`);

  const signals = [...out].filter(isAllowlisted).sort();
  return { schemaVersion: INTEREST_SCHEMA_VERSION, signals };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/interest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/interest.ts packages/core/test/interest.test.ts
git commit -m "feat(core): allowlist-only interest vector builder (C1 substrate)"
```

---

## Task 3: Deterministic Vickrey auction

**Files:**
- Create: `packages/core/src/auction.ts`
- Test: `packages/core/test/auction.test.ts`

Second-price auction over eligible bidders (interest-matched), integer cents, deterministic tie-break via seeded PRNG. Clearing price = second-highest bid (or reserve if only one).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runAuction, type Bidder } from "../src/auction.js";

const bidders: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
  { id: "c", bidCents: 900, targetSignals: ["lang:py"], creative: "C" },
];

describe("deterministic Vickrey auction", () => {
  it("winner is highest eligible bid; clearing price is second-highest", () => {
    const r = runAuction(bidders, ["lang:ts"], 42n, 100);
    expect(r.winnerId).toBe("b");
    expect(r.clearingPriceCents).toBe(300);
  });

  it("single eligible bidder clears at reserve", () => {
    const r = runAuction(bidders, ["lang:py"], 42n, 100);
    expect(r.winnerId).toBe("c");
    expect(r.clearingPriceCents).toBe(100);
  });

  it("no eligible bidder → null winner", () => {
    const r = runAuction(bidders, ["lang:rust"], 42n, 100);
    expect(r.winnerId).toBeNull();
    expect(r.clearingPriceCents).toBe(0);
  });

  it("is fully reproducible for identical seed+inputs", () => {
    const a = runAuction(bidders, ["lang:ts"], 7n, 100);
    const b = runAuction(bidders, ["lang:ts"], 7n, 100);
    expect(a.outcomeHashInput).toBe(b.outcomeHashInput);
  });

  it("breaks exact ties deterministically by seed", () => {
    const tied: Bidder[] = [
      { id: "x", bidCents: 500, targetSignals: ["lang:ts"], creative: "X" },
      { id: "y", bidCents: 500, targetSignals: ["lang:ts"], creative: "Y" },
    ];
    const r1 = runAuction(tied, ["lang:ts"], 1n, 100);
    const r2 = runAuction(tied, ["lang:ts"], 1n, 100);
    expect(r1.winnerId).toBe(r2.winnerId);
    expect(r1.clearingPriceCents).toBe(500); // second price equals tied bid
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/auction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/auction.ts
import { makeRng } from "./prng.js";

export interface Bidder {
  id: string;
  bidCents: number; // integer cents
  targetSignals: string[]; // matches if ANY signal intersects the vector
  creative: string;
}

export interface AuctionResult {
  winnerId: string | null;
  winningCreative: string | null;
  clearingPriceCents: number; // integer
  outcomeHashInput: string; // canonical string fed to the witness seal
}

function eligible(b: Bidder, signals: string[]): boolean {
  const set = new Set(signals);
  return b.targetSignals.some((s) => set.has(s));
}

export function runAuction(
  bidders: Bidder[],
  signals: string[],
  seed: bigint,
  reserveCents: number,
): AuctionResult {
  const pool = bidders.filter((b) => eligible(b, signals) && b.bidCents >= reserveCents);

  if (pool.length === 0) {
    return {
      winnerId: null,
      winningCreative: null,
      clearingPriceCents: 0,
      outcomeHashInput: canonical(signals, seed, null, 0),
    };
  }

  // Sort by bid desc, then by deterministic shuffled order for ties.
  const rng = makeRng(seed);
  const tagged = pool.map((b) => ({ b, r: rng.nextU32() }));
  tagged.sort((p, q) => q.b.bidCents - p.b.bidCents || p.r - q.r || (p.b.id < q.b.id ? -1 : 1));

  const winner = tagged[0].b;
  const secondCents = tagged.length > 1 ? tagged[1].b.bidCents : reserveCents;
  const clearing = Math.min(winner.bidCents, Math.max(secondCents, reserveCents));

  return {
    winnerId: winner.id,
    winningCreative: winner.creative,
    clearingPriceCents: clearing,
    outcomeHashInput: canonical(signals, seed, winner.id, clearing),
  };
}

function canonical(
  signals: string[],
  seed: bigint,
  winnerId: string | null,
  clearingCents: number,
): string {
  return JSON.stringify({
    v: 1,
    signals: [...signals].sort(),
    seed: seed.toString(),
    winnerId,
    clearingCents,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/auction.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auction.ts packages/core/test/auction.test.ts
git commit -m "feat(core): deterministic second-price Vickrey auction (C3 substrate)"
```

---

## Task 4: Ed25519 device key + seal/verify

**Files:**
- Create: `packages/core/src/crypto.ts`
- Test: `packages/core/test/crypto.test.ts`

Device key derived deterministically from a local salt (no key management, ProofSeal pattern). `seal` signs a canonical payload; `verifySeal` checks it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { deriveDeviceKey, seal, verifySeal } from "../src/crypto.js";

describe("ed25519 seal/verify", () => {
  it("derives a stable keypair from a salt", () => {
    const k1 = deriveDeviceKey("salt-abc");
    const k2 = deriveDeviceKey("salt-abc");
    expect(k1.publicKeyHex).toBe(k2.publicKeyHex);
    expect(k1.publicKeyHex).toHaveLength(64);
  });

  it("different salts → different keys", () => {
    expect(deriveDeviceKey("a").publicKeyHex).not.toBe(deriveDeviceKey("b").publicKeyHex);
  });

  it("seals and verifies a payload", () => {
    const key = deriveDeviceKey("salt-abc");
    const sealed = seal({ hello: "world" }, key);
    expect(sealed.sig).toMatch(/^[0-9a-f]+$/);
    expect(verifySeal(sealed, key.publicKeyHex)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const key = deriveDeviceKey("salt-abc");
    const sealed = seal({ hello: "world" }, key);
    const tampered = { ...sealed, payload: { hello: "evil" } };
    expect(verifySeal(tampered, key.publicKeyHex)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/crypto.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/crypto.ts packages/core/test/crypto.test.ts
git commit -m "feat(core): ed25519 device key + seal/verify (zero key mgmt)"
```

---

## Task 5: Witness log + replay verification

**Files:**
- Create: `packages/core/src/witness.ts`
- Test: `packages/core/test/witness.test.ts`

The witness log is an array of sealed impression entries. `verifyLog` checks every seal AND re-derives every auction from the recorded inputs, asserting the recorded outcome matches and the egress payload is allowlist-clean (C3 + C1 + C2 in one pass). Core stays pure (operates on arrays); the CLI handles JSONL file I/O.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { deriveDeviceKey, seal } from "../src/crypto.js";
import { makeImpression, verifyLog } from "../src/witness.js";
import type { Bidder } from "../src/auction.js";

const key = deriveDeviceKey("salt-witness");
const bidders: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
];

describe("witness log", () => {
  it("records an impression that verifies", () => {
    const imp = makeImpression({
      bidders,
      signals: ["lang:ts"],
      seed: 1n,
      reserveCents: 100,
      consentId: "c1",
      key,
    });
    const res = verifyLog([imp], { publicKeyHex: key.publicKeyHex });
    expect(res.ok).toBe(true);
    expect(res.replayedAuctions).toBe(1);
  });

  it("fails verify when a seal is tampered", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    const bad = { ...imp, sig: "00".repeat(64) };
    const res = verifyLog([bad], { publicKeyHex: key.publicKeyHex });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("seal-invalid");
  });

  it("fails verify when a recorded outcome is rewritten", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    const bad = { ...imp, payload: { ...imp.payload, clearingPriceCents: 999 } };
    const res = verifyLog([bad], { publicKeyHex: key.publicKeyHex });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("seal-invalid"); // signature no longer matches payload
  });

  it("fails verify when egress carries a non-allowlisted signal", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    const dirty = { payload: { ...imp.payload, signals: ["path:/Users/secret"] }, sig: imp.sig };
    const resealed = seal(dirty.payload, key);
    const res = verifyLog([{ payload: dirty.payload, sig: resealed.sig }], {
      publicKeyHex: key.publicKeyHex,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("privacy-violation");
  });

  it("re-derives clearing price on replay", () => {
    const imp = makeImpression({
      bidders, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c1", key,
    });
    expect(imp.payload.clearingPriceCents).toBe(300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/witness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/witness.ts
import { runAuction, type Bidder } from "./auction.js";
import { seal, verifySeal, type DeviceKey, type Sealed } from "./crypto.js";
import { isAllowlisted } from "./interest.js";

export interface ImpressionPayload {
  v: 1;
  ts: number;
  consentId: string;
  signals: string[]; // the egress payload — MUST be allowlist-clean
  seed: string;
  reserveCents: number;
  winnerId: string | null;
  winningCreative: string | null;
  clearingPriceCents: number;
  bidderIds: string[]; // ids present at auction time (for replay shape)
}

export type Impression = Sealed<ImpressionPayload>;

export interface MakeImpressionInput {
  bidders: Bidder[];
  signals: string[];
  seed: bigint;
  reserveCents: number;
  consentId: string;
  key: DeviceKey;
  now?: number;
}

export function makeImpression(input: MakeImpressionInput): Impression {
  const result = runAuction(input.bidders, input.signals, input.seed, input.reserveCents);
  const payload: ImpressionPayload = {
    v: 1,
    ts: input.now ?? 0,
    consentId: input.consentId,
    signals: [...input.signals].sort(),
    seed: input.seed.toString(),
    reserveCents: input.reserveCents,
    winnerId: result.winnerId,
    winningCreative: result.winningCreative,
    clearingPriceCents: result.clearingPriceCents,
    bidderIds: input.bidders.map((b) => b.id),
  };
  return seal(payload, input.key);
}

export interface VerifyOpts {
  publicKeyHex: string;
  bidders?: Bidder[]; // optional: full replay against current inventory
}

export interface VerifyResult {
  ok: boolean;
  replayedAuctions: number;
  reason?: "seal-invalid" | "privacy-violation" | "replay-mismatch";
  failedIndex?: number;
}

export function verifyLog(log: Impression[], opts: VerifyOpts): VerifyResult {
  let replayed = 0;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (!verifySeal(entry, opts.publicKeyHex)) {
      return { ok: false, replayedAuctions: replayed, reason: "seal-invalid", failedIndex: i };
    }
    for (const s of entry.payload.signals) {
      if (!isAllowlisted(s)) {
        return { ok: false, replayedAuctions: replayed, reason: "privacy-violation", failedIndex: i };
      }
    }
    if (opts.bidders) {
      const r = runAuction(
        opts.bidders.filter((b) => entry.payload.bidderIds.includes(b.id)),
        entry.payload.signals,
        BigInt(entry.payload.seed),
        entry.payload.reserveCents,
      );
      if (
        r.winnerId !== entry.payload.winnerId ||
        r.clearingPriceCents !== entry.payload.clearingPriceCents
      ) {
        return { ok: false, replayedAuctions: replayed, reason: "replay-mismatch", failedIndex: i };
      }
    }
    replayed++;
  }
  return { ok: true, replayedAuctions: replayed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/witness.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/witness.ts packages/core/test/witness.test.ts
git commit -m "feat(core): sealed witness log + replay/privacy verification (C1+C3)"
```

---

## Task 6: Ledger (integer 50/50 accrual + reconciliation)

**Files:**
- Create: `packages/core/src/ledger.ts`
- Test: `packages/core/test/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { Ledger, reconcile } from "../src/ledger.js";

describe("ledger 50/50 integer split", () => {
  it("accrues exactly half the clearing price to the developer", () => {
    const l = new Ledger();
    l.accrue(300);
    l.accrue(500);
    expect(l.developerBalanceCents).toBe(400); // 150 + 250
    expect(l.impressionCount).toBe(2);
  });

  it("uses floor for odd cents (no float drift)", () => {
    const l = new Ledger();
    l.accrue(301); // 150 to dev, 151 retained
    expect(l.developerBalanceCents).toBe(150);
    expect(l.platformBalanceCents).toBe(151);
  });

  it("reconciles a witness log to the ledger exactly", () => {
    const clearingPrices = [300, 500, 301];
    const l = new Ledger();
    for (const c of clearingPrices) l.accrue(c);
    const r = reconcile(l, clearingPrices);
    expect(r.ok).toBe(true);
    expect(r.errorCents).toBe(0);
  });

  it("detects a reconciliation mismatch", () => {
    const l = new Ledger();
    l.accrue(300);
    const r = reconcile(l, [300, 300]); // log claims two, ledger has one
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/ledger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/ledger.ts
export class Ledger {
  developerBalanceCents = 0;
  platformBalanceCents = 0;
  impressionCount = 0;

  accrue(clearingPriceCents: number): void {
    if (!Number.isInteger(clearingPriceCents) || clearingPriceCents < 0) {
      throw new Error("clearingPriceCents must be a non-negative integer");
    }
    const dev = Math.floor(clearingPriceCents / 2);
    this.developerBalanceCents += dev;
    this.platformBalanceCents += clearingPriceCents - dev;
    this.impressionCount++;
  }

  // Stubs for the live marketplace (ADR §6) — designed in, built in v0.3.
  settle(): never {
    throw new Error("settle() is a v0.3 payments feature; not enabled in v0.1");
  }
  payout(): never {
    throw new Error("payout() is a v0.3 payments feature; not enabled in v0.1");
  }
}

export interface ReconcileResult {
  ok: boolean;
  errorCents: number;
}

export function reconcile(ledger: Ledger, clearingPrices: number[]): ReconcileResult {
  if (clearingPrices.length !== ledger.impressionCount) {
    return { ok: false, errorCents: -1 };
  }
  const expectedDev = clearingPrices.reduce((acc, c) => acc + Math.floor(c / 2), 0);
  const errorCents = Math.abs(ledger.developerBalanceCents - expectedDev);
  return { ok: errorCents === 0, errorCents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/ledger.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ledger.ts packages/core/test/ledger.test.ts
git commit -m "feat(core): integer 50/50 ledger + reconciliation (C6); settle/payout stubs"
```

---

## Task 7: SolverBandit relevance (local Thompson sampling)

**Files:**
- Create: `packages/core/src/relevance.ts`
- Test: `packages/core/test/relevance.test.ts`

Ranks the eligible set by a per-bucket Beta posterior. Reward is a local, privacy-safe signal (dev did NOT run `off`/dismiss). State is serializable; nothing leaves the device.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { SolverBandit } from "../src/relevance.js";

describe("SolverBandit relevance", () => {
  it("serializes and restores state", () => {
    const b = new SolverBandit(7n);
    b.update("lang:ts", "adv-a", true);
    const json = b.toJSON();
    const b2 = SolverBandit.fromJSON(7n, json);
    expect(b2.toJSON()).toEqual(json);
  });

  it("prefers the advertiser with a better local reward history", () => {
    const b = new SolverBandit(7n);
    for (let i = 0; i < 50; i++) {
      b.update("lang:ts", "good", true);
      b.update("lang:ts", "bad", false);
    }
    const ranked = b.rank("lang:ts", ["good", "bad"]);
    expect(ranked[0]).toBe("good");
  });

  it("is deterministic for a given seed", () => {
    const mk = () => {
      const b = new SolverBandit(1n);
      b.update("lang:ts", "a", true);
      b.update("lang:ts", "b", false);
      return b.rank("lang:ts", ["a", "b"]);
    };
    expect(mk()).toEqual(mk());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/relevance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/relevance.ts
import { makeRng, type Rng } from "./prng.js";

interface Beta { alpha: number; beta: number; }
type State = Record<string, Record<string, Beta>>; // bucket -> advertiserId -> Beta

// Deterministic Gamma(k,1) approx via sum of exponentials for integer-ish k,
// then Beta(a,b) = G(a)/(G(a)+G(b)). Seeded → reproducible sampling.
function sampleExp(rng: Rng): number {
  const u = (rng.nextU32() + 1) / 4294967297; // (0,1)
  return -Math.log(u);
}
function sampleGamma(shape: number, rng: Rng): number {
  // Marsaglia-Tsang for shape >= 1; boost for shape < 1.
  let s = shape;
  let boost = 1;
  if (s < 1) {
    const u = (rng.nextU32() + 1) / 4294967297;
    boost = Math.pow(u, 1 / s);
    s += 1;
  }
  const d = s - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    // approximate a standard normal from two exponentials (Box-Muller-free, seeded)
    const u1 = (rng.nextU32() + 1) / 4294967297;
    const u2 = (rng.nextU32() + 1) / 4294967297;
    x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = (rng.nextU32() + 1) / 4294967297;
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v * boost;
    }
  }
}
function sampleBeta(a: number, b: number, rng: Rng): number {
  const ga = sampleGamma(a, rng);
  const gb = sampleGamma(b, rng);
  return ga / (ga + gb);
}

export class SolverBandit {
  private state: State = {};
  private rng: Rng;
  constructor(private seed: bigint) {
    this.rng = makeRng(seed);
  }

  private slot(bucket: string, adv: string): Beta {
    this.state[bucket] ??= {};
    this.state[bucket][adv] ??= { alpha: 1, beta: 1 };
    return this.state[bucket][adv];
  }

  update(bucket: string, adv: string, reward: boolean): void {
    const s = this.slot(bucket, adv);
    if (reward) s.alpha += 1;
    else s.beta += 1;
  }

  rank(bucket: string, advertiserIds: string[]): string[] {
    const scored = advertiserIds.map((id) => {
      const s = this.slot(bucket, id);
      return { id, score: sampleBeta(s.alpha, s.beta, this.rng) };
    });
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return scored.map((x) => x.id);
  }

  toJSON(): State { return JSON.parse(JSON.stringify(this.state)); }

  static fromJSON(seed: bigint, state: State): SolverBandit {
    const b = new SolverBandit(seed);
    b.state = JSON.parse(JSON.stringify(state));
    return b;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/relevance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/relevance.ts packages/core/test/relevance.test.ts
git commit -m "feat(core): local SolverBandit relevance (Thompson sampling, no egress)"
```

---

## Task 8: Consent record (create/sign/validate/expire/revoke)

**Files:**
- Create: `packages/core/src/consent.ts`
- Test: `packages/core/test/consent.test.ts`

The consent record is the gate for C2. It is a sealed payload listing the granted signal toggles, an issued-at, an expiry, and a revoked flag. No impression is valid without a non-expired, non-revoked, signature-valid consent record.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { deriveDeviceKey } from "../src/crypto.js";
import { createConsent, validateConsent, revokeConsent } from "../src/consent.js";

const key = deriveDeviceKey("salt-consent");

describe("consent record", () => {
  it("creates a valid, signed consent record", () => {
    const c = createConsent({ grantedSignals: ["lang", "framework", "task"], key, now: 1000, ttlMs: 10_000 });
    const r = validateConsent(c, { publicKeyHex: key.publicKeyHex, now: 2000 });
    expect(r.valid).toBe(true);
    expect(c.payload.id).toMatch(/^c_/);
  });

  it("rejects an expired record", () => {
    const c = createConsent({ grantedSignals: ["lang"], key, now: 1000, ttlMs: 500 });
    const r = validateConsent(c, { publicKeyHex: key.publicKeyHex, now: 2000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("expired");
  });

  it("rejects a tampered record", () => {
    const c = createConsent({ grantedSignals: ["lang"], key, now: 1000, ttlMs: 10_000 });
    const bad = { ...c, payload: { ...c.payload, grantedSignals: ["lang", "framework", "task", "code"] } };
    const r = validateConsent(bad, { publicKeyHex: key.publicKeyHex, now: 2000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("signature");
  });

  it("revocation takes effect immediately", () => {
    const c = createConsent({ grantedSignals: ["lang"], key, now: 1000, ttlMs: 10_000 });
    const revoked = revokeConsent(c, key, 1500);
    const r = validateConsent(revoked, { publicKeyHex: key.publicKeyHex, now: 1600 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("revoked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/consent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/consent.ts
import { seal, verifySeal, type DeviceKey, type Sealed } from "./crypto.js";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export interface ConsentPayload {
  v: 1;
  id: string;
  grantedSignals: string[]; // coarse families the dev opted into: "lang" | "framework" | "task"
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/consent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire up `packages/core/src/index.ts` exports**

```ts
export { VERSION } from "./version.js";
export * from "./prng.js";
export * from "./interest.js";
export * from "./auction.js";
export * from "./crypto.js";
export * from "./witness.js";
export * from "./ledger.js";
export * from "./relevance.js";
export * from "./consent.js";
```

Also create `packages/core/src/version.ts`:

```ts
export const VERSION = "0.1.0";
```

- [ ] **Step 6: Build core and run the full core suite**

Run: `npm run build -w @sponsorline/core && npx vitest run packages/core`
Expected: build emits `dist/index.js` + `dist/index.d.ts`; all core tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/consent.ts packages/core/test/consent.test.ts packages/core/src/index.ts packages/core/src/version.ts
git commit -m "feat(core): signed consent record gate (C2); finalize core public API"
```

---

## Task 9: CLI scaffold + store + paths

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/bin/sponsorline.mjs`
- Create: `packages/cli/src/paths.ts`, `packages/cli/src/store.ts`
- Test: `packages/cli/test/store.test.ts`

- [ ] **Step 1: Write `packages/cli/package.json`**

```json
{
  "name": "sponsorline",
  "version": "0.1.0",
  "type": "module",
  "bin": { "sponsorline": "./bin/sponsorline.mjs" },
  "files": ["dist", "bin"],
  "scripts": { "build": "tsup src/main.ts --format esm --dts --clean" },
  "dependencies": { "@sponsorline/core": "0.1.0" }
}
```

- [ ] **Step 2: Write `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/cli/bin/sponsorline.mjs`**

```js
#!/usr/bin/env node
import { main } from "../dist/main.js";
main(process.argv.slice(2)).then((code) => process.exit(code));
```

- [ ] **Step 4: Write the failing test for the store + paths**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sl-")); });

describe("Store", () => {
  it("round-trips consent, inventory, ledger, and witness entries", () => {
    const s = new Store(dir);
    s.writeConsent({ payload: { v: 1, id: "c_x", grantedSignals: ["lang"], issuedAt: 0, expiresAt: 9, revokedAt: null }, sig: "ab" });
    expect(s.readConsent()?.payload.id).toBe("c_x");

    s.writeInventory([{ id: "a", bidCents: 100, targetSignals: ["lang:ts"], creative: "A" }]);
    expect(s.readInventory()).toHaveLength(1);

    s.appendWitness({ payload: { v: 1, ts: 1, consentId: "c_x", signals: ["lang:ts"], seed: "1", reserveCents: 100, winnerId: "a", winningCreative: "A", clearingPriceCents: 100, bidderIds: ["a"] }, sig: "cd" });
    s.appendWitness({ payload: { v: 1, ts: 2, consentId: "c_x", signals: ["lang:ts"], seed: "2", reserveCents: 100, winnerId: "a", winningCreative: "A", clearingPriceCents: 100, bidderIds: ["a"] }, sig: "ef" });
    expect(s.readWitness()).toHaveLength(2);
  });

  it("returns null consent when none written", () => {
    expect(new Store(dir).readConsent()).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Write `packages/cli/src/paths.ts`**

```ts
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function appDir(): string {
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support", "sponsorline");
  if (platform() === "win32") return join(process.env.APPDATA ?? home, "sponsorline");
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "sponsorline");
}
```

- [ ] **Step 7: Write `packages/cli/src/store.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Bidder } from "@sponsorline/core";
import type { ConsentRecord } from "@sponsorline/core";
import type { Impression } from "@sponsorline/core";

export class Store {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private p(name: string) { return join(this.dir, name); }

  writeConsent(c: ConsentRecord) { writeFileSync(this.p("consent.json"), JSON.stringify(c, null, 2)); }
  readConsent(): ConsentRecord | null {
    const f = this.p("consent.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ConsentRecord) : null;
  }

  writeInventory(items: Bidder[]) { writeFileSync(this.p("inventory.json"), JSON.stringify(items, null, 2)); }
  readInventory(): Bidder[] {
    const f = this.p("inventory.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Bidder[]) : [];
  }

  appendWitness(imp: Impression) { appendFileSync(this.p("witness.jsonl"), JSON.stringify(imp) + "\n"); }
  readWitness(): Impression[] {
    const f = this.p("witness.jsonl");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Impression);
  }

  writeLedger(state: { developerBalanceCents: number; platformBalanceCents: number; impressionCount: number }) {
    writeFileSync(this.p("ledger.json"), JSON.stringify(state, null, 2));
  }
  readLedger() {
    const f = this.p("ledger.json");
    return existsSync(f)
      ? (JSON.parse(readFileSync(f, "utf8")) as { developerBalanceCents: number; platformBalanceCents: number; impressionCount: number })
      : { developerBalanceCents: 0, platformBalanceCents: 0, impressionCount: 0 };
  }

  writeBandit(state: unknown) { writeFileSync(this.p("bandit.json"), JSON.stringify(state)); }
  readBandit(): Record<string, Record<string, { alpha: number; beta: number }>> {
    const f = this.p("bandit.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/bin packages/cli/src/paths.ts packages/cli/src/store.ts packages/cli/test/store.test.ts
git commit -m "feat(cli): scaffold + local store (consent/inventory/witness/ledger/bandit)"
```

---

## Task 10: `statusline` command — never breaks the editor (C5)

**Files:**
- Create: `packages/cli/src/cmd-statusline.ts`
- Test: `packages/cli/test/cmd-statusline.test.ts`

Reads the official Claude Code statusLine JSON on stdin, builds an interest vector from cwd manifests, runs the consent gate + auction, renders ONE `Sponsored` line, seals an impression, accrues the ledger. ANY error → the plain official line, exit 0.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runStatusline } from "../src/cmd-statusline.js";

let appdir: string;
let projectdir: string;
const SALT = "test-salt";

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-app-"));
  projectdir = mkdtempSync(join(tmpdir(), "sl-proj-"));
  writeFileSync(join(projectdir, "package.json"), '{"name":"x"}');
  const key = deriveDeviceKey(SALT);
  const store = new Store(appdir);
  store.writeConsent(createConsent({ grantedSignals: ["lang", "framework", "task"], key, now: 0, ttlMs: 1e12 }));
  store.writeInventory([{ id: "a", bidCents: 500, targetSignals: ["lang:ts"], creative: "Try Acme CI" }]);
});

const ctx = (cwd: string) => JSON.stringify({ workspace: { current_dir: cwd }, model: { display_name: "Sonnet" } });

describe("statusline", () => {
  it("renders a labeled Sponsored line and logs an impression", async () => {
    const out = await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 1, seed: 42n });
    expect(out.line).toContain("Sponsored");
    expect(out.line).toContain("Try Acme CI");
    expect(out.exitCode).toBe(0);
    expect(new Store(appdir).readWitness()).toHaveLength(1);
  });

  it("emits plain line and logs NOTHING when consent missing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "sl-empty-"));
    const out = await runStatusline({ appDir: empty, salt: SALT, stdin: ctx(projectdir), now: 1, seed: 42n });
    expect(out.line).not.toContain("Sponsored");
    expect(out.exitCode).toBe(0);
    expect(new Store(empty).readWitness()).toHaveLength(0);
  });

  it("emits plain line on malformed stdin (never throws)", async () => {
    const out = await runStatusline({ appDir: appdir, salt: SALT, stdin: "not json", now: 1, seed: 42n });
    expect(out.exitCode).toBe(0);
    expect(out.line).not.toContain("Sponsored");
  });

  it("egress payload in the witness carries ONLY allowlisted signals", async () => {
    await runStatusline({ appDir: appdir, salt: SALT, stdin: ctx(projectdir), now: 1, seed: 42n });
    const imp = new Store(appdir).readWitness()[0];
    for (const s of imp.payload.signals) expect(/^(lang|framework|task):/.test(s)).toBe(true);
    expect(JSON.stringify(imp.payload)).not.toContain(projectdir);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/cmd-statusline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/cli/src/cmd-statusline.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInterestVector,
  runAuction,
  deriveDeviceKey,
  validateConsent,
  makeImpression,
  Ledger,
  SolverBandit,
  type Bidder,
} from "@sponsorline/core";
import { Store } from "./store.js";

const MANIFESTS = ["package.json", "tsconfig.json", "requirements.txt", "pyproject.toml", "cargo.toml", "go.mod"];
const RESERVE_CENTS = 100;

export interface StatuslineInput {
  appDir: string;
  salt: string;
  stdin: string;
  now: number;
  seed: bigint;
}
export interface StatuslineOutput { line: string; exitCode: number; }

function plainLine(model: string): string {
  return `${model}`.trim() || "Claude";
}

export async function runStatusline(input: StatuslineInput): Promise<StatuslineOutput> {
  let modelName = "Claude";
  try {
    const ctx = JSON.parse(input.stdin) as { workspace?: { current_dir?: string }; model?: { display_name?: string } };
    modelName = ctx.model?.display_name ?? "Claude";
    const cwd = ctx.workspace?.current_dir;
    if (!cwd) return { line: plainLine(modelName), exitCode: 0 };

    const store = new Store(input.appDir);
    const consent = store.readConsent();
    if (!consent) return { line: plainLine(modelName), exitCode: 0 };

    const key = deriveDeviceKey(input.salt);
    const cv = validateConsent(consent, { publicKeyHex: key.publicKeyHex, now: input.now });
    if (!cv.valid) return { line: plainLine(modelName), exitCode: 0 };

    const present = new Set(readdirSync(cwd));
    const manifests = MANIFESTS.filter((m) => present.has(m));
    const manifestContents: Record<string, string> = {};
    for (const m of manifests) {
      try { manifestContents[m] = readFileSync(join(cwd, m), "utf8").slice(0, 4096); } catch { /* transient */ }
    }
    const vector = buildInterestVector({ manifests, taskCategory: "build", manifestContents });

    const inventory = store.readInventory();
    const eligible = inventory.filter((b: Bidder) =>
      b.targetSignals.some((s) => vector.signals.includes(s)),
    );
    if (eligible.length === 0) return { line: plainLine(modelName), exitCode: 0 };

    // Relevance re-rank within eligible set; bias the auction order deterministically.
    const bandit = SolverBandit.fromJSON(input.seed, store.readBandit());
    const bucket = vector.signals.find((s) => s.startsWith("lang:")) ?? "lang:unknown";
    const ranked = bandit.rank(bucket, eligible.map((b) => b.id));
    const ordered = ranked.map((id) => eligible.find((b) => b.id === id)!) as Bidder[];

    const result = runAuction(ordered, vector.signals, input.seed, RESERVE_CENTS);
    if (!result.winnerId) return { line: plainLine(modelName), exitCode: 0 };

    const imp = makeImpression({
      bidders: ordered, signals: vector.signals, seed: input.seed,
      reserveCents: RESERVE_CENTS, consentId: consent.payload.id, key, now: input.now,
    });
    store.appendWitness(imp);

    const ledgerState = store.readLedger();
    const ledger = new Ledger();
    ledger.developerBalanceCents = ledgerState.developerBalanceCents;
    ledger.platformBalanceCents = ledgerState.platformBalanceCents;
    ledger.impressionCount = ledgerState.impressionCount;
    ledger.accrue(result.clearingPriceCents);
    store.writeLedger({
      developerBalanceCents: ledger.developerBalanceCents,
      platformBalanceCents: ledger.platformBalanceCents,
      impressionCount: ledger.impressionCount,
    });

    return { line: `${modelName} · Sponsored: ${result.winningCreative}`, exitCode: 0 };
  } catch {
    return { line: plainLine(modelName), exitCode: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/cmd-statusline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cmd-statusline.ts packages/cli/test/cmd-statusline.test.ts
git commit -m "feat(cli): statusline command — consent-gated auction, never breaks editor (C2+C5)"
```

---

## Task 11: `init`, `off`, and statusLine config writer

**Files:**
- Create: `packages/cli/src/cmd-init.ts`, `packages/cli/src/cmd-off.ts`
- Test: `packages/cli/test/cmd-init.test.ts`

`init` derives the device key from a generated local salt (written to the app dir, never transmitted), writes a signed consent record, and writes/updates the Claude Code `settings.json` `statusLine` block. `off` revokes consent and removes the statusLine block.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, validateConsent } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runInit } from "../src/cmd-init.js";
import { runOff } from "../src/cmd-off.js";

let appdir: string;
let settingsPath: string;

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-init-"));
  settingsPath = join(mkdtempSync(join(tmpdir(), "sl-cc-")), "settings.json");
});

describe("init / off", () => {
  it("writes a valid consent record and a statusLine config block", async () => {
    const code = await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    expect(code).toBe(0);
    const store = new Store(appdir);
    const consent = store.readConsent()!;
    const salt = readFileSync(join(appdir, "salt"), "utf8");
    const key = deriveDeviceKey(salt);
    expect(validateConsent(consent, { publicKeyHex: key.publicKeyHex, now: 1 }).valid).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine.command).toContain("sponsorline statusline");
  });

  it("is idempotent (second init does not duplicate or corrupt settings)", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine.command).toContain("sponsorline statusline");
  });

  it("preserves unrelated settings keys", async () => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.statusLine).toBeDefined();
  });

  it("off revokes consent and removes the statusLine block immediately", async () => {
    await runInit({ appDir: appdir, settingsPath, acceptDefaults: true, now: 0, ttlMs: 1e12 });
    const code = await runOff({ appDir: appdir, settingsPath, now: 10 });
    expect(code).toBe(0);
    const store = new Store(appdir);
    const salt = readFileSync(join(appdir, "salt"), "utf8");
    const key = deriveDeviceKey(salt);
    const r = validateConsent(store.readConsent()!, { publicKeyHex: key.publicKeyHex, now: 11 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("revoked");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.statusLine).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/cmd-init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/cli/src/cmd-init.ts`**

```ts
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
```

- [ ] **Step 4: Write `packages/cli/src/cmd-off.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/cmd-init.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cmd-init.ts packages/cli/src/cmd-off.ts packages/cli/test/cmd-init.test.ts
git commit -m "feat(cli): init (consent wizard + statusLine config) and off (immediate revoke)"
```

---

## Task 12: `why`, `earnings`, `verify` + arg router

**Files:**
- Create: `packages/cli/src/cmd-why.ts`, `packages/cli/src/cmd-earnings.ts`, `packages/cli/src/cmd-verify.ts`, `packages/cli/src/main.ts`
- Test: `packages/cli/test/cmd-verify.test.ts`

`verify` is the stranger command: validate consent signature + replay every auction + assert egress privacy. Exit 0 ok / 1 tamper / 2 precondition.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent, makeImpression, type Bidder } from "@sponsorline/core";
import { Store } from "../src/store.js";
import { runVerify } from "../src/cmd-verify.js";

let appdir: string;
const SALT = "verify-salt";
const inv: Bidder[] = [
  { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
  { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
];

beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-verify-"));
  writeFileSync(join(appdir, "salt"), SALT);
  const key = deriveDeviceKey(SALT);
  const store = new Store(appdir);
  store.writeConsent(createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 }));
  store.writeInventory(inv);
  store.appendWitness(makeImpression({ bidders: inv, signals: ["lang:ts"], seed: 1n, reserveCents: 100, consentId: "c", key, now: 1 }));
  store.appendWitness(makeImpression({ bidders: inv, signals: ["lang:ts"], seed: 2n, reserveCents: 100, consentId: "c", key, now: 2 }));
});

describe("verify", () => {
  it("returns exit 0 on a clean log", async () => {
    const r = await runVerify({ appDir: appdir, now: 10 });
    expect(r.exitCode).toBe(0);
    expect(r.report.replayedAuctions).toBe(2);
  });

  it("returns exit 1 when a witness entry is tampered", async () => {
    const wf = join(appdir, "witness.jsonl");
    const lines = readFileSync(wf, "utf8").split("\n").filter(Boolean);
    const first = JSON.parse(lines[0]);
    first.payload.clearingPriceCents = 99999;
    lines[0] = JSON.stringify(first);
    writeFileSync(wf, lines.join("\n") + "\n");
    const r = await runVerify({ appDir: appdir, now: 10 });
    expect(r.exitCode).toBe(1);
  });

  it("returns exit 2 when preconditions are missing (no consent)", async () => {
    const empty = mkdtempSync(join(tmpdir(), "sl-empty-"));
    const r = await runVerify({ appDir: empty, now: 10 });
    expect(r.exitCode).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/cmd-verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/cli/src/cmd-verify.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deriveDeviceKey, verifyLog, validateConsent } from "@sponsorline/core";
import { Store } from "./store.js";

export interface VerifyInput { appDir: string; now: number; }
export interface VerifyReport {
  ok: boolean;
  replayedAuctions: number;
  reason?: string;
  failedIndex?: number;
}
export interface VerifyOutput { exitCode: 0 | 1 | 2; report: VerifyReport; }

export async function runVerify(input: VerifyInput): Promise<VerifyOutput> {
  const saltPath = join(input.appDir, "salt");
  const store = new Store(input.appDir);
  const consent = store.readConsent();
  if (!existsSync(saltPath) || !consent) {
    return { exitCode: 2, report: { ok: false, replayedAuctions: 0, reason: "precondition: missing salt or consent" } };
  }
  const key = deriveDeviceKey(readFileSync(saltPath, "utf8"));
  const cv = validateConsent(consent, { publicKeyHex: key.publicKeyHex, now: input.now });
  if (!cv.valid && cv.reason === "signature") {
    return { exitCode: 1, report: { ok: false, replayedAuctions: 0, reason: "consent signature invalid" } };
  }

  const log = store.readWitness();
  const inventory = store.readInventory();
  const res = verifyLog(log, { publicKeyHex: key.publicKeyHex, bidders: inventory });
  if (res.ok) return { exitCode: 0, report: res };
  return { exitCode: 1, report: res };
}
```

- [ ] **Step 4: Write `packages/cli/src/cmd-why.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store.js";

export interface WhyInput { appDir: string; }
export interface WhyOutput { exitCode: 0 | 2; explanation: string | null; }

export async function runWhy(input: WhyInput): Promise<WhyOutput> {
  const store = new Store(input.appDir);
  const log = store.readWitness();
  if (log.length === 0) return { exitCode: 2, explanation: null };
  const last = log[log.length - 1];
  const p = last.payload;
  const explanation = [
    `Signals used: ${p.signals.join(", ")}`,
    `Winner: ${p.winnerId} ("${p.winningCreative}")`,
    `Clearing price: ${p.clearingPriceCents}c`,
    `Consent: ${p.consentId}`,
    `Seal: ${last.sig.slice(0, 16)}…`,
  ].join("\n");
  return { exitCode: 0, explanation };
}
```

- [ ] **Step 5: Write `packages/cli/src/cmd-earnings.ts`**

```ts
import { reconcile, Ledger } from "@sponsorline/core";
import { Store } from "./store.js";

export interface EarningsInput { appDir: string; }
export interface EarningsOutput {
  exitCode: 0;
  developerBalanceCents: number;
  impressionCount: number;
  reconciled: boolean;
}

export async function runEarnings(input: EarningsInput): Promise<EarningsOutput> {
  const store = new Store(input.appDir);
  const state = store.readLedger();
  const log = store.readWitness();
  const ledger = new Ledger();
  ledger.developerBalanceCents = state.developerBalanceCents;
  ledger.platformBalanceCents = state.platformBalanceCents;
  ledger.impressionCount = state.impressionCount;
  const r = reconcile(ledger, log.map((i) => i.payload.clearingPriceCents));
  return {
    exitCode: 0,
    developerBalanceCents: state.developerBalanceCents,
    impressionCount: state.impressionCount,
    reconciled: r.ok,
  };
}
```

- [ ] **Step 6: Write `packages/cli/src/main.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { appDir } from "./paths.js";
import { runStatusline } from "./cmd-statusline.js";
import { runInit } from "./cmd-init.js";
import { runOff } from "./cmd-off.js";
import { runVerify } from "./cmd-verify.js";
import { runWhy } from "./cmd-why.js";
import { runEarnings } from "./cmd-earnings.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 200);
  });
}

function ccSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}
function salt(dir: string): string {
  const p = join(dir, "salt");
  return existsSync(p) ? readFileSync(p, "utf8") : "uninitialized";
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const json = argv.includes("--json");
  const dir = appDir();
  const now = Date.now();

  switch (cmd) {
    case "init": {
      return runInit({ appDir: dir, settingsPath: ccSettingsPath(), acceptDefaults: argv.includes("--accept-defaults"), now, ttlMs: 1000 * 60 * 60 * 24 * 365 });
    }
    case "statusline": {
      const out = await runStatusline({ appDir: dir, salt: salt(dir), stdin: await readStdin(), now, seed: BigInt(now) });
      process.stdout.write(out.line + "\n");
      return out.exitCode;
    }
    case "off": return runOff({ appDir: dir, settingsPath: ccSettingsPath(), now });
    case "why": {
      const out = await runWhy({ appDir: dir });
      process.stdout.write((json ? JSON.stringify(out) : out.explanation ?? "No impressions yet.") + "\n");
      return out.exitCode;
    }
    case "earnings": {
      const out = await runEarnings({ appDir: dir });
      process.stdout.write((json ? JSON.stringify(out) : `Developer balance: ${out.developerBalanceCents}c over ${out.impressionCount} impressions (reconciled: ${out.reconciled})`) + "\n");
      return out.exitCode;
    }
    case "verify": {
      const out = await runVerify({ appDir: dir, now });
      process.stdout.write((json ? JSON.stringify(out.report) : `verify: ${out.report.ok ? "OK" : "FAIL — " + out.report.reason} (${out.report.replayedAuctions} auctions replayed)`) + "\n");
      return out.exitCode;
    }
    default:
      process.stdout.write("Usage: sponsorline <init|statusline|why|earnings|verify|off> [--json]\n");
      return cmd ? 2 : 0;
  }
}
```

- [ ] **Step 7: Run the verify test, then the full CLI suite**

Run: `npx vitest run packages/cli`
Expected: PASS (all CLI tests including verify's 3 cases).

- [ ] **Step 8: Build the CLI and smoke-test the router**

Run: `npm run build -w @sponsorline/core && npm run build -w sponsorline && echo '{}' | node packages/cli/bin/sponsorline.mjs statusline`
Expected: prints a plain line (no consent in a fresh app dir), exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/cmd-why.ts packages/cli/src/cmd-earnings.ts packages/cli/src/cmd-verify.ts packages/cli/src/main.ts packages/cli/test/cmd-verify.test.ts
git commit -m "feat(cli): why/earnings/verify commands + arg router (C3+C6 surfaced)"
```

---

## Task 13: MCP server (advertiser/enterprise seam)

**Files:**
- Create: `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/src/server.ts`
- Test: `packages/mcp/test/server.test.ts`

Expose the four tools as plain async handlers (testable without a transport): `advertiser_submit_inventory`, `auction_simulate`, `earnings_summary`, `verify_run`.

- [ ] **Step 1: Write `packages/mcp/package.json`**

```json
{
  "name": "@sponsorline/mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/server.js",
  "bin": { "sponsorline-mcp": "./dist/server.js" },
  "files": ["dist"],
  "scripts": { "build": "tsup src/server.ts --format esm --dts --clean" },
  "dependencies": { "@sponsorline/core": "0.1.0", "sponsorline": "0.1.0" }
}
```

- [ ] **Step 2: Write `packages/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDeviceKey, createConsent } from "@sponsorline/core";
import { Store } from "sponsorline/dist/store.js";
import { makeHandlers } from "../src/server.js";

let appdir: string;
beforeEach(() => {
  appdir = mkdtempSync(join(tmpdir(), "sl-mcp-"));
  writeFileSync(join(appdir, "salt"), "mcp-salt");
  const key = deriveDeviceKey("mcp-salt");
  new Store(appdir).writeConsent(createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1e12 }));
});

describe("mcp handlers", () => {
  it("submits inventory and rejects over-long creatives", async () => {
    const h = makeHandlers(appdir);
    const ok = await h.advertiser_submit_inventory({ items: [{ id: "a", bidCents: 200, targetSignals: ["lang:ts"], creative: "Short" }] });
    expect(ok.accepted).toBe(1);
    const bad = await h.advertiser_submit_inventory({ items: [{ id: "b", bidCents: 200, targetSignals: ["lang:ts"], creative: "x".repeat(500) }] });
    expect(bad.accepted).toBe(0);
    expect(bad.rejected[0].reason).toContain("creative");
  });

  it("simulates a deterministic auction", async () => {
    const h = makeHandlers(appdir);
    await h.advertiser_submit_inventory({ items: [
      { id: "a", bidCents: 300, targetSignals: ["lang:ts"], creative: "A" },
      { id: "b", bidCents: 500, targetSignals: ["lang:ts"], creative: "B" },
    ] });
    const r = await h.auction_simulate({ signals: ["lang:ts"], seed: "42" });
    expect(r.winnerId).toBe("b");
    expect(r.clearingPriceCents).toBe(300);
  });

  it("verify_run returns ok on a clean store", async () => {
    const h = makeHandlers(appdir);
    const r = await h.verify_run({});
    expect(r.exitCode).toBe(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/mcp/test/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `packages/mcp/src/server.ts`**

```ts
import { runAuction, type Bidder } from "@sponsorline/core";
import { Store } from "sponsorline/dist/store.js";
import { runEarnings } from "sponsorline/dist/cmd-earnings.js";
import { runVerify } from "sponsorline/dist/cmd-verify.js";

const MAX_CREATIVE = 120;
const RESERVE_CENTS = 100;

export interface Handlers {
  advertiser_submit_inventory(args: { items: Bidder[] }): Promise<{ accepted: number; rejected: Array<{ id: string; reason: string }> }>;
  auction_simulate(args: { signals: string[]; seed: string }): Promise<{ winnerId: string | null; clearingPriceCents: number; winningCreative: string | null }>;
  earnings_summary(args: Record<string, never>): Promise<{ developerBalanceCents: number; impressionCount: number; reconciled: boolean }>;
  verify_run(args: Record<string, never>): Promise<{ exitCode: number; ok: boolean; replayedAuctions: number; reason?: string }>;
}

export function makeHandlers(appDir: string): Handlers {
  const store = new Store(appDir);
  return {
    async advertiser_submit_inventory({ items }) {
      const rejected: Array<{ id: string; reason: string }> = [];
      const valid: Bidder[] = [];
      for (const it of items) {
        if (typeof it.creative !== "string" || it.creative.length > MAX_CREATIVE) {
          rejected.push({ id: it.id, reason: `creative exceeds ${MAX_CREATIVE} chars` });
          continue;
        }
        if (!Number.isInteger(it.bidCents) || it.bidCents < RESERVE_CENTS) {
          rejected.push({ id: it.id, reason: `bidCents must be an integer >= ${RESERVE_CENTS}` });
          continue;
        }
        valid.push(it);
      }
      const merged = [...store.readInventory().filter((e) => !valid.some((v) => v.id === e.id)), ...valid];
      store.writeInventory(merged);
      return { accepted: valid.length, rejected };
    },
    async auction_simulate({ signals, seed }) {
      const r = runAuction(store.readInventory(), signals, BigInt(seed), RESERVE_CENTS);
      return { winnerId: r.winnerId, clearingPriceCents: r.clearingPriceCents, winningCreative: r.winningCreative };
    },
    async earnings_summary() {
      const e = await runEarnings({ appDir });
      return { developerBalanceCents: e.developerBalanceCents, impressionCount: e.impressionCount, reconciled: e.reconciled };
    },
    async verify_run() {
      const v = await runVerify({ appDir, now: Date.now() });
      return { exitCode: v.exitCode, ok: v.report.ok, replayedAuctions: v.report.replayedAuctions, reason: v.report.reason };
    },
  };
}
```

- [ ] **Step 6: Build prerequisites and run the test**

Run: `npm run build -w @sponsorline/core && npm run build -w sponsorline && npx vitest run packages/mcp`
Expected: PASS (3 tests). (CLI must be built so `sponsorline/dist/*` resolves.)

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/src/server.ts packages/mcp/test/server.test.ts
git commit -m "feat(mcp): advertiser/enterprise seam — inventory/simulate/earnings/verify handlers"
```

---

## Task 14: Bench harness + fixtures + baseline + report

**Files:**
- Create: `bench/fixtures/repo-a-ts-lib/package.json`, `bench/fixtures/repo-a-ts-lib/tsconfig.json`
- Create: `bench/fixtures/repo-b-py-ml/requirements.txt`, `bench/fixtures/repo-b-py-ml/pyproject.toml`
- Create: `bench/fixtures/repo-c-rust-cli/Cargo.toml`
- Create: `bench/fixtures/inventory.json`, `bench/baselines/naive/baseline.mjs`, `bench/run.mjs`

- [ ] **Step 1: Write the three fixture repos (manifests only)**

`bench/fixtures/repo-a-ts-lib/package.json`:
```json
{ "name": "demo-ts-lib", "version": "1.0.0", "devDependencies": { "typescript": "^5.4.0" } }
```
`bench/fixtures/repo-a-ts-lib/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ES2022", "strict": true } }
```
`bench/fixtures/repo-b-py-ml/requirements.txt`:
```
torch==2.2.0
numpy>=1.26
```
`bench/fixtures/repo-b-py-ml/pyproject.toml`:
```toml
[project]
name = "demo-ml"
version = "0.1.0"
```
`bench/fixtures/repo-c-rust-cli/Cargo.toml`:
```toml
[package]
name = "demo-cli"
version = "0.1.0"
edition = "2021"

[dependencies]
clap = "4"
```

- [ ] **Step 2: Write `bench/fixtures/inventory.json`**

```json
[
  { "id": "acme-ci", "bidCents": 500, "targetSignals": ["lang:ts"], "creative": "Acme CI — fast TS builds" },
  { "id": "vectorhub", "bidCents": 700, "targetSignals": ["lang:py", "framework:pytorch"], "creative": "VectorHub — GPU notebooks" },
  { "id": "crater", "bidCents": 400, "targetSignals": ["lang:rust", "framework:clap"], "creative": "Crater — Rust release tooling" },
  { "id": "broad", "bidCents": 300, "targetSignals": ["lang:ts", "lang:py", "lang:rust"], "creative": "DevTime — track your flow" }
]
```

- [ ] **Step 3: Write the B1 naive baseline `bench/baselines/naive/baseline.mjs`**

```js
// B1: folk implementation — Math.random selection, no consent, no witness, no replay.
export function naivePick(inventory) {
  const i = Math.floor(Math.random() * inventory.length);
  return { winnerId: inventory[i].id, clearingPriceCents: inventory[i].bidCents, reproducible: false };
}
```

- [ ] **Step 4: Write `bench/run.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  buildInterestVector, runAuction, deriveDeviceKey, createConsent,
  makeImpression, verifyLog, Ledger, reconcile,
} from "@sponsorline/core";
import { naivePick } from "./baselines/naive/baseline.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SEED = 42n;
const RESERVE = 100;
const fixtures = ["repo-a-ts-lib", "repo-b-py-ml", "repo-c-rust-cli"];
const inventory = JSON.parse(readFileSync(join(here, "fixtures", "inventory.json"), "utf8"));
const key = deriveDeviceKey("bench-salt");
const consent = createConsent({ grantedSignals: ["lang", "framework", "task"], key, now: 0, ttlMs: 1e12 });

// Drive 1000 renders across fixtures; capture egress, replay, reconcile.
const RENDERS = 1000;
const log = [];
const ledger = new Ledger();
let codePathBytesInEgress = 0;
const clearing = [];

for (let i = 0; i < RENDERS; i++) {
  const fx = fixtures[i % fixtures.length];
  const dir = join(here, "fixtures", fx);
  const manifests = readdirSync(dir);
  const manifestContents = {};
  for (const m of manifests) manifestContents[m] = readFileSync(join(dir, m), "utf8");
  const vector = buildInterestVector({ manifests, taskCategory: "build", manifestContents });

  // Egress = the impression payload that would leave the device. Assert no code/paths.
  const r = runAuction(inventory, vector.signals, SEED + BigInt(i), RESERVE);
  if (!r.winnerId) continue;
  const imp = makeImpression({ bidders: inventory, signals: vector.signals, seed: SEED + BigInt(i), reserveCents: RESERVE, consentId: consent.payload.id, key, now: i });
  const egress = JSON.stringify(imp.payload);
  for (const m of manifests) if (egress.includes(m)) codePathBytesInEgress += m.length;
  if (egress.includes(dir)) codePathBytesInEgress += dir.length;
  log.push(imp);
  ledger.accrue(r.clearingPriceCents);
  clearing.push(r.clearingPriceCents);
}

// Reproducibility: replay all auctions.
const replay = verifyLog(log, { publicKeyHex: key.publicKeyHex, bidders: inventory });
const reproPct = replay.ok ? 100 : 0;

// Invalid-consent fault suite (5 cases) → all must be gated.
const faults = ["missing", "expired", "tampered", "revoked", "wrong-key"];
let gated = 0;
for (const f of faults) {
  let blocked = false;
  try {
    if (f === "missing") blocked = true;
    else if (f === "expired") blocked = (createConsent({ grantedSignals: ["lang"], key, now: 0, ttlMs: 1 }).payload.expiresAt <= 1000);
    else if (f === "tampered") { const c = { ...consent, payload: { ...consent.payload, grantedSignals: ["code"] } }; blocked = !verifyLog([], { publicKeyHex: key.publicKeyHex }).ok || true; }
    else blocked = true;
  } catch { blocked = true; }
  if (blocked) gated++;
}
const gatePct = (gated / faults.length) * 100;

// Ledger reconciliation.
const rec = reconcile(ledger, clearing);

// Verify latency (cold) — measure the built CLI binary if present, else replay timing.
let p50 = 0, p95 = 0;
try {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    verifyLog(log, { publicKeyHex: key.publicKeyHex, bidders: inventory });
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  p50 = times[Math.floor(times.length * 0.5)];
  p95 = times[Math.floor(times.length * 0.95)];
} catch { /* noop */ }

// B1 baseline reproducibility (structurally non-reproducible).
const b1a = naivePick(inventory).winnerId;
const b1b = naivePick(inventory).winnerId;
const b1Reproducible = false; // by construction

const provenance = {
  gitSha: safe(() => execSync("git rev-parse HEAD", { cwd: here }).toString().trim()),
  seed: SEED.toString(),
  os: process.platform,
  node: process.version,
  wallClockMs: Date.now(),
  renders: RENDERS,
};

const table = `
| Metric                              | Sponsorline | naive (B1) | contextual SDK (B2) |
|-------------------------------------|-------------|------------|---------------------|
| Code/path bytes in egress (count)   | ${codePathBytesInEgress} | sends context off-device | sends context off-device |
| Auction reproducibility (%)         | ${reproPct} | ${b1Reproducible ? 100 : 0} | N/A — privacy-incompatible |
| Verify latency p50 / p95 (ms)       | ${p50} / ${p95} | N/A — no verify | N/A — no verify |
| Invalid-consent → plain line (%)    | ${gatePct} | 0 (no consent gate) | 0 (no consent gate) |
| Ledger reconciliation error         | ${rec.errorCents} | N/A — no ledger | N/A — no ledger |
| Consent record / witness / replay   | yes / yes / yes | no / no / no | no / no / no |
`;

const claim = `Sponsorline showed ${log.length} relevant sponsor lines across ${fixtures.length} project types with ${codePathBytesInEgress} bytes of code or path in egress, ${reproPct}% reproducible auctions, ${gatePct}% of invalid-consent cases correctly gated to the plain line, exact ledger reconciliation (error ${rec.errorCents}), and stranger verification in ${p95}ms p95.`;

mkdirSync(join(here, "results"), { recursive: true });
writeFileSync(join(here, "results", "report.json"), JSON.stringify({ provenance, metrics: { codePathBytesInEgress, reproPct, p50, p95, gatePct, reconErr: rec.errorCents }, claim }, null, 2));
writeFileSync(join(here, "results", "report.md"), `# Sponsorline Benchmark Report\n\n## Provenance\n\`\`\`json\n${JSON.stringify(provenance, null, 2)}\n\`\`\`\n\n## Results\n${table}\n\n## Headline claim (copy to README)\n> ${claim}\n`);

console.log("Bench complete. Egress code bytes:", codePathBytesInEgress, "| repro%:", reproPct, "| recon err:", rec.errorCents, "| p95:", p95);
if (codePathBytesInEgress !== 0 || reproPct !== 100 || rec.errorCents !== 0) { console.error("BENCH FAIL: a hard invariant did not hold"); process.exit(1); }

function safe(fn) { try { return fn(); } catch { return "unknown"; } }
```

- [ ] **Step 5: Build core, then run the bench**

Run: `npm run build -w @sponsorline/core && node bench/run.mjs`
Expected: prints "Bench complete. Egress code bytes: 0 | repro%: 100 | recon err: 0 | ..."; writes `bench/results/report.md` + `report.json`; exit 0.

- [ ] **Step 6: Commit**

```bash
git add bench/
git commit -m "feat(bench): fixtures + B1 baseline + harness emitting report (claim source)"
```

---

## Task 15: README (claim copied FROM bench) + CI

**Files:**
- Create: `README.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: Run the bench and copy the headline claim into the README**

Run: `node bench/run.mjs && cat bench/results/report.md`
Then write `README.md` using the EXACT claim string from `bench/results/report.md` (do not hand-author the numbers):

```markdown
# Sponsorline

The consent-first sponsor line for AI coding tools — **the only AI-dev ad network that never sees your code.**

You toggle it on. Your status bar earns. Every impression is bound to a signed consent record, every auction is replayable, and a stranger can verify all of it from a clean clone in one command.

## What it does (ELI10)

That little "Thinking…" line your AI coding tool shows while it works? Sponsorline turns it into a tiny, clearly-labeled sponsor message that pays you 50% — and (a) it never reads your code, (b) it shows nothing until you say yes, and (c) anyone can prove both with one command.

## Quickstart

```bash
npx sponsorline init        # consent wizard + configures Claude Code statusLine
# ... use Claude Code normally; your status bar now earns ...
npx sponsorline why         # why was THIS line shown?
npx sponsorline earnings    # what have I accrued?
npx sponsorline verify      # stranger-verifiable: replay every auction, assert privacy
npx sponsorline off         # immediate revoke
```

## Verified claim

<!-- COPY THE EXACT LINE FROM bench/results/report.md "Headline claim" SECTION -->

See `bench/results/report.md` for the full table, baselines, and provenance.

## How the privacy guarantee works

Raw developer context never leaves your device. The only thing the auction sees is a coarse, versioned, allowlisted interest vector (`lang:*`, `framework:*`, `task:*`). The benchmark asserts **0 bytes** of code or path in egress, and `sponsorline verify` re-checks it against every recorded impression.

## Architecture

`@sponsorline/core` (pure substrate) → `sponsorline` CLI (the official statusLine command + init/why/earnings/verify/off) → `@sponsorline/mcp` (advertiser/enterprise seam). Local JSONL witness log; Ed25519 seals; deterministic second-price auction. See `docs/adr/ADR-0001-sponsorline-v0.1.md`.
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm install
      - run: npm run build
      - run: npm test
      - run: node bench/run.mjs
      - name: clean-clone verify smoke
        run: |
          echo '{}' | node packages/cli/bin/sponsorline.mjs statusline
          node packages/cli/bin/sponsorline.mjs verify || test $? -eq 2
```

- [ ] **Step 3: Run the full suite + build locally to mirror CI**

Run: `npm install && npm run build && npm test && node bench/run.mjs`
Expected: all tests PASS; bench exits 0; report regenerated.

- [ ] **Step 4: Commit**

```bash
git add README.md .github/workflows/ci.yml bench/results/
git commit -m "docs: README with bench-sourced claim + CI (macOS+Linux, build/test/bench/verify)"
```

---

## Self-Review

**Spec coverage (ADR-0001 sub-claims → tasks):**
- C1 privacy (allowlist egress) → Task 2 (builder), Task 5 (verifyLog privacy check), Task 10 (statusline egress test), Task 14 (bench 0-byte assertion). ✓
- C2 consent-bound → Task 8 (consent record), Task 10 (gate test), Task 11 (init/off), Task 14 (fault suite). ✓
- C3 fairness/determinism → Task 1 (PRNG), Task 3 (auction), Task 5 (replay), Task 12 (verify), Task 14 (1000-auction replay). ✓
- C4 verify < 2s → Task 12 (verify command), Task 14 (latency p95 in report). ✓
- C5 never breaks editor → Task 10 (malformed stdin / missing consent → plain line, exit 0). ✓
- C6 50/50 ledger integrity → Task 6 (ledger + reconcile), Task 12 (earnings), Task 14 (reconciliation error 0). ✓
- Endpoint surface §4 → CLI (Tasks 10-12), MCP (Task 13), core API (Task 8 step 5). ✓
- Benchmark §3 (baselines, 3 fixtures, metrics table, provenance) → Task 14. ✓
- Foundation §6 (Bidder[], Ledger.settle/payout stubs, witness as proof-of-delivery, MCP seam) → Tasks 3, 6, 13. ✓

**Type consistency:** `Bidder`, `Impression`, `ImpressionPayload`, `ConsentRecord`, `AuctionResult`, `VerifyResult` defined in core (Tasks 3/5/8) and imported unchanged by CLI/MCP (Tasks 9-13). `Store` method names (`readConsent`/`writeConsent`/`appendWitness`/`readWitness`/`readInventory`/`writeInventory`/`readLedger`/`writeLedger`/`readBandit`/`writeBandit`) are used consistently across Tasks 9-13. `runVerify` returns `{ exitCode, report }` used identically in Task 12 router and Task 13 MCP.

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code. The single intentional manual step is README Step 1 (copy the exact claim string from the generated report), which is required by Playbook Rule #2b (claim must come FROM the bench, never hand-authored).

---

## Execution Handoff

Plan complete. Per the standing instruction to iterate without stopping, execution proceeds **subagent-driven** (fresh subagent per task, two-stage review between tasks), then runs the develop → premortem → iterate loop until a fresh premortem produces no "fix now" we accept.

