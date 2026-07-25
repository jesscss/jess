# Grammar unification plan: collapsing the CST/AST grammar split

Status: PLAN. Investigation complete, verdict settled by the owner.
Baseline SHA: `abe41f5bc41bf4227be4d478dae699a34a410cc4` (`origin/dev`, 2026-07-24).
Scope: `packages/{css,less,scss,jess}-parser/src/grammar.ts` and `.../src/ast/grammar.ts`.

## 1. Summary

Every dialect's syntax is specified twice — a CST grammar for the language service and
an AST grammar for the compiler — with no mechanical link between them. The owner has
ruled that this outcome is unacceptable regardless of how it was reached, and that the
route is: **point the language service at the AST route and delete the four CST
grammars.** This document is the migration plan, not the case for it.

The investigation turned up one thing that materially changes the plan's shape, and it
is worse than the framing that prompted it.

**The duplication is not 2×. It is 5 specifications of CSS.**

The four CST grammars form a real inheritance chain, so each is a small delta:

| | composes over | `= node(` boundaries |
|---|---|---|
| `css/src/grammar.ts` | — (base) | 46 |
| `less/src/grammar.ts` | `compose([cssGrammar, …])` (`less-parser/src/grammar.ts:38`) | 76 |
| `scss/src/grammar.ts` | `compose([lessGrammar, …])` (`scss-parser/src/grammar.ts:30`) | 65 |
| `jess/src/grammar.ts` | `compose([cssGrammar, …])` (`jess-parser/src/grammar.ts:40`) | 42 |

The four AST grammars do **not** inherit from each other. All four `composeLeaf` over
`cssAstSyntax` — the *recognition* layer in `@jesscss/internal-css-recognition`, which
contains **zero** `node()` boundaries and no CSS statement grammar at all
(`packages/internal-css-recognition/src/*.ts`, grep `node(` → 0 in all three files):

- `css-parser/src/ast/grammar.ts:659` — `composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules(…)])`
- `less-parser/src/ast/grammar.ts:1521` — `composeLeaf([cssAstSyntax, lessAstSyntax, cssAstPseudoSyntax, rules(…)])`
- `scss-parser/src/ast/grammar.ts:943` — `composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules(…)])`
- `jess-parser/src/ast/grammar.ts:1185` — `composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules(…)])`

Each therefore re-specifies the whole CSS statement/value/selector grammar from scratch.
The `Direct*` rule families are entirely disjoint — **less 243, scss 167, jess 171
distinct `Direct*` rules, css 0** (css uses a `CssAst*` family of 97 rules that the other
three do not import). That is exactly why the AST line counts dwarf the CST ones: less-AST
at 4,745 lines is not a delta over css-AST's 2,173, it is a restatement plus Less.

So the ledger is: one shared CST specification of CSS, plus four independent AST
specifications of CSS. Unifying CST-with-AST removes one axis of duplication; making the
AST grammars compose the way the CST grammars already do removes the larger one. **The
plan below does both, and the composition fix is sequenced first because it is where the
line-count and drift savings actually are.**

## 2. History

The split was accretion, not architecture. The commit messages record no design intent
for having two grammars — the AST route was introduced as a "pilot" and never converged.

| SHA | date | subject |
|---|---|---|
| `70aea77e5` | 2026-06-24 | `refactor(parseman): promote functional grammar as the real implementation` — creates `css/less` `src/grammar.ts` (the CST route) |
| `24047d409` | 2026-07-03 | `refactor(parseman): share functional parse driver and flatten scss/jess layout` — creates `scss/jess` `src/grammar.ts` |
| `4521665c4` | 2026-07-19 07:12 | `feat(css-parser): add direct AST pilot` — first AST grammar. Body is empty. |
| `6aecfc7b8` | 2026-07-19 07:46 | `feat(less-parser): add direct import AST facts` — body empty |
| `293444888` | 2026-07-19 08:44 | `refactor(css-parser): remove public AST pilot` — body empty; makes the AST root private |
| `9dd6eeb98` | 2026-07-19 | `refactor(less-parser): delete legacy parser entry` |
| `b69d8a17a` | 2026-07-19 13:02 | `feat(parsers): add private scss and jess ast roots` — body empty |

`70aea77e5` is the only one of these with a substantive message, and it is about
promoting the functional grammar over the Chevrotain class grammar — an unrelated
migration. The entire AST route landed in **under six hours on 2026-07-19** across four
commits with empty bodies. Nothing in the history states a reason for keeping the CST
grammars once the AST route existed; they were simply never removed.

The owner's recollection is consistent with this: a CST option per grammar was asked for
*if it was easy*. What shipped is four independent full grammars.

## 3. Consumer map

Verified by import tracing, not docblocks.

**The AST route** is the only public parse API. Each package's root entry exports
`parse(input): Stylesheet` built from `ast/grammar.js`; the `ast/` module itself is never
re-exported and appears in no `package.json` `exports` map.

| consumer | file:line | symbol |
|---|---|---|
| jess-plugin-less | `packages/jess-plugin-less/src/index.ts:32` | `parse as parseLess` |
| jess-plugin-css | `packages/jess-plugin-css/src/index.ts:8` | `parse` |
| jess-plugin-scss | `packages/jess-plugin-scss/src/index.ts:9` | `parse` |
| jess-plugin-jess | `packages/jess-plugin-jess/src/index.ts:8` | `parse` |
| jess CLI tests | `packages/jess/test/scss/bootstrap-corpus.test.ts:34`, `.../scss-construct-support.test.ts:16`, `.../jess/conversion-construct-support.test.ts:42` | `parse` |
| root shape test | `test/ast-shape/shape-stability.test.ts:5-7` | `parse` ×3 |

**The CST route** is public via `./cst` and `./grammar` subpaths in all four packages.
It has exactly one consumer outside the parser packages:

| consumer | file:line | symbol |
|---|---|---|
| language-service | `packages/language-service/src/engine.ts:1` | `parseCssDoc`, `CssCstNode`, `ParseDoc` |
| language-service | `engine.ts:4,5,6` | `parseLessDoc`, `parseScssDoc`, `parseJessDoc` |
| language-service | `cst-symbols.ts:22`, `cst-analysis.ts:16`, `cst-syntactic.ts:27`, `cst-lint.ts:18`, `color-utils.ts:2` | CST node types |

Confirmed **non**-consumers: `packages/core` (dependency runs the other way — all four AST
grammars import `@jesscss/core/ast`), `vscode`, `extension`, `style-resolver`, `patch-css`,
`config`, `fns`, `rollup-plugin-jess`, `jess-plugin-node-modules`. `language-service-tests`
contains only a README. `jess-plugin-less-compat` declares `@jesscss/less-parser` at
`package.json:36` with no source import — a dead dependency worth removing separately.

The two module graphs are fully independent: no file under any `src/ast/` imports
`src/grammar.ts` (the sole intra-package non-`ast/` import in any AST grammar is
`less-parser/src/ast/grammar.ts:8` → `../parse-error.js`, which is route-neutral).

So the migration has exactly **one** external consumer to satisfy: `packages/language-service`.

## 4. Target design

**One grammar per dialect, two outputs, selected at run time by the build host.**

parseman already implements this and documents it as the intended use.
`src/types.ts:224-229` describes `ctx.build` as the switch "so ONE grammar serves eval-AST
(unset) vs positioned-CST / language-service (set) modes." The routing is at
`src/combinators/node.ts:157-178`:

```js
const cstOutput = ctx.build?._parsemanCstOutput === true
… : build
    // A direct builder normally owns its result. The positioned-CST host is
    // the one exception: it must never receive an arbitrary AST object as a
    // child of a CST node, so build this grammar node through that host.
    ? cstOutput && ctx.build
      ? ctx.build(nodeType, children, fields, r.span, rawChildren, triviaLog, st)
      : build(children, fields, r.span, rawChildren, triviaLog, st)
```

with compiled parity at `src/compiler/codegen.ts:2987` and the flag set on the shipped
host at `src/compiler/linker.ts:127,133`. A node carrying an AST builder is therefore
*already* re-routed to a CST host when one is installed. Recognition and construction are
separate combinators; `run(entry, input, { build })` (`run.ts:30-32`) and
`parseDoc(…, { build })` (`functional/doc.ts:111-117`) both take the host.

**So the target is: keep the AST grammars, add node boundaries and spans, and run them
under `cstBuildHost` for the language service.** Nothing needs to be invented; the CST
becomes a projection of the one grammar rather than a second specification.

Two structural obstacles, both concrete:

**(a) The AST grammars have almost no node boundaries.** A CST host can only emit a node
where the grammar calls `node()`. Counts of `node(` in each AST grammar: **css 82, less 3,
scss 0, jess 0.** less/scss/jess build their AST from `field()` capture (less: 31 `field(`
calls) and rule-level reducers over `sequence`/`choice`, which leave no node boundary
behind. Run today under a CST host, less/scss/jess would produce a nearly structureless
tree. Adding boundaries is mechanical but it is the bulk of the per-dialect work.

**(b) The AST grammars do not compose** (§1). Fixing this is a prerequisite for (a) being
affordable — otherwise every node boundary must be added four times.

The alternative shape — deriving the CST from the AST by a post-pass — was considered and
rejected: the AST has no spans (§6) and no uniform `children`, so a post-pass has nothing
to derive positions from. The host-swap route gets spans from parseman's own `r.span`,
which is always correct by construction.

## 5. What parseman must grow

Ordered by whether they block the plan.

**P1 — Host-aware capture elision (blocking, silent-corruption class).**
`src/combinators/node.ts:100-107` decides whether to capture children, raw children and
trivia by scanning the *builder's formal arity*:

```js
const capturesTrivia = captureTrivia || trailingTrivia || (build ? buildReadsTrivia(def) : true)
```

`buildReadsTrivia`/`buildReadsRaw`/`buildReadsChildren`
(`src/compiler/build-arity.ts:63-96`) return `arity >= 5` / `>= 4` / `>= 1` for a node with
a direct builder. Nearly every AST builder is written `children => …` (arity 1), so
running an AST grammar under a CST host yields a CST with **no trivia and no raw
children, with no warning**. The elision must be computed against the host that will
actually run — force capture on whenever `_parsemanCstOutput` is set, or make the decision
a run-time branch rather than a compile-time one. This is the single change without which
the whole plan silently produces a lossy CST.

**P2 — Field capture under a CST host (blocking).**
`node.ts:107` gates field capture on `parserHasOwnFields(…) && buildReadsFields(def)`,
same arity mechanism. Since the AST grammars carry their semantics in `field()` (31 sites
in less alone), a CST host needs fields captured unconditionally. Mirror the existing
`_parsemanTriviaKinds` host hook (`types.ts:152`, consumed at `node.ts:136-137`) with a
host-declared field demand.

**P3 — Composable semantic builders (blocking for §4(b)).**
Direct builders are validated for static self-containment by
`directBuilderUnsupportedBindings` (`src/plugin/direct-builder-static.ts:8-11,92,99`) and
rejected on re-lower with `IR direct node builder for ${type} must be macro-static and
self-contained` (`src/compiler/ir-serialize.ts:138-141`); `composeLeaf` additionally
requires every pre-final piece to "prove recognition-only" (`src/plugin/index.ts:1102-1105`).
**This is the mechanical reason the AST grammars are terminal `composeLeaf` leaves that
cannot inherit from one another** — a grammar carrying builders cannot be a non-final
composition input. parseman needs either a per-rule semantic-reducer table carryable as
static IR across an artifact boundary, or a blessed "recognition IR + swappable reducer
map" packaging so `lessAstGrammar` can compose over `cssAstGrammar`.

**P4 — Analysis over composed grammars (blocking for verification, in flight).**
`analyzeGating` walks `Combinator` graphs via `p._def` (`src/analysis/gating.ts:241-244`),
but `compose()` returns `Record<string, FusedRule>` — bare functions with no `_def`
(`src/compiler/linker.ts:142-146,548`) — so it throws on every composed grammar. Worse,
`carriedRuleMaps` explicitly filters to IR pieces (`linker.ts:424-426`: "an opaque
precompiled artifact contributes no combinator graph, so it is simply skipped"). A fix is
in flight with another agent. **This plan leans on composition, so it needs the fixed
analyzer** — do not design around current behaviour, but do not assume the fix either:
step 0 below gates on it.

**P5 — Fail-the-build on macro fallback (non-blocking, strongly advised).**
`compose()` degrading to the runtime interpreter is only a `warn`
(`src/plugin/index.ts:1015,1027`), and jess has measured that a degraded build emits a
*different tree* (`docs/architecture/parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md:14-54`).
With one grammar serving both outputs, a silent fallback moves the compiler output and the
editor behaviour together. Today only the external `scripts/check-macro-buildable.mjs`
catches this.

**P6 — Version bump.** jess pins `parseman@0.32.0` (`package.json:35`). 0.32 lacks `peek`,
`oneOrMoreSep`, `analyzeGatingRules`, and options on `word`/`sepBy`. Source is at
`/Users/matthew/git/oss/parser-thing` (0.35) with a 0.36 worktree. Artifacts are
version-locked (`linker.ts:229-242`), so the bump is all-or-nothing and must precede the
rest.

**Not needed:** a grammar parameterised over an output mode. The macro compiler statically
evaluates the grammar source (`src/plugin/evaluator.ts:767-865` accepts only a
single-param factory whose body is `VariableDeclaration`s returning a plain object
literal), so `makeGrammar(mode)` is not macro-evaluable. Parameterisation must be at run
time via `ctx.build` — which is what the design above does.

## 6. What the language service actually requires

This is the migration's real spec. The language service consumes a far thinner slice of
the CST than the "lossless tree" docblocks (`cst-analysis.ts:124`, `cst-symbols.ts:20`)
suggest: **a `grammarType` label and a span on every node.** Every name, selector,
property and colour is recovered by `src.slice(start, end)` plus a regex over the original
document — never by concatenating leaf values. The "lossless" claim is unexercised.

### 6.1 Trivia is not the discriminator

Comments are **not** read from the CST at all. `cst-syntactic.ts:20-21` states comments are
trivia, and `:263-267` recovers them with `/\/\*[\s\S]*?\*\//g` over `doc.getText()`.
CST trivia is discarded by the build host before the tree is returned:
`css-parser/src/cst.ts:107-130` receives `_triviaLog` and drops it; children are filtered
to `'node' | 'leaf' | 'error'` (`cst.ts:99-105`).

The AST route preserves comments *better* — as real `Comment` nodes
(`packages/core/src/ast/nodes.ts:693`), members of both `ValueNode` (`:422`) and
`Statement` (`:909`) — though only in statement position (see §7).

Whitespace is not recoverable from the AST beyond `withValueLayout`
(`packages/core/src/ast/provenance.ts:55,61`), a per-value-array separator list. Measured on
realistic documents, exactly 1 object carried a `valueLayout` in css/less/scss and 0 in
jess. This does not matter: nothing in the language service reads whitespace. Formatting is
text-based — `engine.ts:1844-1861` runs `formatStyleSource(doc.getText())` and only
null-checks the tree.

**Verdict: trivia fidelity is not a blocker.** It looked like the discriminator and isn't.

### 6.2 Spans are the discriminator

The AST route records source positions in an out-of-band `WeakMap`
(`provenance.ts:8,25-46`, `withSourceSpan`/`sourceSpanOf`) and populates it at **12 sites
repo-wide**: `less-parser/src/ast/grammar.ts:1534,1610,2104,2126,2867` and
`jess-parser/src/ast/grammar.ts:645,652,678,686,1199`. Zero in css, zero in scss. Measured
node counts on real documents:

| dialect | typed AST nodes | with `sourceSpan` |
|---|---|---|
| css | 31 | 0 |
| less | 18 | 4 |
| scss | 18 | 0 |
| jess | 13 | 1 |

`nodes.ts:22-23` states the design intent — comments are carried structurally "so
byte-identity holds with **zero source-position tracking**." Every language-service feature
except the *shape* of `cstSelectionRanges` is span-driven.

The host-swap design solves this without touching AST node shapes: under `cstBuildHost`
the host receives parseman's own `r.span` for every node
(`node.ts:170-176`), so spans come from the CST projection, not from the AST nodes. **The
V8 shape-stability gate (`test/ast-shape/shape-stability.test.ts`) is therefore not
threatened** — no keys are added to any hot AST node. This is the main reason to prefer
host-swap over "add spans to the AST".

### 6.3 The `grammarType` inventory — the migration's acceptance spec

30 distinct strings, from `SELECTOR_TYPES`/`ATRULE_TYPES`/`MIXIN_TYPES`/`FUNC_TYPES`/`FOLD_TYPES`
(`cst-analysis.ts:90,91,95,97,197`), `VAR_REF`/`VAR_DECL`/`MIXIN_REF_TYPES`/`MIXIN_DEF_TYPES`
(`cst-symbols.ts:27,28,30,35`), `NUMBER_TYPES`/`NAMESPACE_KEYWORD_TYPES`/`SCSS_CALLABLE_TYPES`
(`cst-syntactic.ts:56,62,74`), `RULESET_TYPES` (`cst-lint.ts:75`), and inline comparisons at
`cst-analysis.ts:170,177,184`, `cst-syntactic.ts:107,112,133,226,228,235`,
`cst-lint.ts:144,156,165,204`, `color-utils.ts:229`, `engine.ts:1873`.

| CST `grammarType` | AST equivalent | note |
|---|---|---|
| `Ruleset` | `Rule` (`nodes.ts:743`) | rename |
| `SelectorList` | `SelectorList` (`nodes.ts:643`) | same |
| `ComplexSelector` | `ComplexSelector` (`nodes.ts:560`) | same |
| `CompoundSelector` | `CompoundSelector` (`nodes.ts:490`) | same |
| `BasicSelector` | `SimpleSelector` (`nodes.ts:458`) | rename; merges CST `AttributeSelector` and `&` |
| `InterpolatedSelector` | `SimpleSelector` with `interp !== null` (`nodes.ts:459-468`) | **merged away** — becomes a field test, not a type test |
| `AtRuleBlock` | `AtRuleBlock` (`at-rule.ts:35`) | same |
| `AtRuleStatement` | `AtRuleStatement` (`at-rule.ts:50`) | same |
| `QueryAtRuleBlock` | `AtRuleBlock` (`at-rule.ts:35`) | **merged** — recover via `.name` |
| `UnknownAtRuleBlock` | `OpaqueAtRuleBlock` (`at-rule.ts:63`) | rename; AST keeps `rawBody` bytes |
| `ImportAtRule` | `ImportAtRule` / `StyleImport` / `ModuleImport` (`at-rule.ts:71`, `nodes.ts:871,886`) | **split three ways** |
| `Declaration` | `Declaration` (`nodes.ts:656`) | same; also absorbs CST `CustomDeclaration` — a **fix**, see §7 |
| `VarDeclaration` | `VariableDeclaration` (`nodes.ts:681`) | rename; adds a structured `write` mode |
| `Reference` | `VariableReference` (`nodes.ts:146`) | **rename + collision trap**: AST *has* a `Reference` (`nodes.ts:393`) meaning a namespace/lookup chain. A naive port reads the wrong node. |
| `MixinCall` | `MixinCall` (`nodes.ts:813`) | same |
| `MixinOrQualifiedRule` | `MixinDef` / `Rule` / `MixinCall` | **migration win** — the CST's deliberate ambiguity, which `cst-analysis.ts:184` hacks around with a `raw.includes('{')` string test, is decided by the AST grammar |
| `Mixin` (jess) | `MixinDef` (`nodes.ts:784`) | rename |
| `ScssMixin` | `MixinDef` | rename; unifies with Less |
| `ScssInclude` | `MixinCall` | rename; unifies with Less |
| `ScssIf` | `If` (`nodes.ts:865`) | rename; AST folds the whole `@if`/`@else` chain into one node — 1 AST node = N CST nodes |
| `ScssUse` | `ModuleImport` \| `StyleImport` | union-typed on resolved target |
| `Quoted` | `Quoted` (`nodes.ts:65`) | same; pre-split `value`/`quote`/`escaped`, so `emitStringRegion`'s manual quote-stripping (`cst-syntactic.ts:174-207`) deletes |
| `Num` | `Dimension` with `unit === ''` (`nodes.ts:109`) | **merged**; `lint/zero-units` becomes a `unit !== ''` test — cleaner than today's regex |
| `Dimension` | `Dimension` (`nodes.ts:109`) | same; typed `number`+`unit` lets `cst-lint.ts:158`'s regex go |
| `Color` | `Color` (`nodes.ts:58`) | same; subsumes Less's separate `NamedColor` |
| `ScssFunction` | `VariableDeclaration` (`scss/ast/grammar.ts:1973-1979`) | **concept not preserved** — see §8 |
| `ScssReturn` | `Declaration` (`scss/ast/grammar.ts:1962-1963`) | **concept lost** — see §8 |
| `Func`, `FunctionDefinition`, `MixinDefinition` | — | **dead strings**: present in no CST grammar. Delete. |

Three further findings on the current allow-lists, all of which the migration fixes for free:

- `UnknownAtRuleBlock` and `BasicSelector` are **unreachable in less/scss** today (Less
  overrides `stylesheetBody`/`declarationList` at `:182`/`:509` and omits them). Dead branches.
- Six strings are SCSS-only (`Scss*`) with **no jess counterpart in any allow-list**, even
  though jess has the same features under different rule names (`Mixin`, `If`, `While`,
  `For`, `UseAtRule`, `ComposeAtRule` …). Jess control flow and module at-rules currently
  get no folding, no outline entry and no semantic token. The AST types are dialect-neutral,
  so this closes automatically.
- `ScssImportAtRule` (`scss-parser/src/grammar.ts:583`) diverges from Less/jess's
  `ImportAtRule` and is in no allow-list — a live bug: SCSS `@import` gets no namespace token.

## 7. Accept-set divergences

Empirically measured by running both routes over 158 real `.css/.less/.scss/.jess` files in
the tree plus ~120 targeted snippets. 157 of 158 real files agree. The disagreements below
are what migrating makes visible.

Making the editor as strict as the compiler is the correct direction — editor-vs-compiler
disagreement is the bug class being fixed — but each case should be a decision, not a
discovery.

**Must fix on the AST side before the dialect can land** (valid source that would light up
red in the editor):

| snippet | dialect | CST | AST |
|---|---|---|---|
| `a { b: /* c */ red; }` | scss, jess | accept | **reject** |
| `a /* c */ b { c: d; }` | scss, jess | accept | **reject** |
| `@media /* c */ screen { … }` | css, jess | accept | **reject** |
| `@media #{$q} { … }` | scss | accept | **reject** |
| `@media screen and #{$q} { … }` | scss | accept | **reject** |
| `@supports #{$q} { … }` | scss | accept | **reject** |
| `@while $i > 0 { … }` | scss | accept | **reject** |

The comment cases are the same underlying defect — comments are legal wherever whitespace
is, and the AST grammars only admit them in statement position. Measured comment retention
by position: top-level and inside-a-ruleset are preserved in all four dialects; value
position works only in Less; selector position and at-rule-prelude position are lost or
hard-fail everywhere; `//` line comments are dropped in all three dialects that have them.
`@while` is simply absent from the SCSS AST grammar.

**Correct to tighten** (CST over-accepts what the compiler refuses):

| snippet | dialect | note |
|---|---|---|
| `@media $[m] { … }`, `@container $[m] { … }` | jess | `$[…]` is a value form; CST scans the prelude as opaque text |
| `@{m[$$k]}`, `@{m[@]}`, `@{m[$]}`, `@{m[9x]}`, `@{m[@k$p]}` | less | `interpAccessorKey` is a flat class at `less-parser/src/grammar.ts:106` (`/[-_a-zA-Z0-9@$-￿]+/`); the AST models typed keys with `keyKind: 'var'\|'prop'\|'index'` (`less-parser/src/ast/grammar.ts:12`, built `:1549-1593`). Five spellings the compiler rejects are accepted by the editor today. |
| `@{x}: 1;` at top level; bare `color: red;` at top level | less | AST is over-lenient here, not the CST — fix the AST |

**Genuine editor leniency worth a decision, not an automatic tightening:**

- `a { width: (1 + 2); }` — CST accepts (`css-parser/src/grammar.ts:719`, `Paren`, with the
  docblock at `:271,280-283` contrasting it with the folding `calcParen`). The AST route is
  **inconsistent across dialects**: less and scss accept it, css and jess reject it. A `(…)`
  simple block is legal CSS value syntax. Resolve the inconsistency in the AST grammars
  before migrating, in favour of accepting.

**Two things the migration fixes for free:**

- `DeferredScalarDeclaration` — reported as dead. It is unreferenced (two sites, both in
  `less-parser/src/grammar.ts:531,544`, zero tests, zero LS references) but **not inert**:
  it is the first arm of `Declaration` (`:543-546`), so it fires on the commonest
  declaration shape and flattens the value to leaves. Consequence, measured:
  `.a { margin: 0px; }` produces **no** `Dimension` node while `.a { margin: 0px 0px; }`
  does. Since `cst-lint.ts:156` keys `zeroUnits` on `Dimension` and `cst-syntactic.ts:56`
  keys the number token on `Num|Dimension|Color`, **`margin: 0px;` silently gets no
  zero-unit warning and no number token today.** Deleting the CST removes this.
- `CustomDeclaration` is a separate `grammarType` in all four CST grammars
  (`css:245`, `less:603`, `scss:231`) and is read by nothing — so `--x: red` gets no colour
  swatch and no duplicate/hex lint. The AST merges it into `Declaration`, closing the gap.

**One bug to file regardless of this plan:** `packages/css-parser/src/ast/grammar.ts:396`
(also `:412,432,447`) throws a bare `Error('CSS AST value grammar lost its value child')`
rather than a `CssParseError` on input like `a { width: (); }`. Any caller catching
`CssParseError` crashes instead of reporting a diagnostic.

`${…}` interpolation, cited as a drift example, is **no longer missing** from the CST —
`less-parser/src/grammar.ts:113-116` (`lessPropertyInterp`) and
`jess-parser/src/grammar.ts:88-93` (`DollarBrace`) both have it, and both routes now accept
`.a { color: ${color}; }`. It appears to have been closed recently. The point stands as a
motivating incident; it is not outstanding work.

## 8. What is lost

Honest accounting. Three real losses, all in SCSS, all from the AST grammar lowering
constructs rather than modelling them:

1. **`@function` identity.** `DirectScssFunction` is typed `Combinator<VariableDeclaration>`
   (`scss-parser/src/ast/grammar.ts:51`, built `:1973-1979`) — `@function foo(…)` lowers to
   a variable binding an anonymous callable, *not* a `MixinDef`. The language service today
   treats `ScssFunction` as a mixin definition (`cst-symbols.ts:35`) and as a foldable
   "Function" outline symbol (`cst-analysis.ts:97`). After migration it is
   indistinguishable from an ordinary `$var: …` unless the bound value is inspected.
   Mitigation: inspect the bound value, or have the AST grammar tag the declaration.
2. **`@return` identity.** `DirectScssReturn` is `Combinator<Declaration>`
   (`scss-parser/src/ast/grammar.ts:50`, built `:1962-1963`) — a synthetic `result` decl.
   The `namespace` semantic token currently emitted for `@return`
   (`cst-syntactic.ts:62`) has no AST source. Small, cosmetic.
3. **`@if` granularity.** AST `If` (`nodes.ts:865`) folds `@if`/`@else if`/`@else` into one
   node with `branches: IfBranch[]`; the CST has one node per clause. Folding ranges lose
   per-clause granularity unless branch spans are recorded.

`%placeholder` rulesets are a fourth case but a pre-existing gap, not a loss:
`ScssPlaceholderRuleset` (`scss-parser/src/grammar.ts:734`) is not `Ruleset`, so
`%foo { … }` is already absent from the outline, folding and `lint/empty-rules`. The AST
route can only improve this.

Nothing is lost on trivia, error recovery (supported on both routes by design), or
lossless round-tripping (never exercised).

**One open risk that is not a "loss" but must not be assumed away:** the language service
is built on the incremental `ParseDoc` with `.edit()` (`engine.ts:74-84,761-767`, with a
counted full-rebuild fallback visible via `_debugState` at `:581,1069`). `parseDoc` requires
`NodeLike` — `{ _tag, type, span, state, children }` (`parseman/cst/types.d.ts:11-19`).
The host-swap design satisfies this **because the CST host emits `NodeLike` nodes**, not AST
nodes, so incrementality is preserved unchanged. This is the second reason to prefer
host-swap over retrofitting spans onto AST nodes: the latter would also have to retrofit
`_tag`/`state`/uniform `children` onto every hot node, which the shape-stability gate exists
to prevent. **Step 3 below must prove this empirically rather than on the reading above.**

## 9. Migration path

Ordered smallest-and-least-coupled first, as directed: jess → scss → css → less. Each
dialect is independently landable and independently revertable.

**Step 0 — prerequisites (no dialect moves).**
- Bump parseman 0.32 → ≥0.35 and re-verify the macro-fallback finding on the new pin;
  artifacts are version-locked so this is all-or-nothing (`linker.ts:229-242`).
- Land parseman **P1** (host-aware capture elision) and **P2** (field capture under a CST
  host). Without P1 every subsequent step produces a silently lossy CST.
- Take delivery of the in-flight `analyzeGating`-over-`compose()` fix (**P4**) and confirm it
  handles the opaque-artifact hole (`linker.ts:424-426`), since all four grammars are built
  from pre-compiled artifacts.
- *Breaks:* nothing in jess; parseman's own test suite is the gate.

**Step 1 — behavioural capture harness (no production change).**
Extend the byte-identity oracle (`packages/less-parser/test/ast-identity-oracle.mjs`, 707
files) into a **language-service** oracle: for every file in the corpus, record the full
answer to every LS query type — document symbols, folding ranges, selection ranges,
semantic tokens, definition, references, rename, all six lint rules, document colours — via
the current CST route, keyed by dialect. This snapshot is the acceptance gate for every
later step. A dialect does not land until its answers match.
- *Breaks:* nothing. This step is pure insurance and should not be skipped.

**Step 2 — make the AST grammars compose (the big win, §1).**
Requires parseman **P3**. Restructure so `lessAstGrammar`/`scssAstGrammar`/`jessAstGrammar`
compose over `cssAstGrammar` instead of each restating CSS over `cssAstSyntax`. Target: the
243/167/171 `Direct*` rules collapse toward genuine deltas.
- *Breaks:* this is the highest-risk step and touches the compiler, not the editor. Gate on
  the existing byte-identity oracle across all 707 files plus the jess ratchet. It is
  sequenced before the LS migration deliberately — doing it after would mean adding node
  boundaries four times.
- *Fallback:* if P3 proves harder than expected, steps 3-6 can proceed without step 2 at
  the cost of doing the boundary work per dialect. Do not let step 2 block the LS
  migration indefinitely; re-sequence it after step 6 if it stalls.

**Step 3 — jess (CST 575 lines).**
Add `node('…')` boundaries to `jess-parser/src/ast/grammar.ts` at the rule sites
corresponding to the §6.3 inventory (jess currently has **0**). Add a `parseJessDoc`
equivalent on the AST route that runs `jessAstGrammar` under `cstBuildHost` via
`parseDoc(…, { build })`. Add a `grammarType` translation layer in the language service
covering the renames/merges/splits in §6.3 — in particular the `Reference` collision and
the `InterpolatedSelector`→field-test and `Num`→`unit === ''` conversions. Fix the jess
accept-set rows in §7 (comment-in-value, comment-in-selector, comment-in-prelude, `$[…]`
preludes, `(1 + 2)`).
- *Breaks:* jess editor support only. Smallest blast radius, and jess currently has the
  *worst* LS coverage (no allow-list entry for any jess control-flow or module at-rule), so
  this step is a net feature gain even before the CST is deleted.
- *Gate:* step-1 snapshot equivalence for jess + `packages/jess/test/jess/*`.

**Step 4 — scss (CST 844 lines).**
Same shape. scss additionally needs: `@while` added to the AST grammar, `#{}` at-rule
preludes (`DirectScssStaticMediaPrelude` is static-only), and decisions on the three §8
losses (`@function`, `@return`, `@if` granularity). Fold `ScssImportAtRule` into the shared
`ImportAtRule` handling, fixing the live bug.
- *Breaks:* SCSS editor support; the three §8 identity losses land here. If `@function`
  tagging is not resolved, SCSS outline/rename regresses for `@function` — that is the one
  place this plan visibly costs a user something.
- *Gate:* step-1 snapshot for scss + `packages/jess/test/scss/bootstrap-corpus.test.ts`.

**Step 5 — css (CST 800 lines).**
Cheapest of the four: `css-parser/src/ast/grammar.ts` already has 82 named node boundaries.
Mostly a naming reconciliation (`CssAst*` rule names → the LS's expected labels) plus the
comment-in-prelude fix and the bare-`Error` bug at `:396`.
- *Breaks:* CSS editor support. Lowest risk.
- *Gate:* step-1 snapshot for css.

**Step 6 — less (CST 1,209 lines).**
Last, as directed: largest and most consumed. Needs the most node boundaries (3 today
against 76 in its CST) and carries the `interpAccessorKey` tightening, which is a
deliberate user-visible strictness increase. Also fix the two AST over-leniencies
(top-level `@{x}: 1;` and top-level bare declarations).
- *Breaks:* Less editor support, and the `interpAccessorKey` tightening will surface as new
  editor errors on documents that previously looked clean — correctly, since the compiler
  already rejects them. Worth a release note.
- *Gate:* step-1 snapshot for less + the full 707-file byte-identity oracle.

**Step 7 — deletion.**
Remove `packages/{css,less,scss,jess}-parser/src/grammar.ts` and `src/cst*.ts`, the `./cst`
and `./grammar` package exports, the tsdown entries, and the CST-only tests. Update the
`vitest.config.ts:51-53` and `vitest.less-test-data.config.ts:133` aliases. Retire the
three dead LS strings (`Func`, `FunctionDefinition`, `MixinDefinition`) and the dead
`@jesscss/less-parser` dependency in `jess-plugin-less-compat/package.json:36`.
- *Breaks:* any external consumer of the `./cst` or `./grammar` subpaths. There are none in
  this repo; these are published subpaths, so check the release surface.

## 10. Verification

- **Per dialect:** the step-1 language-service snapshot must match exactly, for every query
  type, over the shared corpus. A dialect does not land until it does.
- **Compiler side:** the existing byte-identity oracle
  (`packages/less-parser/test/ast-identity-oracle.mjs`) over 707 files must stay green
  through every step — it is the only thing standing between step 2 and a silent semantic
  regression.
- **Accept-set:** the §7 table becomes a checked-in differential test while both routes
  coexist, and converts to a plain conformance test at step 7.
- **Macro integrity:** `scripts/check-macro-buildable.mjs` must stay green, and P5 should
  make fallback a build failure rather than a warning before step 2.

## 11. Open items

- Step 2 depends on parseman P3, which is the least-specified change here. If a per-rule
  reducer table carryable across artifact boundaries proves impractical, the fallback is to
  merge the four AST grammars into one physical file per composition root, which gets the
  deduplication without the parseman work but loses package boundaries.
- The `@function`/`@return` losses (§8) need an owner decision: tag them in the AST grammar
  (cheap, slightly impure) or accept the outline regression.
- The bare-`Error` at `css-parser/src/ast/grammar.ts:396` should be fixed independently of
  this plan.
