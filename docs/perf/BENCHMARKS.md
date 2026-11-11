# Perf benchmarks — the canonical index

**Read this before writing or searching for a perf harness.** These are the
standard perf tests and where the historical data lives. Do not invent a new
harness; extend one of these. (Memory: "NEVER invent a harness.")

**The metric that matters right now is TOTAL EVAL/RENDER time** (parse + eval +
serialize — the full `Compiler.render` path), not parse time alone. Parse speed
is a someday-concern; do not lead with the parse ratio. North-star: jess's total
render on `benchmark.less` at or near Less 4.x's total render.

Reference point (2026-11-11, `pnpm run measure:less:vs-lessc`, §2): a quiet
Ryzen 9 7940HS (16 threads) under WSL2 Ubuntu, load average 0.7–1.5, Windows
host CPU 2–7% idle and 10–13% during the run; jess `3cf36b5da` (`dev`) with
this harness, node 24.11.1, lessc 4.9.1. Marginal ms per compile, n 5 → 20,
median of 7 rounds (range); the ratio is the median of the per-round ratios, and
the A/A column times jess against itself in the same rounds. A second run
reproduced every ratio within 0.02.

| Fixture | Metric | jess | lessc | jess / lessc | A/A |
|---|---|---|---|---|---|
| `benchmark.less` | parse | 30.5 (27.2–32.6) | 12.1 (11.4–13.1) | 2.50× (2.21–2.69) | 1.01× (0.92–1.12) |
| | eval+render | 32.0 (29.2–34.6) | 48.8 (46.8–51.1) | 0.66× (0.57–0.71) | 1.00× (0.81–1.17) |
| | total | 61.7 (59.9–65.9) | 61.1 (59.1–63.4) | 1.01× (0.95–1.06) | 0.96× (0.91–1.06) |
| `bootstrap4.less` | parse | 67.3 (65.7–70.0) | 20.4 (19.5–20.6) | 3.36× (3.22–3.56) | 1.00× (0.96–1.05) |
| | eval+render¹ | 138.1 (134.5–139.2) | 119.0 (115.6–121.4) | 1.16× (1.13–1.19) | 1.01× (0.96–1.04) |
| | total | 204.5 (201.9–207.7) | 139.0 (136.0–142.0) | 1.48× (1.46–1.50) | 1.00× (0.99–1.03) |

¹ A `bootstrap4.less` render reaches `@plugin`, so jess runs it whole in the Deno
sandbox (`docs/design/DENO-SANDBOX-COMPILE.md`): Node's event loop is idle for
98.9% of it, against 0.9% for `benchmark.less`. Its total is the render as a
caller sees it; its eval+render subtracts a parse timed in Node from a render
timed in Deno.

Cold start on the same machine (`measure:cli:cold-start`, §7, median of 21
fresh processes, ms):

| Fixture | Arm | CLI | Load | First compile | Second compile |
|---|---|---|---|---|---|
| `benchmark.less` | jess | 420.2 | 100.9 | 317.2 | 153.6 |
| | lessc 4.9.1 | 260.6 | 44.6 | 189.6 | 112.1 |
| `bootstrap4.less` | jess | 854.0 | 105.3 | 754.1 | 289.5 |
| | lessc 4.9.1 | 423.1 | 44.5 | 331.7 | 224.4 |

Earlier reference point (2026-10-30, `8b62ab0c8`, parseman 0.55.2, node 24.11.1,
lessc 4.9.1, M-series at load ~7, so indicative), timed the same way by a driver
that was not committed:

| Fixture | Parse jess / lessc | Eval+render jess / lessc | Total jess / lessc |
|---|---|---|---|
| `benchmark.less` | 28.3 / 7.1 ms (4.0×) | 23.7 / 28.3 ms (0.78×) | 52.0 / 35.4 ms (1.42×) |
| `bootstrap4.less` | 60.8 / 9.7 ms (6.3×) | 250.5 / 71.5 ms (3.5×) | 311 / 81 ms (3.8×) |

Marginal instructions retired per compile point the same way: `benchmark.less`
1.03G / 0.76G (1.36×), `bootstrap4.less` 3.43G / 2.07G (1.66×). Then about half
of jess's `bootstrap4.less` wall time was idle, waiting on the worker that ran
the fixture's `@plugin` JavaScript one call at a time.

Reference point before that (2026-08-28, parseman 0.50.0, contended machine so indicative):
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
| **jess vs Less 4.x: parse, eval+render, total** | `pnpm run measure:less:vs-lessc` | jess and lessc interleaved in one process, marginal ms per compile with an A/A arm, on `benchmark.less` and the corpus `bootstrap4.less`. See §2. |
| jess vs Less 4.x / PostCSS / dart-sass (**PARSE only**) | `pnpm run perf:gate:report` | jess PARSE time as a ratio vs each reference parser. Parse only — not the priority metric right now; postcss/sass comparators must be installed to resolve. |
| jess vs an OLD jess commit (parse) | `pnpm run perf:ab:prepare <commit>` then `pnpm run perf:ab:compare --case benchmark.less` | current worktree vs `~/git/worktrees/jess/bench-b` parked on `<commit>`; bias-controlled ratios. |
| jess parser parse-bench | `pnpm run bench:jess:parse` (`:record` to save) | raw jess-parser parse throughput. |
| **per-grammar parse cost, CI-gated** | `pnpm run check:grammar-speed` | marginal instructions per AST parse for each grammar against `scripts/grammar-speed.baseline.json`. See §6. |
| **real SCSS parse cost**, AST and CST | `pnpm run bench:scss:real` (`--base <checkout>` for a before/after with A/A) | function calls and marginal instructions per pass over vendored Bootstrap and Foundation, with the generated `gen-workload` beside them. See §9. |
| **per-grammar artifact size + precompiled assembly, CI-gated** | `pnpm run check:grammar-artifacts` | bytes per source byte (parseman's 5× budget) and precompiled-assembly count per `lib/grammar/*.js`. See §6. |
| **CLI cold start** vs lessc 4.x | `pnpm run measure:cli:cold-start [--fixture bootstrap4] [--base <jess checkout>]` | spawn-to-exit CLI time, module load, first and second compile in a fresh process; every sample a new process, arms interleaved. See §7. |
| **how the page takes new variable values** (browser) | open `packages/patch-css/bench/write-strategy.html` in a browser; results print on the page and on `window.results` | ms per update for each way of writing custom properties, write plus the style and layout it forces, on 12,000 elements reading them. See §10. |
| **byte identity of a refactor** (not timing) | `pnpm run compare:less:builds -- --corpus --record .scratch/corpus-baseline.json` before the change, `... --corpus --baseline .scratch/corpus-baseline.json` after rebuilding | every corpus fixture × 6 output modes, compared by name. See §5. |

`measure:less:hotpath` is the canonical jess total-render harness, and with
`--vs-lessc` the total-render-vs-lessc harness. `perf:gate` is PARSE-only.

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
- **`--vs-lessc`** (`pnpm run measure:less:vs-lessc`) times jess against lessc 4.x in one process, per fixture:
  - parse is jess `Compiler.compile` (parse plus static imports) against `less.parse` (parse plus imports); total is `Compiler.render` against `less.render`; eval+render is total minus parse, per round.
  - Each value is the marginal ms per compile after warm-up, `(T(n2) − T(n1)) / (n2 − n1)`. Every round times each metric on three arms, jess, lessc and jess again (A/A), in an order that reverses each round. Defaults: n 5 → 20 (`--n1`, `--n2`), 7 rounds (`--repeat`), 10 warm-up compiles (`--warmup`).
  - Default fixtures are `packages/jess/benchmark/benchmark.less` and `bootstrap4`, the less.js corpus `bootstrap4.less` set up as `measure:cli:cold-start` sets it up (`math: 0` from its `styles.config.cjs`; lessc gets `math: 'always'` and `bootstrap-less-port` from `packages/less-corpus-fixture-deps` as an include path). `--fixture` adds others with lessc's default options.
  - It also prints the share of each render the event loop was idle (`performance.eventLoopUtilization`), which is where a render waits on another process, and each engine's output size. `--json` prints every round.
  - It records the commit, node, lessc version, CPU and load averages. On a shared host, record the host's load beside it. The result is the reference table at the top of this file. About 3 minutes for both fixtures on the machine above.

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
  - It fails on size growth, on lost assembly, and on any artifact over 5× or tables-only grammar that has no named debt entry. Size growth is any byte over the baseline: grammar source the change adds (comments included) does not buy generated bytes.
  - Over-5× debt applies only under the parseman version it was recorded with (`debtParseman`). Under any other version, every artifact must be within 5×.
  - Wins must be pinned with `--ratchet`, which never raises a ceiling.
  - Baseline: `scripts/grammar-artifacts.baseline.json`.
- **`check:grammar-speed`** (`scripts/grammar-speed-gate.mjs`) runs each grammar's own `test/parse-bench.mjs` under an instruction counter and takes the marginal per parse.
  - The fixtures are `benchmark.css` (CSS, and `.jess`, which has no committed `.jess` fixture large enough to measure), `benchmark.less` (Less) and `gen-workload` (SCSS, the committed generator's default output: generated, not real authoring; see §9).
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

## 8. Per-construct marginals — what they can and cannot decide

A per-construct marginal parses N copies of one small construct (`.r { color: red; }`, `.a .b > .c { }`, …) and takes `(I(N2) − I(N1)) / (N2 − N1)` instructions retired. Under `--jitless` it is stable and attributable. Under the JIT it measures inlining and tier-up decisions as much as the code under review. On one pair of identical builds, reviewing jesscss/jess#542, these swung it:

- **Source string shape.** A source built in-process with `String.prototype.repeat` is a cons string; a source read from a file is flat. CSS `.r { }` read +26% as a cons string and −1.8% read from a file. The same switch moved another harness from +22% to −6%.
- **Call-site structure.** Less `.r { w: 1px + 2px; }` read +0.5% when all sizes ran through one shared parse closure and +6.3% with a separate call site per size.
- **Size window.** SCSS `.r { }` read +3.4% for N 200 → 1200 and −35% for N 1200 → 2200.
- **Construct boundaries.** N rules with one declaration each and one rule holding N declarations are different constructs, and they move independently.

How to use it:

1. **Read sources from files.** A verdict never uses a repeated cons string (a `cons.mjs`-style in-process `.repeat`). Results from such a harness are not valid for a verdict.
2. **The verdict is whole files under both engines, every construct under `--jitless`, and the CI gates** (`check:grammar-speed`, `check:grammar-artifacts`).
3. **A per-construct JIT marginal within ±5% of `dev` is not a verdict either way.** Report it with its A/A spread and use it to find where to look. A larger per-construct JIT change has to be reproduced from flat file sources, and in a second size window, before it counts.

## 9. bench:scss:real — real SCSS parse cost

- Script: `scripts/bench-scss-real.mjs`, which runs `scss-parser/test/parse-bench.mjs`. Build `@jesscss/scss-parser` first. The fixtures are committed, so it needs no network.
- It measures parse only: compiling these libraries is tracked in jesscss/jess#591.
- It reports each library, their total and `gen-workload`, for AST and CST:
  - function calls per pass, from V8's precise coverage after one warm-up pass;
  - marginal instructions per pass, N 100 → 300 on the default runtime, median of 3.
- `--jitless` measures N 2 → 6 under the speed gate's flags. It is a diagnostic. `--base <checkout>` measures another built checkout in the same run, twice for an A/A; that checkout needs the fixtures and the bench. One arm takes about 5 minutes at a load average of 100.
- **Every file must parse whole, and a run refuses anything less.** It exits 1 and names the file. The CST entry reports a failed or partial parse in its result rather than throwing, so counting throws would miss it. The bench checks the result's `ok`, `errors` and `unconsumedFrom`, and that only trivia follows the end of each surface's span. The canary is in `scripts/__tests__/grammar-gates.test.mjs`.
- **The run refuses on a checkout without the SCSS parse fixes in jesscss/jess#580 to #594.** At `75fd9b87c`, 48 of the 92 Bootstrap files and 16 of the 113 Foundation files do not parse.
- **A pass is one parse per file, not one concatenated file**, because a compile parses each file on its own. Concatenating also changes the workload:
  - Foundation stops being valid input: its `@use "sass:color"` lands after rules, and the parse refuses it.
  - Bootstrap keeps its call count (−0.3% AST, −0.2% CST), but instructions rise 5.4% for AST and 54.5% for CST. The extra cost comes with file size and has not been attributed.
- **It is not in the speed gate yet.** A library row cannot be added until every file parses on `dev`. Under `--jitless` the two libraries cost 9.9G instructions per pass together, about 5G each against `gen-workload`'s 7.7G, so at the gate's 6 parses per row they add about 60G to a run of about 80G. That run's gate step takes about 3 minutes on CI, so it would take an estimated 5. No single process gets longer than the `gen-workload` one. That is cheap enough for a job off the critical path. To add them, put one `GRAMMARS` row per library in `scripts/grammar-speed-gate.mjs` and record each count from CI's output.

Reference point (2026-11-05, node 24.11.1, M-series at load averages of 80–280, hardware instructions retired, default runtime, N 100 → 300, median of 3, A/A within 0.3% except where noted). The tree is `e4f68db7a`, the top of those SCSS fixes, on parseman 0.59.0 before the arrow and with parseman 0.61.3's change (jesscss/jess#605) applied after it.

| Fixture | Surface | Calls | Instructions | Per KB |
|---|---|--:|--:|--:|
| `bootstrap-5.3.8` | AST | 6,012,195 → 5,577,779 (−7.2%) | 689.5M → 631.2M (−8.5%) | 2.1M → 2.0M |
| | CST | 6,733,533 → 5,708,870 (−15.2%) | 777.4M → 648.4M (−16.6%) | 2.4M → 2.0M |
| `foundation-6.9.0` | AST | 4,942,711 → 4,649,763 (−5.9%) | 581.9M → 543.8M (−6.5%) | 1.6M → 1.5M |
| | CST | 5,414,732 → 4,744,908 (−12.4%) | 626.8M → 545.9M (−12.9%) | 1.7M → 1.5M |
| Total | AST | 10,954,906 → 10,227,542 (−6.6%) | 1271.4M → 1175.0M (−7.6%) | 1.8M → 1.7M |
| | CST | 12,148,265 → 10,453,778 (−14.0%) | 1404.2M → 1194.3M (−15.0%) | 2.0M → 1.7M |
| `gen-workload` | AST | 8,353,040 → 7,681,657 (−8.0%) | 971.9M → 876.6M (−9.8%) | 3.5M → 3.1M |
| | CST | 9,273,262 → 7,959,568 (−14.2%) | 1697.2M → 1485.0M (−12.5%, A/A 1.45%, reps spread up to 14.6%) | 6.0M → 5.3M |

`gen-workload` costs 1.8 times what real SCSS costs per KB on AST, and 3.1 times on CST. The AST per-call cost is the same (about 115 instructions), so the difference is how much parsing each byte asks for. Its CST row is too noisy on the default runtime to carry a verdict.

## 10. Render marginals — what can resolve a few percent

`measure:less:hotpath` under an instruction counter, `(I(K2) − I(K1)) / (K2 − K1)` over `K` renders in a fresh process, does not resolve single digits on the standard fixtures at K 100 → 300. Two runs of one build on one machine (2026-11):

| Fixture | Same-build q25 | Same-build median | Paired rounds |
| --- | --- | --- | --- |
| `benchmark.less` | ±5% | ±5% | −23% to +30% |
| `k-plain`, a small file of plain rules (`.k1 { a: 1px; }`) | ±2% | ±5% | −8% to +9% |

The cause is that the number of mark-compacts in a process is not fixed. On `k-plain`, K 300 runs 3 or 4 of them, and one more is about +0.85G instructions, or about 5% of the marginal. It is the bimodal median above. Two builds with the same count agree to 0.04% (30.637G and 30.625G).

How to use it:

1. **To decide a few percent, use a small fixture of the shape under review**, where the code under review is most of the marginal, with interleaved arms. Run each build as two arms and report that same-build spread beside the result. A change smaller than that spread is not a result.
2. **Or compare only runs with the same mark-compact count**: record the count per process and take medians per count.
3. **Do not read a single-digit difference from `benchmark.less` or `k-plain` at K 100 → 300**, in either direction. They still catch a large change.

## 10. patch-css write strategy — how the page takes new variable values

`@jesscss/patch-css` writes a stylesheet's exposed variables (`set()` from a
`.less`/`.jess` module). The harness is
`packages/patch-css/bench/write-strategy.html`, a static page: open it in a
browser and read the table it prints, or `window.results`. The page has 3,000
cards, 12,000 elements, and every card reads ten custom properties, two of which
size its layout. Each sample writes one update and then forces style and layout,
so it times the write and the recalc that the write causes. The table shows the
median of 150 samples, with the median of three rounds taken per cell. Each
strategy changes the same variables in the same order.

Measured 2026-11-11 in Chrome 156 (the Claude desktop browser pane), in ms per update:

| Scenario | inline `setProperty`, every value | inline, changed values only | adopted sheet, `replaceSync` | adopted sheet, one rule's `style` |
|---|---|---|---|---|
| one variable changes | 6.0 | **5.9** | 7.0 | 7.0 |
| all ten change | **16.8** | 16.9 | 18.1 | 18.0 |
| nothing changes | 0 | 0 | 0.8 | 0 |
| five calls before a frame, written at once | 14.1 | 14.2 | 15.0 | 14.8 |
| five calls before a frame, merged into one write | 14.0 | 13.9 | 14.9 | 14.8 |

What it decided:

- **Write on the root's inline style.** It is the fastest strategy or tied for
  fastest in every row. An adopted sheet costs about 1 ms more per update, and
  `replaceSync` re-parses even when nothing changed. Each `--name` is declared
  once, on the root.
- **Write only the values that changed.** In Chrome this ties with writing every
  value, because Chrome already skips an inline value it already has. It is kept
  because it costs one map lookup and it does not depend on the engine skipping
  repeats.
- **Do not batch into an animation frame.** The browser already recomputes
  style once per frame, so merging five calls saves nothing (14.1 against 14.0)
  and it would make `set()` asynchronous.

A first run of the harness gave the same ordering. Rerun the page after any
change to how `writeVars` writes.

## Fixtures (the standard inputs)

- `packages/jess/benchmark/benchmark.less` (104KB) + `benchmark.css` (expected) — the main perf fixture. EXEMPT from byte-identity gates.
- `~/git/oss/less.js/packages/test-data/tests-config/3rd-party/bootstrap4.less` — the bootstrap corpus (the jess `bootstrap-*` tests render `bootstrap-less-port` from node_modules for correctness/memory, not timing).
- `packages/jess/benchmark/gen-workload.less` / `.scss` (large generated) + `gen-workload.mjs` to regenerate.
- `packages/jess/benchmark/scss-real/` — real SCSS, unmodified from the npm packages, each with its MIT `LICENSE`:

| SCSS fixture | Holds | Stands for |
|---|---|---|
| `bootstrap-5.3.8` | `bootstrap@5.3.8` `scss/`: 92 files, 321 KB | Declarative authoring: variables and maps, `@each` over a utilities map, heavy interpolation (2,094 `#{`, 1,043 `!default`), a thin mixin layer. One file, `_variables.scss`, is 77 KB. Line comments are 17% of the bytes. |
| `foundation-6.9.0` | `foundation-sites@6.9.0` `scss/` and `_vendor/sassy-lists`, which `foundation.scss` imports: 113 files, 372 KB | Control-flow authoring: 338 mixins, 60 functions, 592 `@if`/`@else`, 146 loops. Line comments are 38% of the bytes. The package's `test/sass` (sass-true assertions) and `docs/assets/scss` are left out as not library code. |
| `gen-workload` | Generated: 1 file, 281 KB | A worst case, not real authoring: 1,540 `@include` of 2 mixins in deep nesting with variable math, and no `@function`, `@if`, loop, interpolation, `!default` or comment. It suits a parser hot path, not a claim about real stylesheets. |

The copies don't follow `bootstrap` and `foundation-sites` in `packages/jess/package.json`, so a lockfile refresh can't move the benchmark. A new upstream version is a new directory and a new row. The two trees add 1.2 MB on disk and about 172 KB compressed.
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
