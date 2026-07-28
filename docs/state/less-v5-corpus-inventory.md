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

The two commands above pass with **79 unit cases** and **29 config cases**.
Of the resulting **108 public-route cases**, **92** are ordinary
byte-identical checks and **16** are active expected-failure checks. A passing
harness result for those 16 means the mismatch/error remains observable; it is
not a Less-parity pass.

`expectedFailureFixtures` contains **26 registered cases**. Ten are not in
the current alpha selection, so “26 expected failures” and “16 runnable
expected failures” must never be used interchangeably:

| Registry disposition | Count | Why |
| --- | ---: | --- |
| Active public-route expected-failure check | 16 | Matches `tests-unit/*/*.less` or `tests-config/*/*.less`, survives the invalid-fixture and plugin-prefix filters, and is exercised by the commands above. |
| Skipped by alpha harness policy | 1 | `tests-unit/import/import-remote.less` requires remote network fetches, which need an explicit network/IO allowlist before they can be part of the public alpha lane. |
| Excluded by `invalidLess` | 5 | The direct parser intentionally rejects a stricter-than-upstream syntax/fixture family; these need their own parser-policy coverage before becoming alpha-lane cases. |
| Outside the two-level fixture glob | 3 | The `javascript-REMOVED/legacy`, `ie-filters-REMOVED/legacy`, and `functions/legacy` fixtures are nested below `legacy/`. Their Less 5 removal is documented, but the current harness does not execute them. |
| Excluded plugin variant | 2 | `plugin-module` and `plugin-preeval` are excluded by the harness’s `tests-unit/plugin-` filter. Their unsupported legacy plugin ABI is documented, but they are not active fixture-lane checks. |

### Active expected-failure cases

These are the 16 cases exercised by the alpha fixture command today:

- Imports and URL options: `import/import-reference`, `import/import`,
  `urls/urls`, `static-urls/urls`, and `url-args/urls`.
- Callable and nested-render semantics:
  `detached-rulesets/detached-rulesets` and
  `mixins/mixins` (currently fixture-local nested output vs flattened golden;
  the `.recursion` outer-mixin lookup is covered by core).
- Source-map artifacts: `sourcemaps-basepath/sourcemaps-basepath`,
  `sourcemaps-include-source/sourcemaps-include-source`,
  `sourcemaps-rootpath/sourcemaps-rootpath`, and `sourcemaps-url/sourcemaps-url`.
- Less 5 policy/removal or parser boundaries:
  `plugin/plugin`, `parse-interpolation/parse-interpolation`, and
  `media/media`.
- F5 lazy CSS-color boundary: `color-functions/operations` and
  `functions/functions`.

The named reason beside every entry remains in
`expectedFailureFixtures`; update that reason and this classification together.
`import/import` also has a fixture-specific timeout because first-use JS
plugin/import setup can exceed the default 5s hang sentinel before settling as a
diagnostic-bearing expected failure. That timeout is not parity evidence; it
exists so the underlying failure remains visible.
`process-imports/google`, `namespacing/namespacing-8`,
`namespacing/namespacing-functions`, and `namespacing/namespacing-media` are now
ordinary passes; `functions/functions` is active in the alpha lane and remains
an expected failure for the settled F5 lazy CSS-color boundary. The focused F5
public-semantics test remains additional evidence for the full F5 rule.

### Registered but not selected

`invalidLess` currently excludes `selectors/selectors`,
`property-name-interp/property-name-interp`, `variables/variables`,
`parser-slashed-combinator/parser-slashed-combinator`, and
`permissive-parse/permissive-parse`.

The remaining inactive registry entries are the three nested legacy fixtures
and the two `plugin-` variants identified in the disposition table.
They are release-note limitations, not silently passing tests.

The remote import fixture is tracked in
[`less-v5-release-plan.md`](../process/less-v5-release-plan.md) as a deferred
Phase C import/security feature, not as a flaky expected failure.

## Release-note rule

Jess and external Less alpha release notes must link this document and state
the active selection counts above. If a later release deliberately changes the
fixture glob, invalid-fixture policy, or plugin scope, record the new snapshot
with the command output rather than carrying these counts forward by memory.
