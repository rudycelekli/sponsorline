# Sponsorline v0.2-B — Cursor Status-Bar Adapter

**Status:** Built · **Date:** 2026-06-14 · **Builds on:** v0.1, v0.2-A

## Goal

Extend the sponsor line to Cursor without binary patching, reusing the existing CLI
engine so witness log / ledger / consent / rotation / bandit are shared on-device.

## Host extension-point research (why Cursor, why not Codex yet)

- **Cursor — official, buildable now.** Cursor is a VS Code fork and exposes
  `vscode.window.createStatusBarItem` (the standard extension API). A third-party
  extension can render a status-bar segment with no binary patching. ✅
- **Codex — upstream-blocked.** `~/.codex/config.toml` has a `[tui] status_line`, but
  it is an **enum picker of built-in fields only**. The command-backed hook we'd need
  (pipe session JSON to stdin, render our stdout — the Claude Code contract) is an
  **open, unshipped** feature request (openai/codex#17827). Codex's other surfaces
  (MCP, `UserPromptSubmit` hooks) don't render a persistent footer. So a Codex adapter
  the honest way is parked until #17827 lands; our CLI already speaks that exact
  contract, so the adapter will be near-zero work once it does. ❌ (for now)

Permanently excluded: binary patching of any host. Never.

## Architecture

The Cursor extension is a **thin presentation shell**. It invokes
`sponsorline statusline`, passing `{ workspace: { current_dir }, model: { display_name } }`
on stdin and rendering the first stdout line — byte-for-byte the same contract
Claude Code's `settings.json` uses. The CLI stays the single engine; the extension
duplicates **no** auction/witness/consent logic and opens **no** network path
(only `child_process.spawn` of the local CLI).

- `src/engine.ts` — pure, host-agnostic (no `vscode` import): builds the stdin
  contract, runs an injected `CliRunner`, degrades to the plain model name on any
  failure. Fully unit-tested.
- `src/runner.ts` — the real `CliRunner` (spawns the CLI; ignores stderr; rejects on
  spawn error so the engine degrades gracefully).
- `src/extension.ts` — VS Code glue: status-bar item, refresh timer, and a click
  command that drives `sponsorline feedback <good|bad>` (the same on-device loop from
  v0.2-A). Imports `vscode` (provided by the host, marked external at build).
- `src/vscode.d.ts` — minimal ambient declaration of the API subset used, so the code
  is type-checkable offline without `@types/vscode`.

## Privacy / egress

No new egress. The extension only spawns the local CLI; all witness payloads are
produced by that engine and remain bench-verified at 0 code/path bytes. No `fetch`,
`http`, `net`, or sockets anywhere in the package.

## Testing

`engine.ts` is tested with an injected fake runner (contract shape; sponsor-line
passthrough; first-line/trim; degrade on nonzero exit, on throw, on empty stdout).
`extension.ts` is verified to load as CJS and `activate`/`deactivate` cleanly against a
mocked `vscode` (registers status item + feedback command + timer). VS Code Electron
integration tests are out of scope (heavy harness; the meaningful logic is in `engine`).

## Out of scope

Codex adapter (parked on #17827); vsce marketplace publishing mechanics; live model-name
detection in Cursor (shows a configurable label).
