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
// a virtual display (e.g. `xvfb-run`). macOS/Windows run it directly.
export default defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: path.join(__dirname, 'test-fixtures'),
  mocha: {
    ui: 'tdd',
    color: true,
    timeout: 120000
  }
});
