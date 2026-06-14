// Developer payouts, gated. This module is the boundary between accrued earnings
// (the ledger's developer balance) and real money leaving an account. It is built
// so that money CANNOT move without two independent controls both being satisfied:
//
//   1. KYC verified  — the developer's identity is confirmed (closes the unique-human
//      gap the anti-sybil layer deliberately leaves open; see antifraud.ts).
//   2. Operator authorization — an explicit, per-execution flag the platform operator
//      sets. Even a fully-verified, in-balance request is refused without it.
//
// The actual money movement is delegated to a PayoutGateway (adapter seam). The only
// gateway shipped here is DryRunGateway, which NEVER moves money — it simulates the
// call so the whole path is testable end to end. A live Stripe Connect gateway would
// implement the same interface with `live = true` and real API keys; it is not built
// here precisely because live money must not move implicitly.

export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

export interface PayoutAccount {
  devicePubKey: string;
  kycStatus: KycStatus;
  connectAccountId?: string; // set once a payout (Stripe Connect) account exists
  alreadyPaidCents: number; // lifetime amount already disbursed to this device
}

export interface PayoutPolicy {
  minPayoutCents: number; // do not cut micro-payouts
}

// Sensible floor: a $10 minimum payout keeps per-transfer fees from dwarfing the cut.
export const DEFAULT_PAYOUT_POLICY: PayoutPolicy = { minPayoutCents: 1000 };

export type PayoutDecision =
  | { ok: true; amountCents: number }
  | { ok: false; reason: string };

// What a developer can withdraw right now: accrued developer balance minus what has
// already been paid out. Never negative (an over-payment, which must never happen,
// still reports 0 rather than a negative withdrawable amount).
export function payableCents(developerBalanceCents: number, alreadyPaidCents: number): number {
  return Math.max(0, developerBalanceCents - alreadyPaidCents);
}

// The GATE. Pure and side-effect free: it only decides whether a payout is permissible,
// it never moves anything. Money may be authorized only when KYC is verified, a payout
// account is connected, and the amount is a positive integer at/above the floor that
// does not exceed what the developer is actually owed.
export function authorizePayout(
  account: PayoutAccount,
  requestedCents: number,
  payable: number,
  policy: PayoutPolicy = DEFAULT_PAYOUT_POLICY,
): PayoutDecision {
  if (account.kycStatus !== "verified") return { ok: false, reason: `KYC not verified (status: ${account.kycStatus})` };
  if (!account.connectAccountId) return { ok: false, reason: "no payout account connected" };
  if (!Number.isInteger(requestedCents) || requestedCents <= 0) return { ok: false, reason: "amount must be a positive integer" };
  if (requestedCents < policy.minPayoutCents) return { ok: false, reason: `amount ${requestedCents}c below minimum payout of ${policy.minPayoutCents}c` };
  if (requestedCents > payable) return { ok: false, reason: `amount ${requestedCents}c exceeds payable balance of ${payable}c` };
  return { ok: true, amountCents: requestedCents };
}

export interface PayoutResult {
  paid: boolean;
  live: boolean; // false for dry-run / simulation — no real money moved
  amountCents: number;
  reference: string; // gateway transaction id, or a simulation marker for dry runs
}

export interface PayoutGateway {
  readonly live: boolean;
  pay(account: PayoutAccount, amountCents: number): Promise<PayoutResult>;
}

// Default gateway. Simulates a successful payout but moves NO real money. This is the
// gateway in force until an operator explicitly installs a live one with real keys.
export class DryRunGateway implements PayoutGateway {
  readonly live = false;
  async pay(account: PayoutAccount, amountCents: number): Promise<PayoutResult> {
    return { paid: true, live: false, amountCents, reference: `dryrun:${account.devicePubKey.slice(0, 12)}:${amountCents}` };
  }
}

// End-to-end guarded execution: run the gate, then require an explicit operator
// authorization flag before ANY gateway call. The two controls are independent on
// purpose — passing the gate is not consent to disburse; the operator flag is.
export async function executePayout(args: {
  account: PayoutAccount;
  requestedCents: number;
  payable: number;
  policy?: PayoutPolicy;
  gateway: PayoutGateway;
  operatorAuthorized: boolean;
}): Promise<PayoutResult | { paid: false; live: boolean; reason: string }> {
  const decision = authorizePayout(args.account, args.requestedCents, args.payable, args.policy);
  if (!decision.ok) return { paid: false, live: args.gateway.live, reason: decision.reason };
  if (!args.operatorAuthorized) return { paid: false, live: args.gateway.live, reason: "operator authorization required to move money" };
  return args.gateway.pay(args.account, decision.amountCents);
}
