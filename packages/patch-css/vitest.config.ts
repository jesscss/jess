import { defineConfig } from 'vitest/config';

// patch-css has NO active vitest suite. Its only test file,
// `test/files/01.spec.js`, is a dormant Jest + jest-puppeteer suite: it relies
// on a global `browser`, chai-style `expect(...).to.eq(...)`, and a live
// `lite-server` serving `test/files/01.html` on :3000. The package reflects
// that — `test` is an echo, and the real runner is parked behind `test:tofix`
// (`pnpm dist && jest`).
//
// Without this file the root config's per-package project would pick the file
// up under vitest's DEFAULT include and fail on `describe is not defined`.
// Collecting zero tests keeps the repo-wide `pnpm test` matching what
// `pnpm run -r ci` runs for this package: nothing. Restoring coverage means
// porting the suite to vitest under `test:tofix`, not relaxing it here.
export default defineConfig({
  test: {
    include: []
  }
});
