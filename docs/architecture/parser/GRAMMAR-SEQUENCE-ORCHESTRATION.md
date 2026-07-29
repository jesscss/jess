# Four-grammar rewrite orchestration review

Initially recorded from a temporary sequence-review worktree at
`52db1e0722561bfa46e550988da5abaf260e4bc4` (`origin/dev`, 2026-07-25
checkout state). The visible checkout at `/Users/matthew/git/oss/jess` is the
current integration surface for owner corrections and agent output. Future
subagent WIP should happen in named worktrees and merge back here only after the
relevant gates pass. This note is the critical approach review for the full
`css -> less -> scss -> jess` cleanup sequence. It is not a replacement for
`docs/design/GRAMMAR-REBUILD-SPEC.md`; it is the current orchestration decision
after reading the Stage 3 CSS Phase A/B evidence.

## Current floor

The rewrite is no longer blocked on the original host-mode prerequisite.
`parseman@0.41.0` is published and installed from the registry. The root
manifest, `@jesscss/parser-shared`, and all four parser package dependency/peer
ranges require `^0.41.0`; `pnpm-lock.yaml` resolves the active checkout to
`parseman@0.41.0`.

The current floor includes the earlier architecture features (`hostMode`, `peek`,
`oneOrMoreSep`, `analyzeGatingRules`, `analyzeDuplicationRules`) plus the
keyword ergonomics needed for grammar cleanup:
`word(str, { caseInsensitive: true })`,
`word(str, boundary, { caseInsensitive: true })`, and
`makeWord(boundary?, { caseInsensitive: true })`. Defaults remain
case-sensitive across the API. Parseman 0.41.0 also provides the complete
grammar-routing and projection surface this rebuild should use:
`dispatch(combinator, when(...), otherwise(...))`,
`when(..., { caseInsensitive: true })`, `makeWhen(...)`, string-array cases,
matcher cases such as `when(endsWith('('), tail)`, `routed()`, and
`node(..., { project: index })` for simple semantic projection without hiding
CST ownership.

Use dispatch when one grammar position accepts a shared token family and then
routes by the value already consumed. The routing combinator is ordinary
Parseman grammar: parse shared structure outside the dispatcher, consume the
smallest decisive combinator once, and let the branch table decide what tail
owns that routed value. The generic case belongs inside the same
`dispatch(...)` through `otherwise(...)`; do not keep a separate outer generic
`choice(...)` arm for the same token family. A matched `when(...)` commits to its
tail, so malformed known syntax does not fall through to generic syntax.
This is the scannerless Parseman story: the grammar does not need a separate
tokenizer to get token-like routing. It can route at the meaningful grammar
boundary after a shared prefix has been consumed, so overlapping lexical shapes
do not automatically imply broad backtracking.

Current integration warning: the physical fold blocker is paid: CSS, Less, SCSS,
and Jess now each ship AST and CST from one host-mode grammar source. Older
green Less byte-identity evidence below is historical evidence for the batches
that produced it, not a standing claim about the current dirty checkout. Before
integrating a CSS/Less slice, rerun the Less oracle and compare named moved
entries. The active blocker is quality debt in the surviving grammar files plus
any newly observed oracle movement in the current integration surface.

Owner priority pivot, 2026-07-27: the grammar fold is no longer the work's main
center of gravity. The current alpha.1 priority is CSS/Less stabilization and
the end-to-end Less alpha flow. Grammar cleanup continues as a side lane when it
supports stability, diagnostics, performance, or readability, but it must not
displace unclassified CSS/Less parser failures, Less compatibility/oracle
movement, or parser/eval error blockers.

Current priority order:

1. Stabilize the CSS and Less grammars. CSS must stay spec-conformant; Less
   behavior must align with the Less v5 alpha target, and any Less deviation
   from CSS must be explicit near the override.
2. Rebuild and re-test the full flow in dependency order: parser-shared, CSS
   parser, Less parser, core/eval/render, plugins, the jess package, and the
   Less v5 alpha fixture/oracle path. Parser-local green tests are not enough
   if the alpha flow is red.
3. Treat parser/eval error quality as the main Less alpha.1 blocker. Improve
   diagnostics, recovery boundaries, invalid-input behavior, and eval/runtime
   errors without weakening grammar conformance or hiding failures in baseline
   churn.

Side-lane grammar cleanup still matters: comments are trivia, not semantic AST
nodes; short spec-aligned production names beat migration prefixes; `Value` is
one atomic value piece while `ValueSequence` and `ValueList` compose values; and
Parseman 0.41+ idioms such as `dispatch(...)`, `routed()`, `makeWhen(...)`,
`word(...)`, separated-list helpers, and composition should be used where they
remove real duplicated recognition or make the grammar clearer.

Scanner cleanup priority, 2026-07-29: treat `scanTo(..., { skip })` and
`balanced(..., { skip })` as review findings, not neutral plumbing. The first
question is whether the bytes can be parsed as structured grammar or handled by
the grammar's trivia / ambient `scanSkip`; only keep a scanner-local skip when
the scanner is still the narrow accepted representation and a comment, quote, or
balanced group must not terminate that specific opaque span. Do not tune a
scanner skip list as a substitute for moving the language back into grammar
structure. In the same pass, keep burning down false migration prefixes and use
`dispatch(...)` only when `choice(...)` is truly re-reading one broad routed
opener with known cases plus a same-family generic fallback.

Current scanner-skip inventory, 2026-07-29: CSS custom/value scans are now mostly
reduced to local balanced-group exceptions, with `customSlash` kept only inside
the reusable balanced helpers. The remaining CSS pseudo raw-argument scan still
uses a local quote/balanced/comment policy and should be reviewed separately
against the pseudo argument grammar, not swept together with custom values.
`packages/parser-shared/src/opaque-at-rule.ts` remains the shared opaque
at-rule capture hotspot: its CSS and preprocessor bodies are accepted opaque
exceptions for now, but they should move toward a trivia-aware structured
unknown-at-rule helper before adding more scanner policy there. Less
`lessOpaqueBodyBrace`, `lessOpaqueBodyCapture`, and `atPreludeGroup` now inherit
the root ambient `scanSkip`; the remaining Less scanner debt is the
function-condition lookahead scan and the larger opaque-helper design, not local
string/comment skip duplication. SCSS `QueryFunction` and Jess generic pseudo
raw arguments are separate follow-ups: SCSS has ambient scan skips but also
routes through composed quoted syntax, while Jess currently lacks a root
`scanSkip` policy and must decide that grammar shape before shrinking the pseudo
scanner.

Live alpha evidence, 2026-07-27: registry `parseman@0.41.0` is installed;
dependency-order parser/plugin/jess builds pass; `pnpm run check:macro` and
`pnpm run verify:compose-integrity` both pass with 0 interpreter fallbacks.
`pnpm run verify:less-alpha` passes its Less parser, Less plugin, `jess`,
package-export, public-API, path-resolution, Less test-data unit, and Less
test-data config lanes. The broader error sanity gate also passes:
`all-less-error.test.ts` is **94 / 94** after recursive variable/property
fixtures graduated from the worker-hang skip list.
`pnpm run oracle:less:byte-identity` remains red against the committed baseline;
that is the active parser-surface classification queue, not permission to
recreate duplicate grammars or semantic comment nodes.

Simple cases should be written directly in docs and small grammars:

```ts
const AtRule = dispatch(
  atKeywordToken,
  when('@media', MediaTail, { caseInsensitive: true }),
  when('@supports', SupportsTail, { caseInsensitive: true }),
  otherwise(GenericAtRuleTail)
);
```

Repeated tables should centralize the shared policy with one grammar-local
helper:

```ts
const caseOf = makeWhen({ caseInsensitive: true });

const AtRule = dispatch(
  atKeywordToken,
  caseOf('@media', MediaTail),
  caseOf('@supports', SupportsTail),
  otherwise(GenericAtRuleTail)
);
```

Do not create separate `pseudoCase`, `fnCase`, `atCase`, etc. helpers when they
share the same case sensitivity and matching policy. Domain-named helpers are
fine in explanatory examples, but the actual Jess grammars should prefer one
helper per real policy. The same rule applies to `makeWord(...)`: prefer one
dialect-local `word` helper for the dominant boundary/case policy, and introduce
another helper only when the language truly needs a different boundary or case
policy.

Function-token routing is a first-class pressure test for this shape. The case
key must include the glued opener, e.g. `when('url(', urlTail, {
caseInsensitive: true })`. Case matching is exact equality on the full matched
value after the requested comparison mode; it is never prefix matching. That
means `url(` can route to the URL tail while `url (` cannot match that case.
The routed value still has to preserve the authored spelling and span needed by
AST/CST construction.

The broader Parseman design target is lexical-shape dispatch: consume the
smallest decisive token shape once, then route on that whole value. If the
grammar has a shared prefix before the decisive marker, keep that prefix in the
surrounding `sequence(...)` and dispatch only on the marker or token whose value
chooses the tail. For CSS identifier/function positions, the routing combinator
should consume either an ident (`red`) or a glued function opener (`url(`) in
one pass:

```ts
const IdentOrFunctionValue = dispatch(
  identOrFunctionOpen(cssIdent),
  when('url(', urlTail, { caseInsensitive: true }),
  when('calc(', calcTail, { caseInsensitive: true }),
  when('var(', varTail, { caseInsensitive: true }),
  when(endsWith('('), genericFunctionTail),
  otherwise(keywordTail)
);
```

This avoids both keyword-first and function-first rescans. Plain identifiers
route to `otherwise(...)`; special function openers route to exact committed
tails; every other `name(` routes to the generic function tail.

When the branch node needs the already-consumed token as one of its own CST/AST
children, put `routed()` inside that branch node rather than reparsing the token:

```ts
const caseOf = makeWhen({ caseInsensitive: true });

const UrlFunction = node('UrlFunction',
  sequence(routed(), urlTail, literal(')')),
  children => urlFunction(children[0].value.slice(0, -1), children[1])
);

const Identifier = node('Identifier',
  routed(),
  children => identifier(children[0].value)
);

const Value = dispatch(
  identOrFunctionOpen(cssIdent),
  caseOf('url(', UrlFunction),
  when(endsWith('('), GenericFunction),
  otherwise(Identifier)
);
```

Pseudo selectors are the same pattern with a colon prefix. A selector can
consume `:`/`::` plus either a bare pseudo name (`:hover`) or a glued
pseudo-function opener (`:is(`, `:nth-child(`) once, then dispatch exact special
pseudo functions, a generic function bucket, and an otherwise bare-pseudo tail.
That removes repeated colon/name recognition across nth, selector-argument,
generic functional, and bare pseudo arms while keeping malformed special
pseudos from falling through to generic. The same lexical-shape dispatch pattern
should also be pressure-tested for call/reference boundaries in the preprocessor
dialects and other places where punctuation changes the grammar owned by an
otherwise identifier-shaped token.

The current grammar file count is **four**: each dialect has one source grammar.
Do not recreate a second grammar body to satisfy a stale CST or AST assertion;
fix the surviving host-mode grammar and its tests.

| dialect | CST lines | AST lines |
| --- | ---: | ---: |
| css | `src/grammar.ts` | deleted |
| less | `src/grammar.ts` | deleted |
| scss | `src/grammar.ts` | deleted |
| jess | `src/grammar.ts` | deleted |

This makes the remaining target concrete: four folded grammar factories must
become small, readable, well-documented, and idiomatic Parseman 0.41 grammars.

## Current copy/paste goal

Act as the grammar-cleanup orchestrator in `/Users/matthew/git/oss/jess`.
Assume the physical eight-to-four fold is complete: CSS, Less, SCSS, and Jess
each ship AST and CST from one `src/grammar.ts`, and the deleted
`src/ast/grammar.ts` files are historical evidence only. The active objective is
to make the four surviving grammars exemplary Parseman 0.41 grammars.
Do not spend effort re-planning the fold or reviving old AST/CST grammar pairs;
the fold is paid, and all remaining work happens inside the four surviving
host-mode grammar bodies plus their direct tests/docs.

Coordinate roughly six focused agents from `origin/dev` worktrees and integrate
stable slices back through the local dev surface. Keep CSS/Less as the alpha
bar, but continue repairing SCSS/Jess rather than restoring duplicate grammar
bodies. For each grammar family, review every `const` against
`docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md`: use spec/simple names,
delete `CssAst*`/`Direct*`/mode prefixes unless they prove a real accepted
language divergence, document deviations with JSDoc, and replace duplicated
known-or-generic choices with current Parseman `dispatch(...)`, `makeWhen(...)`,
`routed()`, matcher cases, `word(...)`, `keywords(...)`, and separated-list
helpers where they are the better shape. Parse shared openers once; do not
reparse selectors, values, at-rules, functions, pseudos, variables, or
interpolation after recognition. Treat every explicit `scanTo(..., { skip })`
or `balanced(..., { skip })` as a small design review: first ask whether the
region can become structured grammar or rely on trivia / ambient `scanSkip`,
then keep only scanner-local exceptions needed by a still-deliberate opaque
span. Dispatch is not a blanket replacement for `choice(...)`; use it where a
shared already-consumed token can be refined and routed, and keep `choice(...)`
for truly disjoint constructs, closed spelling tables, lists, and context
decisions whose delimiter has not been consumed yet.

Current priority order: finish CSS value/at-rule/pseudo cleanup, aggressively
simplify Less value/function/selector/at-rule families on the single grammar
source, then clean SCSS and Jess without reintroducing Less inheritance. Gates
for any integrated slice: package build for touched parser(s), focused parser
tests, `pnpm run check:macro` with 0 interpreter fallbacks,
`pnpm run verify:compose-integrity`, and `pnpm run oracle:less:byte-identity`
when CSS/Less/parser-shared behavior can move.

Jess dispatch caveat from the first value pass: routing a small
custom-property/keyword token family with `dispatch(...)` and `routed()` is safe
and covered. The larger motivating identifier-or-function cascade is still a
follow-up because the first probe exposed CST recovery that could turn a
malformed generic function body into an empty public CST instead of a diagnostic.
Do not force that shape into Jess until branch-failure ownership is designed and
tested.

CSS at-rule dispatch status: non-conditional known/generic at-rules now route
through one `atRuleKeyword` opener and the `StylesheetAtRule`,
`DeclarationListAtRule`, and `ConditionalGroupAtRule` dispatchers. Conditional
`@media`, `@container`, and `@supports` deliberately remain on dedicated routes
because their prelude languages and malformed-header diagnostics differ. The
next at-rule improvement is not a cosmetic helper; it needs a shape that can
share the statement/block prelude scan while preserving public CST ownership of
`AtRuleStatement` versus block nodes.

Header/discoverability slice: the four surviving grammar headers now carry the
agent-readable links required by the rebuild spec. CSS names its Less, SCSS, and
Jess grammar dependents by repo-relative path; Less, SCSS, and Jess name the CSS
base and summarize their local deltas. The obsolete Less
`lessFoldProbeCstGrammar` export is gone; tests and public CST parsing use
`lessCstGrammar` directly.

Current prefix inventory, 2026-07-29: CSS is clean for `CssAst*` in
`packages/syntax/css/css-parser/src/grammar.ts`, and Less is clean for
`DirectLess*` / `directLess*` in
`packages/syntax/less/less-parser/src/grammar.ts`. The remaining dialect
grammar source prefix debt should burn down by reviewed families, not by blind
whole-file replacement. Current counts are: SCSS is clean for
`DirectScss*` / `directScss*` in
`packages/syntax/scss/scss-parser/src/grammar.ts`, and Jess is clean for
`DirectJess*` / `directJess*` in
`packages/syntax/jess/jess-parser/src/grammar.ts`. Use these as a progress
inventory, not an acceptance metric; a name may remain only when the rule really
recognizes a dialect-specific language shape and that divergence is documented
near the rule.

Less naming/composition rule, 2026-07-27: `DirectLess*` is migration scaffolding,
not grammar vocabulary. When a Less rule is the dialect version of a CSS
production, give it the CSS production name so a composed grammar can override
that rule directly. When a rule is genuinely Less-only, use the short language
concept name without a dialect prefix. The current import cleanup follows that
shape: Less `@import` is `ImportStatement`, its option/target/tail helpers are
`ImportOptions`, `ImportTarget`, and `ImportTail`, and the static postlude
helpers are `StaticTail*`. The same cleanup renamed the value leaf helpers
(`UnicodeRange`, `EscapeValue`, `PercentEscape`, `ValueComment`, `PagePseudo`,
`DoubledQuoteArgument`) and the Less interpolation/reference family
(`VariableReference`, `PropertyReference`, `VariableInterpolation`,
`PropertyInterpolation`, `Interpolation`, `AtRuleInterpolation`,
`ReferenceTail`, `InterpolatedValue`, `InterpolatedProperty`). The Less value
family follows the CSS naming ladder: `Value` is one value piece; `ValueSequence`
and `ValueList` are grouping combinators over value pieces, not a second
list-level concept named "value". Do not introduce
replacement adjective stacks such as `DirectLess...`, `LessDirect...`, or
mode-prefixed aliases.

Less import routing audit, 2026-07-29: `.less` import spelling is `@import` or
`@-import`; `@-export` is not implemented for Less and must not be accepted as a
Less import synonym. The grammar currently preserves `@import` / `@-import` in
one `ImportAtRule` fact with typed options, target, and tail. The later import
bridge applies the CSS-pass-through versus source-fold heuristic from that fact,
but it does not yet give `@-import` its distinct explicit source-fold route.
That is the remaining fix: parse the import head once, keep option/target/tail
facts typed, and route bare `@import` through the Less heuristic while routing
`@-import` through the explicit-fold path. Do not re-scan source text to recover
the distinction, and do not add Less `@-export` while doing this.

Active orchestration note, 2026-07-27: keep roughly four current sidecars on
disjoint grammar-polish slices when the tool pool allows. The current pool is
Less dispatch cleanup, CSS gating cleanup, SCSS Less-composition cleanup, and
Jess dispatch/naming cleanup. Close completed agents quickly so stale threads do
not occupy the concurrency limit.

Dispatch/routed performance note, 2026-07-27: treat `dispatch(...)` as the
highest-value cleanup when a grammar has a real shared opener and the old shape
would re-read or backtrack through sibling arms. Do not turn this into a blanket
rewrite rule. Literal-to-literal tables, disjoint first-set alternatives, closed
keyword sets, and first-arm-dominant choices with cheap tails are good
`choice(...)` / `keywords(...)` shapes; Parseman's choice compiler already has
first-set, literal, greedy-classify, and shared-prefix strategies for those. The
dispatch win is the broad-opener case:
for example `choice(Function, Identifier)` where the function arm consumes an
identifier and then fails at `(` for bare keywords, or known/generic at-rules
that all begin with the same at-keyword family. The rule for agents is: use
dispatch for obvious known-or-generic at-rules, glued functions, pseudos, and
variable/reference families where it removes actual speculative recognition;
parse any non-decisive shared prefix outside the dispatcher; route on the
smallest meaningful routed combinator; and reject dispatch when the choice is
already first-set gated or the routing combinator is broader than the ambiguity
it replaces. No speed claim belongs in Jess docs without an interleaved A/B on
the touched parser workload.

Rejected dispatch/word probes, 2026-07-27: two tempting cleanups were tested and
should not be repeated as mechanical Parseman-0.40 rewrites. First, CSS
`Declaration` must not dispatch on property name alone. Focused CSS tests caught
the error with `b:c { ... }`: the property-shaped opener can still belong to a
nested ruleset, so a declaration-local dispatcher commits before the enclosing
body has enough syntax to decide. That needs a context-owned declaration/ruleset
left-factor helper, not `dispatch(propertyName, ...)`. Second, the Less
function-condition sentinels for `and`/`or` are not currently byte-neutral as
plain `word(...)` rules. Focused Less parser tests passed, but the Less CST
oracle moved from the current folded aggregate
`8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698` to
`41dbb1d5aa260646bebbf96b55c7bae1854431a4dd29af47353f2af6f5c6679f`. Keep the
regex sentinels until a public-CST ownership-preserving helper is designed.

Less functional-pseudo dispatch slice, 2026-07-27: pseudo-functions follow the
same glued-opener rule as ordinary functions. `name(` and `:name(` are complete
opener shapes; `name (` and `:name (` are not the same syntax. `:not(`,
`:lang(`, nth-family pseudos, and special pseudo-like routes such as Less inline
`:extend(` must consume the colon, name, and opening paren without ambient trivia
between the name and `(`. Route ordinary pseudo names by the already-consumed
`:name` / `:name(` opener and then branch to selector-valued, static-argument,
interpolation-bearing, or bare-pseudo nodes using `routed()`. Selector-capture
pseudos stay static-only. Agents should copy that boundary: dispatch the
decisive glued opener, not bare `:` / `::`, and never weaken
`:extend /*...*/ (` or `:not /*...*/ (` into an accepted pseudo/comment spelling.

Less declaration cleanup sequence, 2026-07-27: declarations are the next better
target than static pseudos. Move semicolon ownership out of
`CustomDeclaration`, `DirectLessStandardDeclaration`, and
`DirectLessPunctuationMapDeclaration` into the containing statement/list
wrappers first. Then replace broad interpolated-property lookahead with a single
owned property-name production that can return either a string or interpolation.
Only after that head production exists should custom-vs-ordinary Less
declarations be reviewed for dispatch; until then, ordered `choice(...)` is the
more honest shape. CSS `Declaration` remains a valid `choice(...)` / light
left-factor target, not a dispatch hotspot.

SCSS Less-leakage regression slice, 2026-07-27: the compose-integrity test now
asserts that folded SCSS does not expose Less-only grammar keys such as
`DetachedRuleset`, `AnonymousMixinDefinition`, `ExtendStatement`, `EachFor`,
`VarCall`, or `VariableCall`, and it rejects Less-only rule-body forms such as
`.a { .mixin(); }`, `.a { .mixin(1, 2); }`, and
`.a { &:extend(.b all); }` through both public CST and AST recognition. Focused
verification: `pnpm --filter @jesscss/scss-parser test --
test/compose-integrity.test.ts --reporter=dot` passes (2 tests). This is only a
guardrail; SCSS grammar naming and shape cleanup remains open.

Rejected Parseman-idiom probe: rewriting CSS `SupportsCondition` from
`SupportsInParens (and|or SupportsInParens)*` to a direct `oneOrMoreSep(...)`
branch is readable, but the Vite macro path rejected the shape with
`composeLeaf() must macro-fuse`. Keep the current explicit sequence until the
macro supports that exact helper position or the rule is refactored through a
shape that both tsdown and Vite macro transforms lower identically.

Rejected Less separator-helper probe, 2026-07-27: the four comma-prelude rules
`QueryPrelude`, `MediaQueryPrelude`,
`ContainerQueryPrelude`, and `DirectLessStaticAtRulePrelude` are real
comma-separated lists, but direct `oneOrMoreSep(item, field('separator',
regex(/,[ \t\n\r\f]*/)))` rewrites are not currently byte-safe. Focused Less
parser tests still passed (5 files / 436 tests), but
`pnpm run oracle:less:byte-identity` moved from the known folded aggregate to
`ast=a33ac0351a3ec69acdafd8c097b13c47d7a1f78da0b6d0a389d4413cfc870eed`
with 116 throws and
`cst=f6362fc6f1b863bb145ce0b9a9140b6972c75dacf13b38b9744018e252a806dd`
with 0 throws. Keep the explicit
`sequence(item, many(sequence(field('separator', ...), item)))` form until the
list helper can preserve the needed separator field/CST ownership or the public
CST baseline is intentionally migrated. Do not accept this cleanup from an
agent without an oracle diff that names the moved entries.
This was rechecked with the same result after Parseman 0.40 was pinned: the
focused Less parser set stayed green, but the oracle moved to the same
`a33ac035...` / `f6362fc...` pair, so the explicit Less prelude shape remains a
known compatibility keeper.

Current gate evidence for the folded grammar baseline: `find packages/syntax
-path '*/src/ast/grammar.ts' -print` returns no grammar files. Fresh checks in
the integration checkout on 2026-07-27: the focused CSS parser route
(`cst-public.test.ts public-parse.test.ts ast-grammar.test.ts
macro-compiled.test.ts`) passes 133 tests, and the full CSS parser suite passes
8 files / 269 tests. `pnpm run check:macro` reports parser-shared, CSS, Less,
SCSS, and Jess fully compiled with 0 interpreter fallbacks; CSS specifically
reports 10412 `charCodeAt` vs 931 `RegExp.exec`. `pnpm run
verify:compose-integrity` passes after dependency-ordered rebuild. `pnpm run
oracle:less:byte-identity` still fails against the committed baseline, but the
aggregate remains the known dirty folded surface:
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and 10 moved entries, and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws and 531 moved entries. CSS/Less are the alpha bar; SCSS/Jess may
be repaired in follow-up slices, but no second grammar body should be restored
to get there.

Relevant worktree context: active Jess edits are currently in the visible
checkout at `/Users/matthew/git/oss/jess`. Treat older temporary worktrees as
evidence only after rereading their current diffs; do not continue hidden
grammar edits there.

Going forward, grammar WIP should happen in named per-agent worktrees branched
from `origin/dev`. The orchestrator integrates those branches back into `dev`
only after the relevant grammar gates pass, then syncs the local `dev` checkout
to that merged state. The visible `/Users/matthew/git/oss/jess` checkout should
be an integration/sync surface, not a long-lived pile of unrelated WIP.

## Parseman-versioned benchmark ledger

Do not claim that a grammar batch is faster because it uses a newer Parseman
shape. For every batch that changes the pinned Parseman version or replaces
repeated token-family `choice(...)` arms with `dispatch(...)`, record a small
benchmark row before and after the batch in
[`PARSEMAN-BENCHMARK-LEDGER.md`](./PARSEMAN-BENCHMARK-LEDGER.md). The Jess parser
row source is `packages/syntax/jess/jess-parser/test/parse-bench.mjs`.
For Less parser batches, use
`packages/syntax/less/less-parser/test/ab-compare.mjs`; it snapshots the
parser-shared, CSS parser, and Less parser grammar source set together before
alternating HEAD and the working tree. A Less A/B run that swaps only
`less-parser/src/grammar.ts` is invalid during this rewrite, because CSS and
parser-shared recognition are part of the parse artifact. The Less parse bench's
CSS corpus lives at `packages/syntax/css/css-parser/test/css`, not the old
pre-monorepo `packages/css-parser/test/css` path.

At minimum, capture:

- Parseman version and resolved package path for each parser workspace.
- Jess commit/branch, grammar worktree/branch, and whether the parser was macro
  compiled with 0 interpreter fallbacks.
- Corpus name and size, especially the canonical CSS/Less parse corpus used for
  grammar work and the Jess grammar parse corpus used to evaluate Parseman
  version changes.
- Cold and warm parse timings for AST and CST host modes when both are affected.
- `check:macro` fallback count and `verify:compose-integrity` status.

Treat the numbers as evidence for Parseman-versioned grammar integration, not as
a release claim until the same method has been rerun on the integrated `dev`
state.

## Approach review

| Approach | Strength | Failure mode | Verdict |
| --- | --- | --- | --- |
| Mechanical AST/CST merge | Safest path to byte identity because it preserves existing reducers and can keep public CST rule keys. | Collapses two files into one while preserving the old grammar's bulk, `CssAst*`/`Direct*` thinking, and obsolete combinator shapes. It risks meeting the file-count goal while missing the "exemplary Parseman" goal. | Use only as a fallback for load-bearing reducers after a rule-family review proves the reducer cannot be simplified. |
| Greenfield-from-spec rewrite | Best match for the owner goal: no copy-paste, spec-first prose, modern Parseman idioms, smaller grammar. | Current coverage is not strong enough to trust a broad greenfield rewrite. Parseman's coverage surface is insufficient for the composed opaque artifacts as currently built, so green tests can miss dropped behavior. | Use as the per-rule authoring posture, not as a one-shot rewrite strategy. |
| Fold-first-then-polish | The visible eight-to-four event is complete, so future work touches only grammar bodies that survive. | If treated as completion, it can entrench old AST reducer machinery and obsolete combinator shapes inside the new public grammar. | Current strategy. Polish only the four surviving host-mode grammars. |
| Incremental rule-family redesign before fold | Historically balanced byte identity with grammar quality while the files were duplicated. | It doubled work while AST and CST grammars were still duplicated, and it delayed the actual eight-to-four objective. | Historical only. Use this now only as a per-family cleanup inside one of the folded grammars. |

## Stale or risky assumptions

- Older sections of `GRAMMAR-REBUILD-SPEC.md` still preserve 0.37/0.38 planning
  history. The current manifests supersede that history: `0.41.0` is resolved,
  `hostMode`, `dispatch(...)`, and `node(..., { project })` exist, and the
  architecture floor is paid.
- CSS Phase A disproved the early "AST grammar is mostly deletable reducer
  noise" diagnosis. The deletable part was small: the local typed rule
  interface and redundant `node<T>()` generics. Most helper and reducer logic is
  currently load-bearing for byte identity.
- CSS Phase B disproved a 1:1 rule-map assumption. The CST grammar exposes
  public unprefixed keys consumed by Less/Jess, while the AST grammar splits
  many of the same language families into private `CssAst*` rules.
- The Stage 2.3 Parseman combinator cheat sheet now exists at
  `docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`. Agents should
  still verify the installed Parseman API locally before using new features, but
  the local decision table is no longer missing.
- Coverage remains a decision aid, not a completed gate. The byte-identity
  oracle is the hard gate for collapse batches; it does not prove a future
  semantic tightening is correct.

## Working sequence

1. **CSS folded; continue focused quality cleanup without blocking dialect
   repair.** CSS now has
   one `src/grammar.ts`, one `cssFactory`, and two macro-compiled host outputs:
   `cssGrammar` / `cssAstGrammar` for AST mode and `cssCstGrammar` for CST
   mode. The physical CSS fold is paid; do not recreate
   `src/ast/grammar.ts`. The current Less byte-identity oracle is red in the
   integrated checkout because of later folded Less CST ownership deltas, so do
   not quote an older CSS-fold oracle as the current baseline.
   The CSS source type issue observed after the Parseman bump is resolved:
   AST type imports are locally aliased away from the exported grammar rule
   names, and `cssFactory` has an explicit self-rule shape so `g.Rule` refs are
   known combinators under `noUncheckedIndexedAccess`. Evidence:
   `pnpm --filter @jesscss/css-parser exec tsc -p tsconfig.build.json --noEmit`,
   `pnpm --filter @jesscss/css-parser build`, and `pnpm --filter
   @jesscss/css-parser test -- ast-grammar.test.ts cst.test.ts
   macro-compiled.test.ts --run` all pass.
   The remaining CSS work is review debt and Parseman idiom cleanup, not a
   reason to delay the dialect folds. For every touched `choice(...)`, apply the
   five-way classification from `PARSEMAN-COMBINATOR-CHEAT-SHEET.md`: routed
   token family, closed spelling table, separated list, construct family, or
   context decision. Only routed token families default to `dispatch(...)`;
   closed tables, real separators, body/list construct choices, and later
   delimiter decisions keep the simpler combinator unless a const-level review
   proves otherwise.
2. **Less folded; make it exemplary and classify CST residue.** Less now ships
   AST and CST from one
   host-mode grammar source. `packages/syntax/less/less-parser/src/ast/grammar.ts`
   is deleted, the old CST bridge body is gone, and `lessAstGrammar` /
   `lessCstGrammar` compile the same Less-owned factory in the appropriate host
   mode. The active Less work is now quality plus CST residue classification:
   delete `DirectLess*` migration names as each family is reviewed, replace broad
   known/generic `choice(...)` arms with Parseman 0.41
   `dispatch(...)`/`routed()` routes, keep selector and value regions parsed
   once, document Less-specific deviations from CSS placement rules, and resolve
   the current folded at-rule/prelude CST oracle delta before claiming a clean
   byte-identity baseline.
   SCSS-only seams have already been cut from Less; do not restore them to make
   SCSS easier.
   Less-specific deviations from CSS placement rules, such as nested at-rule
   acceptance and stylesheet ordering, must be explicit and self-documenting.
   Only grammar pieces proven useful to multiple dialects should move into
   `@jesscss/parser-shared`.
   During SCSS-to-Jess conversion, complex SCSS interpolation expressions cannot
   be emitted directly into Jess interpolation positions. Hoist them into
   generated or referenced variables first, then splice the variable, because
   Jess interpolation positions are splice points rather than arbitrary `$(...)`
   expression sites.
   Current build-shape guard: `tsdown.config.ts` uses `unbundle: true` so the
   large folded grammar remains the direct `@jesscss/less-parser/grammar` entry
   instead of splitting into a non-build-resolvable shared chunk. Evidence after
   the AST-body move: `pnpm --filter @jesscss/css-parser build` rebuilt the CSS
   dependency artifacts; `pnpm --filter @jesscss/less-parser test --
   ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts --run` passed
   (3 files / 233 tests);
   `pnpm run oracle:less:byte-identity` remained byte-identical over the
   709-entry baseline
   (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
   `aggCst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`;
   AST threw 120, CST threw 0). SCSS was then repaired far enough to stop
   depending on the removed Less-private hooks: it now owns its public
   custom-property value recognizer, names its own body/top-level statement
   choices instead of using Less `blockItem` / `stylesheetItem`, falls back to
   Less's public `interpOrBasic` selector atom instead of `basicSel`, and lets
   the dedicated query at-rule rules own interpolated query preludes instead of a
   sibling `ScssQueryInterpBlock` choice. Evidence: dependency-ordered
   parser-shared/CSS/Less/SCSS builds passed; `pnpm --filter
   @jesscss/scss-parser test -- ast-grammar.test.ts` passed (94 tests); and
   `pnpm run check:macro` reports parser-shared, CSS, Less, and SCSS fully
   compiled with 0 interpreter fallbacks. The repo-wide macro and
   compose-integrity gates still fail only at the Jess/CSS composition boundary:
   Jess composes over CSS' terminal `composeLeaf` artifact, so Parseman reports
   `compose(): argument 0 isn't a build-resolvable grammar`. This is not a
   reason to restore a duplicate CSS grammar or add another CSS export shim.
   The rejected probes were changing `cssCstGrammar` to generic `compose(...)`
   and adding a separate `cssComposableCstGrammar`; both made CSS macro build
   fail on non-self-contained direct builders. The durable fix is a Parseman
   composable host-mode artifact from a single-source grammar, after which Jess
   should compose over the real CSS CST/base boundary instead of the AST
   `cssGrammar` alias.
   Follow-up seam cut: the Less CST bridge no longer returns `stylesheetItem`,
   `blockItem`, `basicSel`, `extendAhead`, or `customValue` as public extension
   hooks for SCSS. `Stylesheet`, `declarationList`, and at-rule bodies now
   reference their Less-local statement choices directly; the unused
   `customValue` helper has been deleted from Less. This intentionally removes
   the old "SCSS extends Less" surface while keeping Less behavior stable.
   Evidence:
   `pnpm --filter @jesscss/less-parser test -- ast-grammar.test.ts
   cst-public.test.ts macro-compiled.test.ts --run` passed (3 files / 233
   tests, including a host-mode parity guard that inline `:extend(...)` stays
   branch-owned in AST and CST), `pnpm --filter @jesscss/less-parser build`
   passed, and the serial `pnpm run oracle:less:byte-identity` remained
   byte-identical to the same 709-entry baseline
   (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
   `aggCst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`;
   AST threw 120, CST threw 0). The first SCSS repair pass consumed this
   intentional break instead of restoring the hooks; see the gate evidence
   above.
   Harness truthfulness fix: `vitest.less-test-data.config.ts` now discovers
   nested workspace packages recursively before aliasing built parser/plugin
   packages, so Less corpus runs resolve `@jesscss/less-parser`,
   `@jesscss/plugin-jess`, and `@jesscss/jess-parser` to the current nested
   workspace package layout rather than obsolete flat `packages/*` paths.
3. **SCSS folded; keep it a sibling, not a Less child.** SCSS now ships from one
   host-mode grammar source and no longer composes through Less. The remaining
   SCSS work is quality cleanup on that source: rebuild SCSS deliberately
   against CSS/preprocessor concepts, refine the value spine and dispatch/choice
   shapes, and lift only demonstrated common syntax into `parser-shared`. Less
   `~"..."`, guards, variable and call syntax, `:extend(...)`, property merge,
   detached-ruleset assignment, and namespace lookup stay Less-only unless a
   Sass fixture proves otherwise.
4. **Jess folded; keep only Jess-specific syntax.** Jess now ships from one
   host-mode grammar source. Reuse CSS/preprocessor concepts, route shared
   opener families with Parseman 0.41, and do not copy Less/SCSS shapes unless
   they are shared language with shared names.

## Batch rule

Every implementation batch must answer these before editing:

- What spec-level language does this family recognize?
- Which public CST rule keys must remain stable for downstream composition or
  language-service consumers?
- Which old AST reducers are semantically load-bearing, and which are accidental
  shape machinery?
- Which Parseman feature removes custom logic without changing output?
- What exact named gates will prove the batch did not move AST or CST output?

The first CSS batch should avoid the `AtRuleBlock` union, because that is the
largest known rule-decomposition mismatch. A better first batch is a smaller
leaf/value family with clear CST keys and existing AST reducers, such as
`Color`/`Dimension`/`Num` or `Quoted`/`Url`, after checking whether
`word`/`keywords`, `oneOrMoreSep`, `peek`, or grammar-level `scanSkip` can
remove local hand-rolled recognition.

After a first code read, `Color`/`Dimension`/`Num` looked like the smallest CSS
family, but it was too early before the AST factory shape was stabilized. It
still deserves a correspondence map because the CST side exposes public keys
`Color`, `Dimension`, `Num`, and the helper `numeric`; the AST side now exposes
`Color` and `Dimension`, with number-only values represented by the same
`Dimension` reducer using an empty unit. The public-key AST slice is verified;
the remaining risk is the later dual-host merge, where CST public `grammarType`s
must stay stable and `Num` must remain a CST public key.

### CSS leaf map - color and numeric values

| Concept | Current CST shape | Current AST shape | Target owner | First code batch |
| --- | --- | --- | --- | --- |
| Hex color | `Color = node(colorHex)`, public `grammarType: 'Color'` | `Color = node('Color', hexColor, children => color(...))` | `Color` in the eventual hostMode factory | The AST public-key slice has landed; the CST artifact still owns its separate CST-only `Color` rule. |
| Percentage | `Percentage = node(noTrivia(sequence(numPart, literal('%'))))`, public standalone key | `Percentage = node('Percentage', sequence(numberValue, literal('%')), ...)`, preserving the current AST `Dimension(unit: '%')` value shape | `Percentage` in the eventual hostMode factory | This is an intentional CST contract movement from the old `Dimension`/`Numeric` collapse; the Less oracle baseline was regenerated after proving every moved CST entry contains `%`. |
| Number with unit | `Dimension = node(noTrivia(sequence(numPart, unitRegex)))`, public standalone key | `Dimension = node('Dimension', noTrivia(sequence(numberNoPercentage, optional(dimensionUnit))), ...)` | `Dimension` in the eventual hostMode factory | The AST slice keeps the local leading number for first-set gating. `%` is not a dimension unit. |
| Number without unit | `Num = node(numTok)`, public standalone key; value positions normally use `numeric` | Same AST reducer as `Dimension`, with empty unit | `Dimension` for AST, `Num` for CST-only public entry | Do not delete `Num`; it is a CST public key. In AST mode, unitless numbers remain `Dimension` values. |
| ValueList-position numeric | `numeric = node('Numeric', noTrivia(sequence(numPart, optional(unitRegex))))`, with `cssCstBuildHost` remapping `Numeric` to public `Dimension` or `Num` | Same AST reducer as `Dimension` | `Numeric` as an internal shared recognizer, `Dimension` as AST value | Preserve the existing unified-recognizer idea; it is already the Parseman-style simplification. |

Superseded failed probe, 2026-07-25: a standalone AST-only cleanup tried two
variants before the AST factory extraction:

1. Rename `CssAstColor`/`CssAstDimension` to `Color`/`Dimension` and switch the
   leading leaves to `g.CssSyntaxHexColor`/`g.CssSyntaxNumber`.
2. Keep CSS's local `hexColor`/`numberValue` leading leaves, but still rename the
   AST rule keys and local `g.` references.

Both variants made `test/macro-compiled.test.ts` fail with `composeLeaf() must
macro-fuse; runtime composition is forbidden`. After backing out the source edit,
rebuilding `@jesscss/parser-shared` and `@jesscss/core`, the focused CSS set
passed: `pnpm --filter @jesscss/css-parser test -- --run
test/ast-grammar.test.ts test/macro-compiled.test.ts test/cst-public.test.ts`
reported 3 files / 93 tests green. The failed probe means the rule-name string
and returned grammar key are part of the macro contract. The next implementation
batch should either:

- move this family inside the real hostMode factory shape so there is one keyed
  owner from the start, or
- first add/prove a Parseman-supported alias/export mechanism that lets AST-only
  internal keys remain macro-stable while CST public keys stay unprefixed.

The later direct AST factory extraction changed the relevant macro shape. A
subsequent final-local public-key slice renamed the AST family to `Color`,
`Dimension`, and `UnicodeRange`, switched CSS AST callsites to
`g.Color`/`g.Dimension`/`g.UnicodeRange`, and passed targeted ESLint plus focused
CSS AST/public/macro numeric-color tests. The broader post-slice gates also
passed: dependency-ordered parser builds, `verify:package-exports`,
`check:macro` with 0 interpreter fallbacks, `verify:compose-integrity`, a serial
Less byte-identity oracle pass (707 entries byte-identical), and the full CSS
parser suite (8 files / 242 tests). Do not repeat the old pre-factory probe as
evidence that this rename is forbidden; do keep the warning that the real
CST/AST single-factory merge must preserve CST `Num`/`numeric` behavior.

HostMode infrastructure slice, 2026-07-25: the public CSS CST grammar now
declares `hostMode: 'cst'`, and CSS's custom `cssCstBuildHost` carries the
official Parseman CST-host metadata from `cstBuildHost()`. This preserves CSS's
public CST node shape while satisfying Parseman's intended guard that CST-mode
artifacts run only against a positioned-CST host. The collapse path uses the
same official wrapper with CSS's existing collapsible-rule predicate.

The first attempted factory extraction proved the guard by failing until backed
out with `_parsemanCstOutput` missing. The landed infrastructure is deliberately
smaller than a rule-family merge: it pays the CST-host prerequisite without
renaming AST rules, moving reducers, or changing downstream dialect composition.
The next real dual-host batch remains `Quoted`/`Url`.

CSS factory extraction slice, 2026-07-25: the public CSS grammar body now lives
in a module-level `cssFactory` and `cssCstGrammar` calls
`rules({ trivia: rw, scanSkip: [singleStr, doubleStr], hostMode: 'cst' },
cssFactory)`. `cssGrammar` remains a compatibility alias to that CST artifact
until the AST export can move onto the shared owner. This is the macro-visible
shape Phase B needs before the same factory can be compiled for AST and CST
hosts. The edit intentionally did not
move AST reducers into the factory, did not rename any public CST keys, and did
not fold a rule family. Most of the source diff is mechanical outdent from
lifting the old inline `rules(..., g => ...)` body into the named const.

The CSS grammar header now links the dialect grammar files that compose on the
public CST keys. Keep those links accurate when moving to Less, SCSS, and Jess;
they are there so a future agent can see the blast radius before renaming,
removing, or privatizing a base CSS rule.

CSS AST factory extraction slice, 2026-07-25: the CSS AST grammar's final local
`rules(...)` body now lives in a module-level `cssFactory`, and
`cssAstGrammar` calls `composeLeaf([cssSyntax, opaqueAtRuleRecognition,
cssPseudoSyntax, rules({ trivia: whitespace, scanSkip: [...] },
cssFactory)])`. This proves the current direct-builder rule map can be named
in the same module and still macro-fuse. It also removed the now-unused type
imports that made targeted ESLint warn on the AST grammar.

Superseded status, 2026-07-27: this was a prerequisite slice, and the physical
CSS fold has since paid it. `packages/syntax/css/css-parser/src/ast/grammar.ts`
is deleted, `parse()` no longer owns a second AST grammar source, and the
remaining CSS work is residue cleanup inside the single host-mode grammar. Keep
the note above only as evidence for why the final owner had to be the surviving
`src/grammar.ts` file.

### CSS pilot candidate - quoted strings and URLs

After the superseded pre-factory color/numeric rename probe, `Quoted`/`Url` was
the better first implementation slice than `Color`/`Dimension`/`Num`,
`SelectorList`, or `AtRuleBlock`:

| Candidate | Why not first |
| --- | --- |
| `Color`/`Dimension`/`Num` | Semantically small, but it carries the `Numeric` CST remap and local leading-number first-set optimization. The AST public-key slice has now landed; the remaining single-factory hostMode work must preserve CST `Num`/`numeric` behavior. |
| `SelectorList` | Important, but the AST currently has no single `CssAstSelectorList` peer; it builds selector lists inline. This is a real structural design problem, not the best first hostMode mechanics proof. |
| `AtRuleBlock` | Largest known CST-union/AST-per-arm mismatch. It should wait until the factory pattern and test discipline are proven on smaller value leaves. |
| `Quoted`/`Url` | Small public CST keys, clear AST reducers, existing focused tests, and downstream dialects already reference or override `g.Quoted`/`g.Url`. It still has enough edge cases to prove the pattern honestly. |

Mapping for a real hostMode pilot:

| Concept | Current CST shape | Current AST shape | Pilot target | Caveat |
| --- | --- | --- | --- | --- |
| Quoted string | `Quoted = node(choice(singleStr, doubleStr))`, public `grammarType: 'Quoted'`, public CST type `String` | `Quoted` now handles normal strings plus static escaped quoted strings, then reduces through `quoted(...)`. | Shared `Quoted` rule in the pilot factory with an AST build arrow and `hostMode: 'cst'` recompilation for CST. | Escaped `~"..."`/`~'...'` strings are AST syntax, but current CST represents the `~` as a separate value leaf plus a normal `Quoted` node. The pilot must either keep the escaped arm AST-local or intentionally migrate CST shape with language-service evidence. |
| Declaration URL | `Url = node(sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), expect(')')))` | `Url = node('Url', sequence(urlName, comments, '(', optional(ws/comments), optional(Quoted or UrlUnquoted), ..., expect(')')), children => url(...))` | Shared `Url` rule whose CST mode keeps public `Url` CST shape while AST mode returns `url(...)`. | Current CST parses `url(icon.svg)` and `url("icons logo.svg")` as `Url`, but `url/* comment */(icon.svg)` as `Call`. The AST route deliberately permits block-comment trivia around `url`/`(`/payload/`)`, so that comment-delimited spelling needs an AST-local fallback or an explicit CST-shape migration. |
| Import URL | CST import target is part of `ImportStatement` prelude scanning | `ImportUrl` / `ImportUrlUnquoted` are import-local URL target reducers | Keep import URL internal to the import family, or include it as a separately named internal rule with explicit coverage. | `macro-compiled.test.ts` now proves `ImportUrl` and `ImportUrlUnquoted` by exact coverage IDs; these remain import-specific helpers, not generic `Url`. |

The CST half of those caveats is now pinned in
`packages/syntax/css/css-parser/test/cst-public.test.ts`: static escaped strings
must remain a sigil plus a normal `Quoted` CST node, and comment-delimited
declaration URLs must remain on the `Call` CST path while ordinary `url(...)`
stays a public `Url`. The focused CSS CST/public/macro set and then the full CSS
parser suite passed after adding those guards (8 files / 244 tests). Any future
fold that intentionally changes those shapes needs language-service evidence
and an explicit mapping, not an accidental green oracle.

Superseded recommendation from the pre-fold pilot:

1. `Quoted`, `Url`, and their immediate unquoted URL helper now live in the
   surviving CSS grammar source. Do not recreate a pre-final imported
   direct-builder artifact.
2. Do not seed AST builders onto the current public CSS CST `Quoted`/`Url`
   rules as a "partial fold." That shape can be made to macro-build only with
   self-contained expression builders, but the Less CST oracle then moves
   because dialect CST grammars compose the carried CSS rule map. Adding
   dialect-level `hostMode` options as a preparatory cleanup was rejected: it is
   not part of the CSS fold and it can hide or create CST movement during
   downstream oracle triage.
3. Keep the escaped quoted and comment-delimited URL caveats explicit. Escaped
   `~"..."` strings and `url/* comment */(...)` currently have AST/CST shape
   mismatches, so preserve them as AST-local fallback arms unless the patch also
   deliberately migrates CST shape with language-service evidence.
4. The AST-side public-key slice and the hostMode fold have both landed. The
   remaining work is to preserve public CST keys while cleaning up the single
   source; it is not a reason to restore `src/ast/grammar.ts`.
5. Preserve public CST keys `Quoted` and `Url`; Less overrides both names for
   interpolation/reference-aware strings and URLs, so those names are a
   downstream composition contract, not just CSS internals. Preserve internal
   import URL coverage until the import rule itself is folded.
6. Run at minimum:
   `pnpm --filter @jesscss/parser-shared build`,
   `pnpm --filter @jesscss/core build`, and
   `pnpm --filter @jesscss/css-parser test -- --run
   test/ast-grammar.test.ts test/macro-compiled.test.ts test/cst-public.test.ts
   test/public-parse.test.ts test/conditional-at-rule-value.test.ts`.
   A landed CSS/Less-impacting batch still requires the oracle and macro /
   compose-integrity gates listed below.

Failed `Quoted`/`Url` direct-sharing probe, 2026-07-25: the obvious small pilot
was tried and backed out. Three facts matter for the next agent:

- CST samples show the ordinary cases are shareable, but not all AST spellings
  have the same CST node shape. `~"theme"` is CST `~` plus `Quoted`, while the
  AST treats it as an escaped quoted string. `url(icon.svg)` and
  `url("icons logo.svg")` are CST `Url`, while `url/* comment */(icon.svg)` is
  CST `Call` but AST `Url`.
- `composeLeaf([cssSyntax, cssAstSharedGrammar, astLocalRules])` fails with
  `composeLeaf() must macro-fuse; runtime composition is forbidden` when
  `cssAstSharedGrammar` has direct builders. Parseman's 0.37 plugin requires
  pre-final composeLeaf artifacts to be explicitly recognition-only; direct
  builders belong in the final local rules map.
- Switching the AST grammar from `composeLeaf` to `compose` is not a shortcut.
  It first failed to lower imported builder helper references, and expression-
  only shared builders still exposed that the existing AST local rules include
  block-bodied reducers such as `CssAstEscapedQuoted`; `compose` attempts to
  serialize the full builder artifact as re-lowerable IR.
- Seeding direct builders onto the existing public CSS CST `Quoted`/`Url` rules
  is not a shortcut either. Helper-call builders are rejected by composed dialect
  macro passes (`unsupported binding(s): quotedFromToken, tokenText`);
  block-bodied self-contained builders are rejected as `unsupported
  BlockStatement`; expression-only object-literal builders clear `check:macro`,
  but `pnpm run oracle:less:byte-identity` reports all 707 Less CST corpus
  entries moved (`threw 0 -> 707`). That is not a refactor.
- Importing the compatibility alias `cssGrammar` from the CSS grammar package
  after the export split is not macro-buildable for downstream dialect
  composition: Less fell back to the interpreter with
  `compose(): argument 0 isn't a build-resolvable grammar`. Less and Jess must
  import the real exported object name, `cssCstGrammar`, while they are still
  composing the CSS CST artifact. The `cssGrammar` alias is for compatibility,
  not for macro-composed dialect source.
- Dialect-level `hostMode` declarations were tested and rejected as a
  preparatory step. They are not needed to keep Less macro-compiled once the
  real `cssCstGrammar` export is imported, and they make it harder to attribute
  later CST movement to the actual CSS rule under review.
- A named `scssDelta` / `jessDelta` extraction was tested and rejected. It was
  macro/build-clean, but source/public tests could construct the standalone
  delta before composed refs were materialized and fail with
  `Cannot read properties of undefined (reading 'tag')`. Keeping the delta
  inline is the current Parseman 0.37-compatible shape; the wrapper carries a
  narrowly scoped formatting lint suppression to avoid a full-file grammar-body
  reindent.
- The rejected dialect hostMode experiment is useful only as negative evidence:
  the expression-only CSS `Quoted`/`Url` builder-seeding probe still moved the
  Less CST corpus, so the failure is not merely that the dialect compose sites
  lacked hostMode.

Conclusion, updated 2026-07-27: the `Quoted`/`Url` pilot evidence remains useful
history, and the hostMode fold has since occurred in the final owner. A
pre-final imported direct-builder artifact, a standalone AST-key rename, and
CST-builder seeding remain non-viable pilot shapes.

CSS CST export split, 2026-07-25 follow-up: the current CST-compiled CSS artifact
is now exported as `cssCstGrammar`, with `cssGrammar` kept as a compatibility
alias. CSS CST parsing, Less CST composition, and Jess CST composition use
`cssCstGrammar` directly. This is intentionally a naming/ownership prerequisite:
the next shared-family patch can make `cssGrammar` the AST/default hostMode
artifact without leaving dialect CST grammars ambiguously composed on the old
name. It does not rename any public CST rule keys (`Quoted`, `Url`, etc.) and it
does not add direct builders to the CST artifact. Macro-composed dialect grammars
must import `cssCstGrammar` by that name; the alias is not build-resolvable.

CSS AST `Quoted`/`Url` public-key slice, 2026-07-25 follow-up: the final CSS AST
factory now exposes the quoted-string and declaration-url family as `Quoted` and
`Url`, not `CssAstQuoted` / `CssAstUrl`, and its own callsites reference
`g.Quoted` / `g.Url`. At the time of this slice, the import-local URL reducers
remained `CssAstImportUrl*`, because `@import` still had separate target/tail
semantics and existing coverage assertions. Superseded 2026-07-26 for rule keys
only: those helpers are now `ImportUrl*` / `ImportTail*`, still import-local and
still covered separately.
This slice passed targeted ESLint plus the focused CSS
AST/public/macro/CST family tests:
`pnpm --filter @jesscss/css-parser test -- --run test/ast-grammar.test.ts
test/macro-compiled.test.ts test/public-parse.test.ts test/cst-public.test.ts
test/conditional-at-rule-value.test.ts`. The broader post-slice gates also
passed: dependency-ordered parser builds, `pnpm run verify:package-exports`,
`pnpm run check:macro` (0 interpreter fallbacks in all parser packages),
`pnpm run verify:compose-integrity`, serial `pnpm run oracle:less:byte-identity`
after rebuilding CSS (707 entries byte-identical), and the full CSS parser suite
(8 files / 242 tests). A first oracle attempt was invalid because it ran in
parallel with compose-integrity while `css-parser/lib` was being cleaned; the
serial rerun is the authoritative oracle result.

CSS Parseman idiom and strict CSS conformance slice, 2026-07-25 follow-up: the
latest CSS pass corrected three assumptions that were too loose in the earlier
notes.

First, list separators own declaration semicolons. A declaration rule does not
have an optional semicolon; the containing declaration/block list decides whether
another body item may follow. The CSS AST and CST declaration rules now stop
before `;`, and the body lists wrap declaration items as "declaration followed
by either `;` or `}`". This accepts final semicolonless declarations and extra
empty semicolon items, but rejects a declaration that is followed directly by a
nested at-rule or qualified rule. At-rule statement forms continue to require
their own semicolon, matching CSS Syntax's "consume an at-rule" algorithm:
statement at-rules end only at `;`, while block at-rules own a block.

Second, the grammar should use Parseman for common shapes rather than manually
spelling them out, but only where the helper preserves the current AST/CST
ownership. CSS `SelectorList`, keyframe selector lists, value comma lists, and
query/supports comma lists use `oneOrMoreSep(...)` where the separator is a real
token. The Less comma-prelude rules named above deliberately keep the explicit
sequence form until their field/CST ownership can be migrated safely.
`ComplexSelector` deliberately does not use `oneOrMoreSep`, because a descendant
combinator is ambient trivia between compound selectors; there is no literal
separator token for Parseman to own. Keyword-boundary regexes that merely spelled
a word (`of`, `not`, `and`/`or`, and known at-keywords) were converted to
`word(...)` or `keywords(...)`; regexes that encode non-keyword lookahead or
reserved-name logic remain as regexes.

Third, CSS property names are identifiers. The old CST-local `propName` regex
was removed and CSS declarations now reuse the shared `ident` recognizer. The
`1,6` in CSS escapes is correct for hexadecimal escapes, but that does not
justify a property-name-specific regex, and the legacy IE `*color` spelling is
not conforming CSS. If a compatibility mode is ever intentionally introduced,
the grammar shape should make that explicit, for example a gated arm such as
`choice(sequence(literal('*'), gate(legacyMode), ident), ident)`. Parseman
`optional(...)` itself does not take a gated-arm object; gating belongs in a
`choice` arm or as a `gate(...)` combinator inside the sequence.

The stale "declaration value stops at at-keyword, so semicolonless declaration
before nested at-rule is okay" reading is rejected. CSS Syntax declaration
collection is bounded by semicolon or block-list end, not by an at-keyword that
appears after a property value. Treating the at-keyword as a nested-rule
boundary accepts non-conforming CSS and hides missing separators.

Latest evidence for this strict slice: targeted ESLint on touched CSS grammar,
AST grammar, parser-shared recognition, and CSS tests passed; the focused CSS
parser set passed (7 files / 245 tests); the full CSS parser suite passed
(8 files / 250 tests); dependency-ordered parser builds for parser-shared and
all four parser packages passed; `pnpm run check:macro` passed with 0
interpreter fallbacks; `pnpm run verify:compose-integrity` passed; and the Less
byte-identity oracle passed after intentionally regenerating the baseline for
two CSS-level changes: strict fixture reclassification
(`errors/declaration-star-property.css` added, two legacy `*color` fixtures made
conforming) and the grammar-level `Percentage` split. The oracle first reported
85 moved CST entries with AST unchanged; every moved entry contained `%`, and
representative current CST trees contain public `Percentage` nodes. The new
oracle corpus has 708 entries; AST threw 119, CST threw 0.

Latest follow-up: CSS function-token cleanup. The grammar now spells generic
functions as glued openers (`noTrivia(sequence(..., literal('(')))`) instead of
duplicating identifier regexes with `(?=\()`. CST `value` / `calcValue` route
through `CalcCall` before generic `Call`; generic `Call` is guarded with
`not(calcOpen)`. The AST grammar uses the same shape through
`nonCalcFunctionOpen`, `calcOpen`, and `varOpen`. This is a readability and
spec-shape win, but not a first-set win yet: current Parseman diagnostics still
report `value` / `mathProduct` overlap between `CalcCall` and generic `Call`
because the compiler does not subtract `not(calcOpen)` from the identifier
first-set.

Rejected in that pass: splitting public CST `urlOpen` from `regex(/url\(/i)` to
`word('url') + literal('(')`. That made the imported CSS CST grammar fail
Less macro composition under published Parseman 0.37, and it would churn public
CST terminal shape. Keep the AST-side structural `urlOpen`, but defer the public
CST split until imported-grammar linkability and language-service CST shape are
verified deliberately. Also avoid running CSS rebuilds and Less oracle in
parallel: one observed failure was just Less importing CSS while CSS `lib/` was
being cleaned.

Evidence for the function-token pass: targeted ESLint passed for the touched CSS
grammar files, `git diff --check` passed, dependency-ordered parser-shared and
CSS parser builds passed, the focused CSS parser set passed (4 files / 115
tests), the full CSS parser suite passed (8 files / 250 tests),
`pnpm run check:macro` passed with 0 interpreter fallbacks, and the Less
byte-identity oracle passed against the 708-entry baseline.

Latest query-function follow-up: the CSS CST and direct CSS AST grammars now
represent query/general-enclosed function openers as glued
`noTrivia(sequence(ident, literal('(')))` structures. Parser-shared exports the
new `CssSyntaxQueryFunctionOpen` for CSS direct-AST use but keeps the old
`CssSyntaxQueryFunctionName` export for dialect AST grammars until their own
cleanup passes. This is intentionally staged: changing the shared name in-place
would force Less/SCSS/Jess consumer rewrites before the CSS batch has finished.
Focused CSS tests now cover `selector (.grid)` as invalid. The slice passed the
full CSS parser suite (8 files / 251 tests), `check:macro` with 0 interpreter
fallbacks, the Less byte-identity oracle against the current 708-entry baseline,
and compose integrity.

Latest CSS `@supports` opener follow-up: the public CST required-prelude
fallback now uses `peek(choice(...))` over the real opener grammar instead of a
lookahead regex. The admitted starts are `(`, legacy-boundary `not`, and
`queryFunctionOpen` (identifier glued to `(`). This keeps the fallback
zero-width while making the CSS token rule visible in Parseman structure.
Do not mechanically apply this exact CSS boundary to Less/SCSS: their CST
fallbacks also admit interpolation starts and should be handled in their dialect
passes. The CSS slice passed focused CSS tests (4 files / 143 tests), full CSS
tests (8 files / 251 tests), `check:macro`, Less byte identity, and compose
integrity.

Latest CSS media/query conformance follow-up: the public CST grammar now treats
known block at-rules as owned by their typed grammar, not by the opaque unknown
fallback. `UnknownAtRuleBlock` excludes known block-at-keywords before accepting
`atKeyword`, and the remaining public CST opaque `@media` fallback was removed.
This found the real follow-up needed for conformance: Media Queries Level 5
reserves `layer` as well as the existing media-query control keywords, so CST and
direct AST now reject `@media layer` and `@media only layer`.

The same batch added structural value-first media ranges so
`@media (100em < width < 200em) {}` parses through `QueryFeature`. That is
intentional CST movement for four named oracle entries:
`node_modules/@less/test-data/tests-unit/media/legacy/media.css`,
`node_modules/@less/test-data/tests-unit/media/media.css`,
`node_modules/@less/test-data/tests-unit/media/media.less`, and
`packages/syntax/css/css-parser/test/css/expressions.css`. The AST aggregate
stayed `546a633b28a857f82a3f1ea412428de79d2faab83b4fe48a16992ce286a44b6f`; the
regenerated CST aggregate is
`0179c7bf1e7fe38442f4d4e0bbbf536758f0cb9a001557cd56a34b16102dc8fd`.

Critical sequencing note: the current leading `not(...)` guards for names such
as media type and container name are spec-defense, not grammar style. They keep
reserved words and known typed at-rules from falling into broader identifier or
unknown-at-rule arms, but they also poison Parseman's first-set analysis. Do not
delete them as a cosmetic cleanup; instead, improve Parseman with a
macro-visible "identifier except keywords" shape, then return to CSS and remove
the leading-not debt with coverage. The local Parseman patch already makes both
`word(str, { caseInsensitive: true })` and
`makeWord(boundary?, { caseInsensitive: true })` legal. The public API shape is
right, but the Jess grammar macro path cannot yet rely on top-level
`makeWord(...)` factory aliases; keep repeated `word(...)` calls until Parseman
either macro-lowers those aliases or preserves the runtime import.

Evidence for the media/query conformance batch: targeted ESLint on touched CSS
grammar/test files passed; focused CSS parser tests passed (3 files / 108
tests); the full CSS parser suite passed (8 files / 253 tests);
`git diff --check` passed; `pnpm run check:macro` passed with parser-shared and
all four parser packages fully compiled and 0 interpreter fallbacks;
`pnpm run verify:compose-integrity` passed; `pnpm run oracle:less:byte-identity`
passed after regenerating the named CST baseline movement above; and the serial
language-service suite passed (13 files / 189 passed / 1 skipped). Earlier
language-service and oracle failures during this work were invalid artifact
races caused by running tests while another command cleaned/rebuilt CSS `lib/`.

Latest priority-marker/calc-peek follow-up: ordinary declaration `!important`
now uses Parseman's `word('important', ..., { caseInsensitive: true })` in both
the public CSS CST grammar and the shared direct-AST recognition artifact. A new
public error fixture pins `!importantx` as a boundary failure. The direct CSS AST
declaration calc dispatch also uses `peek(calcOpen)` instead of
`regex(/(?=calc\()/i)`, keeping the glued `calc(` opener as grammar structure.

Do not generalize that cleanup to `customImportantTail`. Custom-property values
need a scan sentinel for the final priority marker: whitespace before `!`,
comments/trivia around `important`, trailing trivia, and the final `;`/`}` all
matter, and only the final marker is stripped. That regex remains a deliberate
exception until Parseman has a better sentinel combinator for "scan until this
structured trailing marker." Evidence for the follow-up so far: targeted ESLint
passed; parser-shared and css-parser builds passed; focused CSS parser tests
passed first as 4 files / 213 tests, then with the new boundary fixture as 3
files / 107 tests; the full CSS parser suite passed (8 files / 253 tests);
`check:macro` passed with 0 interpreter fallbacks; compose integrity passed; and
the Less oracle passed after regenerating the baseline for the one named corpus
addition. The 709-entry oracle baseline now reports
`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`
with 120 AST throws and
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`
with 0 CST throws.

Latest direct-AST at-keyword follow-up: the shared parser recognition artifact
now replaces fixed keyword-boundary regex leaves with Parseman
`word(...)` / `keywords(...)` where the accepted language is just a known CSS
keyword plus a boundary. This covers conditional at-rules, page/margin at-rules,
descriptor at-rules, layer/font-feature-values at-rules, and query controls
`not`, `only`, `and`, and `or`. The replacements preserve the old boundary class
for each family: `(?![-\w])` becomes `boundary: '-_0-9A-Za-z'`, while the query
controls keep the broader CSS identifier boundary. That makes the grammar more
readable without sneaking in a boundary-conformance movement.

Rejected in this pass: splitting `@(?:-[a-z]+-)?keyframes` into a `word()` arm
and a prefixed regex arm. The split is superficially more "Parseman-looking",
but both alternatives start with `@`, so it worsens gating diagnostics and does
not reduce the language in a useful way. Keep the combined regex until a common
structured spelling can improve both readability and macro analysis.

Parseman API decision for future batches: public Parseman should allow
`word(str, { caseInsensitive: true })` and
`word(str, boundary, { caseInsensitive: true })`; `makeWord(...)` should expose
the same option shape. Defaults stay consistent across the API: case-sensitive
unless explicitly requested. After Jess pinned `0.38.0`, a follow-up macro probe
showed that top-level `makeWord(...)` factory aliases are still not safe in the
grammar files: the alias form is left as runtime code after the macro import is
removed. Treat dialect-local word factories as a Parseman ergonomics target, not
as an available Jess cleanup idiom today.

Evidence for the direct-AST at-keyword batch: targeted ESLint on parser-shared
recognition and CSS grammar passed; parser-shared and css-parser builds passed;
focused CSS parser tests passed (4 files / 118 tests); the full CSS parser suite
passed (8 files / 253 tests); `check:macro` passed with parser-shared plus all
four parser packages fully compiled and 0 interpreter fallbacks;
`verify:compose-integrity` passed; the Less byte-identity oracle passed against
the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed.

Latest query comparison operator follow-up: the CSS media/container range
operators now use `keywords(['<=', '>=', '<', '=', '>'])` in the public CST
grammar and in parser-shared direct-AST recognition. This is the useful
Parseman spelling for this fixed token set because it remains one terminal,
sorts longest-first, and exposes a concrete first set. The apparently clearer
literal `choice(...)` form was rejected after a focused build: it introduced new
gating diagnostics for the shared `<` and `>` prefixes. A left-factored
`sequence(literal('<'), optional(literal('=')))` shape would avoid that warning,
but it would also change CST terminal leaves for `<=` / `>=`; keep
`keywords([...])` until Parseman has a distinct fixed-token-set combinator.

Evidence for the query comparison operator batch: targeted ESLint on
parser-shared recognition and CSS grammar passed; parser-shared and css-parser
builds passed; focused CSS parser tests passed (4 files / 145 tests); the full
CSS parser suite passed (8 files / 253 tests); `check:macro` passed with all
parser packages fully compiled and 0 interpreter fallbacks;
`verify:compose-integrity` passed; the Less byte-identity oracle passed against
the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed before this evidence note was added.

Latest selector combinator follow-up: CSS selector combinators now use
`keywords(['||', '>', '+', '~', '|'])` in both the public CST grammar and the
direct AST grammar. This is the same fixed-token-set lesson as the comparison
operator batch: literal `choice(...)` leaves `||` / `|` with overlapping first
sets, while left-factoring would split a single combinator token into multiple
CST leaves. The focused CSS AST/public/macro/CST test set passed after the
change, and the CSS build no longer reports the previous `choice @ combinator`
diagnostic.

Evidence for the selector combinator batch: targeted ESLint on the public CSS
grammar and direct AST grammar passed; parser-shared and css-parser builds
passed; focused CSS AST/public/macro/CST tests passed (4 files / 118 tests);
the full CSS parser suite passed (8 files / 253 tests); `check:macro` passed
with all parser packages fully compiled and 0 interpreter fallbacks;
`verify:compose-integrity` passed; the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed after this evidence note was added.

Latest selector token-set follow-up: CSS attribute selector operators now use
`keywords(['*=', '~=', '|=', '^=', '$=', '='])` in the public CST grammar and in
parser-shared direct-AST recognition. The direct CSS AST relative-selector opener
set now uses `keywords(['>', '+', '~'])` instead of literal `choice(...)`.
Rejected in the same pass: revisiting the public CST `urlOpen` split. The
existing rejection still stands because it changed imported-grammar linkability
and public CST terminal shape under published Parseman 0.37.

Evidence for the selector token-set batch: targeted ESLint on parser-shared
recognition plus both CSS grammar files passed; parser-shared and css-parser
builds passed; focused CSS AST/public/macro/CST tests passed (4 files / 118
tests); the full CSS parser suite passed (8 files / 253 tests); `check:macro`
passed with all parser packages fully compiled and 0 interpreter fallbacks;
`verify:compose-integrity` passed; the Less byte-identity oracle passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`);
and `git diff --check` passed after this evidence note was added.

Latest CSS calc product-operator follow-up: the public CST grammar now writes
the fixed calc product operator set as `keywords(['*', '/', '%'])` instead of
`regex(/[*\/%]/)`. This matches the selector/comparison-token cleanup rule:
fixed token sets should use Parseman's token-set primitive when doing so keeps
the same terminal shape and improves first-set visibility. The direct AST
`calcProductOperator` and `calcSumOperator` regexes remain deliberate exceptions
for now because they include authored calc whitespace as part of the operator
leaf, and `foldOperation(...)` currently trims that single token. Splitting those
into whitespace + operator + whitespace would be an AST reducer/child-shape
change, not the same small idiom cleanup. The public CST `sumOp` also remains a
regex because it encodes signed-number adjacency rules, not merely a fixed `+` /
`-` token set.

Evidence for the calc product-operator batch: targeted ESLint on
`packages/syntax/css/css-parser/src/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the focused CSS AST/public/macro/CST set passed (4 files / 118
tests); the full CSS parser suite passed (8 files / 253 tests); `pnpm run
check:macro` passed with parser-shared and all four parser packages fully
compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Superseded pre-fold CSS AST note: the referenced `src/ast/grammar.ts` file has
been deleted; keep this only as historical evidence for cleanup that was later
folded into the surviving `src/grammar.ts`.

Latest CSS direct-AST lookahead cleanup: the direct CSS AST grammar no longer
uses hand-written zero-width regex lookaheads. The dash-led raw pseudo argument
arm reuses the existing shared `CssSyntaxPseudoCloseAhead` grammar fact, and
the declaration opaque slash boundary is now a local
`peek(choice('.', digit, whitespace))` combinator. No public rule key, reducer,
or accepted language changed; this is a Parseman-idiom cleanup only.

Rejected in the same pass: widening this into a general whitespace or opaque
byte rewrite. The adjacent whitespace regexes still consume authored bytes and
participate in reducer child shape, while this pass only replaced zero-width
assertions. Splitting the consuming terminals would be a separate value-family
shape review.

Evidence for the direct-AST lookahead cleanup: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; no `regex(/(?=...)` lookaheads remain in CSS/parser-shared grammar
sources; dependency-ordered `@jesscss/parser-shared` and `@jesscss/css-parser`
builds passed; the generated public CSS grammar bundle remained about
926.33 kB ESM; the focused CSS AST/public/macro/CST/conditional set passed
(5 files / 224 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared plus all four parser packages
fully compiled and 0 interpreter fallbacks (`@jesscss/css-parser` reported
5097 `charCodeAt` vs 494 `RegExp.exec`); `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS CST conditional top wrapper cleanup: the public CSS CST grammar now
removes the meaningless `sequence(choice(...))` wrapper around
`QueryAtRuleBlockTop`. The rule remains `node('QueryAtRuleBlock', choice(...))`,
with the same public node key, conditional at-keyword arms, body languages, and
recovery policy. This is intentionally tiny: it removes a parseman no-op without
changing the at-rule routing model.

Rejected in the same pass: factoring the transparent known-block arms into
`nestedTransparentKnownBlock` / `topTransparentKnownBlock` helpers. That looked
appealing from a source-deduplication angle, but it made the generated public
CSS grammar larger (about 928.89 kB ESM versus the current 926.33 kB ESM after
the smaller cleanup) and added an indirection layer around one of the grammar's
most important frame distinctions. For this cleanup sequence, a helper is not an
improvement unless it reduces real complexity, generated size, or risk.

Evidence for the CSS CST conditional top wrapper cleanup: focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 224 tests); the full
CSS parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed
with parser-shared plus all four parser packages fully compiled and 0
interpreter fallbacks; `pnpm run verify:compose-integrity` passed after clean
grammar-parser rebuilds; and `pnpm run oracle:less:byte-identity` passed
byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Superseded pre-fold CSS AST note: the referenced `src/ast/grammar.ts` file has
been deleted; keep this only as historical evidence for cleanup that was later
folded into the surviving `src/grammar.ts`.

Latest CSS direct-AST function-argument cleanup: the direct CSS AST grammar now
routes the glued identifier/function opener with current Parseman
`dispatch(...)`/`routed()`. Generic identifiers, generic functions, `url(`,
`calc(`, and `var(` share the same opener recognition, then route into the
right tail without parallel backtracking arms. Generic value calls share one
`authoredValueComma` separator with the ordinary value-list path. The calc
`var()` fallback empty sentinel now uses `peek(',')` / `peek(')')` instead of a
regex lookahead, and fallback comma trivia is factored as `varFallbackComma`.

Calc `var()` fallback lists keep the manual `item (comma item)*` shape because
the fallback item can intentionally be zero-width for leading, trailing, and
interior empty fallback components. Do not replace that shape with
`oneOrMoreSep(...)` unless Parseman grows a nullable-item-aware separator-list
primitive.

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

Latest CSS declaration-item factoring follow-up: the public CSS CST grammar now
names the list-owned declaration wrappers as plain internal combinators,
`declarationItem` and `customDeclarationItem`, and reuses them across
`declarationList`, `descriptorBody`, and `pageBody`. These are not `node(...)`
rules, so they add no public CST keys. The semicolon model remains strict:
declarations still do not own optional semicolons; the containing body list owns
either a `;` separator or a block-end `}` via `peek(literal('}'))`.

This is the safe half of the declaration-body cleanup suggested by the CSS CST
sidecar audit. It removes repeated inline bodies without changing the grammar's
acceptance model, and it keeps the more semantic at-rule/body factoring for the
next CSS batch. The next CST cleanup should factor conditional at-rule tails by
frame (`stylesheetBody` vs `declarationList`) before attempting any
Parseman-0.39 dispatch rewrite. The next AST cleanup should stay separate:
declaration/function-call value cleanup needs reducer-child-shape review and is
not the same low-risk CST factoring move.

Latest Less declaration-list ownership follow-up: ordinary declarations, custom
property declarations, and punctuation-map declarations no longer consume
`optional(literal(';'))` inside their declaration rule. Braced statement lists own
that boundary through collapsed internal item wrappers:
`directLessDeclarationItem` and `directLessPunctuationMapDeclarationItem` parse
the declaration and then require either a `;` separator or the containing `}`
with `peek(literal('}'))`. At-rule statements/imports/plugins still own their
required semicolon because that is statement termination, not declaration-list
separation. Nested rulesets and mixin definitions still own their optional Less
statement suffix; that is a separate dialect statement-terminator question.

The focused tests now pin both sides of the model: declaration CST nodes stop
before the authored `;`, separator leaves remain in the surrounding CST, final
declarations may end at `}`, and a semicolonless declaration before a nested
at-rule or qualified rule is rejected. Remaining open question: root stylesheet
declarations still need an EOF-aware item shape before their separator ownership
can be made as exact as braced lists.

Evidence for the declaration-item factoring batch: targeted ESLint on
`packages/syntax/css/css-parser/src/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle shrank from roughly
982.75 kB ESM before this follow-up to 972.48 kB ESM after it; the focused CSS
AST/public/macro/CST/conditional set passed (5 files / 224 tests); the full CSS
parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed with
parser-shared and all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS transparent-at-rule block factoring follow-up: the public CSS CST
grammar now names the four transparent frame block shapes used by conditional
and known block at-rules:

- `nestedTransparentBlock` for a non-committing `{ declarationList }` tail;
- `topTransparentBlock` for a non-committing `{ stylesheetBody }` tail;
- `nestedExpectedTransparentBlock` for an already-committed
  `expect('{') declarationList }` tail;
- `topExpectedTransparentBlock` for an already-committed
  `expect('{') stylesheetBody }` tail.

This deliberately preserves the opener distinction that was already in the
grammar. `@media` / `@container` query arms keep the committed `expect('{')`
route so missing blocks recover at the query boundary; fallback known-block arms
keep plain `literal('{')` so statement-form at-rules can still fall through when
appropriate. The change is therefore a readability and size cleanup, not a
hidden recovery-policy change.

This is also the nearest preparation for Parseman's `dispatch(...)` shape:
current known at-rule choices now have named frame tails that can be placed
behind `when(...)` cases. The next CSS at-rule work should route the already-read
at-keyword through `dispatch(...)`, preserve the known-vs-generic commitment
with `otherwise(...)`, and keep these named tails rather than doing another
regex-to-word surface pass over at-rule keywords.

Evidence for the transparent-at-rule block factoring batch: targeted ESLint on
`packages/syntax/css/css-parser/src/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle shrank from roughly
972.48 kB ESM before this follow-up to 940.28 kB ESM after it; the focused CSS
AST/public/macro/CST/conditional set passed (5 files / 224 tests); the full CSS
parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed with
parser-shared and all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST block-tail factoring follow-up: the direct CSS AST grammar
now names four internal block-tail combinators,
`cssDeclarationBlockTail`, `cssNestedBlockTail`, `cssConditionalBlockTail`, and
`cssStylesheetBlockTail`, and reuses them across direct AST at-rule reductions.
These are plain combinators, not `node(...)` rules, so they add no public CST or
AST grammar keys. The reducers still receive the same keyword, prelude, and body
children; the factoring only names the repeated block-frame language.

The exclusions are deliberate. `Ruleset` still spells its opener inline because
its selector-to-`{` boundary uses `interstitialTrivia` and must preserve the
public CST comment/trivia behavior. Composite wrappers such as
`CssAstKeyframes` and `CssAstFontFeatureValuesBlock` do not share the
transparent at-rule body language, so they were excluded from this specific
transparent-tail batch and handled later as fixed-body tail languages. This
mirrors the CST frame-tail cleanup without changing public recovery semantics
and is ready to be routed behind Parseman's built-in `dispatch(...)` primitive.

Evidence for the direct-AST block-tail batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle remained roughly
940.28 kB ESM while the AST/index bundle reported roughly 2.19 MB ESM; the
focused CSS AST/public/macro/conditional set passed (4 files / 213 tests); the
full CSS parser suite passed (8 files / 253 tests); `pnpm run check:macro`
passed with parser-shared and all four parser packages fully compiled and 0
interpreter fallbacks; `pnpm run verify:compose-integrity` passed; and
`pnpm run oracle:less:byte-identity` passed byte-identical to the current
709-entry baseline (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS public fixed-body block factoring follow-up: the public CSS CST
grammar now names the fixed at-rule body tails that are not transparent frame
routing:

- `descriptorBodyBlock` for declarations-only `{ descriptorBody }` bodies used
  by descriptor at-rules, keyframe blocks, page margin boxes, and
  `@font-feature-values` feature blocks;
- `keyframesBodyBlock` for `{ keyframesBody }`;
- `pageBodyBlock` for `{ pageBody }`;
- `fontFeatureValuesBodyBlock` for `{ fontFeatureValuesBody }`.

These are internal combinators, not public `node(...)` rules. They replace
repeated literal-open/body/expected-close sequences without changing the body
language, the public CST key names, or the known-vs-generic at-rule commitment
model. This is deliberately not a dispatch substitute: the dispatch primitive
will later own at-keyword classification and `otherwise(...)`; this batch only
names fixed block tails so that the current CST grammar is smaller and easier to
audit before the hostMode merge.

Evidence for the public fixed-body block batch: targeted ESLint on
`packages/syntax/css/css-parser/src/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle shrank from roughly
940.28 kB ESM before this follow-up to 932.35 kB ESM after it; the focused CSS
AST/public/macro/CST/conditional set passed (5 files / 224 tests); the full CSS
parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed with
parser-shared and all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS public frame-body naming follow-up: the public CSS CST grammar now
names the shared frame body tails by the language they accept, rather than by
one of the at-rule semantics that happens to use them:

- `declarationListBlock` for ordinary frame-2 `{ declarationList }` bodies;
- `stylesheetBodyBlock` for ordinary frame-1 `{ stylesheetBody }` bodies;
- `expectedDeclarationListBlock` and `expectedStylesheetBodyBlock` for the same
  two body languages when the caller has already committed to reporting a
  missing `{`.

Use body-language names such as `declarationListBlock` and
`stylesheetBodyBlock`, then reuse the same body tails for `@scope` and
`@document`. The grammar comments at the call sites say which at-rules are
transparent; the combinator names say what bytes they recognize. That is the
hostMode-merge shape: one named body language, used by every at-rule whose spec
body is that language.

Evidence for the frame-body naming batch: targeted ESLint on
`packages/syntax/css/css-parser/src/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle shrank from roughly
932.35 kB ESM before this follow-up to 926.61 kB ESM after it; the focused CSS
AST/public/macro/CST/conditional set passed (5 files / 224 tests); the full CSS
parser suite passed (8 files / 253 tests); `pnpm run check:macro` passed with
parser-shared and all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS query-keyword atom follow-up: the public CSS CST grammar now names
the query-level `not` word as `queryNotKeyword` and the boolean condition join
set as `queryJoinKeyword`, then reuses them across media query condition tails,
supports/container prelude start lookahead, and `QueryCondition`. This is a
small Parseman idiom cleanup, not a language movement: the accepted language is
unchanged because the named combinators are the same `word()` / `keywords()`
boundary definitions previously spelled inline. It keeps query keyword
recognition in one place before later value/query left-factoring, without
turning operator chains into separators or dispatch.

Evidence for the query-keyword atom batch: targeted ESLint on
`packages/syntax/css/css-parser/src/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle now reports roughly
926.42 kB ESM; the focused CSS AST/public/macro/CST/conditional set passed
(5 files / 224 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared and all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST calc var fallback factoring follow-up: the direct CSS AST
grammar now names the repeated fallback component choice as
`varFallbackComponent` and reuses it for both the first component and the
whitespace-separated tail inside `VarFallbackTerm`. The arm ordering is
unchanged: nested `var()` / fallback calls still win before ordinary value pieces
and grouping/punctuation fallback arms. This is intentionally AST-local
readability work; it adds no grammar key, changes no reducer, and does not
pretend to solve the broader `value` / `mathProduct` first-set overlap.

Evidence for the direct-AST calc var fallback batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the focused CSS AST/public/macro/conditional set passed
(4 files / 213 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared and all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST selector-key follow-up: the direct CSS AST grammar now
exposes the core selector family under the same unprefixed grammar keys as the
public CSS CST grammar: `SelectorList`, `ComplexSelector`, `CompoundSelector`,
`BasicSelector`, `AttributeSelector`, `PseudoSelector`, and
`NestingSelector`. Rulesets and pseudo selector arguments now refer to
`g.SelectorList` / `g.ComplexSelector` instead of AST-prefixed names. This is a
grammar-key cleanup only: reducers still produce the same core AST selector
nodes, combinator/descendant handling is unchanged, and the public CST selector
keys remain stable.

The selector pseudo-argument helpers are not the public selector grammar; they
recognize direct-AST-only pseudo argument variants that preserve typed selector
arguments, raw pseudo bytes, relative `:has()` selector arguments, and special
`:nth-* of <selector-list>` handling. They may still remain AST-local in the
first hostMode fold, but their names should describe that pseudo-argument
language rather than carry `CssAst*` mode prefixes.

This batch is also a useful pressure test for the dispatch design. Selector
lists should stay `oneOrMoreSep(g.ComplexSelector, literal(','))`; selector
combinators should stay fixed-token `keywords(...)`; and glued function openers
should stay `noTrivia(sequence(ident, literal('(')))`. None of those shapes is
made clearer by `dispatch(...)`. The dispatch primitive earns its keep only for
known-token routing with a generic unmatched tail, such as known-vs-unknown
at-rules. The unprefixed selector family is therefore an example of the broader
cleanup rule: use the Parseman primitive that names the grammar structure, not a
single fashionable primitive everywhere.

Evidence for the selector-key batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared and produced the expected unprefixed gating diagnostic
`PseudoSelector#0`; the focused CSS AST/public/macro/conditional set passed
(4 files / 213 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared plus all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST value comma-list follow-up: the direct CSS AST grammar now
uses `oneOrMoreSep(...)` for non-empty comma-separated value wrappers, with
`ValueList` as the ordinary CSS value-list shape. The fielded separator
combinator still preserves authored comma/trivia facts through
`fields.separator`, and separators do not become value children. This is the
direct-AST counterpart of the public CST value-list cleanup: a comma is a real
list separator, so the grammar should say that directly instead of spelling
`sequence(first, many(sequence(separator, next)))`.

Rejected in the same review: changing the adjacent/space-separated term wrappers
(`TypedValueSequence`, the former declaration value term, and calc fallback terms) to a
separator-list primitive. Their separators are not just literal delimiter tokens:
they encode authored whitespace/comments versus adjacency, and some arms
deliberately allow another atom without a separator. Those remain hand-shaped
until a narrower Parseman primitive can express "authored interstitial separator
or adjacency" without changing reducer child shape. This is the same lesson as
selectors: use `oneOrMoreSep` for real separators, not for ambient trivia or
nullable pseudo-separators.

Evidence for the value comma-list batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle remained roughly
926.42 kB ESM; the focused CSS AST/public/macro/conditional set passed
(4 files / 213 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared plus all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST fixed-body tail follow-up: the direct CSS AST grammar now
names the remaining fixed body tail languages that were still inline:
`cssPageBlockTail`, `cssKeyframesBlockTail`, and
`cssFontFeatureValuesBlockTail`, with body choices `cssPageBody`,
`cssKeyframesBody`, and `cssFontFeatureValuesBody`. These are internal
combinators, not `node(...)` rules. They replace repeated
literal-open/body/literal-close sequences in `CssAstPageBlock`,
`CssAstKeyframes`, and `CssAstFontFeatureValuesBlock` without changing rule
keys, reducers, or accepted body languages.

Rejected in this review: renaming `CssAstKeyframes` to `Keyframes`. Public CST
has `KeyframeSelectorList` and `KeyframeBlock`, but the whole keyframes at-rule
is still routed through a typed `AtRuleBlock` shape rather than a public
`Keyframes` grammar key. Rename that rule only when the shared hostMode owner
can deliberately preserve or migrate the public CST contract.

Evidence for the fixed-body tail batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle remained roughly
926.42 kB ESM; the focused CSS AST/public/macro/conditional set passed
(4 files / 213 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared plus all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST declaration-key follow-up: the direct CSS AST grammar now
uses unprefixed grammar keys for the declaration head family:
`Property`, `CustomProperty`, `CustomValue`, `Important`, and `Declaration`.
These replace `CssAstProperty`, `CssAstCustomProperty`, `CssAstCustomValue`,
`CssAstImportant`, and `CssAstDeclaration` in the local rule map and references.
The reducers and token recognizers are unchanged, so the raw AST node output
stays byte-identical while the grammar keys move closer to the public CST
concept names that a shared hostMode owner will need.

Rejected in this review: renaming `CssAstKeyword` or the broader
`CssAstDeclarationValue*` / `CssAstValue*` families as part of the declaration
head patch. Those are value-language choices with broader first-set and reducer
shape implications, especially around strict calc routing, `var()` fallback
structure, custom-property values, and authored adjacency. They should be a
separate value-family review, not smuggled into a declaration-name cleanup.
Superseded 2026-07-26 for the generic value spine only: `CssAstValue*` is now
`ValueList*`. Superseded 2026-07-26 for rule keys: declaration, calc, and `var()`
families now use concept names too, while remaining separate accepted-language
contexts. The value-family review first paid the narrow keyword-leaf slice, then
the generic value spine, calc, `var()` fallback, and declaration-value families
as separate accepted-language slices.

Evidence for the declaration-key batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; `pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared; the generated public CSS grammar bundle remained roughly
926.42 kB ESM; the focused CSS AST/public/macro/conditional set passed
(4 files / 213 tests); the full CSS parser suite passed (8 files / 253 tests);
`pnpm run check:macro` passed with parser-shared plus all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Latest CSS direct-AST at-rule statement-key follow-up: the direct CSS AST
grammar now uses public concept keys `ImportStatement` and `AtRuleStatement` for
the two statement-form at-rule reducers. These replace `CssAstImport` and
`CssAstAtRuleStatement` in the local rule map, document body choices, and focused
rule-level tests. Reducers still produce core `AtRuleStatement` AST nodes, and
`@import` remains ordered separately from generic statement at-rules so malformed
and boundary coverage is unchanged.

Rejected in this review: renaming `CssAstImportUrl`,
`CssAstImportUrlUnquoted`, or `CssAstImportTail*`. Superseded 2026-07-26 for
rule keys only: the import URL and tail helpers are now `ImportUrl*` /
`ImportTail*`, but they remain import-local and explicitly covered by
macro/focused tests. A later verified follow-up did rename the prelude and
opaque block helpers to
`AtPrelude`, `StatementPrelude`, `OpaqueAtPrelude`, `OpaqueBody`, and
`OpaqueAtRuleBlock`; do not use this older statement-key slice as evidence that
those names must remain prefixed.

Evidence for the at-rule statement-key batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` and
`packages/syntax/css/css-parser/test/ast-grammar.test.ts` passed;
`git diff --check` passed; dependency-ordered `@jesscss/parser-shared` and
`@jesscss/css-parser` builds passed; the focused CSS AST/public/macro/conditional
set passed (4 files / 213 tests); the full CSS parser suite passed (8 files /
253 tests); `pnpm run check:macro` passed with parser-shared plus all four
parser packages fully compiled and 0 interpreter fallbacks;
`pnpm run verify:compose-integrity` passed; and
`pnpm run oracle:less:byte-identity` passed byte-identical to the current
709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

Parseman authoring guidance is simple: consume the decisive token shape once,
route it with `dispatch(...)`, and keep the generic continuation in
`otherwise(...)`. Use `routed()` when a branch node needs the already-consumed
token or span. Use `node(..., { project: index })` for trivial semantic
projection wrappers. Do not invent CSS-local `dispatchByAtKeyword(...)` helpers
or hide known-vs-generic routing behind `choice(...)` ordering.

The `when(...)` strings are case keys for the token consumed by the dispatch
combinator; they are not terminals parsed after that token. For example:

```ts
const AtRule = dispatch(
  atKeywordToken,
  caseOf('@scope', sequence(scopePreludeTail, block)),
  caseOf('@media', sequence(mediaPreludeTail, block)),
  otherwise(sequence(genericPreludeTail, block))
);
```

For repeated case-insensitive CSS/Less tables, prefer a grammar-local
`const caseOf = makeWhen({ caseInsensitive: true })` helper. Use one helper for
that one matching policy across at-rules, functions, pseudos, and words unless a
const-level review proves a genuinely different policy.

The Parseman API deliberately avoids object maps here: case keys can be
arbitrary strings, and a literal `default` can be an ordinary token value. It
also avoids a general key callback. If a grammar needs shape routing after a
token is read, use matcher cases such as `endsWith('(')`.

Pressure-test against current grammar shapes:

This pressure test is intentionally concrete, not a license to sprinkle
`dispatch(...)` over any `choice(...)`. The current smell it should replace is a
mirrored known-or-generic shape: a positive list of known tokens, plus a generic
fallback guarded by `not(theSameKnownList)`. The ergonomic win comes from
collapsing that duplicate inventory into one token classification point with an
`otherwise(...)` tail. List separators, selector combinators, glued function
openers, and reserved-identifier exclusions are different grammar problems and
should keep using their own Parseman idioms.

- Strong replacement: CSS `AtRuleBlock` / `AtRuleBlockTop` plus
  `UnknownAtRuleBlock`. Today the grammar repeats every known block at-keyword in
  both the typed arms and `knownBlockAtKeyword`, then protects the opaque fallback
  with `sequence(not(knownBlockAtKeyword), atKeyword)`. A single dispatch at this
  decision point can express the real language: `when('@scope', scopeTail)`,
  `when('@media', mediaTail)`, descriptor/keyframes/page/document cases, and
  `otherwise(unknownBlockTail)`. The dispatch must still be frame-aware:
  transparent at-rules use `stylesheetBody` at top level and `declarationList`
  when nested, so either pass the frame into tail construction or keep top/nested
  dispatch variants.
- Strong but secondary replacement: CSS `QueryAtRuleBlock` / `QueryAtRuleBlockTop`
  currently repeat `@media`, `@container`, and `@supports` in sibling
  `sequence(...)` arms. Dispatch makes this readable, but it should either live
  under the larger at-rule dispatch or have carefully specified unmatched-key
  rollback; otherwise an unmatched `@layer` can be claimed too early.
- Secondary CSS statement replacement: `@import` versus generic
  `AtRuleStatement`. `@import` must commit to an import prelude and required
  semicolon, while `@importx` is generic. This is the same known-token
  commitment shape, but block at-rules should prove the primitive first.
- Strong later replacement: Less `QueryAtRuleBlock` / `SupportsAtRuleBlock` /
  `ImportAtRuleStatement` / generic at-rule stack. This is the same commitment
  problem, with Less interpolation and bare-variable malformed fallback layered
  in. Defer until CSS establishes the token/key contract.
- Strong later replacement: SCSS and Jess query-interpolation at-rule overlays.
  `ScssQueryInterpBlock`, `ScssScopeBlock`, `ScssLayerBlock`, and Jess
  `QueryInterpAtRuleBlock` are dialect tails for specific known at-keyword
  values. They should become cases only after the CSS/Less dispatcher proves how
  typed known cases compose with interpolation and malformed-fallback recovery.
- Narrow later replacement: Jess's compiler at-rules (`@-compose`, `@-export`,
  `@-import`, `@-use`, `@-from`) can become a small dispatch over Jess-specific
  at-keywords. This is ergonomically useful, but it is not on the critical path
  for CSS sharing; do it during the Jess pass so it does not obscure CSS/Less
  at-rule conformance.
- Dialect hazard: Less `AtRuleMalformed`, SCSS `AtRuleMalformed`, and Jess
  dynamic media are not generic "otherwise" shortcuts. They encode dialect
  recovery or intentionally narrow interpolation accept sets. When these move
  under dispatch, keep malformed recovery and interpolation tails as explicit
  cases/tails, not as post-parse scanners or broad generic fallbacks.
- Not a dispatch target: `sequence(not(mediaTypeReserved), ident)` and similar
  reserved-word identifier guards. Those want a sibling `identExcept(...)` or
  reserved-word token primitive.
- Dispatch target: identifier-or-function positions (`foo` vs `foo(`). Consume
  the bare identifier or glued function opener once, route exact known openers,
  route all other `name(` forms with `endsWith('(')`, and route bare identifiers
  through `otherwise(...)`.

Ergonomic pressure test against live grammar code:

| Current shape | Candidate dispatch shape | More ergonomic? | Reason |
| --- | --- | --- | --- |
| CSS `knownBlockAtKeyword = choice(mediaAtKeyword, ..., documentAtKeyword)` plus `unknownBlockAtKeyword = sequence(not(knownBlockAtKeyword), atKeyword)` | `dispatch(atKeywordToken, when('@media', mediaTail), ..., otherwise(unknownBlockTail))`, where `@media` is the matched value of the consumed token, not a following terminal | Yes, strongly. | It removes the duplicate known-keyword inventory and states the CSS Syntax decision directly: one at-keyword token, route by matched value, then parse the selected tail. |
| CSS `AtRuleBlock` and `AtRuleBlockTop` each restating transparent `@container` / `@supports` / `@starting-style` / `@layer` arms | `makeBlockAtRule(frameBody)` returning a dispatch whose transparent tails close over either `stylesheetBody` or `declarationList` | Yes, if frame is explicit. | The grammar becomes smaller without pretending top-level and nested bodies are the same language. |
| CSS `QueryAtRuleBlock = choice(sequence(@media, ...), sequence(@container, ...), sequence(@supports, ...))` | Nested dispatch over the same at-keyword token or cases inside the outer at-rule dispatch | Mild yes. | It removes sibling keyword arms, but only if it does not claim an unmatched at-keyword before the larger at-rule router sees it. |
| CSS `ImportStatement` ordered before generic `AtRuleStatement` | `dispatch(atKeywordToken, when('@import', importStatementTail), otherwise(genericStatementTail))` | Yes, after block at-rules prove the primitive. | `@import` is a known-token commitment: bad import prelude is an import error, while `@importx` remains a generic statement. |
| Less `queryAtKeyword = keywords(['@media', '@container', '@supports'])` plus separate `SupportsAtRuleBlock`, generic `AtRuleBlock`, `AtRuleStatement`, and `AtRuleMalformed` | Dispatch with explicit `@supports`, query, import, generic block/statement, and malformed-recovery tails | Yes later, not first. | The structure would be clearer, but only after dispatch proves matched-tail commitment and keeps Less interpolation / bare-variable recovery as grammar tails. |
| SCSS `ScssQueryInterpBlock`, `ScssScopeBlock`, `ScssLayerBlock`, generic `AtRuleBlock`, and generic `AtRuleStatement` | Dispatch cases for known CSS/SCSS at-keywords with interpolation-specific tails | Yes later. | These are real token-value routes, but the dialect-specific interpolation tails must not collapse into a broad generic `otherwise(...)`. |
| Jess `ComposeAtRule` / `ExportAtRule` / `ImportAtRule` / `UseAtRule` / `FromAtRule` listed at the front of both stylesheet and declaration lists | Small Jess-only dispatch for compiler at-rules | Yes, but narrow. | It reduces repeated ordering in Jess last, but it does not help the shared CSS base and should not distract from CSS/Less at-rule conformance. |
| CSS `SelectorList = oneOrMoreSep(g.ComplexSelector, literal(','))` | No dispatch | No. | This is already the right Parseman list idiom. The remaining selector concern is the complex-selector / descendant-combinator model, not keyword dispatch. |
| CSS `ComplexSelector = sequence(CompoundSelector, many(sequence(optional(combinator), CompoundSelector)))` | No dispatch | No. | The question is whether ambient trivia can represent a descendant combinator and how to pin that spec behavior. Dispatch has no useful value channel here. |
| CSS/Less/SCSS identifier-or-function positions (`ident` or glued `name(`) | `dispatch(identOrFunctionOpen(...), caseOf('url(', urlTail), caseOf('calc(', calcTail), when(endsWith('('), genericFunctionTail), otherwise(identifierTail))` | Yes, strongly. | The opener is consumed once and routed by its full matched value. Exact known function cases own malformed-tail commitment, generic functions share one suffix case, and bare identifiers never pay a failed function reparse. |
| Reserved identifier guards such as media type / container name exclusions | `identExcept(...)`, not dispatch | No. | These are identifier-family exclusions, not known-at-rule routing. A dispatch would obscure the spec rule and still leave leading `not(...)` debt elsewhere. |

The ergonomics bar is therefore concrete: dispatch is a win only when it removes
both parts of the current smell, the positive known arm and the mirrored
negative generic guard. If it merely replaces `word('@media')` with
`when('@media', ...)` while leaving an outer generic fallback in a normal
`choice`, it is worse than the current grammar because the commitment rule is
hidden. Conversely, if it owns the generic tail through `otherwise(...)`, the
grammar reads closer to the spec and the accepted language is easier to audit.

Critical API consequence from the pressure test: v1 should use dispatch at the
**whole known-or-generic decision point** with `otherwise(...)` inside the same
combinator. A known-only dispatch nested inside an outer `choice(...,
UnknownAtRuleBlock)` would need global committed-failure semantics to prevent a
matched known case with a bad tail from falling through to generic. Keep v1
smaller: one consumed token, static `when(...)` table, optional `otherwise(...)`
for unmatched keys, duplicate-key checks after normalization, and no fallback
after a matched case fails.

Implementation pressure from Parseman: the proposed primitive now carries a
committed-failure channel so the interpreter and compiled parsers agree when a
matched case's tail fails. That makes `choice(dispatch(...), genericAtRule)`
correct in principle, but it is still the wrong first Jess shape for known-vs-
generic CSS at-rules. The grammar should put the generic tail inside
`otherwise(...)` so the commitment rule is local, obvious, and auditable at the
same point where the at-keyword is classified.

Jess-side dispatch usage must be proved at the grammar boundary where it lands,
not by re-running Parseman's release test plan in this repo. For each dispatch
rewrite, verify the interpreted and macro-compiled parser outputs for the
touched rule family, check that `routed()` gives the selected branch the desired
CST/AST ownership, and include malformed-known cases that must not fall through
to a generic tail. `check:macro` must keep 0 interpreter fallbacks for the folded
dialect before the batch is considered safe.

## Required gates

For CSS and Less-impacting batches:

- focused CSS parser tests for the touched family;
- `pnpm run oracle:less:byte-identity`;
- `pnpm run check:macro`;
- `pnpm run verify:compose-integrity`;
- `verify:types` and lint before landing a batch that changes exported grammar
  shape;
- language-service tests at CST-shape milestones.

Perf may be measured for confidence, but no speed claim is valid without a
before/after SHA, method, and noise-floor read.

## Evidence from the hostMode infrastructure slice

Commands run from `/private/tmp/jess-grammar-sequence-orchestrator` on
2026-07-25 after setting CSS's public grammar to `hostMode: 'cst'` and wrapping
the CSS CST build host with Parseman's official `cstBuildHost()` metadata:

- `pnpm --filter @jesscss/css-parser test -- --run test/cst-public.test.ts
  test/cst.test.ts test/macro-compiled.test.ts` passed: 3 files / 16 tests.
- After lifting the public CSS grammar body into `cssFactory`, the same focused
  CST/macro set passed again: 3 files / 16 tests.
- The full CSS parser suite passed after the factory extraction:
  `pnpm --filter @jesscss/css-parser test -- --run` reported 8 files / 242
  tests. An earlier concurrent full-suite run failed while another verification
  command was rebuilding parser artifacts; the serial rerun was clean.
- Built dependency order: `@jesscss/parser-shared`, `@jesscss/core`,
  `@jesscss/css-parser`, `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/jess-parser` all passed.
- Dialect focused tests passed:
  `@jesscss/less-parser` public/conditional tests (2 files / 181 tests),
  `@jesscss/scss-parser` public/conditional tests (2 files / 157 tests), and
  `@jesscss/jess-parser` conditional tests (1 file / 105 tests).
- `pnpm run check:macro` passed with parser-shared and all four parser packages
  fully compiled and 0 interpreter fallbacks.
- `pnpm run verify:compose-integrity` passed with exit code 0.
- `pnpm --filter @jesscss/css-parser test -- --run test/ast-grammar.test.ts
  test/macro-compiled.test.ts test/cst-public.test.ts test/public-parse.test.ts
  test/conditional-at-rule-value.test.ts` passed: 5 files / 213 tests.
- `pnpm run oracle:less:byte-identity` passed: 707 corpus entries,
  byte-identical to baseline.
- After refactoring the CSS CST host wrapper to avoid wide callback signatures,
  `git diff --check`, targeted ESLint on `src/cst.ts` and `src/grammar.ts`,
  `pnpm --filter @jesscss/css-parser build`, and the focused CST/macro test set
  above all passed.
- After the `cssFactory` extraction, targeted ESLint on `src/grammar.ts` and
  `src/cst.ts`, `pnpm --filter @jesscss/css-parser build`,
  `pnpm --filter @jesscss/less-parser build`, `pnpm run check:macro`,
  `pnpm run verify:compose-integrity`, `pnpm run oracle:less:byte-identity`,
  and `git diff --check` all passed. `check:macro` reported parser-shared plus
  all four parser packages fully compiled with 0 interpreter fallbacks.
- After the direct AST `cssFactory` extraction and AST import cleanup, targeted ESLint
  on `src/ast/grammar.ts`, `src/grammar.ts`, and `src/cst.ts` passed with zero
  warnings or errors. Focused CSS AST/public/macro tests passed: 3 files / 104
  tests. Focused CSS CST/macro tests passed: 3 files / 16 tests.
  The full CSS parser suite passed: 8 files / 242 tests.
  `pnpm --filter @jesscss/css-parser build`, `pnpm run check:macro`,
  `pnpm run verify:compose-integrity`, and
  `pnpm run oracle:less:byte-identity` all passed; the oracle reported 707
  corpus entries byte-identical on both surfaces
  (`aggAst=d436f6e07d267ffad4bfdd06dfa363ad170b64985e1a5c6aef0fcd21d84b290a`,
  `aggCst=48e1e9dc0b80b8acae3f9adcb723243cf66a94da288634f81863f708093c3b27`),
  and `check:macro` reported parser-shared plus all four parser packages fully
  compiled with 0 interpreter fallbacks.

Two broader hygiene gates were attempted but are not clear evidence for this
slice yet:

- `pnpm run verify:types` fails in unrelated workspace packages because several
  built package entrypoints are missing from the temporary worktree and because
  existing strict diagnostics remain.
- `pnpm --filter @jesscss/css-parser lint` hits a project-service error on
  `packages/syntax/css/css-parser/tsdown.config.ts`; use targeted ESLint on the
  touched CSS source files until that package-level lint setup is repaired.

## Parseman dispatch guidance

`parseman@0.41.0` is the Jess grammar floor. Treat dispatch as a current
authoring primitive, not a future dependency. Use it wherever sibling arms share
an opener, route by the value already consumed, and include a generic
continuation for the same token family.

Core semantics:

- `dispatch(combinator, ...arms)` parses the routing combinator once and uses
  its string value as the dispatch key.
- Parse shared structure outside `dispatch(...)` and route on the smallest
  meaningful combinator whose value decides the tail. A routing combinator that
  captures extra prefix structure just to manufacture a key is a review finding;
  keep that prefix in the surrounding `sequence(...)` and dispatch on the marker
  or token that actually distinguishes the branches.
- `when(key, tail)`, `when([keys], tail)`, and
  `when(key, tail, { caseInsensitive: true })` are static case arms. Duplicate
  keys, including duplicates after case folding and across grouped arms, fail at
  construction time.
- `makeWhen(...)` is the helper for repeated case arms with the same matching
  policy. In Jess grammars, define one helper per real policy; do not split
  `pseudoCase`, `fnCase`, `atCase`, etc. when they are all the same
  case-insensitive exact match.
- Matcher cases such as `when(endsWith('('), tail)` and `when(startsWith('--'),
  tail)` are for broad token families where the token's shape matters after it
  has been read. Prefer exact string cases before matcher cases.
- `otherwise(tail)` is only for unmatched routing values.
- If the routing combinator fails, the dispatch failure is ordinary and an
  enclosing `choice` may try a later arm.
- If a key matches, or `otherwise` is selected, the selected tail's failure is
  committed. It does not fall through to another dispatch arm, `otherwise`, or
  an outer generic fallback.
- Use `routed()` inside a branch node when that branch should own the
  already-consumed value/span. Do not reparse the same opener just to get it into
  a node.
- Do not use a key callback or bespoke parser-local dispatch helper for
  this pattern. If the grammar needs case folding, use case-insensitive
  `when(...)` or `makeWhen(...)`; if the grammar needs a shape bucket, use a
  matcher case such as `endsWith('(')`.

Primary Jess rewrite targets now that the current Parseman floor is resolved:

- **Known-or-generic at-rules.** CSS block/statement at-rule routers should
  dispatch on an at-keyword-shaped token and keep `otherwise(...)` as the unknown
  at-rule tail. Less/SCSS/Jess variants should do the same in their own contexts,
  with dialect-specific malformed and interpolation tails explicit.
- **Identifier-or-function values.** Consume `ident` or a glued function opener
  once, route exact known openers such as `url(` / `calc(` / `var(`, route other
  `name(` forms with `when(endsWith('('), GenericFunction)`, and route bare
  identifiers through `otherwise(...)`.
- **Pseudos.** Consume the colon-qualified bare name or glued pseudo-function
  opener once, then route special pseudo functions, generic pseudo functions, and
  bare pseudos without repeating colon/name recognition.
- **Dialect extension splits.** Less variable declaration/reference/call
  boundaries, SCSS/Jess sigil constructs, and Jess compiler at-rules should use
  dispatch when they share a consumed opener and diverge by the value or suffix.

Dispatch is not the right primitive for everything. Keep `oneOrMoreSep(...)` for
real separator-owned lists, `keywords(...)` / `word(...)` for closed keyword
sets with no generic continuation, `peek(...)` for zero-width list boundaries,
and future `identExcept(...)`-style structure for reserved-word exclusions.
Descendant combinators are ambient trivia between compound selectors; dispatch
does not model that.

When reviewing `choice(...)`, ask whether the sibling arms share a broad opener
and whether one arm is the generic fallback for the same family. If yes,
`dispatch(...)` is the default shape unless a const-level review proves a
smaller first-set gate, separator helper, or explicit recursive grammar is more
accurate. If the arms are literal-led, first-set-disjoint, a closed keyword set,
or first-arm-dominant with cheap tails, keep `choice(...)` / `keywords(...)`;
rewriting those to dispatch is churn, not cleanup.

## Parseman 0.40 scout items

These are not blockers for the four-grammar fold, but they are the right
questions for a Parseman 0.40 design scout because they shrink grammar/AST
boilerplate rather than just renaming it.

### Declarative node projection

The Less/CSS AST reducers still carry many tiny helpers whose only job is to
drop punctuation tokens, keep CST children visible, or project one child as the
semantic value. Prefer a lean extension of the existing `node(...)` /
functional-combinator shape over a new top-level helper name unless the real
Jess grammar boilerplate proves the helper is smaller and clearer. Any
projection surface must keep CST children, spans, and trivia visible from
hostMode output; semantic value shaping must not erase syntax ownership.

### Selector-tail collection for `:extend(...)`

Less inline extend is a richer pressure test than ordinary dispatch. It is not
just a token-value router: `:extend(...)` is an optional terminator on a selector
branch or the final branch of a ruleset selector list, and the parser must
preserve both the selector subject and the collected extend targets. The current
direct Less grammar shape is a rejected end-state because it works around that
contextual tail by:

- stopping ordinary selector runs before `:extend(`;
- reparsing inline-extend selector branches through `DirectLessInlineExtendRule`;
- using a broad `directInlineExtendAhead` lookahead so ordinary rulesets do not
  pay the full inline-extend parse/backtrack cost;
- treating ruleset-body `&:extend(...)` statements as separate
  `DirectLessExtendStatement` facts.

A 0.40 helper should make the no-reparse shape pleasant enough that grammar
authors naturally choose it. The desired grammar shape is a selector-list
combinator/helper parameterized by context, roughly
`selectorList({ allowExtendTail: true })` for ruleset headers and the stricter
plain selector list elsewhere. It must parse selector branches once, allow
`:extend(...)` only at the legal branch terminator positions for a ruleset
selector, return the selector list plus collected extend facts, and let the AST
reducer decide whether those facts become prepended sibling `$extend`/extend
nodes or first children of the ruleset according to the existing Less/Jess
extend semantics.

This is not optional cleanup: any agent proposal that keeps selector reparse,
source scanning, or broad `:extend(` lookahead as the steady state is a grammar
architecture finding. The helper must be adversarially reviewed against
`packages/core/src/tree/util/EXTEND_RULES.md`: extend matching is selector
equivalency-based, full/partial mode is target matching policy, and parser
convenience must not special-case matching based on selector-list context. The
parser's job is only to preserve source structure and collect the authored
extend facts without reparsing, source scanning, or broad negative lookahead.
Any helper that bakes in matching policy, changes `all` / `!all`
interpretation, or hides selector/CST ownership is the wrong abstraction.

Latest dispatch pressure-test against the live Jess grammars, 2026-07-26:

- CSS remains the proof target. `stylesheetBody`, `declarationList`,
  `AtRuleBlock`, `AtRuleBlockTop`, and `UnknownAtRuleBlock` still carry the
  repeated `@`-led known-vs-generic shape; dispatch should replace that whole
  decision point, not only individual `word('@media')` leaves.
- Less has the same at-rule router smell, but its tails are not one generic
  shape. `@supports` is intentionally stricter, while `@media` / `@container`
  and malformed bare-variable recovery must remain explicit tails. A naive
  `when('@media', structuredOnly)` would be a behavior change.
- SCSS confirms dispatch is useful for query/scope/layer and other at-keyword
  routes, but a single huge "SCSS statement router" would be too broad because
  top-level, declaration-body, and at-rule-body contexts do not admit the same
  Sass directives.
- Jess compiler at-rules (`@-compose`, `@-export`, `@-import`, `@-use`,
  `@-from`) are a later narrow dispatch target, after CSS/Less prove the
  at-rule router and after Jess itself is the active dialect.
- Function and pseudo-name dispatch are first-class cleanup targets now that
  `0.41.0` is resolved. They require a routing combinator that consumes either a
  bare name or a glued `name(` opener, exact cases written against the full
  opener (`when('url(')`, not `when('url')`), a generic `endsWith('(')` case for
  other functions, and `otherwise(...)` for bare names.
- Selector lists, descendant combinators, fixed operator sets, and reserved
  identifier exclusions are not dispatch targets. Keep `oneOrMoreSep(...)`,
  `keywords(...)`, `peek(...)`, and future `identExcept(...)`-style primitives
  for those grammar problems.

`makeWord(...)` factory-alias pressure test:

- A direct chained macro form such as
  `makeWord('-_0-9A-Za-z', { caseInsensitive: true })('@media')` lowers under
  Parseman 0.38, but a reusable top-level alias such as
  `const cssWord = makeWord('-_0-9A-Za-z', { caseInsensitive: true })` does not.
  In Jess grammar files the transform removes the macro import and leaves
  `makeWord(...)` in the emitted grammar module, so tests fail at runtime with
  `ReferenceError: makeWord is not defined`.
- A factory-local alias inside the `rules(...)` factory DOES macro-lower under
  the current `parseman@0.41.0`. That makes `const asciiWord = makeWord(...);`
  / `const identWord = makeWord(...);` a good CSS grammar-factory cleanup, while
  the same alias at module scope remains unsafe.
- For CSS now, prefer factory-local `makeWord(...)` aliases where several rules
  share one boundary policy. Keep top-level shared-recognition artifacts on
  direct `word(...)` / `keywords(...)` calls, or direct chained `makeWord(...)(...)`,
  until Parseman can preserve or lower module-scope word factories.
- The Parseman follow-up should be explicit: either macro-lower top-level factory
  aliases and their calls, or preserve the import when the factory is left as
  runtime code. Until then, do not land a grammar batch that depends on
  module-scope `makeWord(...)` aliases passing macro compilation.

Latest CSS CST word-factory cleanup: `packages/syntax/css/css-parser/src/grammar.ts`
now imports `makeWord` and defines factory-local `asciiWord` / `identWord`
helpers inside `cssFactory`. This removes repeated `word(..., { caseInsensitive:
true })` calls for fixed CSS words and at-keywords without changing the
known/generic at-rule router. Evidence: a direct `transformMacro` probe against
the current `parseman@0.41.0` showed top-level aliases leave `makeWord(...)` in the
emitted module, while factory-local aliases, direct chained `makeWord(...)`, and
`word(...)` all lower without runtime parseman calls.

Superseded pre-fold CSS AST note: the referenced `src/ast/grammar.ts` file has
been deleted; keep this only as historical evidence for cleanup that was later
folded into the surviving `src/grammar.ts`.

Latest CSS direct-AST body vocabulary follow-up: the direct CSS AST grammar now
uses the same private body-language vocabulary as the public CST grammar for the
fixed at-rule body families: `declarationListBlock`, `descriptorBodyBlock`,
`stylesheetBodyBlock`, `pageBodyBlock`, `keyframesBodyBlock`, and
`fontFeatureValuesBodyBlock`. The frame item choices are named by the language
they admit (`declarationListItem`, `descriptorBodyItem`,
`conditionalGroupBodyItem`, `stylesheetBodyItem`, and the fixed at-rule body
items) instead of by an AST-local `css...Tail` convention.

This is a no-language-change convergence batch for the future hostMode grammar:
the `node('CssAst...')` public keys, reducers, statement collection helpers, and
known-vs-generic at-rule commitment model are unchanged. Rejected in this pass:
renaming `CssAstScopeBlock` / `CssAstLayerBlock` / `CssAstKeyframes` or using the
unpinned Parseman dispatch design. Those are broader public-key and
at-keyword-routing changes, not private vocabulary cleanup.

Evidence for the direct-AST body vocabulary batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed before the evidence note was updated; old `css...Body` /
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

Latest CSS CST custom-property conformance follow-up: the public CSS CST
grammar now recognizes custom-property names with the same escaped dashed-ident
shape as the shared direct-AST recognizer. The old CST terminal accepted bare
`--` and rejected escaped names such as `--\78`; the current terminal requires
at least one custom-property name code point after `--` and accepts CSS escapes.
The regression in `test/cst-public.test.ts` pins both sides: `--\78` produces a
`CustomDeclaration`, while reserved bare `--` is rejected through errors or
unconsumed input.

Rejected in this pass: carrying a permissive IE/Less-style custom-property or
property-name hack into the CSS base. Ordinary CSS property names are still the
shared `ident` terminal, and custom properties are the separate dashed-ident
branch. Any dialect-specific interpolation or compatibility prefix belongs in a
dialect grammar, not in the base CSS CST recognizer.

Evidence for the CSS CST custom-property batch: focused public CST tests passed
(1 file / 12 tests); dependency-ordered `@jesscss/parser-shared` and
`@jesscss/css-parser` builds passed; the full CSS parser suite passed (8 files /
254 tests); `pnpm run check:macro` passed with parser-shared plus all four
parser packages fully compiled and 0 interpreter fallbacks (`@jesscss/css-parser`
reported 5085 `charCodeAt` vs 495 `RegExp.exec`); `pnpm run
verify:compose-integrity` passed; and `pnpm run oracle:less:byte-identity`
passed byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS direct-AST keyword-leaf follow-up: the direct CSS AST grammar now
exposes ordinary identifier component values as `Keyword` instead of
`CssAstKeyword`, and dashed custom-property identifiers used as component values
as `CustomPropertyValue` instead of `CssAstCustomPropertyValue`. This is the
narrow value-family review that the earlier declaration-key batch deferred.
Recognition remains the same shared keyword / custom-property terminals, and
both reducers still emit core `Keyword` AST leaves.

Rejected in this pass: folding `CustomPropertyValue` into ordinary `Keyword` or
renaming the broader value, declaration, function, or calc families.
Superseded 2026-07-26 for rule keys: the generic value spine,
declaration-value family, strict calc arithmetic, function calls, and `var()`
fallback now use concept names after separate accepted-language reviews. Dashed
identifiers are still a separate named value leaf.

Evidence for the keyword-leaf cleanup: no `CssAstKeyword` or
`CssAstCustomPropertyValue` references remain in CSS parser source or tests;
targeted ESLint on `src/ast/grammar.ts` passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; `pnpm run
oracle:less:byte-identity` passed byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0); and tracked plus untracked-doc diff checks passed
before this note was added.

Latest CSS direct-AST ruleset-key follow-up: the direct CSS AST grammar now
exposes the qualified-rule owner as `Ruleset`, matching the public CSS CST
grammar key and the already-normalized selector family (`SelectorList`,
`ComplexSelector`, `CompoundSelector`, `BasicSelector`, `AttributeSelector`,
`PseudoSelector`, and `NestingSelector`). This is a rule-key cleanup only:
recognition still parses a selector list, optional block comments before `{`,
and the declaration-list body; the reducer still emits the same core `Rule`
node.

Rejected in this pass: factoring the ruleset opener into the transparent block
tail helpers. That boundary intentionally uses `interstitialTrivia` and must
continue to model the CST-visible selector/comment/brace behavior. The cleanup
removes an obsolete `CssAst*` owner name without pretending the qualified-rule
opener is the same language as at-rule block tails.

Evidence for the direct-AST ruleset-key batch: targeted ESLint on
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; `git diff --check`
passed; no `CssAstRuleset` references remain in CSS parser source; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered `@jesscss/parser-shared` and `@jesscss/css-parser` builds
passed; the full CSS parser suite passed on the serial rerun (8 files / 254
tests); `pnpm run check:macro` passed with parser-shared plus all four parser
packages fully compiled and 0 interpreter fallbacks; `pnpm run
verify:compose-integrity` passed; and `pnpm run oracle:less:byte-identity`
passed byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0). An earlier full CSS suite invocation failed while
`verify:compose-integrity` was concurrently cleaning/rebuilding CSS `lib/`;
those module-not-found failures were an invalid artifact race, and the serial
rerun is the valid evidence.

Latest CSS direct-AST root-key follow-up: the direct CSS AST grammar now exposes
its root entry as `Stylesheet`, matching the public CSS CST start rule and the
core AST node it already returns. `parse()` now runs `cssAstGrammar.Stylesheet`,
and direct AST tests use the same public root key. This is a no-language-change
entry-key cleanup; the root still admits the same stylesheet body items and
still reduces to the same canonical `Stylesheet` AST.

Rejected in this pass: renaming `CssAstDocumentBlock`. That rule represents the
distinct `@-moz-document` / document-at-rule block family, not the root
stylesheet, and it still has no one-to-one CST peer until at-rule block routing
is folded.

Evidence for the root-key cleanup: no `CssAstDocument` references remain in CSS
parser source or tests except the intentional `CssAstDocumentBlock` rule family;
`parse()` and direct AST tests reference `cssAstGrammar.Stylesheet`; targeted
ESLint on `src/ast/grammar.ts`, `src/index.ts`, and the affected CSS parser tests
passed; focused CSS AST/public/macro/CST/conditional tests passed (5 files / 225
tests); dependency-ordered `@jesscss/parser-shared` and `@jesscss/css-parser`
builds passed; the full CSS parser suite passed (8 files / 254 tests);
`pnpm run check:macro` passed with parser-shared plus all four parser packages
fully compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Superseded CSS direct-AST comment-key follow-up: this historical slice renamed
standalone block comments from `CssAstComment` to `Comment`, matching the core
AST node it already emitted at the time. That was a no-language-change key
cleanup, not the target architecture. The current grammar review standard treats
CSS comments as trivia: standalone and inline comments should be extracted into
parser-owned rule/source trivia, while grammar-level `Comment` nodes and
production-local `many(blockComment)` plumbing are migration debt unless a
specific opaque scanner/capture requires the bytes locally. Less's
block-comment-only ruleset output must be preserved by a trivia-backed
body-span renderability check; it is not a reason to keep comments in grammar
body-item choices or rules arrays.

Evidence for the comment-key cleanup: no `CssAstComment` references remain in
CSS parser source or tests; `src/ast/grammar.ts` now exposes `Comment` and all
call sites use `g.Comment`; targeted ESLint on `src/ast/grammar.ts` passed;
focused CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; `pnpm run
oracle:less:byte-identity` passed byte-identical to the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0); and both tracked plus untracked-doc diff checks
passed.

Latest CSS direct-AST pseudo-argument helper-key follow-up: the direct CSS AST
grammar now names its pseudo-argument helper family by the accepted syntax
rather than by CSS/AST ownership. `CssAstPseudoArgument` became
`PseudoArgument`, `CssAstOfTypePseudoArgument` became `OfTypePseudoArgument`,
the An+B helper arms became `LeadingDashPseudoArgument`,
`TypedNthPseudoArgument`, `LeadingDashOfTypePseudoArgument`,
`TypedOfTypePseudoArgument`, and `LeadingDashRawPseudoArgument`, while
selector-only pseudo helpers now use `SelectorOnlyPseudoArgument`,
`GenericPseudoArgument`, and `RelativeComplexSelector`. `PseudoSelector` remains
the public selector rule; this cleanup changes rule keys and diagnostics only,
not pseudo selector recognition or emitted selector AST.

Rejected in this pass: folding these helpers into the public CST pseudo
argument shape or using `dispatch(...)` for pseudo names. The pseudo helper
language is still AST-specific because it preserves structured selector
arguments and raw pseudo bytes; the later hostMode fold can decide which helpers
stay internal. `dispatch(...)` remains a better fit for known-token routing with
a generic fallback, especially at-rules, not for this colon/family-specific
selector branch.

Evidence for the pseudo-argument helper-key cleanup: no old
`CssAstPseudoArgument` / `CssAstSelectorOnlyPseudoArgument` / related helper
names remain in CSS parser source or tests; targeted ESLint on
`src/ast/grammar.ts` passed; focused CSS AST/public/macro/CST/conditional tests
passed (5 files / 225 tests); dependency-ordered parser-shared and css-parser
builds plus the full CSS parser suite passed (8 files / 254 tests); `pnpm run
check:macro` passed with parser-shared plus all four parser packages fully
compiled and 0 interpreter fallbacks; `pnpm run verify:compose-integrity`
passed; and `pnpm run oracle:less:byte-identity` passed byte-identical to the
709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Superseded pre-fold CSS AST note: the referenced `src/ast/grammar.ts` file has
been deleted; keep this only as historical evidence for cleanup that was later
folded into the surviving `src/grammar.ts`.

Latest CSS direct-AST function-call key follow-up: the direct CSS AST grammar
now exposes ordinary glued function calls as `Call` and strict `calc(...)` calls
as `CalcCall`, matching the public CSS CST concept keys. Recognition and
reducers are unchanged: generic `Call` still uses `nonCalcFunctionOpen`,
`calc(...)` is still excluded from generic call parsing and routed through the
strict math grammar, and both rules still reduce to core `FunctionCall` nodes.

Superseded for value-route shape: glued function and bare identifier routes now
use `dispatch(...)` over one `IdentOrFunction` opener. Do not restore separate
declaration-prefixed call/identifier rules unless a rule accepts a genuinely
different declaration-only language.

Evidence for the function-call key cleanup: no `CssAstCall` or
`CssAstCalcCall` references remain in CSS parser source or tests; targeted
ESLint on `packages/syntax/css/css-parser/src/ast/grammar.ts` passed; focused
CSS AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS direct-AST query/supports helper-key follow-up: the direct CSS AST
grammar now exposes its conditional query and supports helper family without
the `CssAst*` owner prefix: `QueryValue`, `QueryBareFeature`,
`QueryColonFeature`, `QueryComparisonFeature`, `QueryRangeFeature`,
`QueryFeature`, `QueryNonOnlyKeyword`, `QueryTerm`, `QueryOnlyClause`,
`QueryClause`, `QueryPrelude`, `QueryFunction`, `GeneralEnclosed*`,
`SupportsInParens`, `SupportsCondition`, and `SupportsPrelude`. Recognition and
reducers are unchanged. The shared imported `CssSyntaxQuery*` terminals stay
prefixed because they are parser-shared recognition artifacts rather than
public owner rules.

Rejected in this pass: renaming `CssAstConditionalBlock`,
`CssAstNestedConditionalBlock`, or the broader at-rule block owners. Dispatch is
now the right follow-up for known-or-generic at-rule routing; use
case-insensitive `when(...)` / `makeWhen(...)` and `routed()` rather than
repeating at-keyword recognition or preserving the old negative known-keyword
guard.

Pressure-test verdict for `dispatch(..., when(...), otherwise(...))` against the
live grammar:

- Best first replacement: CSS `AtRuleBlock`, `AtRuleBlockTop`, and
  `UnknownAtRuleBlock`. The current grammar has a positive known-at-keyword
  inventory in the typed arms and the same inventory repeated negatively in
  `knownBlockAtKeyword` / `unknownBlockAtKeyword`. A frame-aware dispatch would
  consume one at-keyword token, route known cases, and keep the generic
  unknown-block tail in `otherwise(...)`.
- Good later replacement: CSS `ImportStatement` versus generic
  `AtRuleStatement`. `@import` is a known-token commitment; `@importx` is
  generic.
- Good later dialect replacements: Less/SCSS/Jess at-rule routers, but only
  when each dialect keeps interpolation and malformed-recovery tails explicit.
- Not a dispatch target: `SelectorList`; it is already exemplary Parseman as
  `oneOrMoreSep(g.ComplexSelector, literal(','))`.
- Not a dispatch target: `ComplexSelector`; the open question is descendant
  combinator/trivia semantics, not token-value routing.
- Dispatch target: glued function calls, provided the matched value is the
  whole function-token opener. Cases are `when('url(', ...)`,
  `when('calc(', ...)`, `when('var(', ...)`, etc., with case-insensitive exact
  comparison where the language requires it. AST construction may derive the
  public function name by trimming the trailing `(`; the grammar key should not
  be weakened to match that AST field.
- Not a dispatch target: reserved identifier exclusions. Those want a future
  `identExcept(...)`-style primitive, not a known/generic router.

Evidence for the query/supports helper-key cleanup: no `CssAstQuery`,
`CssAstSupports`, or `CssAstGeneralEnclosed` references remain in CSS parser
source or tests; targeted ESLint on `src/ast/grammar.ts` passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS direct-AST fixed at-rule body item-key follow-up: the direct CSS AST
grammar now uses the public CSS body-item vocabulary for fixed at-rule body
children where the accepted language already matches the CST concept:
`CssAstMarginBox` became `MarginAtRule`, `CssAstFontFeatureValueBlock` became
`FeatureValueBlock`, `CssAstKeyframeBlock` became `KeyframeBlock`, and
`CssAstKeyframeSelector` became `keyframeSelector`. The keyframe selector rule
continues to use the reusable `Percentage` component for percentage selectors;
there is no keyframe-specific percentage recognizer.

Rejected in this pass: renaming `CssAstKeyframes`, `CssAstPageBlock`,
`CssAstFontFeatureValuesBlock`, `CssAstLayerBlock`, or the conditional/starting
style/scope/document at-rule owners. Those are complete at-rule wrappers or
frame-sensitive owners whose public CST peer is still the broader `AtRuleBlock`
shape. They belong to the later at-rule-router fold, not this fixed-body item
cleanup. **Superseded 2026-07-26:** those wrapper keys have now moved where the
top-level/nested distinction can stay visible in the concept name itself. The
known/generic at-rule router fold remains separate.

Evidence for the fixed at-rule body item-key cleanup: no
`CssAstKeyframeSelector`, `CssAstKeyframeBlock`, `CssAstMarginBox`, or
`CssAstFontFeatureValueBlock` references remain in CSS parser source or tests;
targeted ESLint on `src/ast/grammar.ts` passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS direct-AST at-rule prelude / opaque helper-key follow-up: the direct
CSS AST grammar now uses concept keys for grammar-owned at-rule prelude and
opaque block helpers: `CssAstAtPrelude` became `AtPrelude`,
`CssAstStatementPrelude` became `StatementPrelude`, `CssAstOpaqueAtPrelude`
became `OpaqueAtPrelude`, `CssAstOpaqueBody` became `OpaqueBody`, and
`CssAstOpaqueAtRuleBlock` became `OpaqueAtRuleBlock`. This matches the core AST
fact emitted by the reducer and removes another AST-owner prefix from CSS
at-rule vocabulary without changing known/generic routing.

Rejected in this pass: renaming `CssAstImportUrl`, `CssAstImportUrlUnquoted`,
or `CssAstImportTail*`. Superseded 2026-07-26 for rule keys only: those helpers
now use import-specific concept names, while remaining import-local authored-tail
coverage facts. `macro-compiled.test.ts` deliberately proves the import URL
rules by exact coverage IDs. Also rejected: renaming full at-rule wrappers
(`CssAstConditionalBlock`, `CssAstKeyframes`, `CssAstPageBlock`, etc.) or using
`dispatch(...)` for known/generic at-rules in this batch; that still waits on a
normalized routed at-keyword value. **Superseded 2026-07-26 for rule keys
only:** the wrapper keys now use concept names, while the router/commitment
rewrite remains deferred.

Evidence for the at-rule prelude / opaque helper-key cleanup: no
`CssAstAtPrelude`, `CssAstStatementPrelude`, `CssAstOpaqueAtPrelude`,
`CssAstOpaqueBody`, or `CssAstOpaqueAtRuleBlock` references remain in CSS parser
source or tests; targeted ESLint on `src/ast/grammar.ts` passed; focused CSS
AST/public/macro/CST/conditional tests passed (5 files / 225 tests);
dependency-ordered parser-shared and css-parser builds plus the full CSS parser
suite passed (8 files / 254 tests); `pnpm run check:macro` passed with
parser-shared plus all four parser packages fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm run
oracle:less:byte-identity` passed byte-identical to the current 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS direct-AST at-rule wrapper-key follow-up: complete direct-AST
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
normalized routed at-keyword value that preserves authored token bytes before
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

Latest CSS direct-AST import helper-key follow-up: import-local direct-AST URL
and tail helpers now use import-specific concept names: `ImportUrl`,
`ImportUrlUnquoted`, `ImportTailRaw`, `ImportTailBody`, and `ImportTail`. This
is a rule-key/readability cleanup only. It does not merge `@import` target
parsing with generic declaration `Url`, and it does not change the import tail's
ownership of authored bytes after the import target.

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

Latest CSS direct-AST generic value-spine follow-up: the generic CSS value
wrappers now use concept keys `Value`, `ValueSequence`, and `ValueList` for the
normal component-value stream; the stricter typed-only fallback family is
`TypedValue`, `TypedValueSequence`, and `TypedValueList`. This is a rule-key and
readability cleanup only: the atom choices, authored adjacency handling,
`oneOrMoreSep(...)` comma-list shape, and reducers are unchanged.

Rejected in this pass: folding declaration values, calc internals, or `var()`
fallbacks into the generic value-spine rename. Superseded 2026-07-26 for calc
arithmetic internals only: strict calc arithmetic now uses `CalcValue`,
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

Latest CSS direct-AST calc arithmetic follow-up: strict `calc(...)` arithmetic
internals now use calc-scoped concept keys: `CalcParen`, `CalcValue`,
`CalcProduct`, and `CalcSum`. This is a rule-key/readability cleanup only:
operator parsing, precedence folding, parenthesized block reduction, and
`CalcCall` reduction are unchanged.

Rejected in this pass: folding `VarFallback*`, `VarCall`, or
declaration-value rules into ordinary calc arithmetic. `var()` fallback bodies
are component-value sequences, not ordinary calc arithmetic, and declaration
values remain the permissive declaration component-value language. Those need
separate accepted-language reviews.

Latest CSS direct-AST var() fallback follow-up: grammar-owned `var()` fallback
rules now use CSS concept names `VarFallbackPunctuation`, `VarFallbackParen`,
`VarFallbackBracket`, `VarFallbackBrace`, `VarFallbackCall`,
`VarFallbackTerm`, `VarFallbackEmpty`, `VarFallbackItem`, `VarFallback`, and
`VarCall`. This removes the stale `CssAst` prefix and the misleading `Calc`
prefix because the same fallback grammar is reused by strict calc `var()` and
declaration `var()` paths. Recognition, empty fallback handling, comma
preservation, and reducers are unchanged.

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

CSS declaration values should be written as a value grammar with a narrow
declaration parent context, not as a second declaration-prefixed value language.
Identifier-shaped values use one glued opener route: exact `url(`, `calc(`, and
`var(` cases, then generic function, then bare identifier. Branch nodes own
their CST/AST node names and consume `routed()` so the opener is parsed once.
Context-prefixed names such as `DeclarationCall`, `DeclarationVarCall`,
`DeclarationIdent`, and `DeclarationValueAtom` are review findings unless a rule
accepts a genuinely declaration-only language.

Evidence for the CSS value-route cleanup: no old `CssAstDeclaration*` rule
references remain in CSS parser source or tests; targeted ESLint on
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

Latest shared CSS recognition naming follow-up: `parser-shared` now exposes the
shared CSS lexical artifact as `cssSyntax` and the shared pseudo-argument
artifact as `cssPseudoSyntax`, with shared rule keys moved from
`CssAstSyntax*` to `CssSyntax*`. CSS opaque capture leaves likewise moved from
`CssAstOpaqueCapture*` to `CssOpaqueCapture*`, and the accidental
`ScssAstSyntax*` compile-mode names became `ScssSyntax*`.

Superseded pre-fold note: `cssAstGrammar` compatibility naming was retained
until the CSS host-mode fold. CSS now ships from
`packages/syntax/css/css-parser/src/grammar.ts`; do not use this note as current
export or file-layout guidance. The old deferral of `lessAstSyntax` /
`LessAstSyntax*` was resolved later in the Less folded-grammar cleanup; the
current names are `lessSyntax` / `LessSyntax*`.

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

Superseded pre-fold CSS AST note: the referenced `src/ast/grammar.ts` file has
been deleted; keep this only as historical evidence for cleanup that was later
folded into the surviving `src/grammar.ts`.

Latest CSS direct-AST factory-name follow-up: the internal final local
`rules(...)` factory in `src/ast/grammar.ts` is now `cssFactory`, matching the
public CST grammar module's macro-visible factory name. The exported direct AST
artifact remains `cssAstGrammar` until the one-file hostMode CSS grammar can
retire the separate AST module.

Rejected in this pass: renaming `cssAstGrammar` or public test imports. That
would churn the transitional public parse path without reducing the eight-file
grammar count. The real deletion point is the hostMode collapse that compiles
one CSS source for both AST and CST.

Evidence for this follow-up: `rg` found no remaining old direct-AST
factory/self-type names in CSS parser source/tests or the active grammar docs;
targeted ESLint over the touched CSS parser source/test files passed; `git diff
--check` passed; dependency-ordered parser-shared and CSS parser builds passed;
focused CSS parser tests passed (5 files / 225 tests); the full CSS parser
suite passed (8 files / 254 tests); `check:macro` passed with 0 interpreter
fallbacks across parser-shared and all four parser packages;
`verify:compose-integrity` passed; and the Less byte-identity oracle remained
output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0). A discarded parallel full-CSS-suite run failed
only because a concurrent macro check cleaned `lib/` while tests imported built
artifacts; the sequential rebuild plus full-suite rerun is the valid evidence.

Latest CSS test-helper naming follow-up: `test/macro-compiled.test.ts` now uses
local `CssGrammarModule` / `isCssGrammarModule` helper names around the
transitional `cssAstGrammar` export. The export spelling remains unchanged for
the same reason as above, but no test-local helper now advertises a private
CSS-AST naming scheme. Evidence: no `CssAst*` identifiers remain in CSS parser
source/tests except the deliberate `cssAstGrammar` export/import spelling;
targeted ESLint for `test/macro-compiled.test.ts` passed; and the focused macro
compiled CSS parser test passed (1 file / 10 tests).

Latest CSS pseudo-function opener follow-up: public CST and direct AST pseudo
selector rules now model functional pseudos as a glued CSS function-token opener
(`name(` under `noTrivia`) rather than `ident` followed by an ambient-trivia
`literal('(')`. This keeps `:not( .a )`, `:nth-child( 2n + 1 )`, and
`:lang( en )` valid while rejecting `:not (.a)`, `:nth-child (2n + 1)`, and
`:lang (en)` on both public CST and direct AST paths.

Rejected in this pass: using Parseman `dispatch(...)` for pseudo names.
Pseudo-name routing may become useful later only with a glued function-token
selector and normalized identifier keys. This batch is simpler and more
spec-shaped: it fixes token adjacency without committing to pseudo-name routing.

Evidence for the pseudo-function opener cleanup: targeted ESLint over the
touched CSS grammar and test files passed; dependency-ordered parser-shared and
CSS parser builds passed; focused CSS AST/conditional tests passed (2 files /
187 tests); the full CSS parser suite passed (8 files / 256 tests);
`check:macro` passed with 0 interpreter fallbacks across parser-shared and all
four parser packages; `verify:compose-integrity` passed; and the Less
byte-identity oracle remained output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS/shared `url(` opener follow-up: the public CSS CST grammar and the
shared direct-AST recognition artifact now spell `url(` as
`literal('url(', { caseInsensitive: true })` instead of `regex(/url\(/i)`. This
is deliberately NOT the previously rejected split into `word('url')` plus
`literal('(')`: the public CST opener remains one leaf, so `URL(icon.svg)` still
records an authored `URL(` leaf under `Url`, and `url/* comment */(icon.svg)`
still declines both `Url` and generic `Call` in the public CST grammar.

Rejected in this pass: converting public CST `url(` to a structural
function-token opener. That remains a hostMode/shared-build problem, because the
current direct AST route can use structural pieces while public CST consumers
still observe the single opener leaf.

Evidence for the `url(` literal cleanup: targeted ESLint over
`packages/parser-shared/src/recognition.ts`,
`packages/syntax/css/css-parser/src/grammar.ts`, and
`packages/syntax/css/css-parser/test/cst-public.test.ts` passed; a
dependency-ordered parser-shared/CSS parser build passed; focused public CST
coverage passed (1 file / 13 tests); the full CSS parser suite passed (8 files
/ 257 tests); `check:macro` passed with 0 interpreter fallbacks across
parser-shared and all four parser packages; `verify:compose-integrity` passed;
`git diff --check` passed; and the Less byte-identity oracle remained
output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest Parseman dispatch pressure-test: `dispatch(combinator, when(...),
otherwise(...))` is approved as the ergonomic direction for known-token routing,
but only where the routing combinator consumes the full decisive token and the
generic fallback lives inside the same dispatch. The first CSS candidate is the block
at-rule router: today `AtRuleBlock` / `AtRuleBlockTop` enumerate known at-rule
arms, while `UnknownAtRuleBlock` repeats those names via `not(knownBlockAtKeyword)`.
A future router should dispatch on an at-keyword token and commit known-tail
failures so malformed `@media`, `@scope`, `@page`, etc. cannot become opaque
unknown at-rules.

Function-token routing is the clearest non-at-rule example: write cases against
the full glued opener (`when('url(')`, not `when('url')`). This keeps recognition
spec-shaped and lets the AST reducer derive the semantic name by dropping the
opener punctuation. Pseudos are also viable when the routing combinator consumes
the colon-qualified pseudo name/opener and matched pseudos have distinct
argument languages.

Rejected in this pressure-test: using `dispatch` as a prettier spelling for
reserved-word identifier guards, or using a known-only dispatch beside the old
unknown fallback. The former wants `identExcept(...)`-style structure; the
latter makes commitment semantics non-local and easier to misuse.

Parseman 0.41.0 is resolved: use case-insensitive `when(...)`, matcher cases,
`makeWhen(...)`, `routed()`, and declarative node projection in the actual
grammar cleanup. Documentation may use domain-flavoured examples, but production
grammar helpers should be consolidated by matching policy.

Latest shared/direct pseudo-colon adjacency follow-up: shared
`CssSyntaxPseudoColon` and the SCSS direct-AST local copy now reject whitespace
after `:` / `::`, matching the public CSS CST and direct CSS AST grammar-local
recognizers. Less direct-AST static pseudos now use the same guard in their
selector pseudo arms, and Jess direct AST picks up the shared guard. This keeps
comments-as-trivia valid where CSS tokenization permits them, but prevents
ambient trivia from turning `.card : hover` or `.card: hover` into a static
pseudo selector on direct AST paths.

Rejected in this pass: changing the Less public CST `pseudoColon` leaf. That
looked like the same local fix, but the Less byte-identity oracle caught it as
a CST-surface move (`b990e139…` to `f23f61e…`, 437 entries moved) even though
the AST surface stayed identical. The change was backed out. Public dialect CST
alignment for Less/SCSS/Jess belongs to the dialect rebuild sequence where CST
shape movement can be reviewed intentionally.

Latest CSS comment-trivia cleanup: `AtRulePreludeSegments` and `ImportTailBody`
now use parser-local block-comment trivia plus per-node trivia insertion indexes
to keep comments out of semantic `Any.src` bytes without gluing adjacent tokens.
`@import` is not special here: import tails follow the same semantic rule as
generic statement/block preludes, while source spans plus the trivia index keep
authored comments available for serialization.

Do not grow this temporary segmenter into a second prelude language. The target
shape is a shared CSS component/value grammar with a caller policy: ordinary CSS
positions reject unknown tokens; custom-property values and unknown-at-rule
preludes/bodies may admit unknown tokens while still parsing known
value/list/group/declaration/ruleset structure. A future Parseman `captureTo`
helper should make bounded permissive capture smaller, but it must preserve that
shared-grammar/context model instead of flattening custom properties or unknown
at-rules to one raw string.

Evidence for the CSS comment-trivia cleanup: focused CSS AST passed
(1 file / 82 tests); focused at-rule prelude CST plus public CST passed
(2 files / 22 tests); the full CSS parser suite passed (8 files / 269 tests);
and dependency-ordered `@jesscss/css-parser` build passed after rebuilding
`@jesscss/parser-shared`. The build still reports pre-existing Parseman gating
warnings for balanced/custom/import-tail scans, `Stylesheet`/`ConditionalBlock`
at-rule choices, `ImportUrl`, `TypedValueSequence`, `Declaration`,
`ValueSequence`, `QueryClause`, `ContainerPrelude`, and `Url`.

Evidence for the pseudo-colon adjacency follow-up: targeted ESLint over
parser-shared and the touched Less/SCSS/Jess direct-AST grammar/test files
passed; dependency-ordered parser-shared, Less, SCSS, Jess, and CSS parser
builds passed; focused AST suites passed for Less (181 tests), SCSS (94), and
Jess (103); focused CSS AST/conditional tests and Less/SCSS/Jess conditional
ambiguity tests passed; `check:macro` passed with 0 interpreter fallbacks across
parser-shared and all four parser packages; `verify:compose-integrity` passed;
`git diff --check` passed; and the Less byte-identity oracle remained
output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS direct-AST `makeWord` opener follow-up: the private CSS AST grammar
now matches the public CST grammar's 0.38-safe helper shape for the small
keyword/function-opener family it owns. `src/ast/grammar.ts` imports
`makeWord`, defines a factory-local CSS identifier-boundary word helper inside
`cssFactory`, and uses it for `@import`, `url(`, `calc(`, and `var(`. This keeps
the openers glued with `noTrivia(...)` while removing repeated module-level
`word(..., boundary, { caseInsensitive: true })` leaves. The helper is
factory-local because previous probes showed module-scope `makeWord(...)`
aliases still leave a runtime factory call after macro import stripping.

Rejected in this pass: moving the remaining at-keyword families to
`makeWord(...)` aliases. Those are the same block-at-rule routing surface
identified in the dispatch pressure-test above; improving them piecemeal would
preserve the old known-vs-generic `choice()` shape instead of replacing it with
committed token dispatch.

Evidence for the direct-AST `makeWord` opener follow-up: targeted ESLint over
`packages/syntax/css/css-parser/src/ast/grammar.ts` passed; dependency-ordered
parser-shared and CSS parser builds passed; focused CSS AST/conditional tests
passed (2 files / 187 tests). Superseding 2026-07-26 serial evidence: the full
CSS parser suite passes (8 files / 260 tests), the focused Less
AST/CST/macro set passes (3 files / 233 tests), and the Less byte-identity
oracle remains output-neutral over the 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`;
AST threw 120, CST threw 0). `check:macro` currently reports parser-shared,
CSS, and Less fully compiled with 0 interpreter fallbacks. This snapshot
predates the SCSS and Jess folds; both now have one host-mode grammar source and
their package build/test gates pass. Rerun the whole-repo macro/compose gates
before quoting current fallback counts.

Latest CSS single-source fold status, 2026-07-26: CSS is down to one grammar
source. `packages/syntax/css/css-parser/src/ast/grammar.ts` was deleted, CSS
tests now import `cssAstGrammar` from `src/grammar.ts`, and `src/index.ts` /
`src/cst-css.ts` both route through the same `cssFactory` compiled in AST or
CST host mode. The single grammar also pins two strict CSS placement rules:
`@import` is accepted only in the stylesheet import phase, with empty `@layer`
statements allowed there, and top-level `&` is rejected while nested `&`
remains valid in nested rule contexts.

Latest Less fold status, 2026-07-27: Less is now one host-mode grammar source.
`packages/syntax/less/less-parser/src/ast/grammar.ts` is deleted, the old CST
bridge body has been removed from `packages/syntax/less/less-parser/src/grammar.ts`,
and both `lessAstGrammar` and `lessCstGrammar` point at the same direct grammar
compiled with the appropriate host mode. The public CST oracle movement from the
old bridge tree to the host-mode tree is intentionally baselined; AST stayed
byte-identical. Do not resurrect the old bridge to satisfy the previous CST
aggregate. The remaining Less work is quality cleanup on the surviving grammar:
remove `DirectLess*` migration names, shrink broad choices, and route
known/generic openers with current Parseman.

Latest SCSS fold status, 2026-07-27: SCSS is now one host-mode grammar source.
`packages/syntax/scss/scss-parser/src/ast/grammar.ts` is deleted,
`packages/syntax/scss/scss-parser/src/grammar.ts` exports the shared factory,
`scssGrammar` / `scssAstGrammar`, and `scssCstGrammar`, and public CST uses the
host-mode artifact. The old CST route that composed through Less has been
removed, so SCSS no longer inherits Less-only grammar hooks or CST-only
acceptance paths. The full SCSS parser suite passes:
`pnpm --filter @jesscss/scss-parser test` (8 files / 291 tests), and
`pnpm --filter @jesscss/scss-parser build` passes. Remaining SCSS work is
quality cleanup on the surviving grammar: keep refining the value spine to
shared/spec concepts and replace broad shared-opener choices with current
Parseman `dispatch(...)` / `makeWhen(...)` / `routed()`.

Latest Jess fold status, 2026-07-27: Jess is now one host-mode grammar source.
`packages/syntax/jess/jess-parser/src/ast/grammar.ts` is deleted,
`packages/syntax/jess/jess-parser/src/grammar.ts` exports `jessFactory`,
`jessGrammar` / `jessAstGrammar`, and `jessCstGrammar`, and public CST uses the
host-mode artifact. The full Jess parser suite passes:
`pnpm --filter @jesscss/jess-parser test` (6 files / 249 tests), and
`pnpm --filter @jesscss/jess-parser build` passes. The old CST-only acceptance
of invalid slash-function forms has been removed. Later naming cleanup passes
have moved the selector, control, declaration, import, at-rule, and
general-enclosed template families toward semantic CST/AST-aligned labels; the
uppercase `DirectJess*` grammar-key pass and lowercase `directJess*`
parser-local helper pass are drained in `src/grammar.ts`. Remaining Jess work is
grammar-shape, trivia, dispatch/choice, and cross-dialect naming quality cleanup
on the surviving grammar, not a second grammar contract. Continue to classify
each touched `choice(...)`, use current Parseman `dispatch(...)` only for routed
token families with a deciding opener and same-family generic fallback, keep
construct/context choices as `choice(...)` or left-factor helpers, and replace
broad keyword regexes with the shared word helper policy.

Quality bar for the surviving Less grammar: simplify aggressively after the
fold, using the folded CSS grammar as the model. Every significant rule should
have CSS-style structured JSDoc that states the syntax it owns and the
spec/dialect reason for any deviation. Remove `DirectLess*` / compile-mode names
from surviving public rules unless a const-level review proves a real accepted
language divergence. Known-or-generic routes, identifier/function splits,
pseudos, variable/at-rule ambiguity, and Less extension points should use
`dispatch(...)` / `makeWhen(...)` / `routed()` wherever that lets the grammar
consume the opener once. Do not keep a broad lookahead or duplicated selector /
value parse merely because the old direct AST grammar did it.

Also gut Less grammar shapes that exist only because SCSS wrongly composes on
Less. In `packages/syntax/less/less-parser/src/grammar.ts` today, comments and
seams such as `stylesheetItem`, `blockItem`, SCSS custom-property override
support, and exported selector subpieces explicitly mention SCSS injection. They
are compatibility scaffolding for the sibling-inheritance inversion, not Less
syntax. During the Less fold, preserve only surfaces required by real Less,
public CST/language-service contracts, or the temporary buildable entry while
SCSS is being re-pointed. The target architecture is SCSS as a CSS/preprocessor
base sibling, not a child of Less; do not simplify Less by baking in Sass
acceptance.

Fresh 2026-07-27 integration evidence: the full CSS parser suite passes
(8 files / 261 tests), `pnpm --filter @jesscss/css-parser build` passes, the
focused SCSS build/public/AST/compose set passes, and the Less byte-identity
oracle remains byte-identical over the 709-entry baseline
(`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929`,
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`;
AST threw 120, CST threw 0). `pnpm run check:macro` reports parser-shared, CSS,
Less, SCSS, and Jess fully compiled with 0 interpreter fallbacks, and
`pnpm run verify:compose-integrity` passes.

Latest type-only naming cleanup: the folded Less, SCSS, and Jess grammar files
no longer use mode-flavoured local type names such as `LessAstLocalRules`,
`LessAstInputRules`, `ScssAstRules`, or `JessAstRules`. They are now
`LessRules`, `LessInputRules`, `ScssRules`, and `JessRules`. This did not rename
public grammar keys or reducers; it only removes stale AST wording from the
surviving host-mode type surfaces. Verification after the rename:
`pnpm --filter @jesscss/less-parser build`, `pnpm --filter
@jesscss/scss-parser build`, `pnpm --filter @jesscss/jess-parser build`,
`pnpm run check:macro`, and `pnpm run verify:compose-integrity` all pass.

Latest Less private-helper naming cleanup: the folded Less grammar no longer
uses `direct*` on private module-scope terminals and helpers for the
identifier/function opener, math operators, generic at-rule names, mixin names,
function-condition operators, static pseudo chunks, or the shared
case-insensitive `makeWhen(...)` helper. Public grammar keys such as
`Value` were deliberately left for a separate CST/consumer-aware
migration. Verification for this behavior-neutral slice:
`pnpm --filter @jesscss/less-parser build`, `pnpm run check:macro`, and
`git diff --check` pass.

Latest Less guard update: the focused Less set is now 233 tests after adding an
AST/CST host-mode parity guard for inline `:extend(...)` branch ownership. The
Less byte-identity oracle still passes byte-identical over the 709-entry corpus.
The Less A/B harness now snapshots parser-shared, CSS parser, and Less parser
grammar sources as one unit, restores deleted `src/ast/grammar.ts` paths
correctly for HEAD-side baselines, and restores the working source slice on
`SIGINT` / `SIGTERM`. A smoke run over
`BENCH_CASES=css-corpus-ok,css-corpus-err,css-corpus-ok-joined` completed, but
that run is only harness validation; it is not a CSS/Less performance verdict.

Rejected compatibility probe: changing CSS' `cssCstGrammar` from `composeLeaf`
to generic `compose`, adding a separate `cssComposableCstGrammar`
`compose([... rules({ hostMode: 'cst' }, cssFactory)])` export, and adding an
AST-side `cssComposableGrammar = compose([... rules(cssFactory)])` export all
made the CSS build fail in the Parseman macro with `IR direct node builder for
CustomPropertyValue must be macro-static and self-contained` (`keyword` /
`tokenText` are the unsupported captured helpers). After the 0.40.0 bump, the
smallest Jess-side probe
`compose([cssCstGrammar, rules({ trivia: rw }, jessFactory)], { hostMode:
'cst' })` still failed with the same non-build-resolvable CSS argument at
`jess-parser/src/grammar.ts:58`, because `cssCstGrammar` is also a terminal
`composeLeaf` artifact. Do not repeat those shims. The repair is not a
Jess-local workaround or a duplicate CSS grammar: either Parseman needs a
composable host-mode artifact that does not evaluate direct AST reducers for CST
composition, or the CSS/Jess boundary needs a deliberately designed
single-source base that stays macro-buildable.

Latest Less fold-residue repair, 2026-07-26: Less byte identity is green again
after two CST compatibility fixes. First, selector singleton wrappers in the
Less CST bridge must use explicit typed node options:
`node('CompoundSelector', ..., { unwrap: true })`,
`node('ComplexSelector', ..., { unwrap: true })`, and
`node('SelectorList', ..., { unwrap: true })`. The inferred type forms dropped
the `unwrap` option in macro output, so they are not safe evidence for
host-mode parity. Second, `packages/syntax/css/css-parser/src/cst.ts` now trusts
Parseman's trivia-aware `run(...).unconsumedFrom` instead of recomputing
leftover input from `span.end`; the recomputation falsely marked trailing Less
line trivia and CSS block trivia as unconsumed. Focused CSS and Less public CST
tests passed, dependency-ordered parser-shared/CSS/Less builds passed, and
`node packages/syntax/less/less-parser/test/oracle-byte-identity.mjs
packages/syntax/less/less-parser/test/oracle-byte-identity.baseline.json`
passed byte-identical over the 709-entry corpus
(`ast=445615f78d37b359ee33797af7022283afabbad6e1e09ae01a01d93b4e098f53`,
`cst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`).
This historical run cleared the pre-switch CST drift. It is superseded by the
direct host-mode switch below.

Fresh Less host-mode switch evidence: after rebuilding `@jesscss/less-parser`,
public CST now intentionally exposes the direct host-mode tree. The oracle
baseline moved only on the CST surface; AST remained
`445615f78d37b359ee33797af7022283afabbad6e1e09ae01a01d93b4e098f53`, while CST
is now
`cc6b51dcad89f1a028572f0605864548c9de0a3d51cf524f2b89918012acb3cd`. The focused
public CST tests pin the important source-fidelity differences, including import
media static-tail chunks and declaration post-colon layout leaves. The next
batch should simplify those surviving rules directly; do not add a post-hoc CST
normalizer or a second recognition route.

Strict CSS calc baseline follow-up, 2026-07-27: the CSS value-route cleanup
intentionally rejects malformed `calc()` and `calc(+)` at recognition instead of
allowing a generic-function fallback. The focused CSS tests pin that behavior
(`ast-grammar.test.ts` and `macro-compiled.test.ts`). Only the two invalid CSS
calc fixtures moved in the Less oracle, so the committed 709-entry baseline is
now
`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929` and
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`.

Latest CSS value-route cleanup, 2026-07-27: the folded CSS grammar now routes
identifier-shaped values from one opener. The local rule is `Value`; it is the
single value piece. The surrounding grouping rules stay plain as `ValueSequence`
and `ValueList` rather than carrying a `ComponentValue*` prefix or implying
another list-level `Value` concept.
`IdentOrFunction` uses
`dispatch(identOrFunction, cssCase('url(', ...), cssCase('calc(', ...),
cssCase('var(', ...), when(endsWith('('), ...), otherwise(...))`. Branch nodes
use `routed()` so `url(`, `calc(`, `var(`, generic functions, and bare
identifiers do not reparse the opener. Context-prefixed declaration-value names
are gone from CSS parser source/tests; declarations now consume `ValueList`
directly over reusable value syntax. The stricter typed-only value family that
still feeds
query/function positions is named `TypedValue`, `TypedValueSequence`, and
`TypedValueList`; it should be deleted or narrowed further only with a
spec-backed acceptance review.

The grammar review standard now states the naming rule explicitly: use the
language/spec term first, default to short undecorated names, and do not prefix
a child with its caller (`DeclarationValue`, `RulesetCompoundSelector`, etc.)
unless that child accepts a genuinely different language.

Evidence: focused CSS public/AST tests passed; the full CSS parser suite passed
(8 files / 261 tests); `pnpm --filter @jesscss/css-parser build` passed;
`git diff --check` passed; and the Less byte-identity oracle stayed
byte-identical over 709 entries
(`ast=309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929`,
`cst=7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4`;
AST threw 120, CST threw 0). `pnpm run check:macro` reports parser-shared and
all four parser packages fully compiled with 0 interpreter fallbacks. `pnpm run
verify:compose-integrity` also passes.

SCSS Less-inheritance cut, 2026-07-27: `packages/syntax/scss/scss-parser`
no longer imports `lessGrammar`, no longer declares `@jesscss/less-parser` as a
package dependency, and the CST grammar no longer includes the obvious Less-only
statement/selector arms (`VarCall`, `ExtendStatement`, `EachFor`, `MixinCall`,
`MixinOrQualifiedRule`, `DetachedRuleset`, `AnonymousMixinDefinition`,
`LessAmpersand`, `interpOrBasic`). The current SCSS grammar is a single
host-mode grammar and is macro-buildable. A follow-up query-clause cleanup
left-factored the inner
`choice(sequence(CssSyntaxQueryAndOr, DirectScssQueryInParens),
DirectScssQueryInParens)` into
`sequence(optional(CssSyntaxQueryAndOr), DirectScssQueryInParens)`. Focused SCSS
conditional/macro/compose/CST tests passed, and the package build passed.

Latest Less dispatch pressure-test, 2026-07-27: do not route generic Less
at-rule block-vs-statement forms by at-keyword alone. A probe that rewrote
`DirectLessAtRuleBlock` as `dispatch(atRuleBlockName, when('@layer', ...),
otherwise(...))` was type-clean but committed too early: `@charset "utf-8";`
and other statement at-rules reached the block tail and failed on expected `{`
instead of falling through to `DirectLessAtRuleStatement`. The right dispatch
shape would have to route on a combinator that includes the real decision point,
such as the at-keyword plus the block/statement delimiter, or keep the current
ordered grammar until that clearer shape exists. Evidence after reverting the
probe: `pnpm --filter @jesscss/less-parser test -- ast-grammar.test.ts
public-parse.test.ts cst-public.test.ts macro-compiled.test.ts
conditional-at-rule-value.test.ts --run --reporter=dot` passed 421 tests, the
Less parser build passed, and scoped `git diff --check` passed.

Latest Less dispatch/choice cleanup evidence, 2026-07-27: two current Less
repairs came from applying the dispatch-vs-choice rule rather than mechanically
rewriting choices.

- `@namespace url(...)` must route the glued `url(` form as the URI, not let an
  optional namespace prefix consume `url` as a bare keyword. The fixed
  `DirectLessNamespacePrelude` tries URI-only `Url`/`Quoted` forms before the
  prefixed namespace form. This leaves a gating warning because `url` and
  `url(` still overlap on `u`, but the warning is not itself a license to swap
  in `keywords(...)` or `dispatch(...)` unless the routed combinator preserves
  the current AST/CST ownership.
- Top-level `@media not (...)` now has an explicit negated media-query clause.
  That is a real language branch, not a generic keyword fallback. The focused
  regression pins `@media not (width <= -100px) { ... }` as a structural
  `SpacedValue`.
- The Less `each()` control form now owns a glued function opener with
  `noTrivia(sequence(eachKeyword, literal('(')))`. This is the same grammar
  principle as `IdentifierOrFunction`: `each (` must not be accepted as the
  `each()` control form through ambient trivia. This was intentionally kept as a
  small opener tightening rather than a dispatch rewrite because there is no
  known/generic branch table at that position. A non-ASCII identifier such as
  `eaché(...)` still routes as an ordinary `FunctionCall`; the glue only protects
  the Less control form.
- Case-insensitive keyword leaves that have no generic continuation now use the
  Parseman helper APIs instead of handwritten boundary regexes: keyframe
  endpoints, import options, `@charset`, `@layer`, the function-condition `not`
  guard, and the `each()` keyword opener are `keywords(...)` / `word(...)`
  shapes with preserved boundaries. This is the opposite of a dispatch target:
  the language branch is a closed keyword set, so the helper exposes better
  first-set information without inventing a branch router.
- Rejected in this pass: replacing Less symbol combinator `choice(literal(...))`
  tables with `keywords(...)`. It cleared a Parseman gating warning, but the
  Less oracle moved AST/CST entries. Symbol-only tables should stay as literal
  choices until a value-preserving helper/left-factor shape is designed and
  proved against the oracle.
- Corrected pseudo-dispatch shape: route only the glued functional pseudo opener
  (`:` / `::` + name + `(`) and let the branch node own `routed()` plus the
  argument tail. Exclude `:extend(` from every ordinary pseudo route so inline
  extend collection keeps its context-owned selector-list path. Keep nth-family
  pseudos outside this dispatcher, and keep selector-capture pseudos static-only
  so dynamic interpolation-bearing arguments still reject in static capture
  positions. This preserves the old public CST branch ownership
  (`DirectLessStaticSelectorPseudo`, `DirectLessStaticNonSelectorPseudo`, and
  `DirectLessInterpolatedArgumentPseudo`) while avoiding function-opener
  reparsing in ordinary selector positions.

Evidence after the namespace/media fixes: `pnpm --filter @jesscss/less-parser
test -- ast-grammar.test.ts public-parse.test.ts cst-public.test.ts
macro-compiled.test.ts conditional-at-rule-value.test.ts --run --reporter=dot`
passed 423 tests, and scoped `git diff --check` passed. The current Less oracle
still fails in this dirty integration checkout:
`ast=67fda8aeb0aac117b7b630733aa8fa04463ce4272b7948be808a0b188b286797`,
`cst=c71003dff2dc3af1bdf5c9ed3df74e7c6cd416335ffdbd2815001e2ef35613c6`;
AST throws remain 120, with 10 named AST entries moved, and broad CST movement
still needs classification or a deliberate baseline update. Rerunning the oracle
after the `each()` opener tightening, the keyword-helper cleanup, and the backed
out pseudo-dispatch experiment produced the same aggregates and the same named
moved-entry counts, so the surviving fixes did not expand the current delta.
`pnpm run check:macro` also passed after the cleanup with all parser packages
fully compiled and 0 interpreter fallbacks. Do not update the oracle baseline
until those moved entries are reviewed by name.

Fresh fold gate audit, 2026-07-27: `find packages/syntax -path
'*/src/ast/grammar.ts' -print` returns no grammar files. CSS exports one
default AST grammar (`cssGrammar`), keeps `cssAstGrammar` as an alias, and builds
`cssCstGrammar` from the same factory with `hostMode: 'cst'`.
`pnpm --filter @jesscss/css-parser test -- --run --reporter=dot` passes the full
CSS parser suite with 266 tests. `pnpm run check:macro` passes with
parser-shared, CSS, Less, SCSS, and Jess fully compiled and 0 interpreter
fallbacks. `pnpm run verify:compose-integrity` passes with exit code 0. The Less
oracle remains the known dirty integration delta:
`ast=67fda8aeb0aac117b7b630733aa8fa04463ce4272b7948be808a0b188b286797`,
`cst=c71003dff2dc3af1bdf5c9ed3df74e7c6cd416335ffdbd2815001e2ef35613c6`, AST
throws 120, CST throws 0, with 10 named AST entries moved and 511 CST entries
moved against the checked-in baseline. Treat that oracle result as unresolved
baseline classification, not a new dispatch/test regression, because the named
moved-entry counts match the earlier dirty checkout evidence.

Superseded initial Less oracle moved-entry classification, 2026-07-27: this
10-entry note describes an earlier dirty aggregate. Keep it as chronology only;
the active classification is
[`LESS-ORACLE-MOVER-CLASSIFICATION.md`](./LESS-ORACLE-MOVER-CLASSIFICATION.md).
The earlier
10-entry AST movement is error-shape movement, not success-vs-failure movement:
the AST surface still throws on all ten entries, and the CST surface returns
`ok: false` without throwing. Per-entry hash comparison used the checked-in
baseline and a fresh `/tmp/jess-less-oracle-current.json`; direct inspection used
`parse()` and `parseLessCst()` from the built Less parser plus CSS parser checks
for CSS-corpus entries. Follow-up sidecar classification split the ten entries
into four intentional/invalid-input residues and six entries that need Less
compatibility work or an explicit owner decision before any baseline move.

| entry cluster | current evidence | classification |
| --- | --- | --- |
| `packages/syntax/css/css-parser/test/css/atrule-params.css`, `atrule-unknown.css`, upstream `permissive-parse.css`, upstream `plugin.css` | CSS AST and CST accept them; Less AST rejects at an unknown/document/arbitrary at-rule prelude boundary and Less CST returns `ok: false`. | Not safe to baseline as conformance. Treat as Less valid-CSS compatibility gaps unless an explicit Less-v5 decision says these CSS at-rule shapes are intentionally rejected. |
| upstream `tests-unit/permissive-parse/permissive-parse.less` | Less AST rejects at `@-moz-document @function-name(...)`. The first failing token intersects the v5 bare-`@variable` policy, but the fixture is also the corpus evidence for permissive custom at-rule prelude handling. | Not safe to baseline as completed strictness. Treat as Less compatibility / owner-review work until the valid-CSS/custom at-rule prelude model is deliberately fixed or deliberately narrowed. |
| upstream `tests-error/eval/namespacing-3.less` | Less AST rejects `@alias: .theme;` at the variable-declaration colon; this is an eval-error fixture for illegal aliasing without `()`, not obviously a syntax-error fixture. | Parser/eval-boundary review. Do not baseline as conformance without an owner decision that Less v5 moves this from eval error to parse error. |
| `packages/syntax/css/css-parser/test/css/errors/atrule-no-semicolon.css`, `errors/charset.css`, upstream `tests-error/parse/at-rules-unmatching-block.less` | CSS or upstream corpus marks them invalid; Less now rejects through recognition rather than exposing a useful CST tree. | Invalid-input residue from the folded recognition. Safe to baseline only with an explicit note that CST error-tree shape moved. |
| upstream `tests-error/eval/javascript-undefined-var.less` | Less AST rejects inline backtick JavaScript syntax; design decision A3 removes inline backtick JS in v5. | Superseded by owner correction: removed inline JS should be recognized as unsupported syntax with a migration diagnostic, not treated as random value-position parse failure. Point users toward `@from` / `@-from` or a script-module/plugin route. |

Next Less oracle work should first fix or explicitly decide the six owner-review
entries: the valid-CSS unknown/document/arbitrary at-rule cluster,
`permissive-parse.less`, and the `namespacing-3` eval-boundary case. Only after
those are classified should the oracle baseline move.

CSS dispatch guard coverage, 2026-07-27: the CSS public AST and CST suites now
pin the most important `dispatch(...)` vs `choice(...)` boundary for values and
query preludes. Glued `url(`, `calc(`, `var(`, and generic `name(` forms may
route through the `IdentOrFunction` dispatcher; spaced `url (x)`,
`calc (1px + 2px)`, and `var (--x)` must remain a bare keyword followed by a
parenthesized block. Query functions follow the same glued-opener rule:
`style(` is a query function, `style (` is not; `scroll-state (` may still parse
as an ordinary keyword plus parenthesized feature, but it must not become a
`QueryFunction` or AST `FunctionCall`. The new guards assert that spaced known
value names do not produce AST `Url` or `FunctionCall` nodes and do not produce
public CST `Url`, `Call`, `CalcCall`, or `VarCall` nodes; spaced query names do
not produce public CST `QueryFunction` nodes. Evidence: `pnpm --filter
@jesscss/css-parser test -- public-parse.test.ts cst-public.test.ts --run
--reporter=dot` passed 37 tests; `pnpm --filter @jesscss/css-parser test --
--run --reporter=dot` passed the full CSS parser suite with 266 tests. The Less
oracle still reports the same known dirty integration aggregate
`cst=c71003dff2dc3af1bdf5c9ed3df74e7c6cd416335ffdbd2815001e2ef35613c6`, so this
coverage-only CSS guard did not expand the current Less corpus delta.

Dispatch-vs-choice review gate, 2026-07-27: CSS and Less cleanup must use
Parseman dispatch only for a real shared-opener family. The canonical
positive shape is `IdentifierOrFunction`: consume a bare identifier or glued
`name(` opener once, route exact known function openers, route
`when(endsWith('('), ...)` to the generic function, and put the bare identifier
in `otherwise(...)`. The canonical negative shape is a later delimiter decision:
body item lists, literal punctuation tables, closed keyword sets, and
block-vs-statement tails still belong in `choice(...)` when Parseman can gate
them accurately. CSS at-rules may dispatch on the at-keyword to select a legal
tail family, then keep a local `choice(...)` for `{` versus `;`; Less must not
dispatch on bare `@`, because variable declarations, variable/reference calls,
generic at-rules, and mixin-like forms are not decided until more syntax has
been consumed. A cleanup patch that rewrites a literal-to-literal table or a
later-delimiter branch into dispatch is a finding, not an idiomatic win.

Read-only hotspot audit, 2026-07-27: the next Less cleanup queue should rank
shared-opener work this way:

1. Less `@` statements: `directLessAtStatement` still chooses among import,
   plugin, variable declaration/call, reference call, conditional at-rules,
   keyframes, and generic at-rules as broad siblings. Do not dispatch on bare
   `@`; design a routed opener that includes enough syntax to distinguish
   `@name:`, `@name(`, known at-keywords, and generic at-rule continuations.
   Public owners at risk: `ImportAtRule`, `QueryAtRuleBlock`, `AtRuleBlock`,
   `AtRuleStatement`, `VarDeclaration`, and `VarCall`.
2. Less pseudos: the pseudo family still consumes `:` / `::` plus related
   name/function shapes in multiple guarded arms. The target is a routed pseudo
   opener that can distinguish `:extend(`, An+B pseudos, selector-function
   pseudos, generic functional pseudos, bare pseudos, and interpolated-name
   pseudos while preserving `ExtendPseudo` and structured selector-pseudo CST
   ownership.
3. Less selector branches with inline extends: this is probably not an outer
   `dispatch(...)` target. The target is one context-aware selector branch that
   parses the branch once, collects inline extends, and removes the broad
   `DirectLessSelectorBranch` / `DirectLessDynamicSelectorBranch` fallback
   competition.
4. Less mixin statement family: mixin definitions, mixin calls, and bare mixin
   calls still restart from the same name/path surface. A routed consumed mixin
   opener plus suffix routing is plausible, but it must preserve the boundary
   between `MixinOrQualifiedRule`, `MixinCall`, bare calls, and rulesets.
5. Less query feature parentheses: several `(`-led query arms decide only after
   entering the parentheses. This may become a dispatch/left-factor target, but
   public `QueryAtRuleBlock` CST children and media/container query AST shapes
   are sensitive.

The same audit confirms the intentional `choice(...)` keepers: CSS at-rule
statement-vs-block branch tails, CSS and Less value/function bodies after the
canonical identifier-or-function dispatch, statement/body item lists, and small
literal punctuation/delimiter tables.

Less separator-helper cleanup, 2026-07-27: several folded Less list productions
now use `oneOrMoreSep(...)` instead of spelling `item (',' item)*` by hand:
import options, comma-style mixin call arguments with an optional semicolon
terminator outside the list, keyframe selector lists, inline `:extend(...)`
target lists, and selector lists with collected inline extend facts. This is
not a dispatch rewrite; it is the list-helper half of the same Parseman
idiomaticity rule. The inline-extend selector route still parses selector
branches once and keeps `ExtendPseudo` as the public CST owner. Evidence:
`pnpm --filter @jesscss/less-parser test -- ast-grammar.test.ts
public-parse.test.ts cst-public.test.ts macro-compiled.test.ts
conditional-at-rule-value.test.ts --run --reporter=dot` passed 423 tests.
`pnpm run check:macro` passed with parser-shared, CSS, Less, SCSS, and Jess
fully compiled and 0 interpreter fallbacks. `pnpm run verify:compose-integrity`
passed. `pnpm run oracle:less:byte-identity` still fails at the known dirty
integration aggregates
`ast=67fda8aeb0aac117b7b630733aa8fa04463ce4272b7948be808a0b188b286797`,
`cst=c71003dff2dc3af1bdf5c9ed3df74e7c6cd416335ffdbd2815001e2ef35613c6`, with
the same 10 AST moved entries and 511 CST moved entries, so this cleanup did
not expand the current oracle delta.

Less generic at-rule tail cleanup, 2026-07-27: the Less generic at-rule path now
uses the same dispatch/choice boundary the rewrite should preserve elsewhere.
The statement route dispatches once on the static at-keyword token for known
statement families such as `@namespace` and `@layer`, then the generic
`otherwise(...)` tail consumes `routed()` once and locally chooses between a
typed static prelude and a CSS component-prelude fallback. The block route keeps
block-vs-statement as a tail decision because `{` / `;` is not part of the
at-keyword. Do not turn this into dispatch-on-bare-`@`; that would claim Less
variable declarations, reference calls, mixin-like calls, and generic at-rules
are decided before their real delimiter.

The rejected shape was a separate `DirectLessGenericAtRulePrelude` wrapper that
parsed a prelude and then used a detached terminator `peek(...)`. It degraded
typed preludes such as `url-prefix()` and `foo 42 (bar)` into `Any` because the
terminator check was not owned by the same branch that consumed the typed
prelude. The accepted shape lets the attempted typed branch own the terminator,
then falls back to the CSS component prelude only when that full tail does not
match.

Adjacency lesson from the same slice: a glue-sensitive guard must be part of the
opener. A trailing `not(literal('('))` after `routed()` runs under ambient trivia
and rejects both `@name(` and `@name (`. In the current Less document grammar,
the higher-priority Less reference-call route owns `@rules();`, while the
generic CSS-ish at-rule tail can accept parenthesized preludes such as
`@unknown (--flag: value);`. Keep that distinction until a routed opener can
encode the adjacency directly.

CSS/Less dispatch-vs-choice checkpoint, 2026-07-27: current sidecar audits agree
on the review rule. Dispatch is mandatory pressure for a real known/generic
shared opener, especially identifier-or-function values, glued functions,
pseudos, and at-keyword routers whose generic fallback belongs to the same
token family. It is not a prettier spelling for every `choice(...)`. The concise
decision table now lives in
`docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`; use it with the
per-`const` review standard instead of re-deriving the boundary per grammar
slice.

Parseman performance evidence behind that rule: a dispatch/codegen sidecar ran
`pnpm bench:dispatch` in `/Users/matthew/git/oss/parser-thing`. Broad-opener
routes showed strong wins: all-keyword identifier/function `2.25x`, 10%
functions `2.10x`, 50% functions `1.59x`, 90% functions `1.24x`, multi-branch
broad opener `3.12x`, and at-rule shared opener `2.68x`. The `matches()` arm
was only `1.07x`, and disjoint literal/first-set choices remain cheap because
Parseman's choice compiler already lowers them well. Therefore the Jess grammar
guidance is performance-backed but narrow: prefer dispatch for repeated broad
opener recognition with a generic fallback; keep well-gated `choice(...)` for
literal tables, disjoint alternatives, and cheap later-tail splits.

Parseman follow-up pressure: exact case-sensitive `when(...)` arms currently
lower as an ordered `if` / `else if` chain, while case-insensitive and matcher
arms have their own predicate costs. A small future Parseman optimization
should investigate exact-key switch/table lowering before matchers/otherwise,
leaving case-insensitive and matcher arms ordered until separately benchmarked.
Current tail-only pair elision and routed-local lowering are the right small
optimization direction; broader routed bridge removal needs a value-flow proof.

CSS status:

- Already exemplary: `PseudoSelector`, `IdentOrFunction`,
  `TypedIdentOrFunction`, `CalcIdentOrFunction`, `StylesheetAtRule`,
  `DeclarationListAtRule`, and `ConditionalGroupAtRule` use the current Parseman
  route shape correctly.
- `CalcValue` no longer chooses separately among `Url`, `CalcCall`, `VarCall`,
  generic `Call`, and `Keyword`. It delegates the identifier/function family to
  `CalcIdentOrFunction`, which consumes the glued opener once, routes `url(`,
  `calc(`, `var(`, generic `name(`, and bare identifiers, and leaves the selected
  public CST owners as `Url`, `CalcCall`, `VarCall`, `Call`, or `Keyword`.
- Main remaining candidate: query feature parsing. The current
  `QueryFeature` arms share `(` plus property/value-ish content, but a safe
  rewrite needs a helper that preserves public CST ownership. Do not route on
  bare `(`.
- Keep as `choice(...)`: declaration/body item lists, page/keyframes/font body
  item choices, literal punctuation tables, closed keyword sets, and the
  local statement-vs-block tails after an at-keyword route.

Less status:

- Already exemplary in principle: `IdentifierOrFunction` consumes bare
  identifiers and glued `name(` once, routes exact known function openers,
  routes generic functions with `when(endsWith('('), ...)`, and sends bare
  identifiers to `otherwise(...)`.
- Less pseudo dispatch has a first safe slice: ordinary glued functional pseudos
  dispatch on `:` / `::` + static name + `(`, then route selector-valued
  pseudos, generic static argument pseudos, and interpolation-bearing argument
  pseudos through `routed()`. The static selector-capture grammar deliberately
  stays narrower, and `:extend(` remains owned by the extend selector helper.
- Next candidates after functional pseudos: mixin definition/call/bare-call headers,
  mixin/reference value surfaces, and media/container query features. These all
  need richer routed facts or helper rules; routing on `.`, `#`, `@`, or bare
  `(` is too early.
- Keep as `choice(...)`: `directLessAtStatement`, body item lists, delimiter
  choices, and block-vs-statement tails. Bare `@` is not a dispatch key in Less
  because variables, reference calls, imports/plugins, conditional at-rules,
  keyframes, generic at-rules, and mixin-like continuations need later syntax.

Less opaque at-rule checkpoint, 2026-07-27: Less now has a narrow
`OpaqueAtRuleBlock` fallback for CSS-valid unknown block bodies such as
`@future {!!:foo > ; > ?bar}`. The body capture is Less-local rather than
composed from `opaqueAtRuleRecognition`, so `lessCstGrammar` exposes
`OpaqueAtRuleBlock` but does not leak `CssOpaqueCapturePrelude` or
`CssOpaqueCaptureBody` into the public Less CST rule catalog. Dynamic Less
headers such as `@custom foo@{query};` and variable declarations such as
`@theme: { ... };` remain outside that opaque block route.

Fresh verification for that checkpoint:

- `pnpm --filter @jesscss/less-parser test -- ast-grammar.test.ts
  public-parse.test.ts cst-public.test.ts macro-compiled.test.ts
  conditional-at-rule-value.test.ts --run --reporter=dot` passed 430 tests.
- The narrower pseudo-dispatch follow-up also passed
  `pnpm --filter @jesscss/less-parser build && pnpm --filter
  @jesscss/less-parser test -- ast-grammar.test.ts cst-public.test.ts
  public-parse.test.ts --run --reporter=dot` with 320 tests, then the same
  430-test focused Less set above.
- `pnpm run check:macro` passed with parser-shared, CSS, Less, SCSS, and Jess
  fully compiled and 0 interpreter fallbacks.
- `pnpm run verify:compose-integrity` passed.
- `pnpm run oracle:less:byte-identity` still fails against the committed
  baseline with the current dirty fold aggregate:
  `ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
  with 116 throws and 10 moved entries, and
  `cst=d04fa758b2790b695b5f04d41829d5d0b8b5950df342f17039763b72b301266c`
  with 0 throws and 529 moved entries. The AST aggregate matches the known
  dirty folded surface. A read-only oracle classification compared the first
  529-move CST run against `/private/tmp/jess-less-oracle-byte-current-20260727.json`
  (`cst=c71003df...`, 511 moved entries): the 18-entry increase was
  at-rule/import/charset-shaped, not selector-pseudo-shaped. The latest CST
  aggregate changed again after the root declaration-list separator fix, but the
  named moved-entry count stayed at 529 and the AST aggregate did not move.
  Sample moved entries include `tests-unit/at-rules-empty/at-rules-empty.less`,
  `tests-unit/charsets/charsets.less`, `tests-unit/tailwind/tailwind.less`, CSS
  `atrule-empty.css`, `atrule-inside.css`, and
  `packages/jess/test/files/include.css`. Sample CST probes show generic at-rule
  preludes now owned by
  `DirectLessStaticAtRulePrelude > DirectLessStaticAtRuleTerm >
  DirectLessStaticAtRuleAtom`, while pseudo probes still use the intended
  `DirectLessStaticSelectorPseudo`, `DirectLessStaticNonSelectorPseudo`,
  `DirectLessInterpolatedArgumentPseudo`, and `ExtendPseudo` owners. Treat this
  as unresolved folded at-rule/prelude CST classification, not as a pseudo
  dispatch regression or as a clean byte-identity baseline.

Root declaration-list separator fix, 2026-07-27: root Less declarations now use
`DirectLessRootDeclarationItem`, which requires either a semicolon separator or
end of stylesheet. Block declarations continue to use `DirectLessDeclarationItem`,
which requires either a semicolon separator or `peek('}')`. This is deliberately
not a dispatch rewrite: `DirectLessDeclaration` remains a real declaration-family
`choice(...)`, while the list context owns whether a declaration may terminate.
The new guards accept a final root declaration and `value: red; @media ...`,
reject `value: red @media ...` and `.card { color: red @media ... }`, and
preserve the CSS custom-property exception where the declaration value may contain
opaque at-rule-looking bytes until `}`.

Evidence for the root separator slice: `pnpm --filter @jesscss/less-parser test
-- ast-grammar.test.ts --run --reporter=dot` passed 192 tests. After rebuilding
`@jesscss/parser-shared`, `@jesscss/css-parser`, and `@jesscss/less-parser` in
dependency order, the broader focused Less parser set
`ast-grammar.test.ts public-parse.test.ts cst-public.test.ts
conditional-at-rule-value.test.ts macro-compiled.test.ts --run --reporter=dot`
passed 430 tests. A prior run of the same focused set failed before executing
four files because built CSS artifacts were stale (`css-parser/lib/cst.js`
imported missing `css-parser/lib/cst-css.js`); that was a build-state failure,
not a grammar assertion. `pnpm run check:macro` passed with parser-shared, CSS,
Less, SCSS, and Jess fully compiled and 0 interpreter fallbacks.
`pnpm run verify:compose-integrity` passed. `pnpm run oracle:less:byte-identity`
still fails against the committed baseline with
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`,
116 throws and 10 moved AST entries, plus
`cst=d04fa758b2790b695b5f04d41829d5d0b8b5950df342f17039763b72b301266c`,
0 throws and 529 moved CST entries.

CSS calc dispatch slice, 2026-07-27: `CalcValue` now uses
`CalcIdentOrFunction` for the calc-local identifier/function atom family. This
is a positive dispatch use: one broad `ident` or glued `name(` opener is parsed
once, exact known function openers keep their strict calc/url/var tails, generic
functions use the typed function argument route already used by calc, and bare
identifiers become `Keyword`. The dispatcher is not a public CST owner; a CST
guard asserts `calc(var(--x) + foo(1px))` still exposes `CalcCall`, `VarCall`,
and `Call` but no `CalcIdentOrFunction` node.

Evidence for the CSS calc dispatch slice: after rebuilding parser-shared and CSS
in dependency order, `pnpm --filter @jesscss/css-parser test --
ast-grammar.test.ts cst-public.test.ts public-parse.test.ts macro-compiled.test.ts
--run --reporter=dot` passed 131 tests. `pnpm run check:macro` passed with all
parser packages fully compiled and 0 interpreter fallbacks. `pnpm run
verify:compose-integrity` passed. `pnpm run oracle:less:byte-identity` still
fails at the same known dirty aggregates as the preceding root-separator run:
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`,
116 throws and 10 moved AST entries; and
`cst=d04fa758b2790b695b5f04d41829d5d0b8b5950df342f17039763b72b301266c`,
0 throws and 529 moved CST entries. This slice did not expand the Less oracle
delta.

Less `:extend()` parse-once design note, 2026-07-27: a read-only sidecar
confirmed the next selector cleanup is real, but it is not a dispatch cleanup.
The current hotspot is the selector list item shape around
`directSelectorBranchContinuation`, `DirectLessSelectorBranch`,
`DirectLessDynamicSelectorBranch`, and `selectorListWithExtends`: the list still
chooses between static and dynamic selector branches after entering selector-like
syntax. The target is one selector-list item parser, used under
`oneOrMoreSep(...)`, that parses the complex selector once, optionally collects
the inline `:extend(...)`, and then checks the comma / `when` / `{` boundary.
There is no single broad opener whose consumed value routes the branch, so
`dispatch(...)` would be the wrong abstraction.

Risks for that future Less slice: public CST must keep `ExtendPseudo` as the
visible owner; inline extend AST facts must attach only to the selector branch
that carried them; bare `:extend(.a all) {}` and
`.a:extend(.b all).c {}` must remain rejected; and the dynamic-subject case
`.@{name}:extend(.target)` needs an explicit Jess-vs-Less decision before the
branch is simplified. Focused tests should cover bare extend rejection,
extend-not-at-end rejection, `.active&:extend(.target) {}`, and
`.ext1 .ext2 :extend(.foo all) {}` before running the Less focused parser set,
macro, and compose gates.

Less `:extend()` guard slice, 2026-07-27: the focused AST suite now pins those
selector-branch constraints before the grammar cleanup. The new guard accepts
`.active&:extend(.target), .ext1 .ext2 :extend(.foo all) { ... }`, verifies each
inline extend subject is the full parsed selector branch, keeps public CST under
`ExtendPseudo`, asserts no `InlineExtendTail` node leaks, and rejects bare
`:extend(.a all) { ... }` plus non-terminal `.a:extend(.b all).c { ... }`.
This deliberately does not rewrite the grammar yet; it gives the parse-once
selector-list-item rewrite a spec it must satisfy, and confirms again that this
is `choice(...)`/list/context territory rather than `dispatch(...)`.

Evidence for the Less `:extend()` guard slice: after building parser-shared and
Less in dependency order, `pnpm --filter @jesscss/less-parser test --
ast-grammar.test.ts public-parse.test.ts cst-public.test.ts --run
--reporter=dot` passed 322 tests.

CSS query dispatch slice, 2026-07-27: `QueryTerm` now keeps the structural
`QueryFeature` arm as a plain `choice(...)` branch and routes only the
identifier-or-function token family through `dispatch(...)`. The routed opener
excludes bare reserved media-type words (`only`, `layer`) while still accepting
function openers such as `only(` / `layer(` if CSS syntax reaches them as
functions. `QueryFunction` now owns a glued opener leaf such as `style(` in both
first-term and later-term positions; this is an intentional function-token CST
migration, not an accidental split-shape drift. A non-token routed opener probe
was rejected because the compiled `endsWith('(')` matcher received no dispatch
key for later media-query terms. Keep `QueryFeature` as the adjacent
left-factor target: its arms share punctuation `(` and then make
property/value/delimiter decisions inside the parentheses, so replacing it with
cosmetic `dispatch(...)` would be the wrong abstraction.

Evidence for the CSS query dispatch slice: after building parser-shared and CSS
in dependency order, `pnpm --filter @jesscss/css-parser test --
ast-grammar.test.ts conditional-at-rule-value.test.ts cst-public.test.ts
public-parse.test.ts macro-compiled.test.ts --run --reporter=dot` passed 240
tests, and the full CSS parser suite `pnpm --filter @jesscss/css-parser test --
--run --reporter=dot` passed 269 tests across 8 files. `pnpm run check:macro`
passed with parser-shared, CSS, Less, SCSS, and Jess fully compiled and 0
interpreter fallbacks. `pnpm run
verify:compose-integrity` passed. `pnpm run oracle:less:byte-identity` still
fails at the same known dirty aggregates as the preceding slices:
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`,
116 throws and 10 moved AST entries; and
`cst=d04fa758b2790b695b5f04d41829d5d0b8b5950df342f17039763b72b301266c`,
0 throws and 529 moved CST entries. This slice did not expand the Less oracle
delta.

CSS container-prelude left-factor cleanup, 2026-07-27: `ContainerPrelude` is a
context/list shape, not a dispatch target. The grammar now folds the previous
named-query and name-only arms into
`sequence(containerName, optional(ContainerQueryPrelude))`, with the standalone
`ContainerQueryPrelude` arm kept separate for `style(...)` and bare feature
queries. This preserves public rule names and leaves function-token routing in
`QueryTerm` / `QueryFunction`; it deliberately does not pretend the remaining
container-name/query-function first-set overlap is a known/generic dispatch
family. Focused CSS parser evidence after the cleanup: `pnpm --filter
@jesscss/css-parser test -- cst-public.test.ts conditional-at-rule-value.test.ts
ast-grammar.test.ts public-parse.test.ts macro-compiled.test.ts --run
--reporter=dot` passed 240 tests. `pnpm run check:macro` passed with 0
interpreter fallbacks; `pnpm run verify:compose-integrity` passed; and `pnpm
run oracle:less:byte-identity` stayed at the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws.

CSS/Less dispatch-vs-choice hotspot queue, 2026-07-27:

- `packages/syntax/less/less-parser/src/grammar.ts` `directLessAtStatement` is
  the largest remaining shared-opener choice. It restarts from `@...` for
  imports, plugins, variable declarations, value-block declarations,
  supports/media/keyframes, generic at-rules, and reference calls. The intended
  shape is a routed Less at-head with exact known cases and an `otherwise(...)`
  path that still distinguishes `@name :`, `@name {`, `@name(`, and generic
  at-rule tails. Do not dispatch on bare `@`; Less allows whitespace before the
  variable-declaration colon, so the routed combinator must include enough shape
  to make that branch decision.
- CSS `QueryFeature` should be left-factored around `(` and property/value
  tails. Do not repeat the now-landed `QueryTerm` dispatch review there; these
  are adjacent cleanup targets but different Parseman idioms.
- Less `directLessQueryLeaf` dispatch landed, 2026-07-27: the leaf now uses a
  static `queryIdentOrFunction` opener, not the interpolation-bearing value
  opener. It routes `calc(` to the calc body, other glued function openers to the
  generic function body, and bare identifiers through the existing
  `DirectLessKeyword` public owner; `url(` remains excluded rather than widened
  into a generic query function. Follow-up cleanup removed the nested
  `choice(calcFunctionName, functionName)` inside the routed opener: the opener
  is now one query identifier plus optional glued `(`, and `calc(` is selected by
  `dispatch(...)` like the other known/generic branches. The focused query/CST/AST
  set (`cst-public.test.ts conditional-at-rule-value.test.ts
  ast-grammar.test.ts`) passed 353 tests after that cleanup. Earlier evidence:
  `pnpm --filter
  @jesscss/less-parser build` passed; the focused Less parser set
  (`ast-grammar.test.ts public-parse.test.ts cst-public.test.ts
  conditional-at-rule-value.test.ts macro-compiled.test.ts`) passed 433 tests;
  the full Less parser suite passed 460 tests; `pnpm run check:macro` passed
  with 0 interpreter fallbacks and Less at 3724 `charCodeAt` vs 304
  `RegExp.exec`; `pnpm run verify:compose-integrity` passed; and
  `pnpm run oracle:less:byte-identity` stayed at the known dirty aggregate
  `ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
  with 10 moved AST entries and
  `cst=d04fa758b2790b695b5f04d41829d5d0b8b5950df342f17039763b72b301266c`
  with 529 moved CST entries.
  Later verification after the single-query-opener cleanup: `pnpm run
  check:macro` passed with 0 interpreter fallbacks and Less at 3572 `charCodeAt`
  vs 304 `RegExp.exec`; `pnpm run verify:compose-integrity` passed; and
  `pnpm run oracle:less:byte-identity` stayed at the known folded aggregates
  `ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
  with 116 throws and
  `cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
  with 0 throws.
- Less `QueryFeature` is now the adjacent query cleanup target. The
  build analyzer reports overlaps inside the parenthesized feature family after
  the leaf dispatch, but this is not another leaf dispatch case. It should be
  left-factored around `(` and the feature-name/value/comparison tails while
  preserving the distinct bare, colon, comparison, range, logical-group, and
  negated-feature AST reductions. Probe note, 2026-07-27: the obvious
  left-factor would move or flatten public CST owners such as
  `QueryBareFeature`, `QueryColonFeature`,
  `QueryComparisonFeature`, `QueryRangeFeature`,
  `QueryLogicalGroup`, and `QueryNegatedFeature`. That is not
  acceptable as incidental cleanup. `cst-public.test.ts` now pins each owner, and
  the focused query/CST/AST set (`cst-public.test.ts
  conditional-at-rule-value.test.ts ast-grammar.test.ts`) passes 353 tests. The
  current safe cleanup only factors duplicate comparison/range operator
  reduction through `queryComparisonOperators(...)`; it deliberately does not
  change recognition. The future rewrite must either preserve those owners while
  sharing the opener, or intentionally migrate the public CST contract in the
  same gated step. Verification after the reducer cleanup: `pnpm run
  oracle:less:byte-identity` remains red only against the committed old
  baseline, with the known folded aggregates
  `ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
  and `cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`.
- Less pseudo shared-opener dispatch landed, 2026-07-27: `DirectLessPseudo` and
  `DirectLessStaticPseudo` now route one `:name` / glued `:name(` opener through
  `dispatch(...)`, with selector-function, generic-function, interpolation
  argument, and bare-pseudo branches consuming the opener via `routed()`. This
  removes the previous function-opener-then-bare-fallback split. Public CST owner
  names stay `DirectLessStaticSelectorPseudo`,
  `DirectLessStaticNonSelectorPseudo`, and
  `DirectLessInterpolatedArgumentPseudo`, and `ast-grammar.test.ts` now pins the
  bare/function routed cases. The next cleanup in this area is naming only:
  names should move toward `PseudoFunction`, `SelectorPseudo`, `OpaquePseudo`,
  and `InterpolatedPseudo` when the public CST contract is deliberately migrated;
  adjective stacks like `DirectLessStaticNonSelectorPseudoRouted` remain review
  findings unless the accepted language really diverges.
- Evidence for the Less pseudo shared-opener slice: the focused Less parser set
  (`cst-public.test.ts ast-grammar.test.ts macro-compiled.test.ts
  public-parse.test.ts`) passed 330 tests; `pnpm run check:macro` passed with
  parser-shared, CSS, Less, SCSS, and Jess fully compiled and 0 interpreter
  fallbacks, with Less at 3582 `charCodeAt` vs 304 `RegExp.exec`; and
  `pnpm run verify:compose-integrity` passed. `pnpm run
  oracle:less:byte-identity` remains red against the committed baseline; versus
  the prior dirty folded oracle, AST is unchanged
  (`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`,
  116 throws), while CST intentionally moved to
  `cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
  with 0 throws. A per-entry diff against
  `/tmp/jess-less-oracle-current-20260727.json` showed 107 CST-only movers and
  0 AST movers, consistent with routed pseudo opener ownership rather than
  semantic AST drift.
- Less `Value` already uses the right `IdentifierOrFunction`
  dispatch, but the following `g.DirectLessFunction` sibling retry is a smell.
  If the sibling exists only for diagnostics, move that ownership inside the
  routed function path rather than leaving a second shared-opener route. Probe
  evidence, 2026-07-27: removing the sibling compiled, passed the focused Less
  parser set (432 tests), and passed the full Less parser suite (459 tests), but
  moved the Less byte oracle from the prior dirty aggregate to
  `ast=5e2bb025f3e5dbc7d45ee53496a62bf6456ed58b2254a9b67ff498f2b40a10ac`
  with 12 moved AST entries and
  `cst=f1495f61bae8cec72d9171099e0776f90698ac7d514e6f1ff09a4fc1b771a499`
  with 531 moved CST entries; named AST movers included
  `packages/syntax/css/css-parser/test/css/errors/calc-empty.css`. Restoring the
  sibling returned the oracle to the current known dirty aggregate
  `ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
  with 10 moved AST entries and
  `cst=d04fa758b2790b695b5f04d41829d5d0b8b5950df342f17039763b72b301266c`
  with 529 moved CST entries. The accepted replacement must keep the
  identifier/function opener routed once while explicitly preserving or
  deliberately rejecting the invalid `calc()` diagnostic surface; a blind
  deletion is not a neutral refactor.

Intentional keepers from the same audit: CSS `ValueList` and `TypedValue` stay as
`choice(...)` because the identifier/function atom is already dispatched and the
remaining atoms are disjoint; CSS at-rule dispatch is a good dispatch use, and
its local statement-vs-block choice is valid because the tail delimiter is a
later structural decision; CSS selector/value lists should remain
`oneOrMoreSep(...)`; Less `selectorListWithExtends` is a parse-once
selector-list-item/helper target, not dispatch; and the Less mixin/ruleset gate
depends on later selector delimiters, so naive opener dispatch is not enough.

CSS/Less dispatch-vs-choice reviewer audit, 2026-07-27:

- CSS's main shared-opener families are already in the intended Parseman
  shape: pseudo openers, value identifier/function openers, query
  identifier/function terms, and at-keyword families route one opener through
  `dispatch(...)` and put the generic same-family continuation in
  `otherwise(...)`.
- CSS remaining analyzer overlaps are review targets, not automatic dispatch
  work. `QueryFeature` and `ContainerPrelude` need left-factoring or public CST
  contract migration if they move; `QueryClause` must not get a broad
  `not(only)` guard that kills function-token routes such as `only(`; body/list
  item choices and at-rule statement-vs-block tails remain real `choice(...)`
  sites.
- CSS `var()` fallback parsing is the one notable dispatch-adjacent candidate
  left by the audit: `varFallbackComponent` can reach `VarCall`,
  `VarFallbackCall`, and then `TypedValue`, whose identifier/function leaf is
  already routed. Treat this as a design target for a precise fallback-specific
  route only; `var()` comma semantics make a blind rewrite risky.
- Less's high-value remaining work is context-helper design, not dispatch on
  shorter openers. `directLessAtStatement`, mixin statement routing,
  generic-at-rule block tails, mixin/reference call heads, nested at-rule/value
  separators, and selector `:extend(...)` should parse the shared head once and
  include the deciding delimiter or context in that helper. Bare `@`, bare
  `.foo`, bare `#foo`, or bare `(` are not enough routed value.
- Less current keepers are the identifier/function value dispatch, query
  identifier/function dispatch, pseudo dispatch, query-feature `choice(...)`
  with preserved CST owners, body/list item choices, and list-owned semicolon
  handling. These should not be reworked as cosmetic dispatch conversions.

Comment cleanup follow-up, 2026-07-27: source comments now use "choice group"
for the Less `directLessAtStatement` helper instead of calling that grouped
`choice(...)` a dispatch. The comment explicitly says this is not
`dispatch(...)` yet because Less `@name` forms need a routed opener that includes
the real delimiter/suffix decision. CSS `varFallbackComponent` also records why
the apparent duplicate identifier/function path is only dispatch-adjacent:
fallback generic functions own fallback comma semantics, so a future route must
keep that body rather than reuse ordinary `TypedIdentOrFunction`.

Less generic at-rule block left-factor, 2026-07-27: `DirectLessAtRuleBlock` now
keeps the special `@layer` arm separate, then parses generic `atRuleName` once
and delegates to `genericAtRuleBlockTail`. The tail still owns the
typed-static-prelude-first attempt and the CSS component-prelude fallback, and
`atRuleBlockBody` owns the repeated `{ blockBody optional(function) }` shape.
This is deliberately left-factoring, not `dispatch(...)`: block-vs-statement is
still decided by the `{`/`;` tail, and Less `@name` variables/reference calls
are not decided by the bare at-keyword. A read-only sidecar agreed this is safe
only as a generic-arm left-factor and explicitly rejected broader at-keyword
dispatch here.

Evidence for the Less generic at-rule block left-factor: the focused Less parser
set (`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
conditional-at-rule-value.test.ts public-parse.test.ts`) passed 435 tests;
scoped `git diff --check` passed; `pnpm run check:macro` passed with 0
interpreter fallbacks and Less at 3564 `charCodeAt` vs 302 `RegExp.exec`; and
`pnpm run verify:compose-integrity` passed. `pnpm run
oracle:less:byte-identity` remains red only against the committed older
baseline and stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws; this slice did not expand the current oracle delta.

Less selector combinator keyword cleanup, 2026-07-27: `staticCombinator` and
`relativeSelectorCombinator` now use `keywords([...])` instead of handwritten
`choice(literal(...))` operator tables, matching the CSS grammar's closed-table
shape. This is also not `dispatch(...)`: fixed punctuation/operator sets are a
`keywords(...)` or small `choice(...)` concern, while `dispatch(...)` is reserved
for one routed broad opener whose already-parsed value selects known and generic
same-family continuations. This change removes the `staticCombinator` gating
warning without changing selector reductions.

Evidence for the Less selector combinator cleanup: the focused Less parser set
(`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
public-parse.test.ts`) passed 330 tests; scoped `git diff --check` passed;
`pnpm run check:macro` passed with 0 interpreter fallbacks and Less at 3606
`charCodeAt` vs 302 `RegExp.exec`; and `pnpm run verify:compose-integrity`
passed. `pnpm run oracle:less:byte-identity` remains red only against the
committed older baseline and stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws; this slice did not expand the current oracle delta.

Less `@media`/`@container` dispatch pressure-test, 2026-07-27: do not rewrite
`MediaContainerBlock` to route through the broad
`CssSyntaxMediaContainerAtKeyword` helper in the current fold. Conceptually the
two arms are a shared at-keyword family, but the broad helper changes public CST
terminal ownership from the specific `CssSyntaxMediaAtKeyword` /
`CssSyntaxContainerAtKeyword` facts to the grouped token. That is not a neutral
grammar cleanup while language-service consumers still see those keys.

The attempted broad dispatch passed focused parser tests and `check:macro`, but
`pnpm run oracle:less:byte-identity` moved the dirty folded aggregate to
`ast=c37ac5f2c099c59f241988860908523879da82544325d494bab6b4109e1422ae`
with 116 throws and
`cst=01cc6d52784b53c45a414684b90a8cba1c5847e647676d2a2bb4a3383f6b2db3`
with 0 throws. A variant that dispatched over
`choice(CssSyntaxMediaAtKeyword, CssSyntaxContainerAtKeyword)` preserved the
specific recognizers but left the original `@`/`@` opener overlap inside the
dispatcher, so it had no meaningful recognition benefit. The accepted path is
to keep the current `choice(...)` until Parseman or the CST migration provides a
value-routing shape that can reuse the matched specific terminal without
renaming public CST ownership.

After reverting the pressure-test, the focused Less parser set
(`conditional-at-rule-value.test.ts ast-grammar.test.ts cst-public.test.ts
macro-compiled.test.ts public-parse.test.ts`) passed 435 tests; `pnpm run
check:macro` passed with 0 interpreter fallbacks and Less back at 3606
`charCodeAt` vs 302 `RegExp.exec`; and the Less byte oracle returned to the
known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws.

Less supports-feature left-factor, 2026-07-27: `SupportsFeature`
now parses its shared `(` + property opener once and uses an optional
`: value` tail instead of two duplicated `choice(sequence(...))` arms. This is
a local Parseman readability cleanup, not the broader supports-condition router
fix: `SupportsCondition` still needs separate review because its
`not` branch and ordinary parenthesized-condition branch encode CSS supports
semantics.

Evidence for the supports-feature left-factor: the focused Less parser set
(`conditional-at-rule-value.test.ts ast-grammar.test.ts cst-public.test.ts
macro-compiled.test.ts public-parse.test.ts`) passed 435 tests; `pnpm run
check:macro` passed with 0 interpreter fallbacks and Less at 3604 `charCodeAt`
vs 302 `RegExp.exec`; `pnpm run verify:compose-integrity` passed; and
`pnpm run oracle:less:byte-identity` stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws.

Less math-operator keyword/trivia cleanup, 2026-07-27: `productOperator` and
`topProductOperator` now spell their fixed operator tables with `keywords([...])`
instead of `choice(literal(...))`. This is the same rule as selector
combinators: closed punctuation/operator tables are `keywords(...)`, not
`dispatch(...)`. The surrounding slash-led trivia warning came from accepting
both `//` and `/*...*/` as separate comment arms, so `mathTrivia` and
`staticSelectorTrivia` now share one `triviaComment` terminal for the two comment
forms they already accepted. `sumOperator` deliberately stays a regex because
its sign/spacing lookahead is Less math syntax, not a closed operator table.

Evidence for the math-operator cleanup: the focused Less parser set
(`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
public-parse.test.ts conditional-at-rule-value.test.ts`) passed 435 tests, and
the `mathTrivia`, `staticSelectorTrivia`, `productOperator`, and
`topProductOperator` gating warnings disappeared from the focused/macro logs.
`pnpm run check:macro` passed with 0 interpreter fallbacks and Less at 3604
`charCodeAt` vs 302 `RegExp.exec`; `pnpm run verify:compose-integrity` passed;
and `pnpm run oracle:less:byte-identity` stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws.

Less pseudo delimiter keyword cleanup, 2026-07-27: Less pseudo productions now
share one local `pseudoDelimiter = keywords(['::', ':'])` terminal instead of
mixing `regex(/::?/)` and repeated `choice(literal('::'), literal(':'))`
spellings. This is intentionally local: the shared `CssSyntaxPseudoColon`
recognizer carries a CSS whitespace guard and shared CST key, so using it here
would be a CST ownership change rather than a pure Less grammar cleanup.

Evidence for the pseudo delimiter cleanup: the focused Less parser set
(`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
public-parse.test.ts conditional-at-rule-value.test.ts`) passed 435 tests;
`pnpm run check:macro` passed with 0 interpreter fallbacks and Less at 3612
`charCodeAt` vs 302 `RegExp.exec`; `pnpm run verify:compose-integrity` passed;
and `pnpm run oracle:less:byte-identity` stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws. Do not present this as a speed win; it is a local readability and
consistency cleanup that preserves byte identity.

Less mixin/each punctuation keyword cleanup, 2026-07-27: the mixin parameter
separator and anonymous `each()` callback head now share local punctuation
helpers, `commaOrSemicolon = keywords([',', ';'])` and
`eachCallbackSigil = keywords(['.', '#'])`, instead of repeating
`choice(literal(...), literal(...))` inside nested callback syntax. This is a
closed punctuation-table cleanup, not `dispatch(...)`, and it does not claim to
resolve the broader `DirectLessRuleset#3` nullable-prefix analyzer warning.

Evidence for the mixin/each punctuation cleanup: the focused Less parser set
(`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
public-parse.test.ts conditional-at-rule-value.test.ts`) passed 435 tests;
`pnpm run check:macro` passed with 0 interpreter fallbacks and Less at 3612
`charCodeAt` vs 302 `RegExp.exec`; `pnpm run verify:compose-integrity` passed;
and `pnpm run oracle:less:byte-identity` stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws.

Dispatch-vs-choice rewrite rule, 2026-07-27: CSS and Less grammar cleanup now
uses a five-way classification for every touched `choice(...)`: routed token
family, closed spelling table, separated list, construct family, or context
decision. Only routed token families default to `dispatch(...)`; the canonical
examples are the CSS `IdentOrFunction` / `CalcIdentOrFunction` /
`TypedIdentOrFunction` routes and the Less `IdentifierOrFunction` route, where
the glued opener (`url(`, `calc(`, `var(`, generic `name(`, or bare identifier)
is consumed once and branches own `routed()`. Closed operator tables such as
selector combinators, math product operators, pseudo delimiters, and mixin
punctuation stay `keywords(...)`; selector and value comma lists stay
`oneOrMoreSep(...)`; body/declaration item families stay `choice(...)` unless a
real shared prefix can be left-factored; Less `@` and selector-extension
contexts need a routed opener/helper that includes the deciding delimiter or
context before dispatch is valid.

Less mixin guard `default()` cleanup, 2026-07-27: guard-specific `default()`
recognition now lives in one local `mixinGuardDefaultCall` terminal and is reused
by both the operand node and the top-level default-guard node. This is a closed
token-shape cleanup, not a dispatch conversion: there is no known/generic
same-family continuation here. The structural `word('default')` version remains
a separate language decision because the current terminal intentionally accepts
whitespace before and inside `default()` while keeping the trailing `)` boundary.
Evidence for this slice: the focused Less parser set
(`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
public-parse.test.ts conditional-at-rule-value.test.ts`) passed 435 tests;
`pnpm run check:macro` passed with 0 interpreter fallbacks and Less at 3612
`charCodeAt` vs 302 `RegExp.exec`; `pnpm run verify:compose-integrity` passed;
and `pnpm run oracle:less:byte-identity` stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws. The remaining `DirectLessMixinGuardTerm` `d` overlap is still a
left-factor task; this slice only removed duplicated recognition.

Less closed-token keyword cleanup follow-up, 2026-07-27: `importKeyword`,
`@plugin`, the `@supports` exclusion inside Less reference calls, guard `not`,
and glued container `style(` now use `keywords(...)`, `word(...)`, or the local
`lessWord(...)` helper instead of token-position keyword regexes. This is still
not dispatch: these are closed words/tables or a single glued opener with no
same-family generic continuation. The scan sentinels (`functionConditionStop`,
`functionConditionAhead`, selector-tail guard stops, and similar broad stops)
remain regex-shaped because they match at arbitrary offsets or own leading
trivia; do not "Parseman-pretty" them until a structural sentinel helper exists.
Evidence after this follow-up: the focused Less parser set
(`ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts
public-parse.test.ts conditional-at-rule-value.test.ts`) passed 435 tests;
`pnpm run check:macro` passed with 0 interpreter fallbacks and Less at 3540
`charCodeAt` vs 308 `RegExp.exec`; `pnpm run verify:compose-integrity` passed;
and `pnpm run oracle:less:byte-identity` stayed on the known folded aggregates
`ast=1ad5b5183e984dd4e7fc596ba392e747c89205c32b32c895ead7c3a52ff68c03`
with 116 throws and
`cst=8880f56555332407b722652c7b48865746350bdb275dea4897ee5523991a1698`
with 0 throws. Do not present the macro opcode mix as a speed claim; this is an
API/readability cleanup.

Less glued function-opener cleanup, 2026-07-27: value-position functions now use
the canonical routed opener shape. `functionOpener` and `calcFunctionOpener`
consume `name(` / `calc(` as one no-trivia token, `functionNameFromOpener`
derives the AST name from that routed token, and `IdentifierOrFunction` is the
single `Value`-position route for `url(`, `calc(`, generic `name(`, and bare
identifiers. The old `g.DirectLessFunction` sibling retry after
`IdentifierOrFunction` is gone from `Value`; remaining `g.DirectLessFunction`
references are context-specific uses such as guard operands, static at-rule
values, and optional block-tail function syntax and must be reviewed in their
own contexts rather than reintroduced as a value fallback.

Evidence for the Less glued function-opener cleanup: `pnpm --filter
@jesscss/less-parser build` passed; `pnpm --filter @jesscss/less-parser test --
--run test/cst-public.test.ts --reporter=dot` passed 54 tests; `pnpm --filter
@jesscss/less-parser test -- --run test/public-parse.test.ts --reporter=dot`
passed 77 tests; and the focused AST filter for query features plus known/generic
function ownership passed 4 tests with 192 skipped. The CST guard
`keeps Less function-like openers glued in public CST owners` pins `e(`,
`selector(`, and container `style(` leaves. A broad AST filter that includes old
comment-as-node assertions still fails on the known comment-trivia cleanup debt;
do not restore comment nodes or value fallback reparsing to satisfy those stale
expectations.

Current integration gates: `pnpm run check:macro` passes with parser-shared,
CSS, Less, SCSS, and Jess all fully macro-buildable and 0 interpreter fallbacks;
Less reports 4046 `charCodeAt` vs 320 `RegExp.exec`. `pnpm run
verify:compose-integrity` passes after a dependency-ordered rebuild. `pnpm run
verify:less-alpha` passes its Less parser, Less plugin, `jess`, package-export,
public-API, path-resolution, Less test-data unit, and Less test-data config
lanes.

`pnpm run oracle:less:byte-identity` is still red against the committed baseline:
the current corpus has 711 entries, AST moved to
`bf61fca63825da2c148c82f20fcf604bc407324ba967b94f46fedb886828fa8f`
with 115 throws and 110 moved entries, and CST moved to
`aee294a40cce49c7d1fb07f5438be3bd2facf21d78c6f786d28304de94c9d21d`
with 0 throws and 592 moved entries. Treat the oracle as the active
classification queue, not as evidence that the grammar cleanup is byte-neutral.
The checked-in baseline surface is the 709-entry
`309d...`/`7819...` surface; the current corpus gained 2 entries.

Current oracle movement classification, 2026-07-27: classification for the
711-entry current corpus is pending. The active rules and named-set home remain
[`LESS-ORACLE-MOVER-CLASSIFICATION.md`](./LESS-ORACLE-MOVER-CLASSIFICATION.md).
Do not update the oracle baseline until the current AST movers are classified,
the CST ownership movement is either projected or minimized, and the 2 gained
corpus entries are explicitly accounted for.

Next oracle probes before any baseline update: regenerate a before report with
per-entry throw status for the exact 709-entry baseline state; run a
comment-stripped corpus comparison to isolate comment-driven AST movement; build
a declared CST rename projection for opener/query/supports/container/extend
owner churn; account for the 2 gained corpus entries; and minimize the
non-comment AST residues into focused parser fixtures.

CSS pseudo comment cleanup, 2026-07-27: `LeadingDashPseudoArgument` and
`TypedNthPseudoArgument` no longer spell an explicit `optional(blockComment)` or
search reducer children for comment tokens before the `of <selector>` tail.
Parser trivia already owns those comments, and the semantic pseudo selector text
normalizes to `nth of <selector>` without comment bytes. This removes dead
production-local comment plumbing without changing the existing
`:nth-child(-n+2/* preserve */ of .item)` AST expectation.

Evidence for the CSS pseudo comment cleanup: `pnpm --filter
@jesscss/css-parser test -- --run test/ast-grammar.test.ts -t
'nth-child|nth-last-child|nth-of-type|comment-delimited|comments out of semantic|selector and declaration-internal comments|selector-to-block comment'
--reporter=dot` passed 5 tests with 77 skipped, and `pnpm --filter
@jesscss/css-parser test -- --run test/cst-public.test.ts -t
'comment|pseudo|url' --reporter=dot` passed 2 tests with 18 skipped.

SCSS public-name cleanup, 2026-07-27: the first SCSS prefix slice renamed the
publicly pinned scaffolding names `DirectScssValueAtom`, `DirectScssImport`, and
`DirectScssMixinCallArg` to `ScssValueAtom`, `ScssImport`, and
`ScssMixinCallArg` in the folded SCSS grammar and direct CST/compose tests.
`DirectScssVarDeclaration` is already absent; the rule is `VariableDeclaration`.
This was only the first SCSS naming pass; later reviewed family slices drained
the remaining `DirectScss*` / `directScss*` source vocabulary, and the later
SCSS value/mixin argument semantic-name cleanup below replaced the temporary
`ScssValueAtom` / `ScssMixinCallArg` labels.

Evidence for the SCSS public-name cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed 4 files / 103 tests. The same mixin argument shape still emits an
existing Parseman gating warning, now under `MixinCallArgument`; that is
follow-up grammar structure debt, not a failed rename.

Jess `$for` public-name cleanup, 2026-07-27: the folded Jess grammar's loop
family now uses `ForName`, `ForBinding`, `ForRangeBound`, `ForRange`,
`ForSource`, and `For` instead of `DirectJessFor*`. The public CST test pins
`grammarType === 'For'` and rejects `DirectJessFor`, and the direct AST test now
targets `jessAstGrammar.For`. This is a naming cleanup only: Parseman still
reports `choice @ For` as ungated through the broad `ForSource` arm, so the
range/source split remains a follow-up left-factor or dispatch-design task.

Evidence for the Jess `$for` cleanup: `pnpm --filter @jesscss/jess-parser exec
vitest --run test/ast-grammar.test.ts -t '\$for' --reporter=dot` passed 7 tests
with 97 skipped, and `pnpm --filter @jesscss/jess-parser exec vitest --run
test/cst-public.test.ts -t '\$for' --reporter=dot` passed 1 test with 9 skipped.

Jess expression-name cleanup, 2026-07-29: the folded Jess grammar's expression
family now uses the same semantic rule keys as its public CST node labels:
`Expression`, `ExpressionInterpolation`, `ExpressionQuoted`,
`ExpressionDeclarationReference`, `ExpressionCallArgument`,
`ExpressionReferenceCallTail`, `ExpressionAtom`, `ExpressionProduct`,
`ExpressionSum`, and `ExpressionCompare` instead of `DirectJessExpression*`.
This is a naming cleanup only. Expression arithmetic still belongs only behind
the explicit `$()` boundary, and the expression-only leading-dot declaration
lookup remains in `ExpressionDeclarationReference`.

Evidence for the Jess expression-name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests.
`pnpm --filter @jesscss/jess-parser build` passed after rebuilding
`parser-shared`; `pnpm run check:macro` passed with all parser packages fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. Existing gating warnings in adjacent guard/value families remain
follow-up grammar-shape debt.

Jess static-family name cleanup, 2026-07-29: the folded Jess grammar's static
CSS subgrammar now uses semantic rule keys matching its public CST labels:
`StaticQuoted`, `StaticValueAtom`, `StaticValue`, `StaticCallArgument`,
`StaticCall`, `StaticAtQuery`, `StaticAtPrelude`, `StaticAtRuleHeader`,
`StaticPropertyDescriptor`, `StaticPseudoArgument`, `StaticCompound`,
`StaticComplex`, and `StaticSelector` instead of `DirectJessStatic*`. `Static`
is the real language boundary here: these productions admit the CSS-only static
forms used inside Jess headers, captures, descriptors, and selectors, while
excluding Jess dynamic value/expression forms.

Evidence for the Jess static-family name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/jess-parser build` passed after rebuilding
`parser-shared`; `pnpm run check:macro` passed with parser-shared, CSS, Less,
SCSS, and Jess all fully compiled and 0 interpreter fallbacks; and `pnpm run
verify:compose-integrity` passed. The renamed `StaticValueAtom`,
`StaticAtPreludeTerm`, `StaticAtNonOnlyAtom`, and `StaticAtRuleHeader#0`
warnings are existing left-factor/dispatch-review debt now reported under the
semantic owner names.

Shared opaque at-rule name cleanup, 2026-07-29: parser-shared's preprocessor
opaque capture terminals are no longer mode-labelled `JessAstOpaque*` /
`ScssAstOpaque*`. They are now `JessOpaqueStaticPrelude`, `JessOpaqueBody`,
`ScssOpaqueStaticPrelude`, and `ScssOpaqueBody`, with Jess/SCSS grammar
call-sites updated to consume those semantic keys. The dialect prefixes are
intentional because these captures add preprocessor line-comment skipping and
top-level `$` sentinels beyond the plain CSS opaque capture contract; `Ast` was
the false part.

Evidence for the shared opaque at-rule name cleanup: `pnpm --filter
@jesscss/parser-shared build` passed; `pnpm --filter @jesscss/scss-parser test
-- test/cst-public.test.ts test/ast-grammar.test.ts test/ast-macro-compiled.test.ts
test/compose-integrity.test.ts --reporter=dot` passed 4 files / 104 tests;
`pnpm --filter @jesscss/jess-parser test -- test/cst-public.test.ts
test/ast-grammar.test.ts test/macro-compiled-ast.test.ts --reporter=dot`
passed 3 files / 117 tests; `pnpm --filter @jesscss/scss-parser build` and
`pnpm --filter @jesscss/jess-parser build` passed after rebuilding
`parser-shared`; `pnpm run check:macro` passed with all parser packages fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. The remaining `CssOpaqueCapturePrelude#1`,
`JessOpaqueStaticPrelude#1`, and shared balanced-capture warnings are the
existing bounded-capture/trivia-aware-helper queue, not a naming contract.

Jess root rule name cleanup, 2026-07-29: the stale `JessAstDocument` grammar
alias has been removed. Direct AST parser tests now target `Stylesheet`, which
already matched the public parse entry and public CST default entry. This is an
intentional AST/CST root-name alignment; there is no separate AST-only document
semantic to preserve under a dialect/mode label.

Evidence for the Jess root rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/jess-parser build` passed after rebuilding
`parser-shared`; `pnpm run check:macro` passed with all parser packages fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

Jess value/call rule name cleanup, 2026-07-29: the Jess value-leaf and function
call grammar keys now use semantic names (`Keyword`, `Dimension`, `Color`,
`Url`, `InterpolatedUrl`, `UrlInterpolatedValue`, `CallComponent`,
`CallArgument`, and `Call`) instead of `DirectJess*` mode labels. This aligns
the grammar object names with their already-semantic AST/CST node labels and
with the comparable CSS/Less/SCSS value concepts. The Jess README CST example
was refreshed from built parser output so public docs no longer show
`DirectJessVarDeclaration` / `DirectJessColor` as public node names.

Evidence for the Jess value/call rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/jess-parser build` passed after rebuilding
`parser-shared`; built `parseJessCst("$brand: #3366ff;")` reported
`VariableDeclaration` and `Color` CST node names; `pnpm run check:macro` passed
with all parser packages fully compiled and 0 interpreter fallbacks; and
`pnpm run verify:compose-integrity` passed.

Jess guard/dollar rule name cleanup, 2026-07-29: the Jess mixin-guard and dollar
interpolation/value grammar keys now use semantic names (`GuardValue`,
`GuardCompare`, `GuardCall`, `GuardPrimary`, `GuardAnd`, `GuardOr`,
`MixinGuard`, `DollarValue`, `DollarBrace`, `DollarInterp`, and
`InterpolatedValue`) instead of `DirectJess*` mode labels. This is a naming-only
alignment with the existing semantic node labels; the remaining guard/value
gating warnings now report those semantic names where the underlying grammar
debt still exists.

Evidence for the Jess guard/dollar rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/jess-parser build` passed after rebuilding
`parser-shared`; `pnpm run check:macro` passed with all parser packages fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

Jess reference rule name cleanup, 2026-07-29: the Jess lookup/reference grammar
keys now use the same semantic names as the public AST/CST nodes:
`VariableReference`, `DeclarationReference`, `ReferenceTail`, and
`ReferenceCallTail` instead of `DirectJess*` mode labels. This aligns the
grammar object surface with the declaration/property/member lookup semantics the
AST already exposes: `$name` remains a variable reference unless the
declaration/member ambiguity rules convert it, `$name.member` and `$.member`
remain declaration/member lookup forms, and expression-only leading-dot lookup
continues to live behind the explicit `$()` expression boundary.

Evidence for the Jess reference rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/parser-shared build && pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` passed with
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `git diff --check`
passed. The old `ReferenceTail#1` gating debt now reports under the semantic
rule name instead of `DirectJessReferenceTail#1`.

Jess collection/value rule name cleanup, 2026-07-29: the Jess collection,
ordinary value-grouping, and `!important` grammar keys now use semantic names
(`CollectionEntry`, `Collection`, `ValueAtom`, `ValueSpaceGroup`, `ValueTerm`,
`Value`, and `Important`) instead of `DirectJess*` mode labels. This is a
naming-only alignment with the existing public node labels. Ordinary value
positions still route through `Value`/`ValueTerm`; expression-only arithmetic,
comparison, and leading-dot declaration lookup remain restricted to the
explicit `$()` expression grammar.

Evidence for the Jess collection/value rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/parser-shared build && pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` passed with
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `git diff --check`
passed. The old `DirectJessValueAtom#0/#2` gating debt now reports under the
semantic `ValueAtom#0/#2` rule names.

Jess declaration/block/mixin rule name cleanup, 2026-07-29: the Jess variable
declaration, value-block/lambda, mixin parameter/call/definition, reference
call, `$apply`, and `$extend` grammar keys now use semantic names
(`VariableDeclaration`, `ValueBlockDeclaration`, `BlockLambda`,
`ExpressionLambda`, `ValueBlock`, `MixinParam`, `MixinParams`,
`MixinCallArgument`, `MixinCall`, `ReferenceCall`, `Apply`, `Extend`, and
`MixinDef`) instead of `DirectJess*` mode labels. The public CST labels also
spell out `ExpressionLambda`, `ExpressionCallArgument`, and
`MixinCallArgument` rather than the older `ExprLambda` / `*CallArg`
abbreviations. This is a naming-only cleanup: block-valued assignments still
auto-terminate only at brace-delimited value blocks, expression-bodied lambdas
still require the ordinary declaration terminator, and expression-only forms
remain behind `$()`.

Evidence for the Jess declaration/block/mixin rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/parser-shared build && pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` passed with
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `git diff --check`
passed. Existing argument/value gating debt now reports under
`ExpressionCallArgument` and `MixinCallArgument`.

Jess selector rule name cleanup, 2026-07-29: the Jess selector-family grammar
keys now use the same semantic labels as their AST/CST concepts (`Simple`,
`Parent`, `InterpolatedSimple`, `InterpolatedParentSuffix`, `Attribute`,
`Pseudo`, `GenericPseudoArgument`, `Compound`, `SelectorCapture`,
`ComplexTail`, `Complex`, `SelectorTail`, `Selector`, and `Rule`) instead of
`DirectJess*` mode labels. This is a naming-only alignment. The selector
construct choices remain unchanged and still classify as selector construct
families/contextual selector pieces, not same-opener dispatch candidates.

Evidence for the Jess selector rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/parser-shared build && pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` passed with
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `git diff --check`
passed. Existing selector/pseudo gating debt now reports under
`Pseudo#0/#1/#2` without the old selector-owner prefix.

Jess if/guard rule name cleanup, 2026-07-29: the Jess `$if` condition, guard,
body, and branch grammar keys now use their semantic node labels
(`IfGuardValue`, `IfGuardCompare`, `IfGuardPrimary`, `IfGuardAnd`, `IfGuardOr`,
`IfGuard`, `IfCondition`, `IfBody`, `ElseIfBranch`, `ElseBranch`, and `If`)
instead of `DirectJess*` mode labels. This is a naming-only alignment. `$if`
still owns the stricter historical control-condition grammar and does not reuse
the broader mixin guard language.

Evidence for the Jess if/guard rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/parser-shared build && pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` passed with
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `git diff --check`
passed. Existing `$if` guard gating debt now reports under `IfGuard` and
`IfGuardPrimary` without the old dialect-owner prefix.

Jess quoted/import rule name cleanup, 2026-07-29: the Jess quoted value and
style/module import grammar keys now use semantic AST/CST-aligned labels
(`Quoted`, `StyleImport`, `ModuleSpecifier`, and `ModuleImport`) instead of
`DirectJess*` mode labels. This is a naming-only alignment. Import recognition
still parses static authored paths/specifiers only; plugin/context dispatch
continues to own loading and execution after parse.

Evidence for the Jess quoted/import rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed 3 files / 117 tests;
`pnpm --filter @jesscss/parser-shared build && pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` passed with
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; `pnpm run verify:compose-integrity` passed; and `git diff --check`
passed.

Jess custom/declaration rule name cleanup, 2026-07-29: the Jess custom-property
and ordinary declaration grammar keys now use semantic AST/CST-aligned labels
(`CustomPropertyValue`, `CustomPropertyName`, `CustomPart`, `CustomInnerPart`,
`CustomParen`, `CustomSquare`, `CustomCurly`, `CustomValue`,
`CustomDeclaration`, `InterpolatedProperty`, and `Declaration`) instead of
`DirectJess*` mode labels. This is a naming-only alignment. The custom-property
value capture remains the same bounded grammar recursion through balanced
groups, strings, comments, and Jess interpolation; the local routed
`RoutedCustomPropertyValue` helper is private to the existing keyword dispatch.

Evidence for the Jess custom/declaration rule name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts --reporter=dot` passed with 3 files and 117
tests; `pnpm --filter @jesscss/parser-shared build` passed; `pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` reported
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; and `pnpm run verify:compose-integrity` passed.

Jess at-rule/keyframe name cleanup, 2026-07-29: the Jess CSS-compatible
at-rule, supports, import, registered-property, keyframe, scope, and opaque
grammar keys now use semantic AST/CST-aligned labels (`MediaPrelude`,
`AtRuleHeader`, `SupportsAtom`, `SupportsNot`, `SupportsLogical`,
`SupportsFeature`, `SupportsInParens`, `SupportsCondition`,
`ImportTailFunction`, `CssImportPrelude`, `Charset`, `CssImport`,
`SupportsAtRuleBlock`, `PropertyName`, `PropertyAtRule`, `KeyframeSelector`,
`KeyframeBlock`, `Keyframes`, `OpaquePrelude`, `OpaqueBody`,
`OpaqueAtRuleBlock`, `ScopeBlock`, `AtRuleBlock`, and `AtRuleStatement`)
instead of `DirectJess*` mode labels. The shared body helpers were renamed to
`atBlockStatement` and `nestedBodyStatement`. This is a naming-only alignment:
statement/body arms remain construct-family `choice(...)` clusters, while the
CSS import tail keeps its existing `dispatch(...)` over the `supports`/`layer`
function-name family. The `GeneralTemplate` / `GeneralQuotedTemplate` chains
remain a separate, documented strict-vs-permissive cleanup surface.

Evidence for the Jess at-rule/keyframe name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 118 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/jess-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. The previous at-rule/supports/import gating warnings now report under
semantic rule names such as `AtRuleHeader`, `MediaPrelude`,
`SupportsCondition`, and `CssImportPrelude`.

Jess general-enclosed template name cleanup, 2026-07-29: the final Jess
`DirectJess*` grammar keys now use semantic AST/CST-aligned labels
(`GeneralTemplate`, `GeneralTemplateParen`, `GeneralTemplateSquare`,
`GeneralTemplateBrace`, `GeneralTemplateDoubleQuoted`,
`GeneralTemplateSingleQuoted`, `GeneralQuotedTemplate`,
`GeneralQuotedTemplateParen`, `GeneralQuotedTemplateSquare`,
`GeneralQuotedTemplateBrace`, `GeneralQuotedTemplateDoubleQuoted`,
`GeneralQuotedTemplateSingleQuoted`, and `GeneralEnclosed`). This is a
naming-only alignment. The strict general-enclosed chain still excludes Jess
`Expression`; the quoted permissive chain still includes it. The local
`choice(...)` clusters remain literal delimiter wrappers and token-template
segment families, not dispatch candidates, because no single already-consumed
token routes known cases plus a same-family generic fallback.

Evidence for the Jess general-enclosed template name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 118 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/jess-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

Jess parser-local source vocabulary cleanup, 2026-07-29: the remaining
lowercase `directJess*` helper names were renamed to semantic local names
(`quotedExpressionParser`, `quotedExpressionInterpolationParser`,
`escapedStaticQuoted`, `plainDoubleQuoted`, `plainSingleQuoted`,
`moduleBindingName`, `moduleAsClause`, `styleImportAsClause`,
`attributeDoubleQuoted`, `attributeSingleQuoted`, `selectorCombinator`,
`nonBlockValueAtom`, `assignHead`, `mixinNameToken`, and
`lambdaParamsParser`), and stale "Direct Jess" reducer diagnostics now use
plain Jess wording. This is a naming-only alignment: no grammar branch,
CST/AST node label, reducer shape, or comment trivia behavior changed.

Evidence for the Jess parser-local source vocabulary cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 118 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/jess-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

Jess parser-local interpolation-guard vocabulary follow-up, 2026-07-29: the
remaining generic lowercase `direct*` helper names in the Jess grammar were
renamed to semantic guard names (`interpolatedSimpleAhead`,
`interpolatedParentSuffixAhead`, and `interpolatedPropertyAhead`), and nearby
comments now describe host-mode grammar construction / AST reduction rather
than a direct parser mode. This is a source-only naming alignment: no grammar
branch, CST/AST node label, regex body, reducer shape, or comment trivia
behavior changed. The touched sites were not dispatch candidates; they are
zero-width context predicates that keep ordinary selector/property arms from
entering interpolation-only productions unless a `$[` or `${` opener appears
in the same syntactic span.

Evidence for the Jess parser-local interpolation-guard vocabulary follow-up:
`pnpm --filter @jesscss/jess-parser test -- test/cst-public.test.ts
test/ast-grammar.test.ts test/macro-compiled-ast.test.ts
test/compose-integrity.test.ts --reporter=dot` passed with 4 files and 118
tests; `pnpm --filter @jesscss/parser-shared build` passed; `pnpm --filter
@jesscss/jess-parser build` passed; `pnpm run check:macro` reported
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; and `pnpm run verify:compose-integrity` passed. `rg` now finds no
lowercase direct-mode helper names in
`packages/syntax/jess/jess-parser/src/grammar.ts`.

Jess parser-local fact-name cleanup, 2026-07-29: Jess reducer-only fact types
and guards now use semantic local names (`OperatorFact`, `ReferenceTailFact`,
`ComplexTailFact`, `StaticAtQueryPropertyFact`, `AtRuleHeaderFact`, and
`MixinCallArgumentFact`) instead of `Jess*`-prefixed names. This is a
source-only naming alignment: public grammar/CST labels such as
`ReferenceTail`, `ComplexTail`, `AtRuleHeader`, and `MixinCallArgument` did not
change, and AST reducer output/acceptance stayed unchanged. The touched
`choice(...)` sites were not rewritten in this slice; they remain existing
expression/reference/selector construct and context choices, not routed
token-family dispatch candidates. This does not classify every surviving
`Jess*` source identifier as migration debt; real dialect-owned concepts still
need the ordinary const-level review.

Evidence for the Jess parser-local fact-name cleanup: `pnpm --filter
@jesscss/jess-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 118 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/jess-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

SCSS custom/declaration rule name cleanup, 2026-07-29: the SCSS declaration and
custom-property grammar keys now use semantic AST/CST-aligned labels
(`InterpolatedProperty`, `CustomPropertyName`, `CustomPart`, `CustomInnerPart`,
`CustomParen`, `CustomSquare`, `CustomCurly`, `CustomValue`,
`CustomDeclaration`, and `Declaration`) instead of `DirectScss*` mode labels.
This is a naming-only alignment. The custom-property value capture still owns
the same bounded CSS declaration-value stream with nested groups, quoted
strings, comments, and SCSS interpolation.

Evidence for the SCSS custom/declaration rule name cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 104 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/scss-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

SCSS selector/rule name cleanup, 2026-07-29: the SCSS selector-family grammar
keys now use their semantic AST/CST-aligned labels (`Simple`,
`InterpolatedSimple`, `Placeholder`, `Attribute`, `PseudoArgument`, `Pseudo`,
`NestingSelector`, `Compound`, `ComplexTail`, `Complex`, `SelectorTail`,
`Selector`, `Extend`, and `Rule`) instead of `DirectScss*` mode labels. The
selector-private routed pseudo helpers were renamed too. This is a naming-only
alignment; the pseudo dispatch table remains the same routed-token-family shape
over the glued `:name` / `:name(` opener, and selector body choices remain
construct-family choices.

Evidence for the SCSS selector/rule name cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 104 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/scss-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. The previous selector compound gating warning now reports under the
semantic `Compound` rule name.

SCSS at-rule/keyframe name cleanup, 2026-07-29: the SCSS CSS-compatible
at-rule and keyframe grammar keys now use their semantic AST/CST-aligned labels
(`AtRuleStatement`, `ScopeBlock`, `NestedScopeBlock`, `ConditionalBlock`,
`StartingStyleBlock`, `LayerBlock`, `DocumentBlock`, `PageMarginBox`,
`PageBlock`, `FontFeatureValueBlock`, `FontFeatureValuesBlock`,
`NestedConditionalBlock`, `NestedStartingStyleBlock`, `NestedLayerBlock`,
`FontFace`, `CounterStyle`, `PropertyName`, `PropertyAtRule`,
`KeyframeSelector`, `KeyframeBlock`, and `Keyframes`) instead of
`DirectScss*` mode labels. This intentionally lets SCSS override the shared CSS
semantic names where the same concept needs an SCSS body/header policy. The body
lists stay as `choice(...)` construct-family choices because the decision is a
statement/body item family, not one already-consumed routed token. The
comment-as-trivia and opaque/raw-capture names remain separate cleanup queues.

Evidence for the SCSS at-rule/keyframe name cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 104 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/scss-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

SCSS opaque at-rule name cleanup, 2026-07-29: the remaining SCSS opaque/raw
capture grammar keys now use their semantic AST/CST-aligned labels
(`OpaquePrelude`, `OpaqueBody`, `OpaqueAtRuleBlock`, and
`OpaqueAtRuleStatement`) instead of `DirectScss*` mode labels. This is a
naming-only alignment: the shared recognition artifact still owns the bounded
balanced/string/comment capture, and the statement-vs-block split remains a
construct-family `choice(...)` at each body position because `{` vs `;` is the
local tail decision after the generic at-keyword. After this pass, the comment
grammar key remained the last uppercase `DirectScss*` cleanup surface; that is
now handled by the SCSS comment name cleanup below.

Evidence for the SCSS opaque at-rule name cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 104 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/scss-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

SCSS comment grammar-key cleanup, 2026-07-29: the SCSS block-comment grammar key
now uses the semantic AST/CST-aligned label `Comment` instead of
`DirectScssComment`. This is a naming-only alignment: the public CST label was
already `Comment`, block comments still produce renderable `Comment` AST nodes,
and `//` line comments remain lexical trivia through `whitespace`. The touched
body/list `choice(...)` sites remain construct-family choices because comment
items are disjoint `/`-led grammar facts, not a routed token family with a
same-family generic fallback.

Evidence for the SCSS comment grammar-key cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 104 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/scss-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

SCSS parser-local source vocabulary cleanup, 2026-07-29: the remaining
lowercase `directScss*` helper names were renamed to semantic local names
(`keyframeSelectorListFromChildren`, `interpolatedUrlChunk`, and
`propertyNameChunk`), and stale "Direct SCSS" reducer diagnostics/comments now
use plain SCSS wording. This is a naming-only alignment: no grammar branch,
CST/AST node label, reducer shape, or comment trivia behavior changed.

Evidence for the SCSS parser-local source vocabulary cleanup: `pnpm --filter
@jesscss/scss-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/ast-macro-compiled.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 4 files and 104 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/scss-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed.

SCSS parser-local direct-mode vocabulary follow-up, 2026-07-29: the remaining
generic lowercase `direct*` helper names in the SCSS grammar were renamed to
semantic local names (`doubleQuotedText`, `singleQuotedText`,
`staticDoubleQuotedPath`, `staticSingleQuotedPath`,
`nestedPropertyBlockAhead`, `mixinNameToken`, and
`mixinParamSigilName`), and neighboring comments now describe host-mode AST
facts, public parse behavior, or the actual syntax slice instead of a direct
parser mode. This is a source-only naming alignment: no grammar branch,
CST/AST node label, regex body, reducer shape, or comment trivia behavior
changed. The touched `choice(...)` sites were not rewritten; quoted/static
path arms remain delimiter-family choices, the nested-property gate remains a
zero-width context predicate, and mixin arguments still depend on later `:` /
`...` facts rather than one routed opener token.

Evidence for the SCSS parser-local direct-mode vocabulary follow-up:
`pnpm --filter @jesscss/scss-parser test -- test/cst-public.test.ts
test/ast-grammar.test.ts test/macro-compiled-ast.test.ts
test/compose-integrity.test.ts --reporter=dot` passed with 3 files and 102
tests; `pnpm --filter @jesscss/parser-shared build` passed; `pnpm --filter
@jesscss/scss-parser build` passed; `pnpm run check:macro` reported
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; and `pnpm run verify:compose-integrity` passed. `rg` now finds no
lowercase direct-mode helper names in
`packages/syntax/scss/scss-parser/src/grammar.ts`; remaining matches are
ordinary Sass module "directive(s)" wording.

SCSS value/mixin argument semantic-name cleanup, 2026-07-29: the SCSS value atom
and mixin call argument grammar keys now use the cross-dialect semantic labels
`ValueAtom` and `MixinCallArgument` instead of the temporary
`ScssValueAtom` / `ScssMixinCallArg` labels. The related parser-local reducer
fact types were renamed to `ValuePairFact`, `ValueTailFact`,
`MixinCallArgumentFact`, and `ComplexTailFact`. This intentionally changes the
public CST rule labels toward the AST/CST naming alignment target while keeping
the same AST reducers and accept set. The touched `choice(...)` clusters remain
construct/context choices: `ValueAtom` chooses between distinct value atom
constructs, `MathUnary` preserves the existing sign/context split, and
`MixinCallArgument` still needs a later `:` / `...` fact to distinguish named,
spread, and positional arguments, so it is not a routed token-family dispatch
candidate.

Evidence for the SCSS value/mixin argument semantic-name cleanup: `pnpm
--filter @jesscss/scss-parser test -- test/cst-public.test.ts
test/ast-grammar.test.ts test/ast-macro-compiled.test.ts
test/compose-integrity.test.ts --reporter=dot` passed with 4 files and 104
tests; `pnpm --filter @jesscss/parser-shared build` passed; `pnpm --filter
@jesscss/scss-parser build` passed; `pnpm run check:macro` reported
parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0 interpreter
fallbacks; and `pnpm run verify:compose-integrity` passed. The previous
`ScssMixinCallArg` gating warning now reports under semantic
`MixinCallArgument`.

CSS at-rule prelude scanner-skip cleanup, 2026-07-29: CSS `AtPreludeGroup`
now relies on the grammar-level ambient `scanSkip` / trivia policy for balanced
paren and square groups instead of restating local
`balanced(..., { skip: [...] })` lists. This keeps the structured unknown
at-rule prelude route as the model: comments and quoted strings are not
semantic prelude children, but they also do not terminate a balanced group. The
touched `choice(...)` remains a delimiter-family choice between `(...)` and
`[...]`; it is not a dispatch candidate because no routed known/generic token
family is involved.

Evidence for the CSS at-rule prelude scanner-skip cleanup: `pnpm --filter
@jesscss/css-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 2 files and 102 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/css-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. A narrow A/B parser workload over generic at-rule statements with
grouped preludes measured the old local-skip shape at 50.324 ms median and the
ambient-skip shape at 48.141 ms median for 160 parses on the same dirty
worktree; treat this only as route sanity, not a general parser speed claim.

CSS query-function scanner-skip cleanup, 2026-07-29: CSS `QueryFunction` and
`RoutedQueryFunction` now keep only the local nested-parenthesis exception in
their raw argument `scanTo(...)` skip lists. Comment, escape, and quoted-string
protection comes from grammar-level trivia / ambient `scanSkip`, which
`scanTo(...)` already resolves before explicit skips. This is a scanner-policy
deletion inside the existing structured query route, not a dispatch rewrite:
the routed function opener is already owned by `queryIdentOrFunctionTerm` /
`RoutedQueryFunction`, and the raw argument span remains the narrow accepted
representation for general-enclosed query functions.

Evidence for the CSS query-function scanner-skip cleanup: `pnpm --filter
@jesscss/css-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 2 files and 102 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/css-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. Existing parseman gating warnings remain visible for broader queue
items such as balanced groups, opaque prelude capture, and several CSS construct
choices; this slice makes no broad speed claim.

CSS custom/value scanner-skip cleanup, 2026-07-29: the shared CSS
`balancedParens`, `balancedBrackets`, and `balancedBraces` helpers now keep only
their local `customSlash` exception and inherit comment, escape, and quoted
string protection from grammar-level `scanSkip`. The custom-property value,
import-tail group, var()-fallback, and raw parenthesized-value scans now list
only the nested balanced groups that are local to those opaque spans, or no
explicit skip at all when ambient `scanSkip` is sufficient. This relies on
Parseman 0.41.0's documented scanner contract: `scanTo(...)` merges grammar
trivia plus ambient `scanSkip`, and `balanced(...)` merges ambient `scanSkip`
unless the combinator is raw. It is still scanner-local cleanup for accepted
opaque CSS component text, not a replacement for future structured parsing
where a value family can be grammar-owned instead.

Evidence for the CSS custom/value scanner-skip cleanup: `pnpm --filter
@jesscss/css-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 2 files and 102 tests; `pnpm --filter @jesscss/parser-shared
build` passed; `pnpm --filter @jesscss/css-parser build` passed; `pnpm run
check:macro` reported parser-shared, CSS, Less, SCSS, and Jess all fully
compiled and 0 interpreter fallbacks; and `pnpm run verify:compose-integrity`
passed. This slice makes no broad speed claim.

Less ambient scanner-skip cleanup, 2026-07-29: Less `lessOpaqueBodyBrace`,
`lessOpaqueBodyCapture`, and `atPreludeGroup` now inherit comment and quoted
string protection from the grammar-level `scanSkip` declared on every Less AST,
line, and CST artifact. `lessOpaqueBodyCapture` keeps only the nested
`lessOpaqueBodyBrace` scanner-local exception; `atPreludeGroup` keeps no local
skip list because the balanced group combinators can inherit ambient scan
skips. This is the Less version of the CSS ambient-skip cleanup: scanner-local
cleanup for still-accepted opaque/prelude spans, not a claim that those spans
are the final structured grammar target.

Evidence for the Less ambient scanner-skip cleanup: `pnpm --filter
@jesscss/less-parser test -- test/cst-public.test.ts test/ast-grammar.test.ts
test/macro-compiled-ast.test.ts test/compose-integrity.test.ts --reporter=dot`
passed with 2 files and 261 tests; dependency-order `pnpm --filter
@jesscss/parser-shared build`, `pnpm --filter @jesscss/css-parser build`, and
`pnpm --filter @jesscss/less-parser build` passed; `pnpm run check:macro`
reported parser-shared, CSS, Less, SCSS, and Jess all fully compiled and 0
interpreter fallbacks; and `pnpm run verify:compose-integrity` passed. The Less
byte-identity oracle remains red on the current dirty integration surface, but
an A/B check that temporarily restored only the old local skip lists produced
the same aggregates as the cleaned shape:
`ast=c00bbb9033f8b99fd8f6a280fb264c017f7601dce96e914035e75c46bb514a37`
with 117 throws and
`cst=591d44a6f0c4608459903c221c210684bac332161b0d901b0c1fc3caa5cee714`
with 0 throws. Treat the oracle red as pre-existing dirty-surface movement, not
movement from this scanner-skip slice. This slice makes no broad speed claim.

Grammar lint layout update, 2026-07-27: the grammar ESLint floor no longer
enforces `@stylistic/function-paren-newline` or
`@stylistic/function-call-argument-newline` in grammar sources. Short Parseman
calls with short arguments may stay on one line when that is the clearest shape;
larger productions should expand because the grammar reads better that way, not
because an argument-newline rule forced every call into vertical form. The
correctness/reviewability rules remain active: no line comments in grammar
sources outside the temporary Less carve-out, no literal non-ASCII regex ranges,
no regex outside combinators, and no macro hazards. Evidence:
`pnpm exec eslint eslint.config.mjs eslint.measure.config.mjs` passed.

Less current parse-performance datapoint, 2026-07-27: after
`pnpm --filter @jesscss/less-parser build`, the command
`BENCH_CASES=benchmark.less,bootstrap-port,test-data-unit,css-corpus-ok,css-corpus-err,css-corpus-ok-joined node packages/syntax/less/less-parser/test/parse-bench.mjs less-current-2026-07-27 4 12`
reported these medians: `benchmark.less` 21.8951 ms AST / 16.5792 ms CST;
`bootstrap-port` 43.0102 ms AST / 36.9098 ms CST; `test-data-unit` 43.1909 ms
AST / 36.4926 ms CST; `css-corpus-ok` 1.8392 ms AST / 1.5769 ms CST;
`css-corpus-err` 0.0543 ms AST / 0.0465 ms CST; and `css-corpus-ok-joined`
1.7777 ms AST / 1.6566 ms CST. This is a current-state sanity datapoint, not an
A/B proof. The matching `pnpm run check:macro` pass reported parser-shared, CSS,
Less, SCSS, and Jess fully compiled with 0 interpreter fallbacks; Less reported
3512 `charCodeAt` vs 304 `RegExp.exec`.

Dispatch pressure update, 2026-07-27: continue converting shared-opener routes
to `dispatch(...)`/`routed()` only where the branch can reuse the consumed
discriminator instead of reparsing the same lexical shape. Less value-position
identifier/function routing and query identifier/function routing already use
that canonical pattern. Some remaining macro gating warnings are instead
left-factoring or nullable-prefix work: Less custom property names share a `--`
prefix between static and interpolated spellings; Less query features share
opening `(` and need a better decisive inner route; and several opaque capture
rules are waiting on a future structural capture helper rather than a cosmetic
dispatch wrapper. Do not wrap these in `dispatch(...)` just to silence a
warning; use dispatch when it expresses real grammar routing.

Comment cleanup status, 2026-07-27: function-boundary comments in Less are now
trivia, and public parse tests assert serialization comes from trivia rather
than `Comment` value nodes. The remaining explicit comment facts are ordinary
value/query/comment-head debt: `ValueComment`, `QueryComment`, declaration-head
comment facts, and SCSS/Jess comment productions still need family-by-family
removal. The target is comments in Parseman/core trivia, with render-time
empty-rule behavior fixed against trivia spans instead of comment AST children.
Avoid half-measures that merely hide comments inside separator text; the end
state is no semantic comment nodes for parser comments.
