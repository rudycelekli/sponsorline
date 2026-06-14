import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chainHash, type Bidder, type ConsentRecord, type Impression } from "@sponsorline/core";

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

  // Published trust anchor: the Ed25519 public key. Safe to share; cannot forge seals.
  writePubKey(hex: string) { writeFileSync(this.p("pubkey"), hex); }
  readPubKey(): string | null {
    const f = this.p("pubkey");
    return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
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
  // chainHash of the current head entry ("" if none) — the prevHash for the next impression.
  readWitnessTailHash(): string {
    const log = this.readWitness();
    return log.length === 0 ? "" : chainHash(log[log.length - 1].payload);
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

  writeRenderState(state: RenderState) { writeFileSync(this.p("render.json"), JSON.stringify(state)); }
  readRenderState(): RenderState | null {
    const f = this.p("render.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as RenderState) : null;
  }
}

export interface RenderState { lastImpressionAt: number; lastCreative: string; }
