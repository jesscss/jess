# Less fold hotspot report

Sidecar audit date: 2026-07-26.

Scope: `packages/syntax/less/less-parser/src/grammar.ts`. This report records
the remaining quality cleanup after the Less grammar collapsed to one host-mode
source.

Current parity note: Less now ships from the direct host-mode grammar. The old
CST bridge body has been deleted from `src/grammar.ts`, `lessGrammar` is the
default artifact, and `lessCstGrammar` is the explicit host-mode CST artifact.
The public CST oracle movement is intentional fold movement; a later
strict CSS calc follow-up also moved the two invalid CSS calc error fixtures so
`calc()` / `calc(+)` reject at recognition rather than falling back to a generic
function. The committed oracle baseline now pins both named movements:
`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929`
with 120 throws and
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`
with 0 throws over 709 entries.

The physical fold is done. In this report, "fold" now means deleting remaining
duplicate private recognition families inside the single host-mode
`src/grammar.ts`, not restoring a CST bridge or recreating a second grammar
file. Use the active Parseman 0.43 surface (`dispatch(...)`, `makeWhen(...)`,
matcher cases, `routed()`, and `node(..., { project })`) where it removes
repeated recognition.

## Performance checkpoint

2026-07-28 Bootstrap-port parse-only measurements keep the fold direction but
open a real parser-performance lane. The pre-fold `52db1e072` checkout, rebuilt
in dependency order, parsed all 90 `bootstrap-less-port` files successfully
over the same 233.4 KB corpus at about 20-22 ms AST / 15-16 ms CST. Current
`dev` also parses all 90 files successfully, but measures about 36-42 ms AST /
33-37 ms CST depending on warmup/sample shape. Treat the old number as a
diagnostic baseline, not a rollback target: alpha remains acceptable, and the
single host-mode grammar stays the architecture.

The next performance work should press forward on the folded grammar:

- isolate raw Parseman `run(...)` time from parser-package AST trivia attachment
  and `createTriviaMapFromParseman(...)`;
- review whether host-mode CST/trivia ownership is leaking cost into AST-mode
  parse;
- keep replacing same-opener backtracking with `dispatch(...)` / `routed()`
  only where it removes repeated recognition;
- use first-set/gating output to prioritize broad nullable choices in
  ruleset/declaration/value/function/selector paths;
- compare Bootstrap full render separately from parser-only work. Current full
  render is slower than Less 4.x but still alpha-acceptable; render/import/eval
  hotspots are a parallel core/compiler lane, not a reason to undo the grammar
  fold.

Sidecar investigations tightened that target:

- The folded Less final AST size is roughly unchanged from the pre-fold
  baseline, but the public CST and generated host-mode artifact are much larger.
  The likely parser lane is successful intermediate grammar/CST volume in value,
  selector/extend, and declaration wrappers, plus Parseman host-mode packaging,
  not a rollback to two physical grammars.
- A quick `collapse: true` prototype on `Value`, `TopSumMaybeDivision`,
  `ValueList`, and `ValueListWithPriority` passed focused parser tests but made
  Bootstrap-port parse slower. Treat blanket wrapper collapse as rejected
  evidence; remove work at the grammar/Parseman lowering level instead of merely
  hiding CST frames.
- Parseman has a candidate dispatch aggregate-value elision patch on
  `release/0.41.1-dispatch-elision`. Once published, regenerate and remeasure
  before attributing remaining cost to Jess grammar shape.

Parallel core/compiler lane:

- Current `Compiler.compile()` prepares only the root document. Bootstrap's first
  prepared-import slice now returns a reusable static import plan. A render that
  receives that plan avoids `Context.loadImport(...)` / `Context.getTree(...)`
  calls for prepared imports, while later renders can still reuse parsed
  documents from the same `Context`.
- A context-local `loadImport(...)` memo now avoids re-resolving an already
  loaded static import on repeated renders of the same compiled document. That
  is useful session caching, not the Less alpha one-shot render fix.
- The larger first-render target is to remove the remaining duplicate planner
  work after compile-time preparation, while still respecting Less import
  options and deferring dynamic import targets that require render-time
  bindings.

## Comment-as-trivia debt audit

Current decision: comments are trivia. Do not preserve grammar-level `Comment`
nodes, value-comment leaves, or repeated `many(blockComment)` plumbing as the
target architecture. Scanner-local comment skip sets are allowed only to keep
balanced or `scanTo(...)` recognition from terminating inside comments; skipped
comments should not become semantic value text.

Priority Less cleanup queue:

1. **Custom-property comment parts are true semantic debt.**
   `CustomInnerPart` / `CustomPart` admit `blockComment` as
   `CustomValuePart` and reduce it into custom-value text. Custom properties may
   need permissive token structure, but comments still belong to trivia.
2. **Opaque at-rule prelude comment capture is likely semantic debt.**
   `atPreludeComment` still participates in `lessOpaqueAtPreludeCapture`.
   Unknown at-rules can opportunistically parse structure, but comments should
   not be assembled into semantic prelude text.
3. **General-enclosed raw comments are likely semantic debt.**
   `GeneralEnclosedRaw` includes `g.BlockCommentToken` as raw text; preserve
   balanced recognition, but do not make comments part of interpolation or
   general-enclosed payloads.

Completed in the current grammar: declaration-head gaps now flow through
`DeclarationHead` parser trivia instead of semantic declaration-name bytes. Do
not reintroduce a declaration-head comment fact.

Mostly legitimate exceptions:

- `packages/parser-shared/src/recognition.ts` exports comment terminals. They
  are neutral until a dialect consumes them as semantic children or text.
- `packages/parser-shared/src/opaque-at-rule.ts` uses comments in
  `balanced(...)` / `scanTo(...)` skip sets. That is scanner-local protection,
  not a reason for parser grammars to emit comment nodes.
- Less trivia replay helpers are closer to the target than AST comment nodes,
  but parser-local comment text querying should eventually collapse into the
  shared source/document trivia path.

Most recent completed slice: **ordinary value comments and Less trivia transfer
hardening**. `ValueComment` is gone from the current grammar; ordinary value and
function-boundary comments flow through Parseman's trivia log and core's
`createTriviaMapFromParseman(...)` adapter. Unsupported legacy Less variable
names are also CST-recoverable again because the unsupported-name diagnostic is
owned by AST host-mode reduction, not CST recognition.

Smallest next implementation slice: **custom-property comment carriers**. Remove
custom-property `blockComment` semantic parts only with matching source-trivia
replay, because custom values still need permissive token structure and
byte-faithful serialization.

Proof for that slice:

- focused Less parser facts:
  `pnpm --filter @jesscss/less-parser test -- ast-grammar.test.ts --run --testNamePattern "value comments|comment.*value|function.*comment|custom-property"`
- public custom-property contract:
  `pnpm --filter @jesscss/less-parser test -- custom-property.test.ts --run`
- alpha render lane:
  `pnpm run verify:less-alpha`
- oracle movement, named before any baseline update:
  `pnpm run oracle:less:byte-identity`

## Recommended cleanup order

1. **Comment trivia debt.** Remove semantic comment carriers from custom
   property values, opaque at-rule preludes, and general-enclosed raw payloads.
   Keep scanner-local comment skip sets only where balanced recognition needs
   them.
2. **Selector plus inline `:extend()` simplification.** Preserve the current
   one-pass selector route: each branch parses once, `ExtendPseudo` owns the
   authored pseudo, and reducers collect branch-local extend facts. Do not add
   source reparse or a second selector grammar.
3. **At-rule/query/import/keyframes routing.** Use Parseman `dispatch(...)`
   where a routed same-family opener has already been consumed. Keep CSS
   placement rules and Less deviations explicit; `@charset`, `@namespace`,
   `@import`, `@supports`, media/container, and keyframes do not share one
   acceptance rule.
4. **Value/function/math/argument spine.** Continue shrinking the value stack
   around glued openers and math/division boundaries. Function openers such as
   `url(`, `calc(`, and `%(` should route through one consumed opener, not
   keyword/function backtracking.
5. **Less variable/mixin/reference/declaration family.** Keep this
   Less-specific; do not preserve it for SCSS. The dangerous boundaries are
   `@name:` versus at-rule, `@name(...)` variable call versus at-rule,
   mixin/ruleset ambiguity, guards, `default()`, and namespace/reference
   accessors.

## Naming cleanup rule for the fold

Old direct-AST migration prefixes were scaffolding, not grammar vocabulary. Do
not reintroduce that namespace. Local const names should be the shortest stable
spec-shaped concept unless the accepted language genuinely differs. Preserve or
map public CST labels separately: `Declaration`, `CustomDeclaration`,
`AtRuleBlock`, `AtRuleStatement`, `ImportAtRule`, `QueryAtRuleBlock`,
`MixinCall`, `MixinDefinition`, `VarCall`, selector node keys, and
interpolation node keys are contract questions; local rule names are not.

Preferred local vocabulary by region:

- References/interpolation: `VarReference`, `Reference`, `PropReference`,
  `VariableInterpolation`, `PropertyInterpolation`, `Interpolation`,
  `AtRuleInterpolation`, `ReferenceTail`, `MixinPathTail`.
- Values/functions: `Keyword`, `IdentOrFunction`, `Value`, `ValueSequence`,
  `ValueList`, `TypedValue`, `VariableValue`, `ValueWithOptionalPriority`.
  Do not use `ComponentValue` as a namespace for adjacent value helpers.
- Declarations/custom values: `CustomPropertyName`, `CustomPart`,
  `CustomInnerPart`, `CustomValue`, `CustomDeclaration`, `Declaration`,
  `PunctuationMapEntry` or another name that states the real Less construct.
- Mixins/guards: `MixinParam`, `MixinParameterList`, `MixinArguments`,
  `MixinCall`, `BareMixinCall`, `FlatMixinCall`, `NamespacedMixinCall`,
  `NamespacedMixinValue`, `MixinGuard*`, `MixinDefinition` or the actual folded
  ambiguity owner.
- At-rules/queries: `SupportsValue`, `SupportsFeature`, `SupportsCondition`,
  `QueryValue`, `QueryFeature*`, `MediaQuery*`, `Container*`, `AtRuleBlock`,
  `AtRuleStatement`.
- Selectors/extents: `PseudoSelector`, `AttributeSelector`, `AttributeName`,
  `AttributeMatch`, `NamespaceTypeSelector`, `InterpolatedAttributeSelector`,
  `CompoundSelector`, `ComplexSelector`, `SelectorList`, `ExtendTarget`,
  `InlineExtendTail`, `SelectorBranch`, `Ruleset`. A static spelling belongs in
  the ordinary semantic owner; keep an interpolation-specific rule only when
  it must construct a different interpolation-backed selector atom. If the
  inline-extend subject and extend target really differ, name the context
  (`InlineExtendSubject`, `ExtendTarget`), not the migration path.

## Parseman 0.43 routing targets

Apply these while folding each family, not as polish on duplicate bodies:

- At-statement router: consume the `@` keyword once, then dispatch to import,
  plugin, supports/media/container/keyframes, namespace/charset/layer, or a
  routed generic/variable tail. The generic statement tail must keep semicolon
  ownership explicit.
- Pseudo router: consume the pseudo or pseudo-function opener once, then route
  `:extend(`, An+B pseudos, generic functional pseudos, and bare pseudos. Branch
  nodes should use `routed()` so the opener belongs to the same public CST/AST
  owner as its tail.
- Selector list with inline extends: the ruleset fallback is paid. Preserve the
  context-aware selector-list route that parses each branch once, returns
  selector facts, and collects branch-local extend instructions.
- Mixin statement router: the broad `mixinStatementAhead` scan has been
  replaced by one typed class/id selector prefix and literal-led tails. The
  prefix remains selector structure for rulesets and lowers to a namespace path
  only for `(`/`;` mixin continuations. A narrow definition-versus-call attempt
  remains after `(` because the current parameter and argument grammars differ;
  it is a measurable reduction target, not permission to collapse one grammar
  into the other. Do not reintroduce a prefix scan or a second selector parse.
- Query feature parentheses: CSS/Less media features are a real left-factor or
  context-helper target, not an automatic dispatch target. The same inner
  identifier can begin colon, comparison, range, grouped, and negated features,
  but a safe rewrite must share the opener while preserving the public CST
  owners for each feature family.
- Import media: route valid media-query tails through the same structured media
  grammar before any broad static-tail fallback.

## Historical first implementation slice

The old ordinary braced-block statement-spine slice is paid. Less now has one
host-mode grammar source, and the surviving statement families are
`blockItem`, `BodyStatement`, `RulesetWithExtends`, and root `Stylesheet`.
Their ordered choices still differ by context and should stay explicit unless a
future patch proves the accept sets remain distinct.

Recognition source of truth: the ordinary block choice owns the intended Less
disambiguation gates: `atStatement`, the mixin/ruleset gate, the
declaration-vs-ruleset gate, and ruleset-only extend body handling. The current
`blockItem` remains the public block concept name.

Target shape:

- `blockItem` is the surviving public concept and host-mode rule.
- `blockBody = many(blockItem)` is used by ordinary mixin definitions,
  supports/media/container/generic at-rule bodies, and other ordinary braced
  Less bodies.
- `rulesetBody = many(choice(blockItem, ExtendStatement))` stays
  context-specific for rulesets.
- AST reducers live on the unified public rules; CST mode keeps public
  positioned node names via the build host.

Abort the slice if it starts changing detached/callback acceptance, folding
selector `:extend(...)`, merging at-rule headers/import/keyframes, preserving
Less hooks for SCSS inheritance, introducing a broad generic statement-list
abstraction, or moving either byte-identity aggregate.

## Selector reparse paths

The current Less selector path parses inline extend as a selector-owned
terminator in the single host-mode grammar:

- `extendAhead` / `selectorBoundary` stop ordinary selector runs before
  `:extend(`.
- `ExtendComplex`, `ExtendTargetComplex`, and `ExtendTarget` keep inline
  subjects and extend targets distinct from ordinary selector recognition.
- `ExtendPseudo` parses `:extend(...)` as grammar structure.
- `selectorListWithExtends` collects branch-local extend instructions and the
  selector list in one fact.
- `ExtendStatement` handles the ruleset-body `&:extend(...)` form.
- `RulesetWithExtends` enters ruleset selectors through
  `selectorListWithExtends` once.

Requirement: selector parsing must collect branch-local extend facts while
parsing each selector branch once. The current route is the floor: no broad
fallback, no AST-only selector side channel, and no selector source reparse.

Current hotspots to delete or contain during cleanup:

- `selectorListWithExtends` still sits beside the public selector-list family
  instead of being a context-aware projection of the same recognition.
- `ExtendComplex`, `ExtendTargetComplex`, and their `*Tail` / `*Compound`
  helpers duplicate selector-family structure to stop before flags and inline
  `:extend(...)`. These are context differences, not separate grammars; fold
  them only through a selector-list helper that receives context.
- The local regex lookaheads `selectorBoundary`, `extendTailAhead`, and the
  duplicated terminal-flag regexes are allowed only as temporary evidence of
  boundaries. The surviving grammar should prefer Parseman words, routed pseudo
  openers, and a small context parameter over broad regular-expression guards.

Existing tests that must stay green:

- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:992`
  ("constructs static body and inline extends with exact/all multi-target
  semantics")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:1030`
  ("keeps inline extend branch ownership aligned across AST and CST host modes")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:1065`
  ("keeps a repeated inline extend selector list as branch-owned instructions")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:1040`
  ("stops direct extend targets before terminal all and !all flags")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:1060`
  ("uses the ordinary direct statement body inside an inline extend rule")
- `packages/syntax/less/less-parser/test/public-parse.test.ts:1327`
  ("attaches inline extend only to its later comma sibling and lowers !all as
  partial")
- `packages/syntax/less/less-parser/test/public-parse.test.ts:1340`
  ("plans a later inline extend for only its attached selector")

Already pinned in the AST suite: the host-mode parity test for
`.first, .inline:extend(.target all), .sibling { color: red; }` asserts AST
branch ownership and one public CST `ExtendPseudo` owner.

## SCSS-only support seams in Less

These are Less grammar shapes that exist, or recently existed, for the
SCSS-on-Less inheritance path rather than for Less syntax:

- `strInterp = lessInterp` is now documented as a Less-local spelling helper for
  string interpolation. The old comment that invited dialect interpolation-body
  injection has been removed (`grammar.ts:157-166`).
- Already cut in this orchestration checkout: `stylesheetItem`, `blockItem`,
  `basicSel`, and `extendAhead` are no longer returned from Less's public CST
  rule map as SCSS hooks. `Stylesheet`, `declarationList`, and at-rule bodies now
  reference Less-local statement choices directly.
- Also cut in this checkout: the old `customValue` hook has been removed from
  Less. SCSS now owns its custom-property and interpolation surfaces in its own
  host-mode grammar instead of reaching through Less-private hooks.
- SCSS no longer imports or composes on `lessGrammar`; `check:macro` and
  `verify:compose-integrity` pass with SCSS as a sibling grammar. The remaining
  SCSS/Less separation cleanup is narrower: remove explicit Less compatibility
  syntax that was copied into SCSS. SCSS now rejects Less-style
  `@import (css, once)` options, Less rule-body mixin calls, Less inline
  `&:extend(...)` rule-body statements, and Less declaration merge modifiers
  (`font+:` / `font+_:`), with public CST and direct AST rejection tests pinning
  the boundary.

Recommended handling: delete or internalize these during the Less fold whenever
the Less parser's own CST/AST/language-service contracts do not require them.
If SCSS turns red, treat that as evidence for the SCSS sibling rebase, not as a
reason to keep Less broad.

Current SCSS proof:

- `packages/syntax/scss/scss-parser/test/compose-integrity.test.ts` imports the
  public grammar, asserts no missing-rule/runtime-fallback compose diagnostics,
  asserts representative Less-only rules are absent from SCSS's rule map, and
  rejects Less-only declaration/rule-body constructs through both public CST and
  direct AST routes.
- `packages/syntax/scss/scss-parser/test/ast-grammar.test.ts` and
  `packages/syntax/scss/scss-parser/test/public-parse.test.ts` pin Less import
  options and declaration merge modifiers as SCSS parse failures.

## First fold blockers

1. Selector and inline-extend ownership

Current state: Less is already on one host-mode grammar, and ruleset headers
enter the inline-extend-aware route once via `selectorListWithExtends`.
`ExtendPseudo` owns the authored pseudo and selector branches collect
branch-local extend facts during the selector parse. Do not reintroduce a
second selector grammar, selector source reparse, or broad fallback around
ruleset headers.

Pin with the existing inline extend AST/public tests listed above.

2. Statement container ownership

Current state: `blockItem`, `BodyStatement`, `RulesetWithExtends`, and root
`Stylesheet` all live in the same host-mode grammar, but their ordered arm sets
still intentionally differ. `BodyStatement` carries the punctuation-map arm and
callback/detached-ruleset ordering; `blockItem` owns ordinary braced block
contexts. Do not collapse these through a generic helper unless the patch proves
the context accept sets stay distinct.

Pin with:

- `packages/syntax/less/less-parser/test/cst-public.test.ts:251`
  ("Less direct-AST closure CST contract")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:1060`
  ("uses the ordinary direct statement body inside an inline extend rule")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:1177`
  ("keeps standalone extend statements out of direct detached and callback bodies
  until they have a statement fact")
- `packages/syntax/less/less-parser/test/public-parse.test.ts:1384`
  ("evaluates canonical statement bodies inside an inline extend rule through
  public parse")
- `packages/syntax/less/less-parser/test/public-parse.test.ts:1462`
  ("keeps terminal and at-rule-body function calls on the public Less route")

Add when unified: one test that the same host-mode statement list accepts
ruleset bodies, at-rule bodies, detached ruleset bodies, and `each()` callback
bodies without a CST-only or AST-only fallback.

3. Selector simple/pseudo/interpolation ownership

Current state: Less selector recognition now lives in one grammar, but it still
has several context-specific helper families for pseudo routing, interpolation,
inline extend subjects, and extend targets.

Pin with:

- `packages/syntax/less/less-parser/test/cst-public.test.ts:238`
  ("Less selector interpolation CST facts")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:4044`
  ("keeps malformed, whitespace-split, and extend selector interpolation out of
  the direct route")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:4228`
  ("structures whitelisted selector-function pseudos while interpolated and
  :extend forms stay opaque")
- `packages/syntax/less/less-parser/test/ast-grammar.test.ts:4448`
  ("rejects non-selector and interpolation-bearing functional pseudo arguments
  without a raw fallback")

Add when unified: a host-mode parity test for `.@{name}-item`,
`&@{suffix}`, `[data=@{value}]`, `:@{pseudo}`, `:is(.a, .b)`, and
`:is(@{dynamic})` proving interpolation remains typed and static selector
pseudos remain structured only where the direct AST contract says they are.

## Canonical selector fold shape

The selector fold should make the surviving host-mode selector family look like
the current public CST grammar, with AST reducers layered onto that exact
recognition:

- `ExtendPseudo` remains the public CST owner for `:extend(...)`.
- A context-aware selector branch parser parses the selector subject plus the
  optional inline `ExtendPseudo` in one pass, then the AST reducer maps extend
  targets to branch-local instructions whose `subject` is the already-built
  selector subject.
- `SelectorList` collects those branch facts and returns the selector list plus
  accumulated branch-local extensions in AST mode. In CST mode it remains the
  public `SelectorList` node shape the language service consumes.
- `Ruleset` consumes `SelectorList` once and lowers the collected extensions
  into the canonical `rule(...)` extension list.

This is the target shape, not the current direct-AST side channel:

```ts
const caseOf = makeWhen({ caseInsensitive: true });

const ExtendPseudo = node(
  'ExtendPseudo',
  sequence(
    pseudoColon,
    literal('extend'),
    literal('('),
    extendBody,
    expect(literal(')'), ')')
  ),
  astReducerToExtendTargetFacts
);

const PseudoSelector = dispatch(
  token(
    sequence(pseudoColon, pseudoNameOrInterpolation, optional(literal('(')))
  ),
  caseOf(':extend(', ExtendPseudoFromRoutedHead),
  caseOf(
    [':is(', ':where(', ':not(', ':has(', ':matches('],
    StructuredSelectorPseudoFromRoutedHead
  ),
  when(endsWith('('), OpaqueFunctionalPseudoFromRoutedHead),
  otherwise(BarePseudoFromRoutedHead)
);

const selectorBranch = selectorBranchFor({
  inlineExtend: 'collect',
  extendTargetFlags: false,
});

const extendTargetBranch = selectorBranchFor({
  inlineExtend: 'reject',
  extendTargetFlags: true,
});

const SelectorList = node(
  'SelectorList',
  oneOrMoreSep(selectorBranch, literal(',')),
  astReducerToSelectorListWithExtendsFact
);
```

The helper name is illustrative; keep the implementation grammar-local and
small. The important shape is the contract:

- `selectorBranchFor({ inlineExtend: 'collect' })` is used by ruleset headers.
  It returns `{ selector, extensions }`, where every inline extend gets
  `subject: selist(selector)`.
- `selectorBranchFor({ inlineExtend: 'reject' })` is used inside extend targets
  and selector-valued pseudo arguments. It parses the selector once and does not
  let nested `:extend(...)` become a second selector route.
- `extendTargetFlags: true` adds the terminal `all` / `!all` flag only in the
  `:extend(...)` target list. Do not let ordinary selector lists know about that
  flag.
- `PseudoSelector` should use Parseman 0.43 `dispatch(...)` only where it routes
  one already-consumed pseudo/function opener. Branch nodes that need the opener
  use `routed()`. The selector-list branch itself should not be an outer
  `attempt(...)` fallback.

Simplify the remaining selector helpers only when the patch keeps one-pass
ownership intact: `ExtendComplex`, `ExtendTargetComplex`, `ExtendTarget`,
`ExtendPseudo`, `SelectorBranch`, `DynamicSelectorBranch`, and
`selectorListWithExtends` should converge toward a context-aware selector-list
helper instead of separate duplicated selector families.

Do not preserve AST/CST acceptance differences by keeping two selector routes.
The one open decision is dynamic inline-extend subjects such as
`.@{name}:extend(.target)`: either the grammar adopts that accept set, or a
single-parse semantic diagnostic rejects that case after recognition. Do not use
source reparse, source scan, or broad `:extend(` lookahead.

The folded AST invariant is the existing core extend shape: inline extends set
`subject: selist(the single complex branch)`, while body-form
`&:extend(...)` instructions omit `subject`. The public CST `ExtendPseudo`
should own the inline pseudo in both host modes; the direct selector branch
facts are temporary reducer facts, not public owners.

2026-07-27 update: the pseudo family now has the shared-opener dispatch shape.
`PseudoSelector` parses one `:name` / glued `:name(` opener, then routes
selector-function, generic-function, interpolation-argument, and bare-pseudo
branches with `routed()`. The focused Less parser set passed, `check:macro` and
`verify:compose-integrity` passed, and the Less oracle stayed AST-neutral
versus the prior folded state. Treat remaining pseudo work as public CST/naming
migration work, not as a reason to reintroduce function-opener fallback choices.

This is not the first selector-branch tool; the first selector-branch tool is
one branch parser with one AST reducer.

## Recommended next patch

Remove the remaining comment-as-value carriers from Less grammar source:

- custom-property `blockComment` parts in `CustomInnerPart` / `CustomPart`
- opaque at-rule prelude comment text in `lessOpaqueAtPreludeCapture`
- `GeneralEnclosedRaw` comment payloads

Keep `blockComment` in scanner-local `scanSkip` / `balanced(...)` protection
where needed so raw capture does not terminate inside comments. The semantic
target is source/document trivia replay, not comment text children.

Focused proof:

- `pnpm --filter @jesscss/less-parser test -- custom-property.test.ts --run`
- `pnpm --filter @jesscss/less-parser test -- public-parse.test.ts --run --testNamePattern "custom-property|unknown CSS block|comments|pseudo|extend"`
- `pnpm run verify:less-alpha` if parser source changes
