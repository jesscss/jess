# Less Oracle Mover Classification

Current classification date: 2026-07-28.

This file tracks the active red state of `pnpm run oracle:less:byte-identity`
after the four-grammar fold, comment/trivia cleanup, Parseman `0.41.0`, and the
recent Less parser diagnostic/trivia attachment changes. It exists so a future
baseline decision starts from named entry classes instead of aggregate panic.

## Current Report

Registry resolution checked from the Jess workspace:

```sh
node -p "require('./node_modules/parseman/package.json').version + ' ' + require('fs').realpathSync('./node_modules/parseman')"
```

Result: `0.41.0` from
`/Users/matthew/git/oss/jess/node_modules/.pnpm/parseman@0.41.0/node_modules/parseman`.

Resolved package versions and paths for the current report:

| package | version | resolved path |
| --- | --- | --- |
| `@jesscss/parser-shared` | `0.0.0` | `/Users/matthew/git/oss/jess/packages/parser-shared` |
| `@jesscss/css-parser` | `2.0.0-alpha.5` | `/Users/matthew/git/oss/jess/packages/syntax/css/css-parser` |
| `@jesscss/less-parser` | `2.0.0-alpha.5` | `/Users/matthew/git/oss/jess/packages/syntax/less/less-parser` |
| `@jesscss/plugin-less` | `2.0.0-alpha.5` | `/Users/matthew/git/oss/jess/packages/syntax/less/jess-plugin-less` |
| `jess` | `2.0.0-alpha.5` | `/Users/matthew/git/oss/jess/packages/jess` |

Latest report generated from the post-trivia-transfer, mixin-guard diagnostic,
`processImports: false`, Less query-prelude separator-helper, and custom-property
variable-value source state:

```sh
pnpm --filter @jesscss/parser-shared build
pnpm run oracle:less:byte-identity
node packages/syntax/less/less-parser/test/oracle-byte-identity.mjs \
  > /tmp/jess-less-oracle-current-20260728-after-custom-values.json
```

`pnpm run oracle:less:byte-identity` currently reports:

| surface | committed baseline | current aggregate | throws | common entries moved |
| --- | --- | --- | ---: | ---: |
| AST | `309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929` | `349674c59d3fcc6ba42a4b762423761ff19c2880d2830df43ca2006aa0f4a6cb` | 116 | 217 |
| CST | `7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4` | `222fc59f188db86f5e58126f4efe8ccf55a2c343a72e86b4a4b56434472189e5` | 0 | 595 |

Corpus shape:

| field | count |
| --- | ---: |
| baseline entries | 709 |
| current entries | 711 |
| gained entries | 2 |
| removed entries | 0 |

The gained entries are:

- `node_modules/@less/test-data/tests-unit/math-css-vars/math-css-vars.css`
- `node_modules/@less/test-data/tests-unit/math-css-vars/math-css-vars.less`

Raw changed-entry counts, including corpus growth:

| subset | count | current read |
| --- | ---: | --- |
| changed entries on either surface | 667 | 665 common movers across either surface plus the 2 gained corpus entries. |
| common AST movers | 217 | 147 also move on CST; 70 move only on AST. |
| changed-or-added AST entries | 219 | Common AST movers plus the 2 gained corpus entries. |
| AST-only movers | 70 | Mostly error-projection hash movement after parser diagnostic normalization. |
| common CST-only movers | 448 | Broad public CST owner/name/span churn from the fold, routed opener cleanup, and grammar reshaping. |
| common AST movers containing comments | 122 | Mostly comment/trivia/source ownership plus parser-error projection; review before baseline. |
| common AST movers without comments | 95 | Mostly syntax-error diagnostic hash movement plus custom-property variable-value structural parsing. |
| changed-or-added AST entries with comments | 123 | Adds `math-css-vars.less`, which is a new upstream fixture with leading `//` comments. |
| changed-or-added AST entries without comments | 96 | Adds `math-css-vars.css`, a new upstream expected CSS fixture. |

The custom-property variable-value fix keeps the AST throw count and CST mover
count stable, while adding three AST movers from newly structural custom
property `@name` value handling. This still belongs to the named mover review
and CST projection/minimization queue rather than a baseline update.

## AST Mover Buckets

Current AST mover surface by direct built-parser classification:

| bucket | count | comments | current read |
| --- | ---: | ---: | --- |
| Parses as `Stylesheet` | 99 | 95 | Valid or opaque syntax now accepted by the AST route, usually with comment/source ownership movement. |
| Throws `LessParseError` / `parse/syntax-error` | 110 | 23 | Syntax-error diagnostics changed shape or message; these are failures, not accepted syntax. |
| Throws `LessInlineJavaScriptError` / `parse/unsupported-inline-javascript` | 4 | 1 | Removed-but-recognized Less v5 policy for inline backtick JavaScript. |
| Throws `LessBareVariableInterpolationError` / `parse/unsupported-bare-variable-interpolation` | 1 | 1 | Removed-but-recognized migration diagnostic for bare `@name` interpolation. |

Path-level split:

| set | count | parses | syntax errors | other diagnostics | comments |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bootstrap port Less | 3 | 3 | 0 | 0 | 3 |
| Less tests-config fixtures | 28 | 13 | 13 | 2 | 20 |
| Less tests-error eval fixtures | 6 | 1 | 4 | 1 | 2 |
| Less tests-error parse fixtures | 26 | 0 | 26 | 0 | 1 |
| Less tests-unit fixtures | 89 | 71 | 16 | 2 | 80 |
| Jess test fixtures | 1 | 0 | 1 | 0 | 0 |
| CSS parser non-error fixtures | 13 | 11 | 2 | 0 | 11 |
| CSS parser error fixtures | 48 | 0 | 48 | 0 | 3 |

The four parsed AST movers without comments remain the highest-signal
acceptance review queue:

| entry | current AST surface | classification |
| --- | --- | --- |
| `node_modules/@less/test-data/tests-unit/color-functions/modern.css` | Parses as a `Stylesheet`. | Newer valid CSS expected-output fixture now accepted by the Less AST grammar. Review against the current Less v5 CSS-pass-through contract before baseline. |
| `node_modules/@less/test-data/tests-unit/container/container.css` | Parses as a `Stylesheet`. | Valid CSS expected-output fixture. This reflects `@container` acceptance; baseline only after focused container coverage remains green. |
| `node_modules/@less/test-data/tests-unit/plugin/plugin.css` | Parses as a `Stylesheet`. | Valid CSS output fixture and plugin-scoping sentinel. Keep dialect-owned function registration tests green before any baseline move. |
| `packages/syntax/css/css-parser/test/css/atrule-unknown.css` | Parses as an opaque `@future` block. | Likely intended opaque at-rule ownership movement. Needs focused CSS/Less unknown-at-rule conformance coverage before baseline. |

Diagnostic-only non-comment movers are large but less semantically ambiguous:
87 of the 94 non-comment common AST movers currently throw
`LessParseError` / `parse/syntax-error`, and 3 throw
`LessInlineJavaScriptError` / `parse/unsupported-inline-javascript`.

## Gained Corpus Entries

The corpus gained two upstream Less fixtures. They should be classified as
corpus growth, not as common-entry parser movement.

| entry | current AST surface | current CST | classification |
| --- | --- | --- | --- |
| `node_modules/@less/test-data/tests-unit/math-css-vars/math-css-vars.css` | Parses as a `Stylesheet` with 2 top-level rules. | Parses. | Upstream fixture sync. New expected CSS fixture for math functions with runtime CSS variables. |
| `node_modules/@less/test-data/tests-unit/math-css-vars/math-css-vars.less` | Parses as a `Stylesheet` with 2 top-level rules. | Parses. | Upstream fixture sync. Comment-bearing Less source for the same feature. |

## Comment-Bearing AST Movers

120 common AST movers contain `/* ... */` or `//` in the source. These are not
safe to wave through as "just comments," but comments remain parser trivia, not
AST leaves.

Path-level classification:

| set | count | parses | throws | current read |
| --- | ---: | ---: | ---: | --- |
| Bootstrap port Less | 3 | 3 | 0 | Large third-party fixtures; broad CST ownership plus comment/source attachment. |
| Less tests-config fixtures | 20 | 13 | 7 | Config fixtures with comments in expected CSS, source, or source-map/debug fixtures. |
| Less tests-error eval fixtures | 2 | 1 | 1 | Error fixtures where comments affect diagnostic/source ownership. |
| Less tests-error parse fixtures | 1 | 0 | 1 | Parser-error fixture with comments; diagnostic projection only. |
| Less tests-unit fixtures | 80 | 71 | 9 | Main comment/render corpus, imports, legacy expected CSS, mixins, selectors, and removed syntax. |
| CSS parser non-error fixtures | 11 | 11 | 0 | Focused CSS syntax fixtures; keep as conformance sentinels. |
| CSS parser error fixtures | 3 | 0 | 3 | Invalid CSS fixtures whose Less parse diagnostics moved. |

Same-state comment-erasure probe:

- The previous same-state comment-erasure probe covered 100 comment-bearing AST
  movers. It is superseded by the current 120-entry set and must be rerun before
  any baseline move.
- The old result remains directional evidence only: most comment-bearing
  movement was source/trivia ownership, not semantic AST payload. It is not a
  baseline proof, and it must not be used to justify preserving semantic
  comment nodes in grammar bodies.
- Next probe shape remains: replace each `/* ... */` and `// ...` comment with
  same-length whitespace, parse original and stripped source with the current
  AST parser, and compare a source/trivia/span-insensitive projection.

## CST-Only Movers

451 common entries move only on the CST surface. Current CST throws remain 0, so
this is not a parser acceptance regression by itself.

Representative causes to project or minimize:

- public CST owner/name/span changes caused by the host-mode fold;
- glued identifier/function opener ownership after `dispatch(...)` / `routed()`;
- query/supports/container feature shape changes;
- inline `:extend(...)` ownership and selector-list context;
- generic and opaque at-rule ownership;
- comment trivia extraction moving ownership out of grammar nodes.

Do not update the baseline until either:

- a declared CST projection proves these are intended owner/name/span movements;
  or
- the noisy CST ownership movement has been minimized with focused grammar
  cleanup.

## Rejection Categories

Do not collapse every Less 4.x incompatibility into "parse error." Grammar work
must classify each legacy shape before deciding whether to exclude it outright
or recognize it for diagnostics/recovery.

| category | grammar target | examples |
| --- | --- | --- |
| Removed and unrecognized | Let recognition fail at the real boundary. | Invalid CSS syntax such as malformed `calc()`, impossible delimiters, or placement errors. |
| Removed but recognized | Consume the removed shape into an unsupported fact/node, then emit a fatal diagnostic with a precise fix and language-service recovery. | Inline backtick JavaScript; plain `@name` variables in interpolated positions, with the exact `@{name}` migration. |
| Deprecated and still supported | Parse normally; report a warning when the diagnostic lane is wired. | Whitespace between a Less mixin name and call parens; paren-less Less mixin calls; discouraged `@import` / `@plugin` migration paths. |

## Baseline Rule

Do not update
`packages/syntax/less/less-parser/test/oracle-byte-identity.baseline.json` from
the current report until:

1. the four parsed non-comment AST movers are covered or explicitly decided;
2. the syntax-error mover buckets are accepted as diagnostic-shape changes, not
   parser acceptances;
3. the two gained corpus entries are accepted as upstream fixture growth;
4. the current 120-entry comment-erasure probe is rerun and focused
   comment/trivia fixtures cover comment-only mixin bodies, declaration-value
   trailing comments, selector-boundary comments, and comments inside at-rule
   preludes;
5. CST-only movement is projected or minimized; and
6. `pnpm run check:macro`, `pnpm run verify:compose-integrity`, and
   `pnpm run verify:less-alpha` still pass on the same source state.
