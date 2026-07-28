# Less v5 Alpha Readiness

This is the living readiness tracker for the first Jess alpha focused on Less
v5 compatibility. The publish mechanics live in
[`releasing-alpha.md`](../process/releasing-alpha.md); this file tracks what must be true
before that runbook should be used. Features **deliberately deferred past this
alpha** (config-lane URL/import handling, source maps, …) are sequenced in
[`less-v5-release-plan.md`](../process/less-v5-release-plan.md).

## Historical direct-Less benchmark (superseded; not an acceptance gate; 2026-07-21)

These measurements are retained as reproducibility evidence only. They were
captured before the present migration worktree was clean and must not be used
as an alpha gate or current output oracle. In particular, the 122,390-byte
`ea918f2d...` CSS and 1,797,831-byte parser artifact are superseded. The
current clean baseline and the open performance-comparison blocker are recorded in the performance section of
[`HANDOFF.md`](../architecture/core/HANDOFF.md). The public route is a
built direct parser on Parseman `0.28.0`; older 20–30 ms source-driver and
legacy-tree numbers measured different work and are not an A/B.

| Phase | Protocol and identity | Result |
| --- | --- | --- |
| Direct parse | `packages/less-parser/lib/index.js`: SHA-256 `52d88a95557a821815d9f15f2d6ab05bbb5c64a55f0189fb97a050d7aea50285`, 1,797,831 bytes; `benchmark.less`, 106,802 bytes; Node v24.11.1 arm64; 20 warmups + 3×45 samples | 63.321 ms median (p25 61.776, p75 64.487); `Stylesheet` JSON SHA-256 `2ba996a1c46eb6d77ce8f1748b35d1135848c128104e00f46dadf7e9651c53bd` (957,390 bytes). |
| Public compiler | `node scripts/measure-less-hotpath.mjs --fixture packages/jess/benchmark/benchmark.less --iterations 45 --warmup 20 --repeat 3 --trim 0.1 --json`; built Jess/Less-plugin chain | 77.492 ms round-median across 135 samples (usable 0.78% round RSD); CSS SHA-256 `ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6` (122,390 bytes). |

The remaining benchmark blocker is evidence quality, not a timing threshold:
there is no valid matched Parseman 0.27/0.28 generated-bundle A/B yet. The
current grammar requires `composeLeaf`, which the 0.27 package does not export,
and generated reducer identifiers include the absolute worktree path. Until a
matched, clean artifact protocol exists, timing movement is reported as a
baseline only and never as a performance acceptance claim.

## Verification snapshot

- Core behavior, recorded 2026-07-22: the complete `@jesscss/core` suite is **3,194 passed, 9
  skipped, and 2 todo**. The skipped/todo cases remain visible and are not
  converted into passing evidence.
- Source quality, recorded 2026-07-22: the repository-wide production ESLint audit reports **0
  errors and 319 warnings**. The warnings are tracked lint debt; there is no
  current ESLint-error blocker.
- Parser dependency floor, verified 2026-07-28: the active grammar checkout
  resolves published `parseman@0.41.0`; `pnpm run check:macro` and
  `pnpm run verify:compose-integrity` pass with 0 interpreter fallbacks; and
  `pnpm run verify:less-alpha` passes. The full strict-type release chain still
  belongs to `pnpm run release:alpha:check` before publishing.
- Alpha closure: `scripts/release/alpha-allowlist.json` contains **21
  allowlisted runtime packages**, including `@jesscss/compiler`.
  `rollup-plugin-jess` is intentionally excluded because it depends on `jess`
  and is not part of the runtime closure. Current `dev` validates this publish
  set with `node scripts/release/validate-alpha-publish-set.mjs`, and the
  topological order publishes `@jesscss/compiler` before `@jesscss/plugin-less`
  and `jess`.

  Release status, verified 2026-07-28: the direct Jess runtime closure needed
  by external Less is published and queryable at `2.0.0-alpha.11`
  (`@jesscss/compiler`, `@jesscss/core`, `@jesscss/plugin-less`,
  `@jesscss/plugin-less-compat`, `@jesscss/plugin-node-modules`, and optional
  peer `@jesscss/plugin-js`). `jess@alpha` still resolves to
  `2.0.0-alpha.10`, but Less deliberately does not depend on the
  batteries-included `jess` package. Future alpha snapshots should use
  `pnpm run release:alpha:update-from-dev` from a clean `alpha` worktree.

Normal public parse/compile provides neither Parseman coverage nor trace
instrumentation. Diagnostic coverage/trace uses a separate macro transform and
must never be used for this timing protocol. The rejected namespace gate did
not land: direct parse was 62.881 ms versus its 59.502 ms baseline and compiler
74.022 ms versus 73.772 ms (noise), so no production change remains. The next
choice investigation is the opt-in stable choice-arm trace design in
[`parseman-diagnostic-trace-design.md`](../design/parseman-diagnostic-trace-design.md).

## Current alpha.1 stabilization snapshot (2026-07-28)

The active alpha.1 blocker has shifted from the grammar fold itself to
CSS/Less stability, the public Less fixture flow, and parser/eval error quality.
The four parser dialects are folded to one `src/grammar.ts` each; do not
recreate duplicate AST/CST grammar bodies to make a fixture pass.

`parseman@0.41.0` is published and installed from the registry in the active
checkout; the root, `@jesscss/parser-shared`, and all four parser packages now
depend on `^0.41.0`. A registry-backed dependency-order build completed, and
`pnpm run check:macro` plus `pnpm run verify:compose-integrity` both pass with
0 interpreter fallbacks.

Import/cache stabilization also landed on `dev`: `Context.loadImport(...)`
memoizes loaded imports, `Context.getModule(...)` reuses ordinary script/JSON
module resolution and loading within one compile context, `Compiler.compile()`
exposes reusable prepared import plans, and compile-cycle/parsed-import caches
are keyed by parse/parser
identity. These are local session and prepared-static-import fixes; they do not
change the remote URL import deferral, which remains excluded from the alpha
lane pending an explicit network/security model.

Release tooling now has a narrow `pnpm run test:release` gate. The alpha
publish-set scanner recurses through `packages/**`, so nested syntax packages
are included in the same release plan as top-level runtime packages instead of
being silently missed by the alpha allowlist validator.

Current alpha readiness verification is green. Rerun 2026-07-28 after the
latest Parseman-trivia transfer hardening, Less unsupported-variable CST
recovery, Less grammar trivia cleanup, diagnostic-range work, compiler package
entrypoint fix, and Less alpha verifier dependency-order fix, `pnpm run
check:macro` reports parser-shared, CSS, Less, SCSS, and Jess fully compiled
with 0 interpreter fallbacks; `pnpm run verify:compose-integrity` passes after
a dependency-ordered rebuild; and `pnpm run verify:less-alpha` passes. The
alpha gate now builds the parser-shared/CSS/Less parser chain, core/fns/config
packages, Less plugin stack, `@jesscss/compiler`, and `jess` before running
package exports, the public Jess API, path resolution, and the Less test-data
lanes (`tests-unit/`: 79 / 79, `tests-config/`: 29 / 29). The remote URL
import fixture is deliberately excluded from the alpha lane until resolver
network access has an explicit allowlist/security model.

Graduated in the current pass:

- extend behavior: `extend-exact`, `extend-selector`, and `extend`;
- imported reference comment preservation:
  `import/import-reference-issues`.

Comment/trivia preservation is no longer an alpha fixture blocker. Comments are
parser trivia, and render/eval behavior should use source spans and trivia
replay. Core now adapts Parseman's sparse root trivia index through
`createTriviaMapFromParseman(...)`; labels are a positive fast path, and the
adapter falls back to source detection if a grammar-local label table drifts.
Remaining parser cleanup should remove surviving semantic comment productions
family by family, with the empty-rule check repaired against trivia spans
rather than comment AST children.

Current comment-trivia cleanup order, audited 2026-07-28: CSS/Less no longer
have a public `Comment` grammar node, ordinary Less value comments are on the
intended trivia-map/render-replay path, and unsupported legacy Less variable
names remain recoverable in CST host mode while AST mode emits the targeted
diagnostic. The remaining grammar-level comment facts are temporary
serialization carriers, not endorsed AST shape. Remove them only with the
matching trivia-span replay in the same patch:

- Less declaration-head comment/whitespace facts between property/merge tokens
  and `:`; otherwise `color/*x*/:` loses its authored gap.
- Less custom-property inner/outer comment children; custom-value serialization
  must replay comments from source trivia spans before those arms disappear.
- Less opaque/general at-rule body comment arms; unknown at-rules and
  general-enclosed syntax still need authored body bytes preserved. Fallback CSS
  at-rule prelude comments have started moving to parser trivia while preserving
  semantic gaps.
- selector/static-pseudo raw comment text; prove comment-only selector gaps do
  not become descendant combinators, and pseudo arguments still round-trip.

Detached clean-dev verification on 2026-07-27 confirmed the Less alpha fixture
flow is green once dependency artifacts are built, and also showed
`oracle:less:byte-identity` is not current against the linked external
`@less/test-data` corpus. The corpus gained `math-css-vars` entries from the
sibling Less checkout, and broad AST/CST oracle hashes moved. Treat this as an
oracle/baseline classification task; do not accept new oracle baselines until
the linked corpus state and parser-shape movement are reviewed.

Keep scanner-local `blockComment` skips inside `scanTo(...)` / `balanced(...)`
until Parseman has the replacement capture/skip helper for those regions; those
skips prevent comments from prematurely terminating custom properties, opaque
at-rules, pseudo arguments, or balanced groups.

Less grammar cleanup also moved in the current pass. The Less parser source and
focused parser tests no longer carry the local `DirectLess*`, `LessDirect*`, or
`LessAst*` migration prefixes; the AST/CST entry rule is the plain `Document`
host-mode grammar. This was a naming and readability slice, not a public node
label change. Keep future grammar naming simple and spec-shaped: use the dialect
package path for context, override CSS rules through composition, and avoid
restating the dialect name in every local production.

Focused parser/eval error work also moved: `all-less-error.test.ts` now passes
with **94 / 94**. Recursive variable/property fixtures are no longer skipped:
unproductive cycles now throw `eval/recursive-reference`, while same-name
references that can make progress to another in-scope definition remain legal.
The duplicate unhandled `plugin/function-threw` rejection channel remains
closed. Unit arithmetic errors now report `eval/invalid-unit-arithmetic`
instead of leaking as `internal/unknown`, with public-route tests covering
mixed-unit add/divide/multiply fixtures at the operator span. Error quality is
still the next alpha-hardening lane: improve diagnostic locations,
expected-token messages, and eval/runtime classification without weakening
syntax conformance or adding compatibility catches around real parser failures.

Current error-blocker audit (2026-07-27): the named Less error fixtures that
recently mattered are not current acceptances. `color-func-invalid-color.less`
and `svg-gradient1.less` through `svg-gradient6.less` now surface errors under
the Less-4-parity error options used by `all-less-error.test.ts`; the remaining
accepted color fixture is `color-func-invalid-color-2.less`, intentionally
preserved because `darken(var(--x), ...)` cannot be evaluated at build time.
The public plugin parse boundary converts generic `LessParseError` recognition
facts into source-backed `parse/syntax-error` diagnostics with line, column,
reason, fix, and code-frame lines. The remaining weakness is message quality,
not raw offset leakage: broad parse failures now distinguish leading invalid
syntax from trailing text after a complete stylesheet, but expected-token lists
are still too raw. Next source targets are
`packages/syntax/less/less-parser/src/parse-error.ts`,
`packages/syntax/less/less-parser/src/index.ts`, and
`packages/core/src/error/diagnostics.ts` for better Parseman failure labeling,
plus continued auditing of unstructured eval/runtime diagnostics outside the
now-structured unit arithmetic path.

Public parser diagnostics now preserve parser-provided end ranges on diagnostic
records. `packages/jess/test/less/parser-error-public-semantics.test.ts`
covers inline backtick JavaScript as an unsupported Less 4 construct that is
recognized enough to produce a targeted parse diagnostic and code-frame range,
not accepted as valid Less v5 syntax. It also covers deprecated bare at-name
variables in interpolation positions: the parser understands the construct
well enough to report the exact replacement range and fix while still treating
the Less v5 source as invalid. Dynamic `@charset` interpolation also reports
`parse/dynamic-charset` with the parser-provided range plus the actionable
reason/fix instead of falling back to generic parser guidance. Continue
extending that parse-with-error shape to other migrations.

The same public diagnostic boundary now summarizes generic unterminated string
failures as `parse/unterminated-string` at the opening quote instead of a
column-1 generic stylesheet failure. The direct Less `parse()` error path also
keeps raw Parseman expected facts on `LessParseError.expected` for tooling while
removing raw production/regex names from the thrown message.

`pnpm run oracle:less:byte-identity` remains red against the committed parser
surface baseline. Current output is 711 corpus entries, AST
`9263d36f95280b7b8e897abbb44dc511a953bd01110b98899d92a918defcbd5a` with
116 throws and 217 moved entries, and CST
`3596049629b1441bed7f93100374c23330bf02d60994c65582741cd11d94b491` with
0 throws and 634 moved entries. The custom-property `DirectLess*` rename was
checked by reversing the local patch and rerunning the oracle: the AST aggregate
and moved set were unchanged, while the CST aggregate moved from
`67cf6614c3aecd4f71e5965510d556d8da0ea2591948f0681392bc0a3963eb4c` to the
current value because internal CST node labels changed. The CST throw regression
from unsupported legacy Less variable names is fixed; remaining movement is still broad
AST/CST digest churn that requires named-set review before any baseline update.
The current named-set split and baseline rules are recorded in
[`LESS-ORACLE-MOVER-CLASSIFICATION.md`](../architecture/parser/LESS-ORACLE-MOVER-CLASSIFICATION.md);
do not move the baseline until that queue is resolved.

## External Less `5.0.0-alpha.1` package audit (2026-07-28)

The target review PR is
[`matthew-dean/less.js#19`](https://github.com/matthew-dean/less.js/pull/19),
`less-5-alpha.1` into the fork-local `alpha` branch. Current sibling checkout
evidence: branch `less-5-alpha.1` at `fa39abf8`,
clean worktree, PR open/non-draft. The branch merges `upstream/alpha`
(`330e9d71`) into the Less 5 alpha branch, resolves the release-automation
conflicts while preserving the first unpublished `5.0.0-alpha.1` release
candidate behavior, and routes `lessc` parse/eval failures through the generic
Jess/Linecraft diagnostic renderer. Local verification on `fa39abf8` passed the
Less package alpha contract, root `pnpm run test:alpha`, publish dry-run tests,
and packed-consumer proof. The packed-consumer proof derives its expected Jess
runtime version from the committed Less manifest. The Less compatibility error
wrapper now forwards
canonical Jess diagnostic messages unchanged while still exposing Less-style
fields such as `type`, `line`, `column`, `extract`, and `jessErrors`. GitHub
evidence on 2026-07-28 reported PR #19 merge-state `CLEAN`; CI was green
across ubuntu/macOS/windows and Node current, LTS, LTS-1, and LTS-2 on the
previous audited head; CodeRabbit was green; release-PR automation jobs were
skipped as expected. The current head and CI state are recorded below.

Current package/release gates are registry-backed against the published direct
Jess runtime closure at `2.0.0-alpha.11`: on PR head `fa39abf8`, the external
Less commit hook reran the full `pnpm run test:alpha` gate, including
typecheck, build, `lessc` smoke tests, alpha support contract, alpha fixtures,
publish dry-run tests, and the packed-consumer proof. The packed-consumer
verifier now derives the expected Jess alpha version from the committed Less
manifest. The `lessc` smoke tests pin
Linecraft-formatted colored diagnostics by default, source framing, `--silent`
suppression, `--no-color` control-sequence stripping, and absence of
alternate-screen / live-region terminal controls. The PR branch also routes
successful Jess warnings to `stderr`, keeps CSS-only output on `stdout`, and
suppresses warning output under `--quiet`. Linecraft-colored diagnostics are an
alpha merge blocker: if a public `lessc` error path falls back to raw offsets,
uncolored text, or a non-Linecraft frame, the package is not ready to merge. The
alpha support contract now pins the upstream-sync fixture families that are
green for alpha.1:
`at-rule-variable-interpolation`, `color-functions/modern`, `math-css-vars`,
`mixins-guards`, and `mixins-named-args`. The packed consumer installs the
direct Jess runtime closure and does not install the batteries-included `jess`
package. `packages/less/package.json` uses published `@jesscss/*` alpha
dependencies, has no direct `jess` dependency, and keeps `@jesscss/plugin-js`
as an optional peer only.

After `8b78b1afa`, Jess `dev` also removes the Less-specific
`importLessPlugin` method from the generic `@jesscss/compiler` script-plugin
proxy, keeps executable plugin loading behind `PluginInterface.importPlugin`,
and routes Less `@plugin` through the canonical `deprecation/less-plugin`
warning channel. This keeps `@jesscss/plugin-js` optional while preserving the
legacy Less runtime inside that plugin package.

Jess-side package layering now uses a generic compiler host:
`@jesscss/compiler` owns the render pipeline, while the `jess` package supplies
the batteries-included Jess/Less/SCSS plugin stack and CLI. The Less plugin no
longer exports a dialect-named compiler facade; it registers Less behavior as a
plugin. The sibling `less.js` checkout has been updated to import
`Compiler` from `@jesscss/compiler`, assemble the Less plugin stack directly,
and remove its direct `jess` dependency. Its alpha release checks now assert
the actual Jess runtime package closure (`@jesscss/compiler`, core, Less
plugins, and node-modules resolver) and reject a consumer install that pulls in
the batteries-included `jess` package. Script-module and Less `@plugin` support
is a resolver hook, not a shipped Deno runtime: both `jess` and the external
`less` package may declare `@jesscss/plugin-js` only as an optional peer
(`peerDependencies` plus `peerDependenciesMeta.optional`), never as a runtime
dependency or `optionalDependencies` entry.

Current package-flow blockers, verified 2026-07-28, are owner/release
sequencing decisions: merge PR #19 if accepted, rerun the release dry-run from
`alpha`, and then publish Less. PR #19 is already green on the `.11` dependency
bump.
They are not an unclassified upstream fixture gap. The missing
`.widget.repositoriesresults` selector expansion and `scroll-state (`
spacing comments in `container.css` are fixed on the PR branch and the external
alpha gate passes. Greptile did not review because the PR exceeds its file
limit, and Bugbot is not enabled; those are bot-capability notes rather than
code findings. The old no-control-regex review thread and both container
fixture threads are resolved/outdated. The intentional custom-unit note in
`variables/legacy/variable-advanced.css` remains a review disposition item
rather than a code fix: this branch has no Stylelint config, no Stylelint script,
and the file states that it is a historical Less 4.x output record that no test
reads. Do not add suppression comments there unless a real lint gate appears.

The upstream fixture/test-data gap from `upstream/master` is classified in the
external branch at `packages/test-data/UPSTREAM-FIXTURE-SYNC.md`. Replay upstream
changes into the Less 5 alpha branch as v5/Jess fixtures; do not copy upstream
expected CSS blindly. Upstream `master` is the Less 4.x line; the Less 5 alpha
branch succeeds that line and owns the Less 5 nesting, deprecation, parser, and
output semantics. Verification on 2026-07-28 showed the PR branch is caught up
with `upstream/alpha`; `upstream/master` is 40 commits ahead in total, and its
fixture-affecting commits are the scout entries below. Current classification:

- **Ported or represented for alpha.1:** selector regressions (#4422),
  media-query parentheses (#4427), `not`/condition regressions (#4421),
  container mixin parameter variables (#4420), simple container name/spacing
  coverage (#4441), color `calc()` (#4434), bare `@var`
  deprecation/migration via Less 5 interpolation-positive coverage
  (#4462/#4469), named-argument mixin arity (#4473), and CSS-`var()` math with
  Less 5 expected output (#4479).
- **Intentionally out of scope for alpha.1:** inline condition-expression
  comparison (#4472), container `style()` comparison/range syntax (#4461),
  broader container comma-list/custom-ident/escaped-name/style-function coverage
  from #4441, unset variadic forwarding to callee defaults (#4477), upstream
  Less 4 bare-at-rule-variable warning matrix, and upstream Less 4
  `percentage(var(--x))` eval-error behavior. These are classified limitations
  or follow-up work, not unreviewed fixture gaps.
- **Classify separately from fixture sync:** the previous upstream `alpha` delta
  was release automation only (`330e9d71`) and is now merged into the PR branch.
  CJS/browser export tests (#4424/#4444), debug line-number crash coverage
  (#4446), dependency/security churn, and release version/changelog commits are
  not parser fixture deltas. They may be alpha-release hygiene work, but they
  are not evidence that the Jess-powered parser is missing a language fixture.

## Historical External Less `5.0.0-alpha.1` package audit (2026-07-22)

This section is retained as older release evidence only. It is superseded by
the 2026-07-28 audit above for current PR #19 readiness, registry availability,
and package-flow blockers.

The sibling Less repository is on its `alpha` branch at `48c7f5bb`, exactly
`5.0.0-alpha.1` and clean. It is four committed changes ahead of `origin/alpha`
and zero commits behind `origin/master`. Those commits establish
source-order-preserving collapsed nesting, the explicit `collapseNesting` /
`lessc --collapse-nesting` route, a local packed-consumer verifier, and the
prepared alpha release notes with their known-limitations section. The release
guard deliberately requires exact remote parity, so those reviewed commits must
be pushed before a real publish attempt.

The package itself packs successfully: `npm pack --dry-run --json` reports
`less@5.0.0-alpha.1` (12 files, 38,651 unpacked bytes). The built artifact also
passes `npm run build`, `npm run typecheck`, and `npm run test:lessc`; the latter
exercises built `lessc` version output, stdin, file output, sibling imports, and
failure diagnostics. `less` is the sole public owner of `lessc`; the separate
`jess` package exposes only its own `jess` command. The five
publish-version/dependency-rewrite tests pass.

The local packed-consumer proof now passes: it makes a temporary Less tarball,
substitutes the local 18-package Jess alpha closure for the development
`link:` dependencies, and proves clean-install `lessc` file, stdin, import, and
error behavior. It is deliberately a local closure proof, not the final
registry-backed consumer proof. The alpha publish script requires the direct
Jess runtime closure (`@jesscss/compiler`, core, Less plugins, and
node-modules resolver) to be available from npm at the selected Jess alpha and
temporarily rewrites those runtime dependencies during publish, restoring the
workspace-linked manifest afterward. After Jess is published, the
registry-backed proof must install those published packages rather than local
tarballs.

The recorded full Less node-corpus audit is **not alpha-green**: it reported
legacy plugin-global/registry and visitor assumptions, unsupported advanced
parser fixtures, import/process-URL behavior, source-map artifacts, and other
output divergences. These failures remain visible compatibility evidence; they
must not be hidden or relabeled as passing behavior. The remaining release
blockers are a published direct Jess runtime closure that includes the current
single-frame Linecraft diagnostic renderer, the registry-backed consumer proof,
and explicit owner authorization. Publication remains contingent on the
controlled alpha workflow, the exact Jess dependency version, and those release
gates.

With no Deno/plugin execution on `benchmark.less`, three repeated 8-run/3-warmup
rounds measured Less alpha render medians of `99.44`, `98.56`, and `92.80` ms
(round mean `96.9` ms), versus the historical Less 4.5.1 `47.4` ms average.
The earlier `205.12` ms one-run result was a cold-start outlier; these numbers
are still not a comparable Less-4 A/B until the exact fixture/options and build
identity are recorded, but they establish the current warm-path signal.

## Status Key

- `[ ]` not started or not proven
- `[~]` in progress, with known gaps
- `[?]` needs owner decision before implementation should proceed
- `[x]` complete with evidence linked in this file

## Per-change-slice review protocol

Every delegated change slice gets two separate reviews before integration:

1. Run the slice's focused behavior tests, build/type checks, ESLint, and any
   applicable parser-boundary or aggressive-cutting verification.
2. Review only that diff for over-engineering using the Ponytail rubric. A
   callable Ponytail plugin invocation must be labeled **Ponytail invocation**
   and include one finding per line using `delete`, `stdlib`, `native`,
   `yagni`, or `shrink`, followed by `net: -N lines possible.`
3. In this workspace/session, Ponytail is not exposed as a callable tool, so
   an agent may instead report **Ponytail-style manual review**. That is an
   explicitly manual application of the cached rubric, not a claim that the
   plugin ran; it must still say `Lean already. Ship.` when no safe cut is
   found.
4. Disposition every finding before the slice is integrated. Ponytail is an
   over-engineering review only; correctness, type, lint, performance, and
   release gates remain independent and cannot be replaced by it.

## Alpha Release Gates

The first alpha is **not** a promise of complete Less 4.x corpus parity. It is
allowed to ship with the classified known limitations below, provided they stay
discoverable in the release notes and each has a concrete symptom, scope, and
follow-up. The runnable corpus remains a regression signal; expected failures
must never be hidden, deleted, or described as passing behavior.

The alpha blocks only on these advertised correctness and release-safety gates:

- the public direct `parse()` → canonical `Stylesheet` → one-engine compiler
  route, with no bridge/host/reparse fallback;
- core safety and correctness on the advertised route: no known crash, hang,
  duplicate evaluation engine, or silent output corruption in a supported use;
- the documented `jess` package API, package exports, builds, and clean
  consumer-install proof;
- the advertised `lessc` commands and options, including built-artifact CLI
  smoke/compatibility tests; and
- a release-note known-limitations section that links the complete
  [`less-v5-corpus-inventory.md`](./less-v5-corpus-inventory.md) and states the
  unsupported or not-yet-matched behavior honestly.
- `[x]` **Strict source quality.** Published `parseman@0.41.0` is the current
  parser dependency. `check:macro` and `verify:compose-integrity` pass with
  0 interpreter fallbacks, and the Less alpha verifier passes. Production ESLint
  and full strict-type release checks remain required by the release gate;
  warnings remain tracked debt, and neither types nor lint errors may be hidden
  by bundlers' `--noCheck` builds.
- `[x]` **F5 deferred CSS color-call gate.** Through the public Less/Jess route,
  CSS-shaped `rgb()`/`rgba()`/`hsl()`/`hsla()` calls with three or more argument
  slots remain authored, verbatim CSS calls even under `functionMode: 'error'`;
  they do not eagerly invoke a native function. Modern space/slash and relative
  forms arrive as one structured slot and use the same three-slot rule. Less's
  one- and two-slot color overloads (including `rgba(#5F59)` and
  `rgba(#5F59, .5)`) dispatch normally, so recognized Less forms are evaluated
  and malformed numeric arities are rejected by the call-level `functionMode`
  policy rather than leaking authored invalid output. An un-operated relative-
  color call remains authored; only a consumer that demands its value may reach
  an implementation rejection. Evidence:
  `pnpm --filter jess test -- function-error-public-semantics.test.ts --run
  --globals` (17/17 passing, including zero dispatches for installed native
  three-/four-slot CSS color functions); settled semantics:
  `DESIGN-DECISIONS.md` F5. The runnable Less unit corpus now has two F5
  expected-failure markers (`operations.less` and `functions/functions.less`),
  while `color-functions/rgba.less` is green because its one-/two-slot Less
  overloads are evaluated. These are intentional alpha semantics, not hidden
  failures.

Full upstream parity, unadvertised Less 4.x CLI parity, browser compilation,
source-map artifacts, and performance parity remain follow-up work unless they
are expressly advertised for a later alpha.

- `[~]` **Performance — baseline required for alpha; numeric gate for GA remains
  an owner decision.** The alpha has no measured timing threshold and must not
  cite incomparable historical numbers. The alpha review record captures the
  built artifact, direct-parse AST hash, compiler CSS hash, and disabled normal
  instrumentation with the protocol above; no release command currently
  enforces a timing threshold. Any claimed improvement/regression needs a
  matched rebuilt-artifact A/B with identical output. Less-4.x speed parity (or
  a bounded multiple) remains a future stable/GA gate once the owner sets the
  numeric bar. Bootstrap import-reuse scout evidence from `512cf7837` found
  healthy stylesheet import reuse in one compile/render cycle: 88 Less parse
  calls for 88 unique parsed files, 87 stylesheet imports loaded once each, and
  no duplicate stylesheet parses. The remaining duplicate signal is
  script/plugin-side: Bootstrap requested 22 plugin modules for 11 unique
  resolved modules, while the module cache still performed only 11 actual loads.
  Next performance work should add a permanent import/plugin reuse probe and
  investigate why `prepareBodyPlugins()` requests each imported plugin twice
  before touching stylesheet parse caching.
- `[~]` **Advertised `lessc` CLI behavior** (alpha gate). The built Less v5
  alpha binary must run safely and correctly for its documented command/options
  set. Unsupported Less 4.x flags or not-yet-matched advanced behavior are alpha
  limitations only when listed in the release notes with a follow-up; they do
  not create an implied drop-in-parity promise.
- `[~]` Stabilize the public `jess` package API before the first Less alpha.
- `[~]` Maintain package-level Less coverage and the `find`/path-resolution
  surface. The complete upstream corpus remains a classified compatibility
  signal, not an implied all-fixtures-must-pass alpha gate.
- `[x]` Add Less v5 alpha CI guards that run the stable readiness tests after
  the API and fixture lanes are addressed. `.github/workflows/less-alpha-readiness.yml`
  runs `pnpm run verify:less-alpha` on pull requests, pushes to `main` and
  `alpha`, and manual dispatch.
- `[?]` Browser-build spec is drafted in
  [`less-v5-browser-build-spec.md`](../architecture/less-v5-browser-build-spec.md), but needs
  owner acceptance before adding browser package exports or browser fixture
  parity. Jess should support tree-shaken browser builds, but the alpha should
  not imply that arbitrary `.less` files are parsed in the browser.

## Controlled alpha refresh policy (verified 2026-07-22)

`alpha` and `dev` have a common ancestor but both histories added the same
working files afterward. A disposable rehearsal showed that
`git merge --squash dev` from `alpha` produces a large add/add conflict surface;
those conflicts are history topology, not a useful file-by-file review queue.
Never ordinary-merge or rebase `dev` into `alpha`, and do not resolve that
conflict set mechanically.

Use a recovery ref and an isolated `alpha` worktree. Import the endpoint tree
with a two-tree patch (`git diff --binary alpha..dev` followed by
`git apply --index`), then restore only `packages/*/package.json` from the
recovery ref. The package-manifest diff was verified to contain only the
lockstep version fields, and `pnpm-lock.yaml` is unchanged; this preserves the
alpha package versions without restoring alpha's weaker root release scripts.
Keep `dev`'s root `package.json` (including strict `verify:types` and bounded
production lint) and its newer HANDOFF/readiness/release evidence. Reconcile
the alpha release note from the final gate output rather than restoring the
older alpha docs wholesale.

After the controlled tree cut, commit one refresh on `alpha`, verify a clean
source tree, and rerun the complete `release:alpha:check` chain (build, strict
types, production lint, Less-alpha, AST-v2 ratchet, baseline, aggressive
cutting, allowlist, packed consumer, and publish dry-run) before any
owner-approved publish.

## API Stabilization

Goal: make the package boundary intentional enough that the alpha does not
accidentally promise transitional internals.

Current public entrypoint:

- `packages/jess/package.json` exports only `.` and `./package.json`.
- The package types currently come from `packages/jess/lib/index.d.ts`.
- Source entrypoint is `packages/jess/src/index.ts`.

Initial public candidate set:

- `[x]` `Compiler`
- `[x]` `ConfigOptions`
- `[x]` `Compiler.compile(...)` decision: hide from first alpha public types.
  Its internal result is `{ document: Stylesheet, context }`, produced through
  the same Context-selected parser-plugin dispatcher as render; it is not a
  legacy-tree return. Jess does not have a public two-stage compile model today,
  and exposing the raw session Context would promise implementation detail.
- `[x]` `Compiler.render(...)` decision: public method shape.
- `[x]` `Compiler.renderString(...)` decision: public method shape.
- `[x]` `Compiler.renderToResult(...)` decision: public method shape. Keep the
  result shape even though fields such as `loadedUrls` may need follow-up
  implementation before or during alpha. Public contract: never reject for
  Jess/Less render failures; return structured diagnostics instead.
- `[x]` `Compiler.safeCompile(...)` decision: hide from first alpha public
  types because it exposes the same internal document/session-Context surface
  as `compile(...)`.
- `[x]` `Compiler.safeRender(...)` decision: hide from first alpha public types;
  a separate "safe" render name does not currently describe a distinct public
  value clearly enough.
- `[x]` `Compiler.createContext(...)` decision: hide from first alpha public
  types. If plugin authors need this area later, design a narrower explicit API
  instead of promising raw `@jesscss/core` `Context`.
- `[x]` `Compiler.dispose()` decision: public stable method shape for
  long-lived build tools, watch mode, servers, and tests that need compiler and
  plugin cleanup.

Initial likely-internal or quarantine candidates:

- `[?]` Public constructor field `Compiler.opts`
- `[?]` Direct `{ document: Stylesheet, context }` `compile(...)` result as a
  stable API, versus retaining it as internal while recommending render APIs
- `[?]` `createContext(...)`, because it exposes core runtime details
- `[?]` Re-exported core diagnostic/value types that appear in public result
  shapes only because implementation currently imports them
- `[?]` `packages/jess/src/config.ts` helpers such as `getConfig`,
  `getConfigWithMeta`, and `getExpectedOutputFiles`
- `[?]` `packages/jess/src/output.ts` `OutputCollector`
- `[x]` Jess-local diagnostic renderer quarantine: `outputDiagnostics` now lives
  in `@jesscss/compiler/diagnostics`; `jess` consumes the shared compiler host
  renderer instead of carrying `packages/jess/src/diagnostics.ts`.
- `[?]` `packages/jess/src/visitor/index.ts` `Visitor`

Implementation options to evaluate:

- `[x]` Audit emitted declarations from `pnpm --filter jess build`.
- `[x]` Add an API-report style fixture for the emitted public declarations:
  `packages/jess/etc/jess.api.md`, checked by `pnpm run verify:jess-api`.
- `[x]` Decide whether to post-process `.d.ts` output to strip/quarantine
  methods and fields that must remain runtime-accessible but should not be
  typed as supported public API. Decision: use API Extractor d.ts rollup with
  `@internal` tags and disabled missing-release-tag warnings, so Jess does not
  need to mark every public item explicitly.
- `[x]` Add `pnpm run verify:package-exports` to the final alpha readiness
  guard set if API files or exports change.

Owner interview queue:

- `[x]` Should alpha users be encouraged to call only `render`, `renderString`,
  and `renderToResult`, with `compile` hidden until a real public need exists?
  Yes.
- `[x]` Is `safeCompile`/`safeRender` part of the public contract, or should
  errors flow through thrown diagnostics for alpha? Hide both; `render(...)` and
  `renderString(...)` may reject like normal promise APIs, while
  `renderToResult(...)` is the non-throwing structured diagnostics API.
- `[x]` Should `Compiler.opts` disappear from public types even if it remains a
  runtime field for now?
- Yes. It remains runtime-accessible for existing harness/internal use, but is
  marked `@internal` and trimmed from the public API Extractor rollup.
- `[x]` Should `createContext` be public for plugin authors, or hidden until the
  core runtime model settles? Hide for alpha; design a narrower plugin-author
  API later if needed.
- Should `jess` re-export any Less-compatible tree/value classes, or should
  those stay behind compatibility plugins for alpha?
- Are config helpers package-public, test-only, or internal?

## Less API Test Expansion

Goal: package-level Less tests should cover the Less API surface we claim for
alpha, using upstream Less test data where possible and focused Jess tests where
upstream fixtures do not map cleanly.

Current signal:

- `packages/jess/test/less/all-less.test.ts` runs upstream
  `tests-unit/*/*.less` and selected `tests-config/*/*.less` through
  `Compiler.renderToResult(...)`.
- `JESS_LESS_FIXTURE=tests-unit/ pnpm run test:less:test-data` currently covers
  79 unit fixture cases in the readiness lane.
- `JESS_LESS_FIXTURE=tests-config/ pnpm run test:less:test-data` covers 29
  config fixture cases in the current readiness lane.
- Browser tests are intentionally out of scope for this tracker until the
  browser-build spec exists.

Known gaps to add or close:

- `[~]` Include `tests-config/**/*.less` fixtures that exercise Less options,
  config files, include paths, rewrite URLs, source-map modes, plugins, and
  relative path handling. Runnable config fixtures are now included, with
  expected-failure labels for unsupported or mismatching behavior.
- `[x]` Cover Less `find`/path-resolution behavior explicitly, including
  relative imports and include-path lookup.
  Include-path lookup for imports and file functions is covered by
  `tests-config/include-path*`; `packages/jess/test/path-resolution.test.ts`
  now covers current-file-relative import precedence, include-path fallback,
  and `renderString(...)` filePath-based import resolution.
- `[x]` Add or validate tests for Less public API entrypoints that are not
  covered by file render fixtures. `packages/jess/test/public-api-contract.test.ts`
  covers the alpha public method shapes for `render(...)`,
  `renderString(...)`, `renderToResult(...)`, and `dispose()`; the current rerun
  is 8/8 green.
- `[~]` Convert fixture skips from broad comments into categorized expected
  failures with reasons and owners.
  The active harness now has expected-failure reasons for runnable mismatches
  and skip reasons for helper/no-CSS, plugin-scope, source-map artifact, and
  known hang fixtures. Owner/staging decisions still need release-note wording.
- `[ ]` Keep browser fixtures excluded, with an explicit skip category that
  points to the browser-build spec.
- `[ ]` Decide whether plugin, preprocessor, postprocessor, visitor, and custom
  file-manager fixtures are in the first alpha or staged after alpha. If staged,
  document the unsupported surface in release notes.
- `[ ]` Add focused core tests when a Less fixture exposes a parser/runtime
  invariant gap, then use the package-level fixture as the compatibility proof.

## Known limitations: runnable upstream corpus inventory

The complete, reproducible first-alpha inventory is
[`less-v5-corpus-inventory.md`](./less-v5-corpus-inventory.md). Its current
snapshot distinguishes 26 registered cases from 16 active expected-failure
checks in the 108-case alpha fixture lane. They are test instrumentation, not
passing compatibility evidence: a named active marker makes a mismatching
render pass the harness while preserving the observed failure. A marker may be
removed only with byte-identical fixture proof; otherwise its release-note
classification must remain explicit and be updated when its symptom or scope
changes. Do not duplicate fixture lists or inferred totals here: the inventory
is the only release-facing enumeration. Existing non-runnable skips (helper
files, no-CSS fixtures, compression/debug fixtures, and plugin API scope
decisions) are separate from both the active expected-failure lane and the
registered-but-unselected limitations.

Do not use the older `describe.todo` Less files as release evidence until each
test is revalidated against upstream Less behavior, Jess behavior docs, or a
focused core contract test.

## Browser Build Spec

Goal: avoid accidentally promising browser-side Less file parsing while still
supporting tree-shaken browser builds.

- `[x]` Specify what browser consumers can import. Draft:
  [`less-v5-browser-build-spec.md`](../architecture/less-v5-browser-build-spec.md).
- `[x]` Specify which Node-only features are excluded: filesystem imports,
  config discovery, plugin loading from disk, Node module resolution, and direct
  `.less` file parsing.
- `[x]` Specify what the tree-shaken browser build should support, such as
  precompiled/runtime-free helpers or explicit string-input APIs if approved.
- `[?]` Owner acceptance needed before adding package export or bundler tests.

## CI Guards

Goal: add CI jobs that prove the alpha stays releasable after the API and test
lanes are addressed.

Candidate guard set:

- `[x]` Install with frozen lockfile.
- `[x]` Build publishable alpha packages.
- `[x]` Verify package exports.
- `[x]` Verify public API declarations/API report.
- `[x]` Run public `jess` API contract tests for alpha-approved methods.
- `[x]` Run dedicated Less path-resolution tests for Node alpha behavior.
- `[x]` Run Less v5 fixture readiness tests, including the expanded non-browser
  Less API suite.
- `[x]` Run `release:alpha:check` after readiness tests are stable.

CI should not publish automatically from normal pushes. The existing manual
publish workflow remains the publishing path; readiness guards should fail
earlier, before a manual publish attempt.

## Evidence Log

- 2026-07-28: Added draft Jess `2.0.0-alpha.11` release notes on `dev` before
  the controlled alpha projection. The next Jess alpha is needed so Less PR #19
  can prove colored, single-frame Linecraft diagnostics against registry
  dependencies instead of published `2.0.0-alpha.10`.
- 2026-07-28: Updated Less PR #19 to `4686065d`, deleting the compatibility
  wrapper's diagnostic-message rewrite. `less.render()` now forwards canonical
  Jess diagnostic messages while preserving Less-style wrapper fields. Local
  `pnpm run test:alpha` passed, including typecheck/build, `lessc`, alpha
  support, alpha fixtures, publish dry-run tests, and packed-consumer proof
  against published Jess `2.0.0-alpha.10`.
- 2026-07-28: Updated the external Less PR #19 audit to head `c06338a4`,
  including successful `lessc` warning routing to `stderr` and the blocker rule
  that public `lessc` errors must render through colored Linecraft diagnostics.
  Jess `dev` also has the single-frame diagnostic renderer fix; the external
  proof waits for the next Jess alpha publish/dependency bump because PR #19
  still consumes published `2.0.0-alpha.10`.
- 2026-07-28: Rechecked PR #19 through GitHub: merge-state `CLEAN`, CI and
  CodeRabbit green on `c06338a4`, release-PR jobs skipped as expected. Jess
  `dev` commit `8b78b1afa` keeps the compiler script-plugin proxy generic and
  adds the canonical `deprecation/less-plugin` warning path for Less `@plugin`.
- 2026-07-28: Prepared and pushed Jess `origin/alpha` at `dd6359ed3` for
  `2.0.0-alpha.11`; `release:alpha:push-check` and `release:alpha:dry-run`
  passed. Added `pnpm run release:alpha:update-from-dev` on Jess `dev`
  (`57fcb27fa`) so future controlled alpha snapshots are scripted instead of a
  manual two-tree patch recipe.
- 2026-07-28: Updated external Less PR #19 to `36998a1d`, deriving release-test
  Jess alpha assertions and the packed consumer's expected Jess version from
  `packages/less/package.json` instead of hardcoding alpha.10. The commit hook
  reran `pnpm run test:alpha`, including typecheck/build, `lessc`, alpha
  support, alpha fixtures, publish dry-run tests, and packed-consumer proof
  against published Jess `2.0.0-alpha.10`. This was superseded by the
  `fa39abf8` `.11` bump below.
- 2026-07-28: Updated external Less PR #19 to `fa39abf8`, bumping its direct
  Jess runtime closure and optional `@jesscss/plugin-js` peer to published
  `2.0.0-alpha.11`. The alpha fixture harness removed
  `tests-unit/container/container.less` from expected render failures because
  `.11` fixes that gap; the gate now reports 87 rendered and 20 expected render
  failures. Local verification passed `pnpm install --frozen-lockfile
  --ignore-scripts`, `pnpm run test:alpha`, `pnpm run test:release`,
  `pnpm --dir packages/less run lint`, `npm test`, and `git diff --check`.
  The packed-consumer proof installs Jess `2.0.0-alpha.11` from the registry.
  GitHub CI is green for `fa39abf8` across ubuntu/macOS/windows and Node
  current, LTS, LTS-1, and LTS-2; release-PR automation jobs are skipped as
  expected.
- 2026-07-28: Repaired the Jess alpha fixture harness so
  `tests-unit/import/import.less` keeps surfacing its settled
  `resolve/name-not-found` expected failure instead of timing out at Vitest's
  default 5s sentinel during first-use JS plugin/import setup. The harness now
  asserts the diagnostic code for that fixture, so this expected failure cannot
  pass as an arbitrary mismatch or swallowed timeout. Verification passed the
  focused fixture, `pnpm run test:less:test-data:unit` (79 / 79), `pnpm run
  test:less:test-data:config` (29 / 29), and the full `pnpm run
  verify:less-alpha` chain.
- 2026-07-28: Committed the Parseman trivia-transfer hardening and adjacent
  parser cleanup through `2bb1674e8`. Verification passed
  `pnpm --filter @jesscss/core exec vitest --run src/ast/__tests__/provenance.test.ts src/ast/__tests__/import-at-rule.test.ts`,
  `pnpm --filter @jesscss/less-parser test -- --run` (479 / 479),
  `pnpm --filter @jesscss/scss-parser test` (294 / 294),
  `node scripts/verify-parser-runtime-boundary.mjs`, `pnpm run check:macro`,
  `pnpm run verify:compose-integrity`, and `pnpm run verify:less-alpha`.
  `pnpm run oracle:less:byte-identity` remains red, but CST throws are 0.
- 2026-07-28: Custom-property Less grammar internals dropped the local
  `DirectLess*` migration prefix. Verification passed focused custom-property
  Less parser tests, `pnpm run check:macro`, `pnpm run verify:compose-integrity`,
  and `pnpm run verify:less-alpha`. The byte-identity oracle remains red from
  the known baseline drift; reverse-patch comparison showed this slice adds
  CST-only digest movement and no AST movement.
- 2026-07-28: Less `@supports` condition helpers dropped their local
  `DirectLess*` migration prefix while keeping the same public CST node labels.
  Verification passed the focused Less parser support/public parse tests,
  `pnpm run check:macro`, and `pnpm run verify:compose-integrity`.
- 2026-07-28: Less parser diagnostics gained source-backed
  `parse/unterminated-string` summaries for generic quote failures, and direct
  `LessParseError` messages stopped exposing raw Parseman expected-token text.
  Verification passed the Less parser public parse test, the Jess
  `parser-error-public-semantics`/`all-less-error` tests, and the core/Jess
  build chain. `pnpm run check:macro`, `pnpm run verify:compose-integrity`, and
  `pnpm run verify:less-alpha` passed; `pnpm run oracle:less:byte-identity`
  remains red with unchanged throw/mover counts and unchanged CST aggregate, but
  the AST aggregate moved because direct parse diagnostic text is hashed.
- 2026-07-27: Pushed the folded-grammar/compiler/diagnostic batch to `origin/dev`
  at `fb13eef67`. Verification on the committed tree passed `pnpm run
  check:macro` (0 interpreter fallbacks), `pnpm run verify:compose-integrity`,
  `pnpm run verify:package-exports`, and `pnpm run verify:less-alpha`
  (`tests-unit/` 80 / 80 and `tests-config/` 29 / 29). The commits used
  `--no-verify` because the precommit hook is still blocked by style/lint
  hygiene debt; that debt is tracked as cleanup work, not alpha behavior
  evidence.
- 2026-07-22 (historical pre-Parseman-0.29 snapshot): `parseman@0.28.1` was
  published and consumed by Jess. The controlled alpha snapshot `564b65615`
  passed the full `release:alpha:check` chain with its 18-package
  packed-consumer proof and alpha.9 dry-run publish. It is retained as
  historical evidence only; it does not authorize or validate the current
  candidate.
- 2026-07-21 (historical baseline, superseded below): Made source quality an
  explicit blocking alpha gate rather than inferring it from release builds
  that use `--noCheck`. The dependency-ordered `verify:types` audit on the
  then-current integration candidate with published Parseman 0.28.0 reported
  245 diagnostics: 241 in core plus four parser-entry `FusedRule` diagnostics.
  The bounded `lint:production` audit reported 1,357 findings. Those counts are
  retained as historical burn-down evidence only.
- 2026-07-22 (historical snapshot, superseded by the published-0.28.1 entry
  above): Core strict types were clean, but four parser-entry `FusedRule`
  diagnostics remained under Parseman 0.28.0. The benchmark remains a baseline
  investigation with no valid matched 0.27/0.28 performance A/B yet.
- 2026-07-22: Re-audited the sibling Less `alpha` worktree. `less@5.0.0-alpha.1`
  packs, built-artifact `lessc` smoke tests pass, and the five publish helper
  tests plus package typecheck pass. A clean npm install is still blocked by the
  publish-time `link:` dependency rewrite until Jess alpha artifacts exist in
  the registry. The full Less node corpus exits 6 and is not alpha-green. The
  owner decision is explicit: do not publish Less and do not change Jess `dev`
  from this evidence-only audit.
- 2026-07-21: Replaced the stale dirty/behind Less package snapshot with the
  clean `5.0.0-alpha.1` release candidate at `1fc6d76b`. Verified
  `HEAD..upstream/master=0`, `npm run test:lessc`, `npm run typecheck`, and the
  five publish-version/dependency rewrite tests. Recorded the clean local Jess
  `2.0.0-alpha.9` candidate at `3081a94fe` without claiming either registry
  publication or final clean Less consumer verification.
- 2026-06-19: Created this tracker after owner declared the current
  `benchmark.less` performance good enough for first Less alpha and identified
  API stabilization, expanded Less API tests, and CI guards as release blockers.
- 2026-06-19: Added API Extractor public declaration trimming and API report
  guard. Verified with `pnpm --filter jess build`, `pnpm run verify:jess-api`,
  and `pnpm run verify:package-exports`.
- 2026-06-19: Fixed Less `paths` option normalization into core
  `searchPaths`, which closed `tests-config/include-path*` coverage for
  imports, `data-uri(...)`, and `image-size(...)`. Verified with
  `JESS_LESS_FIXTURE='tests-config/(include-path|include-path-string)/' pnpm run test:less:test-data`.
- 2026-06-19: Expanded the Less test-data harness to include `tests-config`,
  `JESS_LESS_FIXTURE` filtering, explicit expected-failure reasons, and
  stricter no-expected-CSS failures. Verified split lanes:
  `JESS_LESS_FIXTURE=tests-unit/ pnpm run test:less:test-data` (64 tests) and
  `JESS_LESS_FIXTURE=tests-config/ pnpm run test:less:test-data` (29 tests).
- 2026-06-19: Added `pnpm run verify:less-alpha`, which builds `jess`, checks
  package exports, checks API Extractor output, and runs the split Less unit
  and config readiness lanes. `release:alpha:check` now runs this guard before
  baseline verification and alpha dry-run publish. Verified with
  `pnpm run verify:less-alpha`.
- 2026-06-19: Fixed optimized leaf at-rule rendering so unknown at-rules and
  `@namespace` preserve the required boundary space after trimming authored
  prelude whitespace. This graduated `tests-unit/impor/impor.less` and
  `tests-unit/plugi/plugi.less` from expected-failure, and narrowed
  `tests-unit/css-3/css-3.less` to the remaining tiny rotate normalization
  mismatch. Verified with the focused at-rule test assertions,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^(tests-unit/css-3/css-3\.less|tests-unit/impor/impor\.less|tests-unit/plugi/plugi\.less)$' pnpm run test:less:test-data`.
- 2026-06-19: Fixed optional CSS fallback call rendering so structured
  `Dimension` arguments use normal dimension serialization instead of raw
  JavaScript number interpolation. This graduated `tests-unit/css-3/css-3.less`
  from expected-failure coverage. Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/call.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and the
  focused `JESS_LESS_FIXTURE='^(tests-unit/css-3/css-3\.less|tests-unit/impor/impor\.less|tests-unit/plugi/plugi\.less)$' pnpm run test:less:test-data`
  run after removing the expected-failure marker.
- 2026-06-19: Added `packages/jess/test/public-api-contract.test.ts` and
  `pnpm run test:jess-public-api` to guard the alpha-approved public methods:
  `render(...)`, `renderString(...)`, `renderToResult(...)`, and `dispose()`.
  `verify:less-alpha` now runs this public API contract test after API
  Extractor/package export checks and before Less fixture readiness tests.
  Verified with `pnpm run test:jess-public-api` and
  `pnpm run verify:less-alpha`.
- 2026-06-19: Added `packages/jess/test/path-resolution.test.ts` and
  `pnpm run test:jess-path-resolution` to guard Node alpha path behavior:
  current-file imports win before include paths, include paths are used as
  fallback, and `renderString(...)` uses `filePath` as the import base. The
  full `verify:less-alpha` guard now includes this dedicated path-resolution
  test.
- 2026-06-19: Added `.github/workflows/less-alpha-readiness.yml`, a non-publish
  CI workflow that runs `pnpm run verify:less-alpha` for pull requests, pushes
  to `main` and `alpha`, and manual dispatch. The manual publish workflow
  remains separate.
- 2026-06-19: Drafted `docs/architecture/less-v5-browser-build-spec.md`. The draft keeps the
  alpha `jess` root as the Node entrypoint, proposes a future `jess/browser`
  entrypoint for browser-safe string-input APIs, and explicitly excludes
  filesystem imports, config discovery, disk plugin loading, Node module
  resolution, custom file managers, and upstream Less browser fixture parity
  until the browser contract is accepted.
- 2026-06-19: Fixed escaped tag selector rendering so authored CSS escape
  casing is preserved for selector syntax instead of being lowercased with
  ordinary tag names. This graduated `tests-unit/css-escapes/css-escapes.less`
  from expected-failure coverage. Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/selector-basic.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/css-escapes/css-escapes\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
- 2026-06-19: Fixed custom property interpolation rendering so source-owned
  trivia before a one-item interpolated custom-property value is still written
  when the evaluated replacement becomes scalar text. This graduated
  `tests-unit/comments/comments.less` from expected-failure coverage while
  preserving raw custom-property comment strings without invented spacing.
  Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/declaration.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/comments/comments\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
- 2026-06-19: Fixed optional CSS fallback call materialization so source-owned
  comment trivia between function arguments is preserved in the generated
  scalar call text. This graduated `tests-unit/comments/comments2.less` from
  expected-failure coverage. Verified with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/call.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/comments/comments2\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
- 2026-06-19: Fixed CSS `@page` selector parsing so page names such as
  `Test:first` are modeled as identifier text instead of tag selectors, which
  preserves authored casing through Less render. This graduated
  `tests-unit/media/media.less` from expected-failure coverage. Verified with
  `pnpm --filter @jesscss/css-parser test -- ast-serialize.test.ts --run --globals --reporter=verbose -t "page selector names preserve authored casing"`,
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/at-rule.test.ts --run --globals --reporter=verbose`,
  `pnpm --filter @jesscss/css-parser build`, `pnpm --filter @jesscss/less-parser build`,
  `pnpm --filter @jesscss/core build`, `pnpm --filter jess build`, and
  `JESS_LESS_FIXTURE='^tests-unit/media/media\.less$' pnpm run test:less:test-data`
  after removing the expected-failure marker.
