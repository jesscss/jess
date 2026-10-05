# Design docs — proposed, not built

Everything in this directory describes work the repo **does not have yet**:
proposals, specs awaiting owner sign-off, and exploratory analysis. When a design
here lands, move the doc to `docs/architecture/` and rewrite it to describe what
exists rather than what was proposed.

For how the engine works *today*, read `docs/architecture/` — starting with
[`../architecture/core/HANDOFF.md`](../architecture/core/HANDOFF.md).

Notable entries:

- [`CSSWG-DOLLAR-NAMESPACE.md`](./CSSWG-DOLLAR-NAMESPACE.md) — unfiled CSSWG
  proposal: preprocessors vacate `@` and the function namespace, CSS reserves
  `$`-led shapes the way `--*` is reserved.
- [`DIALECT-TO-JESS-COMPILED-CONVERSION.md`](./DIALECT-TO-JESS-COMPILED-CONVERSION.md)
  — there is no `jess convert` command; this is the design for one.
- [`REMOTE-IMPORTS-NETWORK-POLICY.md`](./REMOTE-IMPORTS-NETWORK-POLICY.md) —
  network `@import` through the opt-in `@jesscss/plugin-remote-import` (without
  it, URL imports are CSS terminals): a host allowlist, https only, no
  cross-host redirects, private addresses denied, size and time caps, and a
  test that proves Deno `--allow-net` *denies* an off-list host.
- [`OPAQUE-FAMILY-REMOVAL.md`](./OPAQUE-FAMILY-REMOVAL.md) — the whole `Opaque*`
  family across the four grammars and `parser-shared`, enumerated with
  file:line, and why an unknown at-rule must parse known rules rather than carry
  a second copy of CSS.
- [`JESS-EQUIVALENCE-HARNESS.md`](./JESS-EQUIVALENCE-HARNESS.md) — the
  construct-support inventory it describes is landed
  (`packages/jess/test/jess/conversion-construct-support.test.ts`); the
  equivalence harness itself is not.

Historical transition docs were removed from the working tree. Use git history
for archaeology.
