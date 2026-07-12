import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Microsoft's recommended E2E harness. `@vscode/test-cli` downloads a VS Code
// build (via `@vscode/test-electron`) and launches the Extension Development
// Host with this package as the extension under test, then runs the compiled
// Mocha suites in `out/test/**`. The `test-fixtures/` folder is opened as the
// workspace so the language server has real `.less` documents to analyze.
//
// Run with `pnpm --filter @jesscss/vscode-extension test:e2e`. It requires
// network access (to download VS Code the first time) and, on headless CI/Linux,
// a virtual display (e.g. `xvfb-run`).
//
// FOCUS / DISRUPTION (macOS local runs): this launches a real VS Code Electron
// window that FOREGROUNDS and steals focus (and re-activates on reload). That is
// by design of the VS Code test tooling — `@vscode/test-electron` only forwards
// `launchArgs` to Code, and neither Code nor Electron exposes a flag to launch
// hidden / without activating on macOS, so it cannot be suppressed here. The real
// mitigation is the LAYERED split: the default `pnpm test` runs ONLY the
// in-process language-service unit suite (no window); this window-opening E2E
// runs exclusively when a developer explicitly invokes `test:e2e`. For fully
// non-disruptive runs, use CI (Linux + `xvfb-run`, headless). Locally, run it
// deliberately and expect a window to appear.
export default defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: path.join(__dirname, 'test-fixtures'),
  mocha: {
    ui: 'tdd',
    color: true,
    timeout: 120000
  }
});
