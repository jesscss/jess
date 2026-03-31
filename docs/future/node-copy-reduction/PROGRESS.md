# Node Copy Reduction — Progress

See [STAGES.md](./STAGES.md) for detailed current state.

## Summary (2026-03-31)

The branch has been reset around the cursor/edge target model again.

- core tests no longer directly use `activeState`, `EvalState`, `setField`, or
  `getField`
- narrow control proofs exist for runtime-generated loop render keys
- list-like container proofs exist for `List` and `Sequence` keyed child edges
- `Ruleset` and `AtRule` helper cleanup is real, but scope ownership is still
  not fully converted
- remaining focused reds are production/runtime seams, not old test-patch seams

## Branch Status

**Not merge-ready.** Remaining work is production conversion: scope ownership,
returned-result ownership, and old helper/runtime seams such as
`field-helpers.ts`, `legacy-node-ops.ts`, and `Rules.renderParent`.
