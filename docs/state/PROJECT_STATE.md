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

Regenerate this list rather than trusting it — it carried five wrong names until the
2026-07-30 docs audit, including `@jesscss/parser`, which does not exist:

```bash
node -e "const fs=require('fs'),path=require('path');
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules')continue;
const p=path.join(d,e.name); if(e.isDirectory()){
if(fs.existsSync(path.join(p,'package.json'))){const j=JSON.parse(fs.readFileSync(path.join(p,'package.json')));
console.log(j.name,'|',p,j.private?'(private)':'');} w(p);}}})('packages');" | sort
```

As of `facb641dd` (31 workspace packages, 9 `private`, 22 publishable):

- leaves: `@jesscss/awaitable-pipe`, `@jesscss/shared` (`packages/_shared`),
  `@jesscss/patch-css`, `@jesscss/style-resolver`, **`styles-config`**
  (`packages/config` — unscoped, deliberately)
- core/parsers: `@jesscss/core`, `@jesscss/parser-shared`, and the four parsers
  now under `packages/syntax/<lang>/`: `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, `@jesscss/jess-parser`;
  plus `@jesscss/fns`
- compiler/diagnostics: `@jesscss/compiler`, `@jesscss/compiler-preset`,
  `@jesscss/diagnostics-core`, `@jesscss/lint`
- app/plugins: `@jesscss/jess-plugin`, `@jesscss/plugin-node-modules`,
  `@jesscss/plugin-js`, **`@jesscss/plugin-less`**, **`@jesscss/plugin-scss`**,
  **`@jesscss/plugin-less-compat`**, **`@jesscss/plugin-jess`**,
  `@jesscss/language-service` (`packages/editor/language-service`), `jess`

*(Corrected 2026-07-30: the old list said `@jesscss/config`, `@jesscss/jess-plugin-less`,
`@jesscss/jess-plugin-scss`, `@jesscss/jess-plugin-less-compat` — none of which is the
declared `name` — and `@jesscss/parser`, which exists nowhere in the workspace. It also
omitted `@jesscss/plugin-jess`, `@jesscss/jess-parser`, and the compiler/diagnostics tier.)*

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

## Known-red baseline (measured 2026-07-24 on `e34bb24b3`)

Measured in a clean worktree after `pnpm install --frozen-lockfile` and
`pnpm run build:release`. **Baseline before blaming your own change.**
Re-measure and update this block rather than leaving it to rot.

**Record the SET, not the count.** A count cannot tell "nothing changed" apart
from "you fixed one and broke another" — both read as N. Since `c3db7e53e`
every pass/fail baseline in this repo is a named set; do not reintroduce a
count, and do not inherit one from a doc without re-deriving it.

### The gates are green on clean `dev` as of `c3db7e53e`

This block used to list `verify:types` and `verify:baseline` as pre-existing
reds. Both are fixed:

- `pnpm run verify:types` — **GREEN. The gate prints its own config count (25 at
  `facb641dd`); do not carry a number here — `22/22` was stale.** The `less-parser`
  `CssAstSyntaxUnicodeRange` diagnostic (introduced `c1782031e`) is gone.
- `pnpm run verify:baseline` — no longer stops at `verify:node-copy-frontier`.
  The `unit.clone()` in `jess-plugin-js/src/runtime-worker.ts` belongs to the
  sandboxed Deno `@plugin` worker's own local `Unit` class and is an attributed
  allowlist entry.
- `pnpm run verify:binding-lookup-hot-paths` — no longer needs ripgrep on PATH.
- `pnpm run check:macro` — repaired and wired (`064e3d985`).

**Treat a red gate as your own change breaking something.** That was not a safe
assumption before 2026-07-24; it is now.

### Where the named sets live

| Baseline | Named set |
| --- | --- |
| jess suite failures | `packages/jess/test/known-failures.json`, enforced by `scripts/vitest-ratchet.mjs` — fails on a NEW failure and equally on a listed test that starts passing or no longer exists |
| Less corpus expected failures | `expectedFailureFixtures` in `packages/jess/test/less/all-less.test.ts` |
| SCSS bootstrap corpus | named fixture sets (the former `PARSE_PASS_FLOOR` / `EVAL_PASS_FLOOR` counts) |
| conversion construct support | named construct sets per origin and per scope |
| AST shape stability | the named node-type inventory (the former `shapes.size >= 25`) |
| render-buffer frontier | two named sites, `For` and `While` (the former `=== 2`) |

The historical per-file jess failure breakdown that used to live here is
superseded by `known-failures.json`. Read the file.

### `pnpm run test:less:test-data` — 108/108 on `e34bb24b3`

Read that number carefully. `e34bb24b3` registered two fixtures as NAMED
expected failures, so the harness *asserts* they fail:

| Case | Expected (v5) | Current jess output |
| --- | --- | --- |
| `tests-unit/css-3/css-3.less` | `rotate(-0.0000000001deg)` | `rotate(0deg)` |
| `tests-unit/variables/variable-advanced.less` | `add-px-2: 393.3527559px` | `393.35275591px` |

Both are pending the numeric-precision landing. Because the map asserts the
failure, fixing precision will trip the entry and demand its own deletion.

`import-remote.less` is excluded from the alpha harness until remote URL import
loading has an explicit network/IO allowlist. It is tracked in
`docs/process/less-v5-release-plan.md`, not in `known-failures.json`.

**A Less-corpus number is only meaningful together with the less.js checkout
SHA** — the fixtures live in `~/git/oss/less.js/packages/test-data`, which this
repo does not pin. less.js `dded69cc` graduated four of them on 2026-07-24, and
that alone moved the suite from 108/108 to 106/108 with no jess-side change.

`all-less > extend-exact.less` was reported flaky in 1 of 4 full-suite runs on
2026-07-24 and deterministic in focused runs. That flake is **real
cross-compile state contamination**, not test flakiness — see the OPEN DEFECTS
section of `docs/architecture/core/HANDOFF.md` for the two sharing channels and
the constraint on any fix. A separate session owns it.

### Green

- `test/scss/bootstrap-corpus.test.ts` — green. Its former `PARSE_PASS_FLOOR` /
  `EVAL_PASS_FLOOR` counts are now named fixture sets (`c3db7e53e`). Add
  fixtures to the set as the SCSS model improves; never remove one without an
  owner decision recorded in `CORPUS-REPORT.md`.
- `node scripts/verify-parser-runtime-boundary.mjs --require-clean` — 0 tracked
  temporary sites.

### Build note

A stale `parser-shared` build masks real failures. Rebuild the workspace
before trusting any count; a partial build makes the `all-less` number
bogus.

## Current Focus

No active debugging focus is recorded here.

**Before starting anything, read the WORK IN FLIGHT table at the top of
`docs/architecture/core/HANDOFF.md`.** Several lanes have a live agent or branch
on them as of 2026-07-24 (gate classification, the fns per-dialect registry, and the
numeric-precision landing). Coordinate rather than duplicating one. *(The "parseman
`0.34.0` adoption" lane listed here is closed and was three floors stale: the repo is on
`^0.46.0` (after `75002c4a3` took it to `^0.45.0`).)*

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
