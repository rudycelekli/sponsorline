import { spawn } from "node:child_process";
import type { CliInvocation, CliResult, CliRunner } from "./engine.js";

// The real runner: spawn the local `sponsorline` CLI and feed it the context on
// stdin, exactly as Claude Code does. stderr is ignored so a noisy CLI can never
// corrupt the status bar; a spawn error (e.g. binary not found) rejects and the
// engine degrades to the plain model name.
export const nodeCliRunner: CliRunner = (inv: CliInvocation) =>
  new Promise<CliResult>((resolve, reject) => {
    const child = spawn(inv.command, inv.args, { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
    child.stdin.write(inv.stdin);
    child.stdin.end();
  });
