# Core Architecture Handoff

> **Architecture correction — supersedes every prior “private direct-AST grammar”,
> “development-only AST seam”, or “wire it later” claim in this document and
> linked future plans. Those claims were wrong/hallucinated migration staging,
> not an approved architecture. AST v2 and the deletion work are the public
> architecture: each dialect package's primary `parse()` operation must run
> Parseman reductions directly to canonical `Stylesheet`. CST APIs remain only for
> explicit language-service/document use; no CST-to-AST bridge, host, or
> compatibility route is an acceptable interim production design.

## Current target

Keep AST v2 as the canonical public representation. Parseman grammar reductions
create exact `Stylesheet` data directly through each dialect's public `parse()`
operation; core has no parser construction host, action registry, bridge,
source reparse, or compatibility path.

### Aggressive-cutting note — typed Less import query tail

`@import url("…") (min-width: @var)` now carries the existing typed
`Block(Operation(':', …), delimiter: 'paren')` tail from the Less grammar. The serializer reuses
its existing query-prelude byte emitter at the three import-tail boundaries
(planner request, loader request, and CSS-terminal output), so it preserves
query delimiters while evaluating the variable. No node, array, traversal,
resolver, Context capability, or public API is added; ordinary opaque/import
interpolation tails retain their existing byte path. This is behavior evidence,
not a performance claim; parser/public-render tests cover the new fact.

### Active delivery order

The immediate delivery target is a feature-complete **Less alpha** on that
public architecture. Do not spend the active implementation capacity on new
SCSS or Jess syntax/evaluator slices while the public Less route still lacks
required execution semantics. The other direct parsers remain canonical work,
but Less import execution, evaluator wiring, retained Context/plugin dispatch,
and corpus parity come first; resume the remaining dialect integration only
after those Less-alpha gates are genuinely green.

### Less corpus truthfulness gate

`packages/jess/test/less/all-less.test.ts` currently contains 30 runnable
expected-failure markers. They remain complete, visible compatibility evidence:
the harness passes when a named fixture fails, so none is passing-parity proof.
The owner decision for the first alpha is to classify—not drain or hide—them.
The maintained symptom/scope/follow-up inventory and alpha safety gates are in
[`../../less-v5-alpha-readiness.md`](../../less-v5-alpha-readiness.md), and the
release notes must link it. The six groups are callable/reference and scope
semantics (9); imports/conditional at-rule execution (6); direct
parser/evaluator correctness (7); F5 lazy color calls (2); URL options (2);
and source-map artifacts (4). These add to 30. In particular, a missing mixin remains an error; only an
ordinary function call with an optional function reference may fall back to a
CSS `Call` when lookup misses.

### `callWithContext` deletion prerequisite

The legacy tree call path has been audited rather than treated as an implicit
compatibility seam. `packages/core/src/tree/call.ts` reaches
`callWithContext` from exactly five dynamic-function paths:
`evalOptionalFallbackOutput`, `evalPlainDynamicFunction`,
`evalMetadataDynamicFunction`, `renderDynamicFunctionOutput`, and the ordinary
`evalFromStateInFrame` extended-function branch. These are all legacy-tree
execution routes. The ordinary branch keeps two distinct rules: a
`No matching mixins` failure is a hard missing-mixin error (apart from selector
capture), while a selected function's invocation failure may preserve the
authored call only under its optional/silent-fail policy and
`functionMode !== 'error'`.

`packages/core/src/define-function.ts` shows why this cannot be replaced by a
wrapper: `callWithContext` unwraps and clones legacy `List`/`Node` arguments,
runs legacy preprocessors, resolves positional/record/hybrid overloads,
evaluates non-lazy nodes through `Context`, supplies `FunctionThis` (`context`,
`caller`, `args`, `rawArgs`), performs legacy `instanceof` validation and
conversion, and finally invokes either `_internal` or a Context-bound function.
That contract is the bridge deletion target, not a public runtime model.

The replacement is the existing AST-v2 value seam. A canonical `Fn` is called
with `(List, FnCtx)` by `buildEvaluator`/`value-dispatch`; `ParamSpec` kinds,
defaults, rest, and explicit lazy thunks provide typed binding, while direct
Sass/Jess embeddings may use named records. `FnCtx` carries only resolved modes,
the value-to-string hook, and optional IO; it does not expose `Context`, legacy
nodes, callers, or source re-evaluation. Unknown function names remain authored
calls without a warning; failures from a function that actually resolved are
handled by `functionMode` (preserve + warning versus error). The plugin adapter
populates this same `Fn` registry/host, so Context remains the session and
plugin/import dispatcher rather than a function-body ABI.

The deletion gate is therefore concrete: migrate every production consumer of
the old contract (currently the Less `rgb`/`hsl`/`rgba`/`hsla`/`each` paths and
the Sass compatibility/map functions), then migrate their direct tests from
`RuntimeFunction`/`callWithContext` to typed `ValueObj` and registry calls.
Only after the consumer/test search is empty may `tree/call.ts`,
`define-function.ts`, and their old conversion exports be removed; no adapter,
alias, or tree-to-AST bridge is allowed as an intermediate state.

### Alpha packaging blocker: generated legacy declarations

The alpha tarball audit found a packaging surface issue, not a reason to
delete declaration files blindly. `@jesscss/core` exposes only `.`, `./value`,
and `./ast` in its package `exports`, but `src/index.ts` still does
`export * from './tree/index.js'`; therefore the legacy tree classes and the
explicit tree utility exports are genuinely public through the root entry.
`tsconfig.build.json` separately emits declarations and maps for every
`src/**/*.ts`, so unexported `lib/tree/**` helpers are generated artifacts but
must remain until no reachable declaration refers to them.

`@jesscss/fns` is broader and currently inconsistent: its `./*` export map
claims every generated `lib/*.d.ts/js/cjs` subpath, while `tsdown.config.ts`
only emits the `index` and `builtins` runtime entries. Legacy Less/Sass/shared/
util declaration subpaths are therefore published (and advertised by the
README/docs) even when their matching runtime file is absent. Replace the
wildcard only after either generating the documented subpaths or explicitly
withdrawing and testing them; `plugin-js` currently treats all
`@jesscss/fns/*` paths as trusted.

**Bounded package cut (2026-07-22).** The first safe export correction removes
the `@jesscss/fns` `./*` wildcard. A workspace consumer search found only the
root `@jesscss/fns` import and the explicit `@jesscss/fns/builtins` import; no
production or test consumer imports a Less/Sass/shared/util subpath. The fns
build emits runtime entries only for `index` and `builtins`; the former
wildcard therefore advertised declaration-only paths whose corresponding
`.js`/`.cjs` files do not exist. The README and Sass export-structure note now
state that those folders are source ownership boundaries, not published
entrypoints. `plugin-js`'s filesystem trust rule remains a separate sandbox
boundary for resolved built-in files and is not used to justify package
subpaths. The core root tree barrel is intentionally not cut in this batch:
`Context`, the legacy fns implementation, and compat consumers still import
its classes, so the prerequisite migration remains the next required slice.

The minimal cut sequence is:

**A.** Finish the remaining legacy `@jesscss/fns` Less/Sass function and test
migrations to `@jesscss/core/value`; rewrite or intentionally retire the
production `packages/jess-plugin-js/src/bridge.ts`, which still transports
legacy `Any`/`Color`/`Dimension`/`List`/`Rules` values.

**B.** Delete `define-function.ts`, `conversions.ts`, and their root exports
after the consumer search is empty.

**C.** Migrate `Context` and `jess`/plugins off `TreeContext`, legacy
`Node`/`Rules` state, spine/visitor fields, and tree-only utilities while
retaining the AST-v2 `DocumentContext`, plugin host, and import dispatch.

**D.** Remove `export * from './tree/index.js'` and explicit legacy utility
exports from `core/src/index.ts`; expose only the stable Context/plugin/error,
`ast`, and `value` seams.

**E.** Remove the now-unreachable tree runtime and legacy tests/visitor ABI.

**F.** Tighten declaration builds to the public entry closure and replace the
`fns` wildcard with explicit, runtime-backed subpath exports. Verify packed
install imports and type resolution before alpha publication.

**No-op consumer audit (2026-07-22).** A bounded audit of the remaining
`@jesscss/core` imports in `packages/fns` found no honest pure cut to land
without first resolving function-owner semantics. The remaining consumers are
clustered as follows:

- Less color functions (`contrast`, `fade*`, HSL adjusters, `shade`/`tint`,
  `color`, and constructors) still depend on legacy `Color` source-format and
  raw-channel metadata, `Context`, or the legacy `mix` contract. Their
  canonical `builtins/` counterparts are comparison evidence, not an approved
  destination or compatibility alias.
- Less structural/context functions (`each`, `isruleset`, `iif`/logical,
  format/replace, data-URI/image/SVG helpers) consume `Node`/`Rules`,
  lazy-thunk, or Context/IO capabilities and require their own behavior
  migrations.
- Sass map/list/string functions consume legacy `Collection`, `Declaration`,
  `Any`, and Context contracts. They need typed map/list semantics and direct
  tests before tree imports can be removed.
- Shared `math/max` and `math/min` still use legacy `Node.compare`; Less's
  canonical `min-max` policy and Sass's unit/error behavior have not been
  proven identical, so they must not be ported by assumption.
- `less/types` mixes value predicates with legacy `isurl`; a partial rewrite
  would leave the same root-tree consumer and would not advance the deletion
  gate.

The next owner decision is explicit: either rewrite each existing dialect owner
in place and move the canonical color/list kernels to an approved shared value
owner, or approve an ownership inversion in which the current `builtins/`
implementations become direct registry consumers of the rewritten `less/` or
`sass/` owners. Until that decision and the corresponding red-to-green oracle
tests exist, do not delete the tree barrel or land a partial alias/bridge.

### `plugin-js` bridge disposition

The `packages/jess-plugin-js/src/bridge.ts` audit does not identify another
parser/compiler AST bridge. It is the external Deno-process transport for the
legacy Less JavaScript runtime ABI: host-side legacy `Any`, `Color`,
`Dimension`, `List`, `Quoted`, `Sequence`, `Rules`, and `Declaration` values
are encoded as tagged JSON, while `runtime-worker.ts` decodes them into its
own `less.tree` classes (`Dimension`, `Color`, `Quoted`, `Keyword`,
`Anonymous`, `Value`, `Expression`, and `DetachedRuleset`).

That ABI is observable and tested by
`packages/jess-plugin-js/test/plugin-js-security.test.ts` (the
`less.tree`/`less.dimension`/`less.value` `instanceof` and legacy `@plugin`
cases), by `packages/jess/test/less/wall8-repro.test.ts`, and by the
`plugin-js` README's typed-bridge guarantee. AST-v2 `@jesscss/core/value` is
not a 1:1 replacement: it has structural `Dimension`/`Color`/`Quoted`/
`Keyword`/`List`/`Block`/`Bool`/`Nil`, but no anonymous-vs-keyword `Any`,
`Sequence`/Expression value, detached Rules/Declaration map, or class identity;
it also carries different color source-format metadata. Substituting those
shapes now would silently break external modules and Less map/plugin behavior.

Do not add a dual canonical/legacy branch and do not delete this transport in
the alpha. Its future cut requires an owner-approved canonical cross-process
protocol covering raw/anonymous values, sequence/layout facts, detached
rules/map semantics, and color source metadata; a new worker API and facade;
migration of the bridge tests, README, legacy plugin fixtures, and callers; and
only then removal of the legacy Less facade plus all core-tree imports from
`bridge.ts`. Until that protocol is approved and proven, this is a legitimate
external runtime compatibility seam, not evidence that the public parser or
compiler still uses a tree-to-AST bridge.

## Active orchestrator goal

Drive the public AST-v2 cutover, Less alpha readiness, Parseman release,
performance recovery, and Jess alpha preparation to verified completion. This
section is the authoritative full-scope companion to the compact task goal.

- All public CSS, Less, SCSS, and Jess `parse()` routes must reduce Parseman
  grammar directly to canonical AST-v2 `Stylesheet`; `Reference` is the typed,
  recursive public reference chain. No bridge, builder/parse host, action
  registry, source reparse, scanner/regex recognizer, compatibility parser, or
  fallback/shim may return.
- Less is the immediate feature-completeness priority. Close real parser,
  evaluator, import, plugin, and corpus gaps through the public route; prove
  the first external prerelease as exactly `less@5.0.0-alpha.1`, including
  built-artifact `lessc` and clean packed-install tests.
- Context remains the one render/session/cache/diagnostic/plugin/import
  coordinator. Retain its plugin-based source, parser, module, path, and
  import dispatch topology while changing carried documents to `Stylesheet`;
  do not replace it with a second loader or resolver.
- Finish public Jess syntax integration through `jess-parser` and
  `plugin-jess`. CSS is a Context-parsed/inlined document route, not a Jess CSS
  compiler merely because a CSS plugin exists. Delete only machinery proven
  unreachable after direct-route coverage; do not manufacture deletion work.
- Prepare and release compatible Parseman `0.28` from its release branch only
  after review, tests, public docs/changelog, and coverage/trace API proof.
  Normal compiler/plugin/CLI parses never enable coverage or trace. Replace
  local Parseman links only with that published version and prove clean install.
- Treat current direct-Less parsing performance as a release concern. Establish
  reproducible generated-bundle/hash baselines and investigate AST allocation,
  grammar choice/backtracking, metadata/trivia/provenance, emitted
  `composeLeaf()` shape, and historical feature equivalence independently.
  Optimize only with semantic/output proof and matched parse plus end-to-end
  measurements; never restore legacy architecture for speed.
- Prepare `jess@2.0.0-alpha.9`: identify its actual publishable runtime closure
  (including the correct CSS and Jess plugin roles), remove runtime `link:` and
  unnecessary internal dependencies, build and pack the candidate, and run
  parser/plugin/Compiler/rollup, Less-alpha, package/API, cutting-review,
  `lessc`, and clean-consumer gates. Validate final `dev`, prepare
  owner-reviewed release notes, then squash-merge it onto `alpha` for the
  release cut; do not ordinary-merge/rebase shared alpha history or publish
  before every gate passes.

## Router

| Work | Read first |
| --- | --- |
| Direct parser AST construction and legacy-builder deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) |
| Parser recognition, interpolation, and scanner cleanup | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) |
| Feature/eval closure | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) |
| Eval/render allocation, lookup, and traversal cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) |
| Owner semantic/architecture questions and rulings | [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md) — the canonical OPEN/SETTLED decision ledger |

The detailed future plans remain active for their grammar, feature/eval,
scanner-cleanup, and performance content. Their former bridge/host sections are
historical evidence only.

## Non-negotiable rules

- Grammar owns recognition and construction. Do not add a parser host, action
  registry, bridge, compatibility alias, source reparse, or fallback path.
- Parser recognition uses Parseman grammar combinators only. Imports and
  interpolation are typed first-parse facts.
- Preserve one canonical tree; do not normalize cloning, materialization,
  rediscovery, or error allocation in hot paths.
- Public operations use stable names such as `parse`, `build`, and `render`.

## Settled delimiter-container model

AST-v2 uses one `Block` value wrapper for delimiter-bearing values. `Block`
stores `inner`, `delimiter: 'paren' | 'square'`, and the existing optional
`escaped` fact for Less `~(...)`. It is deliberately transparent to typed
evaluation, participates in Less math-mode evaluation when the delimiter is
`paren`, and renders square-delimited values as authored bracketed lists. There
is no separate `Bracket` node and no `List.bracketed` field.

Where the grammar emits a public syntax `List`, it and the materialized value
`List` share the canonical payload shape: `value` plus a separator fact
(`',' | ' ' | '/' | 'undecided'`). They never expose the former
`items`/`separators` pair or recover a separator from joined bytes. Ordinary
adjacent declaration/value terms are instead the raw recursive `ValueSlot`
array itself; there is no `SpacedValue` or `List(sep: ' ')` wrapper for that
case. Parsers may attach the exact authored boundary runs—spaces, comments,
line breaks, and indentation—to that array in the out-of-band provenance table,
so the semantic array stays plain while serialization remains trivia-aware:
comments and authored line breaks survive, while the renderer may normalize
continuation indentation to the surrounding output depth.
`SpacedValue` remains only where a non-value/prelude compatibility shape still
has an independent semantic reason to exist.

The legacy tree proves the same delimiter fact: its `Paren` carries
`delimiter: 'paren' | 'square'`, and Sass list functions preserve/read it for
`is-bracketed`, `append`, `join`, and `set-nth`. AST-v2 now carries that fact in
the canonical `Block` wrapper under `@jesscss/core/ast`; the root package does
not re-export it under the colliding legacy-tree name. Curly statement/ruleset
bodies remain outside this `ValueNode` design.

## Completion gates

Run focused parser/core tests first. Run the parser-runtime boundary verifier
when recognition changes. For eval/render/lookup/traversal/copying changes, run
`pnpm run verify:aggressive-cutting-review` before commit. Final integration
requires fresh builds, core tests, the Jess AST-v2 production-route ratchet,
and the Less corpus.

### Verified alpha squash policy (2026-07-22)

The `alpha` and `dev` branches share a common ancestor but independently added
the same source paths. A disposable rehearsal confirmed that
`git merge --squash dev` from `alpha` creates a broad add/add conflict set;
these are history-topology conflicts, not a semantic queue to resolve by hand.
Do not ordinary-merge or rebase `dev` into `alpha`.

For the refresh, first create a recovery ref such as
`git branch alpha-pre-alpha9-cut alpha` and work in an isolated `alpha`
worktree. Import the endpoint tree with a two-tree patch
(`git diff --binary alpha..dev` and `git apply --index`), then run
`node scripts/release/restore-alpha-package-versions.mjs --from alpha-pre-alpha9-cut`.
That tool restores only each `packages/*/package.json` `.version` field from the
recovery ref; it must not restore whole manifest files. The alpha snapshot takes
all current `dev` manifest fields (including runtime/peer/dev dependencies,
exports, and publish configuration) and retains only recovery alpha versions
until the registry-aware release step selects the next version. `pnpm-lock.yaml`
is unchanged. Keep `dev`'s root quality gates (`verify:types` and bounded
production lint) and its newer HANDOFF/readiness/release evidence; reconcile
the alpha release note from final gate evidence instead of restoring the older
alpha docs wholesale.

## Aggressive Cutting Self-Prosecution

- **New traversal:** none in the compiler/runtime. The release helper scans the
  existing workspace manifest list once, a cold release-only path.
- **New node/materialization:** none; JSON manifests are release metadata, not
  AST/runtime nodes.
- **Render path:** untouched.
- **Helper/API surface:** one release-only helper replaces the unsafe documented
  whole-manifest restore. It retains a single field instead of preserving a
  broader compatibility copy operation.
- **Metadata mutations:** the helper writes only package manifest `version`
  fields after the source-tree import. It reads recovery manifests through Git
  solely to retain the alpha snapshot version.
- **Evidence:** the focused release unit test proves imported dependency,
  peer-dependency, and export fields survive while only the recovery version is
  used. This is release correctness evidence, not a performance claim.

Commit one controlled refresh on `alpha`, confirm a clean source tree, and run
the full `release:alpha` chain before owner-approved publication. The
orchestrator resolves the fresh registry candidate before preflight, passes it
to the nested publish dry-run without mutating manifests, and writes the
lockstep versions only after checks pass; this avoids treating the previous
alpha manifest left by the squash as the publish candidate while retaining the
alpha-clobber guard. A direct `release:alpha:check` invocation still expects
the alpha manifests to already carry a fresh candidate. The chain is the
release build, strict types, production lint, Less-alpha route, direct public
`jess-parser`, `plugin-jess`, and `rollup-plugin-jess` tests, AST-v2 production
ratchet, baseline, release-mode aggressive-cutting review, allowlist validation,
packed-consumer proof, and publish dry-run.

### Current Less-alpha gate status (2026-07-22; public route and F5 gate green)

The public Less route reaches canonical AST-v2 evaluation and serialization for
direct and imported documents: the Less plugin calls the public direct parser,
Context carries its `Stylesheet`, parser/source identity, typed builtin
evaluator, and resolved dialect options, and Jess serializes that document
without a tree bridge or copied execution-option bag. `pnpm run verify:less-alpha`
passes the current release-shaped checks: package exports, public API (8/8),
path-resolution (13/13), Less unit corpus (78 runnable, including two
intentionally marked F5 semantic boundaries), and Less config corpus (29/29
harness-green). The focused F5 test
(`pnpm --filter jess test -- function-error-public-semantics.test.ts --run
--globals`) is 17/17: CSS-shaped three-/four-slot Less `rgb`/`rgba`/`hsl`/`hsla`
calls remain byte-faithful and do not dispatch installed native functions, while
Less one-/two-slot overloads dispatch normally and malformed arities use the
evaluator's `functionMode` boundary. The corpus's marked expected-failure cases
remain known Less-parity limitations, not release-gate failures. The Less test
harness loads the macro-compiled public parser artifact, not Parseman grammar
source, and the Less-alpha command builds that parser/plugin pair before
running integration tests.

Current verification snapshot for this candidate:

- The complete `@jesscss/core` suite is 3,194 passed, 9 skipped, and 2 todo.
  The skipped/todo cases remain visible and are not converted into passing
  evidence.
- The repository-wide production ESLint audit reports 0 errors and 319
  warnings. The warnings remain tracked debt; there is no current ESLint-error
  blocker.
- Parseman `0.28.1` is published and consumed through real package versions.
  A forced frozen install resolves it, and strict `verify:types` passes all
  22 production configurations.
- The Jess alpha closure is the 18-package
  `scripts/release/alpha-allowlist.json`; `rollup-plugin-jess` is intentionally
  excluded because it depends on `jess` and is not part of the runtime closure.
  The final alpha snapshot passes allowlist validation and the packed-consumer
  proof.
- A clean benchmark baseline is recorded below. The current same-bundle trivia
  isolation is diagnostic only; the remaining performance blocker is a
  causally isolating matched generated-bundle A/B for reducer/choice changes,
  not a release timing threshold. The current grammar requires `composeLeaf`
  absent from Parseman 0.27, and generated reducer IDs vary with absolute
  worktree paths.
- Serial rebuild-and-measure evidence at `66c700d06` is now reproducible:
  `benchmark.less` parses to a 677-child `Stylesheet` (JSON 946,987 bytes,
  SHA-256 `8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c`)
  and renders to 122,723 bytes (SHA-256
  `2ab6d3fd8f322df0f0be7c1a481b528ec50a7fb035604b744c7543397d56b3fe`). With
  serialized builds and 20 warmups plus 3×45 samples, the public compiler
  round median is 74.397 ms (usable signal; trimmed median 75.915 ms).

### Alpha.9 release state (2026-07-22)

The controlled alpha snapshot is `564b65615`. Its forced frozen install
resolves `parseman@0.28.1`; the exact `pnpm run release:alpha:check` chain
passes the release build, 22/22 strict types, production lint with no errors,
Less-alpha public-route checks, direct Jess parser/plugin/Rollup tests, the
AST-v2 ratchet, baseline, release-mode cutting review, 18-package closure,
packed consumer, and alpha.9 dry-run publish. The snapshot is clean and the
dry-run resolves `2.0.0-alpha.9` ahead of the published alpha.8 tag.

Nothing has been pushed or published from that snapshot. It awaits explicit
owner approval to run the full `pnpm run release:alpha` command from `alpha`;
that command deliberately re-resolves the registry candidate, repeats the
preflight, then tags, pushes, and publishes. Do not substitute the publish-only
command for that release flow. The external `less@5.0.0-alpha.1` release remains
a separate future action after Jess alpha.9 is actually available from npm.

### Aggressive Cutting Self-Prosecution — release-state documentation

- **New traversal / materialization / render path:** none; this is a
  documentation-only evidence reconciliation.
- **Helper/API surface and metadata mutations:** none; no runtime or package
  metadata changes are claimed here.
- **Evidence:** the alpha command above was run at `564b65615`; the full log
  records the named gates and the dry-run package closure. No performance claim
  is derived from the release verification.
  This is a current baseline, not a matched-version performance claim.

Per-change-slice over-engineering review follows the protocol in
[`less-v5-alpha-readiness.md`](../../less-v5-alpha-readiness.md#per-change-slice-review-protocol).
When the Ponytail tool is unavailable, reports must say **Ponytail-style
manual review**; they must not imply that an actual plugin invocation ran.

The old `spine-production-ratchet.test.ts` was removed from the gate because it
asserted occupancy of the deleted public path's legacy tree counter; 121 of its
139 cases failed solely because AST-v2 rendering correctly never entered that
counter. `ast-v2-production-ratchet.test.ts` is the replacement production
gate: it proves canonical `Stylesheet` ownership, direct Less evaluation,
Context/plugin import loading, and absence of legacy output-tree materialization.

### Less math/unit residual split (2026-07-22)

Explicit compile-level `mathMode` and `unitMode` already flow through the
canonical Context options. `LessPlugin.setContext` now installs its normalized
legacy `math`/`strictUnits` (and related Less mode) values into Context when an
explicit compile value has not already won. The focused
`packages/jess/test/less/strict-units.test.ts` proves that the nested
`language.less` options in both units `styles.config.cjs` files reach the
public Context route. Keep that options proof separate from the remaining
bare-slash evaluator fact below; neither permits a parser bridge or a second
resolver:

1. **Structural bare-slash precedence.** `DirectLessValueTerm` already retains
   the typed `ValueSlot[]` parts and their authored boundary layout, including
   a slash leaf. When the configured Less math mode permits evaluation
   (`math: 0` and `mathMode: 'always'` are equivalent), the evaluator must
   promote that existing structure to the correct arithmetic precedence and
   evaluate it. `parens-division` is the opposite contract: a bare slash stays
   authored, while a parenthesized or calc expression has its own arithmetic
   path. The authoritative regression fixture is
   `tests-config/units/no-strict/no-strict.less`: `test-division`, `t3`, and
   `t6` still must evaluate under its `language.less.math: 0` config; the
   focused test currently records their authored output as the explicit
   remaining mismatch. Equivalent bare slash values under
   `mathMode: 'parens-division'` must remain authored divisions. This
   promotion must not reparse source bytes or add a second value parser. The
   existing `normal small / 20px` shorthand exception under eager math remains
   a separate CSS-value classification, not evidence that all slash-shaped
   values are arithmetic.
2. **Deferred strict-unit validation.** The unit evaluator must retain the
   numerator/denominator facts through an operation chain and validate
   singularity only at final typed materialization/emission. Intermediate
   compound units are allowed to cancel in a later operation; strict mode must
   therefore produce `cancels-to-nothing: 1` and `cancels: 6px` in
   `tests-config/units/strict/strict-units.less`, rather than throwing before
   cancellation. Incompatible `+`/`-` unit checks remain strict errors. This is
   a value-domain timing fix, not a parser change.

### Bounded bare-slash fold design (implemented)

The remaining eager-math slash mismatch has a bounded evaluator-only design;
the design is recorded here so it is not rediscovered as a parser or bridge
proposal. `DirectLessValueTerm` already provides the typed top-level
`ValueSlot[]` and its authored boundaries. A future `promoteBareSlashValue`
step may run immediately before `evalValueSlot` joins that array, but only when
`mathMode === 'always'`:

1. Reject nested arrays, non-arithmetic `Operation` operators, and any
   top-level run containing more than one scalar. This preserves ordinary
   space/slash lists such as `normal small/20px` rather than treating a list as
   one arithmetic operand.
2. Treat each remaining top-level scalar `Operation` as one existing typed
   spine. Flatten only its `+`, `-`, `*`, `/`, and `%` nodes into infix tokens;
   never inspect or reconstruct source bytes.
3. Require a slash leaf between one-expression runs. A slash leaf is the
   grammar-owned `Keyword('/')` (or the historical opaque `Any('/')` fact),
   not a byte search. Reject `Keyword`/`Any` leaves other than that slash, and
   reject `Quoted`, `SpacedValue`, and `List` operands. Numeric `Dimension` and
   `Color` leaves are the static operands; variable/property references,
   function calls, and parenthesized `Block` values may be admitted only if the
   typed evaluator already owns their value contract.
4. Fold the resulting tokens in two existing precedence passes (`* / %`, then
   `+ -`) into temporary `Operation` values using the canonical constructor,
   then send that temporary value through the existing evaluator. The authored
   AST is unchanged; no parser host, source reparse, bridge, side table, or
   broad declaration-value walk is introduced.

The Less 4.6.3 oracle for `math: 0` is:

```text
4 / 2 + 5em  -> 7em
4+2 / 5em    -> 4.4em
2em/1em      -> 2em
```

The corresponding `math: 2`/parens-only route preserves all three authored
values. Parenthesized division (`(10px / 2)`) remains the existing `5px` path,
while a bare `10px / 2` under `parens-division` remains authored.

The evaluator implementation is `promoteBareSlashValue` in
`packages/core/src/ast/serialize.ts`. It first requires the existing top-level
grammar slash fact, then admits only `Dimension`/`Color` leaves and existing
`+ - * / %` `Operation` spines. It folds those tokens through the existing
`operation()` constructor in the two Less precedence tiers. Any nested array,
space group, non-arithmetic operator, or non-static leaf returns to the normal
authored layout join. In `parens-division`, the same top-level slash fact
temporarily suppresses eager sibling operations while retaining the existing
parenthesis-depth path. No source bytes, parser, bridge, or AST mutation is
involved.

### Aggressive Cutting Self-Prosecution — bare-slash evaluator

- **[loop/traversal] New traversal:** one bounded scan of a top-level `ValueSlot[]` for the
  parser-owned slash leaf, followed only on a recognized slash shape by one
  recursive walk over existing arithmetic `Operation` children and two short
  precedence reductions. The scan is necessary because the parser already
  retains the slash as a leaf; no source-byte rediscovery is introduced. The
  common non-slash path returns before token allocation.
- **[node construction] New node/materialization:** no runtime value objects or AST nodes are
  created for authored output. The rare recognized shape creates temporary
  `Operation` records solely for the existing typed evaluator, then emits the
  resulting value; the immutable authored AST is untouched.
- **[array helper] Render path:** ordinary lists and nested groups stay on the existing
  `evalValueSlot`/layout join. Arithmetic promotion is immediate evaluation,
  not a render-time node walk or source reconstruction.
- **[array spread/materialization] Helper/API surface:** `promoteBareSlashValue`, its token reducer, and the
  slash-shape predicate are private serializer helpers; they replace the
  previously missing precedence step and expose no public API.
- **[side map/set] Metadata mutations:** none. No parent/source metadata, side map, or
  context mutation was added.
- **[materialized array/object] Evidence:** focused strict-unit tests prove `7em`, `4.4em`, `2em`, strict
  cancellation, ordinary slash-list preservation, grouped division, and
  parens-division controls. Full performance claims remain unmade; this is a
  correctness slice.

The two fixes can be tested and reviewed independently: direct evaluator tests
cover slash promotion and strict cancellation separately. The nested units
fixtures are discovered by `scripts/less-corpus-report.mjs` (report-only); the
current `all-less.test.ts` glob does not enumerate their two-level
`tests-config/units/<case>/` paths. The dedicated strict-units test now proves
the legacy options route and keeps the three no-strict slash mismatches
visible, rather than weakening them into a pass. No source-byte reparse,
scanner, compatibility path, or dialect-local resolver is permitted.

Built-artifact public-route instrumentation is also decisive: a direct Less
`Compiler.renderToResult(...)` reads or writes none of Context's legacy
`root`, `treeRoot`, `rulesContext`, or `evaldTrees` fields, and invokes neither
the constructed legacy extend registry nor selector-bit library. AST
serialization reads only the active document source identity for diagnostics;
there is no tree conversion or tree evaluation. Keep Context's parser/import
dispatcher intact. The next removal sequence is to extract that source/options
carrier as `DocumentContext`, then lazily isolate the legacy tree execution
state so direct AST renders no longer construct it.

The canonical separator path is public-route green: direct AST grammars emit a
typed separator-aware `List` (`sep: ',' | ' ' | '/' | 'undecided'`) rather than
inserting a `Keyword('/')` sentinel between items. SCSS slash lists therefore
retain `/` as their list fact, while a paren or square delimiter is carried by
the separate `Block` wrapper. Less preserved-division arithmetic remains an
operation/grouping fact and is evaluated in its configured math mode, not by
re-splitting a joined string or synthesizing a `calc(...)`.

Direct media-query comments now parse as typed output-bearing query values rather
than being swallowed as document trivia or rejected. The focused parser proof is
green. Static root CSS-terminal imports now also use the canonical renderer's
bounded document-prelude rule: first identical import wins and emits ahead of
ordinary rules; Context-loaded stylesheet imports remain source-ordered. The
upstream `at-rules-keyword-comments` fixture is green.

The CSS-grid fixture now passes through the public direct grammar and AST
renderer, including bracketed grid-line atoms and multiline values. Raw
`ValueSlot` arrays retain grammar-owned boundary runs—including comments,
line breaks, and indentation—in provenance; an array with no authored trivia
serializes with ordinary spaces. Existing `Declaration.valueOnNewLine` records
the colon-to-value layout. This is a general value shape, not a grid-specific
raw-value fallback. The upstream `whitespace` fixture passes through the same
shape.

The generic direct at-rule grammar represents `@namespace foo
url(http://...)` as `AtRuleStatement(SpacedValue(Keyword, Url))`, a parenthesized
generic-header group as `Block(delimiter: 'paren')`, and Less's historical
`url-prefix(""github.com"")` spelling as an opaque, grammar-owned generic
function argument. None uses a raw-prelude fallback. The
public CSS-3 fixture is byte-identical through the macro-compiled Less parser,
plugin, Context, and AST renderer.

The first root-only import slice now routes typed Less `ImportAtRule` facts
directly through the active Context. Context registers parser/source identity
when each `Stylesheet` enters the session, restores that document's existing
plugin/file scope while it emits, and uses its retained `getTree` dispatcher for
every loaded document. It proves relative/include-path dispatch, recursive
source identity, and that a loaded AST declaration joins the existing frame's
scoped and live lookup state.
`path-resolution.test.ts` is green. This is not the import end state: nested
import placement, CSS/remote/option behavior, once/multiple/reference/optional/
inline semantics, and media-tail wrapping remain real Less-alpha work. Do not
restore the legacy tree importer or pre-load/splice documents outside ordered
render execution.

The immediate Less-alpha task remains the import portion of step 2: retain the
Context-to-plugin result/cache dispatcher while completing its canonical
`Stylesheet` contract and AST import execution. It must not restore the legacy
parser, bridge AST into a tree, or introduce a second resolver/parser path.
Only then may corpus feature failures be ranked.

## Context and plugin dispatch invariant

`Context` remains the canonical per-render coordination and state object. It
keeps options, diagnostics, caches, per-file state, eval/render frames, and the
installed plugin chain. Its import and parse methods are not duplicate
resolvers: `_getPath` dispatches active-plugin `expandImport`/`resolve`, then
resolver and locator plugins; `getTree` dispatches plugin `getSource` and
`safeParse`; `parseString` dispatches the selected parser plugin; `getModule`
dispatches the selected/lazily loaded module plugin.

AST cutover changes the document type carried through those same calls from
legacy `Rules` to canonical AST `Stylesheet` (or an explicit canonical document
result). It preserves Context diagnostics, cache, session, plugin ordering, and
visitor/lifecycle coordination. It does not introduce a separate loader,
resolver callback, or replacement dispatch topology.

Normalize the retained parser-plugin contract while doing so: today
`findParserPlugin` accepts either `parse` or `safeParse`, while `getTree`
requires `safeParse` and `parseString` requires `parse`. The AST result contract
must make that distinction explicit or adapt one form to the other through the
same Context dispatcher; it must not add a second parse path.

Candidates for removal are only:

- `Rules`-specific result types, caches, root assignment, and legacy-tree
  adaptation inside the retained Context methods;
- `StyleImport`/legacy `Rules` placement and evaluation behavior after a
  canonical AST consumer preserves its tested semantics through Context;
- a path proven to bypass the Context-to-plugin chain, such as the independent
  filesystem fallback in `packages/fns/src/util/file-resolution.ts`.

`Context.readBinary` and JSON decoding in `getModule` are current explicit
core byte/module capabilities after plugin resolution, not evidence that
`_getPath`, `getTree`, `resolveImportPath`, `parseString`, or `getModule` should
be deleted. Decide their long-term capability ownership deliberately.

### Reachability audit (2026-07-21)

The direct-production call graph was audited before any bridge/tree deletion.
`packages/jess/src/index.ts` enters through `Context.parseString` or
`Context.getTree`, and AST serialization uses the retained Context methods
`loadImport`, `readBinary`, `withDocument`, `withSourceOwner`, and
`rememberDocumentBody`. These are the plugin/session/source-identity topology;
they are not parser or filesystem bridges and remain required.

No production `BuilderHost`, `ParseHost`, action registry, or parser-host
dispatch symbol remains in the parser packages or core. Parseman `BuildHost`
references are confined to the explicit CSS CST/document-language-service
builder API. Do not invent a replacement host to remove that name.

The old core `Visitor`/`Node.accept()` ABI is also no longer reachable: a
workspace search found no production or test consumer after the
`jess-plugin-less-compat` bridge cutover. Core no longer exports
`visitor/index.ts`, and `tree/Node` no longer carries the Less-style
`accept()`/`ABORT`/`REMOVE` machinery. This is distinct from the retained
Context-owned `SpineVisitor` hook, which is a separate render lifecycle seam
and does not expose legacy per-node visitor dispatch. The separate
`packages/jess/src/visitor/index.ts` identity wrapper was likewise unimported,
unexported, and deleted; it was not a second valid visitor implementation.

The AST serializer's `withSourceOwner` seam no longer carries its dead
`legacyBody` fallback into `Context.withDocumentBody`. The public AST route
always supplies the real `Context.withSourceOwner` capability; the fallback
accepted a context-shaped object that could not implement the typed source-owner
operation and was not reachable from the public compiler/plugin route. The
Context `withDocumentBody` method remains valid for its direct document-body
provenance tests and is not removed or repurposed by this cleanup.

The public core barrel still exports the legacy tree corpus, and the root
`@jesscss/fns` barrel still exposes `packages/fns/src/less/*`; Context, the
legacy function barrel, compat type declarations, and visitor/language-service
consumers still import those classes. Root-tree export removal therefore has
concrete prerequisites: migrate or quarantine those consumers and isolate the
legacy Context execution state. The direct AST renderer itself does not read
`Context.root`, `treeRoot`, `rulesContext`, or `evaldTrees`.

The internal source formerly under
`packages/jess-plugin-less-compat/src/transform/` and `src/nodes/` was proven
unreachable from the package's only public entry point: the built package
exports only the native AST-v2 `LessCompatPlugin`, and its bundle contained no
`toLessNode`, `fromLessPluginReturnValue`, visitor, or transform symbols. The
dead transform/node adapters and their unreferenced helper/type/runtime files
were removed in the alpha.9 cleanup; the package-root native `Fn` API remains.
Likewise,
`packages/fns/src/util/file-resolution.ts` is reached only by the legacy
`packages/fns/src/less/*` helpers and must wait for that public barrel's
migration/quarantine rather than being deleted as if it were Context's
resolver. The parser-runtime boundary audit is green (zero tracked temporary
scanner/reparse sites); remaining string scans in AST serialization are
evaluation/output semantics, not source recognition.

The aggressive-cutting verifier now treats the coordinated
`ValueSlot`/`List`/`Block` and callable-contract cutover as an explicit
seven-file `semantic-runtime` evidence lane. That lane requires named semantic
cases, focused behavior/build commands, and a current benchmark/output baseline
with `performanceClaim: "none"`; it does not pretend this feature-changing work
is a neutral optimization. Precise/conservative/removal contracts remain
required for any actual cutting or performance claim.

## Direct-root cutover order

The parser work has one real composition gate: a leaf dialect grammar must be
able to macro-fuse imported, recognition-only shared syntax while retaining its
own local direct-constructor reductions. It must not serialize local builders,
relax direct-builder capture validation, or create a reusable builder artifact.
That leaf-only fusion proves that imported recognition-only property/keyword
terminals fuse into local direct AST reductions with their token values intact.
It is incomplete public-parser implementation, not a private architecture or
completion claim. Continue in this dependency order:

1. Complete all four parser families (CSS, Less, SCSS, Jess) as direct AST v2
   `Stylesheet` parsers.
2. Update each plugin to consume its parser's `Stylesheet` while preserving the
   existing Context-to-plugin dispatch topology and plugin-specific semantics.
3. Update the Jess package integration/render route to use those AST-consuming
   plugins, then delete only legacy tree-specific realization such as
   `StyleImport` and any proven duplicate filesystem/module implementation.

### Canonical loop model

The public AST-v2 `For` contract is defined by the documented Jess
`$for (… of …)` syntax—not by Less `each()`. It is a flexible iteration protocol
in the spirit of JavaScript `for…of`: the source kind (list, collection/map,
range, or a later iterable value) determines the useful entry shape presented to
the authored binding pattern. Its bindings, source-dependent iterable behavior,
and source-order semantics must be named and shaped as Jess concepts. In
particular, do not preserve `valueName`, `keyName`, or `indexName` as the public
canonical node vocabulary merely because legacy Less `each()` used them.

Less `each()` is a compatibility input dialect. The Less parser lowers it into
compatible Jess-shaped loop helpers/patterns at its own boundary; it does not
make Less callback/key/index fields a core AST API. A general `For` rewrite must
preserve the public Jess header contract: `[$key, $value]` means key/value in
that order; the source kind supplies the entry shape. The current legacy tree
instead fills tuple slots positionally as value, key, counter for both comma and
bracket forms. That is a legacy implementation discrepancy to repair during the
general `For` rewrite, not an ambiguity in the public language and not a reason
to expose Less callback/key/index fields. Pin the remaining source-specific
entry shapes against public examples before direct Jess and SCSS parser tests.
Do not mis-lower SCSS tuple bindings to Less map-key/list-index roles while that
work is in progress.

`Context._getPath`, `getTree`, `resolveImportPath`, `parseString`, and module
loading are retained coordination/capability seams. In step 2, migrate only the
parser/document result path (`getTree`, `parseString`, plugin parse contracts,
and document caches) from legacy `Rules` to AST `Stylesheet`. Retain resolution and
raw-byte/JSON/module capabilities unchanged unless a later dedicated audit
decides their ownership; do not replace or delete the dispatch path while parser
closure is still in progress.

## Current parser-closure status

All four dialect packages now expose their stable public `parse()` operation as
a direct Parseman-to-`Stylesheet` route; explicitly named CST/document APIs remain
for language-service consumers. The direct grammars are still incomplete, so no
dialect has completed feature-complete parser closure. The public CSS/Less/SCSS/
Jess plugin adapters now call those direct parser operations and return the
canonical `Stylesheet` through Context; that integration is verified below but
does not claim parser or evaluator feature completion. The reductions below are
incomplete implementation toward that public route, not a second architecture
or a completion milestone.

- CSS public `parse()` directly returns `Stylesheet`. The current verified
  closure includes structured selectors and selector-to-block comment trivia,
  declaration-component comments and `!important` trivia, shared exponent
  numbers, `calc()` modulo, balanced query
  functions, conditional blocks, `@page`/margin boxes,
  `@font-feature-values`, typed static `@supports` conditions, generic opaque blocks, `@document`, nested `@scope`,
  and top-versus-nested known-block bodies. The direct public route is checked
  against the existing positive and error CSS fixture corpus. Literal CSS `@import` is now a
  top-level-only `AtRuleStatement`, never an import-resolution fact. Structured
  declaration values now carry scoped function and `var()` fallback components,
  including balanced nested component blocks; malformed or crossed delimiters
  remain rejected by grammar. Valid block comments between `url` and its opening
  delimiter lower to the existing `Url`; malformed URL payloads remain strict.
  This is a bounded value/import slice, not CSS
  feature completion: selector/value closure and corpus differential remain.
- SCSS public `parse()` directly returns `Stylesheet`. Its verified direct
  slices include static selector/comment/conditional structure, ordinary
  structural interpolated simple selectors, structural
  interpolation, complex selectors with typed combinators, static
  attributes/placeholders, selector-valued pseudo arguments, and bounded static
  non-selector pseudo arguments, interpolated
  declaration names, declaration merge modifiers, exact static `@extend`, descriptor-only `@font-face`,
  `@counter-style`, `@property` (including a typed `--custom-property` header),
  static root/nested CSS `@starting-style` and `@layer` blocks with grammar-owned
  static headers,
  root-only static CSS `@charset`, `@namespace`, and `@layer` statements through
  the existing `AtRuleStatement` fact (with Sass `//` comments remaining
  non-emitting trivia),
  static CSS `@scope` blocks through the existing `AtRuleBlock` fact, including
  their existing root, conditional, and declaration-capable nested placements,
  finite CSS `@page` plus margin-box blocks with static headers and
  declaration/comment-only bodies,
  finite `@font-feature-values` blocks with grammar-owned static `Any` headers,
  finite feature sub-blocks, and declaration/comment-only descriptor bodies,
  static CSS `@document`/`@-moz-document` blocks with recursive frame-one bodies,
  quoted/URL `@import` targets (including structural `#{…}` segments within
  quoted targets, quoted `url(...)` targets, and empty `url()` targets), static option lists, a
  bounded typed CSS-emitting `layer`-then-declaration-`supports(...)`-then-
  static media-query tail, an optional
  final variable-declaration semicolon, and unquoted interpolated
  declaration URLs as existing `Url(Interpolation)` facts; unquoted interpolated
  import URLs remain explicitly rejected. It also includes static `@for` endpoints with grammar-owned
  arithmetic,
  static custom-property tokens in typed value positions as existing `Keyword`
  facts (without changing Sass custom-property declaration semantics),
  typed static `@supports` conditions, and static CSS keyframes (including vendor headers, quoted escaped static
  names, typed selector lists, and conditional placement). The additional `@if`
  slice admits literal booleans plus static typed comparisons (`==`, `!=`,
  `>=`, `<=`, `>`, `<`) and grouped boolean structure, including its existing
  reachability inside mixin, `@each`, and `@for` bodies. Its selected bodies
  retain existing variable declarations, mixin definitions/calls, `@each`, and
  `@for` statements in authored order; a selected mixin is available to a later
  sibling through the shared source-order `If` publication model. This does not
  claim Sass bare truthiness, function predicates, comma/list conditions, or
  full Sass scope semantics.
  `@extend !optional` remains rejected until its diagnostic
  semantics have a typed AST field. SCSS media/container
  range queries need ownership redesign rather than flattening into
  `SpacedValue`; `SpacedValue` itself remains an existing undecided
  representation. Static SCSS module directives are a top-level document-prefix
  grammar and use parser-owned classification of unescaped literal paths:
  `@use "sass:name"` rewrites to `ModuleImport` / `@-use
  "#sass/name"`; clear script-module paths (including JSON) become
  `ModuleImport`; stylesheet paths become `StyleImport` / `@-compose`; and
  `@forward` is the existing `StyleImport` with `forward: true`, rendered as
  `@-export`. This is construction only: retained Context/plugin coordination
  still resolves, loads, caches, and evaluates the resulting import facts.
  Escaped or dynamic targets, plus `with`, `show`/`hide`, or prefix
  configuration, remain rejected until their typed/decoded representation exists.
- Less public `parse()` directly returns `Stylesheet`, including its direct
  static mixin subset with literal-pattern/rest parameters, named arguments,
  typed logical guards, corresponding ruleset guards, and typed indirect
  variable (`@@name`) references. Its verified current closure also admits
  escaped ordinary declaration/property identifiers, ordinary `PropertyReference`
  and the current internal `MapAccessor` values
  (pending the owner-reviewed public access-node rename), non-emitting `//` line comments, full
  direct statement bodies in detached-ruleset and `each()` forms (including
  existing typed keyframes and flat static mixin-call iterables/bindings), and
  inline `:extend(...)` rules with the same canonical statement body as an
  ordinary ruleset while retaining authored `ExtendInstruction` placement,
  `*[selector-list]` capture delimiters around its explicit static
  selector-list family (checked against ordinary selectors for that static
  subset; dynamic selector content is rejected only in capture),
  properties, a terminal declaration without a final semicolon, typed static
  `@supports` conditions, static CSS keyframes, lone typed interpolation
  preludes for `@media`, `@supports`, and `@keyframes`, and exact opaque
  UnicodeRange value/list leaves that remain outside arithmetic. Unquoted dynamic URL
  values and Less `@import url(...)` targets retain existing `Url(Interpolation)`
  facts. A lone `@{…}` import tail is likewise a typed `Interpolation`; mixed static/
  dynamic tails remain rejected until their segment model exists. Parser
  construction does not resolve any import fact. Generic at-rule headers
  remain static-only. Those are grammar-owned AST
  construction slices; named CSS colors and `transparent` lower through shared
  recognition to existing typed `Color` values while ordinary identifiers and
  `currentColor` remain non-color keywords. Less
  grammar/evaluation parity remains incomplete.
- Jess public `parse()` directly returns `Stylesheet`, including static
  selectors, semantic `$[…]` selector templates, documented `$for`
  list/range/key-value collection bindings, static unresolved typed
  `StyleImport`/`ModuleImport` facts for documented `@-` imports, and static
  first-class `Apply` facts for documented static ruleset-only selector lists.
  Documented `$ >` named mixin
  arguments lower directly to existing `CallArg { name, value }` facts; they do
  not add a dialect-local call node or binding path. Documented zero-argument
  variable-held callable statements lower directly to existing `VariableCall`
  facts; argument-bearing variable calls remain held until their typed
  argument/binding model exists. CSS `url()` values
  and documented `$[…]` declaration names lower structurally through existing
  `Url` and `Declaration.name: Interpolation` facts rather than raw source text,
  (including structured `$[…]` path segments in ordinary values and CSS
  `@import` targets) as canonical `Url` nodes, typed static `@supports` conditions, media/container
  range-query facts, `@property --name` descriptor blocks, static CSS keyframes,
  and modern CSS slash-separated function components. Existing variable-led
  call expressions remain available within those components; the slash itself
  is not bare Jess arithmetic. The documented lone `@media $(name) { ... }`
  form is a typed interpolation prelude and remains block-only; it does not
  widen generic headers or `@container`.
  Static CSS at-rules are
  carried directly by the existing canonical
  at-rule facts, including terminal static generic CSS opaque blocks through a
  shared recognition-only Parseman artifact. Jess collection literals lower to the canonical
  `DetachedRuleset`, not a CST-shaped map or opaque source fallback. Dynamic
  `$apply` targets remain rejected until `Apply` has a typed dynamic-selector
  model; static `$apply` constructs one `Apply` fact at root, rule, selected
  `$if`, mixin-definition, and `$for` body positions. `Apply` is a core
  ruleset-only, whole-selector, merge-all operation; it is not a dialect render
  policy or an ordinary `MixinCall`. R3 now
  gives `$` live/current and `$$` scoped/final references explicit
  AST lookup facts; normal declarations write both stores, while `?:` and `:=`
  retain their selected lookup/write behavior. `$[$name]` is a live/live
  dynamic variable reference; Less `@@name` remains scoped/scoped. Selected
  `$if` branch declarations now enter both stores only after branch selection;
  they are not globally precollected. Selected `$if` branch mixin definitions
  publish only when the normal source-order walker reaches their definition;
  false-arm definitions stay invisible and publication is activation-local.
  Direct `$if` conditions also carry the existing strict `not`/`and`/`or` guard
  tree, including both adjacent and spaced comparisons; mixin-only guard forms
  remain excluded. Existing direct `MixinCall`, `VariableCall`, `$apply`, and
  `$for` statements execute through the ordinary selected-body walker; typed Jess
  style/module imports are emitted as facts while their plugin-owned loading and
  resolution remains a separate follow-up. The remaining
  documented Jess direct-route blockers are canonical AST/evaluator model work,
  not parser-host, Context, or import-resolution work: `$while` has no canonical
  AST/evaluation model; member/dynamic references and module calls need the
  owner-reviewed access/call model; and
  `@-compose` modifiers/configuration plus anonymous mixin/function forms need
  typed source-fact/callable models. Do not paper over any of those forms with
  raw source, a legacy tree, or a parser-side resolver. Do not migrate plugins or
  Context results back onto a legacy tree route. Keep the existing direct
  `Stylesheet` plugin/render route while completing the remaining dialect-specific
  grammar and evaluator coverage.

For the approved parser-only slices above: new node materialization is only
parser-owned canonical AST construction; no eval/render traversal, resolver,
loader, bridge, or new runtime parse path was added. Verification proves
grammar parity and construction only, never speed.

### Audited model gates before further direct-parser admission

These are real AST/evaluator requirements discovered from the current public
grammars. They are not permission to add a raw fallback, a parser-side resolver,
or a legacy-tree port.

- CSS/Less/SCSS/Jess general-enclosed `@supports` conditions (for example
  `selector(.x)` and `(future condition)`) now use the inert, grammar-owned
  `GeneralEnclosed { form: 'function' | 'paren', name, content: Interpolation }`
  fact. `Interpolation` is the publishable public noun (the former `Interp`
  name has no compatibility alias). Its recursive Parseman content admits only
  literal structured bytes and the dialect's explicit interpolation syntax; it
  is not `FunctionCall`, `Block`, `Any`, or a parser-local raw fallback. The
  serializer keeps a `GeneralEnclosed` segment structurally protected while it
  normalizes surrounding supports syntax, including when authored content has
  private-use Unicode bytes.
- Less static `~"…"` / `~'…'` uses the existing `Quoted.escaped` fact in
  ordinary values, URLs, import targets, guards, generic static at-rule
  headers, and keyframe names; ordinary quoted backslashes do not set that
  flag. Interpolated escaped strings and `~(…)` remain model gates until the
  direct grammar emits the existing `Interpolation`/`Block` facts and the
  serializer proves their authored output; this is an integration/evidence
  gap, not a limitation of the AST-v2 value model.
  Escaped literals remain excluded from direct `@supports` and query values:
  Less preserves literal `~"…"` spelling in a direct supports condition, while
  the existing escaped `Quoted` serializer emits inner bytes. Do not widen
  either context without a supports/query-specific representation and output
  proof.
- Less attributes with `@{…}` in their name or value now form one complete
  `SimpleSelector.interp: Interpolation` token. The grammar preserves brackets,
  static namespaces, operators, quotes, and modifiers as literal parts and
  retains each variable interpolation in source order. Dynamic namespaces,
  pseudos, and extend headers remain excluded; this is selector-token structure,
  not a generic raw-selector fallback.
- SCSS nested-property outer and leaf names now accept the already-supported
  structural `#{…}` property interpolation and lower directly to ordered
  `Declaration.name` facts, inserting exactly one prefix hyphen. An own value's
  trailing `!important` stays only on that own declaration; generated leaf
  declarations retain their own priority. The body remains declaration-only:
  comments, variables, control flow, recursive nested properties, and
  `@extend` are still held for a truthful delayed-prefix placement model.
- Complete SCSS condition semantics need shared semantic `Boolean` and `Null`
  values and an explicit false/null-only truth predicate distinct from the
  existing Less exact-true predicate. Do not map a Sass comma list to `or`, and
  do not silently reuse Less comparison semantics for Sass operators. Public
  value-node approval and a comparison-policy audit are pending.
- Deferred Less `&:extend(...)` needs `ExtendStatement` retained at its authored
  placement plus a render-local placement plan. `ExtendInstruction` remains the
  correct rule-attached data. The existing static preplan sees only direct rules,
  so direct grammar admission without that execution work would silently no-op.
  Public-name approval is pending.
- SCSS `@use`/`@forward` configuration needs typed config entries and typed
  forward prefix/filter facts. An escaped or dynamic target cannot truthfully be
  classified as `ModuleImport` or `StyleImport` before evaluation; a deferred
  import fact and matching Jess lowering require an owner-reviewed public model.
- SCSS `@at-root` needs a core output-placement statement, not an
  `AtRuleBlock` or synthetic `Rule`. The pending candidate is
  `AtRoot { target: default | selector | filter, body }`, where filter records
  `with`/`without` plus typed names. It retains lexical binding scope while
  selecting an output-placement ancestry; no literal `@at-root` may reach CSS.
  Exact filter vocabulary and selector-anchor behavior require owner approval
  before parser or serializer work.
- Variable-held calls use `VariableCall { target: VariableReference, args:
  CallArg[] }`, replacing `DetachedCall` without an alias. The current Jess and
  Less grammar admits only their existing zero-argument spellings; the node can
  retain arguments, but grammar work must not invent their syntax. `$`/`$$`
  lookup mode remains on the `VariableReference`; named/spread wrapper-argument
  semantics are held until they are defined against a variable holding an
  already-invoked `MixinCall`.
- Non-terminal semicolonless bare Less calls are not a harmless extension of
  the existing `FunctionCall` statement fact: depending on the following
  tokens, Less treats them as a sequence of statements or as a selector prefix.
  The public direct route admits semicolon-terminated calls and one terminal
  call before a block/document boundary; it must not guess at the remaining
  forms or absorb them as raw text. Their complete grammar/eval model remains
  a later direct-parser gap.
- Jess collection access needs a typed `MemberReference` model distinct from
  Less `MapAccessor` and bare `PropertyReference`. All `$[…]` interpolation is
  semantically ambient member access—`$[foo]` variable-member, `$['foo']`
  property-member, `$[$name]` computed variable-member—but the current direct
  AST still encodes those three base-less forms separately as
  `VariableReference`, `PropertyReference`, and `VarIndirect` inside an
  `Interpolation`. The new model must consolidate those partial encodings and
  add left-associated explicit-target access: dot/declaration names,
  variable-member bracket names, property-member quoted names, zero-based
  signed indexes, and computed bracket keys remain distinct typed access forms;
  every `$`/`$$` lookup mode stays on its own `VariableReference`. This records
  syntax, not a decision to port Less:
  `MapAccessor` has one-based indexing, Less variable/property namespaces, and
  a raw-byte fallback, all invalid for Jess. Existing R7 controls dot-member
  ambiguity (the surface must yield exactly one variable/property declaration;
  multiple candidates within either kind or across kinds is an error). A terminal
  `?` converts any member-chain lookup miss to Nil; the enclosing node's ordinary
  Nil-collapse semantics decide the output. JS own-export policy and final
  node/field names require owner approval before parser or evaluator work.
  `$while` is not currently a documented Jess feature; do not
  port its legacy block-frame behavior without first defining its public
  control-flow contract.
- Jess static generic CSS opaque at-rule blocks have an existing terminal
  `OpaqueAtRuleBlock` model. The earlier claim that Parseman cannot macro-fuse
  their structural capture was wrong: imported recognition-only `scanTo` and
  `balanced` artifacts fuse correctly. The failed attempt imported CSS's terminal
  AST-builder grammar instead of a recognition-only artifact. Extract the opaque
  header/body capture into `internal-css-recognition`, then fuse it into Jess's
  local reduction. Do not replace that work with runtime grammar composition, a
  scanner, regex recognition, or source reparse.

### Queued after public parser closure

- Parseman needs a compile-time grammar-family abstraction for the case where
  two direct productions share the same combinator structure but substitute
  different recursive entry rules. A TypeScript helper that calls `node`,
  `sequence`, or `parser` is rejected because it hides that structure from
  macro fusion (`composeLeaf() must macro-fuse; runtime composition is
  forbidden`). Jess selector capture therefore keeps its static and
  interpolation-capable selector families explicit; do not work around this
  with a host, scanner, post-parse validation, or runtime combinator factory.
  A Parseman feature must preserve first sets, recursive rule identity, and
  macro-compiled output while allowing this parameterization.
- Generate and publish a complete Parseman railroad-diagram reference for CSS,
  Less, SCSS, and Jess in the public Docusaurus site (`packages/docs`). This
  must run from each finished public grammar (including reachable rules and
  documented terminals), be regenerated in CI or an explicit docs command, and
  link from the parser-language docs. Do not generate diagrams from today's
  incomplete direct-AST grammars or present them as the language reference.
- Design dialect-to-Jess compiled conversion around opt-in observed
  compilation facts: resolved import/file provenance and actual function-call
  outcomes determine Jess-relative paths and `@-from`/`@-use` dependencies.
  See [`DIALECT-TO-JESS-COMPILED-CONVERSION.md`](../../DIALECT-TO-JESS-COMPILED-CONVERSION.md).
  It must not re-resolve/reparse source or replace Context/plugin dispatch.
- **Final-pass output positions / sourcemaps:** replace mutable global absolute
  cursor accounting with a `trackPositions`-only composable output-fragment
  lane. Fragments retain local node-boundary markers beside string leaves;
  charset/import hoists and adjacent-block reopening move or append fragment
  references, async values resolve their slot before flattening, and one final
  linear pass produces CSS plus public absolute offsets. Reject repeated
  partial joins/counts, offset rewriting after reorder, and per-character
  objects. Preserve the current plain `string[]` maps-off path exactly. Before
  adoption, prove byte identity plus final offsets for hoisted charset/CSS
  imports, reopened adjacent rules, empty-block rollback, async replacement,
  repeated mixin placement, and imported-document origins; measure maps-off
  regression and tracked-fragment allocation against matched baselines.

## Aggressive Cutting Self-Prosecution

### Gate policy

Alpha readiness uses the staged patch gate and its focused evidence, not the
historical `origin/dev..HEAD` inventory; the aggregate mode was deleted because
it had no bounded owner or remediation. Runtime cost cuts require exact
owner contracts and measurements; semantic/parser/frontend/public changes
require behavior/build/boundary evidence without fabricated performance claims.

### Queued design audit: final-pass output positions

- **This docs pass:** no runtime traversal, node, allocation, API, or metadata
  mutation was added. The queue rejects the current `Emit.off` model because
  async placeholders and output rewrites can make eagerly stored absolute
  offsets stale.
- **Required future shape:** a cold, `trackPositions`-only fragment/marker
  lane; final flattening is the sole absolute-offset calculation. The normal
  render path must remain the existing direct `string[]` emission without
  fragment objects, marker arrays, source-map work, or a second render walk.
- **Evidence requirement:** behavior tests must cover every reorder/rollback
  path and async replacement before positions become public evidence; only a
  matched benchmark/allocation comparison may claim the maps-off path remains
  neutral.

### Current pass: typed interpolated Less extend targets

- **New traversal / materialization:** none. The existing cold extend-selector
  prepass resolves an instruction target in the same rule/frame visit that
  already resolves authored selector interpolation. No second planner pass,
  source scan, node copy, or render-time selector walk was added.
- **New node/materialization:** none. The parser retains `.@{name}` as the
  existing interpolation-backed `SimpleSelector`; the prepass replaces that
  existing selector fact with its resolved text exactly as it already does for
  rule selectors.
- **Render path:** unchanged direct string emission. `computeExtends` receives
  the resolved parser-owned target and retains its existing IR matching path.
- **Selector-template validation:** the existing ampersand composition branch
  rejects a quoted comma-list parent only when it meets a non-leading `&`
  template (for example `.fruit-&`). It adds no scan or traversal: the already
  computed canonical child string and already-carried parent branches supply
  both facts. Ordinary separate selector branches and leading `&` composition
  keep their existing routes.
- **Helper/API surface:** one private complex-selector helper deletes duplicate
  per-compound resolution bookkeeping; no public API, host, bridge, or Context
  surface was added.
- **Metadata mutations:** existing selector memo invalidation only (`_hasInterp`,
  `_hasAmp`, `_canon`); the literal-ampersand rule is preserved.
- **Evidence:** Less public parser 63/63, CSS public parser 13/13, and Jess
  public extend/at-rule compiler tests 7/7. This is correctness evidence only;
  no performance claim is made.

### Current pass: explicit-mixin ruleset placement publication

- **New traversal / materialization:** one direct `for` loop over an explicit
  mixin's already-canonical immediate body records only Rules that were actually
  rendered into child placement frames. Namespace lookup adds one ordered walk
  over those published placement facts after ordinary imported/authored facts.
  This cannot be carried by the existing `Map<Rule, Frame>` alone: the same
  canonical Rule may be placed by more than one mixin activation with different
  live bindings.
- **New node/materialization:** none. `PublishedRulesetPlacement` is tiny
  render-frame semantic state (`Rule` identity plus its existing evaluated
  child `Frame`), never an AST clone, wrapper, mutation, or cached resolver
  result.
- **Render path:** unchanged direct string emission. The fact is created only
  after an explicit mixin body has emitted; it permits a later sibling
  namespaced call to enter that exact activation and use its existing live
  variables/import facts.
- **Helper/API surface:** added private `publishExplicitRulesets`, scoped to
  explicit-mixin nested expansion; ruleset-mixins retain their normal dispatch
  path. No public operation/type changed.
- **Metadata mutations:** only append-only state on the current render Frame;
  no parent/source/frozen metadata changes.
- **Evidence:** focused canonical AST regression covers interpolated `.person`
  placement followed by `.person.sayGender()` and its captured `@gender`;
  public `mixins-interpolated` and all 11 `tests-config/namespacing` fixtures
  pass. This is behavior evidence only; no performance claim is made.

### Audit result: imported nested namespace MixinDef provenance (rejected)

- **Question audited:** can namespaced lookup consume imported `MixinDef` facts
  already published in `Frame.mixins` without adding a second registry or
  resolver?
- **Evidence:** the broad `Frame.mixins` prepass admitted the imported chain but
  regressed the existing `mixin-direct-acceptance` closure case (`@gender` became
  unresolved); the full core suite was otherwise 3194 passed, 9 skipped, and 2
  todo. A refinement using the existing Context `sourceOwnerForBody` fact kept
  core green but still left `namespacing-5.less`'s imported `secondary` member
  authored in the output. The existing namespace Context suite remains 2/2 and
  the config corpus remains 29/29 only because `namespacing-5.less` is still an
  expected failure.
- **Decision:** rejected and reverted. There is no currently sufficient existing
  provenance contract that distinguishes every imported nested definition from
  detached/selected/published definitions at this lookup boundary. Do not add a
  generic map scan, marker, side registry, or duplicate resolver as a workaround;
  reopen only with a narrowly specified import-publication fact and adversarial
  red/green coverage for both the namespace oracle and `@gender` closure case.
- **Ponytail-style review:** rejection accepted. The attempted loop was a cold
  branch, but its semantic provenance was not truthful; source-owner refinement
  was insufficient. No production change remains from this audit.

### Current pass: bubble-body async cursor

- **New traversal / materialization:** one existing source-order body loop now
  owns its direct-leaf group and numeric cursor. It replaces the prior outer
  loop plus one `emitBubbleStatement` invocation per child; no `slice`,
  `map`, copied statement array, node, wrapper, or side map is created. A
  continuation is allocated only when `flatten`, a nested at-rule, an import,
  or a selected `$if` body actually returns a promise.
- **New node/materialization:** none. Loaded imports retain their canonical
  `Stylesheet`; the renderer calls the same bubble-body placement routine with
  the importer frame and never copies children or reconstructs source.
- **Render path:** direct leaves accumulate in one shared group and stringify
  once at a real boundary. An async import resumes the same group/index after
  its loaded body completes. The import callback temporarily restores the
  legacy loaded-root placement depth while emitting that body, then restores
  the import statement depth before the cursor continues; the at-rule header
  still owns its braces and empty-block rewind.
- **Helper/API surface:** deleted `emitBubbleStatement`; added no public API.
  The local cursor is necessary to retain an exact source index across an
  asynchronous boundary without sliced tails or per-statement closures.
- **Metadata mutations:** none.
- **Review-flagged diff tokens:** `[loop/traversal]` is this pass's single
  replacement source-order cursor, which deletes the prior outer
  loop/per-statement dispatch pair and is needed to resume at an async source
  index. `[array helper]`, `[array spread/materialization]`, `[node
  construction]`, `[parent/source mutation]`, `[side map/set]`, `[routine
  error control]`, and `[materialized array/object]` are concurrent shared-tree
  work, not this cursor pass: it adds no arrays, nodes, maps, source mutation,
  or routine errors.
- **Evidence:** core build, 22 focused AST import tests (including the promoted
  async duplicate-import regression), focused AST at-rule/mixin/extend suites,
  and public `strict-imports` plus `layer` collapse:false fixtures pass. The
  repository-wide aggressive verifier still reports unrelated concurrent
  shared-diff cost-contract entries; no performance claim has been made.

### Current pass: deferred imported-callable document scope

- **New traversal / materialization:** none. `Context` records one existing
  `TreeContext` against an imported callable's already-shared body-array
  identity when the typed import fact publishes a direct `MixinDef` or `Rule`.
  This is two immediate-child publication loops that already exist (normal
  emission and the intentional extend planner); it does not walk a parsed
  document, rebuild a body, reparse source, or create an emitter ownership map.
- **New node/materialization:** none. The added session-only
  `WeakMap<object, TreeContext>` carries no AST metadata and creates no node,
  wrapper, source-parent link, or resolver result. A synthesized zero-argument
  ruleset mixin reuses `Rule.body`, so the same association covers it without a
  second representation.
- **Render path:** direct and nested mixin/reference execution asks `Context`
  to restore that body owner's existing document scope only while its current
  body callback runs. The returned `MaybePromise` retains the scope through an
  async nested import/read and restores the caller scope in both success and
  error paths. The one proven `walkBody` inline-import branch now returns its
  existing async continuation rather than dropping it; this preserves the
  cursor/order and does not broaden import resolution.
- **Helper/API surface:** `Context.rememberDocumentBody` and
  `Context.withDocumentBody` are narrow session-provenance operations derived
  from the existing document identity table. They add no parser selection,
  filesystem access, module loading, plugin dispatch, host, bridge, or
  compatibility route.
- **Metadata mutations:** none. The AST stays plain canonical source facts;
  all association is weak, session-local, and import-publication-only.
- **Review-flagged diff tokens:** `[side map/set]` is the one required
  `WeakMap<body, TreeContext>` session provenance table; it replaces no lookup
  structure, is consulted only at deferred body entry, and cannot retain an AST
  body. `[loop/traversal]` is the two existing import-publication loops gaining
  a constant-time direct-child association; no descendant traversal is added.
  The inline continuation may allocate the existing sliced remainder only when
  Context IO is actually async; it is necessary to retain the source cursor and
  replaces the prior dropped promise. All other verifier tokens are concurrent
  shared-tree work outside this pass.
- **Lifecycle evidence:** `context-provenance.test.ts` creates exactly two
  Context-registered documents and one deferred body association. It records
  five ordered ownership observations: root entry, imported-body entry,
  imported-body post-`await`, root restoration, and root restoration after a
  rejected `withSourceOwner` activation. The test also proves an unassociated
  body uses the active root owner rather than allocating provenance. This is
  test-local evidence, not a production counter or a performance claim.
- **Evidence:** core and Jess builds pass; 12 Context-backed path-resolution
  tests pass with no unhandled rejection, including explicit imported mixin and
  bare ruleset-as-mixin bodies whose nested `(inline)` reads must use the
  imported directory and then restore the root directory. Public Less parser
  tests pass 67/67 and the Less hotpath corpus completes. `benchmark.less`
  does not activate a deferred imported callable body, so it is not evidence
  for this lifecycle path and no benchmark claim is made.

### Current pass: Less guard equality for emitted keyword values

- **New traversal / materialization:** none. The existing two-operand guard
  comparison adds one constant-time cross-kind equality check before the
  existing per-kind comparator; it allocates no node, array, map, or render
  state.
- **Render path:** unchanged. Guard dispatch receives already-materialized
  values and returns a boolean; it never constructs an output value or scans
  source. The branch is limited to exact emitted-byte equality when one operand
  is the existing `Keyword` materialization of `~"…"` / `e("…")`.
- **Helper/API surface:** none. No node, public type, parser rule, Context
  method, bridge, or compatibility path was added.
- **Metadata mutations:** none.
- **Review-flagged diff tokens:** `[loop/traversal]`, `[array helper]`,
  `[array spread/materialization]`, `[node construction]`, `[side map/set]`,
  `[routine error control]`, and `[materialized array/object]` reported by the
  repository-wide diff verifier belong to concurrent parser/core work in this
  shared dirty tree. This pass adds none of those mechanisms: its only
  production addition is a scalar conditional and immediate boolean return.
- **Evidence:** the core typed comparison regression proves `3 = ~"3"` in both
  directions while `3 != 4`; rebuilt `tests-unit/mixins-guards/mixins-guards.less`
  is byte-identical. No performance claim.

### Current pass: public Less `Stylesheet` dispatch and execution

- **New traversal / materialization:** one bounded root-child scan for static
  CSS-terminal import prelude output; no node materialization. Jess passes
  the parser-owned `Stylesheet` directly to the existing AST serializer; it
  does not construct a `Rules`, bridge, aggregate document, or render-only
  node. The builtin evaluator is assembled once at module initialization and
  retained on the render Context. One `WeakMap` entry per parsed `Stylesheet`
  retains its already-known file/plugin source identity; import entry simply
  switches the existing `treeContext` and restores it. Context's cache widens
  only to hold the parsed document it already coordinates. The renderer performs
  one root-only scan when no caller-supplied import handler owns terminal import
  decisions; it writes already-typed static CSS terminal imports and retains one
  identity set solely to skip their later source positions. It does not resolve,
  load, parse, allocate output nodes, or walk nested/imported documents.
  The remaining non-value/prelude `SpacedValue` path uses the existing per-part
  fold and one existing-size output loop to read parser-owned separator bytes;
  when no newline separator is present it takes the same single-space output
  branch as before. Ordinary declaration/value arrays use `ValueSlot` plus the
  provenance layout side table described above. No source scan, list re-split,
  node, or extra side map is introduced.
- **Render path:** `Rules.render` remains only for legacy documents. A
  `Stylesheet` takes the direct serializer branch under `Context.withDocument`.
  Imports call the retained Context dispatch path from that serializer; each
  loaded document enters its Context-owned source scope and restores its
  importer afterward. External URL/protocol-relative identifiers first require
  an explicit plugin `canResolveImport` claim, then travel through the same
  resolver → locator → source → parser route. An unclaimed external import stays
  a CSS terminal; Context never fetches it. A Jess-side import callback,
  pre-flattened import wrapper, or AST-to-tree conversion is rejected.
- **Helper/API surface:** one normalized Context parser dispatch selects
  `safeParse` or the legacy throwing wrapper; callers do not acquire another
  parse/load path. `Context.withDocument` replaces two Jess-only AST scope
  helpers and the public renderer's `importDocument` callback; it owns no new
  resolution behavior. `Context.loadImport` adds only the explicit external
  capability admission before delegating to existing `getTree`; it adds no
  resolver, parser, cache, source fetcher, or reparse path. The Less plugin
  directly calls `@jesscss/less-parser.parse`.
  `buildEvaluator` is the existing typed core execution seam, publicly exported
  so Jess can pair it with the `@jesscss/fns` registry without creating a core →
  fns cycle. The public Less test configuration explicitly chooses macro-compiled
  parser output instead of attempting Parseman runtime composition.
- **Metadata mutations:** AST documents set `context.document`; they do not
  overwrite legacy `context.root`, whose meaning remains tied to the old
  evaluator until that runtime is deleted.
- **Evidence:** core and Jess builds pass; focused core AST import/value tests,
  7 public Jess API tests, 4 Context-backed path-resolution tests, and the
  isolated Less operations fixture pass. The public
  evaluator proof covers a variable, mixin, arithmetic, and builtin through the
  Less parser → plugin → Context → Jess route. No performance claim.

### Current pass: R3 live/scoped binding contract

- **New traversal / materialization:** the declaration index is one immutable,
  source-order map per body; live cells and scoped reassignment overlays are
  per activation, as required by `RESOLVER-SHAPE-SPEC.md`. No source rescan,
  parser replay, or render-only node creation occurs.
- **Render path:** variable reads select exactly one store. Live reads never
  fall through to the declaration index; scoped reads never consult live cells.
  A source-order walk activates declarations before later live uses.
- **Helper/API surface:** `VariableReference.lookup`, `VariableDeclaration.write`,
  and `VarIndirect.lookup` are mandatory public AST facts. No defaults, host,
  bridge, callback registry, or dialect-local binding model remains.
- **Evidence:** focused core AST proofs; CSS 98, Less 183, SCSS 134, and Jess 70
  parser tests; package-export, parser-boundary,
  docs, and diff checks. Fresh reviews closed live selector/import activation,
  dynamic-variable lookup mode, glued sigils, and stale public AST assertions.
  No performance claim.

### Current pass: direct Less/SCSS/Jess existing-fact closure

- **New traversal / materialization:** none. Parser reductions construct only
  existing `Interpolation`, `Url`, `ImportAtRule`, `VariableDeclaration`, `If`, and
  `Quoted` facts. No resolver, source scan, reparse, copied node, or temporary
  render node was added.
- **Render path:** one constant-time `Quoted.escaped ? value : src` leaf branch
  emits Less static unquoted strings; it adds no walk, allocation, or helper.
  SCSS/Jess ordinary backslash escapes retain `escaped: false`, so they keep
  their authored quotes. Existing URL/import and typed at-rule serializers
  otherwise evaluate the parser-owned facts. Generic Less at-rule headers use a
  separate static-only grammar because ordinary generic-header rendering does
  not retain parenthesis structure.
- **Helper/API surface:** parser-local grammar productions only; no host,
  bridge, action callback, public compatibility API, or Context change.
- **Review-flagged diff tokens:** `[loop/traversal]`, `[array helper]`,
  `[array spread/materialization]`, `[node construction]`, `[routine error
  control]`, and `[materialized array/object]` are parser-reduction work: they
  run once during Parseman construction and produce the canonical source facts,
  never on the eval/render hot path. The reduction `throw` sites are impossible
  grammar-child invariant failures, never ordinary parse misses or runtime
  control flow. This slice adds no loop, array, node, or throw to rendering.
  `[side map/set]` belongs to the separately documented R3 activation-state
  model above; this slice adds none. The repository-wide
  verifier still reports unrelated shared-diff registry entries, so it is not a
  pass/commit gate result for this uncommitted shared worktree.
- **Literal parent-suffix interpolation:** `&@{suffix}` remains the existing
  `Interpolation`-backed `SimpleSelector`, not a new selector node or parent-transform
  model. `compoundHasAmpersand` reads only literal `Interpolation` segments, never
  resolved references. The existing extend interpolation prepass carries the
  pre-mutation literal-only `_hasAmp` bit across template materialization, so
  a reference resolving to `&` never becomes a parent selector. No planner
  scan, extra traversal, or resolved-reference detection was added.
- **Evidence:** CSS parser 98/98, Less parser 183/183, SCSS parser 134/134,
  Jess parser 70/70, focused core AST acceptance 12/12, focused core import
  placement 7/7, parser-runtime-boundary 0, docs validation, diff check, and
  fresh cross-reviews. The direct Less
  route now also recognizes deprecated glued percent-format calls as the
  existing `%` `FunctionCall`; CST/direct/public parity and a static escaped
  quote argument are covered. The CSS-3 fixture additionally proves the exact
  legacy doubled-quote `url-prefix` argument, structural generic-header parens,
  and multi-token `@supports` feature values. Static CSS `ImportAtRule` facts now retain their
  canonical nested Rule placement in SCSS and Less—including mixin expansion,
  selected control flow, and post-nested-rule ordering—rather than being
  hoisted by the shared serializer. CSS still rejects nested imports and Jess's
  CSS-import spelling remains `AtRuleStatement`. Static SCSS nested properties
  now lower directly to ordered existing declarations, including empty blocks;
  the CST-valid dynamic/control-flow prefix cases remain model gates. Review
  found the generic Less interpolation escape hatch and direct Less now admits
  existing detached-ruleset facts only at its CST-valid binding, mixin-argument,
  parameter-default, and standalone-call positions. Generic declaration values
  and percent-format arguments remain excluded. Legacy raw detached fallback
  bodies remain explicitly CST-only because no typed AST fact can retain their
  payload without a raw/reparse fallback. The generic Less interpolation escape
  hatch is covered for leading, glued, and spaced forms. No performance claim.

### Current pass: direct Jess value/header closure

- **New traversal / materialization:** none. Parseman reductions construct only
  existing `Quoted`, `Url`, `Interpolation`, and at-rule facts; empty `url()` uses the
  existing `Url(Any(''))` representation.
- **Render path:** unchanged. Existing value/at-rule serialization evaluates
  those typed facts; no source reconstruction, resolution, or reparse occurs.
- **Helper/API surface:** two parser-local predicates distinguish a flattened
  header fact from its `@...` token. They keep the documented dynamic media
  spelling block-only rather than adding a host, fallback, or generic header
  path.
- **Evidence:** public Jess parser suite (51 tests), CSS parser suite (96
  tests), parser-runtime-boundary (0), diff check, and two adversarial reviews;
  the reviews found and closed empty `@import url()` and dynamic media-statement
  leakage. No performance claim.

### Current pass: canonical Jess `For`

- **Authority and deleted vocabulary:** the public Jess `$for` documentation is
  the contract. The old AST-v2 `valueName` / `keyName` / `indexName` fields were
  a Less `each()` callback model incorrectly made public; they are deleted.
  `For.binding` now retains the authored Jess single, comma, bracket, or tuple
  pattern. Less `each()` lowers at the Less parser boundary only.
- **New traversal:** `forRangeItems` adds one bounded numeric loop to enumerate
  a typed Jess `Range`; existing `forItems` still enumerates iterable entries.
  This is semantic iteration, not a later rediscovery or reparsing pass. The
  resulting entry array is current serializer control state and is not claimed
  as a performance improvement; compact streaming iteration remains a separate
  performance question.
- **New node/materialization:** `Range` is parser-owned public AST
  materialization with typed bounds, step, and endpoint inclusion flags.
  `ForBinding` is plain public AST data, not a runtime host or side map. No
  nodes are created merely to stringify CSS. A Jess value-position collection
  materializes the already-owned canonical `DetachedRuleset`; it does not add a
  new map node, compatibility tree, or render-time conversion.
- **Render path:** `expandFor` and `expandNestedFor` bind and emit the existing
  `For` body. Bracket bindings use documented key/value order; comma bindings
  use value/key-or-index/counter; tuple bindings destructure typed list entries.
- **Helper/API surface:** `range` and `ForBinding` replace three Less-shaped
  public fields. No BuilderHost, ParseHost, bridge, action registry, scanner,
  or source reparse is introduced.
- **Metadata mutations:** none.
- **Evidence:** public Jess parse/AST/render proof now covers list, range, and
  collection key/value examples from the language documentation; the Jess
  parser suite (44 tests), package build, parser-runtime-boundary check, and
  diff check pass. This establishes semantic shape only; it makes no
  performance claim.

### Current pass: typed `@supports` and general-enclosed conditions

- **Authority and scope:** `@supports` accepts typed static feature conditions,
  logical `not`/`and`/`or`, recursively nested conditions, and
  `GeneralEnclosed` function/parenthesized forms. Its content is a structured
  `Interpolation`, never `Any` or a raw/reparse fallback. Other unsupported
  dynamic forms stay rejected until they have truthful typed models.
- **New traversal:** one bounded recursive serializer walk of a supports
  prelude. It is necessary because ordinary value evaluation transparently
  removes `Block(delimiter: 'paren')` around computed operations, while supports parentheses are
  grammatical grouping and must remain in emitted CSS. No source/tree scan,
  reparse, resolver, or side-map lookup is added.
- **New node/materialization:** parser reductions create `GeneralEnclosed` only
  at its public grammar position, plus the existing `Block`, `Operation`,
  `Keyword`, `SpacedValue`, and leaf facts. No copied node, raw prelude, or
  render-only materialization is added.
- **Render path:** `@supports` writes the grammar-owned condition structure;
  ordinary value serialization is unchanged. This preserves `(display: grid)`
  rather than evaluating it into `display : grid` and losing the parens.
- **Helper/API surface and metadata mutations:** the public AST names are
  `Interpolation`, `GeneralEnclosed`, and `VariableCall`; there are no aliases
  for old `Interp`/`DetachedCall` names. No metadata mutation, host, bridge, or
  compatibility route.
- **Evidence:** direct AST shape, public parse/render, rejection matrix, Less
  package build, and parser-boundary verification. No performance claim or
  benchmark is made.

> **Removed historical staging record.** The former block here made private,
> unreachable, CST-only, or delayed-public-route claims. Those claims were
> wrong and have been deleted rather than retained as planning evidence. The
> current public parse-to-Stylesheet architecture and the sections above and
> below are the only applicable guidance.

### Declaration-merge importance propagation

- Prior pass: declaration-merge importance propagation.
- Architecture surface: `mergeFold` carries an importance signal through the existing AST evaluator; no parser, host, bridge, or compatibility surface changed.
- Separation/duplication: the merge path reuses the ordinary declaration importance contract rather than introducing a second value evaluator or render route.
- Cumulative node weight: none; the signal is one boolean on the existing emit context.
- New traversal: none.
- New node/materialization: none; the merge-only signal is one boolean on the existing emit context, preserving the ordinary declaration contract when a value reaches `Important` through a variable.
- Render path: merged declaration output remains direct string emission; the change only records the existing value-evaluation signal before writing the one merged line.
- Helper/API surface: none.
- Metadata mutations: none.
- Review-flagged diff tokens: none; the repair adds no allocation, traversal, map, clone, or error-control path.
- Hot-path cost contracts:
  ```json
  [{"id":"ast-merge-importance-signal","verdict":"accepted","costDelta":"neutral","why":"The already-admitted declaration-merge loop carries one importance bit on its existing emit context instead of allocating a per-member sink. It repairs the ordinary declaration contract for Important values reached through a variable; it makes no speed claim.","byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}}]
  ```

- Evidence: `packages/core/src/ast/__tests__/declaration-merge-direct-acceptance.test.ts` (including reset across a later merge group and ordinary declaration), the direct core AST suite, and the benchmark output oracle recorded above.
- Verdict: accepted correctness repair; no performance claim.

### Current pass: imported AST extend planning

#### Overlay ingestion stack-safety self-prosecution

- **New traversal:** two indexed loops in `collectPlan` append the existing
  render-local overlay fact arrays. They replace argument spreading, which
  converted a finite imported-loop overlay into one giant call and overflowed
  V8's argument stack at 185,268 subjects. The loops preserve source order and
  are the only pass over those arrays before the existing `mayMatch` pass.
- **New node/materialization:** none. Each loop pushes the existing fact
  reference directly; it creates neither a concatenated array nor a copied
  subject/instruction value.
- **Render path:** planner-only, reached only when extends are admitted; no
  output nodes or strings are produced.
- **Helper/API surface / metadata mutations:** none.
- **Evidence:** direct AST regression ingests 150,000 overlay subjects, above
  V8's spread argument limit. The complete 37-import Bootstrap prefix now
  completes. This is a correctness/stack-safety repair, not a speed claim.

- **New traversal:** `planImportedExtends` is the one cold pre-render import
  traversal, required before `computeExtends` so imported selectors and root
  selectors share one plan. Its `visit` cursor runs statements in source order;
  `collectPlacedExtendFacts` follows `Rule`/`AtRuleBlock` bodies and, only when a
  `For` body can carry an extend, executes the existing `forItems` +
  `bindForEntry` semantics once per item. This is not a render walk: the normal
  `emitImportAtRule`/`emitDocumentStatements` cursor is still the only output
  traversal. The static no-extend direct-AST import path retains its old
  synchronous bypass; Context imports are already MaybePromise-capable and may
  discover imported-only extends.
- **New node/materialization:** none. The deleted `{ ...root, children }` and
  `{ ...atRule, body }` synthetic planner view is gone. Selector facts are small
  extend IR values (`Branch`/`Level`), not AST nodes; no parsed node, statement,
  body array, source metadata, or wrapper is copied or mutated.
- **Placement state / allocations:** one `object` token per actually iterated
  extend-bearing `For` item, stored in a render-session
  `WeakMap<For, readonly object[]>`; one placement projection map is allocated
  only when such a token receives an extend result. The preflight otherwise uses
  its existing import-once `Set`, its existing planned-import `WeakMap`, and
  temporary selector-IR arrays necessary for `computeExtends`. Static documents
  continue to use the original per-rule maps directly: `byPlacement` is null and
  no frame-chain lookup runs.
- **Render path:** `expandFor` and `expandNestedFor` select the pre-issued token
  by the already-existing iteration index and put it on that iteration's lexical
  `Frame`. Extend projection lookup first takes the old direct map; only when
  placement results exist does it walk the bounded parent `Frame` chain to the
  nearest token. It never scans source/AST, resolves imports, or constructs an
  output node merely to stringify.
- **Helper/API surface:** all helpers are file-private (`resolvedExtendBranch`,
  `resolvedExtendLevel`, `bodyMayPlanExtend`, `collectPlacedExtendFacts`, and
  `extendProjection`). No export, compatibility shim, parser host, bridge,
  action registry, or plugin API was added. The old synthetic-root planner path
  was deleted rather than retained beside the typed-fact route.
- **Metadata mutations:** none on AST. `Frame.extendPlacement` and the two weak
  maps are render-session semantic placement state. Existing variable activation
  occurs in the preflight's private planner frame; it never publishes into the
  subsequent render frame.
- **Review-flagged diff tokens:** this pass owns the cold source-order loops in
  `collectPlacedExtendFacts`/`planImportedExtends`, selector-IR arrays, the
  planner-local token array, and `WeakMap` placement projections described
  above. They replace the deleted cloned-root/at-rule planning materialization;
  they are not on a static document's render path. The verifier's remaining
  global danger-token and cost-contract findings cover the concurrently dirty
  parser/core files listed by the command, so they cannot be attributed to this
  narrow pass in the shared worktree.
- **Evidence:** `packages/core/src/ast/__tests__/import-at-rule.test.ts` covers
  two imported loop iterations resolving to `.from-one` and `.from-two` in one
  target group, while retaining sync imports, retry/error diagnostics, and
  reference visibility (24/24). The public parser/compiler fixture
  `packages/jess/test/less/spine-guarded-mixin-forfold.test.ts` proves imported
  Less `each()` interpolated extenders (4/4). Core build passes. No speed claim
  is made; the benchmark below is a non-parity measurement only.

### Current pass: mixin-call empty accessor

- **New traversal:** `lastVarMember` performs two bounded cold-path iterations
  only after a typed `BracketLookup(index: -1)` reaches a mixin-call result
  with no emitted declaration members. It reads the existing ordered callee
  frames and their precomputed `declIndex` keys; that order is the only place
  the conventional final `@return` member exists after normal mixin emission
  intentionally suppresses variable declarations. It does not walk source
  text, parent links, or output nodes.
- **New node/materialization:** none. The accessor retains the parser-owned
  `Reference(MixinCall, BracketLookup(-1))` facts. The fallback returns the
  existing binding/value and frame; it does not clone, mutate, or construct an
  AST node or a placement wrapper.
- **Render path:** unchanged direct serialization. The fallback is evaluator
  lookup state only, reached for a value reference; it does not build output
  nodes or recover/reparse source. Non-empty declaration maps keep the existing
  ordered-list index behavior.
- **Helper/API surface:** one private evaluator helper, `lastVarMember`. It
  closes the missing half of the existing `lookupVarMember` callee-frame path;
  no exported API, host, bridge, parser fallback, or compatibility adapter was
  added.
- **Metadata mutations:** none.
- Review-flagged diff tokens: two nested `for...of` loops are confined to
  the cold empty-bracket mixin-result fallback. They are necessary to preserve
  declared candidate/source order from existing frame facts; no new map, side
  table, or materialized member list is created.
- **Evidence:** direct AST acceptance proves a typed mixin-call plus
  `BracketLookup(-1)` resolves its final local variable. The public Less
  compiler regression proves `.add(10px, 10px)[]` renders `20px`; core build
  and focused tests pass. This is a correctness repair only; no performance
  claim or benchmark is made.

### Current pass: interpolated explicit-mixin rule publication

- **New traversal:** none. The existing `publishExplicitRulesets` loop already
  visits direct `Rule` children of a selected explicit mixin definition. The
  flat `expandCall` now invokes that existing publication seam, matching the
  nested emitter's established behavior; no new lookup walk, selector scan, or
  source traversal was added.
- **New node/materialization:** no AST node/copy/wrapper. A call-specific
  lexical `Frame` is established only when a direct child Rule has not yet been
  flattened. That frame is semantic placement state: a later sibling namespace
  call can see the actual mixin-parameter bindings before the deferred rule
  render closure runs. `flatten` reuses it when it does run, so this moves an
  already-required frame creation earlier rather than creating a second one.
- **Render path:** direct emit stays unchanged. The publication has no output;
  it makes canonical nested Rule facts callable at the same lexical point that
  Less exposes them. No text recovery, reparse, or render-time AST build is
  introduced.
- **Helper/API surface:** no new helper or public API. The repair calls the
  existing private `publishExplicitRulesets` from the flat path; it remains the
  single owner of `publishedRules` placement state.
- **Metadata mutations:** existing render-local `rulePlacements` and
  `publishedRules` only; neither lives on canonical AST nodes. The placement is
  keyed by call frame, preventing an interpolated Rule shared by separate calls
  from leaking parameters across placements.
- Review-flagged diff tokens: no new traversal token. One existing cold
  publication loop now materializes a `Frame` only for an explicit mixin child
  Rule before deferred flattening; this is necessary semantic placement state
  and reused by the renderer.
- **Evidence:** the final public historical interpolated-path source now emits
  `mi-test-d { gender: "Male"; }`; a second public test proves two interpolated
  child rules retain separate `red`/`blue` call frames. Direct core mixin/value
  suites and public Less semantic suites pass. No performance claim or benchmark
  is made.

## Aggressive Cutting Self-Prosecution

- Latest pass: public AST-v2 cutover snapshot commit gate (parser, Context/plugin,
  evaluator, serializer, reference, import, and direct-route work staged together).
- Architecture surface: the staged work replaces public parser output with canonical
  AST-v2 `Stylesheet` and carries that document through the retained Context/plugin
  dispatch and direct serializer. It is not a private grammar, bridge, parser host,
  action registry, source reparse, or fallback route.
- Separation/duplication: grammar reductions own construction; Context retains
  resolution/module/source coordination; evaluator and serializer consume the same
  canonical AST. The staged snapshot intentionally removes Rules-typed public-route
  assumptions rather than retaining an AST-to-tree compatibility path.
- Cumulative node weight: parser construction now allocates canonical public AST
  facts at parse time. Render-local `Frame`, extend-planning IR, and provenance maps
  exist only where a semantic placement/source fact cannot live on the immutable
  source tree. This is a semantic cutover, not a byte-identical refactor and not a
  performance acceptance claim.
- New traversal: parser reductions walk recognized child arrays to construct typed
  nodes; source-order evaluator/serializer loops execute statements; import/extend
  planning performs its documented cold preflight only when the typed admission
  predicate finds an extend-bearing import body. No scanner, source-text pass,
  source reparse, or render-time AST walk was introduced.
- New node/materialization: Parseman reductions construct only canonical AST-v2
  nodes from recognized children. Evaluation does not build nodes merely to
  stringify. The staged `Reference` chain, import facts, `Plugin`, and direct
  dialect grammar nodes replace legacy/callback representations rather than wrap
  them.
- Render path: `Stylesheet` rendering remains direct string emission under the
  active Context document scope. Imports dispatch through `Context.getTree` and
  plugin resolution; they do not pre-splice text, bridge into Rules, or create an
  output-node tree.
- Helper/API surface: added parser-local grammar factories/reducers and private
  evaluator/serializer helpers are the narrow owners of their typed facts. Public
  operations remain `parse`, Context dispatch, and render; no BuilderHost, ParseHost,
  callback/action registry, or parser compatibility alias is added.
- Metadata mutations: canonical AST nodes remain immutable source facts. Parent,
  source-owner, lexical binding, provenance, and extend-placement data are carried
  in documented render/session Frames or Context-owned maps; no post-hoc parent
  restoration or source-tree mutation is used to recover placement.
- Review-flagged diff tokens: [loop/traversal] and [array helper] are Parseman
  reduction child classification plus existing source-order evaluator/planner loops;
  [array spread/materialization] and [materialized array/object] are canonical
  grammar child/result construction and bounded selector/planner facts;
  [node construction] is direct canonical AST construction at parse time;
  [parent/source mutation] is Context/Frame provenance and placement state, not AST
  repair; [side map/set] is render-session Context/extend/provenance state keyed by
  canonical identities; [routine error control] is grammar-child invariant failure
  or exceptional diagnostics, never ordinary parser/evaluator miss control flow.
  The staged snapshot contains several semantic feature changes, so these tokens
  cannot truthfully be treated as a neutral byte-identical change.
- Evidence: focused direct parser/core suites previously cover CSS, Less, SCSS, and
  Jess `parse() -> Stylesheet`; current staged verification independently records
  Less AST grammar 214/214, path resolution 12/12, and the full Bootstrap import
  fixture completing after the extend admission/stack-safety repairs. The remaining
  Less-alpha verifier gaps and full package/release gates are tracked separately;
  this block makes no performance claim.
- Hot-path cost contracts:
  ```json
  [{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"The retained tree already permits async container/declaration rendering, optional Context files, source-span accessor reads, DefaultGuard-owned text, inverted bitsets, raw-string or node combinators, singleton-collapsing selector-list results, parser-delivered string-or-array selector surfaces, synchronously empty mixin rendering, and mixin preparation that may return a distinct Mixin. This pass states those existing runtime facts exactly while retained consumers are removed; it does not preserve them with a shim or add another evaluator, traversal, resolver, or output policy.",
    "dangerTokensJustification":"[materialized array/object] appears in type signatures for the existing optional Context file and selector-array surfaces. [node construction] A raw selector array becomes the existing SelectorList node only at Ampersand append/resolved-selector and composed-header cache boundaries that require Selector behavior; key-set analysis keeps the raw array and uses its existing array-aware compute path. [loop/traversal] Existing registration and merge-body loops retain their exact work. The render helper overload records that an absent effect cannot produce a Promise, and Mixin registration drops a false receiver-subtype cast without adding a wrapper or runtime branch. No resolver, output buffer, side map, error-control path, or second traversal is added.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result"],
    "behaviorEvidence":"The focused Mixin suite passes 196/196, including invisible rendering and interpolated-name preparation; the preceding selector/ruleset/rules/declaration contract evidence remains green.",
    "buildEvidence":"The core package build and package-export verification pass; strict source diagnostics remain at the known 54 with no Mixin, Rules, or render-buffer diagnostic.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"parseRenderMedianMs":68.38,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: documentation and ownership review are complete for the staged snapshot;
  cost-contract acceptance remains deliberately unclaimed until each changed
  production surface has a compatible measured or exact structural contract. Do not
  invent a benchmark-byte-identity result for feature-changing parser/evaluator work.

## Parser/codegen evidence audit (2026-07-21; no performance acceptance)

This is a machine-readable evidence record, **not** an aggressive-cutting cost
contract and not a claim that the public parser cutover is performance-neutral.
It exists to prevent three different facts from being conflated: direct AST
construction, disabled runtime coverage/trace, and emitted parser code size or
allocation cost.

```json
{
  "schema": "jess-parser-codegen-audit/v1",
  "status": "semantic-cutover-measured-performance-pending",
  "parseman": "0.28.0",
  "publicRoots": {
    "css": "packages/css-parser/src/index.ts: parse() calls run(CssAstDocument, input, { trivia })",
    "less": "packages/less-parser/src/index.ts: parse() calls run(LessAstDocument, input, { trivia })",
    "scss": "packages/scss-parser/src/index.ts: parse() calls run(ScssAstDocument, input, { trivia })",
    "jess": "packages/jess-parser/src/index.ts: parse() calls run(JessAstDocument, input, { trivia })"
  },
  "normalInstrumentation": {
    "coverage": "off: no public root supplies RunOptions.instrumentation",
    "trace": "off: no public root supplies RunOptions.instrumentation",
    "profile": "off: no public root supplies RunOptions.profile",
    "testOnlyCoverage": "packages/css-parser/test/macro-compiled.test.ts creates a separate Vite transform with grammarCoverage: true and explicitly passes instrumentation"
  },
  "boundaryEvidence": {
    "command": "pnpm run verify:parser-runtime-boundary",
    "result": "0 tracked temporary sites (0 exact ledger sites)"
  },
  "directRouteEvidence": {
    "commands": [
      "pnpm --filter @jesscss/css-parser test -- --run test/public-parse.test.ts test/macro-compiled.test.ts",
      "pnpm --filter @jesscss/less-parser test -- --run test/public-parse.test.ts test/macro-compiled.test.ts",
      "pnpm --filter @jesscss/scss-parser test -- --run test/public-parse.test.ts test/parse-only.test.ts test/ast-macro-compiled.test.ts",
      "pnpm --filter @jesscss/jess-parser test -- --run test/parse-only.test.ts test/macro-compiled-ast.test.ts"
    ],
    "result": "CSS 23 focused tests; Less 67 public-route tests; SCSS and Jess focused macro/direct suites passed in the same audit run"
  },
  "generatedArtifactEvidence": {
    "method": "sha256 and literal-count inspection of current built artifacts",
    "coverageHooks": 0,
    "traceHooks": 0,
    "macroCompositionCalls": 0,
    "internalRecognitionImports": 0,
    "residual": "The generated artifacts still contain optional Parseman profile and CST-host branches. This is not active during ordinary parse(), but it is emitted code and cannot be described as AST-only collector elision or as a neutral performance change."
  },
  "requiredBeforeAcceptance": [
    "Capture an exact generated-artifact baseline after the published Parseman version is rebuilt into all four parser packages.",
    "Measure parse-only and end-to-end compiler phases under one repeatable protocol with identical semantic fixture coverage.",
    "Determine whether profile/CST-host code emission is intentionally retained by Parseman 0.28 or should be removed in a separately reviewed codegen change.",
    "Do not add an aggressive-cutting cost-contract record until the changed owner surface, output identity scope, and measurement are known."
  ]
}
```

### Parseman 0.28 release evidence (2026-07-21)

Parseman PR #42 was prepared on `release/grammar-semantic-coverage` (head
`572a614`) and merged at `aa1e7d2`; all seven review threads are resolved,
including the later CodeRabbit/Greptile follow-up fixes. The released
`parseman@0.28.0` package is published and its clean packed-consumer proof
imports the required public coverage/trace exports
(`runWithGrammarCoverage`, `createGrammarCoverageCollector`,
`createGrammarTraceSink`, and `compile`). Parseman's own release checks passed:
typecheck/build, changelog/docs build, 112 test files with 1,826 passed and 4
skipped, the immediate rerun of all 20 performance tests, and `perf:guard`.
`npm view parseman@0.28.0` reports the package published on 2026-07-21 at
19:09:21Z. No separate git tag was present in the inspected local refs; the
published artifact came from the reviewed release branch merged to `main`.
Jess's frozen offline install also resolves only `parseman@0.28.0` and passes;
all four parser packages build against it. Normal public parser/compiler/CLI
routes remain instrumentation-off; coverage and trace are opt-in test or
diagnostic builds only.

The follow-up `parseman@0.28.1` FusedRule declaration-contract correction was
published after its release-branch review and verification. Jess now consumes
that real package release: forced frozen installs resolve `0.28.1`, all four
parser packages rebuild against it, and the strict 22-configuration type gate
passes. Normal public parser/compiler/CLI routes remain instrumentation-off;
coverage and trace remain opt-in test or diagnostic builds.

### Release-gate attribution (2026-07-21)

### Recorded Direct Less built-artifact benchmark (superseded pending clean rerun; 2026-07-21)

This is the first matching record for the **published-Parseman, built direct
parser**. It is retained for investigation, but is not the release baseline:
the worktree has since changed and the numbers must be superseded by one
matched, clean build before they establish a gate. It is not an A/B and does
not establish a regression against the historical private/source driver.

| Phase | Exact protocol | Recorded result |
| --- | --- | --- |
| Direct parse | `packages/less-parser/lib/index.js` SHA-256 `a70424fcb473cbd0a5bdab155668ec7b6d40fee1e5ff9de2613e58c4475d309b` (1,811,614 bytes), built at `3a8808ef` (2026-07-21); `parse(source)` on `packages/jess/benchmark/benchmark.less` (106,802 bytes); Node v24.11.1 arm64; 20 warmups + 3×45 samples | **60.971 ms** median; p25 59.303, p75 62.396, p90 64.217. The returned `Stylesheet` has 677 children; stable JSON snapshot is unchanged at 957,390 bytes, SHA-256 `2ba996a1c46eb6d77ce8f1748b35d1135848c128104e00f46dadf7e9651c53bd`. |
| Public Compiler | `node scripts/measure-less-hotpath.mjs --fixture packages/jess/benchmark/benchmark.less --iterations 45 --warmup 20 --repeat 3 --trim 0.1 --json`, built at `3a8808ef`; built `jess`, `plugin-less`, and `plugin-less-compat`; same Node/fixture | **79.823 ms** round-median across 135 samples; p25 77.956, p75 82.030; 4.39% sample RSD / 0.76% round RSD (`usable`). Output remains 122,390 bytes, SHA-256 `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`. |

The plugin's `safeParse()` calls the same public `@jesscss/less-parser.parse`,
so the two measurements share the canonical frontend. Their difference is not
a phase attribution: the Compiler measurement also includes Context/plugin,
document, evaluation, and rendering work. It does establish that direct parse
is the dominant measured phase on this fixture.

### Current direct Less baseline (verified 2026-07-22; no A/B claim)

The current built direct parser artifact is
`packages/less-parser/lib/index.js`, 1,827,807 bytes, SHA-256
`a08118e3232766447c327950eda1909ac11b0e6b35051acabdfab21ae03438a1`. Against
the 106,802-byte `benchmark.less` fixture on Node v24.11.1 arm64, 20 warmups
and three 45-sample rounds produced direct-parse medians of 64.402, 60.319,
and 60.210 ms; the round median is **60.319 ms**. The returned `Stylesheet`
has 677 children and its stable JSON snapshot is 946,987 bytes,
SHA-256 `8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c3`.

The matching public Compiler run was
`pnpm run measure:less:hotpath -- --fixture packages/jess/benchmark/benchmark.less
--iterations 45 --warmup 20 --repeat 3 --trim 0.1 --json` at dev commit
`b3ab56d61acd8d3d2b130f73fec3abbd099c137a`. Its round medians were 74.759,
82.314, and 73.645 ms; the usable round median is **74.759 ms**. The output
is 122,723 bytes, SHA-256
`2ab6d3fd8f322df0fbe7c1a481b528ec50a7fb035604b744c7543397d56b3fe`.

These are current baselines only, not a Parseman-version A/B or a timing
acceptance claim. The output/hash change from the older 122,390-byte anchor is
first evidenced with the recursive Less parser argument repair (`212e132ea`),
before the later strict-unit and Context-option wiring changes; no causal
performance claim is made for those later changes.

### Independent Less timer-boundary audit (2026-07-22; no causal claim)

An independent read-only audit reran the same 106,802-byte
`packages/jess/benchmark/benchmark.less` fixture on Node v24.11.1 arm64 from
the measured `dev` artifact at `1564f0519` (the later barrel-only `62f5407ed`
commit does not change the parser bundle). The public end-to-end command was
`node scripts/measure-less-hotpath.mjs --fixture packages/jess/benchmark/benchmark.less
--iterations 45 --warmup 20 --repeat 3 --trim 0.1 --json`; it produced 135
samples with round-median **75.0169 ms** (trimmed sample median 74.7203 ms).
The timer starts at `scripts/measure-less-hotpath.mjs:421`, immediately before
`await compiler.render(file)`, and stops at `:425`. Consequently it includes
`Compiler.prepareRender` (config/plugin/context setup), Context file loading and
plugin parsing, AST evaluation, serialization, and post-processors; it is not a
parse-only timer. `Compiler.render` confirms this composition at
`packages/jess/src/index.ts:1169-1177`, with `getTree`/parse in
`prepareStylesheet` (`:1072-1095`) and serialization in `renderStylesheet`
(`:1098-1115`). The output in this run remained 122,723 bytes,
SHA-256 `2ab6d3fd8f322df0fbe7c1a481b528ec50a7fb035604b744c7543397d56b3fe`.

The matching direct public-parser measurement used the same fixture, 20 warmups,
and three 45-sample rounds around `parse(source)`. The public boundary is
`packages/less-parser/src/index.ts:27-33`: Parseman `run(entry, input,
{ trivia })` followed by the complete-`Stylesheet` check. Round medians were
59.091, 59.037, and 58.683 ms; round-median **59.037 ms**. The result had 677
children; `JSON.stringify(document)` was 946,987 bytes with SHA-256
`8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c3`.

For a same-input control, `parseLessCst(source)` through
`packages/less-parser/src/cst.ts:4-10` measured round-median **19.759 ms**
(19.615, 19.759, 20.454 ms). This is useful evidence for the historical
20–30 ms class, but it is a different output boundary (legacy CST construction)
and is not an AST-v2 or Parseman-version A/B. The historical 33.65 ms figure was
a Vite/source `renderAstFile` partial-driver phase (20 warmups/N=60), while
24.42 ms was a Parseman 0.27-era built-parser floor. Current grammar requires
`composeLeaf`, which pre-0.28 Parseman packages do not export, so neither figure
can be presented as a matched regression baseline.

A separate `node --prof` run (20 warmups + 180 direct AST parses) produced
11,176 ticks, including 4,307 JavaScript ticks. Within the JavaScript table,
named generated Less-parser bundle frames accounted for 3,935 ticks (~91.4% of
JavaScript samples), regex engine entries for 353 ticks (~8.2%), and core JS for
19 ticks. The largest named frames were `DirectLessStaticPseudo` (167), an
opaque generated reducer (`_13f08895__pf260`, 158), `DirectLessValueAtom`
(151), `DirectLessStaticNthPseudo` (126), `DirectLessTopProduct` (122), and
generated value/reducer helpers (`_pf273` 119, `_tf2` 118); `isValueNode` took
104 ticks. These are ranking evidence, not a regression diagnosis.

The five investigation candidates, in evidence order, are: (1) the generated
reducer call graph/fused output; (2) selector pseudo/nth shared-prefix choices;
(3) recursive value/math reducer chains; (4) generated reduction type guards
such as `isValueNode`; and (5) the always-enabled trivia path plus regex-heavy
recognition. The next causally useful performance experiment is a matched
rebuilt-bundle A/B (same Parseman release, absolute-path-normalized generated
identifiers, same source/output hashes), with opt-in choice-arm/rollback trace
for candidate (2). The same-bundle trivia isolation below is a diagnostic
control and does not satisfy this reducer/choice comparison. Until the
causally isolating experiment exists, these measurements remain baselines and
no parser regression cause or speed claim is accepted.

### Superseded direct Less performance refresh (2026-07-21; historical, no A/B claim)

After the subsequent AST/list and F5 work, the rebuilt Less parser artifact is
1,822,568 bytes with SHA-256
`99630b5a18e658479b1717d73e2f5e5f9ee72dda64d669217f8deb9fe11e3ac9`. Under the
same Node v24.11.1 arm64, `benchmark.less`, 20-warmup/three-45-sample
protocol, direct parse round medians were **67.86, 69.78, and 68.05 ms**;
aggregate median **68.38 ms** (p25 66.40, p75 70.42, p90 73.03). The parsed
stylesheet still has 677 children and the 946,987-byte snapshot is unchanged
(SHA-256 `8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c`).
The public Compiler hot-path round median was **85.86 ms** under the same
protocol, with the then-current 122,390-byte CSS output. This record and its
`ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6` hash are
historical and superseded by the current 122,723-byte output above.

Fresh V8 sampling over 150 direct parses attributed 8,903/10,165 samples
(87.57%) to generated Less-bundle frames, 377 (3.71%) to GC, and 246 (2.42%)
to core. This identifies generated reducer execution as the dominant measured
phase, not a specific regression. The current artifact still contains optional
profile (1,698 references) and CST-output (411 references) branches, while
coverage/trace/composeLeaf hooks are absent from normal output. No parser
performance acceptance or regression claim is made until a matched Parseman
0.27/0.28 generated-bundle A/B exists.

### Clean Parseman 0.28 identity refresh (2026-07-22; no A/B claim)

The clean detached `parseman@0.28.0` worktree and current `c53c001bb` worktree
were rebuilt sequentially and measured on the same Apple arm64 host with Node
v24.11.1, `benchmark.less` (106,802 bytes), and 20 warmups followed by three
45-sample rounds. The detached direct parser's round medians were 60.205,
60.697, and 61.305 ms (round median **60.697 ms**); the current `c53c001bb`
parser's were 61.613, 60.539, and 61.084 ms (round median **61.084 ms**).
Both returned 677-child `Stylesheet` documents with the same stable 946,987-byte
JSON snapshot, SHA-256
`8e3a371bd286ff2682ee08d56c451274a94b14203be8de68ad2057aa6cc13c3`.

The public Compiler hot-path refresh (same protocol, `--trim 0.1`) measured
**78.201 ms** round-median in the detached worktree and **75.859 ms** in
`c53c001bb`; the latter's aggregate trimmed median was **75.650 ms**, round RSD
1.099%, classified `usable`. Both explicit Less plugin routes produce the same
122,723-byte CSS, SHA-256
`2ab6d3fd8f322df0f0be7c1a481b528ec50a7fb035604b744c7543397d56b3fe`.

The generated Less bundle is 1,822,568 bytes in both worktrees, but its digest
differs (`cda51323a0e453ad4e0381ce1aa446a4dc44f9858064424553324101840ae4d5`
detached; `6b615885eb3fb995dc84dba4b2d76ae09f63d4f00fe8f3a1b767d109d331baa8`
at `c53c001bb`) because Parseman-generated reducer identifiers include the
absolute worktree path. This is not a semantic or output difference, but it
means the runs are not a binary A/B. The older 122,390-byte
`ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6` digest is
from a superseded artifact and must not be attributed to `c53c001bb`.

V8 sampling of 200 direct parses in the detached 0.28 artifact recorded 9,633
samples: 5,717 (59.35%) in named `_r_DirectLess*` reducers, 1,612 (16.73%) in
other generated `_fb/_r_` reducers, and 1,166 (12.10%) in other parser-bundle
helpers (88.18% combined parser-bundle frames); GC accounted for 311 (3.23%).
This identifies generated reducer execution as the dominant cost surface, not a
safe first-set or combinator rewrite.

This remains a baseline refresh, not a Parseman version A/B. The workspace
grammar imports `composeLeaf`, which is exported by `parseman@0.28.0` but not by
the 0.27 package; all current parser manifests require `^0.28.0`. Rebuilding
against 0.27 would therefore require changing the grammar/API and would not be
a matched comparison.

Historical values must not be treated as an A/B: the former 33.65 ms direct-AST
figure was a Vite/source `renderAstFile` partial-driver phase (20 warmups/N=60),
and the 24.42 ms figure was a Parseman 0.27-era built parser floor. Current
grammar imports `composeLeaf` in all four AST frontends; npm packages 0.26.0 and
0.27.1 do not export that symbol, while 0.28.0 does. Therefore the current
grammar cannot produce a valid 0.26/0.27 generated-bundle comparison without
changing the grammar; no such comparison may be reported.

The 2026-07-21 refresh is likewise **not an A/B**. The generated bundle grew by
13,783 bytes from the preceding recorded artifact while semantic cutover work was
landing. The stable AST snapshot and public output digest prove only that the
measured inputs/outputs are still the canonical ones; they do not isolate a cause
for the 2.35 ms direct-parse movement or the 2.33 ms compiler movement.

Independent current evidence:

- Fresh V8 CPU sampling over 150 direct parses of the refreshed artifact recorded
  9,165 sampled frames: 8,144 (88.86%) were generated Less-bundle frames and 307
  (3.35%) were GC. The earlier leaf-only sampling was a different denominator and
  must not be compared numerically. Both observations establish generated grammar
  execution as dominant, but neither identifies a particular choice/backtrack or
  AST factory as causal.
- Allocation sampling over 30 direct parses attributes 515,240 of 1,303,176
  sampled bytes to emitted reducer frames. It establishes material allocation
  in the generated parser, not how much is retained canonical AST versus
  transient recognition/capture state; do not call it an AST-allocation result.
- Provenance is not a plausible whole-parser explanation: Less invokes
  `withSourceSpan` at only two grammar reductions. Trivia is a live candidate:
  `run()` always creates `_triviaLog` and the refreshed built bundle contains
  1,941 `_triviaLog` references, while public `parse()` discards that result. Its
  cost has not yet been isolated.
- `composeLeaf` is macro-time, not a runtime composition layer: the refreshed
  built bundle has no `composeLeaf(` call and normal public parse supplies neither
  profile nor coverage/trace instrumentation. The same bundle still emits optional
  profile (1,694 `_pmProfile`) and CST-host (411 `_parsemanCstOutput`) branches;
  whether their normal-path predicates are material requires a separate
  generated-code A/B, not inference from literal counts.
- Current non-coverage artifacts cannot provide branch/rollback counts: they
  contain no `_grammarTrace` hooks. A same-source coverage-enabled diagnostic
  build is the required next measurement for choice/backtracking; it must remain
  outside normal parser and benchmark routes.

### Matched optional Parseman instrumentation-guard isolation (2026-07-22; diagnostic, no speed claim)

The optional Parseman profile and CST-output guards were isolated in a temporary
copy of the current built Less parser. Side A was the committed
`packages/less-parser/lib/index.js` (1,827,807 bytes, SHA-256
`a08118e3232766447c327950eda1909ac11b0e6b35051acabdfab21ae03438a1`). Side B
was generated from that exact file with only the normal-path reads of
`_ctx._pmProfile` replaced by an undefined diagnostic binding and
`_ctx.build?._parsemanCstOutput` replaced by `false`; the temporary copy was
not a public or benchmark artifact. B was 1,812,467 bytes, SHA-256
`05703701303497689f1e3ffe85ad7ba8de139cf99c434f852b145d1241886767`.

The fixture was `packages/jess/benchmark/benchmark.less` (106,802 bytes,
SHA-256 `abe392656c8a50e9d175c3b0e60415893a8eb7bfe9050518227391430d3a3d48`)
on Node `v24.11.1` arm64. Both sides received 20 warmups and three 45-pair
rounds; each pair alternated A/B order. Every parse returned a 677-child
`Stylesheet`; stable JSON was 946,987 bytes with SHA-256
`8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c3` on both
sides. Round medians (A/B) were 59.470/59.458, 60.039/59.696, and
59.892/59.692 ms. Aggregate medians were A 59.918 ms and B 59.649 ms; the
paired B−A delta median was +0.139 ms and mean +0.307 ms, with B faster in
62/135 pairs and slower in 73/135 pairs.

This matched isolation detects no material normal-path cost from these
optional profile/CST guards and does not justify a production optimization or
a parser-speed claim. The guards remain required for opt-in Parseman profiling,
CST diagnostics, and future trace/coverage work; ordinary parse and benchmark
routes remain uninstrumented.

**Diagnostic result (2026-07-21):** the same-source coverage-enabled Less
transform completed `benchmark.less` and exposed 14,330 failed
`DirectLessStaticNthPseudo` entries plus 10,878 failed
`DirectLessStaticPseudo` entries. Generated output confirms that both are only
gated by `:` before their whole structural-node rules run. This identifies a
shared-prefix candidate, but the trace has 241 stable rule IDs and zero
choice-arm IDs, so it cannot attribute a failure to a name, argument, or
rollback branch. Do not make a speculative first-set rewrite from those totals.
The next Parseman-only diagnostic design is
[`parseman-diagnostic-trace-design.md`](../parseman-diagnostic-trace-design.md):
add opt-in stable choice-arm tracing while preserving all existing rule IDs,
then run its adversarial near-prefix matrix before choosing one structural
trie/residual experiment. Normal parser and benchmark routes remain
uninstrumented.

### Matched Less trivia isolation (2026-07-22; diagnostic, no production speed claim)

The first valid same-bundle isolation after the generated-artifact identity
audit measured only the runtime trivia handoff. Both sides were rebuilt from
`eae9c7832` with `parseman@0.28.0` and the same generated Less parser source.
Side A is the public `run(entry, input, { trivia })` route. Side B is a
temporary diagnostic copy of that generated bundle with exactly that call
changed to `run(entry, input, {})`; no grammar, AST reducer, or source fixture
was changed. The temporary copy is not a public or benchmark route and was not
committed. The generated A artifact is 1,827,807 bytes, SHA-256
`9a547b2d466b2a9e9f3fd7dc044a8031f6997149d491b263c7818e8be951a5bc`; B is
1,827,799 bytes, SHA-256
`f3f83b11936ecee597b50bb9ab5c98e70752cf129fa49d8568481724f726cf04`, with
the expected single wrapper substitution.

The fixture was `packages/jess/benchmark/benchmark.less` (106,802 bytes,
SHA-256 `abe392656c8a50e9d175c3b0e60415893a8eb7bfe9050518227391430d3a3d48`).
On Node `v25.9.0`, the paired protocol used 20 warmups followed by three
45-pair rounds, alternating A/B order (135 timed parses per side). A's round
medians were 58.6923, 58.0804, and 58.3212 ms (sample median 58.2974 ms,
mean 59.9382 ms); B's were 57.5564, 57.9407, and 58.2123 ms (sample median
57.9357 ms, mean 59.3542 ms). The paired B−A delta median was −0.5440 ms and
mean −0.5840 ms, with 70/135 B wins. Both returned 677-child `Stylesheet`
documents whose stable JSON is 946,987 bytes with SHA-256
`8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c3`.

This is evidence that trivia bookkeeping is a measurable candidate on this
fixture (directionally about 0.9% in this run), not an accepted speedup: the
paired deltas ranged from −48.05 to +53.17 ms and the no-trivia side is only a
diagnostic isolation. Any production change must preserve authored trivia
semantics and repeat this test under the canonical Node/round protocol before
claiming a performance result.

### Current matched Less trivia isolation (2026-07-22; diagnostic, no speed claim)

The same diagnostic was rerun against the current clean `dev` parser artifact
after the latest Less/fns changes. Side A is the committed
`packages/less-parser/lib/index.js`; side B is a temporary copy with exactly
one textual substitution in the public parser wrapper:
`run(entry, input, { trivia })` → `run(entry, input, {})`. No grammar source,
generated reducer, Parseman dependency, or fixture changed between sides. A is
1,827,807 bytes (SHA-256
`a08118e3232766447c327950eda1909ac11b0e6b35051acabdfab21ae03438a1`); B is
1,827,799 bytes (SHA-256
`1a9798a7ddf712b480b58abc5a1ae3b8d15bf1fade467e28312bcaad82f6e868`).

The fixture is `packages/jess/benchmark/benchmark.less`, 106,802 bytes,
SHA-256 `abe392656c8a50e9d175c3b0e60415893a8eb7bfe9050518227391430d3a3d48`.
On Node `v24.11.1` arm64, the paired protocol used 20 warmups per side and
three 45-pair rounds with alternating A/B order. Both sides returned a
677-child `Stylesheet`; stable JSON was 946,987 bytes, SHA-256
`8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c`, byte
identical across A and B. A's round medians were 58.4782, 59.0490, and
59.6915 ms (sample median 59.0490 ms, mean 60.1277 ms); B's were 59.1712,
59.1683, and 59.5038 ms (sample median 59.2237 ms, mean 60.6329 ms). The
paired B−A delta median was +0.2384 ms and mean +0.5053 ms; B won 57/135
pairs and lost 78/135, with a −27.5054 to +26.6878 ms range.

This is a valid current generated-bundle isolation, but it is noisy and does
not support a production speed claim: disabling trivia in the diagnostic copy
was directionally slower in this run. It supersedes neither the public trivia
semantics nor the requirement for an accepted production optimization. The
temporary B artifact was deleted after measurement.

`verify:aggressive-cutting-review` compares the working `dev` tip with
`origin/dev`; this is a 96-commit, 237-file integration delta (+12,490/-40,189
lines), not a small release patch. `6734da512` alone changes 34 production
surfaces. Therefore an accepted whole-snapshot record would be false: direct
grammar reductions, evaluator/serializer semantics, Context document dispatch,
provenance, and extend placement all introduce or replace real runtime work.

The audit must stay split by ownership; changing the verifier base, running only
staged mode, or assigning blanket `neutral-or-negative` contracts would hide the
unreviewed cutover and is rejected.

For an alpha release snapshot, `release:alpha:check` invokes the aggressive-cutting
verifier with `--mode=release`. That mode keeps the registry, self-prosecution,
and source-metadata checks, while treating the full `dev` → `alpha` squash diff
as historical aggregate rather than re-prosecuting every old hunk. Package/API
safety remains a separate, later release-check responsibility.

| Audit family | Current files | Existing behavior evidence | Required acceptance evidence |
| --- | --- | --- | --- |
| Cold exports, diagnostics, and CST-only API cleanup | `ast.ts`, `index.ts`, `value.ts`, `error/{codes,diagnostics}.ts`, CSS README/CST surfaces | package/API tests and public CST tests | Exact cold-path reachability plus a current package/API run; these are the only candidates for narrow neutral contracts. |
| Direct Parseman frontends | CSS/Less `ast/grammar.ts`, parser public entries, shared grammar files | parser AST/public/macro suites; parser-runtime boundary proof | generated-artifact parse-only baseline, rule coverage, and per-family allocation/choice evidence. No legacy-parser timing is a substitute. |
| Canonical engine | `ast/{at-rule,evaluator,mixin-dispatch,value-*.ts,nodes.ts,serialize.ts}`, `context.ts`, `plugin.ts` | direct acceptance, import, mixin, value, Plugin, and public Compiler suites | individual fact-flow/admission contracts for each added state/traversal plus matched parse-render and render measurements where work is hot. |
| Extend/provenance placement | `ast/extend/{ir,plan,emit,solve}.ts`, `ast/provenance.ts` | direct extend cases, imported-loop fixture, Bootstrap completion | admission counters for the imported-extend preflight, projection/overlay allocation proof, and Bootstrap plus benchmark non-regression. |

Historical compiler-oracle captures below use the superseded 122,390-byte
output (`ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`).
They remain evidence for their individual slices, but are not the current
output anchor and do not prove the semantic cutover is performance-neutral.
The current output anchor is 122,723 bytes / SHA-256
`2ab6d3fd8f322df0fbe7c1a481b528ec50a7fb035604b744c7543397d56b3fe` above.

### Serializer family audit: leaf emission (2026-07-21; no acceptance claim)

`packages/core/src/ast/serialize.ts` is still one physical file, but it must not
be treated as one cost surface. The current ownership split is:

| Family | Current owner | Boundary |
| --- | --- | --- |
| source-order collection | `emitDocumentStatements`, `emitNestedBody`, `walkBody` | statement order, async cursor, and declaration-group boundaries |
| reference lookup | `resolveReferenceResult` plus typed value/mixin dispatch | resolve a `Reference` chain without a source-text recovery path |
| selector resolution | selector interpolation/composition helpers plus extend planning | selector bytes and placement projection before rule emission |
| import preparation | `prepareBodyPlugins`, `planImportedExtends`, typed import dispatch | document/session facts before their source-order execution |
| leaf emission | `mergeFold`, `emitLeaf`, `emitNestedLeaf` | direct declaration/comment/call/at-rule byte emission |

The bounded audit family is **leaf emission**. It owns a `Leaf` already selected
by the source-order family and emits bytes directly. It must not acquire a
dialect policy, AST copy, output-node materialization, resolver re-walk, or a
second grouping pass. `mergeFold` is admitted only after the existing
`groupHasMerge` scan; ordinary leaves go straight to `emitLeaf`/
`emitNestedLeaf`.

- Behavior evidence: `pnpm --filter @jesscss/core test -- --run
  src/ast/__tests__/declaration-merge-direct-acceptance.test.ts
  src/ast/__tests__/at-rule-direct-acceptance.test.ts
  src/ast/__tests__/opaque-at-rule-block.test.ts
  src/ast/__tests__/import-at-rule.test.ts` — 37 tests passed.
- Current whole-render output anchor: `WARMUP=20 N=45 node
  packages/core/perf/bench-extend.mjs` emitted 122,390 bytes, SHA-256
  `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`, median
  74.0 ms (min 69.1, max 82.8). This measures the whole compiler route, **not**
  leaf emission, and is intentionally not a speed claim.

No aggressive-cutting cost-contract record is accepted for this audit: no
leaf-emission machinery was deleted or changed, and a total-render timing cannot
prove a leaf-only cost delta. A future leaf change needs a matched family-local
counter or profiling attribution, the canonical benchmark non-regression
protocol, and byte identity before it may claim neutral/decrease.

## Aggressive Cutting Self-Prosecution

### Current pass: alpha release snapshot review boundary

- **Architecture surface:** the review CLI adds a release-only evidence mode;
  production parser, evaluator, lookup, render, and package code are unchanged.
- **Separation/duplication:** default working review and `--mode=staged` retain
  their existing patch-scoped changed-path, danger-token, and cost-contract
  enforcement. `--mode=release` reuses the same registry and self-prosecution
  validators while omitting only historical aggregate squash accounting.
- **Cumulative node weight:** none; no production runtime code changes.
- **New traversal:** none in production. The verifier deliberately avoids Git
  changed-path and diff collection in release mode.
- **New node/materialization:** none in production. Focused tests create only a
  temporary Git sandbox to prove the CLI boundary.
- **Render path:** unchanged.
- **Helper/API surface:** one internal CLI mode is added and invoked directly by
  `release:alpha:check`; no package script alias or public production API is
  added.
- **Metadata mutations:** none in production or package metadata beyond the
  existing root release-check command.
- **Review-flagged diff tokens:** none in production; the test fixture stages an
  intentional loop/array token only to prove staged mode still rejects it while
  release mode does not inspect the aggregate patch.
- **Evidence:** focused verifier tests cover strict staged behavior, release
  evidence-only behavior, and rejection of malformed Handoff and registry
  evidence; direct default, staged, and release CLI invocations are rerun.
- **Verdict:** accepted release-orchestration boundary with no runtime or
  performance claim.

### Current pass: alpha squash pre-commit dispatch

- **Architecture surface:** the root pre-commit orchestrator selects the
  aggressive-review mode from the exact current branch name; no production
  package or runtime source changes.
- **Separation/duplication:** only staged commits on branch `alpha` map to
  release-snapshot evidence review. `dev`, feature branches, detached heads,
  and ordinary staged commits retain strict `--mode=staged`; pre-push keeps its
  existing workflow mode.
- **Cumulative node weight:** none; no production runtime code changes.
- **New traversal:** none in production. Pre-commit performs one cold Git branch
  query before invoking the existing verifier.
- **New node/materialization:** none in production or verification state.
- **Render path:** unchanged.
- **Helper/API surface:** two script-local helpers isolate branch discovery and
  mode selection; no package export or public API is added.
- **Metadata mutations:** none.
- **Review-flagged diff tokens:** none in production; branch selection is cold
  release orchestration.
- **Evidence:** the focused pre-commit test runs the real orchestrator in a
  temporary Git clone with a recording `pnpm`, proving `alpha` requests release
  mode and `dev` requests staged mode without bypassing the hook.
- **Verdict:** accepted exact-branch release dispatch with no runtime or
  performance claim.

### Current pass: direct AST `DocumentContext` provenance

- **Architecture surface:** canonical documents now retain `DocumentContext`
  rather than constructing the legacy `TreeContext`. Context still owns the
  existing plugin resolve → locate → source → parse dispatch; only the active
  source identity/options carrier changed.
- **Separation/duplication:** source identity and plain import-request facts
  are now defined once outside legacy tree node machinery; the existing Context
  plugin dispatch remains the only import-resolution route.
- **New traversal:** none. Switching a document or deferred body assigns its
  already-known source identity; resolver, diagnostics, URL rewriting, and
  file-reading consume that carried fact without a tree/source walk or reparse.
- **New node/materialization:** one `DocumentContext` replaces the previous
  per-document `TreeContext` allocation. It contains only resolved options,
  file identity, and parser plugin—no rules scope, selector cache, placement,
  or AST node materialization. Legacy `TreeContext` remains confined to legacy
  tree execution until its dedicated deletion pass.
- **Render path:** direct AST diagnostics and fns file resolution read the
  Context `sourceContext` fact. A canonical render therefore does not enter a
  tree context; legacy execution retains the same structural source-fact
  accessor while it exists.
- **Helper/API surface:** `DocumentContext`/`SourceContext` are the explicit
  public source-identity contract. Plain plugin import request options moved out
  of legacy `tree/import-style`; tree-only postlude data remains local as
  `LegacyImportOptions`. No bridge, resolver, parser host, or compatibility
  parser was added.
- **Metadata mutations:** none. Source identity remains Context-owned session
  state keyed by canonical document/body identity.
- **Evidence:** core build; Context provenance/safe-parse tests; fns `data-uri`
  tests; package-export and Jess API verification. No performance claim.
- Behavior evidence: Context provenance/safe-parse and fns data-uri tests prove
  canonical documents use `DocumentContext` while retained tree callers still
  receive the same source facts.
- Build evidence: `pnpm --filter @jesscss/core build` completed after the
  public type/export extraction.
- Boundary evidence: package-export and Jess API verification passed; the
  review verifier's hunk tests reject root, eval, selector, and spine changes.

### Current pass: direct Less performance evidence refresh (documentation only)

- **New traversal:** none. No production or generated-parser source changed.
- **New node/materialization:** none. The direct parser snapshot is recorded only
  to prove the measured canonical result shape stayed stable.
- **Render path:** unchanged. The public Compiler measurement exercised the
  existing Context → plugin → `Stylesheet` → serializer route.
- **Helper/API surface:** none.
- **Metadata mutations:** none.
- **Evidence:** rebuilt artifacts plus the exact 20-warmup/3×45-sample direct
  parse protocol and the public hotpath command. The refreshed artifacts differ
  from the previous record, so this pass makes no A/B or performance claim.

### Current pass: imported extend semantic preflight

- **Architecture surface:** `planImportedExtends` / `bodyMayPlanExtend` in the
  one canonical AST serializer and the selector planner's typed `PlanOverlay`.
  No frontend-specific engine, bridge, parser host, raw source recovery, or
  alternate render route is involved.
- **Separation/duplication:** the profile hook observes facts already produced
  by the sole imported-extend path. It does not create a second planner, import
  resolver, selector representation, or evaluator.
- **Cumulative node weight:** zero canonical AST nodes, copied statements, or
  output nodes. The feature path retains only the pre-existing render-local
  overlay facts and placement tokens required by repeated canonical loop bodies.
- **New traversal:** `planImportedExtends` reads a loaded import's typed body in
  source order. `bodyMayPlanExtend` is intentionally an unbounded, explicit
  statement-stack scan: the import body is only known after Context/plugin
  resolution, so its extend fact cannot be carried by the importer. The scan is
  not a bounded admission probe and must not borrow the `precise` contract kind.
- **New node/materialization:** none. A false body scan never enters
  `collectPlacedExtendFacts`, `collectPlan`, selector-IR construction, overlay
  arrays, or loop-token allocation. A true imported loop creates only the
  existing render-local fact values and one token per concrete iteration; it
  never copies the AST or creates output nodes.
- **Render path:** this is a pre-render semantic fact pass. Ordinary emission
  remains `emitDocumentStatements`; the preflight writes no CSS and does not
  reparse source or perform a second output walk.
- **Helper/API surface:** one module-local, import-time-captured profile counter
  recorder is shared by `plan.ts` and the serializer. It is absent unless a test
  installs `__JESS_EXTEND_PROFILE_COUNTERS__` before loading core; it is not a
  mode, feature switch, Context option, or public API.
- **Metadata mutations:** none on canonical AST. Existing `Frame` placement
  tokens and render-session weak maps remain the sole placement state.
- **Danger-token accounting:** the source-order stack scan, `For` iteration,
  overlay facts, and weak-map tokens are semantic work only after a loaded body
  proves it can carry an extend. The false-path counter proof is specifically
  required because this owner cannot honestly claim a bounded cheap probe or a
  performance improvement.
- **Review-flagged diff tokens:** [loop/traversal] is the typed loaded-body
  preflight and concrete loop iteration; [array helper] and [array
  spread/materialization] are pre-existing selector/overlay fact collection;
  [node construction], [parent/source mutation], and [routine error control]
  have no owned instance here; [side map/set] is the existing render-session
  placement WeakMap; [materialized array/object] is the existing feature-path
  overlay and token state. The remaining matches are concurrently dirty
  AST/parser/evaluator work and are not attributed to this narrow owner.
- **[generic defensive read]:** the `Object.prototype.hasOwnProperty` check in
  `packages/core/src/ast/value-dispatch.ts` is cold named-record validation for
  callable metadata, not a parser or render-path probe; `Reflect.apply` is the
  direct callable invocation seam. No generic property probing was added to a
  parser or evaluator hot path by this pass.
- **Evidence:** `extend-preflight-contract.test.ts` proves the no-extend false
  path (`collectPlan`, collector, overlay, and loop placements all zero) and a
  two-item imported loop (one import, two concrete placements, two subjects and
  two instructions). `import-at-rule.test.ts` remains 25/25. A built-artifact
  public Compiler A/B against committed `6734da512`, with 20 warmups and 45
  alternating pairs, was byte-identical at 122,390 bytes / SHA-256
  `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`.
  Parse-render was 81.476→81.000 ms (26/45) and render was 14.281→14.101 ms
  (24/45). These are instrumentation/noise controls, not a speed or neutrality
  claim.
- Behavior evidence: `extend-preflight-contract.test.ts` exercises both the
  no-feature body and imported-loop feature path; direct parser suites remain
  responsible for their typed `Stylesheet` construction rather than borrowing
  this serializer contract.
- Build evidence: the release build and package-level TypeScript builds are the
  required proof for parser/frontend/public-plumbing edits; they are not runtime
  cost evidence and must be rerun for the assembled alpha candidate.
- Boundary evidence: parser frontend edits require the parser-runtime-boundary
  verifier plus public parser/plugin route tests; Context/public export edits
  require package export and packed-consumer checks. These boundary proofs are
  deliberately separate from the strict evaluator/render/lookup cost ledger.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-extend-import-preflight",
    "verdict":"accepted",
    "necessity":{
      "status":"proven",
      "factSource":"A loaded import document's typed Rule, AtRuleBlock, and For bodies are the first authoritative source for whether imported selectors or concrete loop placements can contribute an extend.",
      "rediscovery":"Without the preflight, the renderer would discover imported extend facts after the root extend plan was already computed, losing source-order cross-import placement semantics.",
      "carryForward":"The loaded document body is inspected once in source order; only its existing typed selector facts and one token per concrete extend-bearing loop iteration are carried into the root plan overlay.",
      "whyNotCarried":"The importer cannot carry an arbitrary imported document's extend fact before Context/plugin resolution loads that document; the loaded typed body is the earliest truthful boundary."
    },
    "performanceClaim":"none",
    "why":"A loaded import is resolved during evaluation, so its typed body is the first authoritative source for whether extend planning is necessary. The explicit source-order scan returns before planner, collector, overlay, or loop-placement work on the exercised false path; treating it as a bounded micro-admission would be false.",
    "dangerTokensJustification":"The scan, concrete loop iteration, overlay facts, and placement tokens are semantic source-order work only after a loaded body proves it may carry an extend. The false path records zero collector, overlay, and loop work; the feature path records only the concrete imported-loop facts required by the existing root planner.",
    "falsePath":{"fixture":"extend-preflight-contract:no-extend","counters":{"calls":1,"collectorCalls":0,"overlaySubjects":0,"overlayInstructions":0,"loopPlacements":0}},
    "featurePath":{"fixture":"extend-preflight-contract:imported-loop","counters":{"importsVisited":1,"loopPlacements":2,"overlaySubjects":2}},
    "baseline":{"fixture":"benchmark.less","phase":"parse-render","currentMedianMs":81,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-evaluator-function-call-boundary",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"A FunctionCall that has no registered callable is an optional CSS function and must preserve authored call bytes without a diagnostic. Once a scoped or global callable has been selected, its synchronous or asynchronous rejection is an invocation result, so functionMode—not name resolution—decides preserve-and-warn versus propagation. MixinCall resolution never reaches this boundary.",
    "dangerTokensJustification":"The synchronous success path now creates neither a fallback closure nor a recovery closure. The fallback value is materialized only for an optional miss or a selected-callable failure; Promise.catch allocates only after a genuinely async callable result. This is a semantic policy correction with a structural hot-path deletion, not an A/B speed claim.",
    "cases":["unresolved-optional-function-call","registered-sync-call-failure","registered-async-call-failure"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-value-guard-equality-modes",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Equality mode belongs to typed guard comparison. Less accepts a unitless number against an equal unit magnitude, Sass accepts equal quoted and keyword text while retaining unit distinction, and exact preserves the structural distinction. These choices are compatibility semantics, not parser or function-resolution behavior.",
    "dangerTokensJustification":"The comparison stays one typed value operation with no traversal, collector, AST node, side table, or fallback construction. It may recurse only through an already-materialized List when both operands are Lists; that pre-existing structural comparison is not changed by mode selection. The baseline is output identity only, not a speed claim.",
    "cases":["less-unitless-dimension","sass-quoted-keyword","exact-structural-distinction"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-value-operate-preserve-calc",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Preserve-mode percentage multiplication must remain a calc result instead of inventing a scalar percentage. A later explicit calc or arithmetic operation must compose that result as one valid calc expression; loose mode keeps its Less numeric result. This is arithmetic result policy, not a second evaluator or an import/parser fallback.",
    "dangerTokensJustification":"The percent branch allocates only its required Keyword result. Calc byte inspection and parenthesis handling are an acknowledged transitional value-structure gap: authored calc has typed parser facts upstream, while a computed preserve result currently carries only bytes. This record makes no neutrality claim and does not conceal that remaining re-derivation debt.",
    "cases":["preserve-percentage-product","loose-percentage-product","explicit-calc-composition"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"ast-semantic-runtime-cutover",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "why":"This coordinated AST-v2 cutover changes ValueSlot/List/Block facts, authored layout, callable binding, mixin argument resolution, reference/index access, and Less lazy color-call demand across cooperating runtime owners. Those are semantic architecture changes with real traversal and allocation shape; no single admission counter, byte-identical A/B, or speed claim would describe them truthfully.",
    "dangerTokensJustification":"The new array helpers, loops, side-table entries, typed wrappers, and result objects are accounted for as the direct implementation of the canonical value facts and demand boundaries. They are not presented as neutral or cheaper, and their behavior is covered by focused AST/list/mixin/provenance/F5 tests plus the release build.",
    "cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve"],
    "behaviorEvidence":"The isolated `pnpm run verify:baseline` route passed, including core/parser/fixture behavior and the public Less/Jess semantic suites; the F5 lazy color-call cases remain separately recorded in the Less-alpha gate.",
    "buildEvidence":"The release-shaped `pnpm run build:release` workspace build passed for the assembled canonical AST-v2 runtime.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"parseRenderMedianMs":68.38,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"context-external-import-dispatch-boundary",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Context must decide whether an external stylesheet identifier enters its existing plugin dispatch. An unclaimed URL or protocol-relative specifier returns undefined so the serializer emits ordinary CSS; a claim permits exactly the established resolve, locate, source, and parser route. Core does not fetch, inspect a resolver result, or create an alternate import loader.",
    "dangerTokensJustification":"The added loop runs only at the cold import boundary and stops at the first explicit claim. It allocates no node, source buffer, cache, parser result, or network request. The unclaimed path returns before resolve/locate/source/parse; a claimed path delegates to the existing Context work that was already required for a local stylesheet import.",
    "cases":["claimed-external-import","unclaimed-external-terminal","ordinary-local-import"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":78.4,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },
  {
    "id":"legacy-tree-visitor-abi-removal",
    "verdict":"accepted",
    "performanceClaim":"none",
    "costDelta":"neutral",
    "why":"The Less-style core Visitor and Node.accept ABI had no production or test consumers after the compat bridge cutover. Removing the dead per-node dispatch surface deletes only unreachable methods, probes, symbols, and the visitor module; Context's separate SpineVisitor lifecycle hook remains, and no parser, import resolver, plugin dispatcher, or canonical AST serializer path enters this deleted boundary.",
    "byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390},
    "benchmark":{"fixture":"benchmark.less","phase":"render","currentMedianMs":80.056,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- **Verdict:** accepted semantic-preflight, evaluator/value semantic-boundary,
  the neutral legacy Visitor ABI deletion, and the explicit seven-file
  `ast-semantic-runtime-cutover` record. Behavior,
  focused package build, and current benchmark/output baselines are proved;
  none of these records makes a wall-clock performance claim. The wider
  release build remains a separate alpha gate.
### Rejected nested Less `@media` conjunction assumption (2026-07-21)

Commit `81e2f7ffc` assumed nested singleton `@media` groups should be emitted
as sibling groups with conjoined qualifiers. The upstream Less corpus disproved
that assumption: `at-rules-bubbling`, `at-rules-targeted`, and
`extend-chaining` require the existing nested output. The implementation and
its focused expectations were reverted. Do not reintroduce renderer-side media
conjunction without a corpus-backed semantic specification that covers those
cases.

### Addendum: Less URL transform dispatch (semantic parity, not a cost claim)

`Context.transformUrl` carries the active document's existing source identity
and the render entry identity to that document's parser plugin. The Less
plugin owns `rootpath`, `rewriteUrls`, and `urlArgs` transformation; it does
not resolve, load, scan, or re-parse a URL. Structured `Url` emission retains
quoted versus bare syntax before dispatch.

- **Behavior evidence:** `tests-config/rewrite-urls-all`,
  `rewrite-urls-local`, `rootpath-rewrite-urls-all`, and
  `rootpath-rewrite-urls-local` pass byte-identically through the public Less
  fixture harness, including URLs authored in an imported document. The
  compiler preserves configured native Less-plugin hooks while retaining the
  per-render option-bearing Less adapter.
- **Remaining gap:** `tests-config/static-urls` and `url-args` remain expected
  failures because both first stop at the distinct multiline data-URI grammar
  case. This URL transform pass does not claim to implement that grammar.
- **Cost/gate status:** no performance or neutrality claim. This is not an
  aggressive-cutting cost contract, and the aggregate
  `verify:aggressive-cutting-review` result remains globally red on existing
  evaluator/value/extend/context inventory unrelated to this behavior entry.

### Addendum: canonical AST source-span provenance (semantic diagnostics)

`ast/provenance.ts` is a deliberately narrow parser-to-diagnostic fact channel.
Parseman reductions attach only their exact source spans to a session-independent
`WeakMap`; normal evaluation and rendering do not read it. The serializer reads
the fact only while constructing a diagnostic, where a source offset is required
to render the correct code frame. The process-global symbol is required because
parser packages load the `@jesscss/core/ast` bundle while the compiler serializer
loads the core root bundle; those are separate bundled module identities and
must share the same parser-authored table.

- **Behavior evidence:** `ast/__tests__/provenance.test.ts` proves that the
  side table preserves node shape. The public Jess render diagnostic test and
  a built-package Compiler route both report `$[path]` at source column 13,
  proving that the parser-written span reaches root-bundle serialization.
- **Fact flow:** Parseman reduction → `withSourceSpan` → `WeakMap` →
  diagnostic-only `sourceSpanOf`; no source walk, reparse, node mutation, copy,
  or render-time collection occurs.
- **Cost/gate status:** no speed or neutrality claim. The existing `WeakMap`
  write is semantic parser work for diagnostics, and its lookup is cold error
  handling; this entry does not assert a global aggressive-cutting gate pass.

### Active correction: dialect function conversion (proof before deletion)

Retract any claim that the function library is fully converted or that
legacy-node wrappers are an acceptable final state. The July 21 audit found 72
same-named files in `packages/fns/src/less/` and `src/builtins/`; these are
different implementations, not interchangeable copies. `builtins/` is frozen
as comparison evidence, not a destination architecture.

The active queue is behavior-complete conversion in the existing dialect-owned
files (`shared/`, `less/`, and `sass/`): first capture the legacy suite baseline,
then port one small function in place to an AST-v2 `Fn`, prove old and direct-AST
parity, and only then delete the duplicate implementation when it is identical.
No wrapper, alias, reduced behavior, or permanent legacy holdout is permitted.
Relative color is a separate first semantic batch: direct AST retains its
structured clause, but full `calc(r + 40)` needs a typed call-level channel
evaluation design before a behavior-preserving port.

The public-entrypoint cutover includes `packages/fns/src/index.ts`,
`less/index.ts`, and `builtins.ts`: none may leave a legacy callable barrel or
`src/builtins.ts` registry as the destination architecture. The final public
assembly imports canonical callables from the existing `shared/`, `less/`, and
`sass/` owners. The corresponding tree-based tests (`Context`, `callWithContext`,
tree constructors, and `instanceof` assertions) must move to typed direct-call
or compiler-route tests; their byte/output expectations remain oracle evidence.
The package wildcard export means legacy subpaths also need an intentional public
export cutover, rather than disappearing by accident. This is active work, not a
completion claim.

**Settled F5 relative-color and fallback boundary:** CSS-shaped literal
`rgb`/`rgba`/`hsl`/`hsla` calls with three or more argument slots are
un-operated bare Calls: they emit authored bytes and are not invoked unless a
consumer demands their value (an enclosing operation or a Less/variable
argument is such demand). Modern space/slash and relative syntax uses a nested
structured slot and follows the same arity rule. Less's one-/two-slot overloads
are not part of this lazy boundary: they dispatch through the selected Less
callable, so recognized forms such as `rgba(#5F59)` canonicalize and malformed
numeric arities reach the normal call-level `functionMode` policy. Therefore
unsupported relative-color syntax does not throw while its CSS-shaped Call
remains un-operated. On demand, the selected implementation may reject; the
evaluator's existing `functionMode` policy—not an individual function—then
decides whether to preserve the authored call or propagate the error. A
function must never manufacture a fallback call node. Preserve this F5 demand
gate when the builtin registry moves out of `builtins/`; it is distinct from
lazy parameters and from `functionMode`. No broad relative-color port is
approved by this statement.

**Settled callable capability boundary:** direct callable invocation supports
typed positional values plus typed named-record assignment (including mixed
calls) for Sass and Jess. The evaluator/registry route continues to pass a
typed positional `List`; Less is positional-only for the current alpha and may
add hybrid records later only with an explicit Less syntax/evaluator decision.
This is a callable capability boundary, not a claim that every dialect parser
accepts named arguments.

**Settled typed-list ownership and callable shape:** list recovery and numeric
indexed access are core Jess value capabilities, not Less-owned helpers. Core
owns exact separator/bracket-aware value structure, zero-based value access, and
the universal `defineFunction`/`Fn` callable contract. Core does not normalize
indices or impose one-based language semantics.
Less, Sass, and future libraries register that same callable shape and provide
declared semantic policy data (for example unit compatibility,
bracketedness/separator defaults, rounding, or map behavior); they do not get
separate function APIs or helper contracts. The AST-v2 cutover therefore audits
and ports Sass list functions too; the legacy Sass list APIs are not a protected
exception or a reason to retain legacy tree values. Every remaining legacy list
dependency must either be replaced with the core capability or be explicitly
shown to encode declared policy data rather than a second runtime model.

**Value-list separator invariant:** a semicolon is a statement/declaration
delimiter, not an AST-v2 value-list separator. When syntax places a semicolon
between values outside the rules level, the parser reduction lowers it to the
canonical comma-separated `List` fact. The typed value model therefore carries
comma/space/slash (plus any explicit undecided policy), never a semicolon value
separator.

**Value-list index invariant:** core JS access is zero-based and does no numeric
normalization. Less `extract` and Sass `list.nth`/`set-nth` each implement their
own one-based conversion, truncation/flooring, non-finite, negative, and bounds
rules inside the universal callable contract. A shared core accessor must not
silently choose one language’s policy.

## Aggressive Cutting Self-Prosecution — recursive guard value slots

- Architecture surface: the private `guardUsesDefault` classifier now accepts
  the truthful `ValueSlot` shape rather than pretending every operand slot is a
  node.
- Separation/duplication: no resolver, evaluator, renderer, scanner, or second
  guard model was added; the existing classifier remains the single owner.
- Cumulative node weight: none. The change allocates no node, wrapper, array,
  side map, or placement state.
- New traversal: `guardUsesDefault` now follows a nested raw `ValueSlot[]`
  while it is already scanning a guard operand for `default()`. The public value
  model permits this nesting, so stopping at the array was both type-invalid and
  semantically incomplete. The scan remains short-circuiting and runs only for
  mixin guard classification; no render-wide walk was added.
- New node/materialization: none.
- Render path: unchanged. No value is resolved or materialized for output.
- Helper/API surface: none. The existing private recursive function accepts
  the truthful `ValueSlot` input directly.
- Metadata mutations: none.
- Review-flagged diff tokens: the added `some` is the required short-circuit
  descent into a nested slot array already admitted by the public type; it does
  not collect or copy the array.
- Behavior evidence: `src/ast/__tests__/guard.test.ts` proves both a nested
  positive `default()` case and an otherwise-identical negative case.
- Build evidence: strict `tsc -p packages/core/tsconfig.build.json --noEmit`
  removes all three prior `ast/guard.ts` diagnostics (core source count
  342 to 339).
- Boundary evidence: no public export or call signature changes; only the
  private classifier's input truthfully widens from `ValueNode` to `ValueSlot`.
- Evidence: focused behavior, strict-build, and boundary evidence are listed
  above; no benchmark was run because this pass makes no performance claim.
- Verdict: accepted correctness fix. Performance was not measured and no speed
  claim is made.

### Current pass: strict canonical runtime contracts

- Architecture surface: the private mixin byte/default resolver now accepts
  canonical recursive `ValueSlot`, matching `evalBytes` and the existing
  `MixinCall.args` data contract. Context import loading retains its narrowed
  `Stylesheet` fact across the document callback, selected-mixin events retain
  their declared candidate map type, and direct function binding admits the
  already-supported absent optional input. Detached binding, variable
  activation, property lookup, value-position binding, and ruleset guards now
  accept their already-declared recursive value/eval-context inputs without
  pretending arrays are nodes or requiring the full output emitter. The
  serializer now has one structural readonly-array guard for that public value
  union; map entries retain the truthful recursive/callable binding rather than
  narrowing declaration values to scalar nodes. Guard truth/comparison/call
  operands and logical-function branches now carry the same canonical
  `ValueSlot`, so authored adjacent arrays no longer fall through scalar-only
  type assumptions. Reference steps narrow their typed call/index/member facts
  before accessing the corresponding fields. Closure capture, leaked bindings,
  conditional detached-ruleset aliases, mixin-call aliases, and `$for`/`each`
  map items now make the same scalar/call/array distinction before dispatch.
  `$apply` calls the existing source-owner scope with its actual three-argument
  contract; the removed fourth JavaScript argument was ignored at runtime.
  Diagnostic subjects now admit canonical AST objects without pretending that
  they own legacy inline location fields; two structural readers preserve
  `spanStart`/`spanEnd` behavior only when those legacy fields are actually
  present. The canonical serializer narrows recursive declaration slots before
  recording scalar value positions, keeps nullable selected-mixin bindings
  nullable through the existing call frame, and makes the existing synchronous
  nested-selector contract explicit. `Important` is now included in `Node`,
  `NodeType`, and `isNode`, matching its existing public `ValueNode` factory and
  eliminating the prior internally contradictory union.
  Retained Ruleset, Rules, and Ampersand consumers now accept the same
  `SelectorLike` string/array/node surface their constructors and parser facts
  already expose. Array-backed ampersands remain raw for key-set analysis and
  become selector nodes only where append/resolution/cache behavior requires a
  node. Registration reaches each array member before node-only source metadata
  is read, and merge descent distinguishes plain inline Rules from Ruleset and
  AtRule scopes without relying on an over-broad node-bit predicate.
- Separation/duplication: no second resolver or array-flattening policy was
  added. Existing core `evalBytes` remains the only byte-resolution owner.
- Cumulative node weight: source trees are unchanged. A parser-delivered selector
  array is materialized only when Ampersand append/resolution or the composed
  header cache requires `Selector` methods; the key-set path explicitly retains
  the raw array and performs no wrapper allocation.
- New traversal: recursive value evaluation remains in the existing evaluator
  path. [loop/traversal] The calc-only slash recognizer now validates that a raw
  slot is shallow before constructing the existing temporary `SpacedValue`.
  It scans without allocation on the overwhelmingly common no-slash path; only
  a recognized slash group performs the second copy needed by the scalar-only
  `SpacedValue.parts` contract.
  Alias and detached-ruleset loops are unchanged; they now terminate cleanly
  when the current recursive binding is an authored array.
  The ruleset-callable member loop and property-merge body loop already existed;
  this pass only moves the former before node-only metadata reads and narrows the
  latter with the actual `Rules` class before excluding nested cascade scopes.
- New node/materialization: no new node type, wrapper layer, or side map.
  [materialized array/object] A recognized calc slash group copies its shallow
  readonly slot into the pre-existing temporary `SpacedValue`; no-slash and
  nested-array inputs allocate nothing in this recognizer.
  [materialized array/object] Recursive `@supports` slots assemble the one
  existing `SupportsPreludePart[]` result required by the normalizer; the
  recursive array was previously rejected by the scalar-only signature. No AST
  node or persistent runtime surface is created.
  [node construction] Raw selector arrays become an existing `SelectorList` only
  at Ampersand append/resolved-selector and composed-header cache boundaries.
  String surfaces likewise use the already-established `BasicSelector` at those
  same node-required boundaries. [inherit/adopt/frozen] Composed replacements
  inherit source span/flags from the selector they replace; no parent restoration,
  deep clone, or persistent adapter is added.
- Render path: unchanged direct emission. Scalar guard/logical behavior is
  identical; recursive slots now use the existing `evalTypedSlot` and
  `evalValueSlot` owners instead of being misclassified as scalar nodes. The
  ruleset header removes an unreachable array/string emission branch after those
  surfaces have already returned or been converted at the cache boundary.
- Helper/API surface: two file-private structural type guards centralize the
  existing node-vs-readonly-array and value-vs-mixin-call checks. The already
  public `GuardNode` operand fields widen compatibly from `ValueNode` to the
  canonical `ValueSlot`; no new operation, alias, or alternate guard API is
  introduced. The selector metadata copy overloads and Ampersand container type
  only state existing runtime shapes; they add no runtime helper or public alias.
- Metadata mutations: selector cache invalidation now serializes an array with
  the existing selector-list serializer instead of assigning `Array.valueOf()`
  to a string cache. No new cache or metadata field is introduced.
- Review-flagged diff tokens: [side map/set] is the pre-existing lazy
  `selectedMixinEvents` map with its already-declared generic type made explicit;
  no second map or lookup was added. [materialized array/object] appears only in
  type annotations for that existing map, `bindDirect`'s existing input/output
  arrays, and the widened guard-call operand type; the pass adds no array or
  object allocation. [array helper] The namespace `flatMap` was pre-existing;
  this pass only gives its existing `bodies` result the truthful `Statement[]`
  annotation, without adding a helper, pass, or allocation. [loop/traversal]
  The existing variable-alias chain now
  checks that its current binding is scalar before reading its discriminant; it
  adds no iteration. [parent/source mutation] The three `source` matches are
  read-only diagnostic-source narrowing before `lineColAt`; no source, parent,
  node, or provenance state is mutated. The new `type` checks distinguish a
  typed node from a recursive slot array before reading the discriminant; they
  allocate nothing and add no scan.
  [array helper] and [array spread/materialization] in the supports-prelude
  branch recursively preserve the already-authored slot boundaries while
  producing the existing normalization input. [node construction] and
  [routine error control] are the same exceptional synchronous-selector
  boundary already owned by `resolveComplexSync`: an async plugin result cannot
  resume an in-place extend preflight or synchronous nested-header probe, so an
  `Error` is allocated only when that unsupported contract is violated, never
  for a lookup miss or ordinary branch result. [side map/set] on the transparent
  shell is only a truthful nullable type for the existing bindings map; it does
  not allocate a map.
  [node construction] identifies the existing `BasicSelector` normalization and
  the newly truthful raw-array normalization only at selector-node-required
  append/resolution/cache boundaries. [inherit/adopt/frozen] preserves the
  composed source selector's established span/flag inheritance on that result;
  no source child is moved or cloned. [parent/source mutation] is a read-only
  `sourceNode` lookup moved after the array branch so arrays never reach node-only
  metadata. [loop/traversal] consists only of the existing selector-member
  registration and merge-body loops in their corrected type order.
- Behavior evidence: the focused core tests prove recursive authored and
  default mixin arguments; import, selected-mixin, and direct-function suites
  pass 101/101; the complete core suite passes; and the public Less parser suite
  passes 269/269. Detached ruleset, property access, and ruleset-guard coverage
  adds 36/36 focused passing cases. The guard suite directly proves that one
  recursive slot reaches the typed truth resolver as one operand.
- Build evidence: core package build and `verify:package-exports` pass. Strict
  core source diagnostics fall from 339 to 241 without suppression; this
  serializer slice moves the source count from 310 to 241 and the full core
  config from 710 to 641. The current guard/logical/reference slice moves core
  source diagnostics from 241 to 204 and the full core config from 641 to 605.
  The following closure/call/iteration narrowing slice moves core source
  diagnostics from 204 to 158 and the full core config from 605 to 559.
  The canonical serializer/diagnostic drain then moves core source diagnostics
  from 158 to 127 and the full core config from 559 to 528; no diagnostics remain
  in `ast/serialize.ts`, `ast/node.ts`, or the diagnostic files touched by this
  pass. The remaining strict source diagnostics are confined to `tree/**`.
  The following retained-tree contract batch moves that isolated source count
  from 127 to 73 on a fresh compiler run. It removes no tree compatibility
  surface: it makes existing async render results, source spans, guard fields,
  bitset inversion state, combinator recognition, and selector-list result
  shapes truthful so the remaining consumers can be deleted or migrated from a
  sound baseline rather than hidden behind assertions.
  The selector-surface consumer batch then moves the isolated source count from
  73 to 54 and the full core config from 474 to 453. Ruleset, Rules, and
  Ampersand now admit the parser-delivered string/array selector surfaces they
  already receive, without widening the canonical aliases or adding a bridge.
  Registration tests prove every array member remains callable, and Ampersand
  key-set analysis consumes the raw array without materializing a wrapper.
  Extend registration, root composition, and composed-match walking now admit
  the same parser-delivered selector surface, materializing a Selector only at
  APIs that require node behavior.
- Boundary evidence: the Less public parser suite passes after rebuilding core,
  and package export verification confirms the entrypoint remains valid.
- Evidence: focused and full behavior, build, export, and strict-type evidence
  are listed above. No benchmark was run because no performance claim is made.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-semantic-runtime-cutover",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "why":"The mixin resolver now admits the recursive ValueSlot contract that its existing evalBytes callee already owns. Context import narrowing, selected-event map inference, optional direct inputs, detached/property/value bindings, ruleset guard context, serializer narrowing, recursive map-entry values, guard/logical/reference operands, closure aliases, iteration inputs, canonical diagnostic subjects, and scalar position facts make existing canonical runtime contracts explicit; none creates a new resolver, evaluator, or output policy. Important now participates in the public Node union it already semantically belonged to.",
    "dangerTokensJustification":"The discriminant checks prevent arrays from being treated as nodes, while recursive byte work remains in the existing evalBytes path. [loop/traversal] The calc slash recognizer validates shallow parts without allocation before its rare recognized-slash copy; the existing alias-chain loop only gains a scalar guard. [array helper] The namespace flatMap already existed and only gains a Statement[] annotation; the supports flatMap recursively emits the existing prelude-part result. [array spread/materialization] and [materialized array/object] in that supports branch preserve authored recursive slot boundaries in the one transient SupportsPreludePart[] consumed immediately by the normalizer. The recognized slash group alone copies into the existing scalar-part temporary SpacedValue; guard-call, namespace bodies, and binding maps are type annotations. [side map/set] The binding Map matches are existing parameter/member types widened to CallValue or nullable, not new maps. [parent/source mutation] Diagnostic source variables are only narrowed for read-only line lookup; no source or parent state changes. [node construction] and [routine error control] identify exceptional Error construction when an async plugin result violates a pre-existing synchronous selector preflight/header contract; ordinary lookup misses and branch results do not throw. Capturing an already-loaded Stylesheet and typing existing maps/optional slots add no side table, fallback call, or output buffer, and this record makes no neutrality or speed claim.",
    "cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve"],
    "behaviorEvidence":"The complete core suite passes 3318/3318; focused recursive arguments, imports, selected mixins, direct-function, value-access, recursive guard truth, at-rule, extend-preflight, nested mixin, and Node-union cases pass.",
    "buildEvidence":"The core package build and package-export verification pass after the resolver and canonical serializer contract corrections.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"parseRenderMedianMs":68.38,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"The retained tree already permits async container/declaration rendering, optional Context files, source-span accessor reads, DefaultGuard-owned text, inverted bitsets, raw-string or node combinators, singleton-collapsing selector-list results, parser-delivered string-or-array selector surfaces, synchronously empty mixin rendering, and mixin preparation that may return a distinct Mixin. Extend registration, root composition, and composed-match walking consume that same surface and require nodes only at placement-copy, bit-library, and matcher boundaries. This pass states those existing runtime facts exactly while retained consumers are removed; it does not preserve them with a shim or add another evaluator, traversal, resolver, or output policy.",
    "dangerTokensJustification":"[materialized array/object] appears in type signatures for the existing optional Context file and selector-array surfaces. [node construction] A raw selector array becomes the existing SelectorList node only at Ampersand append/resolved-selector, composed-header cache, extend placement-copy, bit-library ownership, and composed-match boundaries that require Selector behavior; key-set analysis keeps the raw array and uses its existing array-aware compute path. [loop/traversal] The existing per-member callable registration and merge-body loops retain their exact work, while the extend matcher continues its existing walk over one normalized selector node. No resolver, output buffer, side map, error-control path, or second traversal is added. The combinator predicate keeps the same runtime checks and narrows only the exact Combinators string-literal union or Combinator node, leaving ordinary selector strings in the false branch.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result","extend-record-selector-surface","extend-root-composition-selector-surface","extend-walk-composed-match-selector-surface"],
    "behaviorEvidence":"The focused selector/ruleset/rules/mixin/declaration suites pass 470 tests with 5 pre-existing skips. The new regressions prove raw selector-array Ampersand append/key-set behavior and callable registration for every array member; existing registration, merge-scope, composition, reference-render, invisible-mixin render, and interpolated-name preparation suites remain green.",
    "buildEvidence":"Fresh strict core source diagnostics fall from 127 to 73, 54, and then 41 without suppression. The complete core suite passes 3321/3321 with 14 skips and two deferred cases; core build and package-export verification pass.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"parseRenderMedianMs":68.38,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted type-contract correction with no compatibility shim.

## Aggressive Cutting Self-Prosecution

- Latest pass: mechanical serializer/import-walk ESLint normalization and a
  truthful StyleImport type predicate.
- Architecture surface: `serialize-helper.ts` and `emit-walk.ts` keep the same
  canonical serializer/import ownership. The edits do not add a parser host,
  bridge, resolver, output tree, or compatibility surface.
- Separation/duplication: none. The existing serializer and import-walk owners
  remain the only implementations of these paths; the predicate shares the
  existing discriminant fact rather than introducing a second resolver.
- Cumulative node weight: unchanged. No canonical AST or render placement
  object is added.
- New traversal: none. The added type predicate is the existing
  `node.type === 'StyleImport'` check expressed as a TypeScript narrowing; all
  loops and promise continuations are existing execution paths.
- New node/materialization: none. No node, array, map, frame, or writer is
  created by this pass.
- Render path: unchanged direct string emission; formatting changes cannot alter
  the emitted bytes, and the type predicate preserves the existing branch.
- Helper/API surface: no public API. `isSpineFoldableImport` only exposes the
  type fact already established by its existing discriminant guard.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal] and [array spread/materialization]
  are diff-line artifacts from reindenting existing loops/spreads, not new
  runtime constructs; [routine error control] is likewise an existing
  try/catch continuation whose braces were normalized. No new loop, spread, or
  exceptional control path was introduced.
- Evidence: core build passed; the complete core suite passed 3317 tests with
  14 skipped and two deferred cases; targeted ESLint is clean for both changed files; the
  benchmark oracle remains `benchmark.less`, collapseNesting=true, 122390 bytes,
  SHA-256 `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`.
  No performance claim is made.
- Hot-path cost contracts:
  ```json
  [{
    "id":"serializer-lint-only-normalization",
    "verdict":"accepted",
    "costDelta":"neutral",
    "why":"The changed lines are mechanical lint normalization plus a type predicate that preserves the existing StyleImport discriminant branch. No runtime work, allocation, traversal, or output policy is added.",
    "dangerTokensJustification":"[loop/traversal] and [array spread/materialization] are only reindented existing constructs; [routine error control] is only an existing try/catch continuation with braces normalized. The benchmark path therefore retains the registered byte oracle and no new cost-bearing operation.",
    "byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted mechanical quality cleanup; no performance claim.

## Aggressive Cutting Self-Prosecution

- Latest pass: mechanical ESLint normalization in the canonical AST extend
  emitter.
- Architecture surface: `packages/core/src/ast/extend/emit.ts` remains the
  existing typed extend-output owner. No parser host, bridge, resolver, planner,
  or compatibility surface was added.
- Separation/duplication: none. Existing extend IR emission and selector output
  ownership are unchanged.
- Cumulative node weight: unchanged. No AST, selector, planner, or render-frame
  object is added.
- New traversal: none. Every loop and conditional is pre-existing; only braces
  and operator layout were normalized.
- New node/materialization: none.
- Render path: unchanged direct selector/output emission.
- Helper/API surface: no new helper or public API.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal], [array helper], [node
  construction], [parent/source mutation], [side map/set], and [materialized
  array/object] are unchanged existing AST extend-plan expressions whose
  surrounding formatting was fixed; [routine error control] is an existing
  try path. No cost-bearing construct was introduced.
- Evidence: the AST extend preflight contract passes 2/2; targeted ESLint is
  clean; the benchmark oracle remains `benchmark.less`, collapseNesting=true,
  122390 bytes, SHA-256 `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6`.
  No performance claim is made.
- Behavior evidence: the AST extend preflight contract passes 2/2 and the
  existing value-operation/color behavior remains covered by the focused core
  suites.
- Build evidence: the core package build passes for this public value helper.
- Boundary evidence: the changed public AST value module keeps its existing
  `@jesscss/core/value` export and no new entrypoint or consumer contract is
  introduced.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-extend-emit-lint-only-normalization",
    "verdict":"accepted",
    "costDelta":"neutral",
    "why":"The changed lines are mechanical ESLint normalization in the existing AST extend emitter. No runtime operation, traversal, allocation, planner fact, or output policy is added.",
    "dangerTokensJustification":"[loop/traversal], [routine error control], [array helper], and [array spread/materialization] are existing constructs shown as changed only because their formatting was normalized. The canonical extend path and benchmark byte oracle are unchanged.",
    "byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted mechanical quality cleanup; no performance claim.

## Aggressive Cutting Self-Prosecution

- Latest pass: truthful retained-mixin registration/render contracts and exact
  guard-comparison negation narrowing.
- Architecture surface: retained tree mixin preparation/rendering and canonical
  AST-v2 guard comparison keep their existing owners; no bridge or alternate
  evaluator is added.
- Separation/duplication: none. Existing render, registration, and comparison
  helpers remain their sole owners.
- Cumulative node weight: unchanged; no node, frame, wrapper, collection, or
  side table is created.
- New traversal: none.
- New node/materialization: none.
- Render path: invisible mixins still synchronously emit the empty string when
  there is no asynchronous effect; emitted bytes and buffer segments are unchanged.
- Helper/API surface: an internal overload states the existing synchronous
  result, while registration drops a false receiver-subtype promise. No alias,
  wrapper, or public entrypoint is added.
- Metadata mutations: unchanged existing `registrationPrepared` and `withParts`
  behavior only.
- Review-flagged diff tokens: no allocation/traversal token is added. The
  existing Selector materialization is only moved behind the already-required
  node-only boundaries; no new `[node construction]` site is introduced.
  Explicit
  guard-result branches replace one unsafe assertion over the same closed scalar
  domain.
- Evidence: Mixin passes 196/196; comparison/equality suites pass all 29 cases
  discovered by the workspace configuration; strict core source diagnostics
  remain at the known 54 with no touched-file diagnostic; core build and package
  exports pass.
- Hot-path cost contracts:
  ```json
  [{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"The retained tree already permits async container/declaration rendering, optional Context files, source-span accessor reads, DefaultGuard-owned text, inverted bitsets, raw-string or node combinators, singleton-collapsing selector-list results, parser-delivered string-or-array selector surfaces, synchronously empty mixin rendering, and mixin preparation that may return a distinct Mixin. This pass states those existing runtime facts exactly while retained consumers are removed; it does not preserve them with a shim or add another evaluator, traversal, resolver, or output policy.",
    "dangerTokensJustification":"The render helper overload records that an absent effect cannot produce a Promise, and Mixin registration drops a false receiver-subtype cast without adding a wrapper, allocation, traversal, or runtime branch. Extend registration, root composition, and composed-match walking materialize a Selector only at existing node-only boundaries; no extra traversal or wrapper is added. Rules widens only its public result type to admit an existing derived Rules result. No resolver, output buffer, side map, error-control path, or second traversal is added.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result","extend-record-selector-surface","extend-root-composition-selector-surface","extend-walk-composed-match-selector-surface"],
    "behaviorEvidence":"The focused Mixin suite passes 196/196, including invisible rendering and interpolated-name preparation; the preceding selector/ruleset/rules/declaration contract evidence remains green.",
    "buildEvidence":"The core package build and package-export verification pass; strict core source diagnostics are 41 after the extend selector-surface batch, with no diagnostic in its touched files.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"parseRenderMedianMs":68.38,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"ast-value-guard-equality-modes",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Guard comparison negation retains the existing four-result mapping exactly: undefined stays undefined, -1 becomes 1, 1 becomes -1, and 0 remains 0. The explicit branches remove an unsafe numeric assertion without changing equality-mode dispatch or result policy.",
    "dangerTokensJustification":"The replacement adds no allocation, loop, traversal, exception path, lookup, or helper call. It exchanges one unary negation plus assertion for explicit scalar comparisons over the same closed four-value domain and makes no performance or neutrality claim.",
    "cases":["less-unitless-dimension","sass-quoted-keyword","exact-structural-distinction"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"ast-value-guard-negate-result",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"Guard comparison negation retains the existing closed-result mapping exactly while replacing an unsafe numeric assertion: undefined stays undefined, negative and positive reverse, and equality remains zero.",
    "dangerTokensJustification":"The explicit scalar branches add no allocation, loop, traversal, exception path, lookup, or helper call. They make the existing four-result mapping type-checkable and make no performance or neutrality claim.",
    "cases":["incomparable-remains-undefined","negative-and-positive-reverse","equality-remains-zero"],
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"Selector-analysis consumes the existing string-or-node selector surface directly through its typed PseudoSelector and Ampersand discriminants; no bridge, clone, resolver, or output policy is added.",
    "dangerTokensJustification":"The existing selector component loop and bitset computation remain unchanged; the removed structural assertions do not add traversal, allocation, side state, or error control.",
    "cases":["selector-array-key-set-analysis"],
    "behaviorEvidence":"The full core suite and selector-analysis focused tests pass.",
    "buildEvidence":"Core build and strict production type verification pass with zero core diagnostics.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted exact contract correction with focused behavior, strict
  type, build, export, and registered runtime evidence; no performance claim.

## Aggressive Cutting Self-Prosecution — legacy tree StyleImport deletion

- Architecture surface: deleted `tree/import-style.ts`, its root export and
  constructor type, its Rules registration/evaluation/retry machinery, and its
  spine resolve/register/cache/dedupe/extend-re-gate implementation. Canonical
  AST-v2 `StyleImport` execution remains in `ast/serialize.ts` and continues to
  dispatch file loading through `Context` plugins.
- Separation/duplication: the duplicate legacy tree executor is gone; only the
  AST serializer owns typed stylesheet-import execution.
- Cumulative node weight: reduced by the deleted StyleImport class, placement
  surfaces, import-body evaluation output, caches, and retry state. No runtime
  object was added.
- New traversal: none. The pass removes import scans, imported-body scans,
  deferred retry loops, and fallback-frame wiring from the legacy executor.
- New node/materialization: none. The deleted executor created placement Rules,
  cloned/evaluated import bodies, and maintained import resolution state; no
  replacement tree node or bridge was introduced.
- Render path: the tree spine no longer resolves or expands stylesheet imports.
  Terminal CSS `@import` statement emission remains ordinary statement output;
  typed stylesheet import execution is owned by the AST serializer.
- Helper/API surface: removed the public tree `style`/`StyleImport` export,
  `resolveForSpine`, `resolveBodyReferenceImports`, spine import caches and
  wiring helpers, and the abort-to-eval sentinel. No alias or compatibility shim
  was added.
- Metadata mutations: no new mutations. StyleImport-specific Rules flag
  propagation, deferred resolution queues, placement caches, dedupe ledgers, and
  imported extend subject state were removed. Generic Rules `referenceMode`
  placement facts remain.
- Review-flagged diff tokens: `[array spread/materialization]` and `[side
  map/set]` are pre-existing extend header projection expressions whose lines
  changed only because import-only parameters and return unions were deleted;
  this pass adds neither an array spread nor a Map/Set. No other danger category
  is introduced.
- Evidence: the canonical AST import suite passes 27/27, including Context
  loader dispatch, reference imports, source-order retries, namespace member
  reads, raw inline imports, CSS-terminal fallthrough, and nested async imports.
  The focused Rules/safe-parse/extend suites pass 136 tests with 6 existing
  skips. Core build passes. Performance was not measured, so no speed claim is
  made.
- Hot-path cost contracts:
  ```json
  [{
    "id":"legacy-tree-style-import-executor-removal",
    "verdict":"accepted",
    "costDelta":"decrease",
    "why":"The duplicate legacy StyleImport executor, its Rules/spine consumers, public tree export, retry queues, placement caches, and imported-extend re-gate are deleted. Canonical AST-v2 StyleImport execution and Context/plugin loading remain unchanged, and no replacement bridge or runtime work is added.",
    "byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"legacy-tree-visitor-abi-removal",
    "verdict":"accepted",
    "costDelta":"neutral",
    "why":"This pass only updates a retained node-base comment while the already-accepted visitor ABI removal remains unchanged; no runtime visitor, dispatch, traversal, allocation, or output policy is restored.",
    "byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"serializer-lint-only-normalization",
    "verdict":"accepted",
    "costDelta":"neutral",
    "why":"Deleting the serializer's legacy StyleImport expansion and wiring removes branches and calls; retained serializer expressions preserve their prior execution shape and no traversal, allocation, resolver, or output policy is added.",
    "byteIdentity":{"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"The retained Rules, Mixin, and scope-frame behavior keeps generic reference-mode Rules placement while deleting only StyleImport-specific registration, retry, and evaluation branches. No alternate evaluator, compatibility shim, new traversal, output policy, or performance claim is introduced.",
    "dangerTokensJustification":"The cut adds no allocation, loop, traversal, exception path, lookup, side map, or node construction. Existing extend projection spreads and Map/Set result types remain unchanged in their original lines; the diff removes import-specific scans, queues, caches, and placement construction.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result","extend-record-selector-surface","extend-root-composition-selector-surface","extend-walk-composed-match-selector-surface"],
    "behaviorEvidence":"The full core suite passes 3191 tests in 199 files with nine existing skips and two todos; generic reference-mode Rules placement tests remain green.",
    "buildEvidence":"The core package build and package-export verification pass after deleting the public tree StyleImport surface.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted deletion. It removes a duplicate import executor and its
  public tree surface while retaining the canonical AST-v2 import contract.

### Addendum: bounded core tree lint guards (2026-07-21)

This bounded cleanup covers only `tree/list.ts`,
`tree/util/check-valid-nodes.ts`, `tree/util/evaluate-node-array.ts`,
`tree/util/callable-candidate.ts`, and `tree/util/extend-helpers.ts`. It does
not touch the import-style, emit-walk, serialize-helper, extend-index, spine,
or Context deletion lanes.

- **Review-flagged diff tokens:** `[loop/traversal]`, `[array helper]`,
  `[node construction]`, and `[materialized array/object]` are accounted for
  below; no performance claim is made.
- **New traversal:** `isNodeArray` checks the already-materialized prefix only
  when a raw parser value segment first appears. Existing list loops remain
  source-order emission/evaluation loops; this adds no new render walk.
- **New materialization:** `coerceNodeArray` is reused at list boundaries so
  parser raw strings/arrays are normalized once before node-only helpers. Its
  all-Node fast path returns the original array; the raw-shape path is the
  existing cold normalization contract, not a second tree.
- **Node/error path:** the new `TypeError` is an exceptional invariant guard for
  an impossible raw prefix, not routine control flow or node materialization.
- **Evidence:** List 26/26; callable-candidate 18/18; check-valid-nodes 6/6;
  find-extendable-locations 14/14; core compile and staged aggressive review
  pass. The optional test’s deliberate `as never` call remains untouched as an
  API-contract follow-up.

## Aggressive Cutting Self-Prosecution

- Latest pass: bounded core tree lint/type-safety cleanup across five source
  files; no import-style, emit-walk, serialize-helper, extend-index, spine, or
  Context deletion lane was changed.
- Architecture surface: existing List and validation helpers retain their
  runtime responsibilities. Unsafe assertions were replaced with truthful
  `NodeArrayItem` typing, `isNode`/`N` narrowing, and the existing
  `coerceNodeArray` boundary; no parser host, bridge, visitor ABI, resolver, or
  construction host was introduced.
- Separation/duplication: parser raw values remain representable at the List
  boundary, while node-only consumers reuse the one existing coercer; no second
  list model or conversion bridge was added.
- Cumulative node weight: no AST node class, source node, parent link, frame
  state, or render-session map is allocated by this cleanup.
- New traversal: `isNodeArray` inspects only the existing prefix after a raw
  segment; existing source-order List loops are unchanged.
- New traversal/materialization: `isNodeArray` inspects only the existing
  prefix after a raw segment; `coerceNodeArray` returns all-Node arrays as-is
  and normalizes only the existing raw parser shape at node-only boundaries.
- New node/materialization: the existing coercer returns its input for all-Node
  arrays and normalizes only the documented raw parser shape; no second tree is
  created.
- Render path: List render/evaluate/compare behavior and output order are
  unchanged.
- Helper/API surface: no public API was added; the List input shape and helper
  narrowing now state the runtime facts truthfully.
- Metadata mutations: no AST parent/source/provenance mutation or side table
  was added.
- Review-flagged diff tokens: `[loop/traversal]` existing source-order walk;
  `[array helper]` existing coercion boundary; `[array spread/materialization]`
  existing spread contract; `[node construction]` unchanged direct
  construction; `[side map/set]` unchanged; `[routine error control]` only
  exceptional invariant `TypeError`; `[materialized array/object]` unchanged
  render-time work; `[generic defensive read]` is the existing `Reflect.apply`
  body-invocation boundary, now fed by runtime-validated function metadata and
  typed arguments without adding a second dynamic property lookup.
- Evidence: focused tests pass List 26/26, callable-candidate 18/18,
  check-valid-nodes 6/6, and find-extendable-locations 14/14; all five changed
  production files report zero ESLint errors; core compile passes. No speed,
  neutrality, byte-identity, or memory claim is made.
- Hot-path cost contracts:
  ```json
  [{
    "id":"bounded-core-tree-lint-guards",
    "verdict":"accepted",
    "owner":"the five bounded core tree helper owners listed by bounded-core-tree-lint-guards",
    "cases":["List raw NodeArrayItem normalization","canonical node-array prefix guard","root node validation narrowing","callable candidate record narrowing","extend helper lint-safe syntax"],
    "performanceClaim":"none",
    "why":"This is bounded type-safety and initialization-cycle repair over existing helpers. It preserves established List, validation, array evaluation, callable candidate, and extend-helper behavior.",
    "dangerTokensJustification":"Checked raw-prefix narrowing and reuse of the existing coercer add no render/tree traversal, node construction, side map, cloning path, or routine exception control; the invariant TypeError is exceptional and the all-node path returns the original array.",
    "behaviorEvidence":"Focused Vitest suites pass List 26/26, callable-candidate 18/18, check-valid-nodes 6/6, and find-extendable-locations 14/14.",
    "buildEvidence":"The five changed production files report zero ESLint errors and core compile completes successfully.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":74.0,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted bounded semantic/type-safety cleanup; the optional test
  assertion is a deliberate API-contract follow-up, not a suppressed lint
  error.

## Aggressive Cutting Self-Prosecution

- Latest pass: bounded AST extend/value/context contract cleanup. The pass
  normalizes lint-invalid control flow, replaces unsafe value-function casts
  with runtime guards, and reads declaration metadata through the existing
  static contract. No parser host, bridge, resolver, fallback, or compatibility
  surface was added.
- Architecture surface: `ast/extend/{compose,plan,solve}.ts` remain the
  canonical selector IR composition/planning/fixpoint owners; `ast/value-dispatch.ts`
  remains the typed function-definition boundary; `ast/value-units.ts` remains
  the shared unit table; and `tree/declaration.ts` remains the retained
  declaration render owner. Context and import dispatch are untouched.
- Separation/duplication: runtime definition validation is performed once at
  the `defineFunction` boundary; no second function registry, coercion layer,
  parser, or source re-read is introduced.
- Cumulative node weight: no AST node, selector, frame, side table, or render
  placement is allocated by this cleanup. Function metadata guards only inspect
  the definition supplied by the caller before invocation.
- New traversal: no traversal is added. Existing extend loops and fixpoint
  walks are only brace/operator normalization; function parameter checks run
  once while defining a callable.
- New node/materialization: none. Typed values are narrowed in place, and
  `Reflect.apply` continues to invoke the existing function body with the
  existing bound argument list.
- Render path: declaration bytes, extend output, unit conversion, and callable
  results remain behaviorally unchanged.
- Helper/API surface: no public export, alias, wrapper, or shim is added.
- Metadata mutations: none beyond the existing callable metadata assignment.
- Review-flagged diff tokens: `[loop/traversal]`, `[array helper]`,
  `[node construction]`, `[generic defensive read]`, and
  `[materialized array/object]` are either existing extend/value structures or
  validation-only boundary code; `[routine error control]` is limited to
  exceptional invalid-call/definition TypeErrors. No new runtime traversal,
  allocation, or error path is introduced.
- Behavior evidence: focused core suites pass 106/106, including value function
  binding, direct extend composition/preflight, unit operations, and 85
  declaration/merge cases; targeted ESLint reports 0 errors and 0 warnings on
  every changed production file.
- Build evidence: `pnpm --filter @jesscss/core build` passes; strict production
  verification reports no diagnostics in any changed file (remaining core
  diagnostics are confined to unrelated retained tree selector/serializer
  lanes and four published Parseman 0.28.0 entry contracts).
- Boundary evidence: `@jesscss/core/value` keeps the same public callable
  function contract and unit table exports; no package entrypoint or parser
  boundary changes.
- Evidence: core focused behavior suites, core build, strict type verification,
  and changed-file ESLint are the authoritative checks for this bounded pass;
  benchmark output remains the current render baseline only.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-semantic-runtime-cutover",
    "verdict":"accepted",
    "performanceClaim":"none",
    "why":"This is a truthful type and lint cleanup within the existing AST-v2 value/function and selector-extend owners. Runtime guards replace unsafe assertions without adding a bridge, fallback evaluator, second registry, or new traversal.",
    "owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "dangerTokensJustification":"The existing extend loops, branch arrays, and fixpoint walk are only brace/operator normalization. The value path adds runtime definition guards and retains the existing Reflect.apply boundary; it does not add a second traversal, registry, clone, node, or fallback evaluator.",
    "cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve"],
    "behaviorEvidence":"Focused value, extend, preflight, unit, and declaration suites pass 106/106; changed files have zero ESLint diagnostics.",
    "buildEvidence":"The @jesscss/core build passes and strict verification has no diagnostic in the changed AST files.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"Declaration provenance reads use the existing Declaration child-key contract and detached-ruleset checks use runtime discriminants; no tree bridge, clone, resolver, or output policy is added.",
    "dangerTokensJustification":"Declaration metadata reads use the existing static child-key contract and runtime discriminants. No node, array, map, frame, traversal, clone, resolver, or routine error path is added; the existing exceptional detached-ruleset TypeError remains the only failure path.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result","extend-record-selector-surface","extend-root-composition-selector-surface","extend-walk-composed-match-selector-surface"],
    "behaviorEvidence":"The declaration and declaration-merge suites pass 85/85, including source-span, merge, async, and render-buffer paths.",
    "buildEvidence":"The @jesscss/core build passes with no changed-file type diagnostic.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted bounded contract/type cleanup; no performance claim.

## Aggressive Cutting Self-Prosecution

- Latest pass: bounded Context/emit/selector/sequence/callable/serializer
  contract cleanup. Context remains the sole plugin/session/import dispatcher;
  no parser host, bridge, resolver, fallback, shim, alternate evaluator, or
  output policy was added.
- Architecture surface: existing Context plugin source/parser/module dispatch,
  emit-walk spine, selector matching, extend IR, Sequence subclass evaluation,
  callable-output validation, and serializer boundaries remain the owners.
- Separation/duplication: no second Context dispatcher, selector matcher,
  serializer, or evaluator was introduced; tagged IR and existing node
  discriminants replace only unsafe narrowing assertions.
- Cumulative node weight: no new AST nodes, clones, frames, side maps, or
  render placements were added; existing selector/list materialization remains
  at the node-only boundary that already requires it.
- New traversal: none. Existing source-order, extend, callable, selector, and
  serializer loops retain their prior traversal shape.
- New node/materialization: none beyond existing selector/list boundaries;
  Sequence uses a checked constructor identity to preserve existing subclasses.
- Render path: emit-walk reads `context.opts.output.collapseNesting`, serializer
  keeps existing at-rule/selector/rules guards, and callable output keeps the
  existing root-property diagnostic path.
- Helper/API surface: no public API, compatibility alias, parser bridge, or
  resolver helper was added; `getCombinatorComponents` now states the exact
  string-or-node return surface it already produced.
- Metadata mutations: none. Existing inheritance, source identity, Context
  plugin context, and render-session state are untouched.
- Review-flagged diff tokens: `[array helper]` and
  `[materialized array/object]` are existing selector/IR values and constructor
  signatures; `[node construction]` is existing exceptional Context error and
  typed IR facts; `[generic defensive read]` is a checked constructor/type
  discriminant; `[side map/set]` is existing extend ownership; `[routine error
  control]` is the existing unsupported-plugin exception. No new
  `[loop/traversal]`, `[copy helper]`, `[inherit/adopt/frozen]`, or
  `[parent/source mutation]` was introduced.
- Evidence: full core tests, core build, strict production type verification,
  and focused changed-file ESLint all pass; no performance claim is made.
- Verdict: accepted bounded type-contract correction; no compatibility shim.
- Hot-path cost contracts:
  ```json
  [{
    "id":"core-context-emit-selector-contract",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "why":"The slice makes existing Context, emit, selector, Sequence, callable, and serializer facts truthful without adding a second runtime path.",
    "dangerTokensJustification":"Existing selector/IR arrays and discriminant reads are retained at their current boundaries; no new traversal, resolver, node, clone, side map, or output policy is introduced.",
    "cases":["Context-plugin-source-parser-dispatch","emit-walk-context-output-option","Ruleset-interpolated-selector-boundary","selector-match-string-and-node-combinators","extend-index-tagged-graft-atoms","Sequence-subclass-preserving-evaluation","callable-output-root-property-guard","serializer-at-rule-and-selector-surface"],
    "behaviorEvidence":"Full core tests pass and focused changed-file tests cover selector matching, Sequence, callable output, and serializer paths.",
    "buildEvidence":"Core build and strict production type verification pass with zero core diagnostics.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  },{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"Selector-analysis consumes the existing string-or-node selector surface directly through its typed PseudoSelector and Ampersand discriminants; no bridge, clone, resolver, or output policy is added.",
    "dangerTokensJustification":"The existing selector component loop and bitset computation remain unchanged; the removed structural assertions do not add traversal, allocation, side state, or error control.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result","extend-record-selector-surface","extend-root-composition-selector-surface","extend-walk-composed-match-selector-surface"],
    "behaviorEvidence":"The full core suite and selector-analysis focused tests pass.",
    "buildEvidence":"Core build and strict production type verification pass with zero core diagnostics.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```

- Latest pass: bounded strict-type cleanup in `tree/util/extend.ts`,
  `tree/reference.ts`, `tree/extend/spine-extend.ts`, and the `OutputWriter`
  maybe-promise overload. No parser host, bridge, resolver, fallback, or shim
  was introduced.
- Architecture surface: these files remain the canonical retained selector,
  reference, and writer owners; no alternate evaluator or compatibility path
  was added.
- Separation/duplication: selector arrays are accepted only at the existing
  parser-delivery surface and normalized at existing node-only boundaries; no
  second selector or reference implementation was introduced.
- Cumulative node weight: no clone, frame, side table, or render placement was
  added; a `SelectorList` is created only when an existing node-only API needs
  one.
- New traversal: none. Existing selector-list loops and reference frame reads
  are unchanged; only their already-produced unions are narrowed at the API
  boundary.
- New node/materialization: parser-delivered selector arrays are wrapped in
  the existing `SelectorList` only when a node-only recursive API requires a
  `Selector`; no second tree or render-only node is created. No clones were
  added.
- Render path: `bufferSubjectDecls` still calls the existing writer preview;
  the overload makes its existing synchronous/async behavior truthful.
- Helper/API surface: no public helper or compatibility alias was added. The
  local `selectorSurfaceNode` boundary helper replaces repeated ad hoc array
  assumptions and does not add a runtime traversal.
- Metadata mutations: no parent/source restoration, side table, frame,
  frozen-state, or provenance mutation was added. Existing `inherit` calls
  retain their established placement ownership semantics.
- Review-flagged diff tokens: `[array helper]` and
  `[array spread/materialization]` are existing selector-list construction and
  parser-array normalization; `[node construction]` is only the existing
  `SelectorList` node boundary; `[parent/source mutation]` is a read-only
  fallback narrowing; `[side map/set]` is unchanged surrounding extend state;
  `[inherit/adopt/frozen]` is existing ownership inheritance on the same
  placement boundaries; `[generic defensive read]` is existing runtime
  discriminant inspection; `[materialized array/object]` is existing selector
  surface typing; `[routine error control]` is unchanged exceptional invariant
  handling.
- Evidence: focused extend/reference/spine suites pass 269/269; core build
  passes; strict core type verification passes with zero core diagnostics.
  No performance claim is made.
- Verdict: accepted bounded type-contract correction; no compatibility shim.
- Hot-path cost contracts:
  ```json
  [{
    "id":"legacy-tree-strict-contract-drain",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "why":"The retained Rules, Mixin, and scope-frame behavior keeps generic reference-mode Rules placement while deleting only StyleImport-specific registration, retry, and evaluation branches. No alternate evaluator, compatibility shim, new traversal, output policy, or performance claim is introduced.",
    "dangerTokensJustification":"SelectorList construction occurs only at existing node-only boundaries; no new traversal, resolver, side map, clone, or output policy is introduced.",
    "cases":["declaration-sync-and-async-render-result","declaration-merge-source-span-exclusion","default-guard-owned-value","bitset-inversion-and-disjointness","string-and-node-combinator-recognition","selector-list-singleton-collapse","selector-list-array-or-node-inheritance","parser-delivered-selector-array-ampersand","selector-array-ruleset-callable-registration","selector-array-key-set-analysis","selector-compose-cache-node-boundary","ordered-registration-context-restoration","property-merge-container-scope","mixin-invisible-sync-render-and-registration-result","extend-record-selector-surface","extend-root-composition-selector-surface","extend-walk-composed-match-selector-surface"],
    "behaviorEvidence":"Focused extend/reference/spine tests pass 269/269.",
    "buildEvidence":"Core build and strict core verification pass with zero diagnostics in the changed files.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```

## Aggressive Cutting Self-Prosecution

- Latest pass: bounded Less direct-AST mixin argument repair. The semicolon-group
  reducer now preserves recursive `ValueSlot` arguments (including authored
  adjacent terms) when constructing the canonical `List`; no bridge, source
  reparse, parser host, fallback, or alternate evaluator was introduced.
- Architecture surface: `packages/less-parser/src/ast/grammar.ts` remains the
  parser-owned direct Parseman reduction boundary, and `@jesscss/core/ast`'s
  existing recursive `ValueSlot`/`List.value` contract remains the sole public
  representation. The fix changes only the reducer's input narrowing from
  scalar `ValueNode` to the already-defined recursive slot contract.
- Separation/duplication: no second list/value model or conversion helper was
  added; the existing `requireValueSlot` boundary is reused for both scalar and
  recursive argument values.
- Cumulative node weight: no AST node, frame, map, side table, or render state
  is added. The reducer retains the same `List` node and argument count.
- New traversal: none. The existing comma-group `map` remains one pass over the
  already-reduced argument facts; no source scan, lookahead, or reparse is added.
- New node/materialization: none beyond the existing `List` construction; raw
  recursive slots remain raw and are not flattened or copied.
- Render path: unchanged. The canonical serializer/evaluator consumes the same
  `MixinCall.args` shape; the repaired benchmark case now reaches that existing
  path instead of throwing during parse reduction.
- Helper/API surface: no public export, alias, shim, or compatibility helper was
  added; `requireValueSlot` is the existing grammar-local narrowing boundary.
- Metadata mutations: none.
- Review-flagged diff tokens: `[array helper]` is the existing comma-group
  `List` construction and `map`; no new loop, traversal, spread/materialization,
  node construction, side map/set, or routine error path was introduced.
- Behavior evidence: the complete Less parser suite passes 270/270, including
  the new regression covering `linear-gradient(...), url(...) center/cover
  no-repeat` in a semicolon-terminated variadic mixin call; the rebuilt public
  parser now accepts `benchmark.less` and returns a 677-child `Stylesheet`.
- Build evidence: `pnpm --filter @jesscss/less-parser build` passes and touched
  source/test ESLint reports zero diagnostics. Direct package `tsc --noEmit`
  has only the pre-existing published Parseman 0.28.0 `FusedRule` contract
  diagnostic at `src/index.ts`; the code change introduces no new diagnostic.
- Boundary evidence: public `parse()` and the Context/plugin `safeParse()` route
  both consume the repaired direct grammar; the rebuilt compiler renders the
  same fixture with 122,723 bytes / SHA-256
  `2ab6d3fd8f322df0f0be7c1a481b528ec50a7fb035604b744c7543397d56b3fe`.
- Evidence: matched current sanity measurements (not a performance claim) are
  direct parse 63.53 ms round median under 20 warmups + 3×45 samples and public
  Compiler 76.56 ms round median under the same fixture/options protocol; the
  direct parser bundle is 1,827,807 bytes, SHA-256
  `a08118e3232766447c327950eda1909ac11b0e6b35051acabdfab21ae03438a1`.
- Verdict: accepted bounded correctness repair; no performance claim.

## Aggressive Cutting Self-Prosecution — Less strict-unit final validation

- Latest pass: the AST-v2 value domain now defers strict unit singularity until
  final typed materialization/emission. Compound numerator/denominator facts
  stay on the existing `Dimension` result while later operations cancel them;
  no bridge, source reparse, parser host, fallback, or alternate evaluator was
  introduced.
- Architecture surface: `packages/core/src/ast/value-operate.ts` and the
  existing `packages/core/src/ast/serialize.ts` final typed-value emission
  boundary; no new parser or evaluator host is introduced.
- Separation/duplication: the validator reuses the existing `Dimension`,
  `List`, and `Block` value facts and is the sole strict-unit final check; no
  duplicate unit resolver or source-level reparse exists.
- Cumulative node weight: zero new AST nodes, frames, maps, side tables, or
  retained render state; only existing value facts are inspected.
- **New traversal:** `validateFinalUnits` recursively visits an already-final
  typed `List`/`Block` only when strict units are enabled. This one final-boundary
  walk is required to validate nested typed values without rejecting an
  intermediate operation; no source-tree traversal or rediscovery is added.
- **New node/materialization:** none. The helper reads existing `Dimension`,
  `List`, and `Block` values. The temporary one-element unit fallback arrays in
  the singularity predicate are value-domain checks, not AST/list materialization
  or retained state.
- **Render path:** unchanged direct string emission. `evalBytes` validates the
  final typed value immediately before `emitValue`; intermediate `operate`
  results are never sent through that boundary.
- **Helper/API surface:** one exported value-domain validator is used by the
  existing serializer boundary and focused value-operation tests. It adds no
  public dialect API, resolver, shim, or compatibility surface.
- **Metadata mutations:** none. No parents, source spans, frozen flags, maps,
  or side tables are changed.
- **Review-flagged diff tokens:** `[loop/traversal]` is the strict-only final
  List/Block walk described above; `[node construction]` is the exceptional
  strict diagnostic and is not routine control flow; `[materialized
  array/object]` is limited to temporary unit-count fallback arrays in the
  predicate. No clone, node, render-only object, source mutation, or routine
  error path was added.
- **Behavior evidence:** core AST suite passes 169/169; the focused
  `value-operate-units.test.ts` passes 11/11; the public strict Less fixture
  passes byte-identically (`cancels-to-nothing: 1`, `cancels: 6px`). The
  no-strict fixture remains a separate, known bare-slash-precedence gap and is
  intentionally not claimed by this slice.
- Evidence: the focused core and strict Less fixture commands below are the
  executable behavior evidence; this bounded semantic repair makes no timing
  or allocation claim.
- **Build/type evidence:** core build passes; changed source has no new type
  diagnostics. The authoritative repository type command still reports the
  existing four Parseman `FusedRule` diagnostics; this bounded slice adds no
  new diagnostics.
- **Ponytail-style manual review:** accepted. The pass is scoped to the final
  typed-value boundary, retains unit facts on existing values, and adds no
  parser/evaluator duplicate or source-byte recovery path.
- **Verdict:** accepted bounded correctness repair; performance remains
  unclaimed and unmeasured.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-semantic-runtime-cutover",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "why":"Strict unit singularity is a final-value rule; delaying it preserves existing compound-unit facts so cancellation chains match the Less oracle without adding a second evaluator. This is one focused semantic correction inside the already-owned canonical evaluator/value cutover, not a performance or neutrality claim.",
    "dangerTokensJustification":"The strict-only final List/Block recursion and temporary unit-count fallback arrays are cold final validation, not source traversal or AST materialization; the exceptional diagnostic is emitted only when a final typed value violates strict-unit rules. No clone, node, render-state, source mutation, or duplicate resolver was added.",
    "cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve"],
    "behaviorEvidence":"Core AST suite passes 169/169; focused value-operate-units passes 11/11; the public strict Less fixture renders byte-identically with cancels-to-nothing: 1 and cancels: 6px. The no-strict fixture's unrelated bare-slash precedence gap remains explicitly unclaimed.",
    "buildEvidence":"pnpm --filter @jesscss/core build passes; changed production source and focused tests are lint-clean.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":85.86,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```

## Aggressive Cutting Self-Prosecution — shared color-channel Fn conversion

- Latest pass: `shared/color/{red,green,blue,alpha}.ts` now define the public
  Less/Sass channel callables directly over `@jesscss/core/value`; the previous
  `@jesscss/core` tree `Color`/`Num`/`Dimension` contract is removed from this
  shared family. Less and Sass barrels already reached these same files, so the
  public route is converted in place rather than routed through `builtins/`.
- Architecture surface: the existing shared function owners and universal
  value-domain `defineFunction` seam remain the only call path. No builtins
  relocation, wrapper, alias, bridge, or legacy conversion helper was added.
- Separation/duplication: the four functions use the existing value-domain
  `colorRgbRounded`/`makeDimension` semantics and do not import or call the
  comparison-only `builtins/` implementations.
- Cumulative node weight: zero AST nodes, tree objects, clones, frames, maps,
  or side tables; the only returned object is the required value-domain
  `Dimension` result.
- New traversal: none. Each function performs only its existing channel read
  and one typed-value construction.
- New node/materialization: no AST nodes, tree objects, clones, frames, maps,
  or side tables. `makeDimension` creates the required canonical value result
  for the public callable contract.
- Render path: unchanged. The callables return typed value facts; the existing
  evaluator/serializer emits their `bytes` without a tree render or conversion.
- Helper/API surface: no helper or export was added. The existing public shared,
  Less, and Sass barrels retain their names and now expose canonical callables.
- Metadata mutations: none.
- Review-flagged diff tokens: none. The diff has no new traversal, node,
  clone, spread/materialization, side map, metadata mutation, or routine error
  control machinery.
- Evidence: fns full suite passes 69 files / 459 tests; the re-export and
  canonical math focused suite passes 2 files / 11 tests; fns build passes;
  changed files are ESLint-clean. No performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining legacy
  `less/`/`sass/` function files require their own behavior-parity batches and
  are not deleted or hidden by this slice.

## Aggressive Cutting Self-Prosecution — Less color-reader Fn conversion

- Latest pass: Less `hue`, `saturation`, `lightness`, and `luma` now directly
  re-export their canonical AST-v2 value-domain implementations. No legacy
  reader implementation, wrapper, or new host seam was introduced.
- Architecture surface: existing `colorHslClamped`, `colorRgbRounded`,
  `getLuma`, `requireColor`, and `makeDimension` value helpers only. The HSL
  accessor remains lazy: authored HSL source is read from its carried `hsl`
  facts; RGB colors derive HSL only when requested.
- Separation/duplication: one implementation per reader. Less files are direct
  public entrypoint re-exports, not compatibility shims.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each reader returns one canonical `Dimension` value.
- New traversal: none. Existing HSL/RGB reader helpers perform the same scalar
  calculations as before.
- New node/materialization: no legacy tree nodes or AST nodes; `makeDimension`
  creates the required typed result once.
- Render path: unchanged typed evaluator/serializer route; no tree conversion,
  source reparse, or alternate evaluator was introduced.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Semantic evidence: a pre-cutover parity test passed for RGB and authored HSL
  source cases, matching legacy reader numbers and serialized bytes for all four
  functions (legacy unitless `Num` undefined normalizes to canonical `''`).
  Focused reader/registry tests pass 1 file / 3 tests; full fns suite and package
  build are required batch gates. No performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; no duplicate Less
  implementations remain for these four reader functions.

## Aggressive Cutting Self-Prosecution — Less blend Fn conversion

- Latest pass: Less `hardlight`, `softlight`, `exclusion`, `multiply`, and
  `screen` now directly re-export their canonical AST-v2 value-domain owners,
  preserving every existing base-helper export. The legacy `hardLightBase`
  casing remains as an explicit alias of canonical `hardlightBase`.
- Architecture surface: existing value-domain `defineFunction`, `colorBlend`,
  `requireColor`, and blend kernels only. No legacy tree import, bridge, parser
  host, fallback evaluator, or duplicate resolver remains in these Less modules.
- Separation/duplication: one implementation per blend function. Less files are
  intentional public entrypoint re-exports, not compatibility shims.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each callable returns one canonical `Color` value.
- New traversal: none. The existing alpha-aware three-channel blend loop and
  per-channel kernels are reused unchanged.
- New node/materialization: no legacy tree nodes or AST nodes; the existing
  color factory creates the required value result once.
- Render path: unchanged typed evaluator/serializer route. No tree conversion,
  source reparse, output-policy seam, or alternate evaluator was introduced.
- Helper/API surface: no new helper or public name; all previous Less base helper
  names remain available, including the historical `hardLightBase` spelling.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Semantic evidence: a pre-cutover parity test compared each legacy result with
  its canonical counterpart for fractional-alpha RGB inputs; all five matched
  raw channels and serialized bytes. Focused typed/registry tests pass 2 files /
  8 tests; full fns suite and package build are required batch gates. No
  performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; no duplicate Less blend
  implementations remain for this five-function batch.

## Aggressive Cutting Self-Prosecution — Less overlay alias audit

- Latest pass: Less `overlay` now directly re-exports the canonical AST-v2
  value-domain implementation and its public `overlayBase` helper. Typed tests
  cover both blend branches and assert the Less path and registry identity.
- Architecture surface: existing value-domain `defineFunction`, `colorBlend`,
  `requireColor`, `multiplyBase`, and `screenBase` only. No legacy tree import,
  bridge, parser host, fallback evaluator, or duplicate resolver remains in the
  Less overlay module.
- Separation/duplication: one overlay implementation remains in builtins; the
  Less file is an intentional public entrypoint re-export, not a compatibility
  shim. The shared base helper names remain available for existing consumers.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. The callable returns the existing canonical `Color` value once.
- New traversal: none. The existing three-channel alpha-aware blend loop and
  per-channel overlay kernel are reused unchanged.
- New node/materialization: no legacy tree nodes or AST nodes. The existing
  color factory creates the required value result.
- Render path: unchanged typed evaluator/serializer route. No tree conversion,
  source reparse, output-policy seam, or alternate evaluator was introduced.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Audit disposition: the initial average comparison used the wrong expected
  serialized spelling. Legacy `Color._rgb` retains fractional channel precision
  (`127.5`), while its RGB serializer emits `rgb(128, 128, 128)`; the canonical
  value result preserves the same raw channels and bytes. The follow-on average
  conversion is recorded immediately below.
- Evidence: focused overlay/blend/serialization tests pass 3 files / 15 tests;
  full fns suite and package build are required batch gates. No performance
  claim is made for the overlay-only pass.
- Verdict: accepted bounded in-place AST-v2 overlay conversion; average now has
  a separately verified canonical alias pass below.

## Aggressive Cutting Self-Prosecution — Less average alias audit

- Latest pass: Less `average` now directly re-exports the canonical AST-v2
  value-domain implementation and its public `averageBase` helper. Tests assert
  the Less path and registry identity plus raw channel and serialized-byte parity.
- Architecture surface: existing value-domain `defineFunction`, `colorBlend`,
  and `requireColor` only. No legacy tree import, bridge, parser host, fallback
  evaluator, or duplicate resolver remains in the Less average module.
- Separation/duplication: one implementation remains in builtins; the Less file
  is an intentional public entrypoint re-export, not a compatibility shim.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. The callable returns one canonical `Color` value.
- New traversal: none. The existing alpha-aware three-channel blend loop and
  average kernel are reused unchanged.
- New node/materialization: no legacy tree nodes or AST nodes. The existing
  color factory creates the required value result once.
- Render path: unchanged typed evaluator/serializer route; no tree conversion,
  source reparse, or alternate evaluator was introduced.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: focused average/overlay/blend/serialization tests pass 3 files / 15
  tests; full fns suite and package build are required batch gates. No
  performance claim is made.
- Verdict: accepted bounded in-place AST-v2 average conversion; no duplicate
  Less implementation remains.

## Aggressive Cutting Self-Prosecution — Less argb/difference Fn conversion

- Latest pass: Less `argb` and `difference` public paths now directly re-export
  the existing canonical AST-v2 value-domain implementations from `builtins/`.
  Focused tests use typed `Color` facts and assert that the Less entrypoint and
  registry contain the same callable object.
- Architecture surface: existing value-domain `defineFunction`, color factories,
  `colorRgbRounded`, `colorRawRgb`, and `colorBlend` only. No legacy `Color`, tree
  utility, parser host, bridge, fallback evaluator, or duplicate resolver remains
  in these public modules.
- Separation/duplication: one implementation per function. The Less files are
  intentional public entrypoint re-exports, not compatibility shims or duplicate
  implementations. `argb` preserves rounded display channels plus raw channels;
  `difference` uses the shared alpha-aware blend kernel.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. The functions return only their required canonical `Color` value.
- New traversal: none. `argb` reads typed color channels once; `difference` uses
  the existing three-channel blend loop already owned by the shared kernel.
- New node/materialization: no legacy tree nodes or AST nodes. Color factories
  create the required canonical value result once.
- Render path: unchanged typed evaluator/serializer route. No tree conversion,
  source reparse, output-policy seam, or alternate evaluator was introduced.
- Helper/API surface: no helper or public name was added. Existing Less `argb`
  and `difference` entrypoints remain available with the canonical value contract.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: focused argb/blend/serialization tests pass 3 files / 12 tests; full
  fns suite and package build are required batch gates. No performance claim is
  made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining legacy
  `less/`/`sass/` function files require their own behavior-parity batches and
  are not deleted or hidden by this slice.

## Aggressive Cutting Self-Prosecution — Less e/escape Fn conversion

- Latest pass: Less `e` and `escape` public subpaths now directly re-export the
  canonical AST-v2 value-domain implementations from `builtins/`; no legacy
  `Node`, `Quoted`, `Any`, `serializeNodeValue`, or Context wrapper remains in
  either public module. The registry and public Less paths are asserted to use
  the same callable objects.
- Architecture surface: existing `defineFunction`, `FnCtx`, and `makeKeyword`
  value contracts only. `escape` remains context-sensitive through its existing
  typed `List`/`FnCtx.stringify` contract; this slice does not alter logical or
  Context-dependent function semantics.
- Separation/duplication: one implementation per function. The Less files are
  intentional public entrypoint re-exports, not compatibility shims or duplicate
  implementations.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Only canonical `Keyword` values are returned where the function's
  existing behavior requires a transformed string.
- New traversal: none. `e` performs one typed-value check; `escape` serializes
  the supplied typed argument list through the existing host hook and applies its
  existing URL encoding.
- New node/materialization: no legacy tree nodes or AST nodes. `makeKeyword`
  creates the required canonical value result; raw legacy direct calls are no
  longer accepted by these public paths.
- Render path: unchanged typed evaluator/serializer route. No tree conversion,
  source reparse, fallback evaluator, or output-policy seam was introduced.
- Helper/API surface: no helper or public name was added. Existing Less `e` and
  `escape` entrypoints remain available with the canonical value contract.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: focused e/escape, registry, and re-export tests pass 4 files / 12
  tests; full fns suite and package build are required batch gates. No
  performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining legacy
  `less/`/`sass/` function files require their own behavior-parity batches and
  are not deleted or hidden by this slice.

## Aggressive Cutting Self-Prosecution — shared math Fn conversion

- Latest pass: shared `ceil`, `floor`, and `round` now define the canonical
  typed value callables. Less public subpaths are explicit re-exports of those
  owners, and the comparison-only builtins registry imports the shared owners
  directly. This is an in-place AST-v2 value conversion, not a builtins move.
- Architecture surface: the existing value-domain `defineFunction` seam and
  `makeDimension` factory are the only production path. The converted files
  have no legacy tree imports or `mathHelper`; no parser host, bridge, resolver,
  compatibility shim, or alternate evaluator was introduced.
- Separation/duplication: there is one implementation per math function.
  Less's published paths and Sass global/module exports consume the shared
  owner; the alias tests assert those identities.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each callable creates only its required canonical `Dimension` result.
- New traversal: none. The functions perform one typed numeric operation and
  one value construction.
- New node/materialization: no AST/tree nodes or routine materialization;
  `makeDimension` returns the required typed value. Raw JavaScript numbers are
  intentionally rejected at this public callable boundary, matching the
  canonical `defineFunction` contract; parser/evaluator inputs are typed
  `Dimension` values.
- Render path: unchanged. Returned typed values continue through the existing
  evaluator/serializer path. `round` retains its optional typed precision and
  unit-preserving behavior.
- Helper/API surface: no new helper or public name. Existing Less paths remain
  documented exports implemented as direct re-exports, not compatibility code.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: focused math/Sass alias suite passes 6 files / 23 tests; full fns
  suite passes 72 files / 466 tests. Build and aggressive-cutting verification
  are the required batch gates. No performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining legacy
  `less/`/`sass/` function files require their own behavior-parity batches and
  are not deleted or hidden by this slice.

## Aggressive Cutting Self-Prosecution — Less bare-slash evaluator

- Latest pass: `promoteBareSlashValue` now evaluates the parser-owned scalar
  slash fact in eager Less math and leaves ordinary lists and parenthesized
  values on their existing paths.
- Architecture surface: one canonical AST-v2 `ValueSlot` evaluator and the
  existing typed `operation()` constructor; no parser bridge, source reparse,
  scanner, resolver, or compatibility evaluator.
- Separation/duplication: no duplicate arithmetic implementation. The helper
  only restores precedence from existing `Operation` nodes and delegates every
  result to the canonical value evaluator.
- Cumulative node weight: the authored AST remains immutable; only the rare
  recognized scalar slash shape gets temporary operation records for immediate
  typed evaluation.
- New traversal: [loop/traversal] bounded top-level slash detection, one
  recursive walk over an existing arithmetic spine, and two precedence-tier
  reductions; no whole-tree or source walk.
- New node/materialization: [node construction] temporary `Operation` records
  are created only for immediate arithmetic evaluation; no render-only nodes,
  legacy nodes, clones, or metadata mutation.
- Render path: [array helper] ordinary space/slash lists and nested groups use
  the pre-existing layout join; no array is built merely to stringify.
- Helper/API surface: [array spread/materialization] private
  `promoteBareSlashValue`, `appendBareSlashTokens`, and tier reducer replace a
  missing precedence step and expose no public API.
- Metadata mutations: [side map/set] none; the three operator sets are
  immutable module-level classification facts, not runtime side maps.
- [materialized array/object] Allocation accounting: token/value arrays occur
  only after a top-level slash leaf is present; the common no-slash path returns
  before token allocation. The parens-division mode object is allocated only
  for a recognized slash boundary.
- Review-flagged diff tokens: `[loop/traversal]`, `[array helper]`,
  `[array spread/materialization]`, `[node construction]`, `[side map/set]`,
  and `[materialized array/object]` are all bounded above and covered by the
  allocation accounting above.
- Evidence: focused `strict-units.test.ts` passes 4/4, including `7em`,
  `4.4em`, `2em`, strict cancellation, ordinary slash-list preservation,
  grouped division, and parens-division controls. Build passed for core and
  the jess dependency graph. No performance claim is made.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-semantic-runtime-cutover",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "why":"The bare-slash promotion is a bounded correctness repair inside the existing canonical AST-v2 serializer owner. It classifies one parser-owned top-level slash boundary, creates temporary operation facts only for immediate typed evaluation, and preserves the no-slash path; no speed or neutrality claim is made.",
    "dangerTokensJustification":"[loop/traversal] is limited to top-level slash detection, one existing arithmetic spine, and two precedence tiers; [array helper] and [materialized array/object] are limited to the recognized slash shape; [array spread/materialization] is one parens-mode context record; [node construction] is temporary Operation records; [side map/set] is immutable module-level operator classification. No source walk, clone, bridge, or parser reparse is added.",
    "cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve","Less-eager-bare-slash-precedence-and-parens-division"],
    "behaviorEvidence":"Focused packages/jess strict-units.test.ts passes 4/4: 7em, 4.4em, 2em, strict cancellation, ordinary slash-list preservation, grouped division, and parens-division controls.",
    "buildEvidence":"pnpm --filter @jesscss/core build and pnpm --filter jess... build pass.",
    "baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":79.823,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
  }]
  ```
- Verdict: accepted as a bounded evaluator-only Less math fix; no source
  reparse, parser change, bridge, or public compatibility shim was added.

## Aggressive Cutting Self-Prosecution — Less pi/mod Fn conversion

- Latest pass: Less `pi` and `mod` now directly re-export the already-registered
  canonical AST-v2 value-domain callables from `builtins/`. Both historical
  named exports and default entrypoints remain available; the old duplicate
  value-domain definitions are removed in place.
- Architecture surface: the existing typed `defineFunction` contract and
  `makeDimension` factory only. No legacy tree node, Context wrapper, parser
  host, bridge, fallback evaluator, or compatibility shim was introduced.
- Separation/duplication: one implementation per function. Less's public
  files are intentional entrypoint re-exports of the canonical builtins, not
  relocation wrappers or duplicate implementations.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each callable creates only its required canonical `Dimension` result.
- New traversal: none. `pi` computes one constant; `mod` performs one scalar
  remainder and carries the dividend unit, as the prior Less function did.
- New node/materialization: no legacy tree nodes or AST nodes; `makeDimension`
  creates the required value-domain result once.
- Render path: unchanged typed evaluator/serializer route; no tree conversion,
  source reparse, or alternate output path was added.
- Helper/API surface: no helper or public name was added. Existing `pi`/`mod`
  named and default Less exports remain available through direct aliases.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: the focused parity suite compares canonical results with
  pre-cutover Less `Dimension` oracles for unitless `pi` and signed/fractional
  `mod` inputs, asserting numbers, units, and serialized bytes. Registry and
  named/default entrypoint identity are asserted for both functions.
- Verification evidence: focused parity tests pass 3/3; full fns suite passes
  74 files / 482 tests; `@jesscss/core` and `@jesscss/awaitable-pipe` upstream
  builds plus `@jesscss/fns` build pass; package export verification and
  aggressive-cutting review pass. No performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining Less
  function files require their own behavior-parity batches.

## Aggressive Cutting Self-Prosecution — Less sqrt Fn conversion

- Latest pass: Less `sqrt` now directly re-exports the canonical AST-v2
  value-domain callable from `builtins/`; the duplicate Less body is removed in
  place. The Less named/default path and builtin registry resolve to the same
  callable object.
- Architecture surface: the existing typed `defineFunction`/`Fn` value
  contract, `unaryMath`, and `makeDimension` result factory only. No legacy tree
  node, Context wrapper, parser host, bridge, fallback evaluator, or
  compatibility shim was introduced.
- Separation/duplication: one implementation per function. The Less module
  remains an explicit public entrypoint re-export, not a moved copy or a second
  runtime implementation.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each call creates only its required canonical `Dimension` result.
- New traversal: none. Existing `unaryMath` performs one typed dimension check,
  scalar `Math.sqrt`, and unit preservation; it intentionally does not apply
  angle normalization for the `null` output-unit mode.
- New node/materialization: no legacy tree nodes or AST nodes; the canonical
  value factory creates the required result once.
- Render path: unchanged typed evaluator/serializer route; no tree conversion,
  source reparse, or alternate output path was added.
- Helper/API surface: no helper or public name was added. Existing Less `sqrt`
  named and default exports remain available through the direct re-export.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: the focused parity suite compares canonical results with a local
  pre-cutover Less `mathHelper` oracle across unitless, ordinary-unit, and
  angle-unit inputs (including a negative input's `NaN` result), asserting
  numbers, units, and serialized bytes. Registry and named/default entrypoint
  identity are asserted. Focused tests pass 2/2; the full fns suite passes 76
  files / 486 tests; `@jesscss/fns` build, changed-file ESLint, and
  aggressive-cutting review pass. No performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining Less math
  functions require their own behavior-parity batches.

## Aggressive Cutting Self-Prosecution — bubbled @container child-rule order (historical record; superseded below)

- Latest pass: the canonical AST-v2 serializer now stages only static children
  of a bubbled conditional block when its propagated selector context is
  non-null. Direct declarations/comments are emitted before those child rules,
  matching Less for both `@media` and `@container`; dynamic mixin, loop, import,
  and variable-bearing bodies retain the existing streaming path.
- Architecture surface: `packages/core/src/ast/serialize.ts` only. This is a
  render-order correction in the existing AST-v2 emitter; no parser host,
  bridge, source reparse, scanner, compatibility path, or second evaluator was
  introduced.
- Separation/duplication: no duplicate selector or at-rule emitter. Deferred
  callbacks invoke the existing `flatten`, `emitAtRuleBlock`, and
  `emitAtRuleStatement` operations after the one existing direct-leaf flush.
- Cumulative node weight: no AST nodes, frames, side maps, or copies are added.
  One short-lived callback array is created only for a static bubbled body.
- New traversal: `[loop/traversal]` one bounded pass over the already-owned
  statement array to classify whether static staging is safe, plus one ordered
  callback pass over deferred children. No source/tree rediscovery or recursive
  walk is added.
- New node/materialization: none. `[materialized array/object]` is the
  short-lived deferred callback array for static child emitters only; it is not
  a node/value materialization and the dynamic path allocates nothing new.
- Render path: direct declarations still resolve through `flushBlock`; child
  rules and nested at-rules still stringify through their existing emitters.
  Nothing is rendered to an intermediate AST or string solely to reorder it.
- Helper/API surface: no public helper or API. The local static-shape predicate
  and callback queue are limited to this emitter and disappear after the body.
- Metadata mutations: none. Existing frame, source, position, and import state
  are threaded unchanged through the deferred callbacks.
- Review-flagged diff tokens: `[loop/traversal]` is the bounded statement-array
  classification and ordered callback loop; `[materialized array/object]` is
  the static-only callback queue. No clone, side-map, source mutation, or
  render-only value array was added.
- Evidence: public Less integration lock in
  `packages/jess/test/less/at-rule-bubbling-bugs.test.ts` passes 8/8, including
  byte-equivalent nested `@media` and `@container` cases where a declaration
  follows a child rule. The focused at-rule suite passes 11/12 (one pre-existing
  skipped nesting case); core build and changed-file ESLint pass with existing
  warnings. No performance claim is made.
- Hot-path cost contracts:
  ```json
  [{
    "id":"ast-semantic-runtime-cutover",
    "verdict":"accepted",
    "performanceClaim":"none",
    "owner":"the canonical AST-v2 serializer/evaluator owners listed by ast-semantic-runtime-cutover",
    "why":"Static bubbled conditional bodies must match Less's declaration-before-child ordering. The existing dynamic streaming path is unchanged; only the already-owned statement array is classified and static child emitter callbacks are staged.",
    "dangerTokensJustification":"[loop/traversal] is one bounded statement-array classification and one deferred-child callback loop; [materialized array/object] is a static-only callback queue. No source walk, clone, bridge, or parser reparse is added.",
    "cases":["bubbled-media-direct-before-child","bubbled-container-direct-before-child","dynamic-bubble-body-streaming-preserved"],
    "behaviorEvidence":"at-rule-bubbling-bugs.test.ts passes 8/8, with both @media and @container direct-after-child cases matching Less output.",
    "buildEvidence":"pnpm --filter @jesscss/core build and pnpm --filter jess test -- --run test/less/at-rule-bubbling-bugs.test.ts pass."
  }]
  ```
- Verdict: accepted bounded AST-v2 emitter correction; no performance claim is
  made and no legacy route was retained.

## Aggressive Cutting Self-Prosecution — Less pow Fn conversion

- Latest pass: Less `pow` now directly re-exports the canonical AST-v2
  value-domain callable from `builtins/`; the duplicate Less body is removed in
  place. The Less named/default path and builtin registry resolve to the same
  callable object.
- Architecture surface: the existing typed `defineFunction`/`Fn` value
  contract, `requireDimension`, and `makeDimension` result factory only. No
  legacy tree node, Context wrapper, parser host, bridge, fallback evaluator,
  or compatibility shim was introduced.
- Separation/duplication: one implementation per function. The Less module is
  an explicit public entrypoint re-export, not a moved copy or a second runtime
  implementation.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each call creates only its required canonical `Dimension` result.
- New traversal: none. The canonical implementation performs two typed
  dimension checks, one scalar `Math.pow`, and carries the base unit exactly as
  the prior Less function did.
- New node/materialization: no legacy tree nodes or AST nodes; the canonical
  value factory creates the required result once.
- Render path: unchanged typed evaluator/serializer route; no tree conversion,
  source reparse, alternate output path, or function-level fallback was added.
- Helper/API surface: no helper or public name was added. Existing Less `pow`
  named and default exports remain available through direct re-exports.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: the focused parity suite compares canonical results with a local
  pre-cutover Less `Dimension` oracle across signed, fractional, unitless, and
  mixed-unit inputs, asserting numbers, units, and serialized bytes. Registry
  and named/default entrypoint identity are asserted. Focused tests pass 3
  files / 5 tests; the full fns suite passes 77 files / 488 tests; the fns
  build, changed-file ESLint, and aggressive-cutting review pass. No
  performance claim is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining Less
  function files require their own behavior-parity batches.

## Aggressive Cutting Self-Prosecution — Less sin/cos Fn conversion

- Latest pass: Less `sin` and `cos` now directly re-export the canonical
  AST-v2 value-domain callables from `builtins/`; the duplicate Less bodies are
  removed in place. The Less named/default paths and builtin registry all
  resolve to the same callable objects.
- Architecture surface: the existing typed `defineFunction`/`Fn` value
  contract and `makeDimension` result factory only. No legacy tree node,
  Context wrapper, parser host, bridge, fallback evaluator, or compatibility
  shim was introduced.
- Separation/duplication: one implementation per function. The Less modules
  remain explicit public entrypoint re-exports, not moved copies or aliases to
  a second runtime implementation.
- Cumulative node weight: zero AST nodes, frames, maps, side tables, or render
  state. Each call creates only its required canonical `Dimension` result.
- New traversal: none. Existing `unaryMath` performs one typed dimension check,
  angle normalization, and scalar `Math.sin`/`Math.cos` operation.
- New node/materialization: no legacy tree nodes or AST nodes; the canonical
  value factory creates the required result once.
- Render path: unchanged typed evaluator/serializer route; no tree conversion,
  source reparse, or alternate output path was added.
- Helper/API surface: no helper or public name was added. Existing Less
  `sin`/`cos` named and default exports remain available through direct
  re-exports.
- Metadata mutations: none.
- Review-flagged diff tokens: none. No traversal, clone, node, spread,
  side-map, metadata mutation, or routine error-control machinery was added.
- Evidence: the focused parity suite compares canonical results with a local
  pre-cutover Less `mathHelper` oracle across unitless, degree, gradian, turn,
  and ordinary-unit inputs, asserting numbers, units, and serialized bytes;
  registry and named/default entrypoint identity are asserted for both calls.
  Focused tests pass 4/4; the full fns suite passes 75 files / 484 tests;
  `@jesscss/fns` build and aggressive-cutting review pass. No performance claim
  is made.
- Verdict: accepted bounded in-place AST-v2 conversion; remaining Less math
  functions require their own behavior-parity batches.

## Aggressive Cutting Self-Prosecution — bubbled @container child-rule order (current)

- Latest pass: static bubbled conditional bodies now stage direct declarations
  and comments before child rules, matching Less for both `@media` and
  `@container`; dynamic mixin, loop, import, and variable-bearing bodies keep
  the existing streaming route.
- Architecture surface: `packages/core/src/ast/serialize.ts` only. No parser
  host, bridge, source reparse, scanner, compatibility path, or second evaluator.
- Separation/duplication: deferred callbacks invoke existing `flatten`,
  `emitAtRuleBlock`, and `emitAtRuleStatement`; no duplicate emitter exists.
- Cumulative node weight: no nodes, frames, side maps, or copies. One callback
  array exists only for a static bubbled body.
- New traversal: `[loop/traversal]` one bounded statement-array classification
  and one ordered callback pass; no source/tree rediscovery or recursive walk.
- New node/materialization: none. `[materialized array/object]` is only the
  static callback queue, not a node/value materialization.
- Render path: direct leaves still use `flushBlock`; child rules/at-rules still
  stringify through existing emitters; no intermediate output tree/string.
- Helper/API surface: no public helper or API; the predicate and queue are
  local to this emitter.
- Metadata mutations: none; existing frame/source/position/import state is
  threaded unchanged.
- Review-flagged diff tokens: `[loop/traversal]` is the bounded classification
  and callback loop; `[materialized array/object]` is the static-only queue.
  No clone, side-map, source mutation, or render-only value array was added.
- Evidence: `at-rule-bubbling-bugs.test.ts` passes 8/8, including byte-equivalent
  @media/@container direct-after-child cases; core build and changed-file ESLint
  pass with existing warnings. No performance claim is made.
- Hot-path cost contracts:
  ```json
  [{"id":"ast-semantic-runtime-cutover","verdict":"accepted","performanceClaim":"none","owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover","why":"Static bubbled conditional bodies must match Less declaration-before-child ordering while dynamic streaming remains unchanged; this is semantic runtime work, not a neutral or speed claim.","dangerTokensJustification":"[loop/traversal] is one bounded statement classification plus one callback pass; [materialized array/object] is a static-only callback queue; no source walk, clone, bridge, or parser reparse.","cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve","Less-eager-bare-slash-precedence-and-parens-division"],"behaviorEvidence":"at-rule-bubbling-bugs.test.ts 8/8 with both @media and @container Less-oracle cases.","buildEvidence":"core build and focused jess suite pass.","baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":79.823,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}}]
  ```
- Verdict: accepted bounded AST-v2 emitter correction; no legacy route retained.

## Aggressive Cutting Self-Prosecution — matched parser instrumentation-guard isolation (diagnostic)

- Latest pass: a temporary generated Less-parser copy removed only normal-path
  reads of optional Parseman profile/CST-output state. This was a read-only
  diagnostic experiment; no production or generated artifact was changed.
- Architecture surface: the existing direct Parseman `run(entry, input,
  { trivia })` boundary and canonical AST-v2 `Stylesheet` result. No parser
  host, bridge, source reparse, scanner, compatibility path, or shim was added.
- Separation/duplication: none. The diagnostic copy exercised the same generated
  grammar and parser-local reductions as the committed artifact.
- Cumulative node weight: none. The experiment changed no node factory,
  evaluator, renderer, frame, map, or retained AST shape.
- New traversal: none. The benchmark loop existed in the temporary measurement
  harness only; it is not production code or a parser path.
- New node/materialization: none. Both sides returned the same 677-child
  `Stylesheet` and byte-identical 946,987-byte stable JSON.
- Render path: not applicable; this is direct parse-only timing. No values or
  nodes were resolved merely to stringify.
- Helper/API surface: none. The temporary substitution is deleted after the
  measurement and is not a package export or runtime helper.
- Metadata mutations: none. No source, parent, location, profile, cache, or
  Context state was mutated.
- Review-flagged diff tokens: `[array helper]` appears only in the historical
  aggregate inventory line already present in the integration diff; this docs
  entry adds no runtime danger-token code. Other danger categories are absent
  from the pass.
- Evidence: Node v24.11.1 arm64; `benchmark.less` 106,802 bytes, SHA-256
  `abe392656c8a50e9d175c3b0e60415893a8eb7bfe9050518227391430d3a3d48`; A
  artifact 1,827,807 bytes/SHA-256
  `a08118e3232766447c327950eda1909ac11b0e6b35051acabdfab21ae03438a1`; B
  artifact 1,812,467 bytes/SHA-256
  `05703701303497689f1e3ffe85ad7ba8de139cf99c434f852b145d1241886767`;
  20 warmups and three 45-pair alternating rounds. A/B round medians were
  59.470/59.458, 60.039/59.696, and 59.892/59.692 ms; aggregate A 59.918 ms,
  B 59.649 ms; paired B−A median +0.139 ms, mean +0.307 ms, B faster in 62/135
  pairs and slower in 73/135. Stable output JSON SHA-256 was
  `8e3a371bd286ff2682ee08d56c451274a94b14203dbe8de68ad2057aa6cc13c3` on
  both sides. This is behavior and matched-isolation evidence only; it does
  not support a production speed claim or optimization.
- Verdict: reject an optional-guard optimization on this evidence; retain the
  guards for opt-in Parseman profiling/CST diagnostics and continue the
  reducer/choice/backtracking investigation separately.

## Aggressive Cutting Self-Prosecution — reference-import extend admission

- Latest pass: a reference-imported stylesheet is now admitted to the existing
  typed extend preflight even when that imported document contains no own
  `:extend()`. A visible extender in the importing document can therefore fold
  into a hidden imported target's direct declarations. Ordinary imports keep the
  existing `bodyMayPlanExtend()` admission gate.
- Architecture surface: this remains the existing Context/plugin-loaded
  `Stylesheet` import fact and the canonical AST-v2 extend planner. No parser
  host, bridge, source reparse, resolver, scanner, or compatibility route was
  added.
- Separation/duplication: none. The change reuses
  `collectPlacedExtendFacts()` and the existing `referenceBoundary` provenance;
  it adds no alternate import walk or resolver.
- Cumulative node weight: none. Existing planner subjects reference canonical
  `Rule` nodes; this admission does not copy or materialize nodes.
- New traversal: the existing cold reference-import preflight now visits the
  imported rule subjects when `reference` is set. This is required because the
  importer may extend a target that has no local extend instruction; carrying the
  subject through the already-owned planner state is cheaper and more truthful
  than rediscovering it during render.
- New node/materialization: none. Canonical `Rule` nodes are reused; no copies,
  wrappers, maps, or metadata mutations were introduced.
- Render path: no new render traversal or string materialization. The planner's
  existing hidden/visible branch mask controls whether the imported target emits
  under the visible extender selector.
- Helper/API surface: none; one admission predicate now includes the existing
  typed `reference` option.
- Metadata mutations: none beyond the pre-existing reference-boundary fact passed
  to the planner.
- Review-flagged diff tokens: none in the runtime hunk; the added condition does
  not introduce a loop, allocation, side map, copy, or routine error path.
- Evidence: `pnpm --filter @jesscss/core test -- --run` passed 199 files,
  3194 passed, 9 skipped, and 2 intentionally marked tests; `pnpm --filter @jesscss/core test -- --run
  src/ast/__tests__/import-at-rule.test.ts` passed 27/27; `pnpm --filter jess
  test -- reference-import-namespace.test.ts extend-cross-import.test.ts --run
  --globals` passed 4/4; the red `extend-cross-import.test.ts` reference-import
  oracle now passes byte-identically; config fixtures pass 29/29 with existing
  expected-failure markers. This is behavior evidence only; no performance claim
  was made.
- Ponytail-style manual review: no `delete`, `stdlib`, `native`, `yagni`, or
  `shrink` finding; `Lean already. Ship.`
- Hot-path cost contracts:
  ```json
  [
    {
      "id": "ast-extend-import-preflight",
      "verdict": "accepted",
      "performanceClaim": "none",
      "why": "Reference-import extend visibility is a semantic correction in the existing cold preflight: a hidden imported target with no local extend must still be available to a visible importer extender, while ordinary imports retain the existing feature-bearing admission gate. This is not a speed or neutrality claim.",
      "dangerTokensJustification": "The existing typed preflight collector is reused only for reference imports; no new parser walk, renderer traversal, node materialization, side map, copy, source mutation, or routine error path is added. Ordinary imports retain the prior zero-feature admission behavior.",
      "falsePath": {
        "fixture": "extend-preflight-contract:no-extend",
        "counters": {"calls": 1, "collectorCalls": 0, "overlaySubjects": 0, "overlayInstructions": 0, "loopPlacements": 0}
      },
      "featurePath": {
        "fixture": "extend-preflight-contract:imported-loop",
        "counters": {"importsVisited": 1, "loopPlacements": 2, "overlaySubjects": 2}
      },
      "baseline": {
        "fixture": "benchmark.less",
        "phase": "parse-render",
        "currentMedianMs": 81.0,
        "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6",
        "outputBytes": 122390
      },
      "behaviorEvidence": "extend-preflight-contract.test.ts proves false and feature paths; extend-cross-import.test.ts reference-import oracle passes byte-identically; core import-at-rule passes 27/27; full core passes 3194 tests.",
      "buildEvidence": "pnpm --filter @jesscss/core build and focused Jess suites pass."
    },
    {
      "id": "ast-semantic-runtime-cutover",
      "verdict": "accepted",
      "performanceClaim": "none",
      "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
      "why": "This coordinated AST-v2 runtime surface includes the extend planner's reference-import admission correction. It is semantic architecture work with existing traversal and placement state; no single admission counter, byte-identical A/B, or speed claim would describe it truthfully.",
      "dangerTokensJustification": "The existing cold preflight collector is reused for reference imports and the canonical Rule subjects remain shared. No parser walk, renderer traversal, node materialization, side map, copy, source mutation, or routine error path is added by the admission correction.",
      "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division"],
      "behaviorEvidence": "Full core suite passes 199 files / 3194 tests; import-at-rule passes 27/27; reference-import and extend-cross-import output oracles pass 4/4.",
      "buildEvidence": "pnpm --filter @jesscss/core build and focused Jess suites pass.",
      "baseline": {
        "fixture": "benchmark.less",
        "phase": "render",
        "currentMedianMs": 79.823,
        "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6",
        "outputBytes": 122390
      }
    }
  ]
  ```
- Verdict: accepted bounded semantic correction; no legacy route retained.

## Aggressive Cutting Self-Prosecution — Less interpolated selector pseudos

- Latest pass: the public direct Less AST grammar now reduces interpolated pseudo
  names (`:@{name}` / `::@{name}`), interpolated `:nth-*` arguments
  (`:nth-child(@{index})`), quoted interpolation after the CSS `|=` attribute
  operator, and leading combinators inside nested functional pseudo selectors
  as typed selector facts. The namespace-prefix arm now proves it is not
  consuming `|=`, and the pseudo argument reuses the existing canonical
  `ComplexSelector.leadingComb` field. No selector text is rescanned or
  reparsed, and no compatibility bridge is added.
- Architecture surface: `packages/less-parser/src/ast/grammar.ts` direct
  Parseman reductions and the existing canonical AST selector factories.
- Separation/duplication: the grammar reuses the existing interpolation and
  selector-simple factories; no alternate selector parser or renderer exists.
- Cumulative node weight: one existing `SimpleSelector` containing one
  `Interpolation` payload per authored dynamic pseudo/attribute; one existing
  `ComplexSelector.leadingComb` fact per relative pseudo argument; no wrapper
  nodes.
- New traversal: none; the existing compound-selector reduction consumes the
  new atom in its ordinary one-or-more simple-selector sequence.
- New node/materialization: none beyond the existing interpolation parts.
- Render path: unchanged canonical selector serialization/evaluation; the
  interpolation is materialized only when the selector is evaluated/rendered.
- Helper/API surface: no public helper or package export; two parser-local
  reductions are added to the direct grammar rule map.
- Metadata mutations: none; source spans and parent/child relationships remain
  those produced by the canonical AST factories.
- Behavior evidence: `packages/less-parser/test/ast-grammar.test.ts` passes
  152/152 and `packages/less-parser/test/public-parse.test.ts` passes 70/70;
  the full `selectors.less` fixture now renders without a parse throw (3542
  bytes vs Less's 3557-byte oracle), with the first remaining byte difference
  at the unrelated repeated `.foo + .foo` declaration output.
- Build evidence: `pnpm --filter @jesscss/less-parser build` passes; changed
  parser/test files pass ESLint.
- Boundary evidence: the existing public `parse()` route returns canonical
  `Stylesheet`/`SimpleSelector`/`Interpolation` nodes directly; only the
  direct Less grammar and its AST-contract tests changed, with no new host,
  bridge, scanner, resolver, or package API.
- Evidence: the focused parser suites and package build above are the complete
  behavior/build boundary evidence for this bounded selector-family change.
- Existing recognizer note: the production continues to use the pre-existing
  `when` boundary lookahead in this pseudo-selector family; this slice adds no
  handwritten recognizer or new regex.
- Review-flagged diff tokens: none. No traversal, clone, side map, metadata
  mutation, or routine error-control path was added.
- Verdict: accepted bounded direct-AST selector grammar correction; the fixture's
  remaining dynamic attribute form is a separate selector-family slice.

## Aggressive Cutting Self-Prosecution — structural Less mixin rest arguments

- Latest pass: `bindArgs` no longer serializes a mixin rest or synthetic
  `@arguments` into an `Any` byte string. It preserves the existing typed
  `ValueSlot` arguments in canonical `List` values, so a single authored
  space-list remains one argument while comma and semicolon call groups remain
  separate arguments for `length()` and `extract()`.
- Architecture surface: `packages/core/src/ast/mixin-dispatch.ts` only. This is
  the canonical evaluator binding boundary; no parser, renderer, plugin
  policy, legacy tree, bridge, or dialect-specific evaluator branch was added.
- Separation/duplication: the existing canonical `List` factory is used at the
  one binding boundary that already owned both rest and `@arguments`; no
  parallel byte serializer, alternate list model, or compatibility value is kept.
- Cumulative node weight: at most two required existing `List` nodes per
  accepted call (one named rest and one `@arguments`); the former path created
  two `Any` byte leaves. No wrapper node, frame, map, side table, or copy exists.
- New traversal: `[loop/traversal]` one direct bounded pass over already-selected
  leftover arguments replaces `map` plus byte-flattening. It is not a source or
  AST walk and never rediscovers call candidates.
- New node/materialization: `[materialized array/object]` two local slot arrays
  hold existing argument references until the required `List` values are made;
  `[array spread/materialization]` appends those slots to the already-owned
  `@arguments` sequence. Neither operation clones, resolves recursively, or
  materializes a legacy node.
- Render path: unchanged canonical evaluator/serializer route; it serializes
  the resulting `List` exactly as it does every other canonical value. No output
  policy, renderer traversal, or string staging was added.
- Helper/API surface: one file-local `isValueSlot` type guard; no export or
  public API. The renderer continues to serialize the canonical list shape.
- Metadata mutations: none; source spans, parent/child ownership, frames, and
  provenance stay with the existing AST facts.
- Review-flagged diff tokens: `[loop/traversal]` is the one leftover-argument
  pass; `[materialized array/object]` is the two local reference arrays;
  `[array spread/materialization]` appends existing slots. No clone, side map,
  source mutation, generic walker, or routine-error control path was added.
- Evidence: focused core binding shapes pass 11/11; public Less `parse()` to
  canonical render passes 72/72; the compiler plus `@jesscss/plugin-less` route
  proves space/comma/semicolon call behavior. Core, Less-parser, and Less-plugin
  builds pass; changed-file ESLint has no errors. No performance claim is made.
- Hot-path cost contracts:
  ```json
  [{"id":"ast-semantic-runtime-cutover","verdict":"accepted","performanceClaim":"none","owner":"the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover","why":"Rest and synthetic @arguments binding is semantic AST-v2 information preservation: recursive ValueSlot facts must stay structural for typed list functions instead of being lost in a byte leaf. The two required List values replace the former two Any leaves; this is not a speed or neutrality claim.","dangerTokensJustification":"[loop/traversal] is one bounded pass over the already-selected leftover call arguments; [materialized array/object] is two local arrays of existing ValueSlot references; [array spread/materialization] appends those references to the synthetic arguments sequence. No source/tree walk, clone, side map, bridge, parser reparse, or output staging is introduced.","cases":["ValueSlot-array-evaluation-and-authored-layout","List-value-separator-and-Block-delimiter-facts","reference-index-and-For-array-access","Less-lazy-color-call-demand-boundary","defineFunction-typed-positional-named-and-lazy-binding","mixin-dispatch-ValueSlot-argument-resolution","ValueLayout-provenance-side-table","preserve-mode-calc-result-composition","extend-composition-plan-and-fixpoint-solve","Less-eager-bare-slash-precedence-and-parens-division"],"behaviorEvidence":"Focused mixin-dispatch shape tests, public Less parse-to-render tests, and the Jess compiler plus Less-plugin route all pass.","buildEvidence":"Core, Less-parser, and Less-plugin builds pass; changed-file ESLint has no errors.","baseline":{"fixture":"benchmark.less","phase":"render","currentMedianMs":79.823,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}}]
  ```
- Verdict: accepted structural repair. The discarded byte flattening was an
  invalid bridge that lost recursive AST information; this pass removes it.
