# Tree2-Emitting Less Parser — Feasibility, POC, Perf, and Plan

> **Historical POC — superseded.** This records a bridge/tree2 experiment, not
> the public parser architecture. Do not revive its bridge, host, or separate
> parser route. The approved direction is direct dialect `parse() ->
> Stylesheet` construction with no CST-to-AST conversion.

Status: POC landed on `experiment/tree2-emitting-grammar-poc-20260716` (off
`experiment/tree2-cleanroom-20260715`). This is a design + proof-of-concept, not
a production parser. The legacy `less-parser` is **untouched**; the bridge is
**not** deleted.

## 0. Problem

Today tree2 gets its input via a **double build**:

```
source ──parseLessFn──▶ legacy tree/ AST ──bridgeToTree2──▶ tree2 nodes
         (build tree #1)                   (walk #1, build tree #2)
```

`packages/core/src/tree2-frontend/bridge.ts` (~1030 LOC) walks the fully-built
legacy `Rules` AST and rebuilds it as tree2. Two trees are allocated and one
extra structural walk runs on every parse — cost jess never pays once the legacy
engine is deleted.

Owner decision (2026-07-16): build a **parallel tree2-native Less parser** rather
than a shared node-factory feeding both trees. Rationale: when the legacy engine
is deleted, the tree2 parser is renamed to *the* Less parser — a delete-and-rename,
with no shared abstraction to disentangle. The transition cost (two grammars
briefly) is cheap because Less is stable and both share the parseman combinator
library.

Target end state:

```
source ──(tree2 parser)──▶ tree2 nodes        (build ONE tree, no bridge)
```

## 1. How the current parser is structured (verified against code)

The functional Less parser has a clean **rule-structure / construction split**,
which is the crux of the whole feasibility story:

- `packages/less-parser/src/grammar.ts` — the macro-compiled functional grammar.
  `lessGrammar = compose([cssGrammar, <Less delta>])`. **69** `node(type, …)`
  structural rules in the Less delta + **40** in `css-parser/src/grammar.ts`.
  A `node('Declaration', <parser>)` rule names a *type* and a child parser; it
  contains **no** `new LegacyNode` — construction is deferred.
- `packages/*/src/builders.ts` — the `buildNode(type, span, children, …)`
  dispatch. This is where every legacy node is actually constructed: a
  `switch (type)` (**50** cases in less, **26** in css, **61** distinct types)
  routing to `_buildXxx` helpers. Those helpers hold the **178** (less) + **59**
  (css) `new X(...)` construction sites.
- `packages/css-parser/src/functional-driver.ts` — `runFunctionalParse(input,
  entry, host, opts)` calls parseman's `run(entry, input, { build, trivia })`.
  The `build` callback is `(type, children, fields, span, rawChildren,
  triviaLog) => host.build(...)`. **This `build` callback IS an injected node
  factory.** The grammar's structural rules already route 100% of node
  construction through it.

Consequence: **the grammar is already node-agnostic.** It emits
`(type, children, fields, span)` tuples; the *only* thing that hardwires the
legacy tree is the concrete `buildNode`. A different `build` host, driven by the
same grammar, produces a different tree with zero grammar changes.

> The class-based Chevrotain parser (`lessRecursiveParser.ts`, `lessParser.ts`,
> `productions/*.ts`) is **dead code** on the hot path — no longer exported
> (`index.ts` dropped the re-exports for tree-shaking), not imported by
> `grammar.ts`/`builders.ts` at runtime (only referenced in *comments* as the
> historical port source). Its ~9.6 KLOC of inline `new X()` are irrelevant to
> this work and should not be touched or ported.

## 2. Feasibility + reuse boundary

Because parseman cleanly separates rule structure (combinators) from node
construction (the `build` host), a parallel tree2 parser splits into three layers
with very different reuse profiles:

| Layer | Reuse | Notes |
| --- | --- | --- |
| parseman combinator lib (`~/git/oss/parser-thing`) | **100% shared** | `rules`, `node`, `sequence`, `choice`, `many`, `regex`, `run`, trivia, span/CST capture. Same package both parsers link. |
| Grammar rule *structure* (`grammar.ts` `node()`/`sequence()`/`choice()` graph) | **Reusable, copied** | ~110 structural rules across css+less. Carry **no** legacy-node dependency — pure combinator graph naming string types. The parallel parser owns a copy so legacy can be deleted wholesale. |
| Construction *actions* (`buildNode` + `_buildXxx` helpers) | **Re-authored for tree2** | The genuinely new code: a tree2 `build(type, …)` host. ~61 type cases, but most are trivial and many collapse (tree2 has a leaner node set). |

Key finding: **parseman does not entangle rules and actions.** There are two
authoring styles and both keep them separable:

- `node(type, parser)` → defers construction to the injected `build` host
  (used throughout today; gives free span/children/fields/trivia capture).
- `transform(parser, fn)` → inline action returning any value directly
  (exported from parseman; an alternative for hand-built nodes).

So the parallel parser can reuse the **exact** `node(type, …)` authoring
convention and supply a tree2 `build` host — no duplication of the construction
*machinery*, only re-authoring of the ~61 per-type actions to target tree2.

### Where it lives

`packages/core/src/tree2-frontend/` — the same front-end module the bridge lives
in. Rationale: the tree2 build host must import tree2 node constructors
(`../tree2`), exactly as the bridge does. The hard module boundary is preserved:
`tree2/` imports nothing from the front-end; the front-end may touch the parser
layer and `../tree2` but **not** the legacy `../tree`. The POC host
(`poc-tree2-host.ts`) imports only `@jesscss/css-parser/jess` (the host type) and
`../tree2` — zero legacy-tree imports.

When the parallel grammar rules are copied in (Stage 2+), they land beside the
host (e.g. `tree2-frontend/grammar/…`) or, if it outgrows core, a dedicated
`tree2-less-parser` package that deps parseman + `@jesscss/core` tree2. Either
way the final rename (delete legacy → this becomes *the* Less parser) is
mechanical.

### Sites that resist clean abstraction

The construction actions are mostly mechanical, but a minority carry **legacy
semantics** that the tree2 host must reproduce or deliberately drop. These are
the real work items, surfaced by the bridge (which already re-derives all of
them from the legacy tree):

- **Value subtree** (`_assembleLessValue`, `_buildOperation`, `_buildCall`,
  Reference/paren/quoted). tree2 captures a **static** value as opaque bytes and
  defers structured values (function calls, operations, interpolation) — the
  bridge's `toComputedValue` vs `parseValue(rawDeclValue(...))` split. The tree2
  host makes the same decision at build time from the span + children instead of
  post-hoc. This is the largest single action.
- **Selector assembly** (`_buildCompoundSelector`, `_buildComplexSelector`,
  combinator/`&` handling). Legacy resolves compounds/combinators into structural
  nodes; tree2 has its own `Compound`/`Complex`/`Simple`. Mostly a 1:1 remap; `&`
  and `@{…}` interpolation are the fiddly cases (bridge already models both).
- **Deprecation warnings** (`_warnDeprecatedValue`, `_warnCustomPropVars`,
  `_warnAtRulePreludeVars`, digit-leading-var, unquoted-selector-capture). These
  fire from `buildNode` today. The tree2 host must re-emit the ones v5 keeps
  (per `deprecation-emission-not-wired-v5`), or consciously not.
- **Detached-ruleset / raw-block fallback** (`@x: { … }` as `Mixin` or raw
  `Quoted`). Special-cased in `_buildVarDeclaration`; tree2 has `DetachedRuleset`.
- **Speculative construction.** parseman calls `build` on **backtracked**
  branches (confirmed via probe: `color: red` is built as a `CompoundSelector`/
  `PseudoSelector` before backtracking to `Declaration`). Both hosts pay this
  equally, so it's not a regression — but the tree2 host's actions must be
  **total** (never throw on a shape that will be discarded) and ideally cheap.

None of these *block* the parallel design; they are the itemized surface the
staged plan works through, and the bridge is a ready-made reference for each.

## 3. POC (landed)

Files:

- `packages/core/src/tree2-frontend/poc-tree2-host.ts` — `PocTree2Host`, a
  parseman `FunctionalParseHost` whose `build` constructs tree2 nodes directly
  for the representative shape (ruleset + static declarations). No legacy tree,
  no bridge walk. Unsupported types return an inert placeholder (they only arise
  on backtracked branches or as value children the Declaration action re-derives
  from source).
- `packages/core/src/tree2-frontend/__tests__/poc-tree2-host-byte-identity.test.ts`
  — drives the **same** `lessGrammar` through `runFunctionalParse` with the tree2
  host and asserts `serialize(direct) === serialize(viaBridge)`.
- `packages/core/src/tree2-frontend/__tests__/poc-tree2-host-perf.test.ts` —
  front-end cost comparison.

> The POC reuses `lessGrammar`'s rule structure on purpose: it isolates the
> variable under test (the tree2 **actions**) and proves byte-identity without a
> from-scratch grammar that could diverge for unrelated reasons. In the shipped
> parallel parser the rules are copied (Stage 2), and this host becomes their
> action layer.

### Byte-identity result — PASS (7/7)

`serialize(tree2-direct).css` is byte-identical to `serialize(bridge(...)).css`
for: single decl, multiple decls, trailing semicolon, id selector, compound
selector (`.a.b`), multiple rules, dimension values.

The current parser's legacy output is unchanged by construction — no
grammar/builder/`buildNode` code was modified; existing bridge byte-identity
suites (`bridge-byte-identity`, `nested-byte-identity`, 53 tests) stay green.

### Legacy-factory equivalence

Claim (a) — "legacy factory → byte-identical legacy output" — holds **by
construction**: the existing `buildNode` *is* the legacy factory and is
untouched. The POC demonstrates the factory *interface* (`FunctionalParseHost`)
is swappable: the same grammar, driven by two different hosts, yields legacy vs
tree2 with no rule changes.

## 4. Perf (measured) — WIN, grows with size

`process.hrtime`, 50 warmup iters, median of 15 reps × 200 iters, same machine,
same worktree, same grammar. Path A = `parseLessFn` (legacy tree) + `bridgeToTree2`.
Path B = `runFunctionalParse` with `PocTree2Host` (tree2 direct). Two runs:

| workload | parse-only (legacy) | A: legacy+bridge | B: tree2 direct | speedup A/B |
| --- | --- | --- | --- | --- |
| 50 rules  | 0.88 / 0.90 ms | 0.86 / 0.87 ms | **0.79 / 0.80 ms** | 1.09x / 1.09x |
| 200 rules | 3.50 / 3.61 ms | 3.84 / 3.88 ms | **3.15 / 3.23 ms** | 1.22x / 1.20x |

Findings:

- **Path B is consistently faster** and the margin **grows with input size**
  (more nodes ⇒ more bridge-walk + double-build eliminated).
- At 200 rules, tree2-direct (3.15 ms) is faster than even **parse-only with the
  legacy tree** (3.50 ms): building tree2 nodes during the parse is *leaner* than
  building legacy nodes, *and* the entire bridge walk (~0.3 ms) is deleted.
- The 50-rule bridge overhead reads slightly negative — measurement noise at that
  size; the 200-rule signal is clean and repeatable.

This is the null hypothesis confirmed: deleting a whole tree build + the bridge
walk is a front-end win, not a risk. The factory indirection (one monomorphic
host object passed once into `run`, not per-call) is free — the same `build`
closure shape parseman already uses.

## 4b. Dense-eager value structs (owner design, measured)

Owner decision (2026-07-16): the tree2 parser builds **dense value structs parsed
eagerly at parse time**, not the current R2 lazy `(bytes, tag)` late-parse leaf.

### Current (R2) model — lazy leaf

`tree2/value-eval.ts` represents a value as `ValueLiteral { lit, bytes, tag }`.
Emit reads `bytes` verbatim (no object built for the static case). On the first
operation / comparison / guard / typed-param, `materialize(leaf)` **re-parses the
bytes at eval time** into a `ValueObj` (a `Numeric { number, unit, bytes }`, etc.).
This is the lazy materialize, and it is the source of the "operate on Anonymous"
edge-bug class.

### Proposed model — dense eager

The tree2 parser is *already tokenizing* the value (the css grammar has a
`Dimension` rule that splits number + unit). So it builds the dense struct
directly, once:

```
Dimension { value: number, unit: string, rawBytes: string }
Color     { rgb, alpha, …,               rawBytes: string }
```

- `value` / `unit` — for eval (real typed struct; no re-parse, no lazy
  materialize).
- `rawBytes` — the original source slice, for **byte-faithful emit**.

Byte-identity requires verbatim emit of **un-operated** values: `1.0px` must emit
`1.0px`, not canonicalize to `1px`. jess preserves un-operated values verbatim and
canonicalizes only **operated** ones. So: emit uses `rawBytes` when un-operated,
canonical bytes (produced by the operation) when operated. This kills the lazy
materialize and its edge bugs — eval always sees a real typed struct.

### POC + measurement (landed)

`packages/core/src/tree2-frontend/__tests__/poc-dense-value.test.ts` builds the
dense struct directly from a token (mirroring the parser action), against the
real `literal()` leaf + the real `buildEvaluator().materialize`.

- **Byte-identity (PASS):** for `1.0px`, `0.50em`, `100%`, `0`, `-3px`, `.5s`,
  `2.000rem`, `10PX`, dense `rawBytes` emit === lazy leaf `bytes` emit === verbatim
  source. No canonicalization.
- **Eval-identity (PASS):** dense `{value, unit}` equals what lazy `materialize`
  parses (`number`, `unit`), so eval semantics are unchanged.
- **Perf / memory (PASS), value-heavy workload (N=200 000 numeric tokens, each
  emitted once + evaluated once), `--expose-gc`:**

  | metric | lazy (leaf + materialize) | dense (parse-once) | dense advantage |
  | --- | --- | --- | --- |
  | time  | 11.87 ms | 10.13 ms | **1.17× faster** |
  | memory | 215.9 B/val | 94.4 B/val | **2.29× less** |

The time win is the eliminated re-parse at eval. The memory win holds in the
value-heavy case where a materialized value is retained alongside its leaf (two
objects) — dense retains one struct. Honest caveat: if the current engine
materializes purely transiently (not retained), steady-state resident memory is
leaf (2 fields) vs dense struct (3 fields) — dense marginally larger — but dense
still deletes the per-eval re-parse **and** the transient materialize allocation
(GC churn). Either way: **neutral-or-better, and simpler+safer eval.** Owner's
"footprint ~unchanged" holds; measured value-heavy is a clear win.

### Retirement

The R2 lazy value leaf (`ValueLiteral` + `materialize`) **retires as part of the
parser cutover** (Stage 3): once the tree2 parser emits dense value structs,
nothing constructs a lazy leaf, and `materialize` — along with the "operate on
Anonymous" fallback path — is deleted. Until then the leaf stays (the bridge
still produces it), so the two coexist during the transition.

## 5. Staged implementation plan

Invariant every stage: legacy `less-parser` untouched, current engine green, the
bridge stays until its last shape is covered. Each stage adds tree2-host coverage
for a shape family and flips that family's byte-identity reference from bridge to
direct.

**Stage 0 — POC (done).** Ruleset + static declaration, host-over-shared-grammar,
byte-identity + perf proven.

**Stage 1 — Standalone driver.** Add a tiny tree2 parse entry that returns the
tree2 root directly (the POC reads it off the host because
`runFunctionalParse`'s result coercion only recognizes the legacy `Node`). A
`runFunctionalParseT2` that returns `res.value` verbatim, plus the errors/trivia
shaping. No legacy dependency.

**Stage 2 — Copy the grammar rule structure.** Bring the css+less `node()`
structural rule graph into the tree2 front-end (verbatim copy; it carries no
legacy-node deps). Now the parallel parser is self-contained: parseman + copied
rules + tree2 host. Legacy grammar keeps running unchanged in parallel.

**Stage 3 — Value actions (dense-eager; §4b).** Implement the tree2 host's value
construction: **dense value structs parsed eagerly** (`Dimension{value,unit,
rawBytes}`, `Color{…,rawBytes}`, …) plus the structured computed shapes tree2
already supports (rungs 1–5 + R4: refs, interp, operations, calls, quoted, url).
Emit uses `rawBytes` when un-operated, canonical when operated. Reference: the
existing `value-byte-identity` suite, flipped to the direct path. **Retire the R2
lazy value leaf** (`ValueLiteral` + `materialize` + the operate-on-Anonymous
fallback) at the end of this stage — once the direct parser is the value source,
nothing builds a lazy leaf.

**Stage 4 — Selectors, nesting, `&`.** Compound/complex/combinator/`&`/interp
selector actions. Reference: `nested-byte-identity`.

**Stage 5 — Mixins, guards, extend, at-rules, imports.** One shape family per
step, each mirroring the corresponding bridge section and its byte-identity suite
(`guard-`, `extend-`, `atrule-`, `import-byte-identity`).

**Stage 6 — Retire the bridge incrementally.** As each family's direct path goes
byte-identical, switch its call sites (`bridgeToTree2` consumers, the census, the
reference harness) to the direct parser. The bridge shrinks to the not-yet-covered
tail. When empty, delete `bridge.ts` + `import-bridge.ts`.

**Stage 7 — Delete-and-rename.** When the legacy engine is deleted, remove
`builders.ts`'s `buildNode` legacy path and rename the tree2 front-end parser to
*the* Less parser. No shared abstraction to unwind.

### How both stay green throughout

- The tree2 host is additive; nothing legacy changes, so legacy suites are
  invariant.
- Every stage's gate is a byte-identity suite that already exists for the bridge
  — reuse it, pointed at the direct path, so the direct parser is ratcheted
  against the *same* reference the bridge was.
- Keep a `direct-vs-bridge` differential test (like the POC) per shape family so a
  divergence is caught the moment a family is added, before its bridge call site
  is retired.

## 6. Honest risks / open items

- **Warning parity.** `buildNode` emits several deprecation warnings mid-build.
  The tree2 host must re-home the v5-relevant ones; easy to miss silently. Track
  against `deprecation-emission-not-wired-v5`.
- **Speculative-build cost.** Backtracked branches build nodes in both parsers.
  If profiling later shows it dominates, the mitigation is parseman-side (gate
  `build` on commit) and benefits both — out of scope here, noted.
- **Grammar-copy drift.** Once Stage 2 copies the rule structure, a fix to the
  legacy grammar must be mirrored until legacy is deleted. Less is stable, so the
  window is short; a shared rule-structure module (rules are node-agnostic) could
  eliminate even this, but the owner chose full parallelism for the clean
  endgame — flagged as a possible simplification, not a recommendation to
  override the call.
- **Result coercion.** `runFunctionalParse` hardcodes legacy `Node`/`Rules`
  wrapping; the parallel path needs its own (Stage 1), trivial.
```
