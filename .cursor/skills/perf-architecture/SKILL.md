---
name: perf-architecture
description: Load BEFORE writing or changing code on Jess hot paths (core tree/eval/render, grammar/parser, extend/selector algorithms). Packages the 7 V8-architecture invariants as pre-write checks and points at the canonical checklist.
---

# Perf architecture (pre-write checklist)

Load this skill **before** writing code on a perf-sensitive path, especially:

- `packages/core/src/tree/**` (eval, render, lookup, extend, selectors)
- `packages/*-parser/src/**` (grammar, productions, parseman macros)
- extend/selector algorithms (`packages/core/src/tree/util/extend.ts`)

Canonical checklist (invariant text, gates, and the regression catalogue):
[`docs/perf/V8-ARCHITECTURE.md`](../../../docs/perf/V8-ARCHITECTURE.md).
Design rationale: `docs/future/llm-quality-enforcement-design.md`.
Repo-wide contract: `AGENTS.md` → **Performance Direction** / **Performance
Architecture**.

## Before you write X, check Y

1. **Copy/clone** — before `.copy(true)` / `.clone(true)` /
   `copyWithReusableLeaves(this)`: can node reuse + lazy per-placement state
   serve this instead? Deep copy as eval isolation is an anti-pattern.
   *(gate: `verify:node-copy-frontier`)*

2. **Materialize** — before `x.eval(ctx).toString()` /
   `.resolve(...).toTrimmedString(...)`: serialize the structured node directly;
   don't stringify mid-eval. *(gate: `verify:materialization-frontier`)*

3. **Render** — before concatenating output or adding a `renderNodeTo*` path:
   route through the canonical render-buffer
   (`packages/core/src/tree/util/render-buffer.ts`). One pass, one buffer.
   *(gate: `verify:render-buffer-frontier`)*

4. **Lookup / re-derive** — before `.findVariable/.findProperty/.findDeclaration`,
   a `documentHas*` scan, or recomputing a set/array you already hold: use the
   occurrence helpers (`find*DeclarationOccurrence`); cache-once/read-many;
   short-circuit the empty case with a flag/bitset before any scan.
   *(gate: `verify:binding-lookup-hot-paths`)*

5. **New field / helper / shim** — before adding one: is it on the leanest path
   to the feature and mapped to the target runtime model, or just
   "currently used"? Delete transitional surfaces in the cutover; don't carry
   no-op wrappers. *(gate: `verify:aggressive-cutting-review`)*

6. **Shape & op-growth** — before a sometimes-present field, a mixed-shape call
   site, or a scan/`choice` whose cost grows with input: keep the hot call site
   **monomorphic** (one stable hidden class), and keep operations linear/constant
   via Set/Map/bitset instead of `O(n·m)`; left-factor big `choice` fan-outs.
   *(reviewer-enforced; incidents R3–R5 in the catalogue)*

7. **Grammar / compose** — before landing a grammar or parseman `compose()`/macro
   change: read a *clean* full build log for `falling back to runtime` or
   `references missing rule`. A stale `lib/` masks compose failures — build the
   chain serially from clean. *(gate: `verify:compose-integrity`)*

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
