# Core Cleanup — live queue

This is the bounded tracker for active core cleanup. It deliberately excludes
dated throughput logs, completed scales, and rejected experiments; those are
preserved in
[`archive/CORE-CLEANUP-history-2026-07-18.md`](./archive/CORE-CLEANUP-history-2026-07-18.md).

## Active queue

| Priority | Outcome | Owner boundary | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | AST v2 is the only canonical core tree | `AST-REORG-EXECUTION.md` owns the parser/front-end cutover | each dialect builds AST directly; no parse/build host remains |
| 2 | Delete `packages/core/src/ast/parse-host` and its test-only bridge seams | core AST + migrated tests | no production/test import retains `parseToAst`, `bridgeToAst`, `parseLessFn`, or a compatibility replacement |
| 3 | Preserve and close core eval/render semantics on canonical AST | core eval/render lane | focused tests, full core suite, no baseline weakening |
| 4 | Eliminate handwritten parser recognition debt | dialect parser lanes | parser-runtime boundary verifier reaches zero source violations |
| 5 | Prove Jess Less behavior after dependencies are rebuilt | integration lane | production spine ratchet and byte-identical Less corpus |
| 6 | Improve SCSS only after rows 1–4 | SCSS parser lane | equivalent fresh benchmark against Dart Sass; report speed and memory separately |

Rows 1–4 can use isolated worktrees when their write sets do not overlap. Their
integration order is determined by real source dependencies, never by preserving
transitional callers. Rows 5–6 are integration gates, not substitutes for the
earlier structural cuts.

## Standing cleanup rules

- Prefer deletion or direct representation over a wrapper, registry, adapter,
  cache, clone, or no-op compatibility export.
- A performance claim needs a matched before/after measurement of the same
  workload. Object-count reduction is supporting evidence, not the claim.
- Expected misses use typed results, sentinels, or booleans; `Error` objects are
  exceptional only.
- Keep tests at public dialect render seams or core behavior seams. Tests that
  assert transitional hosts or private transport belong in history unless they
  are being migrated in the same change.
- Before committing a queue pass touching eval/render/lookup/traversal/copying,
  run `pnpm run verify:aggressive-cutting-review`, `git diff --check`, and focused
  tests. Run the broader package gates at the coherent batch boundary.

## Documentation maintenance result (2026-07-18)

| Result | Evidence | Active location | Historical location |
| --- | --- | --- | --- |
| Removed stale cutover status board | it named obsolete branch and plan references; its figures were explicitly self-marked stale | `HANDOFF.md` gates + lane docs | `archive/CUTOVER-STATUS-2026-07-18.md` |
| Removed stale staged cutover checklist | its old P0–P5 sequence competes with AST-v2 canonicalization | `AST-REORG-EXECUTION.md` | `archive/CUTOVER-CHECKLIST-2026-07-18.md` |
| Compacted the router | only target, router, laws, and gates are live | `HANDOFF.md` | `archive/HANDOFF-history-2026-07-18.md` |
| Compacted this tracker | live work is limited to the six rows above | this file | `archive/CORE-CLEANUP-history-2026-07-18.md` |

This pass preserves every prior decision and measurement through the archive; it
does not reclassify or erase any of them. High-risk grammar/eval design documents
remain unchanged pending source-backed review.
