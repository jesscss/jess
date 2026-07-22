# Repository lint lanes

The release-blocking `pnpm run lint` command checks production package source
under `packages/**/src/**`, all repository scripts under `scripts/**`, and the
root configuration/setup files. It does not make package tests or performance
fixtures disappear from ESLint; those files are kept in a separate backlog
lane.

Run `pnpm run lint:tests` to audit package tests, `__tests__` trees, named test
files, and package performance fixtures. Test-lane diagnostics are tracked as
cleanup work and must not be “fixed” by weakening ESLint rules or by adding
global ignore patterns. The scope test in
`scripts/__tests__/lint-scope.test.mjs` proves both that worktree fixtures are
ignored and that package-test fixtures remain directly lintable. The blocking
staged guard lints every changed executable file from the index and rejects
errors on added/replaced lines, global diagnostics, and either retained boundary
of a deletion-only hunk. That keeps new test debt out without requiring the
historical full-test backlog to be zero.
