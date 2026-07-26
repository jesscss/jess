# Stage 3 Phase B — Partial findings from first dispatch (single-worktree)

Recorded 2026-07-25 in worktree `/private/tmp/jess-css-phase-b` at HEAD `044eb7452`.
This document records what the first Phase B dispatch discovered and did NOT land,
so the next dispatch does not re-pay the same discovery cost.

## Phase B feasibility verdict: GREEN (one caveat)

Probe: `composeLeaf([cssAstSyntax, rules({ trivia, hostMode: 'cst' }, factory)])`.

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

AST grammar `src/ast/grammar.ts` rule map exposes `CssAst*`-prefixed keys:
`CssAstDocument`, `CssAstComment`, `CssAstSelector`, `CssAstComplex`,
`CssAstCompound`, `CssAstSimple`, `CssAstAttribute`, `CssAstPseudo`,
`CssAstNestingSelector`, `CssAstProperty`, `CssAstCustomProperty`,
`CssAstCustomValue`, `CssAstKeyword`, `CssAstColor`, `CssAstUnicodeRange`,
`CssAstDimension`, `CssAstQuoted`, `CssAstUrl`, `CssAstCall`, `CssAstCalcCall`,
`CssAstCalcVar*` family, `CssAstDeclaration`, `CssAstImport`, `CssAstAtRuleStatement`,
`CssAstOpaqueAtPrelude`, `CssAstOpaqueBody`, `CssAstOpaqueAtRuleBlock`,
`CssAstQueryBareFeature`/`RangeFeature`/`Comparison`/`Prelude`/`Clause`/`Term`,
`CssAstGeneralEnclosed*`, `CssAstSupportsCondition`/`InParens`/`Prelude`,
`CssAstLayerBlock`, `CssAstNestedLayerBlock`, `CssAstConditionalBlock`,
`CssAstNestedConditionalBlock`, `CssAstDescriptorBlock`, `CssAstPageBlock`,
`CssAstKeyframeSelector`, `CssAstKeyframeBlock`, `CssAstKeyframes`,
`CssAstRuleset`, `whitespace`.

**Notable divergences:**
- The CST has ONE `AtRuleBlock` rule that is a UNION of all the conditional-group
  at-rules (layer / supports / starting-style / media / etc.), emitting a single
  CST `grammarType='AtRuleBlock'` → public `AtRule`. The AST splits these into
  SEPARATE typed rules — `CssAstLayerBlock`, `CssAstConditionalBlock`,
  `CssAstScopeBlock`, `CssAstStartingStyleBlock`, `CssAstPageBlock`,
  `CssAstFontFeatureValuesBlock`, `CssAstDocumentBlock`, `CssAstKeyframes`,
  `CssAstOpaqueAtRuleBlock`, `CssAstAtRuleStatement`, `CssAstImport`. Each emits
  its OWN typed AST node.
- The CST exposes a `SelectorList` rule (`node(sequence(...))`); the AST does NOT
  have a `CssAstSelectorList` rule — instead the AST's pseudo / ruleset arms
  inline-build `selist(...)` directly via `complexCanonical`/`selectorComplexes`.
- The AST has no `CssAstQueryAtRuleBlock`; the CST has `QueryAtRuleBlock`.
- The AST has no `CssAstUnknownAtRuleBlock`; the CST has `UnknownAtRuleBlock`.
- The AST has a `CssAstCalcVar*` family (~10 rules) with no CST analog — they
  are the diagnosis §3 "true AST-only substructure"; CST absorbs calc via raw
  `scanTo`/`balanced` capture.

## Consumer-contract test (c) — grep-confirmed

less-parser (`packages/syntax/less/less-parser/src/grammar.ts`) and jess-parser
(`packages/syntax/jess/jess-parser/src/grammar.ts`) consume `cssGrammar` from
`@jesscss/css-parser/grammar`. They reference rule names on `g.<Name>` after
`compose([cssGrammar, lessDelta])` (= the Less CST surface `parseLessCst`).

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
(less references `CssAstSyntax*` only via the shared-recognition `cssAstSyntax`
piece, not via the CSS grammar's rule map. Confirmed by:
  `grep -oE "CssAst[A-Z][a-zA-Z]+" packages/syntax/less/less-parser/src/grammar.ts
   packages/syntax/jess/jess-parser/src/grammar.ts | grep -v CssAstSyntax`)

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
This first dispatch's成果 is the feasibility finding (probe verdict), the
consumer-contract (c) evidence (less and jess NEVER reference `CssAst*` rules
directly — they compose opaquely through `compose([cssGrammar, delta])`), and
the structural-divergence evidence (the rule lists don't match 1:1).
