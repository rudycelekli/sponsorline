#!/usr/bin/env node
// Set process.exitCode and let Node exit naturally — do NOT call process.exit().
// statusline output is piped to Claude Code; process.exit() can drop buffered
// stdout on a pipe before it flushes, intermittently blanking the status line.
import { main } from "../dist/main.js";
main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0; },
  (err) => { console.error(err?.message ?? err); process.exitCode = 1; },
);
