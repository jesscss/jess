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

## Current selection snapshot (2026-07-28)

Lane totals (`79 unit` / `29 config` / `108 public-route` cases) were last
measured on 2026-07-28 and are **not** re-verified here; see
`docs/architecture/core/HANDOFF.md` for the current measurement. Do not quote
the totals above from this file. The registry dispositions below, by contrast,
are derived — regenerate them rather than trusting a number.

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

- `tests-config/sourcemaps-basepath/sourcemaps-basepath.less`
- `tests-config/sourcemaps-include-source/sourcemaps-include-source.less`
- `tests-config/sourcemaps-rootpath/sourcemaps-rootpath.less`
- `tests-config/sourcemaps-url/sourcemaps-url.less`
- `tests-config/static-urls/urls.less`
- `tests-config/url-args/urls.less`
- `tests-unit/at-rule-variable-deprecated/at-rule-variable-deprecated.less`
- `tests-unit/color-functions/operations.less`
- `tests-unit/detached-rulesets/detached-rulesets.less`
- `tests-unit/functions/functions.less`
- `tests-unit/import/import-reference.less` (A7 reference visibility now works
  for direct and at-rule-contained rules, hidden selector ancestors, mixin pulls,
  and inline imports; the active mismatch is v5 selector compaction, explicit
  nested output, comment replay, and invalid-inline indentation)
- `tests-unit/import/import.less`
- `tests-unit/media/media.less`
- `tests-unit/mixins/mixins.less` (fixture-local nested output vs flattened
  golden; the `.recursion` outer-mixin lookup is covered by core)
- `tests-unit/parse-interpolation/parse-interpolation.less`
- `tests-unit/plugin/plugin.less`
- `tests-unit/urls/urls.less`

**Outside the two-level fixture glob** — nested below `legacy/`, so the harness
never reaches them. Their Less 5 removal is documented; they are release-note
limitations, not silently passing tests:

- `tests-unit/functions/legacy/functions.less` (also listed in `invalidLess`,
  but the glob excludes it first)
- `tests-unit/ie-filters-REMOVED/legacy/ie-filters.less`
- `tests-unit/javascript-REMOVED/legacy/javascript.less`

**Excluded by `invalidLess`** — the direct parser intentionally rejects a
stricter-than-upstream syntax/fixture family; these need their own
parser-policy coverage before becoming alpha-lane cases:

- `tests-unit/parser-slashed-combinator/parser-slashed-combinator.less`
- `tests-unit/permissive-parse/permissive-parse.less`
- `tests-unit/property-name-interp/property-name-interp.less`
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
`namespacing/namespacing-functions`, and `namespacing/namespacing-media` are now
ordinary passes; `functions/functions` is active in the alpha lane and remains
an expected failure for the settled F5 lazy CSS-color boundary. The focused F5
public-semantics test remains additional evidence for the full F5 rule.

The remote import fixture is tracked in
[`less-v5-release-plan.md`](../process/less-v5-release-plan.md) as a deferred
Phase C import/security feature, not as a flaky expected failure.

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
