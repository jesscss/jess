# V8 Architecture — perf invariants checklist

Canonical, tool-neutral checklist for anyone (human or agent) writing or
reviewing code on Jess's hot paths: parsing, the evaluation/render engine, and
the extend/selector algorithms.

This doc is the **single source of truth** the perf-architecture skill, the
`perf-architecture-reviewer` agent, `AGENTS.md`, and the `.cursor/rules/*`
perf guidance all point at. Keep the invariant list here; the other surfaces
reference it rather than restating it. The design rationale for this
enforcement layer lives in
[`docs/future/llm-quality-enforcement-design.md`](../future/llm-quality-enforcement-design.md).

Related canonical perf/architecture docs:

- `AGENTS.md` → **Performance Direction** and **Performance Architecture** (cross-tool contract)
- `docs/future/core-architecture/HANDOFF.md` (active architecture queue)
- `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md` (cutting protocol)

Each invariant below is enforced by a mechanical gate where one exists (run
locally with `pnpm run <script>`; all also run in `.github/workflows/pr-quality-gate.yml`).
A gate is a backstop, **not** a substitute for the up-front check — several of
the regression incidents in the catalogue passed every test and every existing
gate at the time they landed.

---

## The 7 invariants

Read each as **"before you write X, check Y."**

### 1. One canonical source tree — do not copy/clone as routine isolation

**Before you write** `.copy(true)`, `.clone(true)`, `copyWithReusableLeaves(this)`,
or any deep node duplication,
**check** whether the placement can be served by node reuse and lazy
per-placement state (the live-binding spine) instead. Deep-copying a subtree to
"isolate" an eval is an anti-pattern here: it multiplies allocations and defeats
the single-canonical-tree model.

- Gate: `verify:node-copy-frontier` — pins the exact allowed deep-copy sites; a
  new one fails the gate.
- Allocation-facing companion audit: `audit:node-creation`.

### 2. Lazy materialization — never `eval(...).toString()` on the hot path

**Before you write** `x.eval(ctx).toString()` / `.resolve(...).toTrimmedString(...)`,
**check** whether you can serialize the already-structured node directly.
Materializing a value to a string mid-eval throws away structure the serializer
needs and forces re-parsing/re-derivation downstream. Verbatim output = serialize
the structured node, not re-stringify an evaluated one.

- Gate: `verify:materialization-frontier` — flags eval/resolve→toString chains
  outside the pinned allowlist.

### 3. Render through the buffer — single pass, no ad-hoc string assembly

**Before you build** output by concatenating strings or adding a bespoke
`renderNodeTo*` path,
**check** that output flows through the canonical render-buffer
(`packages/core/src/tree/util/render-buffer.ts`). One output pass, one buffer;
no parallel string-building surface.

- Gate: `verify:render-buffer-frontier`.

### 4. Binding lookups are O(1)-shaped occurrence reads — never re-derive or tree-walk

**Before you write** `.findVariable(...)`, `.findProperty(...)`,
`.findDeclaration(...)`, a `documentHas*` scan, or any per-lookup recompute of
data you already hold,
**check** that you are using the occurrence helpers
(`findVariableDeclarationOccurrence`, `findPropertyDeclarationOccurrence`,
`findAnyDeclarationOccurrence`) and that nothing walks the tree or re-derives a
set/array on each hot-path call. Cache-once, read-many; short-circuit the empty
case; use a bitset/flag reject before any scan.

- Gate: `verify:binding-lookup-hot-paths` — requires the occurrence helpers and
  forbids the declaration-wrapper reads on the reference path.

### 5. Leanest path only — no field, helper, or shim that the target model does not need

**Before you add** a node field, a helper, a wrapper, or a compatibility shim,
**check** that it is on the leanest path to the feature and maps to the target
runtime model — not merely "currently used." Transitional/undocumented surfaces
are to be deleted in the cutover, not carried forward as no-op wrappers. Trading
a deleted node for a more expensive state graph, recursive walk, or call ladder
is a net loss.

- Gate: `verify:aggressive-cutting-review` (protocol:
  `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md`).

### 6. Stable node shapes and bounded operation growth — keep call sites monomorphic

**Before you add** a field that is sometimes-present, mix differently-shaped
objects through one call site, or introduce a scan/choice whose cost grows with
input,
**check** two things:
(a) **shape** — the objects flowing through a hot call site keep one stable
hidden class (no polymorphic/sometimes-present fields, no shape that varies by
branch); and
(b) **op-growth** — the operation is not `O(n·m)` or worse where a keyed
structure (Set/Map/bitset) makes it linear or constant, and it does not fan a
`choice`/dispatch out to a large alternative count on the hot path.

- No dedicated gate; this is the reviewer's primary manual responsibility and
  the source of several catalogue incidents below.

### 7. Grammar composes cleanly — no silent degrade to the runtime interpreter

**Before you land** a grammar or parseman `compose()`/macro change,
**check** a *clean* build log for `falling back to runtime` or
`compose: rule "x" references missing rule "y"`. A stale `lib/` can mask a
compose failure; incremental builds hide it. Build the full chain serially from
clean and read the log.

- Gate: `verify:compose-integrity` (also captured server-side in the PR quality
  gate against the clean serial build).

---

## Regression-fixture catalogue (reviewer must always catch)

These are **real incidents** — each passed the tests (and, in most cases, the
gates) that existed when it landed. The `perf-architecture-reviewer` treats this
list as mandatory coverage: every review must state, per item, whether the diff
reintroduces the shape.

| # | Incident | Invariant | Shape to catch |
|---|----------|-----------|----------------|
| R1 | **`selectorAtoms` re-derivation** | 4 | Recomputing the selector-atom `string[]`/`Set` on each predicate call instead of deriving decision-time scratch once and freeing it; atom sets rebuilt per node during traversal. |
| R2 | **`documentHasExtend` tree-walk** | 4 | A per-eval walk of the whole document to answer a yes/no that should be a cached flag / O(1) bitset reject; zero-extend documents must short-circuit. |
| R3 | **extend `.includes()` `O(n·m)`** | 6 | Nested `Array.prototype.includes`/linear membership over selectors × targets where a `Set`/bitset makes it linear; superlinear growth with selector count. |
| R4 | **polymorphic node shapes** | 6 | A sometimes-present field or branch-varying object shape that de-optimizes a hot call site from monomorphic to polymorphic/megamorphic. |
| R5 | **20×7 `choice` fan-out** | 6 | A grammar `choice` (or dispatch) fanned to ~20 alternatives re-tried ~7 deep on the hot path; shared-prefix backtracking that re-parses the same prefix per alternative. Prefer left-factoring / first-set guards. |
| R6 | **compose-integrity / stale-build degrade** | 7 | A grammar/macro change that silently falls back to the runtime interpreter (or references a missing rule), visible only in the build log, and masked by a stale `lib/`. |

When a new perf regression is found and fixed, **add a row here** and, if it is
mechanically detectable, wire a gate — then this catalogue and the gate set stay
1:1 with lived incidents.

---

## How to use this doc

- **Writing hot-path code:** load the `perf-architecture` skill; it packages the
  7 invariants as pre-write checks and links back here.
- **Reviewing a diff/design:** dispatch the `perf-architecture-reviewer` agent;
  it must output evidence per invariant and per catalogue row — never a bare
  verdict.
- **Extending the gate set:** add the invariant here first, then the gate script
  under `scripts/verify-*.mjs`, then wire it into `pr-quality-gate.yml`.
