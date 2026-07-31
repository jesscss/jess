# CSS grammar tournament — the shared grading harness

**One harness, one set of numbers.** This exists because three lanes independently
measured "the artifact size" and reported three different figures for one file
(45,969,003 vs 45,471,349 B; 3,336,637 vs 3,336,650 B), and a size-attribution tool
mis-billed 86,574 B — 23.1% of the figure three lanes were aiming at — to the wrong
emitter. If each candidate builds its own grader, the tournament produces
incomparable numbers.

## The one command

```sh
node tools/grammar-tournament/scoreboard.mjs \
  --entry A=/abs/path/to/<worktree>/packages/syntax/css/css-parser \
  --entry B=/abs/path/to/<worktree>/packages/syntax/css/css-parser \
  --renames A=/abs/path/to/renames.json \
  --fuzz 2000 --seed 24221 --min-real 800 --bench
```

Each `--entry` is a candidate's **built** css-parser package. The harness snapshots
`lib/` and `src/` into `packages/syntax/css/css-parser/entries/<label>/` **inside this
repo** and measures only there — so no measurement ever crosses a worktree, and you
can keep working while a frozen snapshot is graded.

Verify the harness itself first:

```sh
node tools/grammar-tournament/selfcheck.mjs
```

## Submission contract

1. Build in your worktree: `pnpm --filter @jesscss/css-parser build`.
2. Confirm no interpreter fallback: `lib/grammar/*.js` must contain **no** runtime
   `from "parseman"` import, and `pnpm run check:macro` must report 0 fallbacks.
3. Send the absolute path to your `packages/syntax/css/css-parser`, plus a
   `renames.json` if you renamed node types.

## The pinned baseline

| | |
|---|---|
| repo | `origin/dev` @ `131cd9d1b` |
| parseman | **0.45.0** (`node_modules/.pnpm/parseman@0.45.0/...`) |
| rank artifact | `lib/grammar/ast.js`, raw, unminified, as tsdown emits |
| incumbent `ast.js` | **3,341,439 B** raw |

**Not 0.46.0.** The `release/0.46.0` lanes take the same artifact to 3,140,585 then
3,102,915 B on codegen changes alone. Neither number is wrong; comparing them without
labels is. Never cross-quote a tournament figure into goal-2 expansion-ratio tracking,
where the live number is on 0.46.0.

All four emitted artifacts are reported, because all four compile from one hostMode
source and `ast.js` is only 24.5% of the shipped mass:

| artifact | bytes |
|---|---:|
| `lib/grammar/ast.js` **(rank key)** | 3,341,439 |
| `lib/grammar/cst.js` | 3,385,629 |
| `lib/grammar/ast/positions.js` | 3,429,934 |
| `lib/grammar/cst/positions.js` | 3,473,856 |
| **total** | **13,630,858 B** |

## Ranking

0. **Tree identity — PASS/FAIL. A fail is disqualifying, full stop.**
1. `ast.js` raw bytes (the owner's goal-2 metric).
2. Parse speed, tie-break only, and only outside the noise floor.
3. Source bytes / combinator count.

**Nothing under ~1.5% is a speed result.** Two byte-identical artifacts interleaved in
one directory measured 5.144 vs 5.200 ms at a 6/15 win rate. `classify()` returns
`NOISE` inside that band and `INVALID` (never a pass) on a non-finite delta — a gate in
this project once failed open because `NaN > tol` and `NaN < -tol` are both false.

## Tree identity, and why it is identity *modulo a declared bijection*

Gated on **all three shipping surfaces**: `parse` (ast), `parseCssCst` (cst),
`parseCssDoc` (doc). CST carries both `type` and `grammarType`, so it pins the
production set itself — AST-only gating would leave the language service ungated and
would not catch the `'@' | 32` class, where a backtick made every `@`-led dispatch key
fall through so `@font-face` parsed as `OpaqueAtRuleBlock` with **288 tests green**.

But the tournament *requires* renaming nodes, and CST materialises names — so naive
byte-identity fails by construction on every correct entry. Resolution: a candidate
declares `renames.json`; the incumbent's `type`/`grammarType` are projected through it;
byte-identity is then required on **everything else** — structure, nesting, child order,
spans, trivia, tags, thrown-error behaviour.

**The map must be injective and this is enforced.** Two old names mapping to one new
name is a structural merge wearing a rename's clothing: the two productions would
compare equal and the gate would hide the exact collapse it exists to catch.

## The anti-gaming rule

> **Regexes may cover terminals; structure must remain combinators.**

"Fewest combinators" is trivially gamed by collapsing structure into one giant regex,
which stops being a combinator grammar, defeats first-set gating, and violates the
standing no-regex-outside-`regex()` rule. The board reports per entry: total regex
source characters, longest single regex, and the count of regexes matching across a
structural boundary. A jump is **named on the board in words**, not silently ranked.

## The reference-shape column

A composite referenced by bare const is **inlined at every reference, transitively**; one
referenced via `g.X` is emitted once. The price is set by the *closure depth* under each
inlined rule, measured between **1.046× and 13.69× for the identical defect**. It is
invisible to call-site counts. Without this column, raw bytes rank authoring accident
rather than grammar design.

Four independent audits of the incumbent disagreed (39/2, 41/4, 8/4, and this harness's
17/1) because all four hit the same three contamination classes. `src/refshape.mjs`
corrects all three and the harness owns the one script:

1. Scanning from line 0 counts imports, the 147-member `GrammarRuleName` union, and
   module helpers as references.
2. Counting through string literals lets every `node('X', …)` self-reference.
3. **Not skipping regex literals** — this grammar's string terminal is
   `regex(/"(?:[^"\\]|\\.)*"/)`, and treating that `"` as a string opener swallows
   thousands of lines including the entire rules map. This one silently reported
   `returnedRules: 0` while the same regex found all 114 keys on unstripped text.

Plus: a composite is a const bound to a **combinator expression**. Without that, reducer
locals (`values`, `name`, `args`) rank as the most-inlined "rules" in the grammar.

## Files

| file | what |
|---|---|
| `scoreboard.mjs` | the one command |
| `selfcheck.mjs` | proves the harness passes on identity and **fails on known-bad** |
| `src/canonical.mjs` | deterministic tagged serializer + structural first-divergence |
| `src/identity.mjs` | the pass/fail gate over all three surfaces |
| `src/corpus.mjs` | corpus roots; reuses the less oracle's proven walker |
| `src/metrics.mjs` | artifact/source bytes, combinators, regex share |
| `src/refshape.mjs` | the reference-shape audit |
| `src/preconditions.mjs` | interpreter-fallback + floor refusals |
| `src/bench.mjs` | interleaved min-of-mins with the noise floor built in |
| `src/fuzz.mjs` | corpus-seeded deterministic differential fuzzing |
| `src/coverage.mjs` | rule coverage, splitting *unreachable* from *missed* |

## Prior art reused, not reinvented

- `packages/syntax/less/less-parser/test/identity-oracle/corpus.mjs` — the corpus walker
  (relative ids, reported-not-dropped missing roots).
- `packages/syntax/less/less-parser/test/oracle-byte-identity.mjs` — the
  `collapseChildrenAlias` technique and the two-failure-channel discipline.
- The `lane/0460-elide` `tree-diff.mjs` rig — overall shape (two soundness bugs fixed:
  a global rather than path-scoped cycle set, and `JSON.stringify(v) ?? String(v)`
  collapsing `NaN` onto `null`).
- parseman `bench/tree-identity.ts` @ `7b83395`/`50ba9c4` — its three silent-shrink
  fixes, one of which (**serializing function names compares the codegen's generated
  variable names**) was live in this harness and is now fixed.
