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
