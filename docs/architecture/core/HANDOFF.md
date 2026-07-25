# Core Architecture Handoff

> **Architecture correction — supersedes every prior “private direct-AST grammar”,
> “development-only AST seam”, or “wire it later” claim in this document and
> linked future plans. Those claims were wrong/hallucinated migration staging,
> not an approved architecture. AST v2 and the deletion work are the public
> architecture: each dialect package's primary `parse()` operation must run
> Parseman reductions directly to canonical `Stylesheet`. CST APIs remain only for
> explicit language-service/document use; no CST-to-AST bridge, host, or
> compatibility route is an acceptable interim production design.

## ACTIVE PRIORITY CHECKLIST — structural-rot + perf recovery

**Reconciled 2026-07-24 against `13725f894`.** Every row below was re-checked against the
tree or a named commit on this pass; a row with no evidence pointer was deleted rather than
carried forward. Rows marked *unverified* state the date they were last known true.

**Process mandate:** every item is fixed via an adversarially-reviewed DESIGN change —
reviewed against `INVARIANTS.md`, the extend design, and the "parser owns structure"
keystone — BEFORE implementation. The review must score *structure, dispatch cost,
tree-walks, byte-re-derivation, duplication*, and "did this ignore an existing tuned
engine/design doc?" Those dimensions were added because the earlier correctness +
byte-identity + minimal-diff gates let all of P1 through.

### P0 — GUARDRAILS (prevent recurrence)

- [x] **LANDED `43eaf459f`, realigned `fdec1cd11`.** LLM quality-enforcement v1: deterministic
      teeth, the `perf-architecture-reviewer` (evidence per invariant, not a verdict), and
      advisory pins, all keyed to the canonical 9 invariants in `docs/perf/V8-ARCHITECTURE.md`.
      Design record: `docs/architecture/llm-quality-enforcement-design.md`.
- [ ] **No serialize-then-reparse of structure** — still prose, not a lint/assertion. The one
      known live violation is P1.1 below.

### P1 — EVAL/RENDER (see [[eval-render-perf-roadmap]])

- [ ] **1. `selectorAtoms` regex round-trip — STILL OPEN.** Verified 2026-07-24:
      `packages/core/src/ast/serialize.ts:1268` still serializes a *structured* compound to
      text and regex-tokenizes it back into atoms, un-memoized, at six call sites
      (`:1287/1291/1303/1307/1345/1379`). `packages/core/src/tree/extend/spine-extend.ts:1241`
      carries the legacy twin. Direct "parser owns structure" violation; read atoms off the
      parsed node.
- [x] **2. `documentHasExtend` full-tree walk — symbol is gone from `packages/core/src`**
      (verified 2026-07-24 by workspace grep). Whether a parse-time flag replaced it, or the
      detection simply moved, is *unverified*.
- [~] **3. Extend matching redesign — PARTIALLY LANDED.** `0818e9dc7` introduced the structured
      crossable `:is()` IR + dual-cursor fork matcher; `2fb2bb566` unified whole-branch matching
      into one recursive OR-fork matcher. Verified 2026-07-24: `extend/match.ts` no longer
      contains `.includes()` substring compares. NOT yet landed: the `O(1)` bitset fast-reject
      from [[feedback-extend-fast-reject-not-full-scan]] — no bitset exists in
      `packages/core/src/ast/extend/`; `solve.ts:25` documents only an `all`-rewrite skip as the
      fixpoint's fast-reject. `branchText` remains the branch key (`emit.ts:216/538/558/572`).
- [~] **4. Extend Set/clone allocation.** `7d976c78c` made the fold a one-pass fixpoint
      (quadratic → linear). No measurement of the remaining `SymmetricDifference`/`CloneObjectIC`
      churn has been recorded since; treat the residual as *unverified since 2026-07-22*.

### P2 — GRAMMAR STRUCTURAL ROT

Root cause: the scannerless port re-expanded the Chevrotain 7-arm grouped `rule` into flat
15–20-arm choices, then copy-pasted across dialects. CSS is the canonical base (it has
`OpaqueAtRuleBlock`).

- [x] **Wave 1 COMPLETE across all four grammars, byte-identical:** Less `ddaa70363` +
      `0350ec162`, CSS `492033a4c`, SCSS `1f4e9812c`, Jess `627c9dc10`, plus the shared-const
      follow-ups `5708ed191` / `4fbba50ee` / `d8ea99bc1` / `decd699c2`.
- [x] ~~`@`-read-once → keyword-switch dispatch~~ **SKIPPED, premise was wrong.** Parseman
      `emitFirstMatch` already first-char-gates the arms; there is no per-arm re-lex.
- [~] **Less decl-vs-ruleset speculation.** Addressed by *gating* rather than left-factoring:
      `53163def8` trivia-gates ruleset so declarations skip selector speculation, `e6782a2dc`
      gates mixin-or-ruleset dispatch past prefix re-scans. The full shared-prefix left-factor
      is still not done; it stays HIGH-risk and needs byte-identity proof across
      interp/custom-prop/`:extend`/guard/`!important`.
- [ ] **Wave 2 (gate on ast/ differential):** nested/non-nested paired families → body-param
      (SCSS 4 pairs, CSS, Less); Less adopts `OpaqueAtRuleBlock`; collapse
      `AtRuleBlock` + `AtRuleStatement` → one `AtRule` (changes AST node `type`, so NOT
      parser-only byte-identical — needs coordinated core/eval/serialize changes).

### P3 — PARSE perf (see [[less-parser-grammar-cost-roadmap]])

- [x] **Less L1 `!important` double-parse — LANDED `ca7358000`** (left-factored tail).
- [x] **Jess J1 `$var` multi-parse — LANDED `cc48f7af6`** (left-factored `$var` value atom to
      parse `VariableReference` once), with `49ac65706` / `df4436dc3` on the same seam.
- [ ] **SCSS S1/S2 — `NestedConditionalBlock` self-time.** No commit since has targeted it;
      the 15%-self figure is *unverified since 2026-07-22*. Re-measure before acting.
- [ ] **Cross-cutting allocation: monomorphic node shapes** (kill megamorphic keyed stores),
      remove `[...spread]` in hot reducers, single-value fast paths.
- [x] **First-set gating swept all four parsers** (2026-07-23 perf run, ~30 commits from
      `3aa12414d` to `44eb1237f`), and `5cc69d791` retired the local first-set regex copies
      once parseman `0.32.0` gated them natively. Workspace is on parseman `0.32.0`
      (`3b9e5a237`).

### Model correction — COMPLETE

- [x] SCSS nested-property → `Collection` (`b3976867e`).
- [x] `AnonymousMixin` added, value blocks content-classified, AST `DetachedRuleset` node
      DELETED (`b7f413d08`). LESSON: a CST grammar rule is not an AST node — keep the CST
      `DetachedRuleset` rule name; renaming it dangled `compose()` and a stale build masked it.
      Compose-integrity regression guards were added. See [[collection-vs-detached-ruleset-model]].

### Landed since this checklist was last reconciled (2026-07-22 → 2026-07-24)

Recorded so the next reader does not re-derive it from the log:

- **Pseudo-argument consolidation (2026-07-23).** Shared, `g`-free `cssAstPseudoSyntax`
  recognition artifact (`89917ce8f`), all four parsers migrated (`00778bac1`, `a6760c89e`,
  `d974aede3`), divergences unified (`e4b46ac45`), `of S` restricted to `:nth-child` per
  Selectors-4 §6.6.2 (`c6c0ea567`). Designs: `PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`,
  `PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md`. **Residual:** `jess-parser` still joins the
  nth-`of` tail through `staticSelectorText` (`grammar.ts:376`, used at `:1692` and `:1770`) —
  the last `*SelectorText` text-join site, and the remaining gap to
  [[parser-pseudo-args-always-structured]].
- **Structured pseudo-selectors, structure-only** (`c5f327ee7`, `dc6040d5e`, `5f95ac6d4`,
  `7e3cf042b`) with serialization relocated from grammar to core (`d0d77d22c`).
- **`;` is a declaration-list SEPARATOR, not a terminator** — `ef697892d` (jess),
  `ff7349969` (css/less/scss), `86d6143e2` (jess variable assignment is a declaration for this
  purpose), pinned by `20b01b0db`. Ruling: DESIGN-DECISIONS P11.
- **Stylesheet-defined functions in `.jess`** (`1ba17a77d`), documented by `741e6209c`;
  block auto-termination ruling: DESIGN-DECISIONS P12.
- **`.jess` `&` parent selector landed** (`9ac4d0bee`, design `cd7fc9c39` /
  `JESS-PARENT-SELECTOR-DESIGN.md`, rulings P9/P10).
- **`$( … )` stops emitting parens and a chained call stays in its frame** (`ad1bbd1bf`).
- **Root parentless `&` resolves to empty in the extend projection** (`e1d6396b4`).
- **MaybePromise/awaitable lane** extended to guards (`e79f0e434`), at-rule preludes
  (`72e6efd51`), mixin dispatch + mixin index (`19223650f`), nested selector header + shell
  probe (`a447bca1d`). `161fe9709` removed the blocking `@plugin` FIFO channel — a BEHAVIOUR
  CHANGE: `@plugin` values now travel the awaitable lane and a value reaching a position that
  cannot suspend fails loudly with `eval/async-in-sync-position`.
- **Sass+ support matrix published** (`3202ff246`,
  `packages/docs-content/docs/shared/04-guides/02-coming-from-sass/00-support-matrix.mdx`), and
  `c06dd4d7a` stopped advertising a `jess convert` command that does not exist.
- **Bootstrap Sass corpus ratchet + SCSS construct inventory** (`bde2e982e`);
  **conversion construct-support inventory + equivalence-harness design** (`c028a7c76`,
  `docs/design/JESS-EQUIVALENCE-HARNESS.md`).

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

`packages/jess/test/less/all-less.test.ts` has 32 registered expected-failure
cases, but only 21 are selected by the current alpha fixture glob and filters.
The public alpha lane runs 108 cases (measured 2026-07-24: `test:less:test-data` reports
108/108). Of these, 21 are active expected-failure checks and the rest are ordinary
byte-identical checks; the 107/86 split recorded on 2026-07-22 is superseded. The harness passes
when a named fixture still fails, so none is passing-parity proof. The owner
decision for the first alpha is to classify—not drain or hide—them. The
reproducible selection accounting, exact active cases, inactive registry
entries, symptoms, scope, and follow-up rule are in
[`../../state/less-v5-corpus-inventory.md`](../../state/less-v5-corpus-inventory.md); the
readiness tracker and release notes must link that inventory. In particular, a
missing mixin remains an error; only an ordinary function call with an optional
function reference may fall back to a CSS `Call` when lookup misses.

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
- CLI ownership is explicit: only the external `less` package provides the
  Less-compatible `lessc` command. The `jess` package provides only `jess` and
  must not claim Less CLI compatibility through a second bin or alias.
- Node support is a rolling policy, not a permanently pinned release number:
  support the current LTS line and the prior three LTS lines. `engines.node:
  >=18` is the current derived floor; it advances only when that four-line
  window advances. The Jess CLI workflow exercises `current`, `lts/*`, and
  `lts/-1` through `lts/-3`.
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

### Current Less v5 alpha readiness evidence (2026-07-22)

- The committed Less `alpha` branch is exactly `5.0.0-alpha.1`; its guarded
  release dry-run and release-guard unit tests pass. This proves the release
  shape only, not package readiness.
- The external Less `alpha` tip is `48c7f5bb`, four committed but unpushed
  changes ahead of `origin/alpha`: source-order collapsed-output fixtures
  (`fbea7e3e`), the explicit `collapseNesting` / `lessc --collapse-nesting`
  public route and its tests (`6ebb0784`), the packed-consumer verifier
  (`0f78066e`), and the prepared `5.0.0-alpha.1` release notes and known
  limitations (`48c7f5bb`). At that tip, `npm run test:lessc` and
  `npm run verify:alpha:packed-consumer` pass. The latter packs a temporary
  Less tarball with the 18-package local Jess alpha closure, rejects a Jess
  `lessc` bin, and proves clean-install `lessc` file, stdin, import, and error
  behavior. This is real built-artifact evidence; it does not publish.
- The external Less worktree is now clean, but a guarded real release still
  cannot start: local `alpha` is four commits ahead of `origin/alpha`, while
  the release guard requires an exact remote match; `jess@2.0.0-alpha.9` is not
  yet available from npm; and explicit owner authorization is still required.
  The external `alpha` tip is currently zero commits behind `origin/master`.
  After the local commits are pushed and Jess is registry-available, run the
  registry-backed consumer proof in addition to the local-tarball proof; then
  Less's own `prepublishOnly` runs typecheck, distribution build, and the built
  `lessc` alpha test. Do not substitute a historical raw test-runner count for
  those release gates.
- Neither `jess@2.0.0-alpha.9` nor `less@5.0.0-alpha.1` is on npm. Do not
  publish Less until Jess alpha.9 is published, Less has been rebuilt/relinked
  against that exact package, and a publish-shaped clean-consumer install has
  passed. Local Less manifests deliberately retain `link:` specs; the guarded
  publish path rewrites them only for the publish window.

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
`List` share the canonical payload shape: `value` plus an explicit separator
fact (`',' | '/'`). They never expose the former
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

For the refresh, first fetch `origin/dev`, create a recovery ref such as
`git branch alpha-pre-alpha9-cut alpha`, and work in an isolated `alpha`
worktree. Import the exact pushed source tree with a two-tree patch
(`git diff --binary alpha-pre-alpha9-cut..origin/dev` and `git apply --index`), then run
`node scripts/release/restore-alpha-package-versions.mjs --from alpha-pre-alpha9-cut --stage`
followed by `node scripts/release/record-alpha-source-provenance.mjs --stage`.
The required `--stage` makes that tool restore and stage only each
`packages/*/package.json` `.version` field from the
recovery ref; it must not restore whole manifest files. The alpha snapshot takes
all current `dev` manifest fields (including runtime/peer/dev dependencies,
exports, and publish configuration) and retains only recovery alpha versions
until the registry-aware release step selects the next version. `pnpm-lock.yaml`
is unchanged. Keep `dev`'s root quality gates (`verify:types` and bounded
production lint) and its newer HANDOFF/readiness/release evidence; reconcile
the alpha release note from final gate evidence instead of restoring the older
alpha docs wholesale.

### Less-alpha gate status (re-measured 2026-07-24 on `13725f894`)

Measured in a clean worktree after `pnpm install` + `pnpm run build:release`. These are the
numbers, not a narrative:

- `pnpm run test:less:test-data` — **108/108 pass** (`all-less.test.ts`, the only
  fixture-backed Less integration authority).
- `pnpm run verify:types` — **RED, 1 diagnostic**, `@jesscss/less-parser`:
  `packages/less-parser/src/ast/grammar.ts(1916,7): error TS2339: Property
  'CssAstSyntaxUnicodeRange' does not exist`. Introduced with `c1782031e`. The other 21
  configs pass. This blocks `release:alpha:preflight`, which runs `verify:types`.
- `pnpm --filter jess test --run` — **15 failed / 739 passed / 4 skipped / 79 todo** across
  4 red files. Per-file breakdown and disposition: `docs/state/PROJECT_STATE.md`.

The public Less route reaches canonical AST-v2 evaluation and serialization for direct and
imported documents: the Less plugin calls the public direct parser, Context carries its
`Stylesheet`, parser/source identity, typed builtin evaluator, and resolved dialect options,
and Jess serializes that document without a tree bridge or copied execution-option bag. The
Less test harness loads the macro-compiled public parser artifact, not Parseman grammar
source, and the Less-alpha command builds that parser/plugin pair before running integration
tests.

The corpus's marked expected-failure cases remain known Less-parity limitations, not
release-gate failures; the harness passes when a named fixture still fails, so none of them is
passing-parity proof.

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

### Reachability audit (2026-07-21; spot re-verified 2026-07-24)

Re-checked on this pass: `packages/core/src/visitor/` does not exist; a workspace grep for
`BuilderHost`/`ParseHost` in `packages/*/src` returns nothing; and
`node scripts/verify-parser-runtime-boundary.mjs --require-clean` reports
`0 tracked temporary sites (0 exact ledger sites)`. The remaining claims below are as of
2026-07-21 and were *not* re-verified.


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
  `Collection` node, not a CST-shaped map or opaque source fallback (verified 2026-07-24:
  `jess-parser/src/ast/grammar.ts:66` `DirectJessCollection: Combinator<Collection>`). This
  sentence previously named the AST `DetachedRuleset` node, which `b7f413d08` DELETED in
  favour of the `Collection` / `AnonymousMixin` split — see
  [[collection-vs-detached-ruleset-model]]. Block-bodied lambdas reduce to `AnonymousMixin`
  (`grammar.ts:981`). Dynamic
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
  See [`DIALECT-TO-JESS-COMPILED-CONVERSION.md`](../../design/DIALECT-TO-JESS-COMPILED-CONVERSION.md).
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

## Aggressive-cutting gate policy and standing design rules

> The ~3,300 lines of per-pass self-prosecution records that used to follow were deleted on
> 2026-07-24. Each was a per-commit evidence block already preserved in `git log`, and every
> one described work that has landed. Only the durable rules below, plus the single CURRENT
> pass block at the end of this section, survive.
>
> **How to use this section:** `scripts/verify-aggressive-cutting-review.mjs` reads the LAST
> `## Aggressive Cutting Self-Prosecution` heading in this file and requires the eleven
> labelled fields in its most recent `- Latest pass:` entry. REPLACE that block with your
> pass; do not append a new one and leave the old one behind. Historical passes belong in the
> commit message, not here.

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

### Rejected nested Less `@media` conjunction assumption (2026-07-21)

Commit `81e2f7ffc` assumed nested singleton `@media` groups should be emitted
as sibling groups with conjoined qualifiers. The upstream Less corpus disproved
that assumption: `at-rules-bubbling`, `at-rules-targeted`, and
`extend-chaining` require the existing nested output. The implementation and
its focused expectations were reverted. Do not reintroduce renderer-side media
conjunction without a corpus-backed semantic specification that covers those
cases.

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
only explicit comma/slash `List` boundaries; raw recursive arrays carry
ordinary space adjacency, and no semicolon or undecided separator fact exists.

**Value-list index invariant:** core JS access is zero-based and does no numeric
normalization. Less `extract` and Sass `list.nth`/`set-nth` each implement their
own one-based conversion, truncation/flooring, non-finite, negative, and bounds
rules inside the universal callable contract. A shared core accessor must not
silently choose one language’s policy.

## Collapsed nesting source-order invariant

When nesting collapses, the renderer emits nested rules in authored source
order. A parent declaration after a nested rule belongs after that collapsed
child, in a later parent block. Regrouping it ahead of the child to coalesce the
parent selector is a semantic bug because it changes CSS cascade order.

| Case | Authored order | Prior Jess / historical Less 4 output | Intended authoritative output | Reason |
| --- | --- | --- | --- | --- |
| `property-accessors` `.block_2` | `color: red; .two { … }; color: blue;` | One `.block_2` block with `red` and `blue`, then `.block_2 .two`. | `.block_2(red)`, then `.block_2 .two`, then `.block_2(blue)`. | The later `color` must not cross the child selector; the corrected Less-alpha golden is the source-order oracle. |
| `mixins-important` `.class` | Each `.mixin(n)` expands `border/boxer; .inner { test }; border-width`. | All parent `.class` declarations grouped first, followed by all `.class .inner` rules. | Alternating parent-leading block, `.class .inner`, parent-trailing block for every expansion. | Mixin expansion is authored body order; regrouping across `.inner` changes cascade order. Less 4 is comparison evidence only. |

The direct core regression is `rule-placement-direct-acceptance.test.ts`:
`before; .child { inside }; after;` must emit parent-before, child, parent-after.
The linked Less test-data fixtures are the public regression surface. No
collapsed-nesting output may select a smaller selector grouping over this
invariant.

### Imported callable namespace continuation

An executed import records its direct `MixinDef` and `Rule` facts in a new,
source-ordered render-frame callable stream. Namespaced path descent consumes
that stream, while ordinary bare-call lookup continues to use the frame's
existing mixin index. This lets an imported namespace contribution and a later
local namespace contribution both participate in a typed call-result accessor
such as `#theme.dark.navbar.colors()` followed by `@theme-colors[secondary]`;
the selected member retains the call-level `!important` fact. No import
resolver, parser replay, source reconstruction, or compatibility path is
involved.

## Aggressive Cutting Self-Prosecution

- Latest pass: documentation reconciliation and relocation (2026-07-24). HANDOFF/PROJECT_STATE
  were re-derived from the tree, and the former `docs/future` tree was split into `docs/architecture/`,
  `docs/design/`, `docs/process/`, and `docs/state/`.
- Architecture surface: unchanged. No compiler, parser, evaluator, or serializer surface was
  touched.
- Separation/duplication: reduced. ~3,300 lines of per-commit evidence records duplicated in
  `git log` were deleted, and the four owner decisions of 2026-07-24 were recorded once each in
  the canonical ledger (`DESIGN-DECISIONS.md` P11/P12/C11/C12/C13) rather than restated here.
- Cumulative node weight: unchanged; no AST node, field, or shape was added or removed.
- New traversal: none.
- New node/materialization: none.
- Render path: untouched.
- Helper/API surface: none added. The only non-documentation edits are documentation-path
  strings in comments, plus `isReleaseArtifactPath` gaining `docs/state/` so the relocated
  `PROJECT_STATE.md` keeps the release clean-tree exemption it had under `.cursor/`.
- Metadata mutations: none.
- Review-flagged diff tokens: none; the diff contains no runtime code.
- Evidence: `pnpm run test:less:test-data` 108/108, `pnpm run verify:types` 1 pre-existing
  diagnostic, `pnpm --filter jess test --run` 15 pre-existing failures — all recorded with
  their measurement date in `docs/state/PROJECT_STATE.md`. A repo-wide grep proves zero
  references to the pre-move documentation paths. No performance claim is made or implied.
- Verdict: documentation-only reconciliation; accepted with no runtime cost contract.
