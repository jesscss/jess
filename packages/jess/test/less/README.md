# Less Integration Test Status

`all-less.test.ts` is the fixture-backed Less compatibility signal in this
directory. It renders through `Compiler.renderToResult(...)`, so it covers the
public eval-plus-render path rather than a test-only compile-plus-`toString`
serialization path.

No test here is `describe.todo` any more. The suites that were — variables,
property-accessors, at-plugin and extend-chaining-ast-compare — were retired in
2026-09 once each case was checked against the fixture corpus and `lessc 4.9.1`:
most duplicated a byte-identical fixture, several asserted behaviour Less itself
rejects, and one exercised options that no longer exist. Two cases were worth
keeping and were re-homed; the details are in that PR.

The lesson is worth keeping rather than the suites: a `describe.todo` expectation
written while chasing behaviour is not coverage, and the corpus is the oracle.

Do not use todo/debug compile-plus-`toString(...)` tests as evidence that the
render migration is incomplete. Active Less integration coverage should use
`render(...)`, `renderString(...)`, or `renderToResult(...)` unless the test is
explicitly about the `compile(...)` tree API.
