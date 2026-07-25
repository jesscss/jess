---
name: perf-architecture
description: Load BEFORE writing or changing code on Jess hot paths (core tree/eval/render, grammar/parser, extend/selector algorithms). Packages the 9 V8-architecture invariants as pre-write checks and points at the canonical checklist.
---

# Perf architecture (pre-write checklist)

Load this skill **before** writing code on a perf-sensitive path, especially:

- `packages/core/src/tree/**` (eval, render, lookup, extend, selectors)
- `packages/*-parser/src/**` (grammar, productions, parseman macros)
- extend/selector algorithms (`packages/core/src/tree/util/extend.ts`)

Canonical checklist (invariant text, gates, and the regression catalogue):
[`docs/perf/V8-ARCHITECTURE.md`](../../../docs/perf/V8-ARCHITECTURE.md).
Design rationale: `docs/architecture/llm-quality-enforcement-design.md`.
Repo-wide contract: `AGENTS.md` → **Performance Direction** / **Performance
Architecture**.

## Before you write X, check Y

Numbered to match the canonical `docs/perf/V8-ARCHITECTURE.md` invariants 1–9.

1. **Monomorphic node shapes** — before adding a sometimes-present field,
   `delete node.*`, conditional field assignment, or `{ ...node }` reshape: keep
   every node of a `type` one field set/order through one factory. A second
   hidden class per type is the single biggest cost.
   *(gate: shape-stability harness `test/ast-shape/` + reshape lints)*

2. **Never re-derive / materialize early** — before `x.eval(ctx).toString()` /
   `.resolve(...).toTrimmedString(...)` or serializing a node then scanning the
   string: read the structured data off the node; render the structured node
   directly. *(gate: `verify:materialization-frontier` + serialize-to-scan lint)*

3. **Never full-tree-walk; lookups are occurrence reads** — before a
   `documentHas*` scan, `.findVariable/.findProperty/.findDeclaration`, or
   recomputing a set/array you already hold: use a parse-time flag / O(1) bitset
   reject and the occurrence helpers; short-circuit the empty case before any
   scan. *(gate: `verify:binding-lookup-hot-paths` + extend op-counter budgets)*

4. **Complexity class is an invariant (even clean-room)** — before rewriting a
   tuned subsystem (extend, selectors, grammar): consult the tuned impl + its
   design doc; preserve the design principles and complexity class. Clean-room ≠
   constraint-free. *(gate: scaling budgets `extend-op-budget` + `design/NNN.md`)*

5. **Allocation discipline / one canonical tree** — before `[...spread]` /
   `Array(n).fill()` / `{ ...clone }` / a fresh `Set`/`Map` per iteration, or a
   deep `.copy(true)`/`.clone(true)` to isolate eval: single-value fast-path
   first, reuse buffers, prefer one canonical tree + lazy per-placement state.
   *(gate: `verify:node-copy-frontier` + `audit:node-creation`)*

6. **Render through the canonical buffer** — before concatenating output or
   adding a bespoke `renderNodeTo*` path: route through the one canonical render
   buffer. One pass, one buffer. *(gate: `verify:render-buffer-frontier`)*

7. **Leanest path only** — before adding a node field, helper, wrapper, or
   compat shim: is it on the leanest path to the target runtime model, or just
   "currently used"? Delete transitional surfaces in the cutover.
   *(gate: `verify:aggressive-cutting-review`)*

8. **Dispatch once; don't re-scan a shared prefix** — before listing N
   alternatives that re-scan a shared prefix or copy a large `choice` across
   contexts: read the leading token/`@keyword` once, then switch; left-factor.
   (Parseman first-char-gates disjoint arms — prove a re-scan is real first.)
   *(gate: `no-oversized-choice` lint)*

9. **Grammar codegen integrity** — before landing a grammar or parseman
   `compose()`/macro change: read a *clean* full build log for `falling back to
   runtime` or `references missing rule`. A stale `lib/` masks compose failures —
   build the chain serially from clean. *(gate: `verify:compose-integrity`)*

## Don't claim perf wins without measurement

State the expected impact (complexity / allocations / hot loop / shape). If you
assert a speedup, back it with a controlled same-worktree measurement, not a
synthetic or cross-directory one. If unsure, say so.

## Watch the regression catalogue

`docs/perf/V8-ARCHITECTURE.md` lists the real incidents that recurred
(`selectorAtoms` re-derivation, `documentHasExtend` tree-walk, extend
`.includes()` `O(n·m)`, polymorphic shapes, the 20×7 `choice` fan-out,
compose-integrity/stale-build). If your change touches extend, lookup, grammar
`choice`, or node shape, re-read the matching row before writing.
