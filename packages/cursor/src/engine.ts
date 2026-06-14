// Pure orchestration for the Cursor adapter. It deliberately contains NO `vscode`
// import so it is unit-testable and host-agnostic. The Cursor extension is a thin
// presentation shell: it invokes the existing `sponsorline statusline` command using
// the exact same stdin-JSON / stdout-line contract that Claude Code's settings.json
// uses. The CLI remains the single engine, so the witness log, ledger, consent,
// rotation cap, and bandit ranking are shared on-device across every host. No new
// egress, no duplicated auction logic.

export interface CliInvocation {
  command: string;
  args: string[];
  stdin: string;
}
export interface CliResult {
  stdout: string;
  code: number;
}
export type CliRunner = (inv: CliInvocation) => Promise<CliResult>;

export interface SponsorLineQuery {
  command: string; // path to the sponsorline binary (default "sponsorline")
  cwd: string; // workspace root
  modelName: string; // label shown before the sponsor segment, e.g. "Cursor"
  run: CliRunner;
}

// Mirror the Claude Code statusline stdin contract exactly.
export function buildStatuslineStdin(cwd: string, modelName: string): string {
  return JSON.stringify({ workspace: { current_dir: cwd }, model: { display_name: modelName } });
}

// Returns the line to render in the status bar. On any failure (CLI missing,
// nonzero exit, empty output) it degrades to the plain model name — the status
// bar must never show an error or stall the editor.
export async function computeSponsorLine(q: SponsorLineQuery): Promise<string> {
  try {
    const res = await q.run({
      command: q.command,
      args: ["statusline"],
      stdin: buildStatuslineStdin(q.cwd, q.modelName),
    });
    const line = res.stdout.split("\n")[0]?.trim();
    if (res.code !== 0 || !line) return q.modelName;
    return line;
  } catch {
    return q.modelName;
  }
}
