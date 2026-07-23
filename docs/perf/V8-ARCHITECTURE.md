# V8 Architecture Invariants — the perf-architecture checklist

Canonical, tool-neutral checklist for anyone (human or agent) writing or
reviewing Jess hot paths: parsing, evaluation/render, and extend/selector
algorithms. The `perf-architecture` skill, `perf-architecture-reviewer`,
`AGENTS.md`, and Cursor guidance point here rather than restating the rules.

Every entry is a reviewer question that needs evidence, not a verdict:
**RULE** · *why (V8 mechanism)* · **INCIDENT** · **DETECTOR**. The enforcement
design is in
[`docs/future/llm-quality-enforcement-design.md`](../future/llm-quality-enforcement-design.md);
the active queue and cutting protocol are
[`HANDOFF.md`](../future/core-architecture/HANDOFF.md) and
[`AGGRESSIVE-CUTTING-REVIEW.md`](../future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md).

Named gates are available through `pnpm run <script>` and are exercised by
`.github/workflows/pr-quality-gate.yml`. That workflow currently reports its
result but is not yet a branch-protection required check. A gate is a backstop,
not a substitute for the up-front review; some real regressions passed all
tests and gates that existed when they landed.

---

## 1. Monomorphic node shapes (the single biggest cost)

**RULE:** every AST node of a given `type` is built with the same field set, in
the same order, through one factory. Never conditionally add or omit a field,
`delete` a field, or spread `{ ...node }` to reshape it.

*Why:* V8 assigns a hidden class per object shape; a second shape for one type
makes property access megamorphic and causes `KeyedStoreIC`/`UncheckedCast`
misses. This was about half of the observed C++ time.

**INCIDENT:** polymorphic AST node shapes across parsers/eval.

**DETECTOR:** the construction-time shape-stability harness records each
`type`'s field-key signature and fails on a second signature. ESLint also
guards known reshape forms. Any new bypass must be fixed structurally, not
waived by making the node loosely typed.

## 2. Never re-derive structure or materialize it into bytes early

**RULE:** never serialize a structured node and then parse, regex, or scan it
back into structure. Do not write `eval(...).toString()` or
`resolve(...).toTrimmedString(...)` on a hot path when the structured node can
be rendered directly.

*Why:* the parser already produced the structure. Re-derivation wastes work and
allocations, couples evaluation to serialization format, and destroys the
structure the renderer needs.

**INCIDENT:** `serialize.ts` rendered a compound selector then regex-tokenized
it back into atoms, un-memoized, per mixin match.

**DETECTOR:** the materialization-frontier gate pins eval/resolve-to-string
chains; the serialize-to-scan lint is a regression pin. Both are evidence aids,
not permission to introduce an equivalent indirect scan.

## 3. Never full-tree-walk in a hot path; lookups are occurrence reads

**RULE:** do not walk the document per render/eval to rediscover a fact the
parser or placement already knows. Use a parse-time flag or O(1) bitset
fast-reject. Binding lookup must use an occurrence read, cache once/read many,
and short-circuit an empty case before any scan.

*Why:* an O(n) document walk to answer a boolean is linear waste on every
render. Re-deriving declaration sets during a reference lookup has the same
failure shape.

**INCIDENT:** `documentHasExtend` walked the entire document every render to
discover `:extend()`.

**DETECTOR:** operation-counter budgets require an extend-free fixture to do
zero extend-discovery work. `verify:binding-lookup-hot-paths` guards the
current occurrence-helper route. When that implementation moves out of legacy
`tree/`, preserve the O(1)-shaped occurrence contract rather than the path or
helper spelling.

## 4. Complexity class is an invariant, including clean-room rewrites

**RULE:** a rewrite may change code, but it preserves the subsystem's design
principles and complexity class. Consult the tuned implementation and its
design document first; clean-room does not mean constraint-free.

*Why:* an O(n) to O(n*m) regression is a disaster byte identity cannot see.

**INCIDENT:** extend matching was rewritten with `.includes()` O(n*m)
substring comparisons and recomputed selector string keys, abandoning the
tuned structural fast-reject/bitset design.

**DETECTOR:** scaling budgets measure the core operation at N and 2N and reject
super-linear growth. A required `design/NNN.md` citation for tuned-subsystem
changes is planned; until then this remains an explicit reviewer obligation.

## 5. Allocation discipline and one canonical source tree

**RULE:** no `[...spread]`, `Array(n).fill()`, `{ ...clone }`, or fresh
`Set`/`Map` per iteration in hot reducers or the evaluation spine. Put
single-value fast paths before `filter`/`map`, reuse buffers, and do not
deep-copy a subtree merely to isolate evaluation. Prefer one canonical source
tree plus lazy per-placement state.

*Why:* allocation and GC churn appear as C++ time (`CloneObjectIC`,
`SymmetricDifference`, boilerplate) rather than obvious JavaScript self time.

**INCIDENT:** spread/slice expression folding in hot reducers, and cloned sets
in the extend transitive-closure fixpoint.

**DETECTOR:** `verify:node-copy-frontier` pins the allowed deep-copy sites and
`audit:node-creation` exposes allocation hotspots. A deterministic
allocation-count budget is planned; until it exists, reviewers must supply a
path-specific allocation argument.

## 6. Render through the canonical buffer

**RULE:** do not build a parallel output path with ad-hoc string concatenation
or a bespoke `renderNodeTo*` helper. Render in one pass through the canonical
buffer.

*Why:* parallel string assembly duplicates output state, allocations, and
source-map accounting.

**DETECTOR:** `verify:render-buffer-frontier`. The canonical implementation may
move during the AST-v2 cutover; the invariant is one render path, not a frozen
legacy `tree/` location.

## 7. Leanest path only

**RULE:** no node field, helper, wrapper, or compatibility shim unless it is
on the leanest path to the target runtime model. Transitional and undocumented
surfaces are deleted in the cutover rather than retained as no-op adapters.

*Why:* trading a deleted node for a more expensive state graph, recursive walk,
or call ladder is a net loss.

**DETECTOR:** `verify:aggressive-cutting-review`, using
`docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md`.

## 8. Dispatch once; do not re-scan a shared prefix

**RULE:** read a leading token or `@keyword` once, then switch. Do not list N
alternatives that re-scan the same prefix or copy a large choice across
contexts.

*Why:* per-arm re-scan is O(arms) on the common path. Parseman's first-match
codegen can first-character-gate disjoint arms, so prove a re-scan is real
before optimizing it.

**INCIDENT:** a 20-arm statement choice copied seven times, plus overfit split
nodes (`AtRuleBlock`/`Statement`).

**DETECTOR:** choice-size/duplicate-choice linting is a regression pin; node
schema review catches overfit node families. The Less `@` cluster is already
first-character-gated, so it is not evidence of a dispatch regression by
itself.

## 9. Grammar codegen integrity

**RULE:** every grammar rule reference must exist in the composed set. Verify
from a clean build; never accept a silent fallback to the runtime interpreter.

*Why:* an incremental build can retain a stale generated library whose grammar
resolves a rule that a fresh rebuild would find missing.

**INCIDENT:** the `DetachedRuleset` to `AnonymousMixin` rename left
`Call`/`functionCallArgs` referencing a missing `AnonymousMixin` rule; stale
SCSS output passed while a clean rebuild failed.

**DETECTOR:** `verify:compose-integrity` scans a clean serial parser build for
missing-rule and runtime-fallback output. It is also part of the PR-quality
workflow.

---

## Regression-fixture catalogue (reviewer must always catch)

These are real incidents. Every review must say, with evidence, whether its
diff reintroduces each applicable shape.

| # | Incident | Invariant | Shape to catch |
|---|----------|-----------|----------------|
| R1 | **`selectorAtoms` re-derivation** | 2 | Recomputing selector-atom arrays/sets per predicate instead of deriving decision-time scratch once. |
| R2 | **`documentHasExtend` tree-walk** | 3 | A per-eval whole-document walk to answer a boolean that needs a cached flag or O(1) bitset reject. |
| R3 | **extend `.includes()` O(n*m)** | 4 | Nested linear membership over selectors and targets where a keyed structure is linear or constant. |
| R4 | **polymorphic node shapes** | 1 | A sometimes-present field or branch-varying shape that de-optimizes a hot call site. |
| R5 | **20x7 choice fan-out** | 8 | Shared-prefix alternatives re-parsing the same prefix. Prefer factoring or first-set guards. |
| R6 | **compose-integrity / stale-build degrade** | 9 | A grammar/macro change that falls back to the runtime interpreter or references a missing rule, masked by stale generated output. |

When a new performance regression is fixed, add a row and, where possible, a
deterministic detector. The catalogue and detector set must remain grounded in
lived incidents rather than generic style preference.

---

## How to use this doc

- **Writing hot-path code:** load the `perf-architecture` skill before making
  the change.
- **Reviewing a diff or design:** use the `perf-architecture-reviewer`; it must
  report evidence per applicable invariant and catalogue row, never only
  “Approved”.
- **Extending enforcement:** add the invariant here first, then its gate or
  reviewer-only justification, then wire the implemented gate into the PR
  workflow.
