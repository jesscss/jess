# Less Integration Test Status

`all-less.test.ts` is the fixture-backed Less compatibility signal in this
directory. It renders through `Compiler.renderToResult(...)`, so it covers the
public eval-plus-render path rather than a test-only compile-plus-`toString`
serialization path.

The other tests are currently marked `describe.todo` because many expectations
were added locally while chasing parser and serializer behavior. Treat those
expectations as suspect until each one is revalidated against upstream Less
test-data, Less.js behavior, or a documented Jess-specific contract.

Do not use todo/debug compile-plus-`toString(...)` tests as evidence that the
render migration is incomplete. Active Less integration coverage should use
`render(...)`, `renderString(...)`, or `renderToResult(...)` unless the test is
explicitly about the `compile(...)` tree API.
