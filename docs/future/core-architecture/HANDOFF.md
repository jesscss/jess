# Core Architecture Handoff

## Current target

Keep AST v2 as the canonical representation. Parseman grammar reductions create
exact AST data directly; core has no parser construction host, action registry,
bridge, source reparse, or compatibility path.

## Router

| Work | Read first |
| --- | --- |
| Direct parser AST construction and legacy-builder deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) |
| Parser recognition, interpolation, and scanner cleanup | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) |
| Feature/eval closure | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) |
| Eval/render allocation, lookup, and traversal cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) |

The detailed future plans remain active for their grammar, feature/eval,
scanner-cleanup, and performance content. Their former bridge/host sections are
historical evidence only.

## Non-negotiable rules

- Grammar owns recognition and construction. Do not add a parser host, action
  registry, bridge, compatibility alias, source reparse, or fallback path.
- Parser recognition uses Parseman grammar combinators only. Imports and
  interpolation are typed first-parse facts.
- Preserve one canonical tree; do not normalize cloning, materialization,
  rediscovery, or error allocation in hot paths.
- Public operations use stable names such as `parse`, `build`, and `render`.

## Completion gates

Run focused parser/core tests first. Run the parser-runtime boundary verifier
when recognition changes. For eval/render/lookup/traversal/copying changes, run
`pnpm run verify:aggressive-cutting-review` before commit. Final integration
requires fresh builds, core tests, the Jess production spine ratchet, and the
Less corpus.

## Aggressive Cutting Self-Prosecution

- Latest pass: documentation control-surface correction.
- Architecture surface: live routing and review controls only; no runtime machinery changed.
- Separation/duplication: historical bridge detail is retained in lane documents, not duplicated in live controls.
- Cumulative node weight: none.
- New traversal: none.
- New node/materialization: none.
- Render path: none.
- Helper/API surface: none.
- Metadata mutations: none.
- Review-flagged diff tokens: none.
- Evidence: documentation diff review and `git diff --check`.
- Verdict: accepted.
