# Next parseman bump: 0.52.0

jess stays on the published `parseman@^0.51.2` until 0.52.0 is on npm, so CI
keeps installing a real registry version. This file is the follow-up patch,
written out so it lands in one commit the day 0.52.0 publishes. Delete this
file in that commit.

- Release PR: https://github.com/matthew-dean/parseman/pull/146
  (branch `release/0.52.0-attempt-contain`, parseman `feat/attempt-contain`
  9130117 on top of the 0.51.2 main, plus the release commit)
- What it carries for jess: `attempt(parser, { contain: true })`, `firstSetOf()`
  resolving through `attempt()`, `node({ trailingTrivia: true })` without the
  forced trivia capture, and the per-`trivia()` labeled-arm spec. See the
  parseman CHANGELOG 0.52.0 section for the measured numbers.

Check first: `npm view parseman version` prints `0.52.0` (or later).

## 1. Range bump

`^0.51.2` → `^0.52.0` at all six sites, then `pnpm install` to refresh
`pnpm-lock.yaml` (both `parseman@0.51.2` entries move to `0.52.0`):

| File | Field |
| --- | --- |
| `package.json` | `devDependencies` |
| `packages/parser-shared/package.json` | `dependencies` |
| `packages/syntax/css/css-parser/package.json` | `dependencies` |
| `packages/syntax/less/less-parser/package.json` | `dependencies` |
| `packages/syntax/scss/scss-parser/package.json` | `dependencies` |
| `packages/syntax/jess/jess-parser/package.json` | `dependencies` |

The compiled parsers are version-locked to the parseman that built them, so
rebuild all four parser packages after the install, not just Less.

## 2. The one-line Less change

Contain the nested-rule selector's commitment, so a glued `<ident>:` head whose
pseudo-function argument fails as a selector falls through to the declaration
(css-syntax-3 §5.4.4; ledger P44, jess#304). `attempt` is already imported in
the Less grammar.

```diff
--- a/packages/syntax/less/less-parser/src/grammar.ts
+++ b/packages/syntax/less/less-parser/src/grammar.ts
@@ const lessGrammarFactory = (g: LessInputRules & SharedSyntax) => {
   const NestedRulesetWithExtends = node(
     'Ruleset',
-    sequence(relativeSelectorListWithExtends, optional(g.MixinGuard), literal('{'), blockBody, optional(g.Call), literal('}'), optional(literal(';'))),
+    sequence(attempt(relativeSelectorListWithExtends, { contain: true }), optional(g.MixinGuard), literal('{'), blockBody, optional(g.Call), literal('}'), optional(literal(';'))),
```

The same hunk is saved as `scratchpad/wf11/less-contain.patch` in the session
scratchpad that prepared this; it applies to `feat/less-v5-completion`
0516ba2e6 with a one-line offset (`git apply --check` clean).

Measured on the parseman `feat/attempt-contain` build (marginal instructions,
r=7, interleaved): less-ast `benchmark.less` +0.02% (paired +0.03%),
less-ast `bootstrap.css` -0.00%, less-cst `benchmark.less` +0.06%, less-ast
3,000 nested rules -0.03% (+5.98% before the parseman first-set fix), less-cst
3,000 nested rules +0.76% (paired +0.39%). The Less oracle is identical
(860 entries) and error messages are unchanged or better
(`a { li:not(.b { … } }` reports the missing `)` at 11 instead of an
unexpected token at 6). Re-measure on the published 0.52.0 before landing.

## 3. Drop the four glued pins in `test/css-superset-corpus.ts`

With step 2, each of these parses in Less, so its pin fails. Remove
`brokenIn: ['less']` and `defect: GLUED_SELECTOR_FUNCTION_DEFECT` from:

| id | source |
| --- | --- |
| `glued colon before a selector-named function` | `a { b:is(c /d/ e) }` |
| `glued colon before local() with slashes` | `@font-face { src:local(Foo/Bar/Baz) }` |
| `glued colon before a selector-named function with a selector list` | `.x { a:not(b, c /d/ e); f: g; }` |
| `glued colon before local() with a string` | `@font-face{src:local('Foo')}` |

Then:

- delete the `GLUED_SELECTOR_FUNCTION_DEFECT` constant and its comment (no
  other user);
- in `NESTED_GLUED_SELECTOR_FUNCTION_DEFECT` (the SCSS / .jess pins, which
  stay), replace "Same cause as the Less pins." with a sentence saying Less
  fixed it by containing the nested-rule selector, and "(parseman
  `attempt(…, { contain: true })`, unreleased)" with "parseman 0.52.0".

## 4. Records to update in the same commit

- `docs/architecture/core/DESIGN-DECISIONS.md` P44: "waits on a parseman
  release" → implemented, with the commit.
- `docs/architecture/core/DESIGN-DECISIONS.md` F12: "parseman
  feat/attempt-contain 5740595 (unreleased)" → "parseman 0.52.0".

## 5. Verify

```sh
pnpm install
for p in css less scss jess; do pnpm --filter "@jesscss/$p-parser" build; done
for p in css less scss jess; do
  (cd packages/syntax/$p/$p-parser && pnpm exec vitest run test/css-superset-constructs.test.ts)
done
(cd packages/syntax/less/less-parser && pnpm test)
(cd packages/jess && pnpm test test/less)
```

The parser packages build serially (`build:release` is racy). Commit with a
`Perf-AB:` trailer from the jess harness in `docs/perf/BENCHMARKS.md`.
