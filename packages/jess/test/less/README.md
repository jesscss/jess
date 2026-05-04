# Less Integration Test Status

`all-less.test.ts` is the fixture-backed Less compatibility signal in this
directory.

The other tests are currently marked `describe.todo` because many expectations
were added locally while chasing parser and serializer behavior. Treat those
expectations as suspect until each one is revalidated against upstream Less
test-data, Less.js behavior, or a documented Jess-specific contract.
