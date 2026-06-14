import { describe, it, expect } from "vitest";
import { validateCampaign, campaignToBidder, isCampaignLive, type Campaign } from "../src/campaign.js";

const base: Campaign = {
  id: "acme-ci",
  advertiser: "Acme CI",
  creative: "Acme CI — fast TS builds",
  bidCents: 500,
  budgetCents: 50_000,
  targetSignals: ["lang:ts"],
  startsAt: 0,
  endsAt: 1_000_000,
};

const POLICY = { reserveCents: 100, maxCreative: 120 };

describe("validateCampaign", () => {
  it("accepts a well-formed campaign", () => {
    const v = validateCampaign(base, POLICY);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects a bid below the reserve", () => {
    const v = validateCampaign({ ...base, bidCents: 50 }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/reserve|bid/i);
  });

  it("rejects a budget smaller than a single bid", () => {
    const v = validateCampaign({ ...base, budgetCents: 100 }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/budget/i);
  });

  it("rejects a creative with control characters (statusline-injection guard)", () => {
    const v = validateCampaign({ ...base, creative: "evil\u001b[2Jline" }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/control/i);
  });

  it("rejects a creative over the length cap", () => {
    const v = validateCampaign({ ...base, creative: "x".repeat(200) }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/length|chars/i);
  });

  it("rejects an inverted flight window", () => {
    const v = validateCampaign({ ...base, startsAt: 100, endsAt: 50 }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/window|flight|end/i);
  });

  it("rejects a non-allowlisted target predicate", () => {
    const v = validateCampaign({ ...base, target: { atom: "email:leak" }, targetSignals: undefined }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/predicate|allowlist/i);
  });

  it("requires either a predicate or legacy targetSignals", () => {
    const v = validateCampaign({ ...base, target: undefined, targetSignals: undefined }, POLICY);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/target/i);
  });
});

describe("campaignToBidder", () => {
  it("maps a campaign into the auction Bidder shape", () => {
    const b = campaignToBidder(base);
    expect(b).toMatchObject({ id: "acme-ci", bidCents: 500, creative: "Acme CI — fast TS builds", targetSignals: ["lang:ts"] });
  });

  it("carries a precise predicate through when present", () => {
    const b = campaignToBidder({ ...base, target: { atom: "lang:ts" } });
    expect(b.target).toEqual({ atom: "lang:ts" });
  });
});

describe("isCampaignLive", () => {
  it("is live inside the flight window with budget remaining", () => {
    expect(isCampaignLive(base, 500, 0)).toBe(true);
    expect(isCampaignLive(base, 500, 49_000)).toBe(true);
  });

  it("is not live before it starts or after it ends", () => {
    expect(isCampaignLive({ ...base, startsAt: 1000 }, 500, 0)).toBe(false);
    expect(isCampaignLive(base, 1_000_000, 0)).toBe(false);
  });

  it("is not live once spend meets or exceeds budget", () => {
    expect(isCampaignLive(base, 500, 50_000)).toBe(false);
    expect(isCampaignLive(base, 500, 60_000)).toBe(false);
  });
});
