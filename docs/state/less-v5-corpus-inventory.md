# Less v5 Alpha Corpus Inventory

This is the release-facing inventory for the public Less fixture lane. It is
not a claim of complete Less 4.x compatibility and it does not turn an
expected failure into passing-parity evidence.

The executable sources of truth are:

- `packages/jess/test/less/all-less.test.ts`, which owns the fixture glob,
  selection filters, and `expectedFailureFixtures` reason registry; and
- `packages/_shared/index.ts`, which owns the stricter-than-upstream
  `invalidLess` exclusion policy.

Refresh this document whenever either source changes. Run both release-shaped
fixture selections, not a raw test-data file count:

```sh
JESS_LESS_FIXTURE=tests-unit/ pnpm run test:less:test-data
JESS_LESS_FIXTURE=tests-config/ pnpm run test:less:test-data
```

## Current selection snapshot (2026-08-26)

The executable Vitest collection contains `81 unit` / `30 config` / `111
public-route` cases, plus the harness's own timeout-sensitivity test. These are
test-case counts: one source fixture may select more than one configured output.
Regenerate them from `vitest list` rather than carrying the numbers forward by
memory. The registry dispositions below are derived the same way.

The separate full-corpus report now uses the same strict error-surfacing
contract as the executable error gate (`functionMode:error`, `unitMode:strict`),
and excludes imported helper files from standalone error-case discovery. At
`4eed988b0` it finds no unclassified render non-pass: all 38 are active expected
failures, explicit `invalidLess` exclusions, or recursively nested deferred
source-map/debug-output cases. The error corpus has 94 expected errors from 95
standalone cases; the sole accepted case is the already-recorded v5 rule that
preserves `darken(var(--x), …)` because a runtime CSS variable cannot be folded
at build time.

### `expectedFailureFixtures` disposition — derived, not hand-counted

The registry is `expectedFailureFixtures` in
`packages/jess/test/less/all-less.test.ts`; the selection filters that decide
each entry's fate are the glob + filter chain in the same file
(`tests-unit/*/*.less` and `tests-config/*/*.less`, then `invalidLess`, then
`skippedFixtures`, then the `tests-unit/plugin-` prefix filter). Regenerate this
partition with:

```sh
# registry members
awk '/^const expectedFailureFixtures = new Map/,/^\]\);/' \
  packages/jess/test/less/all-less.test.ts \
  | grep -oE "'tests-(unit|config)/[^']*\.less'" | tr -d "'" | sort
# stricter-than-upstream exclusions
grep -oE "^  'tests-[^']*'" packages/_shared/index.ts | tr -d " '" | sort
```

A registry member is **active** iff it has exactly two path segments below
`tests-unit`/`tests-config`, is absent from `invalidLess`, is absent from
`skippedFixtures`, and does not start with `tests-unit/plugin-`. A passing
harness result for an active case means the mismatch/error remains observable;
it is not a Less-parity pass.

**Active public-route expected-failure checks** — exercised by the commands
above:

- `tests-config/3rd-party/bootstrap4.less`
- `tests-config/sourcemaps-basepath/sourcemaps-basepath.less`
- `tests-config/sourcemaps-include-source/sourcemaps-include-source.less`
- `tests-config/sourcemaps-rootpath/sourcemaps-rootpath.less`
- `tests-config/sourcemaps-url/sourcemaps-url.less`
- `tests-config/static-urls/urls.less` (import placement/rootpath now works; the
  active mismatch is only intentional authored multiline-value preservation)
- `tests-unit/at-rule-variable-deprecated/at-rule-variable-deprecated.less`
- `tests-unit/color-functions/operations.less`
- `tests-unit/extract-and-length/extract-and-length.less` (OPEN V17 structural
  mixin binding is implemented: fixed/rest/default/forwarding/spread and
  `@arguments` preserve nested list grouping. The active mismatch is only the
  maintained golden's three spaces after `--empty-value:` for
  `extract(~'', 1)`; the current Less v5 public runtime and every neighboring
  custom-property row canonicalize that boundary to one. This isolated layout
  discrepancy is an owner-fixture reconciliation question, not evidence for a
  missing structural `extract()`/`length()` feature.)
- `tests-unit/functions/functions.less`
- `tests-unit/import/import-inline.less`
- `tests-unit/import/import-reference.less` (A7 reference visibility now works
  for direct and at-rule-contained rules, hidden selector ancestors, mixin pulls,
  inline imports, and a nested pseudo whose fused `&` crosses a compacted
  selector-list arm; selected reference-mixin bodies replay their parser-owned
  inline and block-interior trivia in both output modes. The active mismatch is
  settled v5 selector compaction and direct-self declaration coalescing, explicit
  nested output, the alpha golden's omission of a source-asserted surviving inline
  comment, and invalid-inline indentation)
- `tests-unit/import/import.less` (OPEN N10 now makes the definition imported at
  line 18 visible to the line-12 mixin call before output evaluation. The sole
  active blocker is the maintained 4.x media-postlude form rejected by v5
  §12.3b.)
- `tests-unit/media/media.less`
- `tests-unit/mixins/mixins.less` (fixture-local nested output vs flattened
  golden; the `.recursion` outer-mixin lookup is covered by core)
- `tests-unit/parse-interpolation/parse-interpolation.less` (`*[...]` capture is
  implemented; it is no longer a feature gap. Its final captured-parent / suffix
  ampersand mismatch is an INTENDED DIVERGENCE, owner ruling 2026-08-22:
  `collapseNesting:false` preserves the nested boundary; explicit collapse
  matches the flattened golden, and Less `each()` is pinned as explicit rule
  multiplication. Separate OPEN O8 owner decisions remain for canonical nested
  selector-list wrapping and leading whitespace from an escaped quoted selector
  at a header boundary. Owner-maintained fixture corrections are needed for the
  flattened final stanza and the golden `foo: bar` whose quoted-case source says
  `foo: baz`.)
- `tests-unit/plugin/plugin.less`
- `tests-unit/urls/urls.less` (INTENDED DIVERGENCE under §12.3b: the fully
  interpolated `.add_an_import("file.css")` target is authored as a compile-time
  `StyleImport`; classification does not defer until evaluation, so normal import
  resolution reports `import/not-found` for `file.css`.)

**Outside the two-level fixture glob** — nested below `legacy/`, so the harness
never reaches them. Their Less 5 removal is documented; they are release-note
limitations, not silently passing tests:

- `tests-unit/functions/legacy/functions.less` (also listed in `invalidLess`,
  but the glob excludes it first)
- `tests-unit/ie-filters-REMOVED/legacy/ie-filters.less`
- `tests-unit/javascript-REMOVED/legacy/javascript.less`

**Excluded by `invalidLess`** — each row records why it remains outside the
public lane. Some are intentionally rejected syntax; others are fixture-policy
or maintained-output mismatches and must not be presented as parser gaps:

- `tests-unit/parser-slashed-combinator/parser-slashed-combinator.less` (contains
  only comments; `/deep/` and `/shadow/` examples are commented out. This is not
  an outstanding parser feature. It stays excluded because Jess's empty output is
  `""` while the maintained empty golden contains one newline.)
- `tests-unit/permissive-parse/permissive-parse.less` (P2 permissive custom-property
  values and selector capture are implemented. The fixture is intentionally
  rejected earlier by P7's bare-`@var` at-rule-prelude rule and later golden rows
  also assume bare-variable evaluation inside custom-property values.)
- `tests-unit/property-name-interp/property-name-interp.less` (the alpha fixture
  already replaced removed dash-only variables with `@dash`; current output is
  otherwise byte-identical, but repeated `@{p}@{p}` drops the `/* foo */` trivia
  carried inside each complex interpolated property-name value. This is a concrete
  instance of OPEN ledger row F7(a), the interpolation-splice source-layout
  boundary, and requires an owner ruling before implementation.)
- `tests-unit/selectors/selectors.less`
- `tests-unit/variables/variables.less`

**Excluded `plugin-` variants** — removed by the harness's
`tests-unit/plugin-` prefix filter; their unsupported legacy plugin ABI is
documented, but they are not active fixture-lane checks:

- `tests-unit/plugin-module/plugin-module.less`
- `tests-unit/plugin-preeval/plugin-preeval.less`

Registry membership and runnability must never be used interchangeably: most
registry members are not active lane checks.

### Not a registry entry: `import-remote`

`tests-unit/import/import-remote.less` is **not** in `expectedFailureFixtures`.
It is a member of the separate `skippedFixtures` array in the same file — remote
URL imports require an explicit network/IO allowlist, which is not part of the
alpha harness policy. It must not be counted in any registry disposition.

The named reason beside every entry remains in
`expectedFailureFixtures`; update that reason and this classification together.
`import/import` must settle under the normal short hang sentinel and surface the
expected `resolve/name-not-found` diagnostic code. A timeout is a harness failure,
not parity evidence.
`process-imports/google`, `namespacing/namespacing-8`,
`namespacing/namespacing-functions`, `namespacing/namespacing-media`,
`url-args/urls`, and `detached-rulesets/detached-rulesets` are now ordinary
passes; `functions/functions` is active in the alpha lane and remains an
expected failure for the settled F5 lazy CSS-color boundary. The focused F5
public-semantics test remains additional evidence for the full F5 rule.

### Compatibility-work pause boundary (2026-08-22)

This inventory assumes a clean checkout of `origin/dev`. There is no uncommitted
implementation required to reproduce it.

Owner ruling, 2026-08-22: captured selector lists do not automatically distribute
their nested rule bodies. Less `each()` and Sass `@each` are the explicit forms
and both lower to core `For`. Accordingly, the final captured-parent stanza in
`parse-interpolation` remains the intended non-collapsed-output divergence already
recorded above; do not classify it as a missing global distribution function.

The separate `import-reference` selector differential is not an actionable
distribution feature. The rejected prototype inferred parent-selector structure
from `&` bytes and eagerly enumerated `P^A` products; it confused opaque selector
payloads such as `[title="&"]` with parent references and had an unbounded
work/memory shape. Under the owner ruling above, do not resume that lane as an
implicit selector-list distribution mechanism.

The independent final-function-argument batch now fixes the parser gap exposed
behind the earlier `tests-unit/urls/urls.less` import diagnostic. A typed value
sequence such as `fade(@color, 50%) 100%` remains one argument when newline or
comment trivia precedes the final `)`, so `svg-gradient(...)` reaches the Less
function and emits its data URI instead of surviving as a raw call or becoming
`false`. The landed shape does **not** extend the rejected zero-width trivia
probe: `ArgumentValueSequence` declines only a following condition operator,
while the enclosing argument list owns comma, semicolon, close, and their
trivia. The 3×4 AST/CST matrix pins all three delimiters across adjacent,
newline, block-comment, and line-comment boundaries; the named parent/candidate
oracle moves only the two physical copies of the upstream svg-gradient fixture.

### OPEN N9 follow-up candidate from the import-path lane

- The OPEN N9 candidate makes parser-classified CSS terminals from executed document-root Less imports
  join the output document prelude in lexical import order. The existing import
  planner carries their canonical node, typed target, lexical frame, and source
  callback during its one graph walk; compile-time documents still execute at
  their authored splice positions. Reference terminals stay hidden, import-once
  and `(multiple)` retain their established occurrence policy, nested at-rule
  imports stay nested, and late-resolved imports splice their terminal segment
  back at the original lexical position. The `static-urls` fixture now differs
  only because v5 preserves the authored newline/indent in its multiline
  `src:` value while the maintained 4.x golden collapses it.

- Root-hoisted CSS-terminal imports now retain parser-owned block-comment trivia
  at the typed target/tail boundaries for both direct quotes and `url(...)`, with
  and without `rootpath`. Fixed parser-owned import offsets query the canonical
  trivia adapter only at exact typed boundaries; no import source is scanned or
  reparsed. A mixed block/line gap emits the CSS block comment once and drops the
  Less line comment rather than replaying either before the following rule, and
  a structured tail retains its own interior comment instead of lending it to
  the target/tail boundary. Focused parser coverage is 104/104 and focused import
  emission coverage is 14/14, including inner-only quoted and URL comments with
  and without a target rewrite. Exact-parent/current oracle digests match on all
  751 entries; the dependency-order release build, full core, all-less,
  all-less-error, production ratchet, macro/compose, frontier, package-export,
  aggressive-cutting, and guardrail gates pass. Grammar, performance, and
  semantics reviewers approve the exact redesigned carrier; landing is recorded
  by the `dev` branch history.

The remote import fixture is tracked in
[`less-v5-release-plan.md`](../process/less-v5-release-plan.md) as a deferred
Phase C import/security feature, not as a flaky expected failure.

### Post-N10 actionable boundary (2026-08-26)

The fresh full-corpus run at `4eed988b0` has no unclassified render non-pass and
does not expose another owner-independent implementation batch in the current
alpha scope. The remaining capability families have explicit boundaries rather
than hidden fixture debt:

- remote imports require a network/IO allowlist and security policy;
- source maps require the still-open emit-time provenance model and a map-artifact
  API/harness;
- legacy pre/post-processors, visitors, and file managers are Phase E host APIs;
- browser compilation is excluded from alpha.1; and
- compressed output remains deferred under OPEN O3.

This boundary does not reclassify any owner-maintained fixture and does not infer
selector-list distribution. Less `each()` and Sass `@each` already share the core
`For` construct as the explicit distribution mechanism.

### OPEN N10 document-root import facts

- Static planning now publishes direct variables, mixin definitions, and root
  ruleset/namespace facts from the complete document-root import graph before
  output evaluation. A call or variable read can therefore precede the import
  that supplies it, including through a transitive import and a `(reference)`
  document. Imported bodies and CSS still execute at their authored splice.
- Canonical statement identity prevents repeated `(multiple)` occurrences of one
  loaded document from duplicating its callable/value facts, while the imported
  body still emits once per occurrence. Reusing one opaque `PreparedImports`
  result across concurrent renders republishes into each render's fresh root
  frame without mutating the shared plan.
- Focused public coverage pins both output modes and the transitive graph; core
  coverage pins prepared-plan reuse, concurrent renders, `(multiple)` body/fact
  separation, reference-before-call visibility, and the negative boundary that
  keeps an at-rule import out of the document root while exposing it to later
  statements inside that at-rule. No owner-maintained CSS fixture changed.
  `tests-unit/import/import.less` stays expected-failure only because its
  compile-time import postludes remain intentionally rejected under §12.3b.

### Resolved non-corpus function follow-up

- Less's shared HSL adjustment kernel now clamps the written saturation or
  lightness channel after absolute or `relative` adjustment (ledger **V14**).
  This fixes `desaturate(#888, 10%)` and `desaturate(#999, 10%)`, which formerly
  created negative saturation and emitted teal instead of grey. Direct function
  tests cover both channel bounds, relative mode, and an in-range chromatic
  control; the public compiler test pins the achromatic bytes. No owner-maintained
  corpus fixture exercises this edge, so the expected-failure registry is
  unchanged.

- Less `isurl()` now reads a typed value-domain `UrlValue` projected from the
  parser-owned `Url` AST node at function/operation boundaries (ledger **V15**).
  Direct and variable-sourced URLs answer true; a quoted string, unknown call, or
  keyword that merely spells `url(...)` answers false. Ordinary URL declaration
  output retains its existing string path, so no owner-maintained corpus fixture
  or expected-failure status changes.

Browser fixture parity is excluded from alpha.1 by design. The current browser
contract is tracked in
[`less-v5-browser-build-spec.md`](../architecture/less-v5-browser-build-spec.md):
alpha.1 does not promise browser-side `.less` file parsing, browser imports,
browser plugin execution, or upstream Less browser fixture parity.

Less 4.x plugin host compatibility fixtures are also staged after alpha.1 unless
they already pass through ordinary Less `@plugin` function registration. The
deferred Phase E surface in
[`less-v5-release-plan.md`](../process/less-v5-release-plan.md) includes
preprocessor, postprocessor, visitor, custom file-manager, legacy CommonJS
plugin graph, and pre-eval/tree visitor behavior.

## Release-note rule

Jess and external Less alpha release notes must link this document and state
the active selection counts above. If a later release deliberately changes the
fixture glob, invalid-fixture policy, or plugin scope, record the new snapshot
with the command output rather than carrying these counts forward by memory.
