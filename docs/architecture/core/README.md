# `docs/architecture/core/` — index

**Start at [`HANDOFF.md`](./HANDOFF.md).** Its Router sends you to the right file
for the work you have. This page answers the other question: *"what is this file,
and is it still current?"*

This is an index, not a status tracker. It records what each file *is*; progress
claims belong in [`HANDOFF.md`](./HANDOFF.md),
[`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md), and
[`../../state/PROJECT_STATE.md`](../../state/PROJECT_STATE.md).

## The 2026-07-30 cleanup (`0dbfc89f0`)

63 files → **47**. Sixteen were moved, none deleted.

*(Corrected 2026-07-30: this said `991b315e0`, which is a merge commit whose tree still
held 62 files; the cleanup is `0dbfc89f0` "docs: archive self-declared-historical core
docs". Its parent tree has 63 `.md` files, and 63 − 16 = 47, which is why the old
"62 → 47, sixteen moved" arithmetic did not close.)*

The signal that decided it was **each document's own header**. Fifteen files
opened with some form of *"Historical design evidence — not an execution plan"*,
*"Status: ARCHIVED"*, or *"STRUCK AS AN EXECUTION PLAN"* — mostly describing the
retired tree2 / parse-host / bridge era — while still sitting in `architecture/`.
`../../README.md` is explicit that **a document describing machinery the repo
does not have does not belong in `architecture/`**, so they moved to
[`archive/`](./archive/). One more, `AST-NATIVE-PLUGINS-DESIGN.md`, is marked
DESIGN-ONLY for unbuilt work, so it moved to
[`../../design/`](../../design/AST-NATIVE-PLUGINS-DESIGN.md) under the same rule.

**Inbound-reference count turned out to be a bad liveness signal and is not used
here.** An earlier pass of this index guessed at staleness that way and got four
of eight calls wrong in both directions: `AST-QUALITY-AUDIT.md` and
`TYPECHECK-BURNDOWN.md` are unreferenced but live, while
`UNIFIED-NODE-MODEL-SPEC.md` and `TREE2-KILL-LIST.md` were well-referenced and
self-declared historical. Read the header, not the backlinks.

Two files were reprieved on evidence:

- **`TYPECHECK-BURNDOWN.md`** — still live, but barely. **Re-measured 2026-07-30 on
  `facb641dd`: `--noCheck` survives in exactly TWO package.json files** —
  `packages/syntax/scss/scss-parser/package.json:59` and
  `packages/syntax/jess/jess-parser/package.json:59`
  (`grep -rn noCheck --include=package.json packages/`). The **15** recorded here was
  7.5x too high and was the sole stated evidence for reprieving this doc from the
  archive. The burn-down is ~87% done; whether two holdouts still warrant a live
  document is an owner call.
- **`AST-QUALITY-AUDIT.md`** — live. Present-tense audit criteria for
  `packages/core/src/ast`, explicitly scoped to exclude the deleted host/bridge
  paths.

## Live

| File | Role |
| --- | --- |
| [`HANDOFF.md`](./HANDOFF.md) | The entry point. Work in flight, priority checklist, open defects, Router. |
| [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md) | The canonical OPEN/SETTLED owner decision ledger. Cite a row; do not re-litigate it. `OWNER-LEDGER:` |
| [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) | Patch-shape review standard. |
| [`AST-QUALITY-AUDIT.md`](./AST-QUALITY-AUDIT.md) | Audit criteria for `packages/core/src/ast` as a parser-independent leaf. |
| [`PERF_IDEAS.md`](./PERF_IDEAS.md) | The measured workload and comparator numbers behind the current CPU lane. |
| [`TREE-CUTOVER-SURFACE.md`](./TREE-CUTOVER-SURFACE.md) | Deleting `packages/core/src/tree/`: public-surface inventory, `Context` decomposition, extraction order. |
| [`TREE2-DESIGN-SPEC.md`](./TREE2-DESIGN-SPEC.md) | Subsystem-by-subsystem spec for the core rewrite. |
| [`VALUE-NODE-MODEL-DESIGN.md`](./VALUE-NODE-MODEL-DESIGN.md) · [`VALUE-LITERAL-TAG-SPEC.md`](./VALUE-LITERAL-TAG-SPEC.md) · [`VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md`](./VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md) | The value model: shape, literal tagging, materialization/memoization. |
| [`RESOLVER-SHAPE-SPEC.md`](./RESOLVER-SHAPE-SPEC.md) · [`VARIABLE-RESOLUTION-SEMANTICS.md`](./VARIABLE-RESOLUTION-SEMANTICS.md) · [`REFERENCE.md`](./REFERENCE.md) · [`REFERENCE-CALL-PLAN.md`](./REFERENCE-CALL-PLAN.md) | Reference / resolution shape. |
| [`FNS-PACKAGE-MIGRATION-SPEC.md`](./FNS-PACKAGE-MIGRATION-SPEC.md) | The `@jesscss/fns` migration contract. Carries a partial-supersession header on the registration mechanism only. |
| [`V5-OUTPUT-SEMANTICS.md`](./V5-OUTPUT-SEMANTICS.md) · [`JESS-PARENT-SELECTOR-DESIGN.md`](./JESS-PARENT-SELECTOR-DESIGN.md) · [`UNIFIED-EVAL-EMIT-DESIGN.md`](./UNIFIED-EVAL-EMIT-DESIGN.md) | Emitted-output and eval/emit semantics. |
| [`EXTEND-SEMANTICS.md`](./EXTEND-SEMANTICS.md) · [`EXTEND-PORT-DESIGN.md`](./EXTEND-PORT-DESIGN.md) · [`EXTEND-REDESIGN.md`](./EXTEND-REDESIGN.md) · [`EXTEND-4TH-OPTION-SYNTHESIS.md`](./EXTEND-4TH-OPTION-SYNTHESIS.md) · [`R1-EXTEND-HANDOFF.md`](./R1-EXTEND-HANDOFF.md) · [`_R1_IMPL_BRIEF.md`](./_R1_IMPL_BRIEF.md) | The extend cluster. |
| [`BENCHMARK-EXTEND-EVIDENCE.md`](./BENCHMARK-EXTEND-EVIDENCE.md) | Per-case adjudication of the benchmark extend shapes against real Less 4.6.7. Completed evidence, still valid. |
| [`PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`](./PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md) · [`PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md`](./PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md) · [`P0-PSEUDO-STRUCTURING-DESIGN.md`](./P0-PSEUDO-STRUCTURING-DESIGN.md) | Pseudo-argument structuring. |
| [`TYPECHECK-BURNDOWN.md`](./TYPECHECK-BURNDOWN.md) | The `--noCheck` burn-down. Open: **2** package.json files at `facb641dd` (scss-parser, jess-parser); the `15` here was 7.5x too high. |
| [`STATIC-IMPORT-PREP-DESIGN.md`](./STATIC-IMPORT-PREP-DESIGN.md) · [`ASSIGNABLE-CONTROL-NODES-PLAN.md`](./ASSIGNABLE-CONTROL-NODES-PLAN.md) · [`NODE-SLIM-FOLLOWONS.md`](./NODE-SLIM-FOLLOWONS.md) · [`STRINGS-OVER-NODES.md`](./STRINGS-OVER-NODES.md) | Node/import shape work. |
| [`NON-ENGINE-BLOAT-INVENTORY.md`](./NON-ENGINE-BLOAT-INVENTORY.md) · [`WRONG-TESTDATA-AUDIT.md`](./WRONG-TESTDATA-AUDIT.md) · [`DOC-COVERAGE.md`](./DOC-COVERAGE.md) | Inventories and coverage matrices. |
| [`LESS-4X-FEATURE-TRIAGE.md`](./LESS-4X-FEATURE-TRIAGE.md) | Feature-by-feature triage of Less 4.8.1 against jess, every row measured against `lessc` 4.8.1 run directly. States what it did not examine. Carries its measurement SHAs — re-measure before relying on a row. |
| [`LESS-V5-CONTENT-PR-PLAN.md`](./LESS-V5-CONTENT-PR-PLAN.md) | Less-alpha content plan. |
| [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) · [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) · [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) · [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) · [`GRAMMAR-AST-FUSION-DESIGN.md`](./GRAMMAR-AST-FUSION-DESIGN.md) | Five short docs stating one boundary rule from five angles. See below. |

Also live and self-explanatory: [`AST-FROM-SCRATCH-DESIGN.md`](./AST-FROM-SCRATCH-DESIGN.md),
[`AST-COLOCATION-REORG-PLAN.md`](./AST-COLOCATION-REORG-PLAN.md),
[`PHASE1-BURNDOWN.md`](./PHASE1-BURNDOWN.md),
[`PARSER-RECOGNIZER-GAP.md`](./PARSER-RECOGNIZER-GAP.md).

> `PARSER-RECOGNIZER-GAP.md` carries **stale measurements** — its phase profile
> was taken 2026-07-15 against parseman 0.32-era code, and the floor is now
> `^0.45.0` (`75002c4a3`). The Less-4.x-versus-Parseman gap it frames is still the live
> question; its numbers are not current. Re-measure before citing.

## Consolidation note — five docs, one rule

`AST-REORG-EXECUTION.md` (42 lines), `GRAMMAR-RELOCATION-DESIGN.md` (48),
`CORE-CLEANUP.md` (50), `AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md` (30),
and `GRAMMAR-AST-FUSION-DESIGN.md` (31) each open by restating the same
boundary: the parser grammar owns AST construction, and no host, action
registry, bridge, adapter, or source reparse replaces it. `HANDOFF.md`'s
"Non-negotiable rules" states it a sixth time.

Their tails are *not* redundant — each carries a distinct queue. The duplication
is in the preambles. Merging them is an owner call because four are Router
targets; it is recorded here so the next reader does not mistake six statements
of one rule for six rules.

## Subdirectories

- [`archive/`](./archive/) — 36 files. Superseded history, including the 15
  moved on 2026-07-30. Read for archaeology; never cite as current.
- [`spec/`](./spec/) — R-numbered specs: `R2-value-eval`, `R3-live-bindings`,
  `R4-interpolation-detached-merge-namespaces`, `R5-sourcemaps-trivia`,
  `R6-plugins-compat-modules`, `R7-dialects-endgame`, `TREE2-EMITTING-GRAMMAR-PLAN`.
  *(R2 and R3 were missing from this list until the 2026-07-30 docs audit.)*
- [`proposed-alpha-corrections/`](./proposed-alpha-corrections/) — a `README.md` plus
  proposed `.less`/`.css` fixture corrections awaiting owner adjudication. Missing from
  this section until the 2026-07-30 docs audit.
