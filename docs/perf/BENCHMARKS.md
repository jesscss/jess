# Perf benchmarks — the canonical index

**Read this before writing or searching for a perf harness.** These are the
standard perf tests and where the historical data lives. Do not invent a new
harness; extend one of these. (Memory: "NEVER invent a harness.")

**The metric that matters right now is TOTAL EVAL/RENDER time** (parse + eval +
serialize — the full `Compiler.render` path), not parse time alone. Parse speed
is a someday-concern; do not lead with the parse ratio. North-star: jess's total
render on `benchmark.less` at or near Less 4.x's total render.

Reference point (2026-10-30, `8b62ab0c8`, parseman 0.55.2, node 24.11.1, lessc
4.9.1, M-series at load ~7, so indicative). Marginal per-compile time after
warm-up, jess and lessc interleaved in one process in alternating AB/BA rounds,
jess configured as `measure:less:hotpath` configures it. Parse is jess
`Compiler.compile` (parse plus static imports) against `less.parse` (parse plus
imports); eval+render is total minus parse. ¹ The file `bootstrap4.less` imports,
`bootstrap-less-port@0.3.0/less/bootstrap.less` from `packages/less-corpus-fixture-deps`,
rendered with the fixture's `math: 0`.

| Fixture | Parse jess / lessc | Eval+render jess / lessc | Total jess / lessc |
|---|---|---|---|
| `benchmark.less` | 28.3 / 7.1 ms (4.0×) | 23.7 / 28.3 ms (0.78×) | 52.0 / 35.4 ms (1.42×) |
| `bootstrap4.less`¹ | 60.8 / 9.7 ms (6.3×) | 250.5 / 71.5 ms (3.5×) | 311 / 81 ms (3.8×) |

Marginal instructions retired per compile point the same way: `benchmark.less`
1.03G / 0.76G (1.36×), `bootstrap4.less` 3.43G / 2.07G (1.66×). About half of
jess's `bootstrap4.less` wall time is idle, waiting on the worker that runs the
fixture's `@plugin` JavaScript. The driver that produced this table is not
committed: there is still no committed total-render-vs-lessc harness (TL;DR).

Earlier reference point (2026-08-28, parseman 0.50.0, contended machine so indicative):
jess total render of `benchmark.less` ≈ **42ms** vs lessc 4.6.3 ≈ **38ms** —
~10%, essentially parity within noise. (lessc renders `benchmark.less` FINE — it
is ordinary Less; there is no "v5-only" blocker. The perf-gate can't pair-time it
against lessc only because that fixture's `@import`s make lessc's parse async,
which is a harness limitation, not a syntax one.)

---

## TL;DR — the standard commands (total-eval first)

| Want | Command | Measures |
|---|---|---|
| **jess total render** (parse+eval+serialize) | `pnpm run measure:less:hotpath --fixture packages/jess/benchmark/benchmark.less` (or default tests-unit fixtures; `:record` to save) | jess full `Compiler.render` median per fixture. **THE priority metric.** |
| **jess total render vs Less 4.x** | measure jess as above; time lessc separately (`less.render` on the same file) and compare medians — there is no committed interleaved render-vs-lessc harness yet (gap; the perf-gate is parse-only). | end-to-end jess vs lessc 4.x. |
| jess vs Less 4.x / PostCSS / dart-sass (**PARSE only**) | `pnpm run perf:gate:report` | jess PARSE time as a ratio vs each reference parser. Parse only — not the priority metric right now; postcss/sass comparators must be installed to resolve. |
| jess vs an OLD jess commit (parse) | `pnpm run perf:ab:prepare <commit>` then `pnpm run perf:ab:compare --case benchmark.less` | current worktree vs `~/git/worktrees/jess/bench-b` parked on `<commit>`; bias-controlled ratios. |
| jess parser parse-bench | `pnpm run bench:jess:parse` (`:record` to save) | raw jess-parser parse throughput. |
| **per-grammar parse cost, CI-gated** | `pnpm run check:grammar-speed` | marginal instructions per AST parse for each grammar against `scripts/grammar-speed.baseline.json`. See §6. |
| **per-grammar artifact size + precompiled assembly, CI-gated** | `pnpm run check:grammar-artifacts` | bytes per source byte (parseman's 5× budget) and precompiled-assembly count per `lib/grammar/*.js`. See §6. |
| **CLI cold start** vs lessc 4.x | `pnpm run measure:cli:cold-start [--fixture bootstrap4] [--base <jess checkout>]` | spawn-to-exit CLI time, module load, first and second compile in a fresh process; every sample a new process, arms interleaved. See §7. |
| **byte identity of a refactor** (not timing) | `pnpm run compare:less:builds -- --corpus --record .scratch/corpus-baseline.json` before the change, `... --corpus --baseline .scratch/corpus-baseline.json` after rebuilding | every corpus fixture × 6 output modes, compared by name. See §5. |

`measure:less:hotpath` is the canonical jess total-render harness. `perf:gate`
is PARSE-only. There is no committed total-render-vs-lessc harness — that is a
known gap to fill when total-eval-vs-4.x becomes a focus.

---

## 1. perf-gate — jess vs reference parsers (PARSE-only; not the priority metric)

- Run (report, never fails): `pnpm run perf:gate:report`
  (= `PERF_GATE=report node scripts/perf-gate/index.mjs --force-tier=full`)
- Enforce mode gates a ratio and is **shipped DISABLED** (`PERF_GATE=off` default) — owner-enabled only. See `docs/perf/PERF-DRIFT-GATE.md`.
- Comparators: `scripts/perf-gate/comparators.mjs` — **`lessc-4.x`** (parse-only), **`postcss`**, **`dart-sass`**. Each documents what it does NOT do vs jess (trivia/provenance/structure).
- Gated corpus/cases: `scripts/perf-gate/measure.mjs` — includes `packages/jess/benchmark/benchmark.less`.
- Committed baseline: `docs/perf/perf-drift.baseline.json` (propose a new one with `pnpm run perf:baseline:propose` → writes `.baseline.json.new`; never hand-edit the live file).
- Why a ratio, not ms: a ratio survives machine/noise differences; absolute ms does not.

## 2. measure:less:hotpath — jess render timing

- Run: `pnpm run measure:less:hotpath` (measure only) / `pnpm run measure:less:hotpath:record` (save + compare to latest).
- Script: `scripts/measure-less-hotpath.mjs`. Fixtures (default): `tests-unit/{functions,import/import-reference,mixins-guards,extend-chaining,media}` from the `@less/test-data` corpus. Override with `--fixture <rel>`; select the writer explicitly with `--collapse-nesting true|false` (default `true`); set `JESS_LESS_TEST_DATA_ROOT` when a workspace's `link:` dependency does not resolve from the repository root; other flags: `--iterations N`, `--save`, `--history <file>`, `--compare-latest`.
- History file: `docs/perf/node-copy-reduction/less-hotpath-history.jsonl` (append-only via `--save`). Each new run records the real corpus root and package version, plus the corpus Git commit when it has a Git top-level distinct from the Jess checkout. Comparisons reject a conflicting recorded corpus identity while retaining compatibility with legacy records that predate those fields.
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

## 5. Corpus byte identity — proving a refactor changes no output

- Script: `scripts/compare-less-builds.mjs --corpus` (the same script's default mode is the paired one-fixture timing below). Test of the diff logic: `pnpm run test:compare-builds`.
- Renders every `.less`/`.scss`/`.sass`/`.jess` file in `packages/jess/test/{less,scss,jess,fixtures,files}`, the `@less/test-data` corpus (`tests-unit`, `tests-config`, which includes `3rd-party/bootstrap4.less`) and `packages/jess/benchmark/benchmark.less`, under `collapseNesting` `false` / `'native'` / `'compact'` × `compress` off / on. Build against build, not against goldens, so `benchmark.less` is included.
- Each fixture is recorded as the sha256 of its CSS (and source map) plus its error and warning codes; a render that throws is recorded by its error code. Before and after are compared as named sets per mode: added, removed and changed fixtures are listed by name, and any of them exits 1.
- One checkout: build, then `pnpm run compare:less:builds -- --corpus --record .scratch/corpus-baseline.json`; make the change, rebuild, then `pnpm run compare:less:builds -- --corpus --baseline .scratch/corpus-baseline.json`. `.scratch/` is git-ignored; baselines are not committed (they depend on the unpinned corpus checkout, whose commit the file records).
- Two builds: `--corpus --before-root <other checkout> [--after-root <dir>]`. Fixture inputs always come from the checkout running the script, so both builds render the same files.
- `--filter <regex>` narrows fixtures by name (a baseline is narrowed the same way); `--json` prints the diff. The corpus root is `$LESS_TEST_DATA_ROOT`, else `@less/test-data`, else `../less.js/packages/test-data`.
- A full run is about 6 s per build on an M-series laptop (359 fixtures × 6 modes).

## 6. Grammar gates — size and speed per grammar, enforced in CI

`check:grammar-artifacts` runs in the CI `verify` job; `check:grammar-speed` runs in its own parallel `grammar-speed` job, off the critical path. Their canaries are in `scripts/__tests__/grammar-gates.test.mjs` (`pnpm run test:grammar-gates`).

- **`check:grammar-artifacts`** (`scripts/check-grammar-artifacts.mjs`, about 1 s) reads every `lib/grammar/**/*.js` of the four parsers. For each one it records the bytes, the bytes per byte of `src/grammar.ts` and the number of precompiled functions in its `a: [{ factory }]` inventory.
  - It fails on size growth, on lost assembly, and on any artifact over 5× or tables-only grammar that has no named debt entry.
  - Over-5× debt applies only under the parseman version it was recorded with (`debtParseman`). Under any other version, every artifact must be within 5×.
  - Wins must be pinned with `--ratchet`, which never raises a ceiling.
  - Baseline: `scripts/grammar-artifacts.baseline.json`.
- **`check:grammar-speed`** (`scripts/grammar-speed-gate.mjs`) runs each grammar's own `test/parse-bench.mjs` under an instruction counter and takes the marginal per parse.
  - The fixtures are `benchmark.css` (CSS, and `.jess`, which has no committed `.jess` fixture large enough to measure), `benchmark.less` (Less) and `gen-workload` (SCSS, the committed generator's default output).
  - On Linux the counter is Valgrind's Cachegrind, because GitHub-hosted runners expose no hardware instruction counter. On macOS it is `/usr/bin/time -l`.
  - It runs V8's interpreter (`--jitless`). The script header gives the JIT measurements that ruled the JIT out on CI, and what the interpreter does not see.
  - The baseline (`scripts/grammar-speed.baseline.json`) records its environment: counter, platform, Node version and method. It is compared only under that environment. The CI job pins Node and passes `--require-env`.
  - A faster result must be banked with `--lower`. Raising a value is a reviewed edit. `--propose` writes `<baseline>.new` for a new environment.

## 7. measure:cli:cold-start — a one-file CLI run, jess against lessc 4.x

- Script: `scripts/measure-cli-cold-start.mjs`. Build first (`pnpm run build:release`).
- Every sample is a fresh `node` process. Per round it times `jess <fixture> <out>` and `lessc <fixture> <out>` spawn to exit (`cli`), then, in another fresh process, the imports the CLI needs to compile (`load`), the first compile and the second compile. It prints the median of `--runs` rounds (default 21), and the arm order alternates each round.
- `--fixture benchmark` (default) is `packages/jess/benchmark/benchmark.less`. `--fixture bootstrap4` is the less.js corpus `bootstrap4.less` with its `styles.config.cjs` (`math: 0`), resolving `bootstrap-less-port` from `packages/less-corpus-fixture-deps`; lessc gets `--math=always` and that package as an include path, so both compile the same sources.
- `--base <checkout>` adds another built jess checkout as an arm, for a before/after in one interleaved run.
- Reference point (2026-10-31, parseman 0.57.0, node 24.11.1, lessc 4.9.1, M4 Pro at load averages 4–8, so indicative), median of 21, ms:

| Fixture | Arm | CLI | Load | First compile | Second compile |
|---|---|---|---|---|---|
| `benchmark.less` | jess `98e132094` | 346.1 | 143.1 | 133.6 | 62.3 |
| | jess, dialect plugins loaded on demand | 236.7 | 62.6 | 141.9 | 64.7 |
| | lessc 4.9.1 | 138.3 | 23.0 | 92.4 | 49.9 |
| `bootstrap4.less` | jess `98e132094` | 695.8 | 147.4 | 480.7 | 299.4 |
| | jess, dialect plugins loaded on demand | 593.0 | 66.9 | 506.1 | 297.7 |
| | lessc 4.9.1 | 206.1 | 23.6 | 149.7 | 107.6 |

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
| `packages/jess/benchmark/import-placement-multiple/baseline-*.json` | import-placement parse/render baselines (historical; the harness that produced them measured the legacy tree engine and was removed with it) |

## Also present (situational, not the standard four)

- `packages/jess/benchmark/css-processors.mjs` — jess vs **Stylis** (CSS core). `pnpm --filter jess benchmark:css-processors`.
- `packages/jess/benchmark/postcss-preprocessors.mjs` — vs the postcss/benchmark preprocessor workload; needs an upstream `git clone https://github.com/postcss/benchmark` checkout (`--upstream=<path>`).
- `pnpm run compare:less:builds` — paired timing of one fixture across two jess builds (not vs lessc); with `--corpus` it is the byte-identity check in §5.

---

Measurement discipline: report the `signal`/rsd; a machine running other dev
servers reads "unstable" and those ms are indicative only. Prefer ratios.

**Counts when the machine is loaded: marginal instructions retired.** On macOS,
`/usr/bin/time -l` reports the process's `instructions retired`. Run the same
parse-bench with no warm-up at two sample counts and divide the difference by the
difference in parses: `(I(N2) − I(N1)) / (N2 − N1)`. Startup, module load and JIT
warm-up are paid by both runs, so they cancel. Run each side several times and
take the median.

```
BENCH_CASES=benchmark.less /usr/bin/time -l node packages/syntax/less/less-parser/test/parse-bench.mjs m 0 10
BENCH_CASES=benchmark.less /usr/bin/time -l node packages/syntax/less/less-parser/test/parse-bench.mjs m 0 40
```

parse-bench times both surfaces, so the quotient is one AST parse plus one CST
parse; `BENCH_SURFACES=ast` (or `cst`) times one, for a per-surface count. The
css-parser `test/parse-bench.mjs` takes the same two variables. Measured 2026-10-05 at load averages of 10–85, where interleaved
timings swung ±8% on identical libs:

- the spread across runs of one lib was under ±1%;
- a 0.7% difference reproduced between two libs.

To A/B two grammar builds, swap saved `lib/` snapshots into the package
directory, as the interleaved timing A/B does.
See `docs/perf/V8-ARCHITECTURE.md` for the invariants a perf change must hold.
