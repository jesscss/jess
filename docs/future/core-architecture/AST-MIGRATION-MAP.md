# ast/ Reorg — Downstream Migration Map (task #12)

> **Historical survey, not current architecture.** This snapshot predates the
> public direct Parseman-to-AST-v2 parser cutover. Its statements that `ast/`
> is test-only, that parsers do not import AST construction, or that a
> parse-host migration remains are preserved for archaeology only. Current
> architecture and work order are in `HANDOFF.md`.

Blast-radius survey for the `ast/` co-location reorg (`AST-REORG-EXECUTION.md`,
`AST-COLOCATION-REORG-PLAN.md`). READ-ONLY survey; no source edits.

Base: `origin/dev` @ `783342cf5` (`feat(css-parser): structure unknown at-rule prelude…`).

## TL;DR (the surprising part)

The **cross-package** blast radius is tiny, because the ast/ render pipeline is
**TEST-ONLY today** and the parsers do **not** import `ast/` at all yet — they
build **legacy `tree/`** nodes via the `@jesscss/core` barrel. So:

- **Only one non-test, non-`ast/` file imports `ast/` symbols today: `packages/core/src/value.ts`** (the fns→core value seam). Everything else that touches `ast/` lives *inside* `ast/` (the internal family graph) or is a test.
- **`@jesscss/fns` → core is insulated by a stable specifier.** All 74 fns builtin files import `@jesscss/core/value` (never `ast/…` directly). That specifier does not move; only value.ts's *internal* targets re-point (`./ast/value-*.js` → `./ast/value/*.js`). Zero fns edits required.
- **The real churn is (a) the internal family graph rewrite (Phase B) and (b) relocating `parse-host/` out of core (Phase A).** `parse-host/` is where the cross-package **cycles** live today, and dissolving it is what makes the graph acyclic.
- **The parser "importers to update" are mostly files that don't exist yet** — the reorg *adds* the `parser → @jesscss/core/ast` edge. The 16 `parse-host/actions/*.ts` construction files migrate *into* the parsers.

---

## 1. Importers of `packages/core/src/ast/**`

### 1a. External to `ast/` (the entire non-test, non-`ast/` surface)

| Importer | Symbols | From (current file) | Target file (move-map) | Note |
|---|---|---|---|---|
| `packages/core/src/value.ts` | `ValueObj, Value, Dimension, Color, Quoted, Keyword, Bool, Nil, List, EvalModes` | `ast/value-eval.ts` | `ast/value/seam.ts` | value-domain types (erased) |
| `packages/core/src/value.ts` | `makeDimension, makeColorRgb, makeColorHsl, makeQuoted, makeKeyword, makeList, numOf, textOf, colorHsl, colorHslClamped, colorRawRgb, colorRgbRounded` | `ast/value-factory.ts` | `ast/value/factory.ts` | value constructors/accessors |
| `packages/core/src/value.ts` | `HEX, RGB, HSL, serializeColor` | `ast/color.ts` | `ast/value/color.ts` | |
| `packages/core/src/value.ts` | `round` | `ast/round.ts` | `ast/value/round.ts` | |
| `packages/core/src/value.ts` | `groupOf, unify, unitFactor` | `ast/value-units.ts` | `ast/value/units.ts` | |
| `packages/core/src/value.ts` | `parseHex, sniffLiteral` | `ast/literal-tag.ts` | `ast/value/tag.ts` | |
| `packages/core/src/value.ts` | `namedColor` | `ast/color-names.ts` | `ast/value/color-names.ts` | |
| `packages/core/src/value.ts` | `Fn, FnSpec, ParamSpec, FnCtx, Kind` (types) | `ast/functions/types.ts` | `ast/value/fns/types.ts` | |
| `packages/core/src/value.ts` | `createFnRegistry, FnRegistry` | `ast/value-dispatch.ts` | `ast/value/dispatch.ts` | |

**`value.ts` is the single highest-value file to update** — 9 import lines, all
re-pointing into the new `ast/value/` family. It is also the fns contract, so it
must stay byte-stable at its *export* surface while its *import* targets move.

`packages/core/src/index.ts` (the `@jesscss/core` barrel) does **not** re-export
`ast/` at all (it re-exports `tree/`). The new leaf is a *separate* subpath (§3),
so index.ts needs **no** change for the leaf.

### 1b. Internal `ast/` family graph (Phase B movers — highest churn)

Importer counts within `ast/` (excluding tests). These are the files whose
relative import paths break when the target file moves/splits:

| Current file | Internal importers | Splits/moves to |
|---|---|---|
| `value-eval.ts` (**12 importers**) | evaluator, mixin-dispatch, serialize-value, guard, value-operate, value-dispatch, value-factory, literal-tag, color, value-guards, index, functions/types | `value/seam.ts` |
| `nodes.ts` (**8 importers**, 609L, SPLIT) | mixin-dispatch, node, guard, at-rule, index, extend/{emit,plan,ir} | split → `expr/`, `selector/`, `rule/`, `mixin/`, `at-rule/`, `extend/` `node.ts` |
| `literal-tag.ts` (4) | value.ts + 3 internal | `value/tag.ts` |
| `guard.ts` (4) | mixin-dispatch + serialize + index | `mixin/guard.ts` |
| `color.ts` (4) | value.ts + 3 internal | `value/color.ts` |
| `value-factory.ts` (3) | | `value/factory.ts` |
| `node.ts` (3) | index, extend/ir | unchanged (leaf base) |
| `at-rule.ts` (3) | | `at-rule/node.ts` |
| `serialize.ts` (**1**, 2091L, SPLIT) | index + parse-host | `engine/{scope,emit}.ts` + `expr/eval.ts` + `selector/compose.ts` + `rule/merge.ts` |
| `value-units/-dispatch/-operate/-guards`, `round`, `mixin-dispatch`, `evaluator`, `color-names`, `serialize-value`, `functions/types` | 1–2 each | see move-map §1 in exec doc |

`value-eval.ts` (→ `value/seam.ts`) and `nodes.ts` (6-way split) are the two
**highest-churn moves**: every relative importer's specifier changes, and for
`nodes.ts` importers must also learn *which* new family file each node lives in.

### 1c. The relocating subsystem: `parse-host/` (Phase A)

`parse-host/` is internal to core today but **relocates into the parsers**
(A2/A3/A4). It is the largest single chunk of movement:

- `parse-host/dispatch-host.ts` (148L), `host-context.ts` (287L), `import.ts` (631L)
- `parse-host/actions/*.ts` — **16 construction files** (at-rules, charset, comments, custom-props, extend, guard, interp, mixin-call, mixins-def, ruleset, selector, selector-interp, value-expr, value-leaf, variables, index)

Its consumers are **all tests** (`parse-host/__tests__/`, `actions/__tests__/`,
`whole-doc-driver.ts`, `oracle.ts`) plus internal `comments.ts`. No production
(jess CLI) or plugin code invokes it. Under A4 the whole directory is deleted and
its node-construction logic re-homed in css-parser/less-parser reading the leaf
`@jesscss/core/ast`.

### 1d. Parsers / plugins / jess CLI — current ast/ importers: **NONE**

- `packages/css-parser/src`, `packages/less-parser/src`, `packages/scss-parser/src`: import legacy `tree/` symbols (`Node, Rules, nil, TreeContext`, …) from the `@jesscss/core` barrel — **not** `ast/`.
- `packages/jess/src` (CLI): no `ast/` or `@jesscss/core/value` import.
- `packages/jess-plugin-*`: no `ast/nodes`/`ast/serialize` import.

The reorg **adds** the `parser → @jesscss/core/ast` edge; there are no existing
parser importers to re-point. "Importers to update" for the leaf = the 16
`parse-host/actions` files as they migrate into the parser packages.

---

## 2. The `@jesscss/core` ⇄ `@jesscss/fns` value seam

One direction only, and it does **not** move:

- **fns → core:** 74 files under `packages/fns/src` import **`@jesscss/core/value`** (never `ast/…`). Symbol frequency: `Fn` (70), `Color` (35), `Dimension` (23), `makeDimension` (21), `makeColorRgb` (10), `colorRgbRounded` (8), `Quoted` (8), `round` (6), `makeKeyword` (6), `RGB`/`HEX`/`HSL`, `ValueObj`, `Keyword`, `List`, `makeColorHsl`, `colorHsl`, `colorRawRgb`, `numOf`, `textOf`, …
- **Specifier `@jesscss/core/value` is stable** — resolves to `core/src/value.ts` via `package.json` `exports["./value"]` + `tsdown.config.ts` `entry.value`. The reorg touches only value.ts's *internal* targets (§1a). **Zero fns package edits.**
- **core → fns:** none at runtime. The five apparent `@jesscss/fns` mentions inside `ast/` (`evaluator.ts`, `color-names.ts`, `value-dispatch.ts`, `functions/types.ts`, `parse-host/actions/value-expr.ts`) are all **comments**, not imports. Good — the value seam is genuinely acyclic today.

Action for the reorg: keep value.ts's export list byte-identical; only re-point
its 9 `from './ast/…'` lines to `./ast/value/…`. Add the new `./ast` leaf entry
alongside `./value` in `package.json` exports + `tsdown.config.ts`.

---

## 3. Public leaf surface — `ast/index.ts` (internal) vs new `src/ast.ts` (leaf)

`ast/index.ts` (60L) is the **full internal surface**. The new `src/ast.ts` leaf
must expose the **node layer only** (defs + factories, zero engine/value runtime)
so parsers can construct nodes. Split:

**Must be in the leaf `src/ast.ts`** (node construction the parsers need):

- From `node.ts`: `Node, NodeType, Combinator, isNode, AST_NODE_TYPES`
- From `nodes.ts` (post-split, the per-family `node.ts`): all node interfaces + constructors — `Word/Dimension/Sequence/Operation/FunctionCall/Paren/Interp/VarRef/VarIndirect/DetachedRuleset/MapAccessor/DetachedCall` (→ `expr/node.ts`); `Simple/Compound/Complex/SelectorList` (→ `selector/node.ts`); `Declaration/VarDeclaration/Rule/Param/Stylesheet/Statement/Comment/RawInline` (→ `rule/node.ts`); `MixinDef/MixinCall/PathSeg` (→ `mixin/node.ts`); `ExtendInstruction` (→ `extend/node.ts`)
- From `at-rule.ts`: at-rule node types + constructors, `StyleImport` (→ `at-rule/node.ts`)
- Literal tagging the parser applies: `LiteralTag, materializeLiteral, tagForWord, sniffLiteral, LitFields` (from `literal-tag.ts` → `value/tag.ts`) — parser writes `LIT_*` classification as the grammar reduces.

**Must stay internal (engine/value runtime — NOT in the leaf):**

- `serialize, composeStats, SerializeOptions/Result/Return, Position` (`serialize.ts` → engine spine)
- Value evaluator/runtime: `emitValue, isLiteral, literal, DEFAULT_MODES, ValueEvaluator, buildEvaluator` (`value-eval.ts`/`evaluator.ts`)
- Value serialize/operate/dispatch: `serializeValue, serializeDimension, serializeQuoted, serializeColor, createFnRegistry, FnRegistry` (these belong to the `@jesscss/core/value` seam, not the node leaf)
- Guard/dispatch runtime: `evalGuard, guardUsesDefault, bindArgs, selectDefinitions, GuardNode, TypedResolver, ValueResolver, CallArg, Selection`

Rule of thumb: **leaf = data + factories the grammar emits; internal = anything
that walks/serializes/evaluates.** The value-domain runtime is already carved off
behind `@jesscss/core/value`; the node leaf is the second, orthogonal carve.

---

## 4. Risk / cycle section

The target graph is **strictly `parser → core`, acyclic**. Every cross-package
edge that currently points *out of* `ast/` is a cycle to eliminate. All of them
live in `parse-host/` (the subsystem that relocates), plus one erased type import:

| # | Site (within `ast/`) | Edge today | Cycle? | Disposition under reorg |
|---|---|---|---|---|
| R1 | `parse-host/dispatch-host.ts:18` | `import type { FunctionalParseHost } from '@jesscss/css-parser/jess'` | **core → css-parser** (type-only, erased, but still a declared dep cycle) | Dies in A4 — dispatch host folds into the parser's own `buildNode` dispatch; the type is native to css-parser. |
| R2 | `parse-host/dispatch-host.ts:17` | `import { run } from 'parseman'` | core → parseman (runtime) | Moves with dispatch host into the parser packages (which already depend on parseman). |
| R3 | `parse-host/import.ts:31` (+33 refs total) | `import { parseLessFn } from '@jesscss/less-parser'` | **core → less-parser** (runtime) | Relocates whole `@import` subsystem into less-parser `resolve-imports` (§0.8a); edge becomes **intra-package**. Highest-volume edge (33 refs). |
| R4 | `parse-host/…` | `import … from '@jesscss/plugin-less'` | **core → plugin-less** (runtime) | Relocates with parse-host; verify the plugin symbol is available parser-side or invert it. |
| R5 | `value-eval.ts:28` | `import type { MaybePromise } from '@jesscss/awaitable-pipe'` | core → awaitable-pipe (**type-only, erased**) | **Safe** — no runtime edge; awaitable-pipe is a leaf util. No action, but note it survives into `value/seam.ts`. |
| R6 | `parse-host/actions/*` | `../../../tree/…`, `../../../../tree/…` (legacy tree nodes: `selector-compound`, `selector-complex`, `render-buffer`, `provenance`) | intra-core, but **legacy-tree coupling** | These actions build byte-identity against legacy tree; when they relocate to parsers they must import equivalents via `@jesscss/core` barrel, or the legacy-tree portion dies with `BuilderHost` (A4). Port span/trivia semantics VERBATIM (§0.8c) — do not assume the leaf has equivalents. |
| R7 | `parse-host/actions/*:` | `import … from '…/jess-plugin-less-compat/lib/index.js'` | **core test/action → plugin-less-compat** | Confirm this is test-only wiring; if it is in a shipped action it is a hard cycle to break before A4. |

**Cycle-elimination invariant:** after A4, `git grep -E "parseman|css-parser|
less-parser|plugin-less" packages/core/src` must be **EMPTY** (exec doc A4 gate).
Today it is non-empty *only* through `parse-host/` (+ the erased awaitable-pipe
type). So dissolving `parse-host/` is *necessary and sufficient* to reach the
acyclic target — no other `ast/` file holds an outward package edge.

**Non-cycle risks (ordering hazards, from the exec doc, confirmed against the graph):**

- **`nodes.ts` 6-way split + `value-eval.ts → value/seam.ts`** are the churn peaks (8 and 12 internal importers). Do them as atomic per-family commits; a half-split `nodes.ts` leaves importers pointing at a file with a moved symbol.
- **`:extend` marker protocol** (css-parser producer + less-parser consumer via WeakMap) must land in **one commit** — straddling commits loses extend instructions mid-migration.
- **A0 (grammar structuring) is a hard prerequisite** for relocating interpolation-bearing construction (`at-rules`, `custom-props`, import `@{}`); relocating those actions before A0 carries the `@media @{q}` misparse across the package boundary.
- **value.ts must stay export-stable** while re-pointing imports — it is the fns contract; a dropped/renamed export breaks 74 fns files at once even though none import `ast/` directly.

---

## Summary of counts

- **Non-test, non-`ast/` importers of `ast/` symbols: 1 file** (`packages/core/src/value.ts`, 9 import lines).
- **fns → core value seam: 74 files**, all via the stable `@jesscss/core/value` specifier → **0 edits needed**.
- **Highest-churn internal moves:** `value-eval.ts` (12 internal importers → `value/seam.ts`), `nodes.ts` (8 importers, 6-way family split), `serialize.ts` (2091L split into engine/expr/selector/rule).
- **Relocating subsystem:** `parse-host/` = 3 top files + **16 action files** → parser packages.
- **Cycle sites: all in `parse-host/`** — `@jesscss/less-parser` (R3, 33 refs, runtime), `@jesscss/css-parser/jess` (R1, type), `parseman` (R2), `@jesscss/plugin-less` (R4), `plugin-less-compat` (R7). Plus one **erased** type edge `@jesscss/awaitable-pipe` in `value-eval.ts` (R5, safe). Dissolving `parse-host/` is necessary and sufficient for the acyclic `parser → core` target.
