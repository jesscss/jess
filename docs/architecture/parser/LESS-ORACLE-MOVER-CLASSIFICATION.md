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

Latest report rerun on 2026-07-28 from local `dev`, after the
post-trivia-transfer hardening, unsupported-variable CST recovery,
mixin-guard diagnostic, `processImports: false`, Less query-prelude
separator-helper, custom-property variable-value, folded grammar type-surface,
structured module-resolution diagnostic source state, Less grammar helper
renames, and parser diagnostic message cleanup:

```sh
pnpm --filter @jesscss/parser-shared build
pnpm run oracle:less:byte-identity
node packages/syntax/less/less-parser/test/oracle-byte-identity.mjs \
  > /tmp/jess-less-oracle-current-20260728-trivia-transfer.json
```

`pnpm run oracle:less:byte-identity` currently reports:

| surface | committed baseline | current aggregate | throws | common entries moved |
| --- | --- | --- | ---: | ---: |
| AST | `309d91e177887c6aa3d140380cd5c78529a77360a427007146a2717c49a7e929` | `9263d36f95280b7b8e897abbb44dc511a953bd01110b98899d92a918defcbd5a` | 116 | 217 |
| CST | `7819745e6303225316b5af7d68ea9de301e5dd95603e06bca1260d65abb506c4` | `3596049629b1441bed7f93100374c23330bf02d60994c65582741cd11d94b491` | 0 | 634 |

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
| changed entries on either surface | 705 | 703 common movers across either surface plus the 2 gained corpus entries. |
| common AST movers | 217 | 148 also move on CST; 69 move only on AST. |
| changed-or-added AST entries | 219 | Common AST movers plus the 2 gained corpus entries. |
| AST-only movers | 69 | Mostly error-projection hash movement after parser diagnostic normalization. |
| common CST-only movers | 486 | Broad public CST owner/name/span churn from the fold, routed opener cleanup, and grammar reshaping. |
| common AST movers containing comments | 122 | Mostly comment/trivia/source ownership plus parser-error projection; review before baseline. |
| common AST movers without comments | 95 | Mostly syntax-error diagnostic hash movement plus custom-property variable-value structural parsing. |
| changed-or-added AST entries with comments | 123 | Adds `math-css-vars.less`, which is a new upstream fixture with leading `//` comments. |
| changed-or-added AST entries without comments | 96 | Adds `math-css-vars.css`, a new upstream expected CSS fixture. |

The Parseman trivia-transfer hardening keeps CST throws at 0 after the
unsupported-variable CST recovery regression, but it does move the broad CST
aggregate. This still belongs to the named mover review and CST
projection/minimization queue rather than a baseline update.

The parser diagnostic message cleanup changes the AST aggregate because thrown
direct-parser errors are part of the hashed AST surface. It does not change the
AST throw count, common AST mover count, CST throw count, CST mover count, or
CST aggregate.

## AST Mover Buckets

Current AST mover surface by direct built-parser classification:

| bucket | count | comments | current read |
| --- | ---: | ---: | --- |
| Parses as `Stylesheet` | 101 | 96 | Valid or opaque syntax now accepted by the AST route, usually with comment/source ownership movement. |
| Throws `LessParseError` / `parse/syntax-error` | 107 | 22 | Syntax-error diagnostics changed shape or message; these are failures, not accepted syntax. |
| Throws `LessInlineJavaScriptError` / `parse/unsupported-inline-javascript` | 4 | 1 | Removed-but-recognized Less v5 policy for inline backtick JavaScript. |
| Throws `LessBareVariableInterpolationError` / `parse/unsupported-bare-variable-interpolation` | 1 | 1 | Removed-but-recognized migration diagnostic for bare `@name` interpolation. |
| Throws `LessUnsupportedVariableNameError` / `parse/unsupported-variable-name` | 4 | 2 | Removed legacy Less variable names are recognized on the AST route for targeted diagnostics while CST stays recoverable. |

Path-level split:

| set | count | parses | syntax errors | other diagnostics | comments |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bootstrap port Less | 4 | 4 | 0 | 0 | 4 |
| Less tests-config fixtures | 29 | 14 | 12 | 3 | 21 |
| Less tests-error eval fixtures | 6 | 1 | 4 | 1 | 2 |
| Less tests-error parse fixtures | 26 | 0 | 26 | 0 | 1 |
| Less tests-unit fixtures | 90 | 71 | 15 | 4 | 80 |
| Jess test fixtures | 1 | 0 | 1 | 0 | 0 |
| CSS parser non-error fixtures | 13 | 11 | 2 | 0 | 11 |
| CSS parser error fixtures | 48 | 0 | 47 | 1 | 3 |

The five parsed AST movers without comments remain the highest-signal
acceptance review queue. Focused parser coverage now pins the riskiest
recognition claims; this is evidence for classification, not permission to move
the oracle baseline casually.

| entry | current AST surface | classification |
| --- | --- | --- |
| `node_modules/@less/test-data/tests-unit/color-functions/modern.css` | Parses as a `Stylesheet`. | Newer valid CSS expected-output fixture accepted by the Less AST grammar. `packages/syntax/less/less-parser/test/ast-grammar.test.ts` now pins relative-color style `rgb(from ...)` / `oklch(from ...)` values as ordinary function calls with nested `calc(...)` operation facts. |
| `node_modules/@less/test-data/tests-unit/container/container.css` | Parses as a `Stylesheet`. | Valid CSS expected-output fixture. This reflects `@container` acceptance; existing Less parser container coverage remains the focused sentinel before baseline movement. |
| `node_modules/@less/test-data/tests-unit/plugin/plugin.css` | Parses as a `Stylesheet`. | Valid CSS output fixture and plugin-scoping sentinel. Keep dialect-owned function registration tests green before any baseline move. |
| `node_modules/@less/test-data/tests-unit/plugin-preeval/plugin-preeval.less` | Parses as a `Stylesheet`. | Plugin pre-eval Less fixture reaches the AST route. `packages/syntax/less/less-parser/test/ast-grammar.test.ts` now pins the parser-only surface: `Plugin`, detached-ruleset default, block-argument mixin call, custom-property interpolation, and trailing variable declaration. Function registration/eval behavior remains a separate plugin lane. |
| `packages/syntax/css/css-parser/test/css/atrule-unknown.css` | Parses as an opaque `@future` block. | Intended opaque at-rule ownership movement. Existing CSS/Less parser coverage pins the narrow unknown-at-rule shape as `OpaqueAtRuleBlock` with `rawBody`; do not widen it into a raw prelude/value capture. |

Diagnostic-only non-comment movers are large but less semantically ambiguous:
85 of the 95 non-comment common AST movers currently throw
`LessParseError` / `parse/syntax-error`, 3 throw
`LessInlineJavaScriptError` / `parse/unsupported-inline-javascript`, and 2 throw
`LessUnsupportedVariableNameError` / `parse/unsupported-variable-name`.

## Gained Corpus Entries

The corpus gained two upstream Less fixtures. They should be classified as
corpus growth, not as common-entry parser movement.

| entry | current AST surface | current CST | classification |
| --- | --- | --- | --- |
| `node_modules/@less/test-data/tests-unit/math-css-vars/math-css-vars.css` | Parses as a `Stylesheet` with 2 top-level rules. | Parses. | Upstream fixture sync. New expected CSS fixture for math functions with runtime CSS variables. |
| `node_modules/@less/test-data/tests-unit/math-css-vars/math-css-vars.less` | Parses as a `Stylesheet` with 2 top-level rules. | Parses. | Upstream fixture sync. Comment-bearing Less source for the same feature. |

## Comment-Bearing AST Movers

122 common AST movers contain `/* ... */` or `//` in the source. These are not
safe to wave through as "just comments," but comments remain parser trivia, not
AST leaves.

Path-level classification:

| set | count | parses | throws | current read |
| --- | ---: | ---: | ---: | --- |
| Bootstrap port Less | 4 | 4 | 0 | Large third-party fixtures; broad CST ownership plus comment/source attachment. |
| Less tests-config fixtures | 21 | 14 | 7 | Config fixtures with comments in expected CSS, source, or source-map/debug fixtures. |
| Less tests-error eval fixtures | 2 | 1 | 1 | Error fixtures where comments affect diagnostic/source ownership. |
| Less tests-error parse fixtures | 1 | 0 | 1 | Parser-error fixture with comments; diagnostic projection only. |
| Less tests-unit fixtures | 80 | 67 | 13 | Main comment/render corpus, imports, legacy expected CSS, mixins, selectors, and removed syntax. |
| CSS parser non-error fixtures | 11 | 10 | 1 | Focused CSS syntax fixtures; keep as conformance sentinels. |
| CSS parser error fixtures | 3 | 0 | 3 | Invalid CSS fixtures whose Less parse diagnostics moved. |

Same-state comment-erasure probe:

- The previous same-state comment-erasure probe covered 100 comment-bearing AST
  movers. It is superseded by the current 122-entry set and must be rerun before
  any baseline move.
- The old result remains directional evidence only: most comment-bearing
  movement was source/trivia ownership, not semantic AST payload. It is not a
  baseline proof, and it must not be used to justify preserving semantic
  comment nodes in grammar bodies.
- Next probe shape remains: replace each `/* ... */` and `// ...` comment with
  same-length whitespace, parse original and stripped source with the current
  AST parser, and compare a source/trivia/span-insensitive projection.

## CST-Only Movers

486 common entries move only on the CST surface. Current CST throws remain 0, so
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

1. the five parsed non-comment AST movers are covered or explicitly decided;
2. the syntax-error mover buckets are accepted as diagnostic-shape changes, not
   parser acceptances;
3. the two gained corpus entries are accepted as upstream fixture growth;
4. the current 122-entry comment-erasure probe is rerun and focused
   comment/trivia fixtures cover comment-only mixin bodies, declaration-value
   trailing comments, selector-boundary comments, and comments inside at-rule
   preludes;
5. CST-only movement is projected or minimized; and
6. `pnpm run check:macro`, `pnpm run verify:compose-integrity`, and
   `pnpm run verify:less-alpha` still pass on the same source state.

---

# 2026-07-30 — the gate was returning NO verdict; upstream fix opened

Measured on branch `oracle-oom-fix`, base
`a1c65be4dc88ff73d4bdad314d104f4987fecdfd` (`origin/dev`).
`parseman` **0.43.0**, resolved to
`<worktree>/node_modules/.pnpm/parseman@0.43.0/node_modules/parseman`.

## Not red — silent

Between the 2026-07-28 report above and this one, the gate stopped producing a
verdict at all. It did not go red: it exhausted an 8 GB heap and exited **134**
after **443.5 s**, never printing `digest complete`. `HANDOFF.md` describing it
as "red against the committed baseline" was accurate through 2026-07-28 and
became wrong on 2026-07-29 — a window of roughly one day.

## Cause: an exponential in the ORACLE, tripped by an alias in the CST

`parseman/oracle`'s `canonicalize` is value-semantic and its cycle guard is
**ancestor-only** (`path.delete(v)` on exit). That is deliberate and documented
("Sharing is not a cycle"), but it means a shared subtree is written once per
**path** that reaches it: a node referenced from two places at each of `d` levels
is written `2^d` times.

Commit `d10c7fd38` (2026-07-29, "Align AST selector branch shapes") added a
`children` property to every `CssCstNode` in
`packages/syntax/css/css-parser/src/cst.ts`, holding the *same array object* as
`rules`. Every subtree became reachable under two keys.

Measured on a **351-byte** fixture
(`bootstrap-less-port/less/mixins/_nav-divider.less`, `cst` surface):

| metric | value |
| --- | ---: |
| distinct reachable objects | 420 |
| canonicalize visits | 466,737 |
| max visits to a single node | 8,192 (2^13) |
| canonical text | 18,096,813 chars |

Corpus-wide the worst entry reached **344,407,954** chars
(`bootstrap-less-port/less/mixins/_forms.less`), and ~25 bootstrap entries threw
`RangeError` from `out.join()` past V8's maximum string length. `digestCorpus`
compounded it by retaining every entry's full canonical text for the whole run
(only a stride-32 sample is ever re-read), so hundred-megabyte strings
accumulated — that is what turned a slow digest into a 4 GB OOM.

### The soundness hole this exposed

Those `RangeError`s were **caught by `payload()` and counted in `threw`**.
`payload` canonicalised inside the same `try` that guarded the parse, so the
projection failing to answer was tallied as a grammar rejection. The floor gate
for the four-grammar rewrite could report its own breakage as a grammar change.
That is the most dangerous finding here and it is independent of this incident.

## Where the fix landed: upstream, not jess

parseman PR **#100** (`release/0.45.0-oracle-digest`), opened not merged:

- **streamed digest** — `digestInto(target, value, prefix?)` pushes canonical
  tokens at a caller-supplied hash; no string is ever materialised, so there is
  no maximum-string-length ceiling;
- **digest failures propagate** instead of being counted in `threw`;
- **`CanonicalBudgetError`** — a named refusal past a visit budget, instead of an
  unattributed OOM;
- `digestCorpus` retains 64 hex chars per entry instead of every canonical text.

Byte-neutrality is the whole safety argument and is proven three ways:
`PINNED_HARNESS_DIGEST` unchanged (`e542b69ede393b0c…`); a direct
`digestValue(v, p) === hash(p + canonicalize(v))` assertion over every canary
shape; and an end-to-end A/B of parseman 0.43.0 against the new build over **624
real Less files × 2 surfaces — 1,248 fingerprints, 0 mismatches**, both
aggregates identical, `compareReports` verdict `identical`, at 1.27 s vs 2.46 s.

### Streaming fixes memory, NOT time

On the unmodified tree the streamed build no longer OOMs, but it still does not
reach a verdict — it refuses at the visit budget after 134.9 s (peak RSS 686 MB,
down from 4.17 GB), and with the budget disabled it was still running after 25
minutes, when it was stopped rather than left to finish. The `2^depth` work is
unchanged. Three remedies exist; only together do they answer:

1. PR #100 — necessary, not sufficient.
2. Remove the `rules`/`children` aliasing in the CST — fixes this instance.
3. Dedupe by node identity in `canonicalize` — fixes all DAGs, but rewrites the
   byte stream for every shared value, moves `PINNED_HARNESS_DIGEST`, invalidates
   every committed baseline, and is a `DIGEST_FORMAT` 1→2 owner decision.

## Verdict: `moved` (exit 1)

Obtained with the CST aliasing removed, which is the only configuration in which
the gate currently answers. The AST surface does not go through
`buildCssCstNode`, so its numbers hold on the pristine tree unconditionally.

```
corpus entries: 714
surface ast: aggregate=67fdc10e4f5c45579eb073a89494a7d547154a217bc0cf6ae871e1d97d35aa3b threw=122
surface cst: aggregate=aca610ec5bd27ec45422b8da978c54890a0768e49e73b4938604a4760303eea2 threw=0

! ast  309d91e177887c6a… -> 67fdc10e4f5c4557…  threw 120 -> 122  (709 entries moved)
! cst  7819745e63032253… -> aca610ec5bd27ec4…  threw 0 -> 0      (709 entries moved)
corpus GAINED 5 entries
```

The `cst` aggregate above is the alias-removed value; with the alias present the
`cst` surface moves too, by strictly more. Either way the move is real.

### Mover set by named entry class

**Universal** — every shared entry moves on **both** surfaces, **zero** unchanged.
A sharp change from 2026-07-28 (217 AST / 634 CST), and the signature of a global
node-shape or serialization change rather than a localized grammar diff.

| entry class | ast moved | cst moved |
| --- | ---: | ---: |
| `@less/test-data/tests-unit` | 283 / 283 | 283 / 283 |
| `@less/test-data/tests-config` | 131 / 131 | 131 / 131 |
| `@less/test-data/tests-error` | 99 / 99 | 99 / 99 |
| `bootstrap-less-port` | 90 / 90 | 90 / 90 |
| `packages/syntax/css` | 86 / 86 | 86 / 86 |
| `packages/jess/test` | 20 / 20 | 20 / 20 |
| **total shared** | **709 / 709** | **709 / 709** |

AST throws 120 → 122; CST throws 0 → 0.

### Gained corpus entries (5, none removed)

- `tests-error/eval/percentage-css-var.less`
- `tests-unit/at-rule-variable-deprecated/at-rule-variable-deprecated.{less,css}`
- `tests-unit/math-css-vars/math-css-vars.{less,css}` (already recorded 07-28)

### Next step

A universal move with zero unchanged entries means the baseline is stale against
a global shape change, not that one grammar edit regressed. Once #100 lands and
the CST aliasing is resolved the gate runs in ~2 s, which makes a bisect over the
2026-07-27 → 2026-07-30 window (388 commits, ~9 steps) cheap. Do that before
revisiting the Baseline Rule above.

## Separate cleanup: the `rules`/`children` alias

Not the OOM fix, and it must not be described as one — but worth doing on its own
merits. `rules === children` on all 40,908 nodes of a single parse is a wasted
slot, flagged independently by the node-census lane.

Consumer sweep (this lane, partial): `CssCstNode.children` has **no in-repo
reader**. `packages/diagnostics-core/src/tolerant-cst.ts` reads `node.rules` via
`cstChildrenOf`; every `.children` hit in `packages/editor/language-service` is
LSP `DocumentSymbol.children`, unrelated. The four `cst-public.test.ts` suites
were not swept and must be before the key is deleted.

Keep **`rules`**, delete `children`: the key NAME is part of the canonical stream,
so keeping `rules` reproduces the pre-alias bytes, while keeping `children` would
move the `cst` aggregate a second time for no benefit.

Do **not** implement this with `Object.defineProperty`. `buildCssCstNode` builds
40,908 nodes per parse and was measured at 32.3% of the CSS process; a per-node
runtime call plus a non-default property descriptor risks dictionary-mode objects
and could erase the 1.98×–2.08× full-CST-parse win measured by the sibling lane.
Delete one key; do not hide it.
