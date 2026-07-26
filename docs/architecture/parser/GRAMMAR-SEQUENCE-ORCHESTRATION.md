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
`parseman` is pinned to `0.39.1` in the root manifest, `@jesscss/parser-shared`,
and all four parser package dev dependencies; parser package peer ranges now
require `^0.39.1`. `pnpm-lock.yaml` resolves parseman to `0.39.1`.

The 0.39 floor includes the earlier architecture features (`hostMode`, `peek`,
`oneOrMoreSep`, `analyzeGatingRules`, `analyzeDuplicationRules`) plus the
keyword ergonomics needed for grammar cleanup:
`word(str, { caseInsensitive: true })`,
`word(str, boundary, { caseInsensitive: true })`, and
`makeWord(boundary?, { caseInsensitive: true })`. Defaults remain
case-sensitive across the API. Parseman 0.39.1 also provides the complete
grammar-routing surface this rebuild should use:
`dispatch(combinator, when(...), otherwise(...))`,
`when(..., { caseInsensitive: true })`, `makeWhen(...)`, string-array cases,
matcher cases such as `when(endsWith('('), tail)`, and `routed()`.

Use dispatch when one grammar position accepts a broad token shape and then
routes by the value already consumed. The routing combinator is ordinary
Parseman grammar: it should consume the smallest decisive token shape once, and
the branch table should decide what tail owns that matched value. The generic
case belongs inside the same
`dispatch(...)` through `otherwise(...)`; do not keep a separate outer generic
`choice(...)` arm for the same token family. A matched `when(...)` commits to its
tail, so malformed known syntax does not fall through to generic syntax.

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
caseInsensitive: true })`. Case matching is exact equality on the full selector
value after the requested comparison mode; it is never prefix matching. That
means `url(` can route to the URL tail while `url (` cannot match that case.
The selector still has to preserve the authored spelling and span needed by
AST/CST construction.

The broader Parseman design target is lexical-shape dispatch: consume the
smallest decisive token shape once, then route on that whole value. For CSS
identifier/function positions, the selector should consume either an ident
(`red`) or a glued function opener (`url(`) in one pass:

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

The current grammar file count is **seven** after the CSS fold: CSS now has one
source grammar, while Less, SCSS, and Jess still each have separate CST and AST
grammar files.

| dialect | CST lines | AST lines |
| --- | ---: | ---: |
| css | 3635 | deleted |
| less | 1281 | 4750 |
| scss | 1379 | 5116 |
| jess | 1210 | 5587 |

This makes the remaining target concrete: seven files must become four, not
merely smaller helper files beside the old dialect AST/CST split.

Current gate evidence for the CSS fold: after dependency-ordered
parser-shared/CSS rebuilds, `pnpm run oracle:less:byte-identity` is green against
the updated 709-entry fold baseline:
`ast=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`
with 120 throws, and
`cst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`
with 0 throws. The final six CST residue entries were classified as CSS-fold
public CST/conformance residue before updating the baseline: three Less parse
error fixtures, `node_modules/@less/test-data/tests-unit/urls/actual.css`, and
two CSS error fixtures (`atrule-no-semicolon.css`, `charset.css`).

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
| Fold-first-then-polish | Produces the visible eight-to-four event quickly and stops agents from improving grammar bodies that are about to be deleted. | If treated as a blind paste, it can entrench old AST reducer machinery and obsolete combinator shapes inside the new public grammar. | Working strategy. Fold each dialect into one hostMode factory first, preserving correctness; then polish only the surviving grammar. |
| Incremental rule-family redesign before fold | Balances byte identity with grammar quality: each family can be stated from the spec, rewritten to the best available Parseman idiom, and gated before moving on. | It doubles work while AST and CST grammars are still duplicated, and it delays the actual eight-to-four objective. | Use only inside an already-folded dialect or for a small recognition fix that directly blocks the fold. |

## Stale or risky assumptions

- Older sections of `GRAMMAR-REBUILD-SPEC.md` still preserve 0.37/0.38 planning
  history. The current manifests supersede that history: `0.39.1` is pinned,
  `hostMode` and `dispatch(...)` exist, and the architecture floor is paid.
- CSS Phase A disproved the early "AST grammar is mostly deletable reducer
  noise" diagnosis. The deletable part was small: the local typed rule
  interface and redundant `node<T>()` generics. Most helper and reducer logic is
  currently load-bearing for byte identity.
- CSS Phase B disproved a 1:1 rule-map assumption. The CST grammar exposes
  public unprefixed keys consumed by Less/Jess, while the AST grammar splits
  many of the same language families into private `CssAst*` rules.
- The Stage 2.3 Parseman combinator cheat sheet does not exist. Agents should
  verify the installed Parseman API locally before using new features, and this
  cheat sheet should land as a parallel doc-only batch.
- Coverage remains a decision aid, not a completed gate. The byte-identity
  oracle is the hard gate for collapse batches; it does not prove a future
  semantic tightening is correct.

## Working sequence

1. **CSS folded; do not keep polishing it before dialect repair.** CSS now has
   one `src/grammar.ts`, one `cssFactory`, and two macro-compiled host outputs:
   `cssGrammar` / `cssAstGrammar` for AST mode and `cssCstGrammar` for CST
   mode. The Less byte-identity oracle is green for this folded CSS baseline.
   The remaining CSS work is review debt and Parseman idiom cleanup, not a
   reason to delay the dialect folds. Any surviving known-or-generic at-rule,
   function, pseudo, contextual-keyword, or dialect-extension router should be
   rewritten with `dispatch(...)` during the fold or the first surviving-grammar
   cleanup batch unless a written const-level review proves a different Parseman
   combinator is the better shape.
2. **Less next.** The current Less CST bridge has already been made
   self-contained enough to build against CSS' terminal leaf output. Less now
   has the direct AST grammar body physically in `src/grammar.ts`; the old
   `src/ast/grammar.ts` is only a compatibility re-export, and `src/index.ts`
   plus the AST grammar tests import `lessAstGrammar` from the real grammar
   module. This is a necessary fold step, but not completion: `src/grammar.ts`
   still carries the old CST bridge and the direct AST factory as separate
   bodies. Fixing Less means deleting that duplicated body shape by making one
   Less-owned grammar factory compile twice via `hostMode`, not polishing the
   soon-to-be-deleted duplicate. Less-specific deviations from CSS placement
   rules, such as nested at-rule acceptance and stylesheet ordering, must be
   explicit and self-documenting. Less should stop preserving SCSS-only grammar
   seams immediately: if cutting those seams turns the current SCSS suite red,
   that is acceptable evidence that SCSS was inheriting Less accidentally. SCSS
   gets repaired in its own pass as a CSS/preprocessor sibling, and only grammar
   pieces proven useful to multiple dialects should move into
   `@jesscss/parser-shared`.
   Current build-shape guard: `tsdown.config.ts` uses `unbundle: true` so the
   large folded grammar remains the direct `@jesscss/less-parser/grammar` entry
   instead of splitting into a non-build-resolvable shared chunk. Evidence after
   the AST-body move: `pnpm --filter @jesscss/css-parser build` rebuilt the CSS
   dependency artifacts; `pnpm --filter @jesscss/less-parser test --
   ast-grammar.test.ts cst-public.test.ts macro-compiled.test.ts --run` passed
   (3 files / 232 tests);
   `pnpm run oracle:less:byte-identity` remained byte-identical over the
   709-entry baseline
   (`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
   `aggCst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`;
   AST threw 120, CST threw 0); and `pnpm run check:macro` reports
   parser-shared, CSS, and Less fully compiled with 0 interpreter fallbacks.
   The repo-wide macro gate still fails later because SCSS is missing
   `CalcCall` in its current compose surface and Jess still has its pre-existing
   non-build-resolvable compose input.
3. **SCSS as a sibling, not a Less child.** The dialect architecture doc's
   `preprocessorBase` direction is compatible with the four-grammar rewrite:
   shared sigil-neutral preprocessor machinery belongs between CSS and the
   dialect deltas. Do not keep Less syntax broad to make today's SCSS compose
   surface pass. Rebuild SCSS deliberately, then lift only demonstrated common
   syntax into `parser-shared`; do not pre-abstract speculative Less/SCSS/Jess
   overlap.
4. **Jess last.** Reuse the CSS/preprocessor concepts and keep only Jess-specific
   syntax. Do not copy Less/SCSS shapes unless they are shared language, and name
   shared seams without dialect or mode prefixes.

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
| Value-position numeric | `numeric = node('Numeric', noTrivia(sequence(numPart, optional(unitRegex))))`, with `cssCstBuildHost` remapping `Numeric` to public `Dimension` or `Num` | Same AST reducer as `Dimension` | `Numeric` as an internal shared recognizer, `Dimension` as AST value | Preserve the existing unified-recognizer idea; it is already the Parseman-style simplification. |

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

This is a prerequisite, not the fold. `parse()` still imports
`./ast/grammar.js`, while CST parsing still imports `./grammar.js`; the branch
therefore still has separate module-local `cssFactory` owners. The next
shared-family patch has to move rules into a single final owner, not compose an
imported direct-builder artifact ahead of the AST grammar.

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

Recommended next implementation batch:

1. Move `Quoted`, `Url`, and their immediate unquoted URL helper into a single
   shared final owner now that both current factories are macro-visible by name.
   The shared direct builders must live in the final local `rules(...)` map that
   Parseman can lower; do not try to prove this through a pre-final imported
   builder artifact.
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
4. The AST-side public-key slice has landed: the final CSS AST factory now owns
   `Quoted` and `Url` under unprefixed names, and CSS AST callsites use
   `g.Quoted` / `g.Url`. Do not treat that as the complete hostMode fold; the
   remaining work is to converge those owners with the CST artifact without
   seeding direct builders onto `cssCstGrammar`.
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

Conclusion: `Quoted`/`Url` is still the right first semantic family, but the
hostMode fold has to occur in one final owner with the dialect CST composition
story handled in the same batch. A pre-final imported direct-builder artifact,
a standalone AST-key rename, and CST-builder seeding are not viable pilot shapes
in Parseman 0.37.

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
spelling them out. `SelectorList`, keyframe selector lists, value comma lists,
and query/supports comma lists now use `oneOrMoreSep(...)` where the separator
is a real token. `ComplexSelector` deliberately does not use `oneOrMoreSep`,
because a descendant combinator is ambient trivia between compound selectors;
there is no literal separator token for Parseman to own. Keyword-boundary regexes
that merely spelled a word (`of`, `not`, `and`/`or`, and known at-keywords) were
converted to `word(...)` or `keywords(...)`; regexes that encode non-keyword
lookahead or reserved-name logic remain as regexes.

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

Latest CSS direct-AST function-argument cleanup: the direct CSS AST grammar now
names the generic glued function opener by its actual contract,
`nonCalcFunctionOpen`, because `calc(...)` is exclusively owned by the strict
calc grammar. Generic value calls, declaration calls, declaration identifier
function arms, the generic `Value`, and `DeclarationExtendedValue` now share one
`authoredValueComma` separator, with shared value/declaration function argument
combinators. The calc `var()` fallback empty sentinel now uses `peek(',')` /
`peek(')')` instead of a regex lookahead, and fallback comma trivia is factored
as `varFallbackComma`.

Rejected in this pass: collapsing `DeclarationCall` into
`DeclarationIdent`, because the top-level declaration call has URL routing
and declaration-value fallback responsibilities that should move only in a
larger value-family review. Also rejected: converting calc `var()` fallback
lists to `oneOrMoreSep(...)`. The fallback item can intentionally be zero-width
for leading, trailing, and interior empty fallback components, so the manual
`item (comma item)*` shape remains the clearest truthful grammar until Parseman
has a nullable-item-aware separator-list primitive.

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

This is also the nearest safe preparation for the future Parseman dispatch
rewrite: current known at-rule choices now have named frame tails that can later
be placed behind `when(...)` cases. Do not rewrite these choices to dispatch
until Parseman 0.39 is merged/released and Jess pins it; the current positive
known arms plus `UnknownAtRuleBlock` negative guard still express the known-vs-
generic commitment until that dependency exists. The next CSS at-rule work
should either be the direct-AST counterpart of this frame-tail factoring or the
actual dispatch migration after the dependency pin, not another regex-to-word
surface pass over at-rule keywords.

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
and without depending on the future Parseman dispatch primitive.

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

This replaces the older `nestedTransparentBlock` / `topTransparentBlock` /
expected-transparent names and reuses the same body tails for `@scope` and
`@document`, which had still been restating those sequences inline. The grammar
comments at the call sites still say which at-rules are transparent; the
combinator names now say what bytes they recognize. That is the better
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
unchanged: nested `var()` / fallback calls still win before ordinary value atoms
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
uses `oneOrMoreSep(...)` for the two non-empty comma-separated value wrappers:
generic `Value` and `DeclarationExtendedValue`. Both keep the same fielded
separator combinator, so reducers still receive authored comma/trivia facts
through `fields.separator`, and separators do not become value children. This is
the direct-AST counterpart of the public CST value-list cleanup: a comma is a
real list separator, so the grammar should say that directly instead of spelling
`sequence(first, many(sequence(separator, next)))`.

Rejected in the same review: changing the adjacent/space-separated term wrappers
(`ValueTerm`, `DeclarationValueTerm`, and calc fallback terms) to a
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
`Value*`. Superseded 2026-07-26 for rule keys: declaration, calc, and `var()`
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

Historical Parseman note, superseded by the 0.39.1 pin described in the Current
floor: 0.38 unlocked case-insensitive `word(...)` / `makeWord(...)`; 0.39 added
the built-in dispatch primitive; 0.39.1 added the helper/matcher/routing
refinements needed by the grammar cleanup. The current guidance is simple:
consume the decisive token shape once, route it with `dispatch(...)`, and keep
the generic continuation in `otherwise(...)`. Do not invent CSS-local
`dispatchByAtKeyword(...)` helpers or hide this shape behind `choice(...)`
ordering.

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

The Parseman API deliberately avoids object maps here: case keys can be arbitrary
strings, and a literal `default` can be an ordinary token value. It also avoids a
general key callback. If a grammar needs shape routing after a token is read,
use matcher cases such as `endsWith('(')`; if a branch node needs the
already-consumed token/span, use `routed()`.

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

Minimal Parseman test plan before Jess depends on this primitive:

- interpreter / `compile()` / macro parity for `dispatch(wordOrToken,
  when(...), otherwise(...))`;
- arbitrary string keys, including strings that would be awkward object keys and
  a literal `"default"` key;
- case-insensitive normalization with duplicate-key rejection;
- selector-token success with unmatched key takes `otherwise(...)`;
- selector-token failure fails the dispatch without trying any tail;
- matched key with failing tail does not fall through to `otherwise(...)` or to
  an enclosing `choice(..., genericAtRule)`;
- escaped CSS at-keyword spelling classifies by normalized token value while the
  authored token bytes/spans remain available to the grammar output; `@scopeish`
  and `@scopeé` remain unmatched known cases under the chosen CSS token
  boundary;
- grouped cases (`when(['@font-face', '@property'], descriptorTail)`) share one
  tail without changing CST child shape;
- composed and macro-fused grammar use, including an alias/ref to the selector
  token and an alias/ref to a recursive tail, must either compile correctly or
  produce a deterministic build-time error rather than an interpreter fallback.

Evidence for today's floor bump and small pseudo-keyword cleanup: npm reported
`parseman` latest as `0.38.0`; package-local resolution checks reported
`0.38.0` for parser-shared and all four parser packages; the focused CSS AST
suite passed (1 file / 79 tests); `pnpm run check:macro` passed with all parser
packages fully compiled and 0 interpreter fallbacks; `pnpm run
verify:compose-integrity` passed; and `pnpm run oracle:less:byte-identity`
passed byte-identical to the current 709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`).

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

`parseman@0.39.1` is the pinned Jess grammar floor. Treat dispatch as a current
authoring primitive, not a future dependency. Use it wherever a broad consumed
token shape decides between known tails and a generic continuation.

Core semantics:

- `dispatch(combinator, ...arms)` parses the routing combinator once and uses
  its string value as the dispatch key.
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

Primary Jess rewrite targets now that 0.39.1 is pinned:

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

## Parseman 0.40 scout items

These are not blockers for the four-grammar fold, but they are the right
questions for a Parseman 0.40 design scout because they shrink grammar/AST
boilerplate rather than just renaming it.

### Declarative value projection

The Less/CSS AST reducers still carry many tiny helpers whose only job is to
drop punctuation tokens, keep CST children visible, or project one child as the
semantic value. A future `valueNode(...)` / `drop(...)`-style surface should be
evaluated against real Jess grammar boilerplate, with one hard constraint:
semantic projection must not hide CST children, spans, or trivia from hostMode
output.

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

The helper must be adversarially reviewed against
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
  `0.39.1` is pinned. They require a routing combinator that consumes either a
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
  the pinned `parseman@0.39.1`. That makes `const asciiWord = makeWord(...);`
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
the pinned `parseman@0.39.1` showed top-level aliases leave `makeWord(...)` in the
emitted module, while factory-local aliases, direct chained `makeWord(...)`, and
`word(...)` all lower without runtime parseman calls.

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

Latest CSS direct-AST comment-key follow-up: the direct AST grammar now exposes
standalone block comments as `Comment` instead of `CssAstComment`, matching the
core AST node it already emits. This is a no-language-change key cleanup:
recognition remains `blockComment`, reduction remains `comment(...)`, and the
same comment statements remain admissible in stylesheet, declaration-list,
descriptor, page, keyframes, and font-feature-values bodies.

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

Latest CSS direct-AST function-call key follow-up: the direct CSS AST grammar
now exposes ordinary glued function calls as `Call` and strict `calc(...)` calls
as `CalcCall`, matching the public CSS CST concept keys. Recognition and
reducers are unchanged: generic `Call` still uses `nonCalcFunctionOpen`,
`calc(...)` is still excluded from generic call parsing and routed through the
strict math grammar, and both rules still reduce to core `FunctionCall` nodes.

Rejected in this pass: renaming declaration calls, strict calc arithmetic, or
the `VarFallback*` family in the function-call batch itself. Superseded
2026-07-26 for rule keys: each of those families now uses concept names after
its own accepted-language review. `DeclarationCall` and `DeclarationVarCall`
remain contextual owners rather than aliases for public `Call` / `VarCall`.
Also rejected: using the unreleased
Parseman dispatch primitive for function-token routing; the dispatch pressure
test says at-rule known/generic routing is the first real target, while glued
function openers remain clearer as `noTrivia(sequence(name, literal('(')))` for
now.

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
- Dispatch target: glued function calls, provided the selector value is the
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
normalized at-keyword selector value. **Superseded 2026-07-26 for rule keys
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
wrappers now use concept keys `ValueAtom`, `ValueTerm`, and `Value` instead of
`CssAstValueAtom`, `CssAstValueTerm`, and `CssAstValue`. This is a rule-key and
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

Latest CSS direct-AST declaration-value follow-up: declaration component-value
rules now use context names `DeclarationParen`, `DeclarationRawParen`,
`DeclarationIdentBlock`, `DeclarationAny`, `DeclarationCall`,
`DeclarationIdent`, `DeclarationVarCall`, `DeclarationValueAtom`,
`DeclarationValueTerm`, `DeclarationExtendedValue`, and `DeclarationValue`.
This removes the stale `CssAst` owner prefix while preserving the declaration
context as a real language boundary.

Rejected in this pass: merging declaration values into generic `Value`, folding
`DeclarationCall` into `DeclarationIdent`, or moving semicolon ownership into
declarations. The generic value spine and declaration values do not accept the
same language, and semicolons remain list separators owned by declaration-list
rules.

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

Latest shared CSS recognition naming follow-up: `parser-shared` now exposes the
shared CSS lexical artifact as `cssSyntax` and the shared pseudo-argument
artifact as `cssPseudoSyntax`, with shared rule keys moved from
`CssAstSyntax*` to `CssSyntax*`. CSS opaque capture leaves likewise moved from
`CssAstOpaqueCapture*` to `CssOpaqueCapture*`, and the accidental
`ScssAstSyntax*` compile-mode names became `ScssSyntax*`.

Rejected in this pass: renaming `cssAstGrammar`, because that export still
marks the current direct AST artifact consumed by public parse plumbing and
direct AST tests until the one-file hostMode CSS grammar lands. Also rejected:
renaming `lessAstSyntax` / `LessAstSyntax*` inside the CSS-base batch; that is
Less rebuild work, where accepted-language boundaries can be reviewed together.

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

Parseman 0.39.1 follow-up now landed and pinned: use case-insensitive
`when(...)`, matcher cases, `makeWhen(...)`, and `routed()` in the actual grammar
cleanup. Documentation may use domain-flavoured examples, but production grammar
helpers should be consolidated by matching policy.

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
passed (2 files / 187 tests); `check:macro` passed with 0 interpreter fallbacks
across parser-shared and all four parser packages; `verify:compose-integrity`
passed; and the Less byte-identity oracle remained output-neutral over the
709-entry baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=b990e139762f9a25602886cc4b9e647396ce3b9df5f49ddde48eb1d7f058fef4`;
AST threw 120, CST threw 0).

Latest CSS single-source fold status, 2026-07-26: CSS is down to one grammar
source. `packages/syntax/css/css-parser/src/ast/grammar.ts` was deleted, CSS
tests now import `cssAstGrammar` from `src/grammar.ts`, and `src/index.ts` /
`src/cst-css.ts` both route through the same `cssFactory` compiled in AST or
CST host mode. The single grammar also pins two strict CSS placement rules:
`@import` is accepted only in the stylesheet import phase, with empty `@layer`
statements allowed there, and top-level `&` is rejected while nested `&`
remains valid in nested rule contexts.

Latest Less fold status, 2026-07-26: Less is no longer split across two
hand-maintained grammar source files for the AST body. The direct AST body now
lives in `packages/syntax/less/less-parser/src/grammar.ts`, and
`packages/syntax/less/less-parser/src/ast/grammar.ts` is a compatibility
re-export only. The build is kept macro-friendly by compiling Less unbundled, so
`@jesscss/less-parser/grammar` remains a real direct grammar entry instead of a
small re-export to a generated shared chunk. This is still not the final Less
state: the CST bridge and direct AST factory are still separate bodies inside
one file. The next Less batch must collapse those into one host-mode-aware
factory and delete the compatibility re-export.

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

Evidence so far: the focused CSS parser set passed (5 files / 231 tests), the
full CSS parser suite passed (8 files / 260 tests), and
`pnpm --filter @jesscss/css-parser build` passed after rebuilding
parser-shared. After the Less AST-body move,
`pnpm --filter @jesscss/less-parser test -- ast-grammar.test.ts
cst-public.test.ts macro-compiled.test.ts --run` passed (3 files / 232 tests),
and
`pnpm run oracle:less:byte-identity` remained output-neutral over the 709-entry
baseline
(`aggAst=f0f0337594ca34b26f6c2a56bca203cb87f1192efadd4d9b66725e20d8571f23`,
`aggCst=3bc3670fa0605b94182edde0a555447d0a21af2d42e1b28661b8a7b0d219fc16`;
AST threw 120, CST threw 0). `pnpm run check:macro` now reports parser-shared,
CSS, and Less fully compiled with 0 interpreter fallbacks. The repo-wide macro
gate is still red because SCSS currently reports missing rule `CalcCall`, and
Jess still reports a non-build-resolvable compose input.

Rejected compatibility probe: changing CSS' `cssCstGrammar` from `composeLeaf`
to generic `compose`, including the `compose(..., { hostMode: 'cst' })` variant,
made the CSS build fail in the Parseman macro with
`IR direct node builder for CustomPropertyValue must be macro-static and
self-contained`. Do not repeat that shim. The repair belongs in the dialect
folds: make each dialect own one grammar/hostMode output, then classify any CST
surface movement intentionally at that dialect boundary.
