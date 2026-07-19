# R2 — Native value evaluation (retire the record/replay scaffold)

> DESIGN/SPEC ONLY. This section specifies the R2 rung of the tree2
> definitive rewrite: a real **synchronous** value evaluator over **typed value
> nodes**, replacing the current
> `tree2-frontend/value-service.ts` async-record → sync-replay scaffold that
> re-enters the legacy fns-registered render. It matches the depth/style of
> [`TREE2-DESIGN-SPEC.md` § R0](../TREE2-DESIGN-SPEC.md#r0--collapsenestingfalse-nested-output-mode-the-less-v5-default)
> — **data model · algorithm · invariants · reference · both-emit-mode
> interaction · deferred sub-cases · owner-confirm items**.
>
> Branch of record: `experiment/tree2-cleanroom-20260715`. Roadmap row:
> [`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md` § R2](../TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md).
> This spec was authored on a doc-only spec branch (no build); the "must
> change" call-outs are against the code as it stands on the branch of record.

**Status:** NOT built. Spec only. R2 depends on R0 (built) and is orthogonal to
R1 (extend); guards (`evaluateGuardCondition`) already ride the same seam and
convert in the same move.

---

## 1. Problem / why R2

### 1.1 What the current scaffold does

`tree2/serialize.ts` owns value STRUCTURE (`Operation` / `FunctionCall` / `Paren`
/ `Concat` / `SpacedValue` / `Dimension` / `Word` / `VarRef`) and the byte
emission of operands, and delegates MATH to an injected `ValueService`
interface (`tree2/value-service.ts`), whose three methods take/return
**already-serialized value bytes**:

```ts
evaluateOperation(operator: string, left: string, right: string): string
callFunction(name: string, argsSource: string): string
evaluateGuardCondition(source: string): boolean          // [guards]
```

The real implementation (`tree2-frontend/value-service.ts`) computes those bytes
by a **two-phase async-record → sync-replay** dance:

1. `buildValueService(root)` runs a synchronous `serialize(root, { valueService:
   recordingService, guardMode: 'record' })` pass whose only job is to *collect*
   every variable-resolved expression source string tree2 will ask about
   (`(left op right)` keys, `name(args)` keys, guard-leaf sources).
2. Each collected key is computed ONCE, **asynchronously**, by wrapping it as
   `_x{_v:<expr>;}` (or, for a guard, a probe mixin `.__g() when (<cond>){…}`),
   parsing it with `parseLessFn`, registering the `@jesscss/fns` registry onto
   the parsed root, and rendering it through the **legacy** `renderNodeToString`
   pipeline — then extracting the computed bytes with a regex (`/_v:\s*(…);/`).
3. `mapValueService(cache)` returns a synchronous `ValueService` the timed
   serialize replays from the cache by the same key.

### 1.2 Why it must be replaced (the roadmap's Risk #2)

Byte-identical **by construction** (same parser, same eval, same serializer) —
but architecturally CIRCULAR and a benchmark-tuned scaffold:

- It **re-enters the very engine tree2 replaces**: value math routes back
  through `../tree`'s `Operation.eval` / `Dimension.operate` / `Call.evalCall`
  and the legacy render buffer. tree2 is the successor representation; a value
  path that calls the predecessor cannot survive the front-end flip, and
  **cannot survive to the tree-shaken JS-module endgame** (roadmap §1(c) F,
  §Cross-cutting) where there is no legacy render to re-enter.
- It **reparses expression source per key** (`parseLessFn` + a whole
  `Context` + `registerLessFunctions` per distinct expression), and needs a
  **whole synchronous record pre-pass** before the timed pass just to enumerate
  keys. The `MAX_RECORD_DEPTH=64` / `MAX_VAR_DEPTH` caps exist ONLY to bound
  that pre-pass (roadmap "shortcuts to unwind" #5).
- It **loses types**: every operand and every arg is flattened to bytes at the
  seam. Pattern-match-by-typed-value, `calc` simplification, escaping, and
  guard type-functions (`iscolor`, `isnumber`, …) can't be done on bytes; they
  currently work only because the legacy engine re-parses the bytes back into
  typed nodes on the other side of the seam.
- It **hides real value-eval cost** behind an "equal-cost both sides" race
  framing (both sides pay the legacy render), so the value lane's true cost was
  never on the tree2 books.

### 1.3 Perf framing (do NOT over-invest)

The arena diagnosis (roadmap §1(b), `AST-ARENA-EXPERIMENT-HANDOFF.md`) corrected
the old fixation: **hot allocation is SELECTORS (~86% of eval-new allocation),
values are only ~2% of the gap.** R2 is therefore a **cleanliness / endgame /
correctness-unblock lever, NOT the decisive perf lever.** Consequence for the
design: prefer the *architecturally clean* choice (real typed evaluator, lazy
leaves) over a micro-tuned one; do NOT add value-side caches/interning on
perf-speculation (predict-before-building, memory `feedback-predict-perf-before-building`).
The value-literal type tag (perf #2) lands here as a *memory/cleanliness* win,
justified only if perf-neutral (memory `feedback-memory-savings-count`).

---

## 2. Data model — typed value nodes + the lazy value-literal leaf

R2 introduces a real **runtime value domain** distinct from the value **AST**
tree2 already has. Keep the distinction sharp:

- **Value AST (already exists, mostly unchanged):** `Word`, `Dimension`,
  `VarRef`, `Concat`, `SpacedValue`, `Operation`, `FunctionCall`, `Paren` —
  the *authored/parsed* structure carried on `Declaration.value` etc. These
  describe *how to compute*, and (for the common static case) carry verbatim
  source bytes.
- **Value domain (NEW):** the typed *results* an evaluation produces and
  operates on — `Color`, `Numeric` (number+unit), `Quoted`, `Keyword`, `List`,
  `Bool`, `Nil`. These are what arithmetic, comparison, guards, function args,
  and (eventually) interpolation consume.

### 2.1 The lazy value-literal leaf (VALUE-LITERAL-TAG, perf #2)

The load-bearing encoding decision. A value leaf is stored as a **`(bytes, tag)`
pair** — the authored/canonical byte string plus a small tag enum — and stays a
**string-shaped leaf** until something *forces* object behavior:

```
ValueLiteral = { bytes: string, tag: VTag }
VTag = Keyword | Numeric | Color | Quoted | Unknown
```

- **Emit (the common path)** reads `bytes` directly — NO object is
  materialized. This is exactly what tree2 does today for `Word` (verbatim
  bytes) and what keeps static declarations allocation-free.
- **Materialization is lazy and on-demand.** Only an `Operation`, a comparison,
  a guard leaf, a typed function param, or an interpolation that needs a real
  `Numeric`/`Color`/`Quoted`/`List` triggers `materialize(leaf) -> ValueObj`.
  The parse `bytes -> ValueObj` happens once per *forcing* site, not per emit.
- `tag` lets the forcing site skip the classification regex in the hot cases
  (a `Numeric`-tagged leaf goes straight to number parse; a `Keyword`-tagged
  leaf is known non-operable without a probe).

This replaces the current eager split (a static number is a `Word('1.0px')`
carried verbatim; an operable number is a `Dimension(number, unit)` that
canonicalizes). Under R2 both are one `ValueLiteral`; canonicalization happens
**only on materialization**, which is where Less canonicalizes anyway.

### 2.2 The typed value objects (the `materialize` targets)

Sourced from `@jesscss/fns`'s param types (the impl source of truth: fns are
written against `Color`, `Dimension`, `Quoted`, `List`, `Bool`, `Nil`, `Any`
from `@jesscss/core`). tree2's clean-room equivalents:

| tree2 value obj | fields | Less/fns analogue | notes |
|---|---|---|---|
| `Numeric` | `number: number`, `unit: string` | `Dimension` / `Num` | canonical number (`round(n,8)`); unit-aware `operate` |
| `Color` | rgb + `alpha`, lazy `_hsl`/`_hsv`, `format` | `Color` | fns read `_hsl`/`_alpha`/`options.format`; output format preserved through ops |
| `Quoted` | `value: string`, `quote: '"'|"'"|''`, `escaped: bool` | `Quoted` | `~"..."` escaping, string interp (R4 wires interp; R2 provides the type) |
| `Keyword` | `text: string` | `Any<'keyword'>` | non-operable identifier (`red` before color-ification, `solid`) |
| `List` | `items: ValueObj[]`, `sep: ',' | ' ' | '/'` | `List` | preserved-slash lists, comma args, `extract`/`length` |
| `Bool` | `value: boolean` | `Bool` | guard results, `if()`/logical fns |
| `Nil` | — | `Nil` | empty/absent value; `valueOf() === ''` |

These are **boundary-clean tree2 types** (no `../tree` import). §5 specifies how
they bind to `@jesscss/fns`, whose functions still speak the *legacy* node
shapes — the one genuine boundary problem R2 must solve.

### 2.3 Modes carried into evaluation

Value evaluation is **not** context-free; it honors three configured modes
(read today off the legacy `Context`; roadmap §1(a) "Math modes" NEEDS-DESIGN):

- **`mathMode`** (`always | parens-division | parens` — default
  `parens-division`): governs whether a given `Operation` actually operates or
  is preserved as source (`shouldOperate`). NOTE (memory
  `less-math-mode-is-parse-time`): math mode is *also* a parse-time input — the
  Less parser already decides how `/` tokenizes; R2 must honor the **eval-time**
  half (`shouldOperate`) and must NOT re-derive the parse-time half.
- **`unitMode`** (`preserve | canonicalize | …`, default `preserve`): governs
  unit-incompatible arithmetic — in `preserve` mode a unit clash falls back to a
  `calc(...)` wrapper rather than throwing (mirrors legacy `Operation`
  `createCalcFallback`).
- **`functionMode`** (`preserve | …`, default `preserve`): governs whether an
  unknown function call is evaluated or emitted verbatim.

The evaluator receives a small **`EvalModes`** context object at the seam
(sync, injected — the only allowed boundary crossing, like the current
`ValueService`), NOT the whole legacy `Context`.

---

## 3. Algorithm — the synchronous evaluator

### 3.1 Seam shape (replaces `ValueService`)

`ValueService`'s three **bytes-in/bytes-out** methods are replaced by a
**typed, synchronous** evaluator interface, still injected into `serialize`
(the seam stays; its currency changes from bytes to typed value objects):

```ts
interface ValueEvaluator {
  // operands already materialized by tree2; result is a ValueObj (or preserved Operation source)
  operate(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj
  // args already materialized into a List; result is a ValueObj
  call(name: string, args: List, modes: EvalModes): MaybePromise<ValueObj>
  // guard leaf on typed operands -> boolean
  guard(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): boolean
  // classify/parse a value-literal leaf on demand (may be provided by tree2 itself)
  materialize(leaf: ValueLiteral): ValueObj
}
```

Two admissible implementations (owner-confirm, §8):

- **(A) tree2-native evaluator.** Port the arithmetic/color/compare logic into
  `tree2/value-eval.ts` (boundary-clean); bind ONLY the ~120 named built-ins to
  `@jesscss/fns` through a thin adapter (§5). Cleanest for the endgame; most
  work.
- **(B) boundary-clean sync fns binding.** Keep `@jesscss/fns` as the math
  source of truth for BOTH operations and functions, invoked **synchronously**
  on already-typed operands (no reparse, no legacy render, no record pre-pass).
  Requires the value objects to be shared/adapted across the boundary (§5).
  Less duplication; hinges on the fns-extraction question.

Either way the **circular re-entry and the record/replay pre-pass are deleted.**

### 3.2 Operand flow (bottom-up, sync)

`valueText` (today: `serialize.ts` lines 168–224) is replaced by a
**`valueEval(node, frame, ev, modes) -> ValueObj`** that folds bottom-up, then a
final `emitValue(obj) -> bytes` at the write site:

- `Word` / static number / color literal → a `ValueLiteral{ bytes, tag }` leaf;
  `emitValue` returns `bytes` verbatim (unchanged from today's fast path — this
  is the ~98% common case, still allocation-light).
- `VarRef` → `lookupVar(frame, name)`; recurse on the bound value AST **in the
  binding's frame** (lexical, arch A4) — same scope model as today, cycle-guard
  preserved.
- `Concat` / `SpacedValue` → structural; recurse into parts, join with `''` /
  `' '`. Parts that never force stay as concatenated bytes (no materialize).
- `Paren` → transparent to computed bytes; forces its inner (a paren wraps an
  operation, whose evaluation strips the paren — matching legacy). With no
  operation inside and no forcing, keep the parens for faithful source
  (today's `service ? inner : '(' + inner + ')'` behavior generalizes to
  "materialized ⇒ stripped, literal ⇒ kept").
- `Operation` → **materialize both operands**, then `ev.operate(op, l, r,
  modes)`. `shouldOperate(modes, op, l, r)` decides operate-vs-preserve:
  - preserve ⇒ emit `left <sp> op <sp> right` from the operands' emitted bytes
    (today's null-service branch);
  - operate, unit-clash, `unitMode==='preserve'` ⇒ `calc(...)` fallback
    (mirror `Operation.createCalcFallback` + `unwrapCalcOperand` flattening);
  - operate on `Color`×`Numeric`, `Numeric`×`Numeric`, etc. ⇒ typed result.
  Precedence is carried by the **tree shape** (nested `Operation`s fold inner
  first) — NOT by re-serializing to a source string and handing the whole thing
  to one seam call (today's deliberate "outermost-only calls the service"
  trick, which exists purely to make the record/replay key stable, is
  **deleted**).
- `FunctionCall` → materialize `args` into a `List` (respecting `,`/space/`/`
  separators — today the whole arg source is one opaque string; R2 must model
  the arg list so typed params bind), then `ev.call(name, list, modes)`.

### 3.3 Sync-by-default, async only on a genuine thenable (arch C1)

`serialize` stays **synchronous**. Almost every built-in (all color/number math:
`lighten`, `darken`, `round`, `mix`, `rgba`, `percentage`, … — verified
synchronous in `@jesscss/fns`) runs sync. Only genuinely async fns
(`data-uri`, `image-size`/`image-width`/`image-height`, `svg-gradient` file IO)
return a thenable. Design:

- `ev.call` returns `MaybePromise<ValueObj>` (the `@jesscss/awaitable-pipe`
  pattern already in the codebase). `serialize` remains sync for the sync case
  and only lifts to async when a call actually returns a thenable — the
  `isThenable` fork, not a blanket async pass.
- **No whole record pre-pass, no `MAX_RECORD_DEPTH`.** The two-phase scaffold
  and its depth caps are removed. (Recursion/cycle termination stays via the
  existing `MAX_VAR_DEPTH` var-ref cycle guard, which is a *real* invariant, not
  a pre-pass artifact.)
- The rare async fns force the enclosing declaration's emit onto the async
  branch — the same shape as the legacy `Operation.render` `isThenable` fork,
  but scoped to the one declaration, not a global pre-pass.

### 3.4 Guards fold in the same move

`evaluateGuardCondition(source: string): boolean` (bytes) → `ev.guard(op, l, r,
modes): boolean` (typed). `guard.ts`'s `evalGuard` already owns the
`and`/`or`/`not`/`default()` structure and only delegates the **leaf** truth;
R2 changes the leaf from "parse a probe mixin and render it" to "compare two
materialized `ValueObj`s / call a type-fn (`iscolor`, `isnumber`, …) on a typed
value." The `guardMode: 'record'` walk (which exists only to enumerate guard
keys for the pre-pass) is **deleted**; guards evaluate inline during dispatch.

---

## 4. Both-emit-mode interaction (R0 flattened + nested)

Value evaluation is **emit-mode-agnostic** — it is the *value* lane, orthogonal
to the *selector/structure* lane R0 forked. Concretely:

- Both `emitLeaf` (flattened path) and `emitNestedLeaf` (nested path) call the
  **same** `valueEval` + `emitValue` for a `Declaration.value` and an at-rule
  prelude. R2 adds NO second value path; it replaces the one shared value
  routine (`valueText`) both emit modes already funnel through
  (`serialize.ts` lines 476, 523, 649, 753 — every `put(e, valueText(...))`
  site).
- The `collapseNesting` flag never reaches the value evaluator. A value's bytes
  are identical in flattened and nested output (a declaration's RHS does not
  depend on whether its selector was composed or kept local). This is why R2 can
  be specified independently of R0/R1 and validated in **both** modes with the
  same fixtures.
- Interaction with R1 (extend) is one-directional: extend's EMIT projects
  through the R0 collapse policy (selectors), and reads **already-evaluated
  declaration bytes** — it does not re-enter value eval. The one true coupling
  is **selector interpolation** `@{var}` (R1 dependency, roadmap "shortcuts" #4):
  that is a *selector*-side use of the value lane (resolve a var to bytes early,
  at ruleset-enter). R2 provides the materialize/emit primitive; R1/R4 own the
  interpolation *sites*. R2 does not itself build `@{}` resolution.

---

## 5. The boundary problem — binding `@jesscss/fns` clean

The one hard constraint. `@jesscss/fns` (v2.0.0-alpha.5) is the **impl source of
truth** for the ~120 built-ins, and every one of its 66 Less function modules
imports typed value nodes **from `@jesscss/core`'s legacy tree**
(`import { Color, Dimension, Quoted, … } from '@jesscss/core'`) and is invoked
today through the async `callWithContext` record machinery in
`define-function.ts`. tree2 may NOT import `../tree`. Options:

- **B1 — adapter in `tree2-frontend/` (no core change).** tree2 evaluates to its
  own `ValueObj`s; a `tree2-frontend/value-eval.ts` adapter converts
  `ValueObj -> legacy Color/Dimension/…`, invokes the **raw synchronous function
  body** (bypassing the async `callWithContext` arg-record layer — args are
  already typed), and converts the legacy result back to a `ValueObj`. This is
  boundary-legal (the adapter lives *outside* `tree2/`, like today's
  value-service), synchronous for sync fns, and **kills the reparse + legacy
  render** while keeping fns as-is. Risk: the adapter must reproduce
  `callWithContext`'s param-matching/overload/`convert` semantics without its
  async record — a real but bounded port.
- **B2 — extract fns' value nodes to a boundary-neutral package.** Move the
  typed value nodes (`Color`/`Dimension`/`Quoted`/`List`/`Bool`/`Nil`/`Any`) out
  of `@jesscss/core`'s `tree/` into a shared leaf package both `@jesscss/fns` and
  `tree2/` can import. Then tree2's `ValueObj` *is* the fns param type — no
  adapter, no conversion. Cleanest for the endgame; largest blast radius (a
  `jess-fns-extract` worktree exists — check its state before choosing). This is
  the **A** implementation of §3.1 taken to its conclusion.
- **B3 — reimplement math natively, bind only named fns.** `tree2/value-eval.ts`
  owns arithmetic/color/compare (the operator lane); only the named-function
  lane binds to fns via B1/B2. Splits the work: operators (small, hot, worth
  owning) native; the 120-fn long tail delegated. Matches roadmap §R2 "tree2-
  native, OR a boundary-clean sync fns binding."

**Recommendation to flag:** B3 for operators + B1 for functions as the *first*
buildable step (deletes the scaffold with the least blast radius), with B2 as
the endgame target (JS-module output wants the shared leaf types anyway).
Owner decides operator-native-vs-delegated and the fns-extraction timing (§8).

`less.functions` compat (roadmap §1(a), memory `less-v5-functions-tree-compat`)
plugs the **same** seam: custom 4.x functions resolve against live bindings via
their own Call-eval and register into the `ValueEvaluator.call` name table —
R2's typed seam is where R6's less-compat function bridge lands, so design the
name table to accept externally-registered callables from the start.

---

## 6. Invariants

1. **No circular re-entry.** No R2 value path calls `../tree`'s eval/render or
   `parseLessFn`. Value math is computed by the evaluator (native and/or a
   sync fns binding), never by re-rendering through the engine tree2 replaces.
   (Deletes the roadmap Risk #2 circularity.)
2. **Sync by default (arch C1).** `serialize` stays synchronous for all-sync
   value graphs; it lifts to async ONLY on a genuine thenable from an async fn,
   scoped to the forcing declaration. No global record pre-pass; no
   `MAX_RECORD_DEPTH`.
3. **Lazy leaves.** A value leaf that is only emitted (never operated/compared/
   guarded/interpolated) is NEVER materialized into a value object; `emitValue`
   returns its verbatim `bytes`. Materialization is on-demand and idempotent.
4. **Types survive to the operator/function.** Operands reach `operate`/`call`/
   `guard` as typed `ValueObj`s, not bytes. Pattern-match-by-typed-value,
   type-fns, and (later) calc/escaping become possible because types are no
   longer flattened at the seam.
5. **Byte-identity preserved.** The migration is byte-identical vs the current
   scaffold on the supported corpus — the scaffold is byte-identical to the
   real reference *by construction*, so R2 must remain byte-identical to the real
   reference. Add a value-lane ratchet (see §7).
6. **Modes honored.** `shouldOperate`/unit-clash-`calc`-fallback/function-mode
   decisions match the configured `mathMode`/`unitMode`/`functionMode`; the
   evaluator reads them from an injected `EvalModes`, not the legacy `Context`.
7. **Zero structural copy preserved.** R2 touches only the value lane; mixin
   placement stays canonical-body + overlay with `clone`/`inherit`/
   `withComponents` op-counts **structurally ZERO** (do not regress the R0/rung-5
   thesis).
8. **Boundary held.** No `tree2/` file imports `../tree`; the fns binding lives
   in `tree2-frontend/` (or a shared leaf package); no `as any`
   (memory `feedback_no_as_any`).

---

## 7. Reference

Per the governing reference policy (roadmap §Reference policy, memory
`no-sacred-test-expectations`):

- **Intended Jess v5 value/function output** is the reference. For less-function
  *behavior*, the shape reference is the **less.js `alpha` branch**
  (`~/git/worktrees/less.js/graduate-v5` and siblings; verified branch =
  `alpha`, version `5.0.0-alpha.2` — **NOT** Less 4.x). Confirm against the
  owner-maintained top-level `.css` expected outputs.
- **`@jesscss/fns` is the impl source of truth** for the ~120 built-ins (color
  models, rounding, unit conversion). Where fns and less.js alpha agree, that's
  the target; where they diverge, flag for owner (do not assume).
- The current scaffold's "legacy render == reference" is a **valid proxy** for the
  plain value/function surface (roadmap §4 lists value/functions among the
  byte-identical-already surfaces) — so R2 can gate byte-identity against the
  existing scaffold output on the supported corpus, THEN re-anchor the
  divergence-prone cases (calc simplification, escaping, unit-clash) to alpha +
  expected `.css` rather than to the scaffold.
- **Ratchet:** add a value-lane byte-identity ratchet over the fns/operation
  fixtures in both emit modes (§4), plus retain the `composeStats` clone/inherit-
  ZERO op-count ratchet (invariant 7). Guard truth ratcheted via the mixin-
  dispatch fixtures (guards fold into R2, §3.4).

### Sourced facts (not assumed)

- **Numbers canonicalize on materialization.** Legacy `Dimension.serializeSyntax`
  emits `round(number, 8)` — so an operated `1.0` renders `1`, `NaN` renders
  `NaN`, non-finite renders `infinity`/`-infinity` (verified
  `tree/dimension.ts` lines 316–326). tree2's current `Dimension` node
  canonicalizes the same way (`${node.value}${node.unit}`), but the current
  bridge keeps STATIC numbers as verbatim `Word` bytes (`parseValue` returns
  `word(text)` for `@`-free text — `bridge.ts` line 215), so `1.0px` written
  directly survives verbatim today. R2's lazy leaf preserves exactly this split:
  verbatim until forced, canonical once materialized. (This IS owner-confirm
  item §8.1.)
- **fns are mostly synchronous.** `lighten` and the color/number fns have no
  `async`/`await` (verified); only file-IO fns are async — justifying sync-by-
  default (invariant 2).
- **Unit-clash ⇒ `calc()` in preserve mode.** Legacy `Operation` returns a
  `calc(l op r)` fallback on a `TypeError` from `Dimension.operate` when
  `unitMode==='preserve'`, and flattens nested calc (`unwrapCalcOperand`) —
  R2's `operate` must reproduce this (verified `tree/operation.ts`).

---

## 8. Open owner-confirm items

1. **`1.0` → `1`: verbatim-vs-canonical byte call.** When does a source number
   canonicalize? Two sub-questions the lazy-leaf design exposes:
   - A number that **never participates in math** — does `.a{x:1.0px}` emit
     `1.0px` (verbatim, today's behavior via `Word`) or `1px` (canonical)? The
     lazy leaf keeps verbatim by default; confirm that is intended v5, or whether
     v5 canonicalizes all numeric leaves eagerly (matching less.js alpha —
     **source it, do not assume**).
   - A number that **does** participate (`1.0px + 2px`) canonicalizes to `3px`
     unavoidably (arithmetic produces a `Numeric`). Confirm the asymmetry
     (verbatim-when-static, canonical-when-operated) is acceptable, or whether v5
     wants uniform canonicalization.
2. **Value-literal packing: N=1 vs N≥2.** Should a *single* value leaf be packed
   as `(bytes, tag)` (cheap, uniform) or stay a bare string until a second leaf
   forces a container (avoid the tag allocation for the overwhelmingly common
   one-token declaration)? Decide the encoding threshold — a memory/cleanliness
   call (perf #2), justified only if perf-neutral. Measure on a real fixture
   before committing (memory `feedback-predict-perf-before-building`).
3. **Operator lane: native vs delegated (§3.1 A/B/B3).** Own arithmetic/color/
   compare in `tree2/value-eval.ts`, or delegate ALL of it to a sync fns binding?
   Recommendation flagged: B3 (native operators + delegated named fns) as first
   step.
4. **fns-extraction timing (§5 B2).** Extract the typed value nodes to a
   boundary-neutral package now (clean, large blast radius; a `jess-fns-extract`
   worktree exists) or adapter-bridge in `tree2-frontend/` first (B1) and extract
   later? Endgame wants the shared leaf types.
5. **calc / escaping / detached-ruleset value type** are explicitly **deferred**
   (§9) — confirm they stay out of R2 scope.

---

## 9. Deferred sub-cases (explicitly NOT in R2)

- **Interpolation `@{}` / `$(...)`** — R2 provides materialize/emit primitives;
  the interpolation *sites* (selector-early-resolution for extend, value/property
  interpolation) are R1-dependency + R4. R2 does not build `@{}` resolution.
- **Escaping `~"..."`, `e()`, `%()` string interp** — needs the `Quoted` type
  (R2 provides it) but the escaping *emit* rules are R4.
- **Detached rulesets as a value** — tree2's value union has no ruleset value;
  R4. R2's `ValueObj` union is scalar/list/color only.
- **`calc()` simplification (v5)** — isolated deferred rung; R2 only reproduces
  the *fallback* `calc(...)` wrapper for unit-clash, not v5 calc simplification.
- **Live-binding reassignment (`:=`/`!global`/`$while` counters)** — R3;
  R2 keeps the immutable per-frame var-Map read model (materialize reads
  bindings; it does not mutate cells).
- **Namespaces / maps `#ns.mixin()` / `#map[key]`** — R4.

---

## 10. Where current tree2 MUST change + files the R2 build touches

**Must change (call-outs against the branch of record):**

- `tree2/value-service.ts` — the bytes-in/bytes-out `ValueService` interface is
  **replaced** by the typed `ValueEvaluator` + `ValueObj`/`ValueLiteral`/
  `EvalModes` (§3.1). (Rename to `value-eval.ts` / keep a thin seam file.)
- `tree2-frontend/value-service.ts` — the entire async-record → sync-replay
  implementation (`buildValueService`, `recordingService`, `mapValueService`,
  `computeExpression`, `computeGuard`, the `parseLessFn`/`renderNodeToString`
  re-entry, the `VALUE_RE`/`operationKey`/`callKey` scaffolding) is **deleted**
  and replaced by the sync fns binding / adapter (§5).
- `tree2/serialize.ts` — `valueText` (lines 168–224) becomes `valueEval` +
  `emitValue`; the "outermost-only calls the service, operands to null-service
  source" trick (lines 204–222) is deleted in favor of bottom-up typed folding;
  the `Paren` transparent-strip rule generalizes; `guardMode: 'record'` and its
  walk are deleted; `MAX_RECORD_DEPTH` removed, `MAX_VAR_DEPTH` cycle guard
  retained.
- `tree2/nodes.ts` — add the value-domain types (`Numeric`/`Color`/`Quoted`/
  `Keyword`/`List`/`Bool`/`Nil`) and the `ValueLiteral` leaf; the value **AST**
  nodes (`Operation`/`FunctionCall`/`Paren`/`Concat`/`SpacedValue`) stay, but
  gain a `materialize` contract. The eager `Dimension`-vs-`Word` split at the
  bridge is unified into the lazy leaf.
- `tree2/guard.ts` — leaf truth (`evalGuard`) rewired from byte-source probe to
  typed `ev.guard`; the `default()` / and/or/not structure is unchanged.
- `tree2/mixin-dispatch.ts` — pattern-match params can compare **typed** values
  (roadmap: "unblocks pattern-match by typed value"); byte-equality path
  generalizes to typed equality.
- `tree2-frontend/bridge.ts` — `parseValue` (line 214) stops eagerly splitting
  into `Word`/`Dimension`; emits lazy `ValueLiteral` leaves + typed AST for
  operations/calls (the arg-list modeling for `FunctionCall.args`, §3.2, so
  typed params bind).

**Files the R2 BUILD will touch (summary):**

- `packages/core/src/tree2/value-service.ts` → `value-eval.ts` (seam replacement)
- `packages/core/src/tree2/serialize.ts` (value lane: `valueEval`/`emitValue`)
- `packages/core/src/tree2/nodes.ts` (value-domain types + lazy leaf)
- `packages/core/src/tree2/guard.ts` (typed guard leaves)
- `packages/core/src/tree2/mixin-dispatch.ts` (typed pattern-match)
- `packages/core/src/tree2-frontend/value-service.ts` (delete scaffold) →
  `tree2-frontend/value-eval.ts` (sync fns adapter/binding, §5)
- `packages/core/src/tree2-frontend/bridge.ts` (`parseValue` → lazy leaf + typed AST)
- `packages/core/src/tree2-frontend/__tests__/` (new value-lane byte-identity +
  op-count ratchets, both emit modes)
- `@jesscss/fns` — **no change under B1/B3**; **extracted value-node package**
  under B2 (owner-gated, §8.4)
- `packages/core/src/define-function.ts` — read-only reference for B1 (the
  adapter must reproduce its param-matching/overload/`convert` semantics
  synchronously); modified only if a shared sync entry point is added
