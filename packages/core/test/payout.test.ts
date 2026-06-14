import { describe, it, expect } from "vitest";
import {
  payableCents,
  authorizePayout,
  executePayout,
  DryRunGateway,
  DEFAULT_PAYOUT_POLICY,
  type PayoutAccount,
} from "../src/payout.js";

const verified: PayoutAccount = { devicePubKey: "pubkeyabcdef0123456789", kycStatus: "verified", connectAccountId: "acct_123", alreadyPaidCents: 0 };

describe("payableCents", () => {
  it("is balance minus already paid, never negative", () => {
    expect(payableCents(5000, 1000)).toBe(4000);
    expect(payableCents(1000, 1000)).toBe(0);
    expect(payableCents(1000, 5000)).toBe(0); // over-paid (must never happen) clamps to 0
  });
});

describe("authorizePayout (the gate)", () => {
  it("authorizes a verified, connected, in-range request", () => {
    const d = authorizePayout(verified, 4000, 5000, DEFAULT_PAYOUT_POLICY);
    expect(d).toEqual({ ok: true, amountCents: 4000 });
  });

  it("refuses when KYC is not verified", () => {
    const d = authorizePayout({ ...verified, kycStatus: "pending" }, 4000, 5000);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/kyc/i);
  });

  it("refuses when no payout account is connected", () => {
    const d = authorizePayout({ ...verified, connectAccountId: undefined }, 4000, 5000);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/account/i);
  });

  it("refuses non-integer / non-positive amounts", () => {
    expect(authorizePayout(verified, 0, 5000).ok).toBe(false);
    expect(authorizePayout(verified, -100, 5000).ok).toBe(false);
    expect(authorizePayout(verified, 10.5, 5000).ok).toBe(false);
  });

  it("refuses below the minimum payout floor", () => {
    const d = authorizePayout(verified, 500, 5000); // below default 1000c floor
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/minimum/i);
  });

  it("refuses an amount over the payable balance", () => {
    const d = authorizePayout(verified, 6000, 5000);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/exceeds/i);
  });
});

describe("executePayout (two independent controls)", () => {
  it("refuses to move money without explicit operator authorization, even when the gate passes", async () => {
    const r = await executePayout({ account: verified, requestedCents: 4000, payable: 5000, gateway: new DryRunGateway(), operatorAuthorized: false });
    expect(r.paid).toBe(false);
    if (!r.paid && "reason" in r) expect(r.reason).toMatch(/operator authorization/i);
  });

  it("refuses on a failed gate regardless of operator authorization", async () => {
    const r = await executePayout({ account: { ...verified, kycStatus: "unverified" }, requestedCents: 4000, payable: 5000, gateway: new DryRunGateway(), operatorAuthorized: true });
    expect(r.paid).toBe(false);
    if (!r.paid && "reason" in r) expect(r.reason).toMatch(/kyc/i);
  });

  it("simulates a payout via the dry-run gateway and never marks it live", async () => {
    const r = await executePayout({ account: verified, requestedCents: 4000, payable: 5000, gateway: new DryRunGateway(), operatorAuthorized: true });
    expect(r.paid).toBe(true);
    expect(r.live).toBe(false); // no real money moved
    if (r.paid && "amountCents" in r) expect(r.amountCents).toBe(4000);
  });
});
