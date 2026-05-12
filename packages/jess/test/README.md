# Jess Integration Tests

This directory contains package-level integration tests for the public Jess
compiler APIs.

## Less

The active Less compatibility signal is
[`less/all-less.test.ts`](./less/all-less.test.ts). It renders upstream Less
test-data fixtures through `Compiler.renderToResult(...)`, so it covers the
public eval-plus-render path rather than a test-only compile-plus-`toString`
path.

See [`less/README.md`](./less/README.md) before using any other Less test file.
Most remaining Less files are `describe.todo` sketches from earlier parser and
serializer investigations. Treat their expectations as untrusted until they are
revalidated against upstream Less behavior, Jess behavior docs, or focused core
tests.

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
