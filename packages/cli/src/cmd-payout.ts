import { deriveDeviceKey, payableCents, authorizePayout, DEFAULT_PAYOUT_POLICY, type KycStatus } from "@sponsorline/core";
import { Store } from "./store.js";

// Developer-facing payout readiness. This command is READ-ONLY: it never moves money
// and never holds operator authority — it only tells the developer what they have
// earned, whether they can withdraw it yet, and the single next step to get paid.
// Like every command that touches on-device state, a malformed local file degrades
// to a safe report rather than throwing (the never-crash contract).

export interface PayoutInput {
  appDir: string;
  salt: string;
}

export interface PayoutOutput {
  exitCode: 0;
  payableCents: number;
  kycStatus: KycStatus;
  connected: boolean;
  eligible: boolean; // would a withdrawal of the full payable balance pass the gate?
  nextStep: string;
}

export function runPayout(input: PayoutInput): PayoutOutput {
  const store = new Store(input.appDir);
  const devicePubKey = deriveDeviceKey(input.salt).publicKeyHex;

  let developerBalanceCents = 0;
  try { developerBalanceCents = store.readLedger().developerBalanceCents; } catch { /* corrupt ledger → treat as 0 earned */ }

  let account;
  try { account = store.readPayoutAccount(devicePubKey); }
  catch { account = { devicePubKey, kycStatus: "unverified" as KycStatus, alreadyPaidCents: 0 }; }

  const payable = payableCents(developerBalanceCents, account.alreadyPaidCents);
  const decision = authorizePayout(account, payable, payable, DEFAULT_PAYOUT_POLICY);
  const eligible = decision.ok;

  let nextStep: string;
  if (eligible) {
    nextStep = `You can withdraw ${payable}c. Payout will be processed by the platform.`;
  } else if (account.kycStatus !== "verified") {
    nextStep = "Verify your identity to enable payouts (KYC required before any money moves).";
  } else if (!account.connectAccountId) {
    nextStep = "Connect a payout account to receive earnings.";
  } else if (payable < DEFAULT_PAYOUT_POLICY.minPayoutCents) {
    nextStep = `Keep earning — minimum payout is ${DEFAULT_PAYOUT_POLICY.minPayoutCents}c (you have ${payable}c).`;
  } else {
    nextStep = "Not eligible for payout yet.";
  }

  return {
    exitCode: 0,
    payableCents: payable,
    kycStatus: account.kycStatus,
    connected: !!account.connectAccountId,
    eligible,
    nextStep,
  };
}
