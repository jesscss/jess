import { defineConfig } from 'vitest/config';

// The VS Code extension package has NO in-process (vitest) unit tests. Its only
// tests are the Electron-based E2E suite under `src/test/`, which imports the
// live `vscode` module and MUST run under `@vscode/test-electron` (via
// `pnpm test:e2e`) — never under vitest.
//
// The root config's `projects: ['packages/*']` would otherwise make this package
// a vitest project with the DEFAULT include glob, so the repo-wide `pnpm test`
// would try to load the E2E files (`import 'vscode'` -> "Cannot find module") and,
// worse, could drag the Extension Host into the default test path. Collecting zero
// tests here keeps the default runner in-process only; the window-opening E2E runs
// exclusively when a developer explicitly invokes `test:e2e`.
export default defineConfig({
  test: {
    include: []
  }
});
