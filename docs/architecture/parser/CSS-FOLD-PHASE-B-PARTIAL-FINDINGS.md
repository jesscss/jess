# Stage 3 Phase B — Partial findings from first dispatch (single-worktree)

Recorded 2026-07-25 in worktree `/private/tmp/jess-css-phase-b` at HEAD `044eb7452`.
This document records what the first Phase B dispatch discovered and did NOT land,
so the next dispatch does not re-pay the same discovery cost.

## Phase B feasibility verdict: GREEN (one caveat)

Probe: `composeLeaf([cssSyntax, rules({ trivia, hostMode: 'cst' }, factory)])`.

Result: ✅ BUILDS GREEN — when `hostMode` is a *plain string literal* `'cst'`
(NOT `'cst' as const`). The parseman macro plugin (parseman 0.37.0) checks
`hostModeValue?.type === "Literal"` — a `'cst' as const` expression parses as
a TSAsExpression that the macro fails to unwrap, and emits the warning
"rules({ hostMode }) must be the literal 'ast' or 'cst'" + runtime fallback.
Drop the `as const` on the hostMode field; use `hostMode: 'cst'`.

That finding alone resolves the Phase A "the name strings are NOT cosmetic"
correction's open question for Phase B: yes, the same `composeLeaf` wrappers
accept hostMode, and ONE factory body can be re-compiled under two host modes.

Same plugin source (`node_modules/parseman/dist/plugin/index.js:11076`) confirms
`rules()` accepts `hostMode: 'ast'|'cst'` and stamps `grammarHostMode` on every
rule (`rules`:11075+; `compose`:11366 for compose-with-second-arg-options).

## Phase B architectural finding: the two grammars are NOT rule-isomorphic

Phase A's diagnosis correction said the rule decompositions differ in reducer
noise but ARE the same language. The first Phase B re-discovery: the rule
**decomposition itself** differs between the CST grammar and the AST grammar.
They are not 1:1 by rule key.

### Concrete evidence (grep-confirmed)

CST grammar `src/grammar.ts` rule map exposes these keys (excerpt):
`Stylesheet`, `stylesheetBody`, `Ruleset`, `SelectorList`, `ComplexSelector`,
`CompoundSelector`, `BasicSelector`, `AttributeSelector`, `PseudoSelector`,
`pseudoArg`, `Declaration`, `CustomDeclaration`, `declarationList`,
`keyframeSelector`, `KeyframeSelectorList`, `KeyframeBlock`, `AtRuleBlock`,
`AtRuleBlockTop`, `AtRuleStatement`, `ImportStatement`, `QueryAtRuleBlock`,
`QueryAtRuleBlockTop`, `UnknownAtRuleBlock`, `Dimension`, `Color`, `Num`, `Url`,
`Call`, `Paren`, `Quoted`, `CalcCall`, `QueryCondition`, `QueryInParens`,
`QueryFeature`, `QueryFunction`, plus `valueList`/`valueSequence`/`value` etc.

Historical first-pass finding, now superseded by the verified 2026-07-26
rule-key cleanup batches below: the AST grammar `src/ast/grammar.ts` rule map
mostly exposed `CssAst*`-prefixed keys, with the `Quoted`/`Url` pilot family
owned under public shared names:
`Stylesheet`, `Comment`, `CssAstSelector`, `CssAstComplex`,
`CssAstCompound`, `CssAstSimple`, `CssAstAttribute`, `CssAstPseudo`,
`CssAstNestingSelector`, `Property`, `CustomProperty`, `CustomValue`,
`Keyword`, `Color`, `UnicodeRange`, `Dimension`, `Quoted`, `Url`,
`Call`, `CalcCall`, `CalcParen`, `CalcValue`, `CalcProduct`, `CalcSum`,
`VarFallback*` family, `Value`, `ValueSequence`, `ValueList`, `TypedValue*`,
`Important`,
`Declaration`, `ImportStatement`, `AtRuleStatement`,
`AtPrelude`, `StatementPrelude`, `OpaqueAtPrelude`, `OpaqueBody`,
`OpaqueAtRuleBlock`,
`QueryBareFeature`/`RangeFeature`/`Comparison`/`Prelude`/`Clause`/`Term`,
`GeneralEnclosed*`, `SupportsCondition`/`InParens`/`Prelude`,
`LayerBlock`, `NestedLayerBlock`, `ConditionalBlock`,
`NestedConditionalBlock`, `DescriptorBlock`, `FontFeatureValuesBlock`,
`ScopeBlock`, `StartingStyleBlock`, `NestedStartingStyleBlock`,
`PageBlock`, `keyframeSelector`, `KeyframeBlock`, `Keyframes`,
`MarginAtRule`, `FeatureValueBlock`, `DocumentBlock`, `Ruleset`,
`whitespace`.

**Notable divergences:**
- The CST has ONE `AtRuleBlock` rule that is a UNION of all the conditional-group
  at-rules (layer / supports / starting-style / media / etc.), emitting a single
  CST `grammarType='AtRuleBlock'` → public `AtRule`. The AST splits these into
  SEPARATE typed rules — `LayerBlock`, `NestedLayerBlock`,
  `ConditionalBlock`, `NestedConditionalBlock`, `ScopeBlock`,
  `StartingStyleBlock`, `NestedStartingStyleBlock`, `PageBlock`,
  `FontFeatureValuesBlock`, `DocumentBlock`, `Keyframes`,
  `OpaqueAtRuleBlock`, `AtRuleStatement`, `ImportStatement`. Each emits its
  OWN typed AST node.
- The CST exposes a `SelectorList` rule (`node(sequence(...))`); the AST does NOT
  have a `CssAstSelectorList` rule — instead the AST's pseudo / ruleset arms
  inline-build `selist(...)` directly via `complexCanonical`/`selectorComplexes`.
- The AST has no `CssAstQueryAtRuleBlock`; the CST has `QueryAtRuleBlock`.
- The AST has no `CssAstUnknownAtRuleBlock`; the CST has `UnknownAtRuleBlock`.
- The AST has a `VarFallback*` family (~10 rules) with no CST analog — they
  are the diagnosis §3 "true AST-only substructure"; CST absorbs calc via raw
  `scanTo`/`balanced` capture. The family is no longer calc-prefixed because
  the same fallback grammar is reused by strict calc `var()` and declaration
  `var()` paths.

## Consumer-contract test (c) — grep-confirmed

less-parser (`packages/syntax/less/less-parser/src/grammar.ts`) and jess-parser
(`packages/syntax/jess/jess-parser/src/grammar.ts`) consume the CST-compiled CSS
artifact from `@jesscss/css-parser/grammar` (now named `cssCstGrammar`, with
`cssGrammar` preserved as a compatibility alias). They reference rule names on
`g.<Name>` after `compose([cssCstGrammar, lessDelta])` (= the Less CST surface
`parseLessCst`).

Unprefixed rule names less-parser references on `g.<X>` (= names the merged
factory's rule map MUST expose for less's compose to resolve), all
CST-side; **none of them are `CssAst*`-prefixed**:
`AtRuleBlock, AtRuleStatement, AttributeSelector, Call, Color, ComplexSelector,
CompoundSelector, CustomDeclaration, Declaration, Paren, PseudoSelector,
QueryAtRuleBlock, QueryCondition, QueryInParens, Quoted, Ruleset, SelectorList,
Url` (17 distinct unprefixed names from less).

Unprefixed rule names jess-parser references on `g.<X>`:
`AtRuleBlock, AtRuleStatement, AttributeSelector, CalcCall, Call, Color,
CustomDeclaration, Declaration, Dimension, Num, Paren, PseudoSelector,
QueryAtRuleBlock, Quoted, Ruleset, SelectorList, UnknownAtRuleBlock, Url`
(17 distinct from jess; union with less is 22 unprefixed names).

Worker script used (in /tmp of the worktree):

```sh
grep -oE "g\.[A-Z][a-zA-Z]+" packages/syntax/less/less-parser/src/grammar.ts | sort -u
grep -oE "g\.[A-Z][a-zA-Z]+" packages/syntax/jess/jess-parser/src/grammar.ts | sort -u
```

There are ZERO `CssAst*` references (non-syntax) in less/jess grammar source.
(less references `CssSyntax*` only via the shared-recognition `cssSyntax`
piece, not via the CSS grammar's rule map. Confirmed by:
  `grep -oE "CssAst[A-Z][a-zA-Z]+" packages/syntax/less/less-parser/src/grammar.ts
   packages/syntax/jess/jess-parser/src/grammar.ts | grep -v CssSyntax`)

Conclusion: under option **(c)**, less/jess reference ONLY unprefixed rule
names (the CST-side names), NOT `CssAst*`-prefixed. The merged factory MUST
expose those 22 unprefixed names on its public rule map; option (a) — aliasing
— is forbidden by GRAMMAR-REVIEW-STANDARD item 14 (the merged prefix IS a
claim of divergence that does not exist).

## What the merged factory must produce to be stackable

Every rule the merged factory exposes BOTH under 'ast' and 'cst' host modes,
the rule KEY (e.g. `'Color'`) becomes the `grammarType` baked into CST output
(`node_modules/parseman/dist/plugin/index.js:2358` `tagRule`: sets
`r._def.type = key`). So:
- 'cst' output's `grammarType` for a `node('Color', ...)` will be `'Color'`,
  matching today's CST output byte-identically (today's CST grammar uses
  unprefixed keys like `'Color'`, `'Ruleset'`, etc.).
- The current `src/cst.ts` `TYPE_NAMES` table already has the right mappings for
  the unprefixed names (`Color: 'Color'`, `Ruleset: 'QualifiedRule'`, etc.).
- The AST output unaffected — the AST build arrow produces its own constructor
  output (e.g. `color()` returns `{ type: 'Color', src }`) — the rule key
  string is NOT embedded in the AST node; confirmed at `packages/core/src/ast/nodes.ts:966`.

## What 's left to design (for next dispatch)

**The hard part: reconciling the divergent rule lists.** The merge is NOT a
rename — it is a structural refactor where:
- For shared grammarType-key unions like `AtRuleBlock`, the merged factory must
  KEEP the CST's UNION recognition (= today's `node(choice(...))` body), and
  attach the AST-style build arrow that dispatches which typed AST to build
  based on which arm matched (the AST currently achieves that by having
  separate per-arm rules with their own build arrows migrating to `AtRuleBlock`'s
  build arrow).
- For per-arm named AST rules that don't fit the union (e.g. `CssAstLayerBlock`
  ↔ `LayerBlock`, `CssAstKeyframes` ↔ no CST key), they become INTERNAL consts
  of the factory body OR get exposed as a new public name — but if exposed,
  less/jess would not reference them (already verified), so_internal is safe.
- For names like `SelectorList` that the AST grammar doesn't have as a single
  rule (it inlines `selist(...)`), the merged factory must ADD a `SelectorList`
  rule whose recognition matches the CST's `SelectorList` recogniser and whose
  build arrow runs the AST's `selist(...selectorComplexes(children))`.

A reasonable plan for the next dispatch:

1. Use the CST grammar's rule recognisers (front-end recognition stays close
   to today's CST shape to preserve byte-identical CST output).
2. For each CST rule, locate the corresponding AST build arrow (or several, in
   the case of `AtRuleBlock`'s union) and migrate them — combining multiple
   AST build arrows into a single dispatched build arrow where the CST rule is
   a union (this requires checking children fields/types at parse time to fan
   out to the right AST constructor).
3. For AST-only rules with no CST analog (CalcVar family, RelativeComplex,
   DocumentBlock), keep them as internal `const X = node('X', ..., build)` but
   DO NOT expose them on the return map.
4. Lift the lambda to a module-level `const cssFactory = (g: CssGrammarSelf) => {...}`
   so the macro is statically evaluable; verify `cssFactory` is referenced BY
   NAME in BOTH `rules({trivia, scanSkip, hostMode: 'cst'}, cssFactory)` and
   `rules({trivia, scanSkip}, cssFactory)` pairs (the 'ast' default).
5. Verify byte-identity incrementally after every batch — the divergence in
   rule decomposition means many small structural changes to reconcile, NOT a
   single big rename.

Estimated effort: this is multiple rounds of `edit → oracle → triage` work.
The first Phase B dispatch hit the architectural divergence before producing a
green gate stack; subsequent dispatches should expect the same kind of
per-rule reconciliation, not a single bulk rename.

## Gate results

No Phase B gates can be run yet because no Phase B code change has been made.
Existing gates (verified at worktree HEAD before the probe phase):
  - `pnpm run build:release` ✅ green at HEAD
  - `pnpm run oracle:less:byte-identity` ✅ green at HEAD (the committed baseline)

## Probe file(s) status

All probe files (probe.ts, probe2.ts, probe3.ts, probe4.ts in
`packages/syntax/css/css-parser/src/ast/`) have been DELETED from BOTH the
worktree at `/private/tmp/jess-css-phase-b` and the main checkout at
/Users/matthew/git/oss/jess. The `tsdown.config.ts` entry hack (temporary
`probe: './src/ast/probe.ts'` line) has been reverted to HEAD's original entry
shape. Worktree status: clean; HEAD is `044eb7452`.

## Recommendation to the orchestrator

Phase B is feasibility-confirmed, but the structural reconciliation (CST
union rules ↔ AST per-arm typed rules) is non-trivial. Two paths:
  (A) Multi-dispatch approach: dispatch Phase B as an iterative grammar-edit
      cycle with the byte-identity gate between batches; expect 3–5 dispatches
      to drain the per-rule reconciliation work. Each dispatch lands a batch of
      rules merged, gates green, commits. This is what the spec called "small
      verifiable changes over broad speculative rewrites" (AGENTS.md).
  (B) Larger first-round plan: commit to the full restructure, accept that the
      oracle may fail on the FIRST attempt and the dispatch uses the diff to
      triage. Either way, the feasibility bug — 'cst' hostMode requires NO
      `as const` — is gated and fixed.

The recommended path is (A): treat Phase B itself as multiple sub-dispatches.
This first dispatch's result is the feasibility finding (probe verdict), the
consumer-contract (c) evidence (less and jess NEVER reference `CssAst*` rules
directly — they compose opaquely through `compose([cssCstGrammar, delta])`), and
the structural-divergence evidence (the rule lists don't match 1:1).

## Orchestrator update - whole-sequence critical review

The full `css -> less -> scss -> jess` approach review is recorded in
[`GRAMMAR-SEQUENCE-ORCHESTRATION.md`](./GRAMMAR-SEQUENCE-ORCHESTRATION.md).
Its decision is stricter than a mechanical Phase B merge: use incremental
rule-family redesign, keep mechanical reducer migration only where byte identity
proves the reducer is load-bearing, and reject "collapse first, clean later" as
misaligned with the owner's "exemplary Parseman grammar" goal.

For the next CSS batch, do not start with the `AtRuleBlock` union. The current
recommended pilot is `Quoted`/`Url`, because it is small enough to prove the
real hostMode factory shape while still covering public CST keys, direct AST
reducers, import-local URL caveats, and existing focused tests. Do not do
AST-only key renames as a preparatory cleanup unless they are done in the final
local factory and gated immediately; the orchestration note records the
superseded pre-factory `CssAstColor`/`CssAstDimension` probe that made
`composeLeaf()` fall back instead of macro-fusing, and the later verified
`Color`/`Dimension`/`UnicodeRange` public-key slice.

Follow-up evidence: the public CSS CST grammar now declares `hostMode: 'cst'`,
and the custom CSS CST build host is wrapped with Parseman's official
`cstBuildHost()` metadata. The public CSS grammar body has also been lifted into
a module-level `cssFactory`, so the CST half of the future dual-host factory is
macro-visible by name. That pays the hostMode and factory-shape prerequisites
without folding a rule family yet.

Later probe evidence tightened the next step. A direct `Quoted`/`Url` sharing
attempt was tried and backed out: importing a direct-builder `rules(...)`
artifact ahead of the current AST grammar made `composeLeaf()` fail because
Parseman 0.37 requires pre-final composeLeaf artifacts to be recognition-only.
Switching the AST grammar to `compose()` was also not viable against the current
AST rule map, because the existing block-bodied reducers are not all re-lowerable
IR.

That AST final factory prerequisite has now landed on the orchestration branch:
`src/ast/grammar.ts` has a module-level `cssFactory`, and `cssAstGrammar`
passes that named factory as the final local `rules(...)` map in `composeLeaf`.
Focused CSS AST/public/macro tests, focused CSS CST/macro tests, targeted ESLint
on the touched CSS grammar sources, the full CSS parser suite, `check:macro`,
`verify:compose-integrity`, and the Less byte-identity oracle all passed. The
remaining next step is not "extract a factory"; `Quoted`/`Url` are now exposed
under public AST rule keys, but the larger step is still to converge those
public AST owners with the CST artifact through the real dual-host factory while
preserving the documented escaped-string and comment-delimited URL CST/AST shape
caveats.

A later CST-builder seeding probe was also tried and backed out. Adding direct
builders to the current public CSS CST `Quoted`/`Url` rules is not a safe
partial fold: helper-call and block-bodied builders fail the composed dialect
macro pass, and expression-only object-literal builders clear `check:macro` but
make `pnpm run oracle:less:byte-identity` report all 707 Less CST corpus entries
moved (`threw 0 -> 707`). The next fold must therefore handle the dialect CST
composition story in the same batch; do not add builder arrows to the current
CST map as a standalone step.

Follow-up dialect composition evidence: after the CSS CST export split,
downstream macro-composed grammars must import the real `cssCstGrammar` export
name. Importing the compatibility alias `cssGrammar` makes Less fall back to the
Parseman interpreter with `compose(): argument 0 isn't a build-resolvable
grammar`. Adding dialect-level `hostMode` options as a preparatory cleanup was
also rejected; it is not part of the CSS rule-family fold and it makes CST
movement harder to attribute. The current accepted shape is therefore narrow:
Less and Jess import `cssCstGrammar` directly, and dialect deltas otherwise keep
their existing compose/rules shape until their own cleanup stage.

Follow-up CST export split: the current CSS CST artifact is now exported as
`cssCstGrammar`, while `cssGrammar` remains a compatibility alias. `parseCssCst`,
Less CST, and Jess CST now consume `cssCstGrammar` directly. This is the missing
ownership prerequisite implied by the failed builder-seeding probe: the upcoming
shared AST/default artifact needs the `cssGrammar` name without making dialect
CST composition accidentally depend on that AST-mode export. No public CST rule
key changed.

Follow-up AST pilot slices: CSS AST `CssAstQuoted` and `CssAstUrl` have been
renamed in the final local AST factory to public `Quoted` and `Url` rule keys,
and every CSS AST callsite now references `g.Quoted` / `g.Url`. The numeric/color
leaf family also now uses public CSS concept keys: `Color`, `Dimension`, and
`UnicodeRange`. This is not the whole hostMode merge: the public CST artifact
still owns its CST-only value rules through `cssCstGrammar`, `Num` remains a CST
public key, and import-local URL reducers stayed separate from generic `Url`
until the later import-helper rule-key slice. Focused CSS AST/public/macro/CST
tests passed for the first slice, followed by dependency-ordered parser builds,
package-export verification, `check:macro` with 0 interpreter fallbacks,
compose-integrity, a serial Less byte-identity oracle pass (707 entries
byte-identical), and the full CSS parser suite. Focused CSS AST/public/macro
numeric-color tests passed after the `Color`/`Dimension`/`UnicodeRange` slice;
the broader numeric-color post-slice gates also passed: dependency-ordered
parser builds,
`verify:package-exports`, `check:macro` with 0 interpreter fallbacks,
`verify:compose-integrity`, a serial Less byte-identity oracle pass (707 entries
byte-identical), and the full CSS parser suite (8 files / 242 tests).

Follow-up AST at-rule statement-key slice: CSS AST `CssAstImport` and
`CssAstAtRuleStatement` have been renamed in the final local AST factory to
public concept keys `ImportStatement` and `AtRuleStatement`. The import-local
URL/tail reducers are import-specific covered helpers rather than shared
statement concepts; they were intentionally left out of this statement-key
slice and later renamed in their own verified import-helper rule-key slice.
This slice changes rule-map names and `g.` references only; reducers still emit
canonical `AtRuleStatement` AST nodes.
Focused CSS tests, the full CSS parser suite, `check:macro`,
`verify:compose-integrity`, and the Less byte-identity oracle all passed after
the rename.

Follow-up CST caveat guards: `test/cst-public.test.ts` now pins the two
`Quoted`/`Url` shape mismatches that make the pilot non-mechanical. Static
escaped strings (`~"dark"`) are accepted by the public CST route as a sigil plus
a normal `Quoted` node, not as one escaped-string CST node. Comment-delimited
declaration URLs (`url/* comment */(icon.svg)`) remain on the public CST `Call`
path, while ordinary `url(icon.svg)` remains a public `Url`. The focused CSS
CST/public/macro tests passed, and the full CSS parser suite passed afterward
(8 files / 244 tests). A future fold must preserve those CST shapes or migrate
them deliberately with language-service evidence and an explicit mapping.

Follow-up strict CSS conformance and Parseman idiom slice: the latest
orchestration branch rejects the stale "semicolonless declaration before nested
at-rule is accepted because the value stops at the at-keyword" interpretation.
That is not CSS Syntax. Declaration consumption is bounded by semicolon or the
end of the declaration list, while at-rule statements require their own
semicolon unless they own a block. The landed CSS CST and AST grammars therefore
make semicolons list-owned: `Declaration` / `CustomDeclaration` do not consume
`;`, and the containing declaration/body lists require a declaration item to be
followed by either `;` or `}` before another body item can start. Final
semicolonless declarations still parse; semicolonless declarations immediately
followed by nested at-rules or nested qualified rules now fail.

This same slice also folds obvious hand-written grammar shapes into Parseman
idioms. Comma-list rules that have a real comma separator use
`oneOrMoreSep(...)` (`SelectorList`, `KeyframeSelectorList`, value lists, and
query/supports preludes). `ComplexSelector` is intentionally not modeled as a
separator list, because the descendant combinator is ambient trivia rather than
a token separator. Keyword-boundary regexes that only spelled known words were
replaced with `word(...)` or `keywords(...)`; regexes that encode non-keyword
lookahead or reserved-name logic remain local recognizers.

CSS property names now reuse the shared identifier terminal. The old CST
`propName` regex and its legacy IE `*color` acceptance were removed from
conforming CSS. The hexadecimal escape `{1,6}` length was correct, but that
belongs to identifier recognition, not a separate property-name regex. If a
legacy compatibility mode is intentionally added later, model it as an explicit
gated branch such as
`choice(sequence(literal('*'), gate(legacyMode), ident), ident)`. Parseman
`optional(...)` does not itself accept gated arms; use a gated `choice` arm or a
`gate(...)` combinator inside the optional sequence.

Evidence for the strict slice: targeted ESLint on touched CSS grammar, AST
grammar, parser-shared recognition, and CSS tests passed; the focused CSS parser
set passed (7 files / 245 tests); the full CSS parser suite passed (8 files /
250 tests); dependency-ordered parser builds for parser-shared and all four
parser packages passed; `check:macro` reported 0 interpreter fallbacks;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
after intentionally regenerating the baseline for the fixture reclassification
(`errors/declaration-star-property.css` added, two legacy star-property fixtures
made conforming) and the new public `Percentage` CST node. The oracle first
reported 85 moved CST entries with AST unchanged; every moved entry contained
`%`, and representative current CST trees contain `Percentage` nodes. The
current oracle corpus has 708 entries; AST threw 119 and CST threw 0.

Follow-up function-token cleanup: generic CSS function calls are now expressed
as a glued opener (`noTrivia(sequence(..., literal('(')))`) instead of a
duplicate `(?=\()` function-name regex. The CST grammar routes `calc(...)`
through `CalcCall` before generic `Call`; `Call` itself is the generic function
token plus `parenBody`, guarded with `not(calcOpen)` so direct `Call` parsing
does not reclassify `calc`. The AST grammar mirrors this by replacing
`genericFunctionName`, `regex(/calc(?=\()/i)`, and `regex(/var(?=\()/i)` with
`nonCalcFunctionOpen`, `calcOpen`, and `varOpen`. This keeps the "function name
and opening paren are glued" rule visible in grammar structure instead of
buried in a lookahead suffix.

Rejected in the same pass: splitting the public CST `urlOpen` from
`regex(/url\(/i)` into `word('url') + literal('(')`. It made the imported CSS
CST grammar stop being build-resolvable for Less composition in the published
Parseman 0.37 toolchain, and it would also churn public CST leaf shape. The AST
grammar can keep its structural `urlOpen`, but the public CST grammar should not
take that split until linkable imported grammar metadata and language-service
CST expectations are checked deliberately. A parallel Less oracle run also
briefly failed while CSS `lib/grammar.js` was being cleaned by a concurrent CSS
build; the serial rerun passed, so rebuild/order races remain a real source of
false negatives.

Evidence for the function-token pass: targeted ESLint on the touched CSS CST and
AST grammar files passed; `git diff --check` passed; dependency-ordered
`@jesscss/parser-shared` and `@jesscss/css-parser` builds passed; the focused CSS
parser set passed (4 files / 115 tests); the full CSS parser suite passed
(8 files / 250 tests); `pnpm run check:macro` passed with 0 interpreter
fallbacks; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 708-entry baseline. Current Parseman first-set diagnostics still report
`value` / `mathProduct` overlap between `CalcCall` and `Call`; `not(calcOpen)`
is a semantic guard, not a first-set subtraction the current compiler can use.

Follow-up query function-token cleanup: CSS `<query-in-parens>` functions now
spell the glued opener structurally. The public CST grammar replaced
`queryFunctionToken = regex(...(?=\())` plus a following `literal('(')` with
`queryFunctionOpen = noTrivia(sequence(ident, literal('(')))`. The direct CSS
AST grammar uses the same shape through a new shared recognition export,
`CssSyntaxQueryFunctionOpen`. The older `CssSyntaxQueryFunctionName`
export remains available for Less/SCSS/Jess until their direct AST grammars are
swept deliberately; do not delete or repoint it incidentally. A regression test
now verifies that `selector(.grid)` parses while `selector (.grid)` reports a
CST error and throws through public `parse()`.

Evidence for the query function-token slice: parser-shared and css-parser builds
passed; targeted ESLint on parser-shared plus touched CSS grammar files passed;
`git diff --check` passed; the focused CSS parser set passed (4 files / 116
tests); the full CSS parser suite passed (8 files / 251 tests);
`pnpm run check:macro` passed with 0 interpreter fallbacks across parser-shared
and all four parser packages; `pnpm run oracle:less:byte-identity` passed
byte-identical to the current 708-entry baseline
(`aggAst=546a633b28a857f82a3f1ea412428de79d2faab83b4fe48a16992ce286a44b6f`,
`aggCst=987b27901426b1aa6cca8542159b51e1a48ab4a6a8d16858870a61b2095ababc`);
and `pnpm run verify:compose-integrity` passed.

Follow-up `@supports` opener cleanup: the CSS CST fallback no longer uses
`regex(/(?=...)/)` to prove that a required supports condition begins with an
allowed opener. It now uses
`peek(choice(literal('('), word('not', '-_0-9A-Za-z', { caseInsensitive: true }),
queryFunctionOpen))`, so the grammar spells the three CSS starts directly:
parenthesized condition, `not` keyword, or glued `<function-token>`. The `not`
boundary intentionally preserves the old public CSS grammar's ASCII `\w`
boundary in this fallback; tightening it to full CSS identifier boundary would
be a behavior change and should be done only as an explicit conformance slice.
Less and SCSS still have dialect-specific `supportsCondAhead` variants because
they admit interpolation openers there; sweep those during the Less/SCSS
passes, not as incidental CSS fallout.

Evidence for the `@supports` opener slice: targeted ESLint on CSS
`src/grammar.ts` passed; dependency-ordered css-parser build passed; the focused
CSS parser set passed (4 files / 143 tests); the full CSS parser suite passed
(8 files / 251 tests); `git diff --check` passed; `pnpm run check:macro`
passed with 0 interpreter fallbacks; `pnpm run oracle:less:byte-identity`
passed byte-identical to the current 708-entry baseline
(`aggAst=546a633b28a857f82a3f1ea412428de79d2faab83b4fe48a16992ce286a44b6f`,
`aggCst=987b27901426b1aa6cca8542159b51e1a48ab4a6a8d16858870a61b2095ababc`);
and `pnpm run verify:compose-integrity` passed.

Follow-up CSS CST conditional-at-rule split: the public CST grammar no longer
routes `@media`, `@container`, and `@supports` through one generic
`queryAtKeyword + queryPrelude` shape. That shared prelude was both misleading
and not spec-conformant: a container prelude may be a container name, a query, or
name-plus-query; `only` is a valid container name; `none` is reserved; and
`@supports` must not borrow container-name syntax. The wrapper now keeps the
stable public `QueryAtRuleBlock` node name while dispatching to at-rule-specific
preludes. `@container` uses the historical `queryPrelude` public key as a
compatibility alias for the container-condition list until dialect consumers are
migrated off that generic name. Non-parenthesized `@media screen { ... }` still
uses the token-stream fallback, by design for this slice.

Focused CST coverage now asserts that `@container only { ... }`,
`@container only (min-width: 1px) { ... }`, and
`@container style(--theme: dark) { ... }` parse, while `@container none { ... }`
and `@supports only (display: grid) { ... }` report errors. Parseman's gating
report still flags the container prelude as overlapping because first-set
analysis cannot see that `not(queryFunctionOpen)` makes a container name
disjoint from a glued query function. Treat that as a readability/gating
follow-up for the query family, not as acceptance evidence.

Evidence for the conditional-at-rule split: `@jesscss/css-parser` build passed;
the focused CST public test passed (1 file / 10 tests); the full CSS parser suite
passed (8 files / 252 tests); `git diff --check` passed; the focused Parseman
ergonomics/macro/plugin tests passed in `/Users/matthew/git/oss/parser-thing`
(3 files / 120 tests) for `word(str, { caseInsensitive: true })` and
`makeWord(boundary?, { caseInsensitive: true })`; `pnpm run check:macro` passed
with 0 interpreter fallbacks across parser-shared and all four parser packages;
`pnpm run verify:compose-integrity` passed; and the serial
`pnpm run oracle:less:byte-identity` rerun passed byte-identical to the current
708-entry baseline
(`aggAst=546a633b28a857f82a3f1ea412428de79d2faab83b4fe48a16992ce286a44b6f`,
`aggCst=987b27901426b1aa6cca8542159b51e1a48ab4a6a8d16858870a61b2095ababc`).
An earlier parallel oracle invocation failed while `verify:compose-integrity`
was cleaning/rebuilding CSS parser artifacts; do not count that as a semantic
failure.

Follow-up CSS CST media prelude cleanup: the public CST grammar now parses
ordinary CSS media-type query items structurally instead of leaving them to the
generic opaque fallback. `@media screen { ... }`,
`@media screen and (min-width: 1px) { ... }`,
`@media only screen, print { ... }`, and
`@media screen and not (color) { ... }` now route through the stable public
`QueryAtRuleBlock` wrapper. The grammar uses the shared `ident` terminal for the
media type with an explicit reserved-keyword guard (`not`, `only`, `and`, `or`)
instead of a media-type-specific identifier regex. The modifier branch commits
to a required media type with `expect(mediaType, 'media type')`, so invalid
`@media only (hover) { ... }` reports a CST error instead of sliding into
`AtRuleBlock`'s token-stream fallback.

This is an intentional public CST classification movement: normal media-type
queries are no longer generic `AtRuleBlock` CST nodes. The movement is justified
by the Media Queries grammar, where a `<media-query-list>` item may be either a
condition or `[ not | only ]? <media-type> [ and <media-condition-without-or> ]?`.
Language-service coverage was therefore run in addition to parser gates.
Remaining query-family debt: Parseman's first-set report still flags overlap in
the media/container condition choices (`QueryCondition` vs function/name-led
forms). That is a readability/gating debt for the next query-family pass, not a
reason to return media-type queries to the opaque fallback.

Evidence for the media prelude cleanup: targeted ESLint on CSS `src/grammar.ts`
and `test/cst-public.test.ts` passed; `@jesscss/css-parser` build passed; focused
CST public tests passed (1 file / 11 tests); the full CSS parser suite passed
(8 files / 253 tests); `git diff --check` passed; `pnpm run check:macro` passed
with 0 interpreter fallbacks across parser-shared and all four parser packages;
`pnpm run verify:compose-integrity` passed; `pnpm run oracle:less:byte-identity`
passed byte-identical to the current 708-entry baseline
(`aggAst=546a633b28a857f82a3f1ea412428de79d2faab83b4fe48a16992ce286a44b6f`,
`aggCst=987b27901426b1aa6cca8542159b51e1a48ab4a6a8d16858870a61b2095ababc`);
and `pnpm --filter @jesscss/language-service test` passed (13 files, 189 passed,
1 skipped).

Follow-up CSS media conformance tightening: Media Queries Level 5 also reserves
`layer` from `<media-type>`, so both public CST and direct AST now reject
`@media layer { ... }` and `@media only layer { ... }`. The CST grammar also no
longer lets malformed known typed block at-rules fall through to the opaque
`UnknownAtRuleBlock` path: unknown block at-rules now explicitly exclude the
known block-at-keywords before accepting `atKeyword`. That means a bad
`@media`, `@container`, or `@supports` block must be fixed in its typed grammar
instead of being hidden as an unknown block.

The same slice removed the remaining public CST opaque `@media` fallback and
added structural value-first media range support, so
`@media (100em < width < 200em) { ... }` parses as a query feature rather than
as token-stream bytes. This intentionally moved the Less oracle CST surface for
the four media/range corpus entries below while leaving the AST aggregate
unchanged:

- `node_modules/@less/test-data/tests-unit/media/legacy/media.css`
- `node_modules/@less/test-data/tests-unit/media/media.css`
- `node_modules/@less/test-data/tests-unit/media/media.less`
- `packages/syntax/css/css-parser/test/css/expressions.css`

The Less byte-identity baseline was regenerated for that named movement. The
passing oracle now reports the same AST aggregate
`546a633b28a857f82a3f1ea412428de79d2faab83b4fe48a16992ce286a44b6f` and the new
CST aggregate
`0179c7bf1e7fe38442f4d4e0bbbf536758f0cb9a001557cd56a34b16102dc8fd`, with
708 entries and 0 CST throws.

Critical review of the approach: the remaining leading `not(...)` guards around
media/container names are not exemplary Parseman. They are tolerated only because
Parseman does not yet expose a clean macro-visible primitive for "CSS identifier
except these keywords" that preserves both boundary semantics and useful
first-sets. Do not blindly delete those guards; that reopens fallback acceptance.
Do not normalize them either. The better long-term fix is a Parseman primitive
or combinator pattern for keyword-excluding identifiers, then a grammar follow-up
that removes the leading-not first-set poison from `QueryFeature`,
`QueryInParens`, and `UnknownAtRuleBlock` diagnostics.

Evidence for the media conformance/range slice: targeted ESLint on the touched
CSS source and test files passed; the focused CSS parser set passed (3 files /
108 tests); the full CSS parser suite passed (8 files / 253 tests);
`git diff --check` passed; `pnpm run check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`pnpm run verify:compose-integrity` passed; the regenerated
`pnpm run oracle:less:byte-identity` passed with the named CST movement above;
and the serial `pnpm --filter @jesscss/language-service test` passed (13 files,
189 passed, 1 skipped). A prior language-service failure was invalid because it
ran while another command was cleaning/rebuilding CSS parser `lib/` artifacts.

Follow-up priority-marker cleanup: ordinary declaration `!important` recognition
now uses Parseman's `word('important', ..., { caseInsensitive: true })` in both
the public CSS CST grammar and the shared direct-AST recognition artifact. The
new public error fixture `important-boundary.css` pins that `!importantx` is not
accepted as a priority marker prefix. The direct CSS AST declaration calc route
also replaced its last `regex(/(?=calc\()/i)` opener probe with `peek(calcOpen)`,
so the glued function-token fact is represented by the same grammar structure
used by the calc rule itself.

The custom-property final-priority scanner deliberately remains a regex sentinel.
It must stop the opaque value scan before optional whitespace, `!`, comments or
CSS whitespace around `important`, trailing whitespace/comments, and the final
`;`/`}` boundary. That is not the same language as the ordinary `important`
keyword leaf, and flattening it to `word()` would lose the "only the final
marker is stripped" rule documented in css-syntax-3 §5.5.6.

Evidence for the priority-marker cleanup: targeted ESLint on
`packages/parser-shared/src/recognition.ts` and the touched CSS grammar files
passed; parser-shared and css-parser builds passed; the focused CSS parser set
covering public parse, AST grammar, conditional values, and macro compilation
passed (4 files / 213 tests); the public parse/AST/macro rerun with the new
error fixture passed (3 files / 107 tests); the full CSS parser suite passed
(8 files / 253 tests); `pnpm run check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages; `git diff --check`
passed; `pnpm run verify:compose-integrity` passed; and
`pnpm run oracle:less:byte-identity` passed after regenerating the baseline for
the single named corpus addition (`important-boundary.css`). The new 709-entry
baseline reports
`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`
with 120 AST throws and
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`
with 0 CST throws.

Follow-up direct-AST at-keyword cleanup: the shared direct-AST recognition
artifact now uses Parseman's `word(...)` / `keywords(...)` for fixed
case-insensitive CSS at-keywords and query-control keywords whose old regexes
were only spelling "keyword plus boundary". This includes the conditional
at-rules, page/margin at-rules, descriptor at-rules, layer/font-feature-values
at-rules, and `not` / `only` / `and` / `or` query controls. Where the old public
CSS regex used `(?![-\w])`, the replacement deliberately preserves that ASCII
boundary as `boundary: '-_0-9A-Za-z'` during the direct-route cutover; tightening
to the full CSS identifier boundary is a separate conformance change.

Rejected in the same pass: splitting vendor-prefixed `@keyframes` into
`choice(word('@keyframes', ...), regex(/@-[a-z]+-keyframes.../))`. Both arms
begin with `@`, so the split made Parseman's gating report worse without
removing a meaningful recognizer. Keep the combined keyframes regex until there
is a structured common-`@` spelling that preserves the CST leaf contract and
improves the diagnostics.

Parseman API note: the desired public Parseman shape is that both
`word(str, { caseInsensitive: true })` and
`makeWord(boundary?, { caseInsensitive: true })` are legal and remain
case-sensitive by default, consistent with `literal(...)` and `keywords(...)`.
Jess grammar files should not use module-scope `makeWord(...)` factory aliases:
after `parseman@0.38.0` was pinned, a macro probe showed that top-level
`const cssWord = makeWord(...); cssWord('@media')` leaves a runtime
`makeWord(...)` call after the macro import is stripped. A follow-up probe showed
that aliases declared inside a `rules(...)` factory do macro-lower, so the CSS
CST grammar now uses factory-local `asciiWord` / `identWord` helpers. Shared
recognition modules and other module-scope grammar fragments should keep direct
`word(...)` calls or direct chained `makeWord(...)(...)` until Parseman supports
module-scope word-factory lowering.

Evidence for the direct-AST at-keyword cleanup: targeted ESLint on
`packages/parser-shared/src/recognition.ts` and CSS `src/grammar.ts` passed;
parser-shared and css-parser builds passed; the focused CSS parser set passed
(4 files / 118 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with 0 interpreter fallbacks across parser-shared
and all four parser packages; `pnpm run verify:compose-integrity` passed;
`pnpm run oracle:less:byte-identity` passed byte-identical to the current
709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed.

Follow-up dispatch-design correction, 2026-07-26: now that `parseman@0.38.0`
is published and Jess pins it, exact keyword contexts can use
`word(..., { caseInsensitive: true })` directly. Do not extend that cleanup into
known-or-generic at-rule dispatch. CSS Syntax consumes `@scopeish` and
`@scopeé` as single `<at-keyword-token>`s with token values that do not match
`@scope`, while escaped spellings such as `@\73 cope` classify by token value.
That means the eventual AtRuleBlock/UnknownAtRuleBlock cleanup needs a Parseman
built-in that consumes one at-keyword token, classifies the normalized token
value, and commits matched known cases without falling through to the generic
unknown arm.

Recommended API spelling for the Parseman follow-up:

```ts
const AtRule = dispatch(
  atKeywordToken,
  when('@scope', sequence(scopePrelude, block)),
  when('@media', sequence(mediaPrelude, block)),
  otherwise(sequence(genericPrelude, block))
);
```

`when(...)` / `otherwise(...)` is preferred over `caseOf(...)`, `else(...)`, or
`default(...)`: `when` reads like a grammar clause, `else` is not a normal JS
exported function name, and `default` collides with real token values in a
generic dispatch table. A CSS-local `dispatchByAtKeyword(...)` helper is also
rejected; the primitive belongs in Parseman and should be macro-compilable.
Until then, treat leading `not(...)` guards around known at-rules as deliberate
spec-defense debt, not as cleanup targets.

Follow-up query comparison operator cleanup: CSS media/container range
comparison operators are now fixed-string Parseman `keywords([...])` terminals
in both the public CSS CST grammar and the shared direct-AST recognition
artifact. This replaces the hand-written alternation regexes
`/<=|>=|<|=|>/` / `/<=|>=|[<>=]/` while preserving the same single CST leaf
value and longest-first matching. A literal `choice(literal('<='), literal('<'),
...)` rewrite was tried first and rejected: it passed focused tests, but it
introduced new Parseman gating diagnostics on the shared `<` and `>` prefixes.
Left-factoring those choices would split one operator token into multiple
terminal leaves, so `keywords([...])` is the current best Parseman spelling.

Evidence for the query comparison operator cleanup: targeted ESLint on
parser-shared recognition and CSS grammar passed; parser-shared and css-parser
builds passed; focused CSS parser tests covering conditional values, public
parse, macro compilation, and public CST behavior passed (4 files / 145 tests);
the full CSS parser suite passed (8 files / 253 tests); `check:macro` passed
with 0 interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed before this evidence note was added.

Follow-up selector combinator cleanup: CSS selector combinators are now
fixed-string Parseman `keywords(['||', '>', '+', '~', '|'])` terminals in both
the public CST grammar and the direct AST grammar. This removes the old
`choice(literal('||'), ..., literal('|'))` overlap that Parseman reported as
`choice @ combinator`, while preserving a single terminal leaf for `||`.
Left-factoring `|` plus optional `|` would be the wrong CST shape; `keywords`
keeps longest-first fixed-token recognition without splitting the token.

Evidence for the selector combinator cleanup: targeted ESLint on the public CSS
grammar and direct AST grammar passed; parser-shared and css-parser builds
passed; focused CSS AST/public/macro/CST tests passed (4 files / 118 tests);
the full CSS parser suite passed (8 files / 253 tests); `check:macro` passed
with 0 interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed after this evidence note was added.

Follow-up selector token-set cleanup: attribute selector operators are now
fixed-string `keywords(['*=', '~=', '|=', '^=', '$=', '='])` in both the public
CSS CST grammar and the shared direct-AST recognition artifact. The AST-only
relative selector opener set (`>`, `+`, `~`) also moved from literal `choice` to
`keywords(['>', '+', '~'])`. These are fixed token sets, not regex-shaped
languages; `keywords` preserves one terminal leaf per operator/combinator while
making longest-first fixed-token recognition explicit. No public `urlOpen` split
was attempted here: that prior rejected path still needs imported-grammar
linkability and CST-shape review before it is safe.

Evidence for the selector token-set cleanup: targeted ESLint on parser-shared
recognition plus both CSS grammar files passed; parser-shared and css-parser
builds passed; focused CSS AST/public/macro/CST tests passed (4 files / 118
tests); the full CSS parser suite passed (8 files / 253 tests); `check:macro`
passed with 0 interpreter fallbacks across parser-shared and all four parser
packages; `verify:compose-integrity` passed; the Less byte-identity oracle
passed byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed after this evidence note was added.

Follow-up direct-AST body vocabulary cleanup: the private direct-AST at-rule body
helpers now use public-CST-aligned body-language names:
`declarationListBlock`, `descriptorBodyBlock`, `stylesheetBodyBlock`,
`pageBodyBlock`, `keyframesBodyBlock`, and `fontFeatureValuesBodyBlock`. The
old `css...Body` / `css...BlockTail` vocabulary has no remaining references.
This only renames private combinators and their local call sites; it does not
rename public `node('CssAst...')` keys, change reducers, or change the accepted
body languages.

Rejected in the same pass: using the Parseman dispatch design for CSS at-rules
before it is owner-published and pinned in Jess, and renaming typed at-rule node
keys such as `CssAstKeyframes` / `CssAstScopeBlock`. Dispatch needs the separate
at-keyword classifier/commitment batch; node-key movement needs a hostMode CST
contract migration.

Evidence for the direct-AST body vocabulary cleanup: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed before this evidence note was updated; old `css...Body` /
`css...BlockTail` helper names had no remaining references; dependency-ordered
`@jesscss/parser-shared` and `@jesscss/css-parser` builds passed; the generated
public CSS grammar bundle remained roughly 926.42 kB ESM; the focused CSS
AST/public/macro/CST/conditional set passed (5 files / 224 tests); the full CSS
parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and
`pnpm run oracle:less:byte-identity` passed byte-identical to the current
709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Follow-up direct-AST function-argument cleanup: the private direct-AST value
function family now shares the authored comma separator used by CSS value
lists. Known functions, generic glued functions, and identifier fallback routes
now use shared function argument combinators instead of restating the same
`field('separator', noTrivia(sequence(',', optional(cssValueTrivia))))` shape.
The glued opener is dispatched once with Parseman 0.40 so `url(`, `calc(`,
`var(`, generic functions, and generic identifiers do not compete as unrelated
choice arms.

The calc `var()` fallback empty sentinel now uses Parseman's `peek()` on `,` and
`)` instead of a regex lookahead, and the fallback comma/trivia separator is
factored as `varFallbackComma`. The nullable fallback list itself remains a
manual `item (comma item)*`: leading, trailing, and doubled empty fallback
components are intentional CSS custom-property fallback facts, so
`oneOrMoreSep(...)` would be a misleading abstraction here.

Rejected in the same pass: changing spaced `foo (bar)` handling. That is a CSS
component-value question, not a helper factoring.

Evidence for the direct-AST function-argument cleanup: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed before this evidence note was updated; dependency-ordered
`@jesscss/parser-shared` and `@jesscss/css-parser` builds passed; the generated
public CSS grammar bundle remained roughly 926.42 kB ESM; the focused CSS
AST/public/macro/CST/conditional set passed (5 files / 224 tests); the full CSS
parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST fixed at-rule body item-key cleanup: direct AST
keyframe blocks, page margin boxes, and font-feature-value child blocks now use
the same CSS concept keys as the public CST grammar: `keyframeSelector`,
`KeyframeBlock`, `MarginAtRule`, and `FeatureValueBlock`. This is a
rule-key/readability cleanup only; reducers and accepted syntax are unchanged,
including the reusable `Percentage` component for keyframe percentage selectors.

Rejected in the same pass: renaming full at-rule owner wrappers such as
`CssAstKeyframes`, `CssAstPageBlock`, `CssAstFontFeatureValuesBlock`, and
conditional/scope/layer/document blocks. Those still sit behind the broader
public `AtRuleBlock` CST shape and need the later at-rule-router fold.
**Superseded 2026-07-26:** those wrapper keys have now moved where the
top-level/nested distinction can stay visible in the concept name itself. The
known/generic at-rule router fold remains separate.

Evidence for the fixed at-rule body item-key cleanup: no
`CssAstKeyframeSelector`, `CssAstKeyframeBlock`, `CssAstMarginBox`, or
`CssAstFontFeatureValueBlock` references remain in CSS parser source or tests;
targeted ESLint on the direct CSS AST grammar passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST value cleanup: the grammar now uses the spec-shaped
generic value spine (`Value`, `ValueSequence`, `ValueList`) plus the smaller
`TypedValue*` family only for stricter typed-value sublanguages. Function and
identifier openers are routed through Parseman 0.40 `dispatch(...)`/`routed()`
instead of parallel known-function and generic-identifier choices.

Rejected in this pass: moving semicolon ownership into declarations.
Semicolons remain list separators, not declaration terminators owned by the
declaration rule.

Evidence for the declaration-value key cleanup: no old
`CssAstDeclaration*` rule references remain in CSS parser source or tests;
targeted ESLint on `packages/syntax/css/css-parser/src/ast/grammar.ts` and
`packages/syntax/css/css-parser/test/ast-grammar.test.ts` passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST query/supports helper-key cleanup: the direct AST
grammar now exposes the conditional-query and supports helper family under
spec-level names instead of AST-owner names: `QueryValue`,
`QueryBareFeature`, `QueryColonFeature`, `QueryComparisonFeature`,
`QueryRangeFeature`, `QueryFeature`, `QueryNonOnlyKeyword`, `QueryTerm`,
`QueryOnlyClause`, `QueryClause`, `QueryPrelude`, `QueryFunction`,
`GeneralEnclosed*`, `SupportsInParens`, `SupportsCondition`, and
`SupportsPrelude`. Recognition and reducers are unchanged; shared
`CssSyntaxQuery*` terminals remain prefixed because they are imported
recognition facts from `parser-shared`, not public owner rules.

Rejected in the same pass: renaming `CssAstConditionalBlock`,
`CssAstNestedConditionalBlock`, or the at-rule block owners. Those names belong
to the later at-rule router fold, where the grammar has to distinguish
top-level versus nested transparent bodies and known versus generic at-keyword
commitment in one place. **Superseded 2026-07-26 for rule keys only:** the
wrapper keys now use concept names, while the router/commitment rewrite remains
deferred.

Evidence for the query/supports helper-key cleanup: no `CssAstQuery`,
`CssAstSupports`, or `CssAstGeneralEnclosed` references remain in CSS parser
source or tests; targeted ESLint on the direct CSS AST grammar passed; focused
CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST keyword-leaf cleanup: the direct AST grammar now
exposes ordinary identifier component values as `Keyword` instead of
`CssAstKeyword`, and dashed custom-property identifiers used as component values
as `CustomPropertyValue` instead of `CssAstCustomPropertyValue`. Recognition is
unchanged and both reducers still emit core `Keyword` AST leaves.

Rejected in the same pass: merging `CustomPropertyValue` into `Keyword`, or
renaming the broader value/declaration-value/function/calc families. Dashed
identifiers are a distinct CSS syntax branch even though the emitted AST leaf is
a `Keyword`; the larger value families still carry strict calc and var-fallback
contracts that need their own review.

Evidence for the keyword-leaf cleanup: no `CssAstKeyword` or
`CssAstCustomPropertyValue` references remain in CSS parser source or tests;
targeted ESLint on the direct CSS AST grammar passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0); and tracked plus untracked-doc diff checks passed
before this note was added.

Follow-up CSS direct-AST lookahead cleanup: the direct CSS AST grammar no
longer has hand-written zero-width regex lookaheads. The dash-led raw pseudo
argument arm now reuses `g.CssSyntaxPseudoCloseAhead`, and the declaration
opaque slash boundary is a local `peek(choice('.', digit, whitespace))`
combinator. This keeps the same AST reducers and accepted language while making
the remaining lookahead facts Parseman grammar structure.

Rejected in the same pass: rewriting consuming whitespace or opaque-byte
terminals merely because they contain regexes. Those terminals own real bytes
and feed reducer child shape; this pass only replaces zero-width assertions.

Evidence for the direct-AST lookahead cleanup: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; no `regex(/(?=...)` lookaheads remain in CSS/parser-shared grammar
sources; dependency-ordered parser-shared and css-parser builds passed; focused
CSS AST/public/macro/CST/conditional tests passed (5 files / 224 tests); the
full CSS parser suite passed (8 files / 253 tests); `check:macro` passed with 0
interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS CST conditional top wrapper cleanup: the public CSS CST grammar
now spells `QueryAtRuleBlockTop` as the direct
`node('QueryAtRuleBlock', choice(...))` it already was semantically, removing
only a redundant `sequence(...)` around that `choice(...)`. This does not change
the public node key, accepted conditional at-rule arms, body languages, or
recovery behavior.

Rejected in the same pass: source-factoring the transparent top/nested known
block arms. The probe made the generated public CSS grammar larger and obscured
the frame-1/frame-2 distinction, so it is not part of the exemplary Parseman
cleanup direction. Keep this as a guardrail: shrinking source text by adding a
helper is not automatically a better grammar when the generated artifact grows
and the important spec boundary becomes less visible.

Evidence for the wrapper cleanup: focused CSS AST/public/macro/CST/conditional
tests passed (5 files / 224 tests); the full CSS parser suite passed (8 files /
253 tests); `check:macro` passed with 0 interpreter fallbacks across
parser-shared and all four parser packages; `verify:compose-integrity` passed;
and the Less byte-identity oracle passed byte-identical to the 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS CST custom-property conformance cleanup: the public CST
`customProp` terminal now matches the shared direct-AST dashed-ident shape for
custom-property names. This removes a base CSS mismatch where the CST route
accepted the reserved bare name `--` and rejected escaped custom-property names
such as `--\78`. The public regression test proves escaped names still produce a
`CustomDeclaration` and bare `--` is rejected.

Rejected in the same pass: widening the CSS base property recognizer for
compatibility hacks. CSS ordinary properties reuse `ident`; custom properties
use the separate escaped dashed-ident branch; Less/Jess interpolation and legacy
prefix quirks must stay dialect-local unless explicitly introduced as a named
CSS compatibility mode.

Evidence for the custom-property cleanup: focused public CST tests passed (1
file / 12 tests); dependency-ordered parser-shared and css-parser builds passed;
the full CSS parser suite passed (8 files / 254 tests); `check:macro` passed
with 0 interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST ruleset-key cleanup: the direct AST grammar now exposes
the qualified-rule owner as `Ruleset` instead of `CssAstRuleset`, matching the
public CST rule key and the normalized selector family. This does not change the
accepted ruleset language or emitted AST node; it only removes another obsolete
AST-local prefix from a shared CSS concept.

Rejected in the same pass: folding the ruleset opener into the transparent
at-rule block-tail helpers. The selector-to-`{` boundary deliberately uses
`interstitialTrivia` and preserves the CST-visible block-comment-before-brace
behavior, so only the grammar key was normalized.

Evidence for the ruleset-key cleanup: targeted ESLint on the direct CSS AST
grammar passed; `git diff --check` passed; no `CssAstRuleset` references remain
in CSS parser source; focused CSS AST/public/macro/CST/conditional tests passed
(5 files / 225 tests); dependency-ordered parser-shared and css-parser builds
passed; the serial full CSS parser suite passed (8 files / 254 tests);
`check:macro` passed with 0 interpreter fallbacks across parser-shared and all
four parser packages; `verify:compose-integrity` passed; and the Less
byte-identity oracle passed byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0). Ignore the earlier parallel full-CSS run that
failed with missing `lib/grammar.js`; it raced with compose-integrity's clean
rebuild and was invalidated by the serial rerun.

Follow-up CSS direct-AST root-key cleanup: the direct AST grammar now exposes
the stylesheet root as `Stylesheet` instead of `CssAstDocument`, matching the
public CST start rule and the core AST node emitted by the reducer. Public
`parse()` and direct AST tests now run `cssAstGrammar.Stylesheet`.

Rejected in the same pass: renaming `CssAstDocumentBlock`. That is the
document-at-rule block family, not the root stylesheet, and it still belongs to
the later at-rule block convergence work.

Evidence for the root-key cleanup: no `CssAstDocument` references remain in CSS
parser source or tests except intentional `CssAstDocumentBlock` references;
public `parse()` and direct AST tests run `cssAstGrammar.Stylesheet`; targeted
ESLint on the touched CSS AST/index/test files passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds passed; the full CSS
parser suite passed (8 files / 254 tests); `check:macro` passed with 0
interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST comment-key cleanup: the direct AST grammar now exposes
block-comment statements as `Comment` instead of `CssAstComment`. The rule still
recognizes the same `blockComment` token and still reduces through core
`comment(...)`; this is a rule-map/concept-key cleanup only.

Evidence for the comment-key cleanup: no `CssAstComment` references remain in
CSS parser source or tests; `src/ast/grammar.ts` now exposes `Comment` and all
call sites use `g.Comment`; targeted ESLint on `src/ast/grammar.ts` passed;
focused CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0); and both tracked plus untracked-doc diff checks
passed.

Follow-up CSS direct-AST pseudo-argument helper-key cleanup: the direct AST
grammar now exposes its pseudo-argument helper family under descriptive
unprefixed names: `PseudoArgument`, `OfTypePseudoArgument`,
`LeadingDashPseudoArgument`, `TypedNthPseudoArgument`,
`LeadingDashOfTypePseudoArgument`, `TypedOfTypePseudoArgument`,
`LeadingDashRawPseudoArgument`, `SelectorOnlyPseudoArgument`,
`GenericPseudoArgument`, and `RelativeComplexSelector`. These helpers are still
AST-local pseudo-argument machinery; the cleanup removes the obsolete `CssAst*`
mode/owner prefix without changing pseudo selector acceptance or emitted AST.

Rejected in the same pass: folding the helper family into a CST-public pseudo
argument rule. The helpers deliberately preserve typed An+B arguments,
selector-only pseudo args, relative `:has()` arguments, and raw fallback bytes
for the direct AST reducer; whether they become internal-only or shared
hostMode rules belongs to the later selector-family fold.

Evidence for the pseudo-argument helper-key cleanup: no old `CssAst*`
pseudo-argument helper names remain in CSS parser source or tests; targeted
ESLint on the direct CSS AST grammar passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS pseudo-function opener cleanup: the public CST and direct AST
pseudo selector rules now require functional pseudo names to be glued to `(` via
`noTrivia`, matching CSS function-token adjacency. Argument-internal spacing
remains valid (`:not( .a )`, `:nth-child( 2n + 1 )`, `:lang( en )`), while
spaced openers are rejected on both surfaces (`:not (.a)`,
`:nth-child (2n + 1)`, `:lang (en)`).

Rejected in this pass: using Parseman `dispatch(...)` for pseudo names. Pseudo
name dispatch may be useful later only with a glued function-token selector and
normalized identifier keys; this cleanup is the smaller spec-shaped adjacency
fix.

Evidence for the pseudo-function opener cleanup: targeted ESLint over the
touched CSS grammar and test files passed; focused CSS AST/conditional tests
passed (2 files / 187 tests); dependency-ordered parser-shared and css-parser
builds plus the full CSS parser suite passed (8 files / 256 tests);
`check:macro` passed with 0 interpreter fallbacks across parser-shared and all
four parser packages; `verify:compose-integrity` passed; and the Less
byte-identity oracle stayed output-neutral over the 709-entry baseline.

Follow-up CSS direct-AST function-call key cleanup: the direct AST grammar now
exposes ordinary glued function calls as `Call` and strict `calc(...)` calls as
`CalcCall`, matching the public CSS CST concept keys. Generic identifiers and
function openers are routed through the canonical Parseman 0.40
`dispatch(...)`/`routed()` shape, and reducers still emit core `FunctionCall`
AST nodes.

Rejected in the same pass: renaming `CssAstCalcParen` or collapsing the
`VarFallback*` family. Superseded 2026-07-26 for rule keys: strict calc math and
`var()` fallback now use concept keys.

Evidence for the function-call key cleanup: no `CssAstCall` or
`CssAstCalcCall` references remain in CSS parser source or tests; targeted
ESLint on `packages/syntax/css/css-parser/src/ast/grammar.ts` passed; focused
CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST at-rule prelude / opaque helper-key cleanup: direct
AST at-rule prelude and opaque block helpers now use concept names:
`AtPrelude`, `StatementPrelude`, `OpaqueAtPrelude`, `OpaqueBody`, and
`OpaqueAtRuleBlock`. This changes rule keys and diagnostics only; the
grammar-owned scans still reduce to the same nullable `Any` preludes or
canonical `OpaqueAtRuleBlock` AST node.

Rejected in the same pass: renaming import URL/tail helpers. Superseded
2026-07-26 for rule keys only: those helpers now use import-specific concept
names, but remain import-local covered facts rather than aliases for generic
`Url` or declaration-value URL parsing.

Evidence for the at-rule prelude / opaque helper-key cleanup: no
`CssAstAtPrelude`, `CssAstStatementPrelude`, `CssAstOpaqueAtPrelude`,
`CssAstOpaqueBody`, or `CssAstOpaqueAtRuleBlock` references remain in CSS parser
source or tests; targeted ESLint on the direct CSS AST grammar passed; focused
CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST at-rule wrapper-key cleanup: complete direct-AST
at-rule owner wrappers now use CSS concept keys instead of owner-prefixed
`CssAst*` keys: `LayerBlock`, `NestedLayerBlock`, `ConditionalBlock`,
`NestedConditionalBlock`, `DescriptorBlock`, `FontFeatureValuesBlock`,
`ScopeBlock`, `StartingStyleBlock`, `NestedStartingStyleBlock`, `PageBlock`,
`Keyframes`, and `DocumentBlock`. This is a rule-key/readability cleanup only:
reducers and accepted syntax are unchanged, and the `Nested...` names preserve
the real top-level versus nested transparent-body distinction.

Rejected in this pass: using Parseman `dispatch(...)` for the at-rule router,
or pretending these wrapper keys are now the public CST `AtRuleBlock` union.
Dispatch remains the right known/generic at-rule design, but CSS still needs a
normalized at-keyword selector value that preserves authored token bytes before
that rewrite is safe. `DocumentBlock` is the `@document` / `@-moz-document`
at-rule wrapper, not the root stylesheet (`Stylesheet`).

Evidence for the at-rule wrapper-key cleanup: no old wrapper-key names remain
in CSS parser source or tests; targeted ESLint on the direct CSS AST grammar
passed; focused CSS AST/public/macro/CST/conditional tests passed (5 files /
225 tests); dependency-ordered parser-shared and css-parser builds plus the
full CSS parser suite passed (8 files / 254 tests); `check:macro` passed with
0 interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST import helper-key cleanup: import-local direct-AST
URL and tail helpers now use import-specific concept names:
`ImportUrl`, `ImportUrlUnquoted`, `ImportTailRaw`, `ImportTailBody`, and
`ImportTail`. This is a rule-key/readability cleanup only. It does not merge
`@import` target parsing with generic declaration `Url`, and it does not change
the import tail's ownership of authored bytes after the import target.

Rejected in this pass: replacing the import-local target with generic `Url`,
dropping exact macro coverage for the import URL rules, or widening the cleanup
into declaration/calc value families. Import URL remains intentionally scoped:
it accepts the public grammar's comment trivia around `url` / `(` / payload /
`)`, while comments after the closing `)` stay owned by `ImportTail`.

Evidence for the import helper-key cleanup: no `CssAstImportUrl*` or
`CssAstImportTail*` references remain in CSS parser source or tests; targeted
ESLint on the direct CSS AST grammar and macro coverage test passed; focused
CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST generic value-spine cleanup: the generic CSS value
wrappers now use concept keys `Value`, `ValueSequence`, and `ValueList` instead
of owner/context-prefixed names. This is a rule-key and readability cleanup
only: the atom choices, authored adjacency handling, `oneOrMoreSep(...)`
comma-list shape, and reducers are unchanged.

Rejected in this pass: folding calc internals or `var()` fallbacks into the
generic value-spine rename. Superseded 2026-07-26 for calc arithmetic internals
only: strict calc arithmetic now uses `CalcValue`,
`CalcProduct`, and `CalcSum`. Superseded 2026-07-26 for rule keys:
`DeclarationValue*` and `VarFallback*` now use concept names too, while still
carrying real contextual language: permissive declaration component values and
lossless `var()` fallback bodies.

Evidence for the generic value-spine cleanup: no `CssAstValue*` references
remain in CSS parser source or tests; targeted ESLint on the direct CSS AST
grammar passed; focused CSS AST/public/macro/CST/conditional tests passed
(5 files / 225 tests); dependency-ordered parser-shared and css-parser builds
plus the full CSS parser suite passed (8 files / 254 tests); `check:macro`
passed with 0 interpreter fallbacks across parser-shared and all four parser
packages; `verify:compose-integrity` passed; and the Less byte-identity oracle
passed byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST calc arithmetic cleanup: strict `calc(...)` arithmetic
internals now use calc-scoped concept keys: `CalcParen`, `CalcValue`,
`CalcProduct`, and `CalcSum`. This is a rule-key/readability cleanup only:
operator parsing, precedence folding, parenthesized block reduction, and
`CalcCall` reduction are unchanged.

Rejected in this pass: folding `VarFallback*`, `VarCall`, or
declaration-value rules into ordinary calc arithmetic. `var()` fallback bodies
are component-value sequences, not ordinary calc arithmetic, and declaration
values remain the permissive declaration component-value language. Those need
separate accepted-language reviews.

Follow-up CSS direct-AST var() fallback key cleanup: grammar-owned `var()`
fallback rules now use CSS concept names `VarFallbackPunctuation`,
`VarFallbackParen`, `VarFallbackBracket`, `VarFallbackBrace`,
`VarFallbackCall`, `VarFallbackTerm`, `VarFallbackEmpty`, `VarFallbackItem`,
`VarFallback`, and `VarCall`. This removes both the stale `CssAst` prefix and
the misleading `Calc` prefix: the same fallback grammar is reused by strict
calc `var()` and declaration `var()` paths. This is rule-key/readability only;
fallback component recognition, delimiter guards, empty fallback handling,
comma preservation, and reducers are unchanged.

Rejected in this pass: collapsing the lossless `VarFallback*` family into the
generic value spine. `VarFallback*` stays context-owned because empty fallback
components and delimiter preservation are significant.

Evidence for the var() fallback key cleanup: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` and
`packages/syntax/css/css-parser/test/ast-grammar.test.ts` passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Evidence for the calc arithmetic cleanup: no `CssAstCalcParen`,
`CssAstCalcValue`, `CssAstMathProduct`, or `CssAstMathSum` references remain in
CSS parser source or tests; targeted ESLint on the direct CSS AST grammar
passed; focused CSS AST/public/macro/CST/conditional tests passed (5 files /
225 tests); dependency-ordered parser-shared and css-parser builds plus the
full CSS parser suite passed (8 files / 254 tests); `check:macro` passed with
0 interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up shared CSS recognition naming cleanup: `parser-shared` now exports
the CSS lexical artifact as `cssSyntax` and the pseudo-argument artifact as
`cssPseudoSyntax`, and their shared rule keys now use `CssSyntax*` instead of
`CssAstSyntax*`. Opaque CSS capture leaves likewise use concept names
(`OpaqueAtRulePreludeCapture` / `OpaqueAtRuleBodyCapture`). This removes the
false compile-mode word from shared recognition used by CSS, Less, SCSS, Jess,
and the SCSS CST grammar.

Rejected in this pass: renaming the exported direct AST grammar
`cssAstGrammar`, because that name is still consumed by current public parse
plumbing and direct AST tests until the one-file hostMode CSS grammar lands.
Also rejected: paying the remaining `lessAstSyntax` / `LessAstSyntax*` naming
debt inside a CSS-base batch; that belongs to the Less rebuild after CSS.

Evidence for the shared CSS recognition naming cleanup: no stale
`cssAstSyntax`, `cssAstPseudoSyntax`, `CssAstSyntax*`, `CssAstOpaqueCapture*`,
or `ScssAstSyntax*` references remain in parser-shared or parser source/tests;
targeted ESLint over parser-shared and all touched parser grammar/test files
passed; dependency-ordered parser-shared, CSS, Less, SCSS, and Jess parser
builds passed; full parser suites passed for CSS (8 files / 254 tests), Less
(6 / 439), SCSS (8 / 290), and Jess (6 / 248); `verify:types` passed all 12
production configs; `check:macro` passed with 0 interpreter fallbacks across
parser-shared and all four parser packages; `verify:compose-integrity` passed;
and the Less byte-identity oracle passed byte-identical to the current
709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up CSS direct-AST factory-name cleanup: the internal final local
`rules(...)` factory in `src/ast/grammar.ts` is now `cssFactory`, matching the
public CST grammar module's macro-visible factory name. The exported direct AST
artifact remains `cssAstGrammar` until the one-file hostMode CSS grammar can
retire the separate AST module.

Rejected in this pass: renaming `cssAstGrammar` or public test imports. That
would churn the transitional public parse path without reducing the eight-file
grammar count. The real deletion point is the hostMode collapse that compiles
one CSS source for both AST and CST.

Evidence for the factory-name cleanup: `rg` found no remaining old
direct-AST factory/self-type names in CSS parser source/tests or the active
grammar docs; targeted ESLint over the touched CSS parser source/test files
passed; `git diff --check` passed; dependency-ordered parser-shared and CSS
parser builds passed; focused CSS parser tests passed (5 files / 225 tests);
the full CSS parser suite passed (8 files / 254 tests); `check:macro` passed
with 0 interpreter fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle remained
output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0). A discarded parallel full-CSS-suite run failed
only because a concurrent macro check cleaned `lib/` while tests imported built
artifacts; the sequential rebuild plus full-suite rerun is the valid evidence.

Follow-up CSS test-helper naming cleanup: `test/macro-compiled.test.ts` now uses
local `CssGrammarModule` / `isCssGrammarModule` helper names around the
transitional `cssAstGrammar` export. The export spelling remains unchanged for
the same reason as above, but no test-local helper now advertises a private
CSS-AST naming scheme. Evidence: no `CssAst*` identifiers remain in CSS parser
source/tests except the deliberate `cssAstGrammar` export/import spelling;
targeted ESLint for `test/macro-compiled.test.ts` passed; and the focused macro
compiled CSS parser test passed (1 file / 10 tests).

Follow-up public/shared `url(` cleanup: the CSS CST grammar and shared
direct-AST recognition artifact now use `literal('url(', { caseInsensitive:
true })` for the glued opener. This is the accepted Parseman replacement for
`regex(/url\(/i)` because it preserves the one-leaf public CST opener while
removing the hand-written keyword regex. The earlier rejected rewrite remains
rejected: do not split public CST `url(` into `word('url')` plus `literal('(')`
until the hostMode grammar can preserve or intentionally migrate the public CST
shape.

Evidence: targeted ESLint over parser-shared, CSS grammar, and public CST test
files passed; dependency-ordered parser-shared/CSS parser build passed; focused
public CST coverage passed (1 file / 13 tests); the full CSS parser suite
passed (8 files / 257 tests); `check:macro` passed with 0 interpreter fallbacks
across parser-shared and all four parser packages; `verify:compose-integrity`
passed; `git diff --check` passed; and the Less byte-identity oracle remained
output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Follow-up shared/direct pseudo-colon adjacency cleanup: shared
`CssSyntaxPseudoColon`, the SCSS direct-AST local copy, and the Less direct-AST
static pseudo arms now use the same whitespace guard as the public CSS CST and
direct CSS AST grammar-local pseudo colon. Static direct-AST selectors therefore
reject whitespace-separated pseudo spellings (`.card : hover`,
`.card: hover`) instead of letting ambient trivia turn a whitespace token into
selector adjacency.

Rejected in this pass: changing Less public CST `pseudoColon`. That change moved
the Less CST oracle surface (`b990e139…` to `f23f61e…`, 437 entries moved), so it
was backed out. Public dialect CST pseudo-colon alignment remains dialect rebuild
work, not a CSS/shared direct-AST cleanup.

Evidence: targeted ESLint over parser-shared and the touched Less/SCSS/Jess
direct-AST grammar/test files passed; dependency-ordered parser-shared, Less,
SCSS, Jess, and CSS parser builds passed; focused Less, SCSS, and Jess AST
suites passed; focused CSS AST/conditional tests and Less/SCSS/Jess conditional
tests passed; `check:macro` passed with 0 interpreter fallbacks across
parser-shared and all four parser packages; `verify:compose-integrity` passed;
`git diff --check` passed; and the Less byte-identity oracle remained
output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

## 2026-07-26 CSS fold residue resolution

After the physical CSS hostMode fold, the Less byte-identity oracle had six
remaining CST-only moves while the AST surface stayed byte-identical. Those
entries were reviewed before updating the baseline:

- `node_modules/@less/test-data/tests-error/parse/at-rules-unmatching-block.less`
- `node_modules/@less/test-data/tests-error/parse/parse-error-media-no-block-2.less`
- `node_modules/@less/test-data/tests-error/parse/parse-error-missing-parens.less`
- `node_modules/@less/test-data/tests-unit/urls/actual.css`
- `packages/syntax/css/css-parser/test/css/errors/atrule-no-semicolon.css`
- `packages/syntax/css/css-parser/test/css/errors/charset.css`

The first three and the two CSS error fixtures are invalid-input CST/conformance
residue from the folded CSS recognition. `actual.css` contains an unterminated
upstream `url("data:...` tail; the folded CST surface now exposes the recovery
diagnostics at the abandoned tail. This was classified as public CST residue,
not an AST semantic change.

Evidence after dependency-ordered rebuild (`parser-shared` -> `css-parser` ->
Less oracle): `pnpm run oracle:less:byte-identity` passes against the updated
709-entry baseline with `aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`
and `aggCst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`
(AST threw 120, CST threw 0). `check:macro` is still red for the known SCSS and
Jess compose/build-resolvability failures; do not describe the repo-wide macro
gate as green from this CSS evidence.

## 2026-07-27 CSS value dispatch cleanup

The folded CSS grammar's declaration value route now uses reusable value
vocabulary instead of declaration-prefixed child names. `Value` is the atomic
CSS Syntax value rule; `ValueSequence` and `ValueList` are the surrounding
grouping rules and deliberately do not carry a `ComponentValue*` prefix.
`DeclarationValue` is only the parent declaration context. Identifier-shaped
values are parsed once by `identOrFunction` and routed with `dispatch(...)` to
`UrlFunction`, `CalcFunction`, `VarFunction`, generic function, or identifier
branches using `routed()`.

This is the canonical Parseman 0.40 shape for known-or-generic glued function
families: consume the opener once, dispatch on the routed value, and keep the
fallback from swallowing malformed known functions. Context-prefixed
declaration-value rule names are absent from CSS parser source/tests.

Evidence: the focused CSS public/AST parser set passed, the full CSS parser
suite passed (8 files / 261 tests), CSS parser build passed, `git diff --check`
passed, `pnpm run check:macro` passed with 0 interpreter fallbacks across all
parser packages, `pnpm run verify:compose-integrity` passed, and the Less
byte-identity oracle remained byte-identical over 709 entries with
`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929` and
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`;
the aggregate includes the later strict CSS calc invalid-fixture baseline
follow-up.

## 2026-07-27 CSS at-rule dispatch cleanup

The folded CSS grammar now routes non-conditional known/generic at-rules through
one `atRuleKeyword` opener and three context-specific dispatchers:
`StylesheetAtRule`, `DeclarationListAtRule`, and `ConditionalGroupAtRule`.
Branch nodes use `routed()` so the selected at-rule node owns the already-read
keyword. The old opaque-block guard was removed from `OpaqueAtRuleBlock`; the
generic at-rule terminal already excludes known block families.

This intentionally leaves `@media`, `@container`, and `@supports` on their
dedicated conditional rules rather than forcing them through the generic
at-rule router. Those rules own distinct prelude languages and malformed-header
diagnostics, so broadening `atRuleKeyword` to cover them would be a regression
in readability and error behavior.

Remaining design note: statement-or-block families such as `@layer x;` versus
`@layer x { ... }` still choose between statement and block branch nodes after
dispatch. A more aggressive no-rescan shape would need to preserve the public
`AtRuleStatement` versus `LayerBlock`/`PageBlock`/`Keyframes` CST ownership
while sharing the prelude scan. Do not collapse those into one node merely to
avoid the retry.

Evidence from the sidecar patch: `pnpm --filter @jesscss/css-parser build`
passed, the focused at-rule/CST/macro set passed (6 files / 234 tests), the full
CSS parser suite passed (8 files / 261 tests), and `git diff --check` passed.
