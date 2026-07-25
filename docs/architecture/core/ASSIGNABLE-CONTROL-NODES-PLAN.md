# Assignable control nodes — mixins / `each` / `$for` / `$if` as value-returning nodes

Status: DESIGN ONLY (owner-decision input). No production code changed.
Worktree: `/Users/matthew/git/worktrees/jess-trivia-cleanup`, branch `feat/selector-list-cast-distribute` (off dev).
Parseman: `/Users/matthew/git/oss/parser-thing` @ v0.23.0 (symlinked).

## The vision

Mixins, `each`, `$for`, and `$if` should all be **ASSIGNABLE** — a node that is
re-evaluated (value-returning), not just a `Rules` body. This mirrors JS arrow
functions and is the shape jess's own docs describe. Today these constructs EMIT a
`Rules` body as a side effect; the goal is that they can also PRODUCE A VALUE (which
can be assigned to a `$var`, collected, cast, etc.).

## Canonical loop contract and legacy repair

This plan's historic `For` field names and Less lowering notes below are not the
public AST-v2 loop vocabulary. Jess `$for` is the canonical source-dependent
iteration protocol: its header carries Jess bindings, and the source kind
determines the entry shape. In particular, the public bracket form
`[$key, $value]` is key/value in that order. Less `each()` is a compatibility
input lowering and does not define core fields.

The old tree implementation has a repair target: it currently fills both
comma and bracket tuple slots positionally as value, key, counter. That
reverses the documented bracket key/value order. Carry this as an explicit
compatibility/implementation test when generalizing `For`; do not reproduce it
in an AST-v2 parser or call it an unresolved public contract.

## The immediate motivating case (jess PR #88)

A comma-list VALUE interpolated into a selector position now errors
(`interpolated.ts:341` and `:369`, `ERR.commaListInterpolation`). Distribution must be
explicit. The chosen explicit shape (no new builtin) is:

```
each(apple satsuma, @($item) > *[ .fruit-$[item] ])   →   .fruit-apple, .fruit-satsuma
```

- `each` = the general map (list + lambda),
- `@($item) > <expr>` = a value-returning anonymous mixin (jess `AnonMixin`),
- `*[ … ]` = `SelectorCapture` ("this value is a selector"),
- the resulting list of captured selectors casts to a `SelectorList` in selector position.

This needs THREE things: (1) `each`/`For` gains a VALUE-COLLECTING mode; (2) a value-list
→ selector-list cast (`toSelectorList`) wired into the selector-interpolation path;
(3) keep/narrow the glued-vs-slot guard from #88.

---

## Audit findings — what each construct produces today

### `Mixin` (`packages/core/src/tree/mixin.ts`)

- A `Mixin` is a `Rules<MixinValue, MixinOptions>` subclass (`mixin.ts:81`). It IS its own
  canonical body (R2 single-frame; `mixin.ts:120-128`). It has `name?`, `params?: List`,
  `guard?`, and `rules: Node[]`.
- **`evalNode` returns `this`** — a mixin definition is a lazy template that does NOT walk
  its body (`mixin.ts:365-382`). `render` is a no-op (`mixin.ts:241-245`) — a definition is
  never CSS output.
- A mixin produces output only when CALLED, via the callable machinery
  (`packages/core/src/tree/call.ts` + `packages/core/src/tree/util/callable-*.ts`). The
  call output is a `Rules` surface of the mixin's inlined body (`call.ts` `finalizeCallResult`
  / `markCallOutput`, `call.ts:734-758`; the surface flattens into the parent like any
  control-flow `Rules`).
- **The `result:` return is a PARSE-ONLY normalization, NOT wired at eval.** The jess
  `AnonMixin` builder lowers `@(…) > <expr>` into a `Mixin` whose body is a single
  `Declaration{ name: 'result', value }` (`builders.ts:704-713`, `:719-723`). But a
  repo-wide search finds NO eval-time lookup of a `result` binding anywhere in core
  (`grep 'result'` across `tree/*.ts`, `util/callable-*.ts` — only `finalizeCallResult` /
  `callDeclarationOutput` naming, nothing that extracts a `result` cell as a return value).
  The jess anon-mixin/function tests are **parse-only** (`packages/jess-parser/test/corpus/
  08-anon-mixins-functions.test.ts`, `parse-only.test.ts`).
  - **GAP:** calling `@(…) > <expr>` today produces a `Rules` body containing a `result:`
    declaration — it does NOT return the expression's value. There is no "call a function,
    get a value" path. This is the single largest gap for the full vision.

### `each` — Less lowers it to `For`; jess IMPORTS the Less `each` (no jess lowering)

- **Less** lowers `each(iterable, callback)` → `For{ pattern, iterable, rules: callback.rules }`
  in BOTH less grammars:
  - Chevrotain values path: `packages/less-parser/src/productions/values.ts:1017-1027` (guards
    on `nameValue === 'each' && args.length === 2 && args[1] instanceof Mixin`, splices
    `callback.rules` as the loop body).
  - Functional grammar: `EachFor` node, `packages/less-parser/src/grammar.ts:673-676`.
  - In both, the callback's body is spliced as the loop body and EMITS rules; any `result:`
    is discarded.
- **jess does NOT need — and must NOT get — its own `each`.** `.jess` imports any Sass/Less
  function directly via `@-from` / `@-use`; `each` in a `.jess` file IS the Less `each` (which
  already lowers to `For`). The generic `g.Call` route (`grammar.ts:426-429`) is correct — the
  call resolves to the imported Less `each`; only the ARGUMENT is jess-flavored (a jess
  AnonMixin lambda `@($item) > *[…]`). So there is NO jess `each`→`For` lowering to build, no
  jess `each` builtin to register, and no grammar/builder change for `each` in Phase 0.
  - **What this leaves:** the value-collecting behavior belongs entirely in the shared **`For`**
    node (below) + the value-returning lambda (the `result:` reader). The `each` name already
    resolves; nothing jess-side about `each` itself is missing.

### `$for` / `For` (`packages/core/src/tree/control.ts:604-891`)

- `For extends Rules<StructuredLoopValue>` (`control.ts:613`); it IS its own body
  (`ownControlBodyChildren`, `control.ts:641`).
- **`evalNode` returns a `Rules`** (`control.ts:688-726`): it iterates `resolveEntries`
  over the evaluated iterable, and for each entry builds a per-iteration surface
  (`createForIterationSurface`, `control.ts:427-472` — a THIN surface sharing the body
  children under a fresh scope frame whose live slots carry `@value`/`@key`/counter), evals
  it, and pushes the resulting `Rules` into `outputRules` (`control.ts:707-714`). The
  outputs are wrapped in one `createGeneratedOutputRulesSurface` container (`control.ts:716-723`).
  - **The iteration result is ALWAYS treated as `Rules` and spliced** — there is no path
    that reads a per-iteration VALUE (e.g. a `result:` decl) and collects it into a list.
- **SPINE-FOLD path (the delicate part):** `For.spineIterationSurfaces` (`control.ts:817-890`)
  is the single-pass analogue used when a loop is CONTAINER-nested. It produces one bound
  surface per iteration by COPYING the body children (`copyWithReusableLeaves`) under a fresh
  frame — WITHOUT eval-materializing — and the caller splices their children in order
  (`serialize-helper.ts:1217-1255` `runSpineForExpansion`; `emit-walk.ts:1103-1165`,
  `:1495-1508`). Root-direct loops stay on eval (`emit-walk.ts:1509-1512` bails when a root
  child is `For`). `serialize-helper.ts:558-568` deliberately keeps `For` a container (not a
  transparent flatten) so the loop-fold pass owns it.
  - **GAP + RISK:** any value-collecting mode must be handled in BOTH the eval path
    (`For.evalNode`) AND the spine path (`spineIterationSurfaces` + its expansion), or the two
    diverge. The spine copies-and-splices bytes; a value-collecting loop does NOT splice body
    bytes — it produces a single value. The cleanest split (see below) is to route the
    value-collecting form entirely OFF the byte-splice spine.

### `$if` / `If` (`packages/core/src/tree/control.ts:474-602`)

- `If extends Rules<IfValue>` (`control.ts:488`), IS its own body.
- **`evalNode` returns a `Rules`** (`control.ts:548-568`): evaluates the condition, and on
  pass returns `createIterationEvalSurface(this).eval(...)` (a thin body surface); on fail
  returns the `else` branch's eval or an empty generated surface. `render` selects a branch
  and renders it (`control.ts:570-597`).
  - **GAP:** `$if` produces the selected branch's `Rules`. To be value-returning it would need
    to return the value the selected branch's body computes (again, a `result:`-style lookup,
    or — more naturally for `$if` — the branch being a bare value expression rather than a
    `{ body }`). No such path exists.
- `While` (`control.ts:893-1037`) has the same shape (Rules-emitting; carries cross-iteration
  state via `createWhileStateSurface`/`syncWhileState`). Out of scope for the immediate case
  but shares the generalization.

### Selector interpolation + the #88 guard (`packages/core/src/tree/interpolated.ts`)

- `Interpolated.createSelector` (`interpolated.ts:316-375`) builds a selector from an
  interpolated source. Two guard points throw `ERR.commaListInterpolation`:
  - whole-selector interpolation whose stringified replacement has a top-level comma
    (`interpolated.ts:340-343`),
  - embedded interpolation whose assembled output has a top-level comma
    (`interpolated.ts:369-371`).
- `shouldWrapSelectorInIs` (`interpolated.ts:52-65`) already wraps a GENUINE selector-list /
  complex replacement (a `SelectorList` / `ComplexSelector` node, or a `SelectorCapture`
  carrying one) in a generated `:is(…)` (`serializeGeneratedIsWrapper`, `interpolated.ts:78-85`)
  when it's embedded. So a real `SelectorList` node in a slot is FINE; only a comma-list
  *value* (a `List`/`Sequence`/`Quoted` whose text has a top-level comma) errors.
- `hasTopLevelComma` (`interpolated.ts:26-47`) is comma-outside-quotes-and-brackets; commas
  inside a generated `:is(…)` are nested, so genuine list interpolation is unaffected.
  - **GAP:** there is no `toSelectorList(value)` cast. A `List`/`Sequence` of captured
    selectors (what `each` will produce) is neither a `SelectorList` node (so
    `shouldWrapSelectorInIs` is false) nor safe to string-splice (top-level comma → error).
    It needs to be recognized and cast BEFORE the comma guard fires.

### `SelectorCapture` (`packages/core/src/tree/selector-capture.ts`) and `SelectorList`

- `SelectorCapture` wraps a `SelectorLike` payload (a bare string, a `Selector` node, or a
  `SelectorListItem[]`). `evalNode`/`resolve` lift it to a `Selector` node and eval it
  (`selector-capture.ts:104-126`). So `*[ .fruit-apple ]` evaluated yields a `Selector` (a
  `BasicSelector`/compound), and `*[ .a, .b ]` yields a `SelectorList`. This is exactly the
  "value that IS a selector" carrier the map needs.
- `SelectorList` (`packages/core/src/tree/selector-list.ts:47`) is `Selector<SelectorListItem[]>`
  where `SelectorListItem = Selector | string`. `SelectorList.create(items)` +
  `finishSelectorListSurface` (`selector-list.ts:309-320`) build one; `emitSelectorListItems`
  already hoists inner `:is(...)` lists to the top level.
- Value lists: `List` (`packages/core/src/tree/list.ts:221`) carries `options.sep` ∈
  `,`/`;`/`/` (undefined = space list); `Sequence` (`packages/core/src/tree/sequence.ts:92`) is
  a space group. `each` should collect into a `List` with `sep: ','` whose members are the
  captured `Selector`s.
  - So `toSelectorList(value)`: given a `List`/`Sequence` (or a single node), collect members,
    eval each to a `Selector` (a bare string member → `BasicSelector`), and return
    `SelectorList.create(selectors)`. A single member collapses to that selector.

---

## The unifying model — "assignable, re-evaluated node"

An assignable control node is one that, in addition to its rules-emitting form, has a
**value-returning form** distinguished at PARSE time by the arrow marker:

| Form                         | Meaning                        | Produces               |
|------------------------------|--------------------------------|------------------------|
| `@(params) { body }`         | anon mixin (rules-emitting)    | `Rules` when called    |
| `@(params) > { body }`       | function, block body           | value of `result:` cell |
| `@(params) > <expr>`         | function, expression body      | value of `<expr>`      |
| `$if (c) { body }`           | conditional (rules-emitting)   | `Rules`                |
| `$if (c) > <expr>` (future)  | conditional value              | `<expr>` of taken branch |
| `each(list, <rules-lambda>)` | map, rules-emitting            | `Rules` (spliced)      |
| `each(list, <value-lambda>)` | map, value-collecting          | `List` of returns      |

**The node/eval contract.** Introduce ONE shared notion: a node is *value-returning* when
its "body" is a value-lambda (`> <expr>` or `> { … result: … }`) rather than a `{ body }`.
Evaluating it in value context returns that value; evaluating it in statement context emits
`Rules` as today. Two sub-problems, sequenced:

1. **Function return extraction** (the missing eval primitive). Calling a `Mixin` whose body
   assigns `result` must return the evaluated `result` value instead of a `Rules` body. This
   is the arrow-function's "return". It plugs into the callable output path
   (`call.ts` `finalizeCallResult` / `callable-output.ts`): after the body evals to a `Rules`
   surface, if the surface has a `result` binding (and the callee was authored as a function —
   marked from the `>` in the builder), extract and return that cell's value rather than the
   surface. This one primitive unlocks mixins, `each` value-lambdas, and `$if`-value.

2. **Map collection** (`each`/`For` value mode). When the loop's per-iteration body is a
   value-lambda, collect each iteration's returned value into a `List` (sep `,`) instead of
   splicing `Rules`. `For.evalNode` already loops and has each iteration's surface in hand;
   the branch point is "did this iteration produce a value or a rules body".

**How the result is consumed.**
- Assigned to `$var`: `VarDeclaration` evals its RHS. If the RHS is a value-returning node
  (a value-lambda call, or an `each` in value mode), it yields a value node — no change to
  `VarDeclaration` needed once the RHS eval returns a value.
- Collected by `each`: as above — the map collects returns into a `List`.
- Cast to selector list: `toSelectorList(value)` converts a `List`/`Sequence` of selectors
  (each member evaluated via its `SelectorCapture` to a `Selector`) into a `SelectorList`,
  wired into `createSelector` BEFORE the comma guard.

**Distinguishing the two forms.** Carry a parse-time marker. The jess builder already knows
(`isExprFn` / `hasReturn` in `_buildJessAnonMixin`, `builders.ts:692-694`). Promote that into a
`MixinOptions` flag (e.g. `isFunction: true`) so eval can tell a function (return a value) from
a plain anon mixin (emit rules). `each`'s value-mode is then: "the callback mixin is a
function" — exactly mirroring less's existing `args[1] instanceof N.Mixin` gate, refined to
`callback.options.isFunction`.

---

## The immediate feature carved out (Phase 0) — ship `each(list, @($item) > *[…])` → SelectorList

This slice does NOT require the full function-return primitive to be perfect — it only needs
the value-lambda to yield the value of its single `result: <expr>` where `<expr>` is a
`SelectorCapture`. Minimal moving parts:

1. **jess `each` — nothing to build.** `each` in `.jess` is the imported Less `each` (via
   `@-from`/`@-use`), which already lowers to `For`. No jess grammar/builder change, no jess
   builtin. The only jess-flavored part is the ARGUMENT — the AnonMixin lambda `@($item) > *[…]`,
   which already parses. So Phase 0 touches ONLY the shared `For` node (§2) + the value-lambda
   `result:` reader + the `toSelectorList` cast (§3). (Ensure the Less `each` callback path
   passes an `isFunction`-marked `Mixin` through when the callback is a value-lambda, so §2's
   value-collecting branch triggers — verify whether the existing less `each` lowering already
   carries that marker or needs it.)

2. **`For` value-collecting mode.** When the loop body is a single-`result:` value-lambda,
   `For.evalNode` collects each iteration's evaluated `result` into a `List` (`sep: ','`)
   rather than splicing `Rules`. Implementation: at `control.ts:707-714`, branch on the
   iteration body being a function — extract the `result` cell value from the evaluated
   iteration surface (the narrow function-return primitive, scoped to just `result` here) and
   push the VALUE; return `List.create(values, { sep: ',' })` instead of a `Rules` container.
   Critical file: `packages/core/src/tree/control.ts`.
   - **Route this OFF the spine.** A value-collecting `For` produces a VALUE, not spliced
     body bytes, so it must NOT go through `spineIterationSurfaces`/`runSpineForExpansion`.
     Because it appears in VALUE position (a `VarDeclaration` RHS / a selector slot), it is
     never a container-nested statement loop, so the existing spine gates
     (`emit-walk.ts:1495-1512`, `serialize-helper.ts:558-568`) already keep it away from the
     byte-splice path — VERIFY this holds (a value-mode `For` reached only via `.eval`), and
     add a guard in `spineIterationSurfaces` that throws/bails if ever handed a value-mode loop.

3. **`toSelectorList` cast + guard narrowing.** In `interpolated.ts createSelector`
   (`:331-374`): before the comma-guard throws (`:341`, `:369`), if the whole-selector
   replacement is a `List`/`Sequence` of `Selector`s (or a value-mode `each` result), cast via
   `toSelectorList` to a `SelectorList` and take the existing genuine-list path (which wraps in
   `:is(…)` when embedded, or returns the list directly when it's the whole selector). Keep the
   comma-list-VALUE error for genuine comma-list values (a `Quoted`/text list). The glued case
   (`.foo-$[x]` where `$[x]` is a list) STAYS an error; the slot case (`$[x]` is its own simple
   selector) casts to `:is(…)`. Critical files: `packages/core/src/tree/interpolated.ts`, new
   `toSelectorList` in `packages/core/src/tree/selector-list.ts`.

**Sequencing (red-first):**
- P0.a — Write failing tests: `each(apple satsuma, @($item) > *[ .fruit-$[item] ])` in both a
  selector slot (`.fruit-apple, .fruit-satsuma`) and assigned to a `$var` then interpolated.
  Add a still-erroring test for a genuine comma-list VALUE glued into an identifier
  (guard must stay).
- P0.b — ensure the (Less) `each` callback path marks a value-lambda `Mixin` `isFunction` so §2 triggers.
- P0.c — `For` value-collecting branch (narrow `result`-cell extraction) → `List` (`sep ','`).
- P0.d — `toSelectorList` + `createSelector` cast/guard narrowing.
- P0.e — Green the suite; verify the #88 error still fires for the glued-value case.

This ships WITHOUT the general function-return primitive: P0.c extracts `result` only in the
loop-collection branch (a bounded, local read of the iteration surface's `result` binding).

---

## The Less back-port — `#(params) > <expr>`

- Today less has anon-mixin/detached-ruleset callbacks BLOCK-BODY ONLY:
  `AnonymousMixinDefinition = [.#] MixinArgs { declarationList }` (`grammar.ts:192-193`);
  `DetachedRuleset = { declarationList }` (`grammar.ts:591`). There is NO `> <expr>` /
  `> { body }` return form. `each` already lowers to `For` (`grammar.ts:673`,
  `values.ts:1017`).
- Back-port: add the `>`-return alternatives to `AnonymousMixinDefinition` (functional
  grammar) and the Chevrotain anon-mixin production, so `#(params) > <expr>` and
  `#(params) > { body }` parse. The builder normalizes `> <expr>` into a body
  `[Declaration{ name:'result', value }]` and marks `isFunction` — IDENTICAL to the jess
  `_buildJessAnonMixin` normalization (`builders.ts:704-723`); factor that normalization into a
  shared core/parser helper so jess and less agree byte-for-byte.
- Parity considerations: both grammars `compose([cssGrammar, …])`, so the value-position
  ordering matters — the `>`-return alt must be tried within the existing anon-mixin rule (it
  already owns the `[.#](` / `@(` prefix), not as a new top-level value, to avoid ambiguity
  with the `>` child combinator in selectors (less anon mixins are value/arg-position only, so
  no selector-combinator clash there — VERIFY against `MixinArgs`/`callArgSeq` ordering,
  `grammar.ts:610-611`). Jess uses `@(…) > …`; less uses `#(…) > …` / `.(…) > …` — same shape,
  different sigil.
- Effort: small grammar delta per parser + one shared builder normalization; the eval side is
  entirely shared (both build a core `Mixin` with `isFunction`).

---

## Risks & delicate parts

1. **Spine-fold / emit-walk divergence (BIGGEST RISK).** The loop has TWO evaluators:
   `For.evalNode` and `For.spineIterationSurfaces` (`control.ts:817-890`) +
   `runSpineForExpansion` (`serialize-helper.ts:1225`). Any behavior added to one must be
   mirrored or explicitly excluded in the other. Mitigation: value-mode `each` is VALUE-position
   → never container-nested statement → never reaches the spine; assert this with a guard and a
   ratchet test. Do NOT teach the byte-splice spine to "collect values" — keep the two modes on
   disjoint paths.
2. **`result:` return primitive is currently VAPOR.** The parse layer creates `result:` decls
   but nothing reads them (confirmed by search). Phase 0 introduces the FIRST reader, scoped to
   the loop-collection branch. Generalizing it to all mixin calls (Phase 2) touches the whole
   callable-output path (`call.ts:734-758`, `callable-output.ts`, `mixin-output-slot.ts`) and is
   higher risk — a mixin that both emits rules AND assigns `result` must stay backward-compatible
   (today it emits the `result:` decl as CSS-ish output). Gate the return-extraction on the
   `isFunction` marker so ONLY authored functions change behavior.
3. **Eval order / scope leakage.** `Interpolated._evalToInterpolated` already pins and re-asserts
   the entry scope per slot (`interpolated.ts:480-541`) because async plugin evals leak
   `rulesContext`. A value-mode `each` embedded in a slot will eval a loop inside a slot — ensure
   the loop's per-iteration frames nest under the pinned scope, not a leaked one.
4. **#88 guard interaction.** The comma guard must fire AFTER the `toSelectorList` cast attempt,
   not before, or a legitimately-castable list errors. Both throw sites (`interpolated.ts:341`,
   `:369`) need the cast tried first. Keep the guard for genuine comma-list VALUES (text lists) —
   add tests pinning BOTH the pass (each result casts) and the fail (glued text list errors).
5. **Incremental-reparse / CST.** The Less `each`→`For` lowering already builds a synthesized
   `For`; the CST/provenance side table (spans live in the WeakMap side table via free functions,
   per repo memory) must attach to the synthesized `For`/`List` nodes so round-trip/`writeSyntax`
   still emits `each(…)` source. A value-mode `For` still needs a faithful `writeSyntax` (it
   currently writes `$for (…) {…}` — `control.ts:740-779` — which is WRONG for an `each`-sourced
   or value-mode loop). This is a real serialization gap to design: an `each`-sourced `For` must
   round-trip as `each(…)`. (This is a property of the shared/less `each` lowering, not jess-specific.)
6. **3276-test core suite regressions.** The change surface (interpolated selector building,
   `For.evalNode`, `SelectorList`) is hot and shared across css/less/scss/jess. Gate per repo
   conventions: rebuild core lib before gating (some tests run built `lib/`), run core
   single-threaded (`npx vitest run --no-file-parallelism`) for a true green, and remember the
   6 pre-existing less-parser baseline reds. `each` in less MUST stay rules-emitting by default
   (only a function-callback triggers value mode) so existing less `each` fixtures are untouched.

---

## Phasing

**Phase 0 — the immediate map feature (SHIP FIRST).** `each(list, @($item) > *[…])` →
`SelectorList`. Value-collecting `For` (narrow `result` read) + `toSelectorList` cast + guard
narrowing. (No jess `each` work — `each` is the imported Less `each`; only the shared `For` +
value-lambda reader + cast change.) Critical files: `packages/core/src/tree/control.ts`,
`packages/core/src/tree/interpolated.ts`, `packages/core/src/tree/selector-list.ts` (+ possibly
the Less `each` lowering to carry the `isFunction` marker). Effort: medium. Risk: medium
(interpolated-selector + For.evalNode are hot; the spine is avoided by construction).

**Phase 1 — the general function-return primitive.** Wire `result:` extraction into the callable
output path, gated on the `isFunction` marker, so `$x: $ > myFunc()` (jess) / a called
`#(…) > <expr>` returns a value. Critical files: `packages/core/src/tree/call.ts`,
`packages/core/src/tree/util/callable-output.ts`, `mixin.ts` (the `isFunction` flag +
`MixinOptions`). Effort: medium-high. Risk: high (whole callable-output surface; backward compat
for mixins that emit `result:` as output).

**Phase 2 — generalize `each`/`$for`/`while` value mode + `$if`-value.** Once Phase 1 lands, the
loop-collection branch reuses the shared primitive (drop the Phase 0 narrow read); add `$if (c) >
<expr>` (value-returning conditional) and general `$for` value collection. Critical files:
`packages/core/src/tree/control.ts`, grammars for `$if (…) > <expr>`. Effort: medium. Risk:
medium.

**Phase 3 — Less back-port `#(params) > <expr>`.** Grammar delta in both less grammars + shared
builder normalization. Critical files: `packages/less-parser/src/grammar.ts`,
`packages/less-parser/src/productions/values.ts` (Chevrotain anon mixin), shared builder helper.
Effort: small-medium. Risk: low-medium (grammar ambiguity vs `>` combinator — value-position
only, so contained).

**Cross-cutting (all phases):** an `each`-sourced / value-mode `For` must round-trip as `each(…)`
source, not `$for (…) {…}` — design the `writeSyntax`/provenance for the synthesized node early
(risk #5), ideally in Phase 0.
