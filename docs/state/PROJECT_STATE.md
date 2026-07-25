# Project State

This file is lightweight startup memory for Cursor/debugging sessions. It should
not become a running work log.

For repo-wide rules, read `AGENTS.md`. For the active architecture roadmap, use:

- `docs/architecture/core/HANDOFF.md`
- `docs/architecture/core/AGGRESSIVE-CUTTING-REVIEW.md`
- `docs/architecture/parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`
  (parser dialect re-base + error-coverage program)
- `docs/perf/V8-ARCHITECTURE.md` (hot-path invariants + regression fixtures)

(`PERFORMANCE-HANDOFF.md` was listed here until 2026-07-24 and does not exist.)

## Package Build Shape

If package B depends on package A, build A before testing B against local
changes.

Common dependency shape:

- leaves: `@jesscss/awaitable-pipe`, `@jesscss/shared`,
  `@jesscss/patch-css`, `@jesscss/style-resolver`, `@jesscss/config`
- core/parsers: `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, `@jesscss/fns`
- app/plugins: `@jesscss/parser`, `@jesscss/jess-plugin`,
  `@jesscss/plugin-node-modules`, `@jesscss/jess-plugin-less`,
  `@jesscss/jess-plugin-scss`, `@jesscss/jess-plugin-less-compat`,
  `@jesscss/language-service`, `@jesscss/jess`

Practical example: after changing `packages/core`, build core before running
Jess package fixture tests that import `@jesscss/core` from built output.

```sh
pnpm --filter @jesscss/core build
```

## Verification Commands

Use focused tests first while iterating.

Baseline for the current core/parser/Less fixture surface:

```sh
pnpm run verify:baseline
```

Core package:

```sh
pnpm --filter ./packages/core test -- --run
pnpm --filter ./packages/core exec tsc -p tsconfig.build.json --noEmit
```

Less fixture authority:

```sh
pnpm run test:less:test-data
```

The only fixture-backed Less integration authority in
`packages/jess/test/less` is `all-less.test.ts`. Treat other targeted Less test
files as suspect unless their expectations have been revalidated against
upstream Less test-data, Less.js behavior, or a documented Jess-specific
contract.

## Known-red baseline (measured 2026-07-24 on `93e1aa49d`)

Measured in a clean worktree after `pnpm install --frozen-lockfile` and
`pnpm run build:release`. **Baseline before blaming your own change** — every
item below is pre-existing on clean `dev`. Re-measure and update this block
rather than leaving it to rot; delete a row when it goes green.

**Record the SET, not the count.** Every entry below names its cases. A count you
inherited from a doc is not a baseline: it cannot tell you whether a red moved,
and it goes stale silently. Capture your own named set before you change anything.

### `pnpm run verify:baseline` — RED

Stops at `verify:node-copy-frontier`, on `packages/jess-plugin-js/src/runtime-worker.ts`'s
`unit.clone()` in `unitOf`. Pre-existing.

### `pnpm run verify:types` — RED, 1 diagnostic

```
packages/less-parser/src/ast/grammar.ts(1916,7): error TS2339:
  Property 'CssAstSyntaxUnicodeRange' does not exist on type
  'LessAstLocalRules & { … } & SharedCssAstSyntax'.
```

21 of 22 configs pass; only `@jesscss/less-parser` fails. Introduced with
`c1782031e` (unicode-range as one token). This blocks
`release:alpha:preflight`, which runs `verify:types`.

### `pnpm --filter jess test` — 15 failed / 739 passed / 4 skipped / 79 todo

Last measured on `13725f894`; **not re-measured on `93e1aa49d`**. (Invocation note:
`pnpm --filter jess test --run` fails with `Unknown option: 'run'` — pnpm eats the
flag. Pass it through: `pnpm --filter jess test -- --run`.)

Four red files:

| File | Failing | Shape |
| --- | --- | --- |
| `test/less/all-less-error.test.ts` | 9 | `tests-error/eval/` cases Jess does not error on: `detached-ruleset-5`, `functions-5-color-2`, `mixin-not-matched`, `mixin-not-matched2`, `namespace-property-not-found`, `namespace-variable-not-found`, `namespacing-2`, `namespacing-4`, `property-undefined` |
| `test/security-script-runtime.test.ts` | 4 | All four are Less `@plugin` cases. `161fe9709` removed the blocking `@plugin` FIFO channel as a deliberate BEHAVIOUR CHANGE; these expectations have not been reconciled to it. |
| `test/less/bootstrap-clean-repro.test.ts` | 1 | `renders and collects rejections` |
| `test/less/ruleset-merge-regression.test.ts` | 1 | `evaluates chained ruleset mixins with property merge values` |

Two `all-less-error` cases are `skip`ped in-source because they hang the
worker: `recursive-property.less` and `recursive-variable.less` (recursive
definition not detected, should error).

### `pnpm run test:less:test-data` — 106/108 (was 108/108 on `13725f894`)

**The jess side did not change. The external fixture corpus moved.** These
fixtures live in `~/git/oss/less.js/packages/test-data`, a checkout this repo
does not pin, and less.js `dded69cc` graduated four of them to their v5
numeric-precision values ahead of the jess-side landing. Both reds are
expected-until-precision-lands, not regressions:

| Case | Expected (v5) | Current jess output |
| --- | --- | --- |
| `tests-unit/css-3/css-3.less` | `rotate(-0.0000000001deg)` | `rotate(0deg)` |
| `tests-unit/variables/variable-advanced.less` | `add-px-2: 393.3527559px` | `393.35275591px` |

**A Less-corpus number is only meaningful together with the less.js checkout
SHA.** Record both, or the count is unfalsifiable.

`all-less > extend-exact.less` was reported flaky in 1 of 4 full-suite runs on
2026-07-24 and deterministic in focused runs; it passed in this run. That flake
is now understood to be **real cross-compile state contamination**, not test
flakiness — see the OPEN DEFECTS section of
`docs/architecture/core/HANDOFF.md` for the two sharing channels and the
constraint on any fix. A separate session owns it.

### Green

- `test/scss/bootstrap-corpus.test.ts` — green (98 tests) as of `13725f894`.
  Ratchet floors in source are `PARSE_PASS_FLOOR = 29` and `EVAL_PASS_FLOOR = 0`
  (`packages/jess/test/scss/bootstrap-corpus.test.ts:201`), with
  `PASSING_EVAL_ENTRIES` still empty. Raise the floors as the SCSS model
  improves; never lower them without an owner decision recorded in
  `CORPUS-REPORT.md`. These two floors are count-based baselines and are on the
  list to become named sets.
- `node scripts/verify-parser-runtime-boundary.mjs --require-clean` — 0 tracked
  temporary sites.

### Build note

A stale `internal-css-recognition` build masks real failures. Rebuild the
workspace before trusting any count; a partial build makes the `all-less`
number bogus.

## Current Focus

No active debugging focus is recorded here.

**Before starting anything, read the WORK IN FLIGHT table at the top of
`docs/architecture/core/HANDOFF.md`.** Several lanes have a live agent or branch
on them as of 2026-07-24 (parseman `0.34.0` adoption, gate classification, the
fns per-dialect registry, and the numeric-precision landing). Coordinate rather
than duplicating one.

For current implementation work, use the active handoffs listed at the top of
this file. When a debugging session starts, fill in only these fields and delete
them again once the issue is closed:

- Area:
- Focused baseline:
- Last thing tried:
- Result:
- Next step:

Do not paste long failure logs or old session history into this file. Keep that
material in issue comments, archived notes, or git history.
