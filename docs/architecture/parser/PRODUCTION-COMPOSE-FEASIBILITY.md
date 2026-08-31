# Production-level `compose()` across the four grammars — feasibility

**Verdict: BLOCKED on parseman 0.46.0** — not scheduled, not deferred by choice.
Ledger row **P22**, updated to match. Not because the design is wrong — it is
right, and it is still the resolution this debt needs — but because the vehicle
does not exist in the installed parseman. `compose()` cannot compile a rule map containing a
`node()` whose build callback references anything outside its own parameters,
and every production in all four grammars does. The blocker is upstream, it is
precisely located, and it is small. Re-run
`node scripts/probe/parseman-compose-feasibility.mjs` after any parseman bump.

Measured at `4f10f919e`, parseman **0.46.0** (`package.json:42`, `^0.46.0`, and
the installed tree resolves to exactly 0.46.0).

> **SUPERSEDED IN PART — re-measured at parseman 0.50.4 (2026-08-31). See §6.**
> The 0.46.0 findings below are kept verbatim as the historical record, but the
> headline verdict no longer holds: at 0.50.4 the **block-bodied-reducer blocker
> is GONE** (0 structural rejects across all four grammars) and imported free
> bindings are now **carried** via a `buildImports` provenance manifest. The one
> remaining blocker is the free-binding half, and specifically the module-scope
> **local reducer helpers** each superset still defines inline. `css-parser` has
> already done the hoisting and ships `cssBaseRules = compose([…])`, which
> **macro-fuses end-to-end** (0 artifact fallbacks in a real build). Read §6
> before acting on anything in §1–§5.

---

## 1. What the installed parseman actually supports

Read from the **installed** package, not documentation:
`node_modules/parseman/dist/compiler/linker.d.ts` and
`dist/plugin/index.js`.

`compose(items, opts?)`, `composeLeaf(items)`, `pick(grammar, names)`,
`fuseInterpreted`, `recoverComposedRules` all exist and are exported.
`compose()`'s doc example is literally the case we want ("Jess taking parts of
Less and parts of Sass"). Override order is later-piece-wins, and an override
reroutes the base piece's own internal calls — which is exactly the semantics a
dialect override needs.

So the API is real. The limit is in how the macro plugin *lowers* it.

### The asymmetry that decides everything

`composeLeaf()` and `compose()` treat their pieces differently, and the
difference is the whole finding.

| | pre-final pieces | final piece |
|---|---|---|
| `composeLeaf()` | re-lowered from carried **IR**; must prove `hasDirectBuilders === false` **and** `isRecognitionOnly === true` (`plugin/index.js:14040`) | compiled with `compileLinkable` (`plugin/index.js:14025`) — a full static compile that keeps free bindings as real imports |
| `compose()` | re-lowered from carried **IR** | **also** re-lowered from carried IR — `compileComposeCall` sends *every* element through `materializeCarried` (`plugin/index.js:13973`) |

`localCarried` (`plugin/index.js:13854`) serializes a rule map to IR
unconditionally, including one written inline in the calling module. IR carries
a direct builder as **source text**:

```
"Thing": _nd("Thing", sequence(_s0, literal(":"), _s0), "(c) => ({ k: c[0], v: c[2] })")
```

and `_nd` (`plugin/index.js:10791`) throws when the callback is not
self-contained:

```
IR direct node builder for <Type> must be macro-static and self-contained;
unsupported binding(s): <names>
```

`composeLeaf()` never hits this because its recognition-only precondition
guarantees the pre-final pieces have no builders at all, and its own local piece
skips IR entirely. That is why `composeLeaf` is used in all four grammars and
`compose` is used nowhere: **`compose` was never usable here**, not merely
unexplored.

---

## 2. Evidence

`scripts/probe/parseman-compose-feasibility.mjs` is the instrument. It is
control-paired on purpose: a probe that reports a wall for every case is
indistinguishable from a probe that is simply broken, and this one *was* broken
once — resolving `parseman/plugin` through `require.resolve` picks the CJS entry,
which has no `transformMacro` export and scored all six cases THREW. CONTROL-1
is what caught it.

Recorded at 0.46.0:

| case | outcome | what it varies |
|---|---|---|
| CONTROL-1 | **FUSED** | `compose()` over a same-package imported factory, reducer self-contained |
| TREAT-1 | INTERPRETER FALLBACK | same, factory in **another package** — what less/scss/jess would need |
| TREAT-2 | INTERPRETER FALLBACK | same-package imported factory, reducer calls an **imported** builder |
| TREAT-3 | **THREW** | both pieces **inline in one module**, reducer calls an imported builder |

TREAT-3 is the important one. It has no package boundary, no cross-module
import of a factory, nothing exotic — and it still fails. **The package boundary
is not the blocker.** Merging the four parser packages into one would not help.

On the real grammars, the committed file versus the identical file with
`composeLeaf(` swapped for `compose(` and nothing else changed:

| grammar | as committed | swapped to `compose()` |
|---|---|---|
| `css-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `UrlUnquoted`: `any`, `tokenText` |
| `less-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `UnsupportedMixinName`: `unsupported BlockStatement` |
| `scss-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `QueryNonOnlyKeyword`: `requireKeyword` |
| `jess-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `DeclarationReference`: `withSourceSpan`, `declarationReference` |

`any` and `withSourceSpan` are `@jesscss/core/ast` factories. `tokenText`,
`requireKeyword` and `declarationReference` are module-scope helpers. Both
categories are pervasive and neither is incidental.

### Blast radius

With the `_nd` throw converted to a collector (a patched copy of the plugin, so
the whole graph is walked instead of stopping at the first failure), the count of
**distinct productions `compose()` would reject**:

| grammar | productions rejected | distinct free bindings needed |
|---|---|---|
| css | 113 | 44 |
| less | 208 | 69 |
| scss | 153 | 62 |
| jess | 168 | 60 |

The most-needed bindings are the canonical AST constructors and the local
helpers wrapping them — `tokenText`, `any`, `withSourceSpan`, `withBlockBody`,
`atRuleBlock`, `keyword`, `block`, `funcCall`, `requireToken`,
`requireValueNode`. This is not a tail of awkward productions to hand-fix; it is
the grammar.

There is also a **second, structural** blocker in the same census, distinct from
binding resolution: `unsupported BlockStatement` (the most frequent finding in
three of four grammars) and `unsupported callback shape`. A reducer with a
statement body is not IR-serializable **at all**, regardless of what it
references. An upstream fix that only carried the free bindings would still
leave these.

---

## 3. What the upstream fix would be

**Parseman is a separate lane's responsibility. Do not attempt this from a
grammar brief.** Stated here so the requirement is unambiguous, not as work to
pick up.

Two changes to parseman, both in the IR path:

1. **Carry the reducer's free bindings as an import manifest.** The plugin
   already computes the exact list — it is the `staticError` array `_nd` throws
   with — and it already knows the defining module. Carrying `{ name, source }`
   and having `emitFusedSource` re-emit those imports in the consuming module
   would close the binding half.
2. **Support block-bodied reducers in IR**, or let a `compose()` piece opt into
   the `compileLinkable` path that `composeLeaf`'s final piece already uses.
   (2) alone would close both halves and is the smaller change: the code path
   exists and is exercised on every build.

Until one of those lands, there is no spelling of production-level `compose()`
that survives `check:macro`.

---

## 4. The plan, for when it unblocks

Recorded now so the classification work is not redone. **Do not start this
before the probe reports CONTROL/TREAT-3 both FUSED.**

Shape: `css-parser` exports its production factory; each dialect becomes
`compose([cssPieces, rules(dialectFactory)])`, overriding by rule NAME only
where it genuinely differs. Because `compose()` reroutes the base's own internal
calls, overriding `Value` automatically re-points every CSS production that
references `Value` — which is the property that makes "valid CSS is valid in all
dialects" hold by construction instead of by four suites agreeing.

Classifying what "genuinely differs" — the settled distinction is **operand vs
head**:

- **Stays in the CSS base, no override.** A dialect variable sigil admitted as
  an OPERAND inside a ported CSS production. `@x` / `$x` appearing where CSS
  allows a value is an addition to a value slot, not a different production. The
  base declares the slot; the dialect widens it.
- **Cannot live in the CSS base — dialect-only rule.** A production whose HEAD
  is a sigil or a non-CSS token: keyword arguments, `==` / `!=`, `@mixin`,
  `@each`, guards, `&`-concatenation. These are new entry points, not widenings,
  and they belong in the dialect piece with no CSS counterpart.
- **Override by name.** A rule the base already declares whose accepted language
  the dialect genuinely narrows or widens — `Value`, `Declaration`,
  `SelectorTerm`. This is the set that must stay small and be justified rule by
  rule; every entry is a place the dialects can silently diverge again.

The prize is concrete. SCSS forked the ident-start declaration decision and
produced a wrong node — `div:hover, span { … }` yielding a `Declaration` named
`div` that swallowed the nested rule — undetected for as long as it existed,
because the four suites were separately satisfied. Under a shared base that fork
is not expressible without an explicit named override.

### Cost estimate

Gated on the upstream fix, and assuming it lands as described:

- **Upstream parseman work:** the larger of the two items, and not ours to
  schedule.
- **css-parser:** small. Export the factory; no production changes.
- **Per dialect:** the real cost is not mechanical. It is deciding, for each of
  the ~150-200 productions currently restated, whether it is byte-equivalent to
  the CSS one (delete it), an operand widening (delete it, widen the base slot),
  or a genuine override (keep, justify). That is a per-`const` judgement over
  four files of 4,090-6,344 lines, and it is exactly the grammar-review pass the
  standard already prescribes — so it should be run as one, with evidence per
  const, not as a bulk edit.
- **Risk concentrated in one place:** the AST must not move. Less has a
  byte-identity oracle; **css-parser does not**, and the Less oracle does not
  cover it (Less composes `cssSyntax` from `parser-shared`, not from
  `css-parser/src/grammar.ts`, and carries its own `Value`). A css-parser
  byte-identity harness with a proven negative control is a **prerequisite**,
  not a follow-up.

---

## 5. Ledger

Filed against **P22** in `docs/architecture/core/DESIGN-DECISIONS.md` (line 230),
which is the row for exactly this subject: one call argument defined three times,
once per superset, with production-level `compose()` named as the resolution.
That row read "SCHEDULED, not blocked"; this run proves it is **BLOCKED on
parseman 0.46.0**, and the row has been updated to say so.

Not P5. P5 ("SCSS should compose on the CSS base, NOT on Less — via a
dialect-neutral `preprocessorBase`") is a claim about which base a dialect
composes ON, and it should not carry a parseman-capability finding.

A note on method, since it cost a wrong claim in the first draft of this
document: the `P` rows in that ledger are **not in numeric order** — the tail
runs P18, P19, P21, P10, P20, P22 — so a scan for a sorted sequence stops at P21
and concludes P22 is absent. Never infer a ledger row is missing from ordering.
`grep -c "^| P22" docs/architecture/core/DESIGN-DECISIONS.md`.

**Update 2026-08-31 (re-measured at 0.50.4):** the "BLOCKED on parseman 0.46.0"
status filed against P22 is **no longer the whole story** — see §6. The two
upstream parseman changes §3 called for both LANDED (block-bodied reducers are
now IR-serializable; free bindings are carried as a `buildImports` manifest), so
the remaining blocker is not upstream at all but **grammar-side**: hoisting each
superset's module-scope reducer helpers into an importable module. P22 itself
already flags its 0.46.0 blast-radius counts as "UNVERIFIED … re-measure rather
than assume", and **P28** (SETTLED 2026-08-15) already records the compose
mechanism "proven end-to-end (parseman 0.49.0 cross-module fix)". This addendum
is that re-measurement; it does not soften P22's four hard rules.

---

## 6. Re-measured at parseman 0.50.4 (2026-08-31)

Re-run on branch off `origin/dev`, parseman **0.50.4** (`package.json:42` is
`^0.50.4`; the worktree lock had drifted to 0.50.1, so `pnpm install` was run —
`node_modules/parseman` then symlinks `parseman@0.50.4`). Two instruments:
`scripts/probe/parseman-compose-feasibility.mjs` (the original control-paired
probe) and a new per-reducer census, `scripts/probe/parseman-compose-reducer-census.mjs`,
which drives parseman's own `directBuilderBindings` classifier over every inline
reducer. Every number below is measured, not inferred.

### 6.1 The synthetic probe — TREAT-3 flipped

| case | 0.46.0 | **0.50.4** | what it varies |
|---|---|---|---|
| CONTROL-1 | FUSED | **FUSED** | same-package imported factory, self-contained reducer |
| TREAT-1 | INTERPRETER FALLBACK | INTERPRETER FALLBACK | factory in another package (synthetic temp tree) |
| TREAT-2 | INTERPRETER FALLBACK | INTERPRETER FALLBACK | same-package factory, reducer calls an imported builder |
| TREAT-3 | **THREW** | **FUSED** | two pieces inline in one module, reducer calls an imported builder |

**TREAT-3 is the headline.** The case the 0.46.0 write-up called "the important
one" — no package boundary, reducer calls an imported builder — **now fuses.**
The `_nd` "unsupported binding(s)" throw it hit at 0.46.0 is gone: the imported
builder is carried as provenance and re-emitted as a real import.

(TREAT-1/TREAT-2 still fall back, but that is a synthetic-harness artifact —
temp packages in a scratch tree that the build-time evaluator cannot resolve —
**not** a real limit: P28 records cross-module compose "proven end-to-end" at
0.49.0, and §6.4 below shows the real cross-module `cssBaseRules` fusing. The
probe's real-grammar section is now uninformative at 0.50.4 for a related reason
— single-file `transformMacro` cannot resolve a grammar's cross-package base
piece, so committed `composeLeaf()` reports THREW under it; the per-reducer
census in §6.2, and the real build in §6.4, are the authoritative measurements.)

### 6.2 Reconciled blast-radius census @ 0.50.4

Per grammar, over every inline `node()` reducer, using parseman's own
`directBuilderBindings` (plugin/index.js:17093) and the exact reject/carry rule
at plugin/index.js:17731-17743 (`staticError = [...structural, ...unresolvedFree]`;
an imported free name is carried, a non-imported one is rejected):

| grammar | inline reducers | reducers rejected | distinct free bindings | distinct unresolved (local helpers) | **STRUCTURAL (block/callback) rejects** | binding-only rejects |
|---|---|---|---|---|---|---|
| css  | 130 | **0**   | 67  | **0**   | **0** | 0 |
| less | 247 | 236 | 162 | 106 | **0** | 236 |
| scss | 146 | 140 | 107 | 55  | **0** | 140 |
| jess | 160 | 156 | 122 | 70  | **0** | 156 |

Two facts settle the contradiction this re-measurement was opened on:

1. **Structural (block-bodied / callback-shape) rejects = 0 in ALL FOUR
   grammars.** The 0.46.0 claim that a statement-bodied reducer is "not
   IR-serializable at all" and that `unsupported BlockStatement` was the most
   frequent finding is **false at 0.50.4.** The classifier now walks block
   bodies fully (VariableDeclaration / Return / If / For / ForOf-In / Throw /
   nested blocks — plugin/index.js:17218-17281); only `while` / `try` / `switch`
   / destructured params / `arguments` / async/generator remain structural, and
   **the census finds none of those in any of the four grammars.** Direct
   spot-check of the exact reducer that threw `unsupported BlockStatement` at
   0.46.0 (`less-parser/src/grammar.ts:4675`, `UnsupportedMixinName`, a block
   body that `throw`s) now classifies `{structural: [], free:
   ['LessUnsupportedMixinNameError']}`.

2. **The remaining rejects are entirely binding-only, and specifically
   UNRESOLVED free names = module-scope local reducer helpers** defined inline in
   each `grammar.ts` (e.g. less `requireToken` at `:342`, `valueSlot` at `:1373`,
   `isDeclaration` at `:1623` — all `function`/`const` in the file, not imports).
   Free names that ARE imported (canonical `@jesscss/core/ast` constructors like
   `any`, `withSourceSpan`, and helpers already hoisted to importable modules)
   are **carried**, not rejected — which is why css, whose 67 free names are all
   imported, has **zero** rejects.

### 6.3 Mechanism, from the 0.50.4 plugin source

Both upstream changes §3 asked for have landed in `node_modules/parseman/dist/plugin/index.js`:

- **Free bindings are carried as an import manifest.** `directBuilderBindings`
  returns `{structural, free}` (`:17281`). At the call site (`:17731-17744`) each
  free name of an inline builder is resolved via `_builderImports(name)`
  (`:17737`); resolvable names become `combi._def.buildImports = [{local, source,
  imported}]` (`:17744`) and only unresolved names join `staticError`
  (`:17742`). `_builderImports` resolves **non-macro imported specifiers**
  (`:19603-19654`), and `collectBuilderImports` (`:19759-19772`) re-emits those
  imports into the consuming module — exactly §3's fix (1).
- **Block-bodied reducers are supported in IR.** The statement walker
  (`:17218-17277`) handles `BlockStatement` and the ordinary statement forms;
  `_nd` (`:16387`) only throws when `staticError` is non-empty (`:16388-16389`),
  i.e. for genuine structural problems or unresolved bindings — never for a
  block body per se. That is §3's fix (2).

### 6.4 End-to-end proof: `cssBaseRules` fuses under a real build

`css-parser/src/grammar.ts:3911` already ships `export const cssBaseRules =
compose([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules({…},
cssFactory)], { hostMode: 'ast' })` — the doc's §4 plan, already realised for the
(fully hoisted) CSS grammar. Building `@jesscss/parser-shared` then
`@jesscss/css-parser` and scanning the emitted `lib/` with the repo's own
`artifactFallbacks` detector (`scripts/parseman-fallback-detector.mjs`): **0
artifact fallbacks across 11 emitted ESM modules.** `cssBaseRules` is emitted as
`const cssBaseRules = /* @__PURE__ */ tableRules({…})` (a fused table artifact,
`lib/grammar/ast.js:54647`) with **no surviving `parseman` combinator import** —
not a runtime `compose()` and not an interpreter fallback. (The package's `pnpm
build` exits non-zero only in its separate `tsc --emitDeclarationOnly` phase, on
`@jesscss/core/ast` type resolution because core was not built in this isolated
run — a type-declaration failure, not a macro-fusion one.)

### 6.5 Verdict

**At 0.50.4 the ONLY remaining blocker to production-level `compose()` is the
free-binding half — and it is grammar-side, not upstream.** Block-bodied
reducers and callback shapes do **not** block (0 structural rejects, all four
grammars; the exact 0.46.0 offender now classifies clean). No residual parseman
IR change is required.

Concretely:

- **css** is done: it composes today (`cssBaseRules`), fuses end-to-end, 0
  rejects.
- **less / scss / jess** are blocked only by the module-scope reducer helpers
  each still defines inline in its own `grammar.ts` — **106 / 55 / 70** distinct
  local helpers respectively. **Hoisting those helpers into an importable module**
  (the same move css already made — canonical constructors and grammar helpers
  reachable by import, so the analyzer can carry their `buildImports` provenance)
  makes every reducer's free names resolvable and clears the census to zero, at
  which point each dialect can `compose([cssBaseRules, rules(delta)])` and
  macro-fuse. This is grammar-review-standard work (evidence per `const`), not a
  parseman lane task.

The unblock condition in the original probe ("CONTROL-1 and TREAT-3 both FUSED")
is now **met**. The gating question has moved from "can parseman fuse this?" to
"which reducer helpers has each superset not yet hoisted?" — answered, with names,
by `scripts/probe/parseman-compose-reducer-census.mjs`.
