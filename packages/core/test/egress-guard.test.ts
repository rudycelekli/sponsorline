import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Static egress guard. The core promise — "the only AI-dev ad network that never
// sees your code" — dies the moment this codebase learns to call an ad-provider or
// identity-graph endpoint, because routing spend through Google/Meta structurally
// requires their tracking identifiers (gclid/fbclid, hashed-email Customer Match)
// and widens the egress surface past the 3-prefix allowlist. This test fails the
// build if any source file references a forbidden outbound destination or identity
// token, so the moat cannot be breached by a future edit without tripping CI.
//
// It is a SOURCE scan (not a runtime mock): the only thing it trusts is that an
// external URL or tracking token cannot end up in shipped code without appearing as
// text here first.

// The single external host the platform is allowed to talk to: the payout rail.
const ALLOWED_HOSTS = new Set(["api.stripe.com"]);

// Ad-provider / tracking / analytics destinations that must never appear in source.
const FORBIDDEN_DOMAINS = [
  "facebook.com",
  "fbcdn.net",
  "graph.facebook.com",
  "googleadservices.com",
  "googlesyndication.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "ads-twitter.com",
  "ads.linkedin.com",
  "analytics.tiktok.com",
  "amazon-adsystem.com",
];

// Identity-graph / cross-site tracking tokens. Importing these means importing
// someone else's identity substrate — exactly what the moat forbids.
const FORBIDDEN_TOKENS = ["gclid", "fbclid", "customer match", "customermatch", "msclkid", "ttclid"];

function srcFiles(): string[] {
  const root = join(process.cwd(), "packages");
  const out: string[] = [];
  for (const pkg of readdirSync(root)) {
    const srcDir = join(root, pkg, "src");
    let entries: string[];
    try {
      entries = readdirSync(srcDir);
    } catch {
      continue; // package has no src dir
    }
    walk(srcDir, entries, out);
  }
  return out;
}

function walk(dir: string, entries: string[], out: string[]): void {
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, readdirSync(full), out);
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
}

describe("egress guard (the moat is enforced, not just promised)", () => {
  const files = srcFiles();

  it("finds source to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("references no external host other than the payout rail", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const matches = text.match(/https?:\/\/([a-zA-Z0-9.-]+)/g) ?? [];
      for (const m of matches) {
        const host = m.replace(/^https?:\/\//, "");
        if (!ALLOWED_HOSTS.has(host)) offenders.push(`${file}: ${host}`);
      }
    }
    expect(offenders, `unexpected outbound host(s):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("references no ad-provider / tracking / analytics domain", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const domain of FORBIDDEN_DOMAINS) {
        if (text.includes(domain)) offenders.push(`${file}: ${domain}`);
      }
    }
    expect(offenders, `forbidden domain(s) found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("references no cross-site identity / tracking token", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const token of FORBIDDEN_TOKENS) {
        if (text.includes(token)) offenders.push(`${file}: ${token}`);
      }
    }
    expect(offenders, `forbidden identity token(s) found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
