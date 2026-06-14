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
      return runInit({ appDir: dir, settingsPath: ccSettingsPath(), acceptDefaults: argv.includes("--accept-defaults"), now, ttlMs: 1000 * 60 * 60 * 24 * 365 });
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
    case "status": {
      const out = runStatus({ appDir: dir, salt: salt(dir), settingsPath: ccSettingsPath(), now, cliOnPath: cliResolves() });
      if (json) {
        process.stdout.write(JSON.stringify(out) + "\n");
      } else {
        process.stdout.write(`Sponsorline: ${out.ready ? "READY" : "NOT READY"}\n`);
        for (const c of out.checks) process.stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}\n`);
      }
      return out.exitCode;
    }
    default:
      process.stdout.write("Usage: sponsorline <init|statusline|status|why|earnings|verify|feedback|off> [--json]\n");
      return cmd ? 2 : 0;
  }
}
