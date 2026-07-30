# `docs/architecture/core/` — index

62 files landed here and nothing said which ones were still load-bearing. This is
that index. It is **an index, not a status tracker** — it records what each file
*is* and whether anything still points at it. It makes no progress claims; those
belong in [`HANDOFF.md`](./HANDOFF.md), [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md),
and [`../../state/PROJECT_STATE.md`](../../state/PROJECT_STATE.md).

**Start at [`HANDOFF.md`](./HANDOFF.md).** Its Router sends you to the right file
for the work you have. This page is for the other question: *"what is this file
and does anyone still use it?"*

## How the classification was made (2026-07-30, `991b315e0`)

Two mechanical signals, both reproducible:

- **last-touched** — `git log -1 --date=short -- <file>`. Note that **2026-07-24
  is not a real edit date** for most files: `0806ccdbb` bulk-moved the tree that
  day. "Last touched 2026-07-24" means *untouched since the move*.
- **inbound** — how many files under `docs/`, `.cursor/`, `AGENTS.md`,
  `CLAUDE.md`, or `README.md` mention it by name, excluding itself and
  `archive/`.

Neither signal is proof a document is wrong. A dormant orphan may be a correct
record nobody needed lately. They are a **reading order**, and a prompt to check
before citing a file as current.

## Live — recently edited and routed

| File | Role |
| --- | --- |
| [`HANDOFF.md`](./HANDOFF.md) | The entry point. Work in flight, priority checklist, open defects, Router. |
| [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md) | The canonical OPEN/SETTLED owner decision ledger. Cite a row; do not re-litigate it. |
| [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) | Patch-shape review standard. |
| [`PERF_IDEAS.md`](./PERF_IDEAS.md) | The measured workload and comparator numbers behind the current CPU lane. |
| [`TREE-CUTOVER-SURFACE.md`](./TREE-CUTOVER-SURFACE.md) | Deleting `packages/core/src/tree/`: public-surface inventory, `Context` decomposition, extraction order. |
| [`TREE2-DESIGN-SPEC.md`](./TREE2-DESIGN-SPEC.md) · [`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md`](./TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md) · [`TREE2-KILL-LIST.md`](./TREE2-KILL-LIST.md) · [`TREE2-CONSTITUTION.md`](./TREE2-CONSTITUTION.md) | The AST-v2 engine spec cluster. |
| [`UNIFIED-NODE-MODEL-SPEC.md`](./UNIFIED-NODE-MODEL-SPEC.md) · [`VALUE-NODE-MODEL-DESIGN.md`](./VALUE-NODE-MODEL-DESIGN.md) · [`VALUE-LITERAL-TAG-SPEC.md`](./VALUE-LITERAL-TAG-SPEC.md) | The node/value model. |
| [`RESOLVER-SHAPE-SPEC.md`](./RESOLVER-SHAPE-SPEC.md) · [`VARIABLE-RESOLUTION-SEMANTICS.md`](./VARIABLE-RESOLUTION-SEMANTICS.md) | Reference/resolution shape. |
| [`FNS-PACKAGE-MIGRATION-SPEC.md`](./FNS-PACKAGE-MIGRATION-SPEC.md) | The `@jesscss/fns` migration contract. |
| [`V5-OUTPUT-SEMANTICS.md`](./V5-OUTPUT-SEMANTICS.md) · [`JESS-PARENT-SELECTOR-DESIGN.md`](./JESS-PARENT-SELECTOR-DESIGN.md) | Emitted-output semantics. |
| [`DOC-COVERAGE.md`](./DOC-COVERAGE.md) | The 3-location documentation coverage matrix. |
| [`GOAL1-SCORECARD.md`](./GOAL1-SCORECARD.md) · [`LESS-V5-CONTENT-PR-PLAN.md`](./LESS-V5-CONTENT-PR-PLAN.md) | Less-alpha scoring and content plan. |
| [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) · [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) · [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) · [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) | Four short Router targets stating the no-host/no-bridge boundary from four angles. See the consolidation note below. |

## Live but unrouted — edited within the last week, zero inbound references

Nothing pointed at these, so a fresh agent would not find them. They are listed
here and, where they bear on current work, from `HANDOFF.md`.

| File | Last touched | Role |
| --- | --- | --- |
| [`BENCHMARK-AST-FAILURE-INVENTORY.md`](./BENCHMARK-AST-FAILURE-INVENTORY.md) | 2026-07-30 | Named inventory of benchmark-corpus AST failures. |
| [`NON-ENGINE-BLOAT-INVENTORY.md`](./NON-ENGINE-BLOAT-INVENTORY.md) | 2026-07-29 | Non-engine surface that is a size/complexity cost. |
| [`VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md`](./VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md) | 2026-07-29 | Lazy-materialization/memoization design for values. |
| [`STATIC-IMPORT-PREP-DESIGN.md`](./STATIC-IMPORT-PREP-DESIGN.md) | 2026-07-28 | Static-import preparation design. |

## Dormant — untouched since the 2026-07-24 move

Still in `architecture/` and still readable; simply not the current lane. Check
the date before citing one as the present state.

Referenced by at least one other document: `AST-ARENA-EXPERIMENT-HANDOFF.md`,
`AST-COLOCATION-REORG-PLAN.md`, `AST-FROM-SCRATCH-DESIGN.md`,
`AST-REMAINING-DEBT-KILL-LIST.md`, `ASSIGNABLE-CONTROL-NODES-PLAN.md`,
`BENCHMARK-PERF-PATH.md`, `BUILDERHOST-RETIREMENT-DESIGN.md`,
`EXTEND-4TH-OPTION-SYNTHESIS.md`, `EXTEND-PORT-DESIGN.md`,
`EXTEND-REDESIGN.md`, `EXTEND-SEMANTICS.md`, `NODE-SLIM-FOLLOWONS.md`,
`P0-PSEUDO-STRUCTURING-DESIGN.md`, `PHASE1-BURNDOWN.md`,
`PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md`,
`PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`,
`QUOTED-GRAMMAR-STRUCTURING-PLAN.md`, `R1-EXTEND-HANDOFF.md`, `REFERENCE.md`,
`REFERENCE-CALL-PLAN.md`, `SCSS-PARSER-REBASE-DESIGN.md`,
`STRINGS-OVER-NODES.md`, `TIER-B-INTERPOLATION-GRAMMAR-SPEC.md`,
`UNIFIED-EVAL-EMIT-DESIGN.md`, `WRONG-TESTDATA-AUDIT.md`, `_R1_IMPL_BRIEF.md`.

## Dormant AND orphaned — archive candidates (owner call, not yet moved)

Untouched since the move **and** referenced by nothing. 8 files, ~1,615 lines.
They have not been moved or deleted: dormancy plus orphaning is a prompt to
decide, not a verdict that a file is wrong.

| File | Lines | Why it is a candidate |
| --- | --- | --- |
| `AST-NATIVE-PLUGINS-DESIGN.md` | 569 | Plugin design predating the current plugin host / `compiler-preset` split. |
| `BENCHMARK-EXTEND-EVIDENCE.md` | 277 | Extend benchmark evidence superseded by the roadmap's own numbers. |
| `PARSER-RECOGNIZER-GAP.md` | 209 | Recognizer-gap inventory from before the four-grammar fold. |
| `TYPECHECK-BURNDOWN.md` | 208 | Burndown for a gate (`verify:types`) that `c3db7e53e` made green. |
| `AST-MIGRATION-MAP.md` | 176 | Migration map for a migration that has landed. |
| `AST-V2-STRUCTURE-BLUEPRINT.md` | 107 | Blueprint superseded by `UNIFIED-NODE-MODEL-SPEC.md`. |
| `AST-QUALITY-AUDIT.md` | 38 | One-off audit, no follow-up. |
| `GRAMMAR-AST-FUSION-DESIGN.md` | 31 | Fusion design; the eight-to-four fold is done. |

The "why" column is a **hypothesis from the file's own text and dates**, not a
verified supersession claim. Confirm before archiving any row.

## Consolidation note — the four boundary docs

`AST-REORG-EXECUTION.md` (42 lines), `GRAMMAR-RELOCATION-DESIGN.md` (48),
`CORE-CLEANUP.md` (50), and `AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md` (30)
each open by restating the same boundary: the parser grammar owns AST
construction, and no host, action registry, bridge, adapter, or source reparse is
a valid replacement. `HANDOFF.md`'s "Non-negotiable rules" states it a fifth
time.

They are not redundant in their tails — each carries a distinct queue
(`CORE-CLEANUP.md` an active priority table, `AST-REORG-EXECUTION.md` the
construction rules, and so on). The duplication is in the preambles. Merging
them is an owner call because all four are Router targets; it is recorded here
so the next reader does not mistake four statements of one rule for four rules.

## Subdirectories

- [`archive/`](./archive/) — 21 files, ~14,300 lines of superseded history. Read
  for archaeology; never cite as current.
- [`spec/`](./spec/) — 7 files of R-numbered specs (`R4`, `R6`, `R7`,
  `TREE2-EMITTING-GRAMMAR-PLAN`).
