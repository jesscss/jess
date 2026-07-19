# Reference-call / member-call — a callable, chained Reference

Status: SCOPE + PLAN ONLY. No production code changed. The **core Reference-call
machinery** (grammar + node + eval + render) is the buildable prerequisite; the
**module member-access semantics** it enables are PROPOSED and gated on owner
sign-off of R6 Part D / R4 §R4.6.

## Why this exists — one missing feature, three deferred capabilities

Three independently-deferred items all converge on ONE gap: a `Reference` that is
**CALLED** and/or **chained** — member access with a `.name(args)` call and/or a
multi-segment accessor chain — on top of the map-accessor READ that already works.

1. **`.jess` `$[foo.bar(1,2,3)]` interpolation-body widening** — a
   variable-starting accessor/CALL chain inside `$[…]`. Deferred in
   `memory:jess-dollar-interp-accessor-and-string-landing`.
2. **`@use`/`@compose` member access** — `@theme.elevate()` (mixin call),
   `@my-functions.func()` (function call), and the "no member functions in Less
   `@compose`" resolve-time error. PROPOSED in R6 Part D + R4 §R4.6 (spec landed
   `aac39df65`), pending owner sign-off.
3. **`@{head[key]}` interp-body READ** — ALREADY LANDED + resolves (`0de1e56db`).
   Not a dependent; it is the PROOF of the read pattern (parser builds the
   structured node, ast/ evals it). The call feature is that read pattern PLUS a
   call dimension.

The read side is proven. What is missing across all three is the **call
dispatch + chain render + module member-call resolution**.

## Scope

### In scope — the core Reference-call machinery (buildable now)

- **Grammar**: fold a chained member-CALL (`.name(args)`) into the accessor chain
  of the `Reference` production in BOTH dialects, so `$foo.bar(1,2,3)` (jess) and
  `@theme.elevate()` (less) parse as a single left-associative chained reference.
- **ast/ node model + eval**: a call/member-call dimension on the accessor value
  node (extend `MapAccessor`, or a sibling call node), and an evaluator that
  dispatches the member call into the existing mixin-call / function-call
  machinery once the base resolves to a namespace/map/ruleset scope.
- **Render / round-trip**: emit `$[foo.bar(1,2,3)]`, `@theme.elevate()`, and a
  chained `@{a[b][c]}` back to source byte-identically (the trap that deferred
  item 1 originally — see Round-trip risk below).

### Out of scope (separately gated / separately tracked)

- **Module semantics** — WHICH member kind a call resolves to (`@compose` →
  mixin, `@use` → function), the Less-`@compose`-"no exposed function" error, the
  `@use` `as`-triple binding, `$.foo` shorthand. These are PROPOSED in R6 Part D
  and gated on owner sign-off; this plan provides the machinery they dispatch
  through, not the module-kind policy.
- **`@{…}` `.`-call** — a `.name()` call inside interpolation stays an ERROR
  (interpolation must yield a string; R4 §R4.6.2). Only the READ (`@{head[key]}`,
  already landed) and chained READ (`@{a[b][c]}`, R4.6-b) widen the interp body.
- The general function-return / value-lambda primitive
  (`ASSIGNABLE-CONTROL-NODES-PLAN.md`) — orthogonal; that is about a mixin
  RETURNING a value, this is about CALLING a member off a reference chain.

## What already works vs what's missing (STEP-1 evidence)

### Grammar seam — bare-head calls parse; chained MEMBER call does not (either dialect)

| form | jess-parser `grammar.ts` | less-parser `grammar.ts` |
|---|---|---|
| accessor READ chain | `refDot` (`.name`) + `refIndex` (`[key]`) folded into `Reference` (`:65-68`) | `refIndex` (`[key]`) folded into `Reference` (`:232,:244`) |
| bare-head CALL `head(args)` | `VariableMixinCall` = `$var(args)` statement (`:397-401`), e.g. `$rounded(8px)` | `refCall` = `(args)` folded into `Reference` (`:233,:244`); `VarCall` = `@var(args)` detached-ruleset call |
| chained MEMBER call `head.name(args)` | **MISSING** — no `refCall` in the `Reference` chain; explicit deferral comment at `grammar.ts:55` ("Reference-CALL `$foo.bar(…)` lands with the call feature") | **MISSING** — `Reference` has `refCall` but no `refDot`, so `.name` is not an accessor segment; `.name()` in less resolves via `MixinCall` combinator-`path`, not a `.`-member off a `@var` head |

Precise gap: `$foo.bar` parses (jess `refDot`) but the trailing `(1,2,3)` does
NOT (no `refCall` in the jess `Reference` chain — it errors at the `(`). Less
parses `@a[k]` and `@a(...)` but not the `.`-member `@theme.elevate` at all (no
`refDot`). Neither dialect parses the chained `head.name(args)` MEMBER call. The
bare-head call forms (`$rounded(8px)`, `@detached()`) are a different production
and do not chain.

### ast/ node model + eval — READ node exists; no member-CALL node/dispatch

- **`MapAccessor`** (`packages/core/src/ast/nodes.ts:273-279`): the READ node —
  `base` (ValueNode), `key` (ValueNode | number), `keyIsProp`, `bytes`
  (verbatim fallback). `evalMapAccessor` (`serialize.ts:1187-1211`) resolves the
  base to a decl map (`resolveBaseDeclMap`) and reads a member by name/index;
  when the base does not resolve it returns `literal(node.bytes)` (never
  regresses below verbatim). This is the proven read path.
- **`MixinCall`** (`nodes.ts:630-636`): call node with a namespace descent
  `path: PathSeg[]` (`#ns .a .b()`) — but its `path` segments are
  combinator+selector (`{comb, sel}`, R4.4.2), NOT a `.`-member off a resolved
  `@var`/`$var` value. **`FunctionCall`** (`nodes.ts:191-196`) is a flat-name
  value-position call. Neither models "call member `name(args)` on the value the
  base reference resolves to."
- **Missing**: a call dimension on the accessor value node (a `.name(args)`
  segment), plus an evaluator that, once `resolveBaseDeclMap` yields a
  namespace/ruleset scope, dispatches the member call through the existing mixin
  (`MixinCall`) / function (`FunctionCall`) machinery. R4.4.2 already sketches
  this ("head.name(args) → MixinCall with a namespace path"); the READ half
  (`MapAccessor`) is built, the CALL half is not.

### Render / round-trip — no chained/call form in either serializer

- Legacy `writeReferenceSyntax` (`packages/core/src/tree/reference.ts:3768-3834`)
  handles `index` / `variable` / `property` / `declaration` / `mixin` /
  `mixin-ruleset` type cases, each emitting a SINGLE accessor (`[key]`, `.key`,
  `> key`). There is no chained-accessor form and no `(args)` call form — a
  chain inside `$[…]` emits `$[foo].bar` (broken round-trip), the exact trap that
  deferred item 1.
- The ast/ serializer emits `MapAccessor` via its `bytes` fallback / resolved
  value; there is no member-call node to serialize, so `@theme.elevate()` /
  `$[foo.bar(1,2,3)]` have no faithful emit form.

### Resolution site — module-kind gate is resolve-time (confirms R6.D-a)

The module-kind decision (mixin-vs-function, and the Less-`@compose`
"no exposed function" ERROR) belongs at the resolve site
(`packages/core/src/ast/mixin-dispatch.ts` / `value-dispatch.ts` and the
`import-bridge.ts` module-scope resolution), NOT at parse time — the sigil'd head
(`@theme` / `$theme`) is grammatically a plain `@var`/`$var` map-lookup until
resolved (R6 Part D §D.2, §D.3). This confirms R6.D-a: the gate rides the §C.2 /
[R6.C1] module-scope resolution. `resolveBaseDeclMap` (`serialize.ts`, used by
`evalMapAccessor`) is the natural seam — it already resolves a base reference to
a scope; the member-call dispatch attaches there.

## Affected seams (summary)

| seam | file(s) | change |
|---|---|---|
| grammar (jess) | `packages/jess-parser/src/grammar.ts:55,65-68` | add `refCall` to the `Reference` accessor chain |
| grammar (less) | `packages/less-parser/src/grammar.ts:230-244` | add `refDot` member segment (so `.name`/`.name(args)` chains off a `@var` head) |
| ast/ node model | `packages/core/src/ast/nodes.ts:191-196,273-279,630-636` | add a member-call dimension (extend `MapAccessor` or a sibling call node) |
| ast/ eval | `packages/core/src/ast/serialize.ts:1187-1211` + `mixin-dispatch.ts`/`value-dispatch.ts` | dispatch the member call into mixin/function machinery once base resolves |
| render / round-trip | `packages/core/src/tree/reference.ts:3768-3834` + ast/ serializer | chained-accessor + `(args)` call emit form |
| resolve-time module gate | `packages/core/src/ast/import-bridge.ts` (module scope) | mixin-vs-function kind + Less-`@compose` member-function error (PROPOSED, R6 Part D) |

## The three dependent items — how each unblocks

1. **`$[foo.bar(1,2,3)]`** — once the jess `Reference` chain folds `refCall`, the
   node carries a member-call dimension, and the `$[…]` serializer emits the
   chain faithfully, the `$[…]` interp body widens to a variable-starting
   accessor/call chain (arithmetic like `$[1 + 2]` stays out —
   `memory:jess-dollar-interp-accessor-and-string-landing`).
2. **`@use`/`@compose` member access** — the READ (`@theme[key]`) already reuses
   `MapAccessor`; the CALL (`@theme.elevate()` / `@my-functions.func()`) uses the
   new member-call dispatch, with the module-kind gate (PROPOSED, R6 Part D)
   deciding mixin-vs-function and the Less-`@compose` error.
3. **`@{head[key]}` chained READ** (`@{a[b][c]}`, R4.6-b) — the single-segment
   READ is landed (`0de1e56db`); multi-segment chained READ reuses the same
   chained-accessor node this feature introduces (READ dimension only inside
   interpolation; `.`-call stays an error, R4.6.2).

## Sequencing / dependencies

- The **core Reference-call machinery** (grammar chain + node + eval dispatch +
  chain/call render) can be built INDEPENDENTLY and is the prerequisite for all
  three dependents. It reuses the proven `MapAccessor` read path plus the
  existing `MixinCall`/`FunctionCall` dispatch — no new resolution engine.
- The **module member-access semantics** (which kind resolves, the Less-`@compose`
  error, `as`-triple, `$.foo`) are PROPOSED in **R6 Part D** + **R4 §R4.6** and
  gated on owner sign-off. Build the machinery first; wire the module-kind policy
  when R6 Part D is signed off.

### Intersecting OPEN questions (do not re-decide here — track through them)

- **R6.D-a** (module-kind gate placement) — CONFIRMED resolve-time by the STEP-1
  evidence above (`resolveBaseDeclMap` / `import-bridge.ts`); still owner-to-rule.
- **R6.D-b** (`$.foo` ambiguity a resolve-time diagnostic) — resolve-time.
- **R6.D-c** (`@use … as *` unqualified vs leaky fold) — module-scope policy.
- **R4.6-a** (widen `@{ head[key] }` body now vs defer) — sequencing.
- **R4.6-b** (chained `@{ a[b][c] }` in interp body) — READ-chain scope; reuses
  this feature's chained-accessor node.

## Round-trip / byte-identity risk (the original defer trap)

The `$[…]` render form MUST round-trip. Legacy `writeReferenceSyntax` emits
`$[foo].bar` for a chained reference (`reference.ts:3768-3834` has no chained /
`(args)` form), which is NOT what parsed — this non-round-tripping emit is exactly
why item 1 was deferred rather than half-implemented
(`memory:jess-dollar-interp-accessor-and-string-landing`). Any landing must:

- emit the WHOLE chain inside a single `$[…]` (`$[foo.bar(1,2,3)]`, not
  `$[foo].bar(1,2,3)`),
- emit `@theme.elevate()` / `@{a[b][c]}` faithfully in both serializers,
- keep the `MapAccessor` verbatim-`bytes` fallback so an unresolved chain never
  regresses below its source spelling (`evalMapAccessor` `serialize.ts:1193,1209`).

Do NOT land a node whose serializer cannot reproduce the source chain — that is
the P0-keystone / round-trip bar this feature exists to clear.

## References

- `memory:jess-dollar-interp-accessor-and-string-landing` — `$[…]` widening defer + round-trip trap.
- `memory:namespace-access-use-compose-model` — the `@use`/`@compose` access model (owner-decided, verbatim).
- R6 Part D (`spec/R6-plugins-compat-modules.md:416-543`) — module member-access syntax/semantics (PROPOSED).
- R4 §R4.4 (`spec/R4-…-namespaces.md:652-760`) — `MapAccessor` / `MixinCall.path` data model + algorithm.
- R4 §R4.6 (`spec/R4-…-namespaces.md:910-976`) — `@{}` interp-body widening (PROPOSED).
- `ASSIGNABLE-CONTROL-NODES-PLAN.md` — orthogonal value-returning-node track.
