# Jess Integration Tests

This directory contains package-level integration tests for the public Jess
compiler APIs.

## Less

The active Less compatibility signal is
[`less/all-less.test.ts`](./less/all-less.test.ts). It renders upstream Less
test-data fixtures through `Compiler.renderToResult(...)`, so it covers the
public eval-plus-render path rather than a test-only compile-plus-`toString`
path.

See [`less/README.md`](./less/README.md) for how the Less tests are organised.
The `describe.todo` sketches that used to fill this directory are gone: the four
that remained were retired in 2026-09, after each case was compared against the
fixture corpus and `lessc` (most were redundant, and three asserted behaviour
Less itself rejects). Every Less test here now runs.

## Running The Main Signal

```sh
pnpm run test:less:test-data
```

For package-local iteration, prefer focused `vitest` runs against the file you
are changing, then run the Less fixture signal before claiming compatibility.

## Contributing

When adding new tests:

1. Prefer focused core tests for parser, AST, and runtime invariants.
2. Use package-level Jess tests for public compiler API behavior.
3. Compare Less compatibility through upstream test-data whenever possible.
4. Do not add broad `describe.todo` suites with unverified expectations.
5. Use `serializeTypes()` only when the test is specifically about AST shape.

## Test Data Sources

- Official Less test-data fixtures are the compatibility source of truth.
- Custom package tests should document the Jess-specific API or behavior they
  prove.
- Real-world fixture ports belong in focused files with a clear command and
  expected signal.
