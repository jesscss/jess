# Less fold hotspot report

Sidecar audit date: 2026-07-26.

Scope: `packages/syntax/less/less-parser/src/grammar.ts`. This report records
the remaining quality cleanup after the Less grammar collapsed to one host-mode
source.

Current parity note: Less now ships from the direct host-mode grammar. The old
CST bridge body has been deleted from `src/grammar.ts`, `lessCstGrammar` points
at the host-mode CST artifact, and `lessAstGrammar` remains an alias of the same
grammar. The public CST oracle movement is intentional fold movement; a later
strict CSS calc follow-up also moved the two invalid CSS calc error fixtures so
`calc()` / `calc(+)` reject at recognition rather than falling back to a generic
function. The committed oracle baseline now pins both named movements:
`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929`
with 120 throws and
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`
with 0 throws over 709 entries.

The next Less work is no longer "make direct CST safe to switch"; it is quality
cleanup on the surviving grammar. Remove `DirectLess*` migration names as each
family is reviewed, keep public CST labels only where they are real contract
labels, and replace duplicate known/generic routes with Parseman 0.40
`dispatch(...)`, `makeWhen(...)`, and `routed()` shapes. The remaining gating
warnings are a cleanup queue, not evidence to resurrect the old bridge.

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
  compiled-document render then loads the static import graph, while later
  renders can reuse parsed documents from the same `Context`.
- A context-local `loadImport(...)` memo now avoids re-resolving an already
  loaded static import on repeated renders of the same compiled document. That
  is useful session caching, not the Less alpha one-shot render fix.
- The larger first-render target is for compile to prepare the static import
  graph once, respecting Less import options and deferring dynamic import targets
  that require render-time bindings.

## Comment-as-trivia debt audit

Current decision: comments are trivia. Do not preserve grammar-level `Comment`
nodes, value-comment leaves, or repeated `many(blockComment)` plumbing as the
target architecture. Scanner-local comment skip sets are allowed only to keep
balanced or `scanTo(...)` recognition from terminating inside comments; skipped
comments should not become semantic value text.

Priority Less cleanup queue:

1. **Custom-property comment parts are true semantic debt.**
   `DirectLessCustomInnerPart` / `DirectLessCustomPart` admit `blockComment` as
   `CustomValuePart` and reduce it into custom-value text. Custom properties may
   need permissive token structure, but comments still belong to trivia.
2. **Declaration-head comment facts are a render/trivia integration issue.**
   `DirectLessDeclarationHeadBlockComment` captures comment bytes and appends
   them into declaration-name construction. The target is source-span/trivia
   replay, not semantic declaration-name bytes.
3. **At-rule prelude comment capture is likely semantic debt.**
   `directLessAtPreludeComment` participates in CSS/Less opaque at-rule prelude
   capture. Unknown at-rules can opportunistically parse structure, but comments
   should not be assembled into semantic prelude text.
4. **General-enclosed raw comments are likely semantic debt.**
   `DirectLessGeneralEnclosedRaw` includes `CssSyntaxBlockComment` as raw text;
   preserve balanced recognition, but do not make comments part of interpolation
   or general-enclosed payloads.

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

## Recommended fold order

1. **Block/root statement container spine.** Collapse the duplicated
   statement-choice bodies first: CST `declarationList` / at-rule bodies /
   mixin-definition bodies / ordinary block bodies versus direct
   `directLessBlockStatement` / `directLessBodyStatement` / ruleset body
   variants. This deletes real duplicated grammar without deciding every
   selector or value detail. Keep context-specific differences explicit: root,
   ruleset body, detached-ruleset body, at-rule body, and `each()` callback are
   not identical.
2. **Selector plus inline `:extend()` ownership.** Parse each selector branch
   once, with `ExtendPseudo` as the public CST owner and AST reducers collecting
   branch-local extend facts. Do not preserve the current direct-AST selector
   side channel, and do not reparse selectors to collect extends.
3. **At-rule/query/import/keyframes family.** Fold known-vs-generic at-rule
   routes only after CSS placement rules and Less deviations are explicit.
   `@charset`, `@namespace`, `@import`, `@supports`, media/container, and
   keyframes do not share one acceptance rule.
4. **Value/function/math/argument spine.** Collapse the repeated value stack
   after glued opener handling and math/division mode boundaries are clear.
   Function openers such as `url(`, `calc(`, and `%(` should route through one
   consumed opener, not keyword/function backtracking.
5. **Less variable/mixin/reference/declaration family.** Keep this
   Less-specific; do not preserve it for SCSS. The dangerous boundaries are
   `@name:` versus at-rule, `@name(...)` variable call versus at-rule,
   mixin/ruleset ambiguity, guards, `default()`, and namespace/reference
   accessors.

## Naming cleanup rule for the fold

`DirectLess*` is a migration namespace, not grammar vocabulary. As each family
is folded into the single host-mode factory, delete the prefix from local consts
and type keys unless the accepted language genuinely differs. Preserve or map
public CST labels separately: `Declaration`, `CustomDeclaration`, `AtRuleBlock`,
`AtRuleStatement`, `ImportAtRule`, `QueryAtRuleBlock`, `MixinCall`,
`MixinOrQualifiedRule`, `VarCall`, selector node keys, and interpolation node
keys are contract questions; local rule names are not.

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
- Selectors/extents: `StaticPseudo*`, `InterpolatedPseudo`,
  `StaticAttribute*`, `InterpolatedAttribute*`, `CompoundSelector`,
  `ComplexSelector`, `SelectorList`, `ExtendTarget`, `InlineExtendTail`,
  `SelectorBranch`, `Ruleset`. If the inline-extend subject and extend target
  really differ, name the context (`InlineExtendSubject`, `ExtendTarget`), not
  the migration path.

## Parseman 0.40 routing targets

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
- Mixin statement router: the current broad `directLessMixinStatementAhead`
  skips repeated work but still leaves the same name/path family spread across
  definition/call/bare-call arms. The fold target is one consumed mixin opener
  with suffix routing.
- Query feature parentheses: CSS/Less media features are a real left-factor or
  context-helper target, not an automatic dispatch target. The same inner
  identifier can begin colon, comparison, range, grouped, and negated features,
  but a safe rewrite must share the opener while preserving the public CST
  owners for each feature family.
- Import media: route valid media-query tails through the same structured media
  grammar before any broad static-tail fallback.

## First implementation slice

Start with only the ordinary braced-block statement spine. Merge the CST
`blockItem` / `declarationList` / `atRuleBody` family with the direct
`directLessBlockStatement` / `directLessBlockBody` family. Do not include the
root stylesheet, detached-ruleset body, `each()` callback body, selector
inline-extend path, at-rule header family, import family, or keyframe family in
this slice.

Recognition source of truth: the direct ordinary block choice is closer to the
target because it already owns the intended Less disambiguation gates:
`directLessAtStatement`, the mixin/ruleset gate, the declaration-vs-ruleset
gate, and the ruleset-only extend body. The current CST `blockItem` remains the
public CST concept name, but it is not the recognition model to preserve
unchanged; it currently includes `ExtendStatement` in every block item, while
the direct ruleset body keeps extend as a ruleset-body-only arm.

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

The current CST selector path parses inline extend as a selector-owned terminator:

- `extendAhead` / `selectorBoundary` stop ordinary selector runs before
  `:extend(` at `grammar.ts:405-415`.
- `ComplexSelector` owns an optional `ExtendPseudo` at `grammar.ts:430-437`.
- `ExtendPseudo` parses `:extend(...)` as grammar structure at
  `grammar.ts:466-490`.
- `ExtendStatement` handles the ruleset-body `&:extend(...)` form at
  `grammar.ts:491-499`.

The direct AST path is still a duplicate body, but its inline-extend route has
been narrowed into the shape the unified factory should preserve:

- `SelectorBranch` parses one static selector subject and then an explicit
  continuation: either `DirectLessExtendPseudo` plus a selector-list
  boundary, or just the boundary. Ordinary static branches no longer parse the
  full subject once as an extend false start and again as an ordinary complex
  selector.
- `SelectorListWithExtends` collects branch-local extend instructions and the
  selector list in one fact. That fact is still private to the direct AST body;
  the fold target is to make this the shared host-mode selector-list shape
  rather than a second AST-only route.
- Inline-extend subjects use `DirectLessExtendComplex`, not the ordinary
  `DirectLessComplex`; extend targets use another complex selector variant.
  Preserve that distinction until the selector-family fold can prove which
  interpolated subjects Less should accept or reject.
- Ruleset bodies still add `DirectLessExtendStatement` separately from ordinary
  body statements. Statement containers remain a separate fold blocker.

Fold requirement: selector parsing should collect branch-local extend facts while
parsing each selector branch once. The current direct AST rule is useful as an
acceptance reference, not as the target shape.

Current hotspots to delete or contain during the fold:

- `DirectLessRuleset` now enters ruleset selectors directly through
  `selectorListWithExtends`. Keep that as the floor: no broad fallback, no
  AST-only selector side channel, and no selector source reparse.
- `selectorListWithExtends` duplicates the public selector list instead of being
  the public `SelectorList` recognition with different host-mode projection.
- `DirectLessExtendComplex`, `DirectLessExtendTargetComplex`, and their
  `*Tail` / `*Compound` helpers duplicate the selector family to stop before
  flags and inline `:extend(...)`. These are context differences, not separate
  grammars; fold them into a selector-list helper that receives context.
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
branch ownership, one CST `ExtendPseudo`, and no `DirectLessInlineExtendRule`
public node.

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
  syntax that was copied into SCSS, such as Less-style `@import (css, once)`
  options, and pin rejection tests so the leak does not return.

Recommended handling: delete or internalize these during the Less fold whenever
the Less parser's own CST/AST/language-service contracts do not require them.
If SCSS turns red, treat that as evidence for the SCSS sibling rebase, not as a
reason to keep Less broad.

SCSS tests to pin the sever later:

- Add `packages/syntax/scss/scss-parser/test/less-inheritance-rejection.test.ts`
  with public parse rejection cases for Less-only syntax: `@color: red;`,
  `.m() when (true) {}`, `.a { color: ~"x"; }`, `.a { &:extend(.b); }`,
  `.a { @rules(); }`, and `.a { #ns[value]; }`.
- Add one CST compose test asserting SCSS no longer imports
  `@jesscss/less-parser/grammar` once it is re-pointed to a CSS/preprocessor
  base. Today's `compose-integrity.test.ts` still documents the old
  css -> less -> scss path.

## First fold blockers

1. Selector and inline-extend ownership

Current split: CST uses `ComplexSelector` plus optional `ExtendPseudo`; AST uses
`SelectorBranch` / `SelectorListWithExtends` over direct selector productions.
The AST shape is closer to the target, but it is still inside the duplicate
direct body. Fold it into the host-mode factory instead of adding another
selector path.

Pin with the existing inline extend AST/public tests listed above.

2. Statement container ownership

Current split: the CST body now keeps `stylesheetItem` and `blockItem` local
rather than exporting them as dialect hooks, with `declarationList` and
`atRuleBody` referencing those locals directly (`grammar.ts:184-193`,
`:510-519`, and `:1345-1349`). The AST body is still separate:
`directLessBlockStatement`, `directLessRulesetBody`, `DirectLessBodyStatement`,
and a separate top-level `Stylesheet` at `grammar.ts:4599-4607`, `:4635-4650`,
and `:5925-5931`.

Do not start by merging `DirectLessBodyStatement` into
`directLessBlockStatement`: that body intentionally carries the punctuation-map
arm and callback/detached-ruleset ordering, while `directLessBlockStatement`
owns ordinary braced block contexts. The first deletion target is the duplicated
ordinary braced block choice (`blockItem` versus `directLessBlockStatement`);
detached-ruleset and `each()` callback bodies stay context-specific until their
accept sets are audited separately.

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

Current split: CST has `LessAmpersand`, `InterpolatedSelector`,
`AttributeSelector`, `PseudoSelector`, and `SelectorList` at
`grammar.ts:373-464`; AST has many direct selector-only reductions:
`DirectLessStaticPseudo`, `DirectLessInterpolatedPseudo`,
`DirectLessInterpolatedAttribute`, `DirectLessBareInterpolatedSelector*`,
`DirectLessCompound`, `DirectLessComplex`, and `DirectLessSelector` at
`grammar.ts:5462-5801`.

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
- `PseudoSelector` should use Parseman 0.40 `dispatch(...)` only where it routes
  one already-consumed pseudo/function opener. Branch nodes that need the opener
  use `routed()`. The selector-list branch itself should not be an outer
  `attempt(...)` fallback.

Delete the direct-AST selector side channel when this lands:
`directExtendAll`, `DirectLessStaticExtendCompound`,
`DirectLessStaticExtendComplexTail`, `DirectLessExtendComplex`,
`DirectLessExtendTargetComplexTail`, `DirectLessExtendTargetComplex`,
`DirectLessExtendTarget`, `DirectLessExtendPseudo`,
`directSelectorBranchBoundary`, `directSelectorBranchContinuation`,
`DirectLessSelectorBranch`, `DirectLessDynamicSelectorBranch`,
`selectorListWithExtends`, and the `attempt(selectorListWithExtends)` fallback
in `DirectLessRuleset`.

Do not preserve AST/CST acceptance differences by keeping two selector grammars.
The one open decision is dynamic inline-extend subjects such as
`.@{name}:extend(.target)`: either the folded grammar adopts the CST accept set,
or a single-parse semantic diagnostic rejects that case after recognition. Do
not use source reparse, source scan, or broad `:extend(` lookahead.

The folded AST invariant is the existing core extend shape: inline extends set
`subject: selist(the single complex branch)`, while body-form
`&:extend(...)` instructions omit `subject`. The public CST `ExtendPseudo`
should own the inline pseudo in both host modes; the direct selector branch
facts are temporary reducer facts, not public owners.

2026-07-27 update: the pseudo family now has the shared-opener dispatch shape.
`DirectLessPseudo` and `DirectLessStaticPseudo` parse one `:name` / glued
`:name(` opener, then route selector-function, generic-function,
interpolation-argument, and bare-pseudo branches with `routed()`. The focused
Less parser set passed 330 tests, `check:macro` and `verify:compose-integrity`
passed, and the Less oracle stayed AST-neutral versus the prior dirty folded
state. CST intentionally moved to
`8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698` because
the routed opener changes public pseudo leaf ownership. Treat remaining pseudo
work as public CST/naming migration work, not as a reason to reintroduce
function-opener fallback choices.

This is not the first selector-branch tool; the first selector-branch tool is
one branch parser with one AST reducer.

## Recommended next patch

Collapse only the shared block-context statement spine into the host-mode
factory:

- The surviving public concept is `blockItem`, with the actual ordered choice
  body now represented by `directLessBlockStatement`.
- `declarationList`, generic at-rule bodies, mixin-definition bodies, and
  ordinary block bodies should consume that same `blockItem` grammar.
- Rulesets keep a context-specific `rulesetBody = many(choice(blockItem,
ExtendStatement))`, because standalone `&:extend(...)` is ruleset-body-only.
- Root `Stylesheet`, detached-ruleset bodies, and `each()` callback bodies are
  not part of this first slice; they have real context differences.

Reject a cosmetic rename of `directLessBlockStatement` while the CST `blockItem`
body still exists separately. Also reject a generic `statementItems(...)` helper
that only hides duplication; the fold must delete one duplicated body and keep
the macro output build-resolvable.

2026-07-27 recheck: Less is now a single host-mode grammar. Inline
`:extend(...)` ownership is already live in that grammar: `ExtendPseudo` owns
the authored pseudo, selector branches collect extend facts during the selector
parse, and public tests assert that the old `InlineExtendTail` owner is absent.
The ruleset selector fallback is now paid too: `DirectLessRuleset` consumes
`selectorListWithExtends` directly, so ruleset headers use the inline-extend-aware
selector route once instead of retrying a plain selector route. Do not
reintroduce a second selector grammar, selector source reparse, or broad
fallback around ruleset headers.
