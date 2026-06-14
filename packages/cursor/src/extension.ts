import * as vscode from "vscode";
import { computeSponsorLine } from "./engine.js";
import { nodeCliRunner } from "./runner.js";

const DEFAULT_REFRESH_SECONDS = 60;

function cfg() {
  const c = vscode.workspace.getConfiguration("sponsorline");
  return {
    command: c.get<string>("command", "sponsorline"),
    modelName: c.get<string>("modelName", "Cursor"),
    refreshSeconds: c.get<number>("refreshSeconds", DEFAULT_REFRESH_SECONDS),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.tooltip = "Sponsorline — consent-first sponsor line. Never sees your code. Click to rate.";
  item.command = "sponsorline.feedback";
  item.show();
  context.subscriptions.push(item);

  async function refresh(): Promise<void> {
    const { command, modelName } = cfg();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      item.text = modelName;
      return;
    }
    item.text = await computeSponsorLine({ command, cwd, modelName, run: nodeCliRunner });
  }

  // Clicking the status bar drives the SAME on-device feedback loop as the CLI:
  // it shells to `sponsorline feedback <good|bad>`, which updates only local bandit
  // state. Nothing about the choice leaves the machine.
  context.subscriptions.push(
    vscode.commands.registerCommand("sponsorline.feedback", async () => {
      const verdict = await vscode.window.showQuickPick(["good", "bad"], {
        placeHolder: "Was this sponsor line relevant?",
      });
      if (verdict !== "good" && verdict !== "bad") return;
      await nodeCliRunner({ command: cfg().command, args: ["feedback", verdict], stdin: "" }).catch(() => {});
      await refresh();
    }),
  );

  const timer = setInterval(() => void refresh(), Math.max(5, cfg().refreshSeconds) * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  void refresh();
}

export function deactivate(): void {
  /* status bar item + timer are disposed via context.subscriptions */
}
