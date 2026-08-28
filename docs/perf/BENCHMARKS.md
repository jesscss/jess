# Perf benchmarks — the canonical index

**Read this before writing or searching for a perf harness.** These are the
standard perf tests and where the historical data lives. Do not invent a new
harness; extend one of these. (Memory: "NEVER invent a harness.")

North-star goal: **Less alpha (jess) parses at Less 4.x speed** — the perf-gate
ratio `jess ÷ lessc-4.x` on `benchmark.less` is the headline number.

---

## TL;DR — the four standard commands

| Want | Command | Measures |
|---|---|---|
| **jess vs Less 4.x / PostCSS / dart-sass** (parse) | `pnpm run perf:gate:report` | jess parse time as a RATIO vs each reference parser, on `benchmark.less`. THE headline "vs 4.x" number. |
| **jess render hot-path** | `pnpm run measure:less:hotpath` (add `:record` to save) | jess render (eval+emit) median per fixture, tests-unit fixtures. |
| **jess vs an OLD jess commit** (parse) | `pnpm run perf:ab:prepare <commit>` then `pnpm run perf:ab:compare --case benchmark.less` | current worktree vs `~/git/worktrees/jess/bench-b` parked on `<commit>`; bias-controlled ratios. |
| **jess parser parse-bench** | `pnpm run bench:jess:parse` (`:record` to save) | raw jess-parser parse throughput. |

All four are jess-side; `perf:gate:report` is the only one that compares against
**other engines** (lessc 4.x etc.). None needs a network fetch except the
optional postcss-preprocessors extra (below).

---

## 1. perf-gate — jess vs reference parsers (THE "vs 4.x" harness)

- Run (report, never fails): `pnpm run perf:gate:report`
  (= `PERF_GATE=report node scripts/perf-gate/index.mjs --force-tier=full`)
- Enforce mode gates a ratio and is **shipped DISABLED** (`PERF_GATE=off` default) — owner-enabled only. See `docs/perf/PERF-DRIFT-GATE.md`.
- Comparators: `scripts/perf-gate/comparators.mjs` — **`lessc-4.x`** (parse-only), **`postcss`**, **`dart-sass`**. Each documents what it does NOT do vs jess (trivia/provenance/structure).
- Gated corpus/cases: `scripts/perf-gate/measure.mjs` — includes `packages/jess/benchmark/benchmark.less`.
- Committed baseline: `docs/perf/perf-drift.baseline.json` (propose a new one with `pnpm run perf:baseline:propose` → writes `.baseline.json.new`; never hand-edit the live file).
- Why a ratio, not ms: a ratio survives machine/noise differences; absolute ms does not.

## 2. measure:less:hotpath — jess render timing

- Run: `pnpm run measure:less:hotpath` (measure only) / `pnpm run measure:less:hotpath:record` (save + compare to latest).
- Script: `scripts/measure-less-hotpath.mjs`. Fixtures (default): `tests-unit/{functions,import/import-reference,mixins-guards,extend-chaining,media}` from the `@less/test-data` corpus. Override with `--fixture <rel>`; other flags: `--iterations N`, `--save`, `--history <file>`, `--compare-latest`.
- History file: `docs/perf/node-copy-reduction/less-hotpath-history.jsonl` (append-only via `--save`).
- Reports a stability `signal` (usable/unstable) per fixture — quote it; a contended machine reads "unstable".

## 3. perf:ab — jess vs an older jess commit (cross-worktree)

- Harness: `scripts/perf-ab/ab-worktree.mjs`. Side A = current worktree; side B = the **semi-permanent** worktree `~/git/worktrees/jess/bench-b`.
- Setup once: `git worktree add ~/git/worktrees/jess/bench-b <old-commit>` (the harness `prepare` re-parks and builds an EXISTING bench-b; it does not create it).
- Then: `pnpm run perf:ab:prepare <old-commit>` → `pnpm run perf:ab:compare --case benchmark.less`.
- Cases (`CASE_SPECS`): `benchmark.less`, `test-data-unit`, `css-corpus`, `test-data-css`. The less bench is PARSE-only (`.../less-parser/test/parse-bench.mjs`).
- Reports RATIOS to control constant cross-worktree bias (memory: "Cross-worktree bias").
- Known snags when comparing across months: (a) `buildAndProve` builds parsers before `@jesscss/core`, so an old checkout fails with `Cannot find module '@jesscss/core/ast'` — build `parser-shared`, `awaitable-pipe`, `core` first, by hand, in bench-b; (b) it refuses when in-repo corpus provenance differs between commits.

## 4. bench:jess:parse — jess parser throughput

- Run: `pnpm run bench:jess:parse` / `pnpm run bench:jess:parse:record`.
- History file: `docs/architecture/parser/parseman-jess-parse-benchmarks.jsonl` (this is the long-running jess **parse** history — the "old perf data").

---

## Fixtures (the standard inputs)

- `packages/jess/benchmark/benchmark.less` (104KB) + `benchmark.css` (expected) — the main perf fixture. EXEMPT from byte-identity gates.
- `~/git/oss/less.js/packages/test-data/tests-config/3rd-party/bootstrap4.less` — the bootstrap corpus (the jess `bootstrap-*` tests render `bootstrap-less-port` from node_modules for correctness/memory, not timing).
- `packages/jess/benchmark/gen-workload.less` / `.scss` (large generated) + `gen-workload.mjs` to regenerate.
- The `@less/test-data` corpus (links to `~/git/oss/less.js/packages/test-data`) — the tests-unit fixtures used by measure:less:hotpath.

## Historical / baseline data (the "old perf data")

| File | What |
|---|---|
| `docs/architecture/parser/parseman-jess-parse-benchmarks.jsonl` | jess parse-bench history over commits |
| `docs/perf/perf-drift.baseline.json` | committed perf-gate ratio baseline |
| `docs/perf/node-copy-reduction/less-hotpath-history.jsonl` | render hot-path history (seed with `measure:less:hotpath:record`) |
| `packages/jess/benchmark/import-placement-multiple/baseline-*.json` | import-placement parse/render baselines |

## Also present (situational, not the standard four)

- `packages/jess/benchmark/css-processors.mjs` — jess vs **Stylis** (CSS core). `pnpm --filter jess benchmark:css-processors`.
- `packages/jess/benchmark/postcss-preprocessors.mjs` — vs the postcss/benchmark preprocessor workload; needs an upstream `git clone https://github.com/postcss/benchmark` checkout (`--upstream=<path>`).
- `pnpm run compare:less:builds` — compares two jess less-plugin builds (not vs lessc).

---

Measurement discipline: report the `signal`/rsd; a machine running other dev
servers reads "unstable" and those ms are indicative only. Prefer ratios.
See `docs/perf/V8-ARCHITECTURE.md` for the invariants a perf change must hold.
