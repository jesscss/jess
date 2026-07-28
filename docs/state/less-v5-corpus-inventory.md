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

## Current selection snapshot (2026-07-22)

The two commands above pass with **78 unit cases** and **29 config cases**.
Of the resulting **107 public-route cases**, **86** are ordinary
byte-identical checks and **21** are active expected-failure checks. A passing
harness result for those 21 means the mismatch/error remains observable; it is
not a Less-parity pass.

`expectedFailureFixtures` contains **32 registered cases**. Eleven are not in
the current alpha selection, so “32 expected failures” and “21 runnable
expected failures” must never be used interchangeably:

| Registry disposition | Count | Why |
| --- | ---: | --- |
| Active public-route expected-failure check | 21 | Matches `tests-unit/*/*.less` or `tests-config/*/*.less`, survives the invalid-fixture and plugin-prefix filters, and is exercised by the commands above. |
| Excluded by `invalidLess` | 6 | The direct parser intentionally rejects a stricter-than-upstream syntax/fixture family; these need their own parser-policy coverage before becoming alpha-lane cases. |
| Outside the two-level fixture glob | 3 | The `javascript-REMOVED/legacy`, `ie-filters-REMOVED/legacy`, and `functions/legacy` fixtures are nested below `legacy/`. Their Less 5 removal is documented, but the current harness does not execute them. |
| Excluded plugin variant | 2 | `plugin-module` and `plugin-preeval` are excluded by the harness’s `tests-unit/plugin-` filter. Their unsupported legacy plugin ABI is documented, but they are not active fixture-lane checks. |

### Active expected-failure cases

These are the 21 cases exercised by the alpha fixture command today:

- Imports and URL options: `import/import-reference`, `import/import`,
  `urls/urls`, `process-imports/google`, `static-urls/urls`, and
  `url-args/urls`.
- Callable, namespace, and nested-render semantics:
  `namespacing/namespacing-8`, `namespacing/namespacing-functions`,
  `namespacing/namespacing-media`, `detached-rulesets/detached-rulesets`, and
  `mixins/mixins` (currently fixture-local nested output vs flattened golden;
  the `.recursion` outer-mixin lookup is covered by core).
- Source-map artifacts: `sourcemaps-basepath/sourcemaps-basepath`,
  `sourcemaps-include-source/sourcemaps-include-source`,
  `sourcemaps-rootpath/sourcemaps-rootpath`, and `sourcemaps-url/sourcemaps-url`.
- Less 5 policy/removal or parser boundaries:
  `variables-in-at-rules/variables-in-at-rules`, `javascript-REMOVED/legacy/javascript`,
  `ie-filters-REMOVED/legacy/ie-filters`, `plugin/plugin`,
  `parse-interpolation/parse-interpolation`, `media/media`, and
  `container/container`.
- F5 lazy CSS-color boundary: `color-functions/operations`.

The named reason beside every entry remains in
`expectedFailureFixtures`; update that reason and this classification together.
The F5 registry also contains `functions/functions`, but that fixture is
currently excluded by `invalidLess`, so it is not an active expected-failure
check. The focused F5 public-semantics test remains the evidence for the full
F5 rule.

### Registered but not selected

`invalidLess` currently excludes `selectors/selectors`,
`property-name-interp/property-name-interp`, `variables/variables`,
`parser-slashed-combinator/parser-slashed-combinator`,
`permissive-parse/permissive-parse`, and `functions/functions`.

The remaining inactive registry entries are the three nested legacy fixtures
and the two `plugin-` variants identified in the disposition table.
They are release-note limitations, not silently passing tests.

## Release-note rule

Jess and external Less alpha release notes must link this document and state
the active selection counts above. If a later release deliberately changes the
fixture glob, invalid-fixture policy, or plugin scope, record the new snapshot
with the command output rather than carrying these counts forward by memory.
