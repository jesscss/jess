# Jess 2.0.0-alpha.22

This alpha brings the module-system work previously staged on the release
branch back onto `dev` and publishes it with the Parseman fix it depends on.

## Highlights

### Configurable modules

- `@compose` supports `with` for configuration local to one compose edge and
  `set` for persistent configuration shared by later composes.
- Live module variables see their configured values while dialect plugins keep
  control over which configuration forms they admit.
- Conflicting persistent configurations report an error instead of silently
  selecting one value.

### Module isolation and emission

- Composed and used modules now have isolated, non-transitive scopes.
- Namespaced access resolves members through the module boundary without
  leaking those members into the caller.
- Shared modules emit once, while modules configured with per-edge `with`
  values emit independently for each edge.
- Per-edge configuration remains independent from a persistent `set` on the
  same module.

### Less parser

- Namespaced reference calls now dispatch forward from `#` and `.` heads,
  including chained member access.
- The parsers now use `parseman@0.50.7`. Its corrected table first-set analysis
  preserves valid trivia-separated continuations, allowing the Less grammar to
  remove its speculative `attempt(...)` wrapper without changing accepted
  syntax.
- All shipped grammar modules remain macro compiled with zero interpreter
  fallbacks.

## Known limitations

The Less alpha fixture lane is a classified compatibility signal, not a claim
that every upstream Less 4.x fixture is byte-identical. The release-facing
inventory is
[`less-v5-corpus-inventory.md`](../state/less-v5-corpus-inventory.md), and the
readiness gates and remaining package-flow work are tracked in
[`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md).
