# Jess Parser — build notes

Living doc for the `.jess` parser build (functional Parséman grammar,
`jessGrammar = compose([cssGrammar, <Jess delta>])`). Tracks settled syntax
decisions, **deferred work**, and known quirks so nothing lives only in an
agent's head. Syntax comes from two sources: how core AST nodes stringify, and
the canonical docs (`packages/docs-content/docs/jess/**` — `02-Language/**` is
authoritative; `packages/docs/docs/**` is a stale mirror).

Corpus: `test/corpus/NN-*.test.ts` — each case parses `.jess` and asserts the
serialized AST (`serializeTypes`). Run: `npx vitest --run test/corpus --root packages/jess-parser`.

---

## Deferred — must be done before the parser is "complete"

### parseman env-blocker — RESOLVED 2026-07-05 ~22:59
- A ~3-minute window (22:54–22:59) where parseman's `dist/index.js`, mid-rebuilt by
  the parent session, threw `ReferenceError: _hostReads is not defined` from every
  compiled grammar (all four parsers, css-parser included — NOT jess-specific). The
  parent rebuilt parseman to a healthy dist; corpus back to **72/72 green** and
  `check:macro` clean (jess-parser 0 fallbacks). Recorded only as a reminder: if this
  error reappears, it's a parseman/codegen issue, not a Jess grammar bug.

### Eval / semantics (not parseable-in-isolation; needs the evaluator)
- **`.foo` member ambiguity warning.** `$theme.foo` (type `declaration`) can
  resolve to a `Declaration` *or* a `VarDeclaration`. When a collection declares
  BOTH `$foo` and `foo`, eval must emit an **ambiguity warning**. The parser
  builds the `declaration` reference; the conflict detection + warning is an
  evaluator responsibility. Reachable disambiguated forms already parse:
  `$theme[foo]` (variable) vs `$theme['foo']` (property).
- **Dynamic-lookup namespace resolution.** `$theme[$foo]` (dynamic → variable)
  vs `$theme["$[foo]"]` (dynamic → property) both parse as `index`-type
  references; eval decides which namespace by the key node (a `Reference` key →
  variable space; an interpolated `Quoted` key → property space).

### Syntax contradictions — ADJUDICATED by the user 2026-07-05
1. **Selector capture is `*[…]` — NO `$` sigil** (canonical = core's
   `SelectorCapture.writeSyntax`). Do NOT add a `$` to core; the parser accepts
   bare `*[.notice]`. The docs (which show `$*[…]`) are WRONG and get the `$`
   dropped in the docs-update task. The `$extend`/dynamic-property forms that reuse
   capture reconcile to bare `*[…]` too.
2. **`$apply` — `$|…` is INVALID; drop the `$|`-glued shorthand entirely.** The
   class-merge surface is `$apply <selector-list>` (space after `$apply`), incl.
   comma-lists: `$apply .a, .b`. Lower it to whatever the earlier
   "`$apply` ≈ `$ > *[.foo]`" description implies, but the SURFACE is never `$|…`.
3. **`@-use` and `@-from` are DISTINCT constructs, not interchangeable aliases.**
   "Sugar" only meant both can import namespaces. Keep two separate grammar rules;
   they map to different core imports (namespace vs ESM-style). Both support
   namespace import.

### Parser features — status
DONE (corpus green at commit time; see ENVIRONMENT BLOCKER above re running):
- Interpolation `$[key]` (ident interp) — corpus 04.
- Collections / lists / maps (`$x: { … }`, comma lists) — corpus 05.
- Control flow `$if` / `$else` / `$for` / `$while` — corpus 06.
- Mixins: defs, params (`$p[: default]`), guards (`when`), `$ >` calls + chains —
  corpus 07 (`eb6ec5c2b`).
- Anonymous mixins `@() {}` / `@{}` + functions `@() > { … }` / `@() > <expr>`
  (single-expr normalised to a `return:` decl) — corpus 08 (`0ecdbba1f`).
- `$extend` statement (`.sel`, `!exact`, `ns|sel`, comma list, `$type` variable
  target, `*[.sel]` capture target) — corpus 09 (`bddeb55ac` + capture commit).
  Literal targets wrapped in a `BasicSelector` (a bare string crashes
  `Extend.writeSyntax`); node targets (Reference/SelectorCapture) used directly.
- Selector capture `*[.notice]` / `*[.a, .b]` / `*[.foo .bar]` — corpus 10. Core
  `SelectorCapture` wrapping a coerced Selector node; renders `*[…]`, NO `$`
  (adjudication #1). Inner: lone → BasicSelector, list → SelectorList, complex →
  ComplexSelector. Read from `children` (the comma-list array collapses to `""` in
  `spannedComponents`, so rawChildren is unusable for it).

- `$apply <selector-list>` — corpus 11. `$apply .a, .b` (never `$|…`,
  adjudication #2). Builds a dedicated first-class `Apply` core node
  (`packages/core/src/tree/apply.ts`, modelled on `selector-capture.ts`) holding
  the applied-selector list; each target coerced to a real Selector (lone →
  BasicSelector). One selector and a comma list are both just an `Apply` with 1 or
  N selectors; round-trips `$apply .a, .b;` structurally. (Superseded the earlier
  `$ > *[.sel]()` mixin-Call lowering from `4ea1ad41e`.)

- Jess `@-` at-rules — corpus 12. `@-compose`/`@-export`/`@-import` → StyleImport;
  `@-use`/`@-from` → JsImport (distinct `source`, adjudication #3). Round-trips:
  `@-compose 'p' [as ns|*];`, `@-export 'p';`, `@-use 'p' [as ns];`,
  `@-from 'p' import (a, b as c) | * as ns;`. NOTE: `@-import` round-trips as
  `@import` (core's `StyleImport{type:'import'}.writeSyntax` emits `@import` — it
  deliberately overlaps the CSS at-rule; the leading `@-` is authored-only sugar).
  Base forms only; `@-compose` modifiers `(reference)`/`(protected)`/`(export)` +
  `set`/`with` blocks are NOT yet built (follow-up).

- Canonical Docusaurus docs updated to the settled syntax (`60b7b35f6`): `$*[…]`→
  `*[…]` in 08-interpolation, `$|…` removed / `$apply .rounded` in 05-mixins +
  `$ >` in 10-namespaces, mixin arg/param examples `;`→`,` in 05-mixins.

## `$apply` / `Apply` eval semantics (DONE)
`Apply.evalNode` expands `$apply` into the applied rulesets' bodies (user-specified
semantics: apply ONLY plain `Ruleset`s, whole-selector match, merge-ALL; parametric
`Mixin`s excluded — no callable/args/guards machinery):
- **Shared ruleset-only lookup** `resolveRulesetBySelector(selector, scope)`
  (`rules.ts`, exported): `getOrderedSelectorKeys` → `findMixinsFast(key,
  { rulesetsOnly: true })`. New `rulesetsOnly` option on `findMixinsFast` mirrors the
  existing `includeRulesets` filter in `collectBucketResults`: keep only
  `isNode(candidate, N.Ruleset)` at whole-selector (`entry.match.length === 0`).
- **Splice = thin `Rules` + live binding** (mixin-call inline mechanic): each matched
  `Ruleset` → `createCallableRulesSurface(ruleset)` (shares the ruleset's body
  children push-without-adopt + `sourceNode` live binding), collected into one
  container `Rules` that flattens into the parent output. Reused
  `createCallableRulesSurface` wholesale; did NOT reuse `evaluateCallableCollection`
  (it bakes in args/candidate-matching/guards — out of scope for ruleset-only apply).
- Tests: `core/src/tree/__tests__/apply.test.ts` (8 eval tests). Core 2745/0.

## `*[.foo]()` bracket-capture CALL is ruleset-only (DONE)
Correction to an earlier N/A: the bracket-capture CALL `*[.foo]()` IS made
ruleset-only, and it's a DIFFERENT construct from the dot mixin-ruleset call
`*.foo()` — so the change is surgical and leaves `*.foo()` untouched:
- `*[.foo]()` — a `Call` whose name is a `Reference` whose KEY is a `SelectorCapture`
  (`cap.parent === reference`; `isInsideSelectorCapture(reference)` is FALSE — the
  capture is a child, not an ancestor). Now resolves RULESET-only (same as `$apply`):
  a same-named `.foo` Mixin is excluded.
- `*.foo()` — a `Reference` with a STRING key + `options.type === 'mixin-ruleset'`,
  no capture. UNCHANGED (matches both mixin + ruleset).
Implementation:
- `rulesetsOnly` threaded through `findMixin`'s string-key path +
  `collectCallableBucketResults` / `collectCallableBucketRemainderResults` /
  `findMixinsFastForUncoveredCallable` (mirrors the `includeRulesets` guard;
  `CallableFindOptions.rulesetsOnly`).
- Gate: new `isSelectorCaptureKeyReference(referenceNode)` (key is a SelectorCapture)
  in `performMixinRulesLookup` / `performMixinRulesetRulesLookup`; when true, drop the
  `'Mixin'` filter (so rulesets are allowed) and pass `rulesetsOnly: true`.
- The BARE `*[…]` value (not called) is still a pure selector resolver — it does no
  lookup, so it's unaffected (SelectorCapture tests ×6 stay green).
- Tests: `selector-capture-call.test.ts` (4) incl. a bracket-vs-dot divergence test.
  Core 2749/0; `$apply` unchanged.

## Variable assignment operators (`?:` / `:=`) — DONE (parse + serialize)
- **`$foo?:` conditional / default-assignment** — Jess's equivalent of SCSS
  `!default` (NOT Jess). Serialization normalized to the canonical GLUED form:
  `$foo?: v` renders with NO space before the `:` (the spaced `$foo ?: v` authored
  form normalizes to it). Fix: `isJessGluedAssign` in `declaration.ts` glues
  `CondAssign`/`Add` only; `:=` (setDefined/nearestOuter) and Less `&,:`/`&_:` stay
  spaced (kept `$one := three` test green).
- **NO variable `+:` operator** — the Jess VARIABLE compound-add operator was
  REMOVED. `$foo +: 1` no longer parses; write it explicitly as `$foo: $foo + 1`.
  `assignOp` grammar is `/\?:|:=|:/` (no `+:`); the builder's `AssignmentType.Add`
  branch for VarDeclaration is gone. (`AssignmentType.Add` still exists in core for
  the Less PROPERTY `+:` merge — a separate feature, see the deferred design below.)
- **`$foo := bar` = NEAREST-OUTER non-shadowing assign — distinct `nearestOuter`
  marker (NOT `setDefined`).** User-settled semantics: reassign the *nearest
  enclosing scope that already defines `$foo`* (JS-block style), NOT the global/top
  binding. Sass `!global` = `setDefined` = global/top — a GENUINELY DIFFERENT
  semantics (verified: setDefined evals `!global`-ish), so `:=` MUST NOT share it.
  - New `nearestOuter?: boolean` option on `DeclarationOptions` (distinct from
    `setDefined`). Jess builder sets `nearestOuter: true` for `:=` (the earlier
    `setDefined`-reuse is reverted; `SetGlobal` enum stays deleted).
  - Serialization: `:=` now renders for `setDefined || nearestOuter` (same surface,
    distinct flags) — both `declaration.ts` sites. Round-trips SPACED `$foo := bar`.
  - **Eval DEFERRED** — nearest-outer scope-walk + reassignment is NOT implemented.
    `nearestOuter` is read by NO eval code, so `:=` currently has NO eval effect
    (verified: `.box` reads the ORIGINAL value, not the `:=` write). This is
    preferable to wrong `!global` eval. `setDefined`/`!global` eval is UNCHANGED
    (verified: still reassigns). TODO below.
  - Grammar `assignOp` has `:=` BEFORE `:` so it wins over `:` + a `=`-led value.
- **`$!foo: bar` live-binding ASSIGNMENT — parse-with-warning.** The `$!` sigil
  right after `$` (mirrors the `$!foo` read form). Grammar `dollarDeclName` allows
  an optional `!` (`/\$!?-?…/`); the builder strips the `!`, records
  `liveBinding: true` on the VarDeclaration (new option), and emits a parser
  warning (`result.warnings`, `deprecation: 'live-binding-assignment'`:
  "…parsed but not yet evaluated (not implemented)"). Renders back `$!name`.
  **Eval DEFERRED** — "assign through the live binding" not implemented (TODO).

## setDefined / `!global` ↔ `:=` split — blast radius (investigated)
- `setDefined: true` is SET by: scss-parser (3 sites, `sawGlobal` = Sass `!global`)
  and — until this change — the jess `:=` builder. Now ONLY scss sets it.
- `setDefined` is READ by ~12 core sites (rules.ts registration/eval incl. the
  assign-through-binding at ~4723, + direct-rules-lookup.ts) implementing the
  `!global` "assign the existing (global) binding" eval. ALL of that is UNTOUCHED —
  `:=` moving to `nearestOuter` leaves `setDefined`/`!global` semantics intact
  (core 2749/0). `nearestOuter` is read by no eval code yet (deferred).

## Property `+:` merge — DEFERRED design (eval + option plumbing NOT built)
Only the design; the merge-resolution eval + option plumbing are deferred (merge
eval is already deferred-eval territory). This is the PROPERTY `+:` (plain
`Declaration`, e.g. `background +: …`), NOT the removed variable op.
- **Semantics = "add to the current value"**: `prop +: v` is sugar for
  `prop: $($['prop'] + v)`. CONTRIBUTOR-ONLY — only the *adding* declaration needs
  the flag; a plain `:` on the same property **replaces/resets** (wipes any prior
  accumulation). This is a SUPERSET of Less's merge.
- **Gated by a compilation-level `legacyMerge` option** (defaulted by the entry
  file's extension):
  - `legacyMerge: true` → LEGACY Less behavior: BOTH declarations must be flagged
    to merge.
  - `legacyMerge: false` → the NEW Jess model above (contributor-only add; `:`
    resets).
  - **Defaults: `.less` → `legacyMerge: true`; `.jess` → `legacyMerge: false`.**
  - Granularity: compilation-level, defaulted by the entry file's extension.

## Deferred eval TODOs (parse + serialize done; NO eval effect yet)
- **`$foo := bar` nearest-outer reassignment eval** — walk to the nearest enclosing
  scope defining `$foo` and reassign THAT binding (JS-block style), NOT the global
  one. Real scope-walking work; deferred. Until built, `:=` has no eval effect (an
  inert marker, like `$!foo:`). Must NOT be routed through `setDefined`'s `!global`
  eval. (`nearestOuter` option; see the assignment-operators section.)
- **`$!foo: bar` live-binding assignment eval** — "assign through the live binding".
  Not implemented; the parser accepts `$!foo:` and WARNS. (`liveBinding` option.)

FOLLOW-UPS (out of the adjudicated scope; not yet built):
- `$!foo: bar;` live-binding assignment parse + eval (see flag above).
- `@-compose` option modifiers `(reference)` / `(protected)` / `(export)` +
  `set`/`with` config blocks (StyleImport importOptions.reference/mutable/... + the
  StyleImportValue.with node).
- Mixin `;`-separated args, rest params `...$x`, and `$content()` callbacks (the
  doc still documents these features; parser support deferred).
- `$theme["$[foo]"]` dynamic-property key (rides on the capture machinery).

---

## Settled syntax decisions

- **Base:** compose over `cssGrammar` (cleanest shapes), not Less/SCSS. Author
  only the Jess delta + `//` comments. Selectors stay clean unless interpolated.
- **Variables:** `$name: value;` (name has no `$`); assign ops `:` `+:` `?:`.
  Live binding `$!foo` (renders `$!foo`; Reference `readMode: 'snapshot'`).
- **Accessor model** (`$theme.$key` is INVALID — removed from `reference.ts`):
  | Syntax | `type` | Semantics |
  | --- | --- | --- |
  | `$foo` | `variable` | variable read |
  | `$theme.foo` | `declaration` | ambiguous member (Declaration OR VarDeclaration; warns) |
  | `$theme[foo]` | `variable` | the variable `$foo` on theme |
  | `$theme['foo']` | `property` | literal property (Declaration) |
  | `$theme[0]` | `index` | numerical index |
  | `$theme[$foo]` | `index` | dynamic (value of `$foo` is the key) |

  `index` is reserved for dynamic/numerical lookups. Variable/property/index all
  render `[key]` on a target; `declaration` renders `.key`. The key node's form
  (bare / quoted / num / `$var`) makes them visually distinct.
- **Expressions `$( … )`:** one Expression node wrapping an arithmetic/comparison
  tree. Binary operators REQUIRE surrounding whitespace (`1 + 2`, `5 % 2`); glued
  `$(1+2)` / `$(5%2)` are NOT operations (that's Less — convert-Less spaces them
  out). `50%` glued = percent Dimension; `5 % 2` spaced = modulo. Bare ident
  inside `$()` = keyword literal; `$x` = reference.

## Core change made by this build
- `reference.ts` `writeSyntax` `case 'variable'`: a variable lookup WITH a target
  now renders `[key]` (was `.$key`, which is not a valid Jess form). Verified
  safe: no test relied on `.$key`; core reference 210/210 pass; the 5 less-parser
  failures are pre-existing on `dev` (confirmed by reverting this change).

## Macro-buildability (parseman)
- parseman is the LOCAL `~/git/oss/parser-thing` **0.15.0**, linked via root
  `pnpm.overrides` + a root devDep (npm's 0.14.0 is NOT used). `pnpm install` to
  apply; rebuild its dist (`cd ~/git/oss/parser-thing && pnpm build`) after editing.
- **Build guard**: `pnpm check:macro` (`scripts/check-macro-buildable.mjs`, wired
  into `ci`) builds all four parsers in dep order and FAILS if any emits an
  interpreter fallback (`_rp[N].parse` in the built bundle) or a compose/rules
  parseman warning. All four currently: 0 fallbacks.
- **"lower" vs `RegExp.exec`**: a regex *lowers* when it compiles to a tight
  `charCodeAt` scan; otherwise it falls back to `RegExp.exec` (still compiled — an
  accepted path, NOT a failure). parseman now warns (default on) on every
  un-lowered regex, showing the pattern; suppress with the plugin option
  `warnUnloweredRegex: false`. (~700 across the parsers — mostly lookahead /
  lookbehind / `i`-flag / escape-heavy patterns that can't scan.) The real
  regression signal is the interpreter fallback, which the guard covers.
- NEVER put a literal U+FFFF char in a grammar regex — write the `-￿`
  escape (Edit can't match the literal char; use perl/python to fix).

## Known quirks (serialized AST is correct; toString cosmetic)
- Space-separated value lists (`1px solid red`) round-trip via toString as
  `1pxsolidred` — inherited css-parser behavior; the serialized AST is clean.
- `$(1 > 2)` round-trips as `$((1 > 2))` — `Condition.toString` adds its own
  parens; serialized AST is correct.
