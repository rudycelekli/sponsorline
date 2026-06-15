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
import { runFeedback } from "./cmd-feedback.js";
import { runStatus } from "./cmd-status.js";
import { runReceipt } from "./cmd-receipt.js";
import { runPayout } from "./cmd-payout.js";
import { runWatch } from "./cmd-watch.js";
import { execSync } from "node:child_process";

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
// Does the `sponsorline` name resolve on PATH? Claude Code's statusLine hook
// spawns the bare command, so a CLI that isn't installed globally / linked will
// silently never run. `command -v` is the portable POSIX probe.
function cliResolves(): boolean {
  try {
    execSync(process.platform === "win32" ? "where sponsorline" : "command -v sponsorline", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const json = argv.includes("--json");
  const dir = appDir();
  const now = Date.now();

  switch (cmd) {
    case "init": {
      const code = await runInit({ appDir: dir, settingsPath: ccSettingsPath(), acceptDefaults: argv.includes("--accept-defaults"), now, ttlMs: 1000 * 60 * 60 * 24 * 365 });
      // Onboarding confirmation: never leave a developer guessing what just happened or
      // what to do next. The status line is now live; point at the verify-and-earn path.
      if (code === 0 && !json) {
        process.stdout.write(
          "Sponsorline is set up. Your status line now earns, and it never sees your code.\n" +
            "Next:\n" +
            "  1. Use your editor normally — sponsored lines appear in your status bar.\n" +
            "  2. `sponsorline status`   check everything is wired up\n" +
            "  3. `sponsorline verify`   prove zero code egress + replayable auctions\n" +
            "  4. `sponsorline earnings` see what you've accrued\n" +
            "  5. `sponsorline payout`   how to get paid (identity verification required)\n" +
            "Your status line stays still by default. Set SPONSORLINE_MOTION=1 to let sponsored\n" +
            "lines animate, NO_COLOR=1 to drop colour, SPONSORLINE_REDUCED_MOTION=1 to force static.\n" +
            "Opt out anytime with `sponsorline off`.\n",
        );
      }
      return code;
    }
    case "statusline": {
      const out = await runStatusline({ appDir: dir, salt: salt(dir), stdin: await readStdin(), now, seed: BigInt(now) });
      process.stdout.write(out.line + "\n");
      return out.exitCode;
    }
    case "off": return runOff({ appDir: dir, settingsPath: ccSettingsPath(), now });
    case "feedback": {
      const out = await runFeedback({ appDir: dir, verdict: argv[1] ?? "" });
      process.stdout.write((json ? JSON.stringify(out) : out.message) + "\n");
      return out.exitCode;
    }
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
    case "receipt": {
      // Opt-in egress: emit a signed per-campaign reach receipt. Always JSON — it is
      // a machine artifact a developer hands to a marketer/platform to claim payout.
      const out = runReceipt({ appDir: dir, salt: salt(dir), now });
      process.stdout.write(JSON.stringify(out.receipt) + "\n");
      return out.exitCode;
    }
    case "status": {
      const out = runStatus({ appDir: dir, salt: salt(dir), settingsPath: ccSettingsPath(), now, cliOnPath: cliResolves() });
      if (json) {
        process.stdout.write(JSON.stringify(out) + "\n");
      } else {
        process.stdout.write(`Sponsorline: ${out.ready ? "READY" : "NOT READY"}\n`);
        for (const c of out.checks) process.stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}\n`);
        process.stdout.write(`Next: ${out.nextStep}\n`);
      }
      return out.exitCode;
    }
    case "payout": {
      // Read-only developer payout readiness. Never moves money — it reports earnings,
      // KYC state, and the single next step to get paid.
      const out = runPayout({ appDir: dir, salt: salt(dir) });
      if (json) {
        process.stdout.write(JSON.stringify(out) + "\n");
      } else {
        process.stdout.write(
          `Payable: ${out.payableCents}c | KYC: ${out.kycStatus} | account: ${out.connected ? "connected" : "not connected"} | eligible: ${out.eligible}\n` +
            `Next: ${out.nextStep}\n`,
        );
      }
      return out.exitCode;
    }
    case "watch": {
      // Opt-in viewer: replays the already-served creative as a live animation. The grid
      // (frames) surface is off by default — a developer must explicitly turn it on with
      // SPONSORLINE_ENABLE_FRAMES so animation is never a surprise. Effect creatives still
      // show as a single static line here regardless.
      if (!process.env.SPONSORLINE_ENABLE_FRAMES) {
        process.stdout.write(
          "Animated watch is off by default. Enable it with SPONSORLINE_ENABLE_FRAMES=1 sponsorline watch\n",
        );
        return 0;
      }
      // Ctrl-C (SIGINT) aborts the loop cleanly so the cursor is always restored.
      const controller = new AbortController();
      const onSigint = () => controller.abort();
      process.once("SIGINT", onSigint);
      try {
        const out = await runWatch({ appDir: dir, signal: controller.signal });
        return out.exitCode;
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    }
    default:
      process.stdout.write("Usage: sponsorline <init|statusline|status|watch|receipt|why|earnings|verify|feedback|payout|off> [--json]\n");
      return cmd ? 2 : 0;
  }
}
