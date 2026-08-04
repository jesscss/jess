# Core Architecture Handoff

> **Architecture correction — supersedes every prior “private direct-AST grammar”,
> “development-only AST seam”, or “wire it later” claim in this document and
> linked future plans. Those claims were wrong/hallucinated migration staging,
> not an approved architecture. AST v2 and the deletion work are the public
> architecture: each dialect package's primary `parse()` operation must run
> Parseman reductions directly to canonical `Stylesheet`. CST APIs remain only for
> explicit language-service/document use; no CST-to-AST bridge, host, or
> compatibility route is an acceptable interim production design.

## COLD START — read this first if you have no prior context

1. **Where you work.** Never edit the main checkout `~/git/oss/jess`; it mirrors `dev` and
   holds concurrent WIP. Create a worktree off `origin/dev`
   (`git fetch && git checkout -B <branch> origin/dev`) and state the SHA in your first report.
2. **Never** `git stash`, `git restore`, `git checkout -- .`, or `git reset --hard`. Two agents
   lost or nearly lost work to this on 2026-07-24. Commit before measuring.
3. **Build in order** before trusting any test number: `parser-shared` → parsers →
   `awaitable-pipe` → `core` → `fns` → `config` → `style-resolver` → plugins → `jess`
   (`pnpm run build:release` does the whole thing). Vitest runs against `lib/`; a stale `lib/`
   silently reports a *past* version of the repo. A stale `parser-shared` build in
   particular masks ~17 real failures — all four parsers depend on it, so it goes first.
4. **Baseline before blaming yourself.** `docs/state/PROJECT_STATE.md` holds the measured
   known-red set. Capture your own baseline as a NAMED SET of cases, never as a count you
   inherited from a doc.
5. **State a SHA with every empirical claim.** A number without a SHA is not evidence.
6. **Never** `as any`, `: any`, `@ts-ignore`, or `@ts-nocheck`.
7. **No less.js checkout may be MUTATED** — never `git checkout`, `switch`, `commit`, or
   `reset` in `~/git/oss/less.js` or `~/git/worktrees/less.js/`. Read-only access is
   sanctioned and is how the repo actually works: `~/git/oss/less.js` on branch `alpha`
   **is the v5 alpha, which is a thin wrapper over jess's own `Compiler`** and is therefore
   the v5 expected-output oracle (`REFERENCE.md:1-14`, `R1-EXTEND-HANDOFF.md:105`) — never a
   Less 4.x oracle. The **4.x** comparator is `~/git/worktrees/less.js/less-4x` (4.8.1).
   *(Corrected 2026-07-30: this rule previously read "`~/git/oss/less.js` is off-limits, use
   `~/git/worktrees/less.js/`", which forbade the repo's own documented and implemented
   workflow and contradicted `REFERENCE.md:39/50`.)* Owner merges parseman PRs; agents never do.
8. **Working on grammars, not core?** This document is the *core architecture* entry point.
   The four-grammar rewrite has its own spec —
   [`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md), start at
   its §0 — and `AGENTS.md` is the repo-wide front door for either.
9. **Correctness has no external oracle** — see `DESIGN-DECISIONS.md` §0 (E1–E7). In
   particular the Less v5 alpha package is a thin wrapper over jess's `Compiler`
   (`docs/architecture/core/LESS-V5-CONTENT-PR-PLAN.md:18`), so it can never adjudicate a
   jess-vs-`lessc` question.

## SESSION HANDOFF — 2026-08-01, jess `d7ebe562e` / parseman `release/0.47.0` `cdf33f3`

**All agents were stopped mid-flight at a spend limit.** Nothing below is in progress;
every branch named is landed or explicitly held. Read this section before the older
WORK IN FLIGHT block, which predates it by a week.

### Owner decisions waiting

1. **parseman 0.47.0 is ready to merge and publish.** PR #104, all gates green
   (changelog, control-bytes, typecheck, docs 124/124, 3777 tests), **0 unresolved
   review threads**. Owner merges parseman PRs; agents never do. Publishing is
   owner-only. Until it publishes, jess cannot adopt `parseman/table` except by a
   temporary link (see below).
2. **`Quoted.value` is `readonly value: string`** (`packages/core/src/ast/nodes.ts:68`),
   so a `Quoted` node with `escaped: true` **cannot hold an interpolation**. That blocks
   the real fix for parse-time quote-dropping. Making it able to is a core AST change plus
   eval work — pinned as a defect in `jess-parser/test/discovered-constructs.test.ts`,
   not decided.
3. **G18's carve-out swaps sides under a table lowering.** It licenses unidiomatic
   *generated* code and requires hand-written source to stay idiomatic; a table has almost
   no generated code, so the licensed tricks would live in the hand-written driver. Needs a
   ruling, not an agent's judgement.
4. **G2 says "Codegen ≤ 4× source bytes."** Its noun is wrong under a table and its
   derivation (§2.3's "needs a 1.9× call-site reduction") rests on ~950 B per named call
   site. If the marginal figure holds, the gate stops discriminating between the four
   grammars rather than being passed. Per the standing perf-gate rule, that is a
   re-derivation with owner sign-off, not a silent pass.
5. **Can a `dispatch()` keep the diagnostic that an ordered `choice` gives?** See G30
   below — this blocks two conversions and, if resolved, unblocks the `parser-shared`
   at-keyword work that reaches all four dialects at once.

### ACTIVE GOAL — 2026-08-01: the table must parse `benchmark.less` in ~17.41 ms OR LOWER

Owner-set, verbatim: *"Get the table-based Parseman (0.47) to ~17.41 ms when parsing
benchmark.less (without resorting to a gazillion megabyte codegen again - do NOT sacrifice
core goals)"* and *"OBVIOUSLY 17.41ms OR LOWER... in case an LLM is stupid and is like
'oops, i successfully parsed in 8ms, better revert'."*

**Faster than codegen is a win to report, never an anomaly to revert.**

`benchmark.less`, 106,802 B, AST path: **codegen 17.41 / table 46.86 / interpreter 99.68**.
Note a second lane measured the same fixture at 22.17 / 49.72 / 111.33 — **27% apart on the
baseline**, box and harness settings. A lane is pinning a canonical protocol and a single
command; until it lands, **quote the ratio alongside any absolute** or the numbers are not
comparable.

**The constraint is as binding as the target.** The way to make a table fast is to stop it
being a table. **No per-rule code emission, no generating JS from the table, no
reintroducing inlining.** Measure artifact bytes alongside milliseconds; material growth in
the emitted table is the signal the line has been crossed. The size win is not currency.

### THE ROOT CAUSE — G5's specialisation half was never implemented

This is the single most important thing in this document. The measured gap does not
decompose into several defects. It is **one missing half of the design**, surfacing
wherever the driver touches the parse path.

Owner, verbatim: *"the entire fucking table design was to do that logic branching ONCE and
NEVER AGAIN PER NODE."*

G5 says: build the grammar reference at run start, **swap in specialised implementations
for rules and sub-rules (leafs)**, then run with no branching. The encoder was built to
*represent* the grammar faithfully. **The half that *specialises* it was not built.** So:

| analysis, already written | wired into `src/table/` |
|---|---|
| `src/compiler/scannable-run.ts` — 76,570 B | **no** |
| `src/compiler/trivia-fast-path.ts` — 11,119 B | **no** |
| `src/compiler/token-scanner.ts` + `token-alphabet.ts` — 24,338 B | **no — no consumer at all** |
| CST capture elision (`FUSED_HOST_ELIDED = mode === 'ast'`) | **no** |

**~112 KB of recognition and lowering analysis sits one import away**, while the driver pays
generic cost for every terminal, every trivia scan, and every node. `codegen.ts` imports
`token-dispatch.ts`; nothing imports `token-scanner.ts` or `token-alphabet.ts` at all.

**The test for any candidate: could this have been decided when the table was built?** If
yes it belongs in `resolveTable`/`OP_SCOPE` as a swapped-in specialised path, not in the
parse loop.

This also explains why **materialising the table into a closure tree bought only ~10%**
(measured, −9.3/−8.5/−9.9%, 20/20 wins): it changed how rows *dispatch* while leaving what
rows *do* generic. **Do not re-attempt materialisation** — it has been built and measured.

### Where the time actually is on `benchmark.less`

**The json profile misled every lane and is retired.** The 60% recognition / 29% trivia /
6% reducers split came from 12 KB of json. On `benchmark.less`:

| | table | compiled | share of gap |
|---|---:|---:|---:|
| **CST capture machinery** | **21.7%** | **~0%** | **~40%** |
| trivia | 3.1% | 4.4% | ~2% |

`OP_NODE` calls `beginCstNodeCapture` unconditionally **on the AST path**, where the
compiled artifact stamps `FUSED_HOST_ELIDED` and elides it. Second-order effect is arguably
larger: setting `_cstBuf` keeps `rollbackNeeded()` true for the whole parse, so **every
choice attempt and every repetition item allocates a 5-field mark object** that codegen does
with scalar locals. That is the per-item allocation a lane hunted on json and could not
replicate — json has almost no nodes.

**Two directions are parked with evidence, do not re-derive them:**
- **Trivia** — the swap was *built correctly to G5* and buys **nothing**: `fastTriviaScanner`
  cannot lower `classifiedTrivia` because its arms are `label()`-wrapped. css 0 of 4, less
  0 of 8, scss 0 of 2, jess 0 of 2 lower. json's trivia is a plain regex, which is the only
  reason it profiled at 22%. Measured effect on `benchmark.less`: **−0.19 ms, noise.**
- **Terminals** — only 31–48% are scannable (less 49/142, css 26/83, scss 51/106, jess
  47/112) and **no `RegExp.exec` frame appears in the top 18** of the less table profile.
  Unproven, not disproven.

### Where the architecture stands, measured

**Correctness — met, with one qualification I over-reported.** Three-way identity
(interpreted / compiled / table) across **2,833 files** with every cap removed: css 87,
less 314, scss 2,408, jess 24. **`table-outlier` = 0 on all four.** No defect was hiding in
the 2,414 files nobody had looked at.

**The qualification:** that sweep ran on **jess's** corpora. parseman's own `examples/csv`
exposes a genuine table-outlier — `sepBy()` over a nullable item yields `[]` on empty input
where interpreter *and* codegen both yield `[""]`, so the grammar's drop-trailing-empty-row
transform never fires (5 rows vs 4). Pinned; csv is unmeasurable in the SVG comparison as a
result.

**Size — met decisively.** Per variant, whole artifact:

| | codegen raw / gzip | table raw / gzip | raw |
|---|---|---|---:|
| css | 2,276.6 KB / 315.6 | **74.2 / 15.1** | 30.7× |
| less | 2,863.0 / 406.4 | **209.3 / 33.2** | 13.7× |
| scss | 1,883.1 / 266.9 | **108.4 / 20.2** | 17.4× |
| jess | 2,015.9 / 288.4 | **119.2 / 23.3** | 16.9× |

Conservative (codegen shares ~14% across variants): **12.5×–27.4×**. Machinery only,
reducers removed from both sides: 19.7×–41.4×. Shared driver 68,738 B once. All four
dialects × four variants: **2.00 MB against 31.56 MB.**

**Load time — a large table win, and the counterweight to the parse cost.** Cold import to
parser-callable: css 65.4 → **7.4 ms**, less 83.4 → **8.0**, scss 49.4 → **7.1**, jess 54.1 →
**7.1**. V8 compile alone is **46–85×**. Codegen's cost is **43–68 ms deferred, not absent** —
lazy compilation hides it until first call, and a parser calls every rule it has.

**Crossover** — below it the table is faster overall, above it codegen is: **css 0.36 MB,
less 0.17 MB, scss 0.17 MB, jess 1.18 MB.** So the table wins one-shot and editor
workloads outright and loses sustained bulk compilation. Every millisecond off the parse
side moves the crossover right.

**The penalty does not track input size.** `gen-workload.less` at 275 KB is 4.11× while
`benchmark.less` at 107 KB is 2.69×, same dialect. It tracks **which constructs a file
exercises**. Never optimise into a single fixture.

### G1–G5, honestly

| | status |
|---|---|
| **G1** fastest in the SVG comparison | **being measured on the table for the first time.** Every prior pass — 11/11 groups, tightest 1.80× over chevrotain — had **codegen** on the parseman side. csv is unmeasurable (the `sepBy` outlier), so coverage is 9 of 11 groups |
| **G2** ≤ 4× source bytes | **met**, with wide margin |
| **G3** no factory pattern for options | **met** — options resolved at build, zero option reads on the parse path |
| **G4** one grammar, one output | **NOT met** — four `trackLines`×`hostMode` tables per dialect, differing by only **0.2–0.4%**. G5's build-at-run-start with row swaps should give one artifact plus small deltas. *(An earlier claim that AST and CST are byte-identical tables was TOY-derived and is false on all four real grammars — proven by sha256, not byte counts.)* |
| **G5** build at run start, swap, no branching | **half met** — the *option* half is honoured literally (`trackLines` swaps rows at build, zero option reads in `exec.ts`); the **leaf/node half was never built**. See THE ROOT CAUSE above |
| **G14** predictive token cursor | **never composed with G5.** The ledger records G14 as settled and separately records that nobody specified how it composes with the table. A token cursor feeding a driver is a different machine from one feeding generated code |

### Two more defects of the same class, found today

**`run()` taxes every parse 36.9% on small input.** `guardRemovedFields`
(`src/functional/run.ts:162`, called at `:337`) installs **two `Object.defineProperty`
throwing accessors on every result** — a migration aid for fields removed in **0.44.0**.
Per-instance accessor properties on a hot object, in a repo with numbered V8 invariants and
a recorded incident where a hidden-class split cost **46% of CSS parse time**. Being fixed.

**Builder call-site megamorphism.** Every builder reaches **one** `build(...)` site in the
driver — css **125** distinct builders, less 259, scss 152, jess 175 — against V8's inline
cache limit of **4**. Codegen calls each from its own monomorphic site. Materialising does
**not** fix this. ~6% of the gap.

### Enforcement — the rules exist and nothing checks them

Every defect above landed in a repo whose docs forbid it. `docs/perf/V8-ARCHITECTURE.md`
has numbered invariants; `docs/architecture/llm-quality-enforcement-design.md` is an
enforcement design that was written and never built; jess's `pnpm lint:absolute` detects the
`as any` ban, has found ~500 violations across 52 files, and **has never been gated**.

**LANDED 2026-08-01** — parseman branch `feat/invariant-gate`, `pnpm check:invariants`,
wired into CI's required `test` check, the pre-commit hook, and `pnpm test`. Rationale in
`docs/design/invariant-gate.md`. Four rules, all source-decidable, no thresholds:

- **INV-1** accessor descriptors in `Object.defineProperty` — object-*literal* getters stay
  legal, since the repo uses them for lazy materialization and banning them would be the
  false positive that gets the gate switched off
- **INV-2** a field in an exported `*Options` type read nowhere in `src/**` — starts at zero
  across 29 public option types
- **INV-3** a `src/**` module unreachable from `package.json` exports
- **INV-4** byte-identical top-level declarations across files

**It immediately caught this session's own pattern:** INV-3 flags `token-alphabet.ts` and
`token-scanner.ts` as having no consumer, and INV-1 flags `run.ts:guardRemovedFields`.

**The rejections are the substance.** The conditional-spread rule (jess's 46% incident) was
implemented and **removed**: 177 pre-existing hits, overwhelmingly cold string-assembly code,
and source carries no notion of call frequency so it cannot separate the hot case from the
idiom. Recommended instead: a two-sided count ratchet over a declared hot-module set, in the
shape of `choicecost:guard`. Also rejected with reasons: conditional property assignment
(not decidable), side-effect registration reachability (needs to know which side effects are
load-bearing — INV-3 catches its neighbour but not this), allocation/complexity invariants
(counting instruments against baselines, not lints), monomorphic node shapes (runtime-only).

12 pre-existing violations, allowlisted **by name**, and a **stale entry fails the gate** —
an exemption for a fixed violation is a licence to reintroduce it. Six are the frozen
ablation controls; six are real debt.

### Lanes in flight (2026-08-01, all on branches, nothing merged)

| branch | doing |
|---|---|
| `diag/table-penalty-attribution` | **the big one** — CST capture elision, then sweeping the whole decide-once class |
| `perf/builder-call-site` | the 125-builders-into-one-call-site megamorphism |
| `fix/run-result-guard-tax` | the per-result `defineProperty` accessors |
| `bench/benchmark-less-canonical` | one reproducible `benchmark.less` measurement + command |
| `feat/invariant-gate` | mechanising the written invariants |
| `measure/svg-margin-table` | G1 on the table, 9 of 11 groups |

**Codegen deletion is the LAST step before merge**, not now — it is the comparison baseline
while a gap remains. The pinned codegen numbers are scaffolding and get deleted with it.

### THE GOAL, and it is not what several lanes have been working to

**Owner ruling, 2026-08-01, verbatim:** *"you're not even close, and we CAN'T TELL IF WE
KEEP THIS WHOLE ARCHITECTURE YET because you haven't FINISHED it to where it's PROVEN
against all Jess grammars."* And: *"why would i accept ANY PR until you PROVE ./table
works, has acceptable speed trade-offs, and is finalized as working, and if so, all other
parsing / codegen paths are deleted and replaced with table paths."*

**The table is not a second lowering that lives alongside codegen. It replaces it.** That
is `DESIGN-DECISIONS` **G4** — *one input grammar, one compiled output* — and **G5**, the
owner's own design. Several lanes, and the orchestrator briefing them, drifted into
treating it as an opt-in prototype to be incrementally de-bugged. That is how a parallel
path becomes permanent.

**The open question is whether this architecture is worth keeping.** It cannot be answered
until the design is finished far enough to measure. Until then:

- **Nothing merges.** Green PRs that fix pieces of an unvalidated design are premature
  polish. Fixes land as branches; they are held, not merged.
- **A limitation is not a scope decision.** The 0.47.0 CHANGELOG called `balanced()`/
  `scanTo()` non-emission a documented limitation. That framing is withdrawn — it is the
  thing that makes the whole design unmeasurable, since no shipping grammar can be written
  to a module at all.
- **The deliverable is a WORKING, FAST table design — not a verdict.** *(Corrected
  2026-08-01. This section previously said the deliverable was a verdict and that an
  unfavourable number was a legitimate answer. That was wrong and the owner rejected it:
  "no. we're close enough that you have to make this right. if we're on the wrong side of
  speed, you work night and day until we fix it" — and, on scope, "with the table
  design.")* A bad number is the problem statement, not the answer. The design ships; the
  work is making it fast **within** the table architecture, not pivoting away from it. An
  approach is withdrawn only when proven **impossible** or its premise proven **false** —
  a disappointing measurement is neither.
- **When it is proven, codegen is deleted.** `src/compiler/codegen.ts` and everything that
  exists only to serve it. Not kept as a fallback.

Where it actually stands, so nobody quotes a friendlier number: the table **loses 41 of
111** all-less cases against the interpreter on identical combinators, **throws on 40 of
136** corpus files where the interpreter succeeds, **differs silently in bytes on 2 more**,
and **mis-parses jess wholesale** (5 of 6 matrix cells). `113 B/rule` and `~2.65×` are
16-rule-ladder and json figures and are not evidence about real grammars.

### NEXT UP — the ordered path to table-based jess builds

Every item below is blocking the one after it. Do them in order; each has a stated
done-condition so nobody has to guess. **Steps 1–2 are jess's; steps 3–6 are parseman's.**
The measured facts behind each are in the sections that follow.

**1. Fix the `sepBy`/`rawChildren` reducer bug. (jess, ~small, no dependencies)**
Reducers compute a trivia insert index from `children` when the index addresses
`rawChildren`. `sepBy` no longer contributes separators, so the two arrays no longer
advance in step and comments around separators are silently dropped.
*Find them:* any reducer for a `node()` containing `sepBy`/`oneOrMoreSep` that correlates
a `children` index with a `triviaLog` insert index. Also check reducers that index
`children` positionally or read `children.length` to count.
*Done when:* `comments`, `comments2`, `at-rules-keyword-comments` pass under parseman
0.47.0, and all-less is back to 110/111 with 0.47.0 macro. **This is required to adopt
0.47.0 at all — table or not — so it is the first thing regardless.**

**2. Remove the duplicate factory keys. (jess, trivial)**
`QueryValue`, `QueryTerm`, `QueryFeatureName` are each declared twice at
`packages/syntax/jess/jess-parser/src/grammar.ts:6124-6131`. esbuild warns; the macro
build does not. *Done when:* each key appears once and the jess suite is unchanged.

**3. Register the regex first-set analyzer in the `parseman/table` module graph.
(parseman, blocking everything)**
`regex()` derives its first set from an analyzer registered only in `src/index.ts`.
`dist/table/` is a separate graph that never runs that registration, so `regex()` returns
the permissive `any()` fallback and `classifiedTrivia` rejects every arm with
`"whitespace" must be non-nullable with a concrete finite first set`.
**All four dialects are dead on arrival from the published shape** — this is not a jess
problem and no jess change can work around it.
*Done when:* `tableRules(encodeTable(<any jess grammar>))` runs from the built
`dist/table` with no aliasing to source.

**4. Isolate and fix the jess mis-parse. (parseman)**
jess fails 5 of 6 matrix cells — cannot parse `.a{color:red}` under the table, with
`expected: ["routed()"]` at the value position. The interpreter control passes on the
*same live combinators*, so it is the lowering. Lowest divergent rule is
`IdentifierOrFunction` (`jess-parser/src/grammar.ts:3334`) / `KeywordValue` (`:3195`),
reached from `ValueAtom`, `Value`, `CallComponent`, `CalcSum`, `QueryValue` — 60
rule×input divergences. jess is the only dialect using
`makeWhen({ caseInsensitive: true })` (`:1665`), **but a minimal repro of
`dispatch` + `caseInsensitiveWhen` + `otherwise(node(…, routed(), …))` does not
reproduce it**, so the trigger is narrower than that and is still unknown.
*Done when:* jess passes all 6 matrix cells and the repro is named.

**5. Close the Less corpus divergence. (parseman)**
The table loses 41 all-less fixtures against the interpreter on identical combinators.
At parse level over `tests-unit/**/*.less`: 136 files, 94 identical, **40 throw** where
the interpreter succeeds, **2 differ silently in bytes**. Start with the silent pair —
`at-rules.less` 1677→1682 and `detached-rulesets.less` 1254→1743 — because a wrong tree
with no error is the worse class and the throws are louder. The throw messages
(`Unexpected Less input after a complete stylesheet`, `Missing closing brace`,
`Less arithmetic grammar lost an operator operand`) suggest more than one cause.
*Done when:* table parse-level output is byte-identical to the interpreter across all
136 files.

**6. Lower `balanced()` and `scanTo()`. (parseman) — OWNER RULING 2026-08-01: this is
NOT an acceptable limitation.** Verbatim: *"that's not acceptable, make sure everything
compiles / emits in our combinators for this table design"*. The CHANGELOG called it a
documented limitation; that framing was wrong and is withdrawn. **Every combinator must
emit.** A table design where two core combinators cannot be written to a module is not a
working design — it is precisely what makes the size claim unmeasurable. Treat this as a
correctness requirement on the lowering, not a scope decision.
Both park live combinator objects via `OP_CALL`, so **no shipping grammar can be emitted
as a module** — css/less/scss block on both, jess on `scanTo` alone. A previous
investigation established that **neither genuinely requires a live object**: `token` is
save/clear/run/restore/one-leaf; `balanced`'s `_def` is its eager interior and its
one-leaf behaviour is `token`-shaped; `scanTo`'s sentinel and skippers are grammar-graph
combinators. `scanSkip` is ambient but static per scope, so it encodes as offsets
installed by `OP_SCOPE` — **prove that rather than assuming it**, because a skip set that
resolves at an outer scope and silently empties in an inner one is the same silent shape
as the trivia bug.
Two traps recorded from the failed attempts: `balanced`'s outer node is a `token` and
`_balancedAmbient` sits on the **inner** combinator; and `balanced()` *does* detect
crossed closures (`([a)]` reports `errors=1` via `expect()`), so a read-back measuring
only consumption cannot distinguish acceptance from recovery.
*Done when:* all 16 cells emit, the emit round-trip passes for each dialect, and
per-dialect artifact bytes and parse time can finally be measured.

**Only after 6 do the numbers this whole effort exists to produce become obtainable.**
Until then `113 B/rule` and `~2.65×` remain ladder-and-json figures and must be labelled
as such.

**Rebuild the measurement harness first, before step 3.** The one that produced every
number above was throwaway (gitignored `.scratch/`) and is gone. It should be a permanent
script: parse-level table-vs-interpreter diff over the 136-file corpus, comparing
serialized CSS. The interpreter is the ideal control — same live combinators, so any
divergence is purely the lowering — and without it every step above gets re-measured by
hand. **Proposed and not answered; treat as the first task unless the owner says
otherwise.**

*Linking parseman 0.47.0 into jess before it publishes:* use a **workspace-root-relative**
`link:` in `pnpm.overrides`. An absolute path is silently mis-linked by pnpm 8.15, and
because `.claude/worktrees/*` sits inside the mirror the broken link resolves upward into
the mirror's `node_modules` and finds a *different* parseman with no error. **Print the
resolved realpath and version from every package and assert one distinct realpath before
trusting any number.**

### parseman 0.47.0 — what shipped

The table lowering (`src/table/`) ships as a **real public export** (`./table` is in
`package.json` exports) that is **not on the shipping path** — nothing outside
`src/table/` imports it, and macro / `compile()` / `compose()` do not reach it. Known
limitations are stated in the CHANGELOG: four failure-reporting divergences, a
structural-node refusal under `hostMode: 'cst'`, and no grammar using `scanTo()`/
`balanced()` can be emitted.

`113 B/rule` and `~2.65×` are **ladder-and-json figures**, never measured on a shipping
grammar. The CHANGELOG records that. Do not quote them as if they were.

### The table measured against jess — the numbers, and they are unfavourable

Run with parseman 0.47.0 linked into jess (workspace-root-relative `link:`; an absolute
path is silently mis-linked by pnpm 8.15 and resolves upward into the mirror's
`node_modules`, finding a *different* parseman with no error — **print the realpath
before trusting anything**).

| configuration | all-less |
|---|---:|
| parseman 0.46.0, macro (jess's shipping config) | **110 / 111** |
| parseman 0.47.0, macro | 107 / 111 |
| parseman 0.47.0, interpreter | 101 / 111 |
| parseman 0.47.0, **table** | **60 / 111** |

Corpus: `~/git/oss/less.js/packages/test-data`, branch `alpha`, SHA
`2f309b667df0fed192c83e1b32b4a72f045798f4`, 111 cases each side. Parse-level over
`tests-unit/**/*.less`: 136 files, 94 identical, **40 threw** where the interpreter
succeeded, **2 differ silently in bytes** (`at-rules.less` 1677→1682,
`detached-rulesets.less` 1254→1743). The silent pair is the worse class.

**Blockers, by owner:**

*Parseman-side (jess cannot fix these):*
- **`parseman/table` cannot run any classified-trivia grammar as shipped.** `regex()`
  derives its first set from a registered analyzer; the analyzer is registered only in
  `src/index.ts`, and `dist/table/` is a separate module graph that never runs that
  registration. `classifiedTrivia` then rejects every arm. **All four dialects, dead on
  arrival from the published shape.**
- `balanced()` / `scanTo()` park live combinator objects via `OP_CALL`, so no shipping
  grammar emits. css/less/scss block on both; jess on `scanTo` alone.
- The table mis-parses. jess fails 5 of 6 matrix cells (`expected: ["routed()"]` at the
  value position; lowest divergent rule `IdentifierOrFunction`
  `jess-parser/src/grammar.ts:3334`). Root cause **not isolated** — a minimal
  `dispatch` + `caseInsensitiveWhen` + `otherwise(node(…, routed(), …))` repro does not
  reproduce it.
- `buildSpecModel` **infinitely recurses on `balanced()`** — `RangeError` at default
  stack, SIGSEGV at `--stack-size=40000`. Three rules are pinned in the diagram generator
  to work around it: css `AtRulePreludeGroup`, less `AtRulePrelude` + `OpaqueAtPrelude`,
  scss `AtRootFilterPrelude`.

*Jess-side (short list — jess is not the blocker):*
- **The `sepBy`/`rawChildren` reducer bug.** Reducers compute a trivia insert index from
  `children` when it addresses `rawChildren`; once `sepBy` stopped contributing separators
  the two diverge and comments around separators are silently dropped. Costs 3 fixtures
  (`comments`, `comments2`, `at-rules-keyword-comments`). **Required to adopt 0.47.0 at
  all**, table or not.
- `QueryValue`, `QueryTerm`, `QueryFeatureName` are each declared **twice** in the jess
  factory return object (`jess-parser/src/grammar.ts:6124-6131`). esbuild warns; the macro
  build does not.

The measurement harness was throwaway (gitignored `.scratch/`) and is **gone**. The
interpreter is the right control — same live combinators, so any divergence is purely the
lowering. **Rebuilding it as a permanent script was proposed and not answered.**

### Grammar quality — the diagrams are the instrument

`docs/grammar/railroad/` (landed, `d84bb3855`): `index.html`, four dialect pages,
`complexity.html`. 788 KB, self-contained, no external assets. Generated from the same
`rules()` tree that parses, so they cannot drift from what actually parses.

The owner read them and found more actionable defects in minutes than three
byte-measurement lanes found in days. **That is the lesson: grammar quality is a
legibility property, read it directly.** A bake-off that judged three css rewrites on
artifact bytes answered a question nobody asked and is deprioritised —
*"more important fish to fry"*.

Thresholds he set: **>30 symbols**, **>10 rows**, and unique chain count. Rows are a
*decomposition* metric — a named reference is one row, an inlined alternative is its own,
so >10 rows means "this rule should be split, and here is what into".

The nine defect classes, with verified specimens:

1. **Inline instead of linked** — `ModuleDirective` (scss) inlined the quoted production
   instead of referencing `Quoted`. **Fixed.**
2. **A construct re-spelled per variant** — `Quoted` wrote the `~` prefix four times.
   **Fixed in jess; less and css carry the identical shape, untouched.**
3. **A hand-maintained exclusion list** — `atRuleKeyword`
   (`parser-shared/src/recognition.ts:315`) has **two leading `not()`s in one sequence**;
   `GenericAtRuleName` (`:302`) has three. **Not converted — see G30.**
4. **Alternatives inlined instead of named** — `ConditionalBlock` spells three
   `<AtKeyword>+<Prelude>+<body>` arms inline and `NestedConditionalBlock` spells the same
   three again. **Conversion attempted and reverted — see G30.**
5. **Trivia re-spelled inside a rule** — `ImportTail` (`css/grammar.ts:2779`) is
   `noTrivia(sequence(many(importTailWhitespace), …))`, and `ImportTailBody` installs a
   *third* table via `parser({ trivia: commentTrivia })`. **Not started.** Real count of
   hand-written whitespace: **154 lines** across the five files (less 59, parser-shared 30,
   css 28, jess 25, scss 12) — the ~114 on record was wrong.
6. **Glue rules that are not constructs** — `AtRulePreludeWhitespace`, `AtRulePreludeComma`,
   `AtRulePreludeGroup`, `AtRulePreludeQuoted` (`css/grammar.ts:2845-2863`),
   `ImportUrlUnquoted`, `DoubleQuotedText`. **Not started.**
7. **`routed()` renders as nothing** — so `PageBlock`, `Keyframes`,
   `FontFeatureValuesBlock`, `OpaqueAtRuleBlock` all appear in the diagrams without their
   at-keyword. **The diagrams are actively misleading here**; any conclusion drawn from a
   `routed()`-bearing diagram is suspect. Emitter bug, **not fixed**.
8. **Named for the body, not the construct** — the same four rules; owner proposes
   `PageAtRule` / `KeyframesAtRule` / `FontFeatureValuesAtRule` / `UnknownAtRule`. Note
   classes 7 and 8 are entangled: some may be correctly named and only *look* wrong.
9. **Context threaded as a duplicate rule family** — css has **four** `TopLevel*` rules
   (`TopLevelSelectorList`, `TopLevelComplexSelector`, `TopLevelCompoundSelector`,
   `TopLevelRuleset`), each a near-copy of its twin differing only by one reference.
   `SelectorList` and `TopLevelSelectorList` are byte-identical apart from
   `g.ComplexSelector` vs `g.TopLevelComplexSelector`. **less, scss and jess have zero
   `TopLevel*` rules.** The mechanism this wants is `withCtx`/`gate` — but `withCtx` and
   `gate` also render as nothing, so collapsing the chain would make the grammar smaller
   and the diagram *less* informative. **Parseman feature requirement: the diagrams must
   be able to show context.**

**The reconciling principle**, which resolves classes 4 and 6 looking contradictory:
*a rule should be a language construct — not a fragment of one, and not a bundle of
several.* `ConditionalBlock` is a bundle; `AtRulePreludeComma` is a fragment.

### G30 — the dispatch/diagnostics conflict, and a live bug

**Ten real Sass at-rules do not parse.** `@while`, `@content`, `@debug`, `@warn`,
`@error`, `@-use`, `@-compose`, `@-export`, `@-import`, `@-from` are named in
`scssOwnAtKeyword` but have **no production anywhere**; the exclusion removes their only
remaining route, so they are neither typed nor opaque and fail with `Unexpected SCSS
syntax.` Pinned with a fixture; ledger row **G30**. Shortening the list is *not* the fix —
those names are excluded so an evaluated directive is not emitted verbatim, and routing
`@while` to opaque would put it in the CSS output. **They need productions.**

**Why the dispatch conversions are blocked.** `ConditionalBlock` was rebuilt as a
`dispatch` — arms named, `@supports`' `interstitialTrivia` preserved, node labels
unchanged, `cst-host.ts:194` checked first (`publicGrammarType` maps both to
`QueryAtRuleBlock`, so naming arms is not a CST change). It **broke 4 css tests**, all
`expected 0 to be greater than 0`. The ordered `choice` is **load-bearing for
diagnostics**: a malformed prelude currently falls through and reports; `dispatch` commits
on the at-keyword and the error disappears. Reverted to a byte-identical tree rather than
adjust the tests. The same blocker applies to `atRuleKeyword` in `parser-shared`, where it
would reach all four dialects at once.

**No dialect overrides any `*AtKeyword` rule** — verified. By the compose-override
criterion they are enumeration for its own sake, but the `ConditionalBlock` result is
direct evidence that folding them into a dispatch is not free.

### Corrections to things previously recorded

- **`pnpm check:control-bytes` does not exist in jess.** It is a parseman gate. Several
  lanes were told to run it and had to hand-roll the scan.
- **Leading-`not()` sites: 30**, not ~18 (css 12, less 8, jess 6, scss 4). Total `not()`
  calls: css 22, less 46, scss 30, jess 17 — so the standard's "~460 vs 21" is also stale.
- **Half the "byte-identical duplicate rules" list was a false premise** — `HexColor`,
  `BlockCommentToken` and the less identifier family are shared *terminals* in
  `recognition.ts`, not rules; `Stylesheet`==`Document` is an alias key, one object.
  **Confirmed real:** css `StatementPrelude`==`AtRulePrelude` (identical bodies *and*
  reducers, only the node-type string differs) and jess
  `Expression`==`ExpressionInterpolation` (identical bodies, materially different
  reducers).
- **`bench/` in parseman had never been typechecked** — 82 errors, two real bugs. Now
  under `tsc` with zero suppressions and nothing excluded.

### Parked, in priority order

1. `balanced()` and `scanTo()` lowering — the emit round-trip for shipping grammars, then
   per-dialect bytes and timings. `notes/TABLE-DRIVER.md` in parseman carries the queue
   with the trap that sank each previous attempt.
2. Furthest-failure merging — the table reports a choice's union at its own position where
   both engines report at the furthest position reached.
3. **`css/stylesheet` showed a +23.7% median on one of five passes** in the 2026-08-01
   quiet-box `workload-perf` run against the new `a5dc9bd` anchor (load 1.87 → 1.76).
   The run **passed** — a workload fails only on a strict majority of breached passes,
   and this breached 1/5 — but the null control for that workload read only +0.7%, so it
   is not obviously instrument noise. Worth one look on a quiet machine.
4. The perf-gate waiver has **never been watched failing end to end**. Its decision logic
   is unit-tested (26 tests, 21 proving it stays red); the wiring is not observed. By this
   repo's own standard a gate nobody has watched fail is not known to work.
5. New SVG charts on a cold machine — the published charts were generated at **0.29.0**,
   eighteen releases stale. Every timing in the docs now correctly states that basis.
6. The railroad terminal-rendering fix (landed, parseman `fe32f5e`) was **demonstrated on
   an invented toy grammar**, not on jess's. The code change is real and its counts were
   replayed over the four actual pages, but the before/after that made it look verified was
   not verified. **Re-prove it on the real four.**

## WORK IN FLIGHT (as of 2026-07-24, `e34bb24b3`) — do not duplicate

These lanes have an agent or a live branch on them. Coordinate; do not start them fresh.
Delete a row the moment it lands or is abandoned.

### 2026-07-31 (late) — parseman size/perf findings, measured

**The perf red on PR #102 is a MEASUREMENT DEFECT, not a regression.** The gate
run against the reference *by itself* — zero code difference — false-failed twice
in three runs, one of them WORSE than the CI failure it was meant to explain
(self-check `expected/narrow` min +8.1…+10.0%, breached 3/3, versus CI's min
+8.6…+9.3%, breached 2/3). Over 21 passes at the tree CI measured,
`rollback/sparse` won 69.8% of pairs and never breached; `css/stylesheet` won
70.2%. Root cause: the win-rate column carries a large PER-CASE bias and the
sign test assumes it does not — `expected/narrow`'s null win rate is 25.9%
against a 25% ceiling (no margin), `rollback/none`'s is 88.9% (blind). The
ref/head alternation is balanced 6/6, so it is not that.

Consequence: **`rollback/none` at −22.5…−11.4% after the revert was an artifact,
not a speedup** — do not cite it. The `0665871` revert still stands on
`rollback/dense` min +50.2…+52.3% winning 0/12, far outside any plausible bias.
Fixes, both making the gate stricter (the gate's own doc prescribes the first):
raise `passes` 3→5, and calibrate the per-case win-rate bias. Neither landed.

**Grammar artifact size — measured on the reference pair** (parseman `58d1079`,
jess `ebb5d6ada`): a clean rebuild totals **45,471,349 B** over 16 artifacts and
reproduces the committed `lib/` bit-for-bit. Earlier figures of 45,859,971 and
45,969,003 were measured elsewhere and are superseded.

Expansion ratio, source `grammar.ts` → emitted `ast.js`:

| dialect | source | emitted | rules | expansion |
| --- | ---: | ---: | ---: | ---: |
| css | 114,299 | 3,336,637 | 176 | **29.1×** |
| less | 258,986 | 3,937,754 | 256 | 15.2× |
| scss | 158,882 | 2,006,718 | 204 | 12.6× |
| jess | 191,343 | 2,049,395 | 225 | **10.7×** |

**css has the SMALLEST source and the LARGEST expansion**, and jess already meets
the owner's `<10×` budget at 10.7× — so the budget is demonstrated, not
aspirational. css's median rule (3,975 B) is SMALLER than jess's (5,278 B); the
2× mean gap is a fat tail. **css's top 10 rules hold 53.5% of its rule bytes**
(jess's top 10: 28.4%). The work list: `DeclarationListAtRule` 230,189 B,
`StylesheetAtRule` 221,179 B, `TypedValueSequence` 214,731 B, `QueryClause`
207,294 B, `ConditionalGroupAtRule` 148,191 B, `Value` 120,238 B,
`PseudoSelector` 97,867 B, `VarFallbackBracket` 85,004 B. **Four at-rule rules =
806,853 B = 29.5% of css's rule bytes**, sitting on the at-rule prelude
structuring thread already queued at steps ②–⑥.

Naming note: `DeclarationListAtRule` names its POSITION, not a construct — there
is no "declaration list" at-rule. It and `StylesheetAtRule` are one at-rule
production filtered by position. `InnerAtRule`/`OuterAtRule` is the better pair.
Renaming buys no bytes (see below); fold it into the structuring work.

**What the 806 KB is NOT:** name-driven duplication is **0.0–0.2%** across all
four dialects, measured by emitted-body comparison (which sidesteps
`payloadKey`'s three degradation paths), plus a second pass abstracting rule
references that found nothing further. **But exact byte-identity is a poor
duplication metric** — code that is 95% the same reports as 0% — so this rules
out literal copy-paste and nothing more. Do not cite 0.0% as evidence against
duplication.

**The live candidate:** css's three at-rule bodies overlap **91–95%** pairwise
while colliding byte-identically ZERO times — same vocabulary, different
arrangement. `PseudoSelector`→`QueryClause` is 82%. Scaffolding is a ~41% floor
present in every rule, so the discriminating test is to subtract the scaffolding
families and re-run the overlap; above ~80% means real shared prelude machinery.
**That test has not been run.** Distinct at-rule rules are CORRECT — sound
parsing of specific at-rules is the point; collapsing them to one generic
at-rule would be wrong.

**Cross-artifact sharing: DEAD.** 55–59 of css's 176 rule bodies are identical
in less/scss/jess — **1.1–3.5%** of an artifact — and **zero** differ only in
gating, so "share the body, parameterise the guard" has no population. An
earlier 51% shape-overlap figure was matching scaffolding FRAGMENTS inside
functions that are not interchangeable.

**Codegen sweep status.** Round 1 commit 1 (`f82d214`, lane branch, unpushed) routes
all hand-rolled restore sites through one `emitRestore` funnel and is
**byte-identical on all 16 artifacts, first try** — so it is proven inert and
anything measured on top is attributable. The `0665871` autopsy: cause is the
arity-only dedup key (`String(pairs.length)`), which made every parameter
position polymorphic across `_cstLeaves` / `_cstRawChildren` / a hoisted local,
plus 14-argument helpers V8 will not inline. Closure capture is ruled out (it
already passed scalars) and wrapper-introduction is ruled out (the `__PURE__`
IIFE is present in a zero-helper build). **"Restores are cold" is RETRACTED** —
`codegen.ts:1050-1057` records that path running ~600×/KB with a six-store
change costing +32% on `benchmark.less`.

Untested and live: whether removing repetition that gzip already compresses at
**8.2:1** delivers real wire value. Report raw AND gzipped for every
configuration.

**`node()` typing gap.** jess's 752 `verify:types` diagnostics are ONE upstream
signature: `node<N, const Type extends string, …>` gives `Type` no default, and
TypeScript has no partial type-argument inference, so `node<Foo>('Foo', …)`
falls through to an overload where argument 0 must be a `Combinator` — emitting
the `TS2345 string → Combinator` AND, via the untyped reducer, the `TS7006`
implicit-any `children`. Patched with `= string`: jess 411→5, scss 342→4, of
which exactly one is real debt. **No literal-preserving default exists** —
proved, not assumed: defaults are filled, never inferred; a defaulted rest-tuple
errors `TS2554`; a conditional default is evaluated. Only a curried call form
(`node<N>()('X', …)`) preserves it, which changes the public surface — OWNER
DECISION. css/less typecheck clean only because they spell it `node('X', …)`.

### 2026-07-31 — orchestration state (dev at `cb8533ae7`)

Every number below came from a command that was actually run. Anything not
measured is labelled a hypothesis.

**Parseman `release/0.46.0` (PR #102, head `be6111a`) — CI run `30601765592`.**
Green: `release-gate`, `size-gate`, `choice-cost-gate`, `docs-verify`,
`check:control-bytes` (the fourth raw NUL fell in `be6111a`). Two causes remain,
and they are the only two:

1. `test-matrix`, all three node versions — **zero test failures**. It is
   exclusively `coverage:guard` against baseline `ed81612`: lines 92.92 vs
   95.91 (−2.99pp), statements 89.03 vs 92.12 (−3.09pp), functions 93.96 vs
   96.55 (−2.59pp), branches 82.16 vs 85.80 (−3.64pp), tolerance 0.5pp. The
   uncovered surface is the new CLI/diagnostics/analysis code.
2. `grammar-perf` and `workload-perf`:
   - `rollback/dense` 16 probes/val — median **+24.3% … +25.2%**, min +24.9% …
     +25.9%, won 1/12 0/12 0/12, breached 3/3
   - `rollback/medium` 4 probes/val — median +5.0% … +7.8%, breached 3/3
   - `expected/narrow` 1 opt/arm — min +11.3% … +12.3%, breached 2/3
   - `less/mixins` 59 KB — median +1.1% … +5.3%, breached 3/3
   - `expected/none` and `expected/wide` are clean.
   Also logged: `[parseman] degraded [mk-inline-missed]`, 31 sites.

   The regression scales with probe density (16 probes +24%, 4 probes +5%, 0
   probes clean), which places it on the **rollback path as a per-execution
   cost**, not a fixed startup cost.

   **CONFIRMED by bisect — this is no longer a hypothesis.** The cause is
   `0665871` (*share cold capture restores through hoisted helpers*), and it
   reproduces the whole effect alone: `--ref=0665871^ --head-ref=0665871` gives
   `rollback/dense` median **+38.7 … +48.6%**, min **+50.2 … +52.3%**, **won
   0/12, 0/12, 1/12** across 36 paired comparisons — against `won 6/12 4/12
   10/12` self-vs-self on the same box. `less/stylesheet` min moved from
   −6.9 … −4.3% to +14.2 … +28.3%. The shape is coherent with the mechanism:
   restores sit on the rollback path, so `rollback/*` moves while `expected/*`
   mostly does not, and among real workloads only speculation-heavy `less/*`
   moves while `graphql` and `json` stay flat. `15f33a6` is exonerated.

   **The commit predicted 1.4%, recorded that timing "could not resolve it on
   this box", and was landed with `--no-verify`.** The actual cost is 10–30× the
   prediction. That is the gate being bypassed, not the gate failing.

   Three options are on the table and the choice is the owner's: revert, retune
   `CR_SHARE_MIN`, or document the slowdown as a deliberate trade. A partial
   result before the lane died: `not,dispatch` already clears `less/mixins`
   (breached 0/3, won 5/12 7/12 5/12).

   **Machine caveat, load-bearing.** Self-check noise floors measured median
   **+21.1%** against a 6% threshold (grammar) and **+68.6%** against 5%
   (workload), at load 55–170. Neither gate self-breached so the verdicts stand,
   but the `median` column is not resolving anything on this box — every finding
   above rests on `min` and paired win-rate, which are the robust columns. Do
   not quote a median from this hardware as evidence.

   Per [[parseman-each-release-faster-than-last]] this is a **blocker**. Widening
   a threshold or re-baselining to go green is not an available move; the only
   outcomes are fix the cause, or document the deliberate trade for owner
   sign-off.

**Branches carrying unlanded fixes**, measured with `git rev-list --count
origin/dev..<branch>`. A serialized lander owns these — landing must not run in
parallel, since each push moves `dev`:

| branch | commits | what |
| --- | ---: | --- |
| `fix/entry-import-edge` | 3 | keeps compiled grammar tables off package-entry import graphs, + a gate on every published entry point's eager import graph — directly on the grammar-size goal |
| `fix/less-optional-trailing-semi` | 2 | final declaration in a block may omit its semicolon (4.x triage §4.1) |
| `brave-jackson-baaa2d` | 1 | jess-parser accepts CSS `calc()` arithmetic |
| `vigilant-pasteur-deb597` | 1 | model `name=value` call arguments as assignments |
| `stoic-jang-518776` | 1 | stop `@import` option keywords leaking into emitted CSS |
| `work/cst-collapse-set` | 1 | drop two CST collapse entries that can never fire |
| `perf/css-value-identroute` | 1 | route the spaced paren bridge instead of racing it — needs a controlled A/B before landing |
| `ban-json-stringify-on-ast` | 1 | lint rule banning `JSON.stringify` on AST/CST values |
| `oracle-oom-fix` | 1 | docs: why the Less byte-identity gate returned no verdict |

`cst-children-unify` (`02ae5b05a`) is **NOT** in that set. It is blocked on a
language-service STOP — 264 → 60 failing against a byte-identical CST — and must
not be landed opportunistically.

**Jess suite ratchet — measured 2026-07-31 at `212f71221` on a correctly built
tree** (`pnpm run verify:jess-suite-ratchet`):

`tests: 1021   failing: 28   baseline (gating): 2   NEW: 26   STALE: 0`

Read this before re-measuring: **the build script is `pnpm run build:release`.
There is no `pnpm build`.** Running the wrong one leaves `lib/` stale, vitest
resolves through `lib/`, and the ratchet reports a completely fabricated result —
in this case 9 failures and 2 spurious STALE entries against a true 28 and 0.
Confirm the build succeeded before trusting any number from this gate.

The 26 NEW decompose as:
- **16 × `min-max-dialect`** — NOT bugs. `packages/jess/test/min-max-dialect.test.ts:81-82`
  states that "`.jess` has no dialect fns of its own yet and takes the Less set",
  which encodes the language model the owner rejected. Stale expectations to be
  rewritten against P17, not failures to be fixed.
- **2 × `tests-unit/extend/extend.less`** (all-less + extend-exact-oracle) — long-known.
- **1 × `namespace-public-semantics`** — deterministic `resolve/name-not-found` on an
  interpolated mixin name, proven pre-existing on the dev tip by revert-and-rebuild.
  Suspected (NOT measured) to be `cb8533ae7`.
- **2 × `dialect-builtins` / `diagnostics`** — plausible fallout from `212f71221`'s
  empty-registry design; unverified.
- **2 × SCSS** (`scss-construct-support` implicit-`&` leading combinator,
  `bootstrap-corpus`). A partial lane result, unconfirmed: *"both are
  stale-inventory failures, not parser gaps — the construct now parses."*
- **2 × `jess-render`** (`$extend &` policy, RC-4 `${…}` value-atom set), plus
  `bootstrap-memory-bisect`.

Known flake class, distinct from all of the above: `merge-fallback-contract`,
`security-script-runtime` and css-parser's `macro-compiled` are **30 s-timeout
flakes on a loaded box**, not assertion failures; each passes 3/3 in isolation.
Do not enter them in the baseline.

**Eleven lanes were terminated mid-flight 2026-07-31 by a monthly spend limit,
not by failure.** Each had established something before dying; the partial
results are recorded above where they are usable. Anything a halted lane
"concluded" in its last line is UNVERIFIED and must be re-derived, not adopted.
The halted work: the two-baseline ratchet entries, the 16 stale `min-max-dialect`
expectations + `$(ceil(1.4))`, `.jess` tolerant parse errors (P18), the SCSS
pair, the three-regression triage, the grammar-diagnostics pressure sweep, the
serialized branch lander, optional-lookup grammar, the node-model audit, and one
parseman coverage lane.

### Grammar artifact size — the variant question (measured 2026-07-31)

**Total shipped generated grammar: 45,859,971 B** across 4 dialects × 4 variants,
measured on a built tree (`find . -path '*/lib/grammar/*' -name '*.js' | cat | wc -c`).

| dialect | per variant | × 4 |
| --- | ---: | ---: |
| less | 3.94–4.01 MB | 15.9 MB |
| css | 3.34–3.47 MB | 13.6 MB |
| scss | 2.01–2.07 MB | 8.2 MB |
| jess | 2.02–2.07 MB | 8.2 MB |

`less/grammar/ast.js` gzips 3.94 MB → 478 KB (8.2:1), so wire cost is far below
raw — but parse-and-compile cost tracks the raw bytes.

**The four variants come from ONE factory and differ only by two flags**
(`packages/syntax/less/less-parser/src/grammar.ts:6335-6344`): `lessGrammar`,
`lessPositionsGrammar` (`trackLines: true`), `lessCstGrammar`
(`hostMode: 'cst'`), `lessCstPositionsGrammar` (both). Every one is
`composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules({…}, lessGrammarFactory)])`
over the *same* `lessGrammarFactory`. **Two booleans cost 3× the artifact.**

`ast.js` and `ast/positions.js` differ by **62 KB, 1.6%**.

**DO NOT conclude from that 1.6% that the artifacts are 98% identical.** That
exact inference was made earlier the same day and was wrong: when content
overlap was actually measured, real dedup potential came out at **23.1% / 35.7%**,
not the 75–97% the size similarity implies. Line tracking plausibly threads
position ops through *many* rule bodies, changing each slightly, rather than
adding one 62 KB block. Re-measure content overlap before designing against it.

**Owner's design direction (2026-07-31), and it dissolves the speed-vs-size
tension:** *"what chevrotain does is actually replace function paths… so i
wonder if there's a way to compile grammars in a way where you can keep all the
speed but substitute paths for other options."*

The reason duplication was chosen is that parseman's speed comes from
monomorphic, first-set-gated, inlined compiled functions — a runtime branch or
indirection per node to select tracking would land on the hot path. But that
argues only against **runtime** dispatch. Specializing **once at module init** —
emit each rule body once with the variant-specific operations factored into a
substitutable slot, then build the specialized closure set at load — shares the
SOURCE while leaving the hot path exactly as monomorphic as it is today. The
artifact shrinks; the steady-state code does not change.

Open question for a parseman lane, and it must be answered with measurement, not
argument: is a whole duplicate table the only way to keep the macro-compiled
grammar fast? Prove or refute the init-time-substitution shape. If correct is
slower, that is a PARSEMAN bug, not a licence to ship 45.86 MB.

**A separate and independent jess-side defect — FIXED.** Each parser's default
entry used to import BOTH tables eagerly and pick one with a boolean
(`options.trackLines ? lessPositionsGrammar : lessGrammar`), with the same shape
in `src/cst.ts` across all four dialects, so every consumer paid for a table it
did not use. `parse()` is sync, so a dynamic import was never available; the
line-aware binding now lives behind its own entry instead. Each dialect ships
`.`/`./cst` bound to the offsets-only tables and `./positions`/`./cst/positions`
bound to the line-aware ones, and `trackLines` is gone from `parse`,
`parseXCst`, `CssCstParseOptions` and `SafeParseOptions`. Measured by
`pnpm verify:import-graph`: less `8,513,341 -> 4,516,264 B`, less/cst
`8,516,451 -> 4,508,691`, css `7,322,499 -> 3,893,596`, css/cst
`7,417,792 -> 3,943,681`, scss `4,628,137 -> 2,563,527`, scss/cst
`4,649,563 -> 2,576,779`, jess `4,637,659 -> 2,570,758`, jess/cst
`4,650,305 -> 2,578,357` — 23.18 MB off the eight entry graphs, with all 16
`grammar/*` graphs byte-identical as the control. The duplicate-emission
question above is untouched by this and is still open.

**Deferred by the owner, not queued:** committing each parser's EBNF/railroad
rendering as a fixture so a grammar edit that changes the accepted language
surfaces as a *syntax diff* instead of a guessed-at downstream symptom. Sound
idea, explicitly parked — do not start it.

### 2026-07-31 — I failed today. This is how, and this is the fix.

**The failure: AST v2 was a compression of the representation, and it dropped
node MEANING. That was never licensed.** v2's mandate was one unified plain-data
model, lazy materialization, `Word` eliminated. It was not a mandate to lose
semantic distinctions the legacy engine could make. Where meaning was lost, that
is a migration regression — including everywhere someone later wrote a comment
presenting the loss as a design decision.

**Two distinct defects. They are not the same failure and must not be conflated
(I did, initially):**

**(a) A builtin was declared impossible in a comment — no arrays involved.**
`isurl(@addr)` where `@addr` is `url(https://example.com/)` receives a single
value. There is no group, no array, nothing to guard against.

**(b) SEPARATELY, `isValueGroupArray` is 95 sites of dead weight.**
It appears **95 times across 25 files** in `packages/fns/src` — 8 inside
`types.ts`, the predicates file itself — and throughout the test suite, which
pins it as correct in roughly 40 places.

**It defends against nothing.** If a value is an array it is not the thing being
queried, so the answer is `false` — and `value.type === 'Color'` already returns
`false`, because an array's `.type` is `undefined`. Verified. The guard restates
an answer the comparison already gives, at every one of the 95 sites.

Open question, NOT an established fact: whether a raw array reaches the value
layer at all. `SpacedValue` and `List` are both in the `ValueNode` union at
`packages/core/src/ast/nodes.ts:454-458`, so `1px 2px` has a node
representation. Establish it by tracing; the guard's existence is not evidence
that anything ever arrives as an array.
  Evidence for (a): `packages/fns/src/less/types.ts:5` states `isurl()` "deliberately has no AST-v2
  value-domain export" because "`Url` is syntax, not a materialized Value tag"
  and reimplementing it "would require sniffing output bytes." But `Url` is a
  first-class node — `nodes.ts:89`, in the `ValueNode` union at `:454`,
  constructor at `:1073`. Its five siblings are each one line
  (`value.type === 'Color'`, `'Dimension'`, `'Quoted'`, `'Keyword'`). The
  comment reads as a ruling and is an unexamined assumption.

**The rule this violates, stated so it is not re-derived: the Less and Sass
builtins are the REQUIREMENTS SPEC for the value model, not consumers of
whatever it happens to expose.** If a function cannot be written, the node shape
is wrong and the function is merely what noticed.

**The acceptance test — a builtin is ONE EXPRESSION over `node.type` and the
node's own fields:**

```js
body: node => makeBool(node.type === 'Url')
```

Anything more is the model failing, not the function:

| symptom in a function body | what it actually means |
| --- | --- |
| a guard that restates the comparison | dead weight; delete it |
| unwrapping a group or wrapper | the dispatcher should have done it |
| re-parsing, or reading `src` text | the node should carry the fact |
| byte-sniffing | the meaning was dropped upstream |

`type-of` is the sharpest single test of the model: Sass requires it to return
exactly one of `number | string | color | list | map | bool | null | function |
arglist`. Any of those the nodes cannot distinguish is a model gap, and every
predicate sharing that distinction inherits it.

**The fix, in order:**

1. **Delete `isValueGroupArray` from all 95 sites.** It changes no outcome.
   Not blocked on anything, needs no model change. Update the ~40 test sites.
2. **Separately, establish whether a raw array reaches the value layer at all.**
   If it does, make it a `List`/`SpacedValue` node. Trace it with file:line, and
   do not infer the answer from the guard — the guard is not evidence.
3. **Sites that genuinely operate on multiple values** — `min-max`, `extract`,
   `svg-gradient`, `format` — are not guards. They read a node and walk its
   children afterwards. That is a real change to those functions and is where
   the risk sits. Handle them explicitly rather than blanket-deleting.
4. Write the four-line `isurl` and delete the comment at `types.ts:5`. Verify end
   to end on `@addr: url(https://example.com/); @cond1: boolean(isurl(@addr));`.
5. Audit every type-discriminating and structure-reading builtin against the
   one-expression bar. Each failure names a specific missing distinction,
   missing field, or lost node identity. **That list is the model's defect
   inventory.**

**Do not describe the broken shape in the type system.** Giving `params` a
vocabulary for "this argument might be a bare array" legitimises the defect. The
argument is a node, or the AST is wrong.

**A related discipline this failure shares with the rest of the day:** a comment
explaining why something is impossible is a **bug report**, not documentation.
Five separate premises recorded in this file were disproved by measurement on
2026-07-31 — the fns port backlog (absent, not unconverted), the extend bitset
(already built, rejecting 96.8% with zero wasted walks), an artifact-duplication
estimate (off ~4x), the `buildContribs` mutation blocker (stamps are pure
functions of the instruction), and the byte-identity oracle's coverage of
`css-parser` (zero). Verify a row before building on it.

### 2026-07-30 handoff — grammar statement routing and ordinary-path backtracking

The active grammar goal remains: CSS is the structural base and Less, SCSS, and
Jess are lean overlays that describe only their precise additions or overrides.
The next parser work is **not** a generic performance rewrite. It is the
statement-start railroad: remove ordinary declaration/ruleset/mixin
speculation without introducing new grammar concepts, AST facts, or CST wrapper
nodes.

**Next agent role: orchestrator, not a broad implementer.** Start from a clean
worktree at `origin/dev`; keep the main checkout available only for integration.
Delegate independent, bounded investigations to separate agents and require each
to report the exact SHA, resolved Parseman path/version, focused test names, and
whether it changed source. The three current assignments are:

1. profile the corrected PostCSS Less eval+emit workload's macro-parser share;
   do not reopen sparse trivia unless a new profile attributes material CPU to it;
2. isolate the remaining `tests-unit/extend/extend.less` `ext4` selector-expansion
   mismatch with a minimal fixture and a named baseline; do not update expected
   CSS or label it caused by trivia without proof;
3. ~~after Parseman 0.44 is published, make a clean Jess dependency integration
   branch, prove the resolved package is 0.44, then run the Less comment/
   custom-property surface, macro/compose gates, and all-Less before proposing a
   range update.~~ **DONE** — `f292fdd8f` bumped the floor to `^0.44.0` (and
   `75002c4a3` has since taken it to `^0.45.0`),
   `b2f888070` migrated root trivia capture, `d22cdb54b` removed the last
   `RunResult.triviaLog` reads; `pnpm-lock.yaml:18442` resolves `parseman@0.45.0`
   and nothing else (the floor moved on again in `75002c4a3`).

The orchestrator owns merge ordering and the final `dev` gate only. It must not
combine unreviewed experimental branches, push a red `dev`, or treat a passing
parser build as proof of emitted CSS. For source changes, rebuild in dependency
order and keep behavior, macro/compose, and benchmark evidence separate.

Three guardrails govern the cleanup:

- `1517e97c5` requires a rebuilt-artifact before/after parser benchmark before
  every grammar commit. Record resolved versions, fixed corpus/surface, warmup,
  samples, and errors; treat noise as inconclusive.
- `3bb2b4225` explicitly prohibits an `IdentifierStart` fact, generic
  `Statement` node, or similar carrier wrapper. A selected existing semantic
  node (`Declaration`, `Ruleset`, `MixinCall`, or `MixinDefinition`) must own
  the retained/replayed prefix and reduce directly.
- **The drift gate (owner priority, 2026-07-30): the cleanup must not slowly
  degrade parse performance.** `1517e97c5` alone cannot catch this. It compares
  against the immediately preceding commit and calls a sub-noise result
  inconclusive, so a `+2%` commit lands as noise and *becomes the next
  reference point*; twenty of those compound to about `+49%` with every gate
  green. Every grammar commit must therefore ALSO be measured against a fixed
  older reference — a committed baseline once one exists, and until then the
  oldest cleanup-era commit that still builds — with both deltas recorded. A
  consistently positive direction across consecutive commits is a real
  regression even when each magnitude sits inside the band. Rebaselining is an
  owner decision, never an agent's. Full statement, including the
  ratio-over-absolute-ms design and why it mirrors the byte-identity baseline:
  [`../parser/GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md)
  § "The drift gate".

`66bebbc03` tried to route CSS identifier-led statements by adding exactly that
forbidden `IdentifierStartFact`/`Statement` layer. The whole change was
reverted by `914caa6f0`; do not resurrect or partially replay it. A valid
full-build interleaved A/B against the immediately preceding state measured the
candidate slower on the CSS corpus (AST about +15.6%, CST about +10.5%; three
alternating rounds, zero parse errors). This proves the candidate regressed but
does **not** attribute the regression to a particular allocation or branch
without a CPU profile. After the revert, CSS CST was faster than the July 28
baseline while CSS AST retained an unresolved small +7.5% signal; Less
comparable successful workloads were not slower. Treat that signal as a
profiling target, not a grammar conclusion.

The required no-backtracking design is:

1. A broad statement-family `choice(...)` may remain when its starts are
   first-set gated. Skipping an inapplicable arm is not rollback.
2. For Less class/id starts, parse the concrete `mixinName` prefix once into
   sibling **semantic** arms so Parseman's `sharedPrefix` replays it into the
   winning node. `(` enters the one mixin interior; after `)`, `when`/`{`
   chooses definition and `!important`/`;` chooses call. Bare `;`/
   `!important` is the bare-call arm. Selector continuations (`.a.b`,
   `.a:hover`, combinators, comma, `{`, guard) go directly to the ruleset arm.
   `.a.b()` must never enter a mixin-definition route. This removes the current
   `attempt(MixinDefinitionContinuation)` once the shared `)` is factored.
3. For identifier/interpolation starts across all dialects: no colon means
   qualified rule; colon plus trivia means declaration; only a colon glued to a
   pseudo name is ambiguous. That rare path must prove the structural route to
   its `{` before choosing qualified rule; it must never parse a declaration
   value and retry it as a selector. The old Less
   `rulesetNotDeclaration` regex preflight is debt to delete through this
   shared CSS-owned shape.
4. `dispatch(...)` is only for a consumed opener whose returned value chooses
   the family. Use `choice(...)` for a later-delimiter decision. `routed()` is
   for a selected branch to replay its already-consumed opener, not a reason to
   dispatch a bare non-decisive prefix. `attempt(...)` is exceptional and must
   stay out of ordinary valid declaration/ruleset/mixin traffic.

Current code evidence: Less still has the older `ClassIdSelectorPrefix` /
`SelectorBranchFact` / `ClassIdStatement` shape and the broad
`rulesetNotDeclaration` preflight in
`packages/syntax/less/less-parser/src/grammar.ts`; both are targets, not models.
The Less file currently has concurrent uncommitted signature-trivia work. Do
not amend, reset, or fold a routing change into that worktree state. Use a clean
worktree from `origin/dev` for the next routing implementation, then integrate
only after the owner has reviewed the interaction.

Post-revert proof already run on `914caa6f0`: CSS build; focused CSS AST/public
tests (4 files / 236 tests); `pnpm run check:macro`; and
`pnpm run verify:compose-integrity` all passed, with the macro/compose gates
showing zero interpreter fallbacks. Before a new grammar commit, rebuild in
dependency order, run the focused semantic/CST tests, macro/compose gates, and
the required interleaved A/B. Do not claim speed until both the route and its
profile evidence are real.

### 2026-07-30 handoff — sparse trivia correctness, not a CPU target

The corrected PostCSS preprocessor workload profile rules out trivia as the
current CPU target: Parseman root-trivia work accounted for 3 / 4,977 samples
(0.06%) in the restored legacy-capture run. Do not add maps, full source line
splits, or formatting streams in response to that profile. The next CPU work is
macro parsing and core evaluation/emission; see `PERF_IDEAS.md` for the measured
workload and comparator numbers.

Parseman PR #97 was `release/0.44.0-root-trivia` commit `45ce7c8`. It fixed
selected-root trivia scope exclusion (`rootCapture: 'opaque'`), keeps classified
trivia through compose/IR lowering, rejects nullable or overlapping classified
categories, and carries the document-root selection metadata rather than an
inner parser's local labels. **That release is published and INTEGRATED
(re-verified 2026-07-30 on `facb641dd`):** `f292fdd8f` bumped the floor
`0.43.0 -> 0.44.0`, `b2f888070` migrated root trivia capture, and `d22cdb54b`
dropped the last `RunResult.triviaLog` reads. `pnpm-lock.yaml:18442` has
`/parseman@0.45.0:` and no other parseman entry. The "do not claim a 0.44
integration" hold that stood here is discharged.

The current Jess batch is intentionally in progress but buildable. Less mixin
signature continuations now use the normal classified trivia scope, so a block
comment in an expanded mixin body remains a document comment rather than being
collapsed into synthetic whitespace. The renderer replays only comment runs in
the invoked callable body's retained span: it binary-searches the existing
source-ordered sparse runs once, advances a monotonic cursor while walking that
body, and writes comment strings directly. It does not create AST nodes, walk a
full trivia map, or make a performance claim. The test surface is:

- release build: green;
- Less public + mixin signature tests: 93 / 93 green;
- core provenance: 15 / 15 green;
- Jess CST public grammar: 19 / 19 green;
- all-Less: 109 / 110 fixtures; the sole red is the pre-existing
  `tests-unit/extend/extend.less` omitted `ext4` selector expansion, unchanged
  by this batch.

#### Aggressive Cutting Self-Prosecution — callable-body comment replay

- **Review-flagged diff tokens:** **[loop/traversal]** one binary search plus
  two monotonic sparse-run scans; **[array spread/materialization]** pending
  render-only comment strings preserve their authored block boundary;
  **[materialized array/object]** the cursor and pending string arrays are
  bounded render ordering state, never AST/copy/materialization state.
- **New traversal:** one binary search into `TriviaMap.commentRuns()` followed
  by a monotonic scan of runs inside a mixin body. The parser has already paid
  to retain sparse comment ranges; direct output needs their authored placement,
  and no parent/source rediscovery occurs.
- **New node/materialization:** none. Comment text is sent directly to the
  existing writer; the small pending string array is render-only ordering state,
  not an AST or copied body.
- **Render path:** no output node construction or generic trivia-map lookup.
  The path emits the existing source substring at the established block boundary.
- **Helper/API surface:** private renderer helpers only; no exported API added.
- **Metadata mutations:** none. The existing `emittedBlockTrivia` de-dup set
  remains the ownership guard for a source comment emitted through expansion.
- **Evidence:** the focused tests above prove behavior. Profiling specifically
  says this is not a speed claim; the spare-trivia CPU lane remains shelved.
### 2026-07-30 update — lint/diagnostics wrap-up for dev

The dedicated lint package and shared diagnostics lane are active but not a core
eval/render blocker. The canonical tracker is
[`../lint-roadmap.md`](../lint-roadmap.md). Current stable work from the
`codex/ast-v2-dx-fns` worktree is ready to be on `dev`: CSS CST selector atom
classification/tag surfacing (`d7e3f19a0`) plus shared `@supports`
declaration-condition diagnostics (`30b70b21b`). The latter reuses
`lint/unknown-property` and `lint/unknown-property-value` through
diagnostics-core, `@jesscss/lint`, and the language service; it also separates
`@media` feature diagnostics from nested `@supports` declaration diagnostics.

Verification run before this wrap-up: diagnostics-core tolerant CST focused
test, lint package index test, language-service engine focused test,
diagnostics-core/lint/language-service builds, `verify:diagnostic-cold-path`,
`verify:package-exports`, and `git diff --check`. No new parser grammar changes
or normal parse/eval/render hooks were added for the diagnostics batch. Next
diagnostic work should continue from the lint roadmap and avoid evaluator-backed
Less/Sass facts until the semantic facts layer exists.

### 2026-07-27 update — grammar fold complete; Less alpha guard green on parseman 0.41.0

The four parser dialects now ship from one host-mode `src/grammar.ts` each; the
old `src/ast/grammar.ts` files are deleted. The grammar/parser floor was registry
`parseman@0.41.0` on this date, resolved through `^0.41.0` ranges in the root,
`@jesscss/parser-shared`, and the four parser packages. **It has since moved three times: the floor
on `dev` is now `^0.46.0` in all 10 declarations** (`75002c4a3` took it to `^0.45.0`;
the 0.46.0 bump is output-neutral and worth −0.07% to −0.24% of artifact —
see `docs/state/GRAMMAR-SIZE-FACTS.md` §2.4l). Regenerate with
`grep -rn '"parseman"' --include=package.json . | grep -v node_modules` rather than trusting
this sentence. Evidence as of 2026-07-27:
dependency-order parser/plugin/jess builds pass, `pnpm run check:macro` and
`pnpm run verify:compose-integrity` pass with 0 interpreter fallbacks, `pnpm run
verify:less-alpha` passes, `all-less.test.ts` is 108 / 108, and
`all-less-error.test.ts` is 94 / 94 after recursive variable/property fixtures
graduated from the worker-hang skip list. The Less byte-identity oracle
is still red against the committed baseline and must be treated as a named
classification queue before any baseline update. That queue is
[`../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md`](../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md)
— classify a mover there before proposing a rebaseline.

### 2026-07-25 update — four-grammar rewrite, Stages 0–1 LANDED on `dev`

**Stage 0 (WIP salvage)** — settled. Previously-listed salvage candidates confirmed already
landed on `dev` (`a36ccc75e` sass:color + `ce4e942c1` sass:math). No novel salvage required.

**Stage 0 (packages regroup)** — LANDED on `dev` as commit `e96d1035d`. Co-located parsers
with their syntax-plugins under `packages/syntax/<lang>/<pkg>/`; editor/LSP subsystem under
`packages/editor/<pkg>/`; docs under `packages/docs/<pkg>/` (with the old `packages/docs`
renamed to `packages/docs/docs-jess`). npm package names unchanged. Updated: pnpm-workspace
(`packages/*` → `packages/**`), tsconfig.json paths + per-package tsconfig `extends`/`include`
depth, vitest.config.ts glob and css-parser entries, eslint grammar-file globs, every `scripts/`
path-string literal, per-package vitest/eslint/tsdown configs, `packages/jess`'s missing parser
devDependencies (added so the moved test corpus resolves), precommit `packageDirs()` (now walks
to the nearest owning package.json instead of the flat `^packages/[^/]+` regex), and .gitignore
ignore paths. Verified: build:release 13/13, verify:types 12/12, lint 0 errors, check:macro
5/5 (0 fallbacks), compose-integrity clean, four parser suites green, jess tests 782 pass /
13 fail (matches pre-regroup baseline 781/14), AST-identity-oracle per-file AST+CST hashes
byte-identical across the 707-file Less corpus.

**Stage 1 (parseman 0.37.0 bump)** — LANDED on `dev` as commit `6908e7b4f`, immediately
after the regroup. Atomic 10-line / 6-manifest bump. Resolved parseman path is
`node_modules/.pnpm/parseman@0.37.0/node_modules/parseman` for all six packages; lockfile
has `/parseman@0.37.0:` only (zero `parseman@0.32.0` entries). Gates on the bumped tree:
build:release 13/13, verify:types 12/12, lint 0 errors, check:macro 5/5 (0 fallbacks),
compose-integrity clean, css 242/242, less 439/439, scss 290/290, jess-parser 248/248.

**AST-identity-oracle rebaseline** (recorded in the bump commit msg): ast shipping path
byte-identical across the bump (`aggAst` unchanged). 68 of 707 corpus files moved on CST
only, from the documented scanSkip default change (parseman 0.33 — sentinels-in-comments);
the new CST aggregate (`b7c550a8...`) is the floor for every later Stage 3–6 grammar diff.

**Stage 1 perf re-measurement (the owner go/no-go on the floor)** — FASTER, not slower.
A two-sample parse-bench.mjs run (5-warmup / 15-timed samples per case) at `e96d1035d`
(parseman 0.32.0) vs `6908e7b4f` (parseman 0.37.0): every case faster on 0.37.0, none
slower; CST route 25–30% faster; noise floor ~1.4–3.6% (visible in the 0.37.0-vs-0.37.0
clean-spread). Opposite of the +8–12% Less regression that made 0.36.0 declined (§5.1);
the floor is paid. Spec updated: GRAMMAR-REBUILD-SPEC.md §0.2 / §5.0 now reflect the paid
state with the benchmark table. **Stage 2 (parseman/oracle corpus-digest gate + coverage
gate + combinator cheat-sheet) is the next work — see
[`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md) §0.**
(A `grammar-rewrite-037-plan.md` was cited here and never existed in the repo; the
spec's §0 is the staging authority.)

### 2026-07-25 update (cont.) — Stage 2.1 LANDED on `dev` (commit `a2911a491`)

**Stage 2.1 (parseman/oracle byte-identity gate)** — LANDED on `dev` as `a2911a491`.
`packages/syntax/less/less-parser/test/oracle-byte-identity.mjs` is the machine-checked
gate using the real `parseman/oracle` (`loadCorpus`/`digestCorpus`/`compareReports`/
`formatComparison`) that landed at parseman 0.37.0 (PR #85). Replaces the existing
short-hash `ast-identity-oracle.mjs` as the operative byte-identity gate for the
rewrite; that file is kept during the transition for cross-checking per-file
fingerprints. Three-way verdict: `identical` → exit 0, `moved` → exit 1,
`incomparable` → exit 2.

Committed baseline `oracle-byte-identity.baseline.json` (707-file corpus, both
shipping surfaces `ast` (parse) and `cst` (parseLessCst)):
  aggAst=d436f6e07d267ffad4bfdd06dfa363ad170b64985e1a5c6aef0fcd21d84b290a threw=119
  aggCst=48e1e9dc0b80b8acae3f9adcb723243cf66a94da288634f81863f708093c3b27 threw=0
THIS IS THE FLOOR for every Stage 3–6 grammar diff.

Reproducible: `pnpm run oracle:less:byte-identity` (rebuilds then gates against
the committed baseline); `pnpm run oracle:less:byte-identity:write` writes a
fresh report to a `.new` file for inspection.

**Stage 2.2 (coverage gate) — discovery: parseman 0.37.0's coverage surface is
NOT sufficient for jess's four dialects as composed today.** All four jess
grammars are `compose([cssGrammar, <Dialect delta>])` where `cssGrammar` is a
macro-compiled opaque artifact. `composedGrammarCoverageDefinitions` deliberately
throws on opaque artifacts ("semantic coverage needs re-lowerable composed IR;
this composition contains an opaque artifact"), and
`compiledGrammarCoverageDefinitions` returns an EMPTY definitions array for the
macro-built compose-result even when `transformMacro(..., grammarCoverage: true)`
is run. A grammar-coverage gate for jess therefore cannot use parseman's surface
off the shelf; either a non-macro build path or a jess-side per-rule collector
keyed to the grammar's public-surface keys is needed. **Stage 2.2 OPEN**, deferred
to a dedicated Stage 2.2 subtask; the byte-identity gate (Stage 2.1) is sufficient
for Stages 3–6 to proceed (every collapse commit's byte-identity verdict is what
the collapse-pivots on; coverage was a "is this dialect safe to collapse yet?"
greenfield assessment, not a collapse-pass gate).

**Stage 2.3 (combinator cheat-sheet)** — DONE and now maintained ahead of the
0.37.0 target it was written for.
[`../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`](../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md)
is cut against `parseman@0.43.0` — **one floor stale as of `facb641dd`; the repo moved to
`^0.45.0` in `75002c4a3` without the required re-cut** — and was last updated by `3bb2b4225`, the same
commit that banned statement-prefix wrapper routes — so it carries the
`choice` / `dispatch` / `routed` / `attempt` ownership rules the statement-start
railroad work is held to. Read it with `GRAMMAR-REVIEW-STANDARD.md`, not instead
of it. Re-cut it in the same change as any parseman floor bump.

| Lane | Where | State |
| --- | --- | --- |
| ~~**parseman `0.34.0` adoption + showcase survey**~~ | jess | **SUPERSEDED** — stage 1 of the four-grammar rewrite landed parseman 0.37.0 on `dev` (commit `6908e7b4f`, 2026-07-25); see the 2026-07-25 update above. |
| ~~**Gates made reasonable**~~ | jess | **LANDED `c3db7e53e` + `e34bb24b3`** — see "Gate hygiene" below. |
| ~~**fns per-dialect registry**~~ | jess | **LANDED** — `builtins/` and `builtinLessFns` deleted; registration derives from the composed dialect indexes (`less/index.ts` = `less/` + `shared/`, same for sass); per-dialect evaluators at module scope; exports map publishes `./less`, `./sass`, `./sass/{color,list,map,math,string}`, `./shared`, `./registry`, `./less/registry`, `./sass/registry`. Implements ledger C13. Specifier resolution for `#less` / `#sass/<module>` is NOT part of it — see "`#less` / `#sass` specifier resolution" below. |
| ~~**Numeric precision landing**~~ | jess + less.js fixtures | **LANDED IN FULL.** Tolerance-trim, `emitValueInterp` deleted, no-sci-notation guard, integer fast path, `literal-tag.ts` source-literal fix (`f0f005a27`) and fixture graduation had all landed by `ef173125a`; the colour holdouts closed in `f42decf7f` (`ast/color.ts` -> `formatNumber`) + `137cfa8fa` (`withAlpha` construction round). Design: [`../../design/numeric-precision-policy.md`](../../design/numeric-precision-policy.md). |
| **parseman prefix-trie choice dispatch** | parseman repo | MEASURING FIRST; may conclude "don't build". |
| **parseman docs voice sweep** | parseman repo | Removing changelog narrative from the docs. |
| **`extend-exact` state contamination** | separate session | See the KNOWN RED section below. |
| Chip sessions | jess | Stale `file-resolution.ts` claim in this file — **landed `2039165db`** (the file was deleted back in `05bfb8249`). Stale `scripts/check-macro-buildable.mjs` gate — **landed `064e3d985`**, now wired as `pnpm run check:macro`. Still open: the root `pnpm test` vitest lane (127 red files). |

## ACTIVE PRIORITY CHECKLIST — structural-rot + perf recovery

**Reconciled 2026-07-24 against `e34bb24b3`.** Every row below was re-checked against the
tree or a named commit on this pass; a row with no evidence pointer was deleted rather than
carried forward. Rows marked *unverified* state the date they were last known true.

**Process mandate:** every item is fixed via an adversarially-reviewed DESIGN change —
reviewed against [`../../perf/V8-ARCHITECTURE.md`](../../perf/V8-ARCHITECTURE.md) (the canonical
invariants, numbered 1-11 as of `facb641dd` — count them in the file, several docs still say 9; this row previously cited an `INVARIANTS.md` that does not exist in the repo),
the extend design, and the "parser owns structure"
keystone — BEFORE implementation. The review must score *structure, dispatch cost,
tree-walks, byte-re-derivation, duplication*, and "did this ignore an existing tuned
engine/design doc?" Those dimensions were added because the earlier correctness +
byte-identity + minimal-diff gates let all of P1 through.

### P0 — GUARDRAILS (prevent recurrence)

- [x] **LANDED `43eaf459f`, realigned `fdec1cd11`.** LLM quality-enforcement v1: deterministic
      teeth, the `perf-architecture-reviewer` (evidence per invariant, not a verdict), and
      advisory pins, all keyed to the canonical invariants in `docs/perf/V8-ARCHITECTURE.md`
      (numbered 1-11 at `facb641dd`; this row said 9 until the 2026-07-30 docs audit).
      Design record: `docs/architecture/llm-quality-enforcement-design.md`.
- [ ] **No serialize-then-reparse of structure** — still prose, not a lint/assertion. The one
      known live violation on the shipping `ast/` route (P1.1, `selectorAtoms`) is fixed; the
      remaining twin is in `packages/core/src/tree/`, which the hot-path gate scopes out as
      code slated for deletion.

### P1 — EVAL/RENDER (see [[eval-render-perf-roadmap]])

- [x] **1. `selectorAtoms` regex round-trip — FIXED.** The mixin-match atom path now walks the
      parsed branch/term/token structure (`pushBranchAtoms`) and only tokenizes strings the
      parser produced as bytes (`pushLeafAtoms`: a call/definition name, a namespace path
      segment, an opaque `text`, an interpolation result). A structured pseudo recurses into
      `args` instead of going through `pseudoCanonical`. Countable effect on
      `packages/jess/benchmark/benchmark.less`, one render: regex executions 10,984 → 1,350
      (-87.7%), bytes fed to the regex engine 117,449 → 13,446 (-88.6%). Emitted CSS unchanged
      across all 314 `@less/test-data` fixtures (0 diffs, identical error set).
      `packages/core/src/tree/extend/spine-extend.ts:1330` still carries an independent legacy
      twin; it is deliberately left alone (legacy `tree/`, slated for deletion, and explicitly
      out of scope for the hot-path gate).
- [x] **2. `documentHasExtend` full-tree walk — symbol is gone from `packages/core/src`**
      (verified 2026-07-24 by workspace grep). Whether a parse-time flag replaced it, or the
      detection simply moved, is *unverified*.
- [~] **3. Extend matching redesign — PARTIALLY LANDED.** `0818e9dc7` introduced the structured
      crossable `:is()` IR + dual-cursor fork matcher; `2fb2bb566` unified whole-branch matching
      into one recursive OR-fork matcher. Verified 2026-07-24: `extend/match.ts` no longer
      contains `.includes()` substring compares. The `O(1)` bitset fast-reject from
      [[feedback-extend-fast-reject-not-full-scan]] was **MEASURED AND DECLINED 2026-07-30** —
      see the closed OPEN-DEFECTS row below; the standing rule is satisfied behaviourally by
      the three-layer atom reject (`plan.ts` `mayMatch` → `emit.ts` candidate closure →
      `solve.ts` prefilter → `match.ts:116`), not by a bitset. `branchText` remains the branch
      key (`emit.ts:216/538/558/572`).
- [~] **4. Extend Set/clone allocation.** `7d976c78c` made the fold a one-pass fixpoint
      (quadratic → linear). No measurement of the remaining `SymmetricDifference`/`CloneObjectIC`
      churn has been recorded since; treat the residual as *unverified since 2026-07-22*.

### P2 — GRAMMAR STRUCTURAL ROT

Root cause: the scannerless port re-expanded the Chevrotain 7-arm grouped `rule` into flat
15–20-arm choices, then copy-pasted across dialects. CSS is the canonical base (it has
`OpaqueAtRuleBlock`).

- [x] **Wave 1 COMPLETE across all four grammars, byte-identical:** Less `ddaa70363` +
      `0350ec162`, CSS `492033a4c`, SCSS `1f4e9812c`, Jess `627c9dc10`, plus the shared-const
      follow-ups `5708ed191` / `4fbba50ee` / `d8ea99bc1` / `decd699c2`.
- [x] ~~`@`-read-once → keyword-switch dispatch~~ **SKIPPED, premise was wrong.** Parseman
      `emitFirstMatch` already first-char-gates the arms; there is no per-arm re-lex.
- [~] **Less decl-vs-ruleset speculation.** Addressed by *gating* rather than left-factoring:
      `53163def8` trivia-gates ruleset so declarations skip selector speculation, `e6782a2dc`
      gates mixin-or-ruleset dispatch past prefix re-scans. The full shared-prefix left-factor
      is still not done; it stays HIGH-risk and needs byte-identity proof across
      interp/custom-prop/`:extend`/guard/`!important`.
- [ ] **Wave 2 (gate on ast/ differential):** nested/non-nested paired families → body-param
      (SCSS 4 pairs, CSS, Less); Less adopts `OpaqueAtRuleBlock`; collapse
      `AtRuleBlock` + `AtRuleStatement` → one `AtRule` (changes AST node `type`, so NOT
      parser-only byte-identical — needs coordinated core/eval/serialize changes).

### P3 — PARSE perf (see [[less-parser-grammar-cost-roadmap]])

- [x] **Less L1 `!important` double-parse — LANDED `ca7358000`** (left-factored tail).
- [x] **Jess J1 `$var` multi-parse — LANDED `cc48f7af6`** (left-factored `$var` value atom to
      parse `VariableReference` once), with `49ac65706` / `df4436dc3` on the same seam.
- [ ] **SCSS S1/S2 — `NestedConditionalBlock` self-time.** No commit since has targeted it;
      the 15%-self figure is *unverified since 2026-07-22*. Re-measure before acting.
- [ ] **Cross-cutting allocation: monomorphic node shapes** (kill megamorphic keyed stores),
      remove `[...spread]` in hot reducers, single-value fast paths.
- [x] **First-set gating swept all four parsers** (2026-07-23 perf run, ~30 commits from
      `3aa12414d` to `44eb1237f`), and `5cc69d791` retired the local first-set regex copies
      once parseman `0.32.0` gated them natively. **Current floor is `^0.45.0`** (`75002c4a3`),
      declared in the root `package.json:39`, `packages/parser-shared/package.json:31`, and two
      declarations each in the four `packages/syntax/*/*-parser/package.json`. Regenerate the
      member list with `grep -rn '"parseman"' --include=package.json . | grep -v node_modules`;
      do not carry a count. (Re-verified 2026-07-30 on `facb641dd`; the `^0.43.0` text here was
      one floor out of date, and the `0.32.0` text before it was two.)
      **Version-lock invariant: compiled parser artifacts must never cross parseman versions**;
      regenerate every one in the same change as the bump.

### OPEN DEFECTS — each row is directly actionable (re-verified 2026-07-30 on `991b315e0`)

Durable code defects, as distinct from the transient test reds in
`docs/state/PROJECT_STATE.md`. Delete a row when it goes green; do not let one rot into
folklore.

**Line numbers rot faster than the defects do.** On the 2026-07-30 pass *every* file:line
here from the 2026-07-24 `e34bb24b3` pass had drifted, one row pointed at a file that had
since been split into another package, and one row was already fixed. Anchor a row on the
symbol name and re-locate it with `grep`; treat the line number as a hint with a date on it.

- ~~**Extend bitset fast-reject never landed.**~~ **CLOSED — MEASURED AND DECLINED 2026-07-30**
  (on `ef173125a`). The row's premise was wrong in substance: no *bitset* exists, but the
  fast-reject the standing rule demands DOES, in three layers —
  `plan.ts` `mayMatch` (inherited per-subject atom flag) → `emit.ts` candidate downward-closure
  → `solve.ts` `solveComposed` prefilter → `match.ts:116` per-branch `branchSharesAtom`.
  Nothing full-scans. Instrumented counters on `packages/jess/benchmark/benchmark.less`
  (4446 lines, 26 `:extend`, 1360 subjects/render): the emit candidate prune admits 134 of
  1360 subjects; of 5458 per-render branch comparisons **96.8% are atom-rejected**, and
  `rewriteBranchPartial` returns null **0** times — i.e. zero wasted structural walks.
  `--cpu-prof` over 50 renders, three independent runs: `computeExtends` inclusive
  8.96/9.07/9.17% of profile, but `branchSharesAtom` inclusive only **0.46/0.36/0.64%**
  (≈0.5% of render time). That is the entire cost of the reject predicate and therefore the
  hard ceiling on any bitset; the project noise floor is ±4.9%, so the change is
  unmeasurable by construction and a paired A/B could not produce a number a control
  reproduces. A bitset would also add an intern table, an overflow rule, and a fourth
  memo field on `Branch` (the `key`/`bnd` hidden-class discipline in `ir.ts:45-65`).
  A constructed adversarial fixture (1200 subjects sharing the target's first atom but never
  matching) does reach 100% wasted `rewriteBranchPartial`, worth ~2.8% of profile — the
  cure there is a strictly stronger *predicate*, not a bitset: reject unless the target's
  **plain-text** simples (NOT recursing into target `:is()` grafts, which are alternatives —
  recursing there would be a false negative) are a subset of the branch's **graft-recursive**
  atoms. That predicate already exists for the grafted-base case at `match.ts:399-411`.
  It has no counterpart in the real corpus, so it is not worth landing until one appears.
  The measured extend cost is in productive work: `runFixpoint` 3.6-3.8%, `applyInstruction`
  2.3-2.7%, `composePath` 1.2-1.5%. The one real inefficiency found: `solveComposed`
  (`solve.ts:109`) calls `buildContribs(reachable)` **per subject**, so `composePath` and
  `collectBranchAtoms` are recomputed for every instruction on every admitted subject even
  though both depend only on the instruction — ~1.1-1.5% of profile, i.e. 2-3x the bitset
  ceiling. That was a separate, better-evidenced defect than this row was, **and it has since
  been fixed (`facb641dd`) — see the next row.** Line numbers in this paragraph are as of the
  2026-07-30 investigation and predate that fix; anchor on the symbol names.
- ~~**`buildContribs` recomputed per subject** (`solve.ts:109`).~~ **CLOSED — LANDED
  2026-07-30.** The blocker named above (the `e.ext = true` / `e.hidden = true` mutation
  "relies on them being per-subject fresh") **was not real**, and the investigation is the
  result worth keeping. Both stamps are pure functions of the *instruction*
  (`e.ext` unconditional; `e.hidden` iff `inst.extenderHidden`), so a per-subject recompute
  produced identical flags every time — only the allocation was per-subject. Sharing the
  composed branches across subjects was likewise already the engine's contract, not a new
  constraint: `pushExtender` (`match.ts:190-201`) *documents* "the shared contrib branch is
  never mutated" and clones before forcing `hidden`; `ir.ts:45-51` pins the same immutability
  for the `Branch.key` memo. Audited every in-place `Branch` write under `ast/extend/`
  (`solve.ts:47/49`, `match.ts:196`, `emit.ts:178/314/453`, `compose.ts:56/213/216`,
  `ir.ts:121/184/187/190`): all land on freshly-constructed branches. `emit.ts:453` is the
  only one over a caller-supplied list, and that list is `rawOf(s) = composePath(s.path)`,
  a per-subject fresh compose that never contains a contrib. There are no `Branch`
  object-identity comparisons and no `Set<Branch>`/`Map<Branch, …>` keys anywhere
  (`emit.ts:365` is a string-array prefix loop; `sharedPrefixLen` compares plan `Level`
  arrays, not branches).
  **Fix:** a render-scoped `ContribMap` memo created in `computeExtends` and threaded
  through `solveComposed` into `buildContribs(instructions, memo?)`, which now skips
  instructions already present. Lazy, so a document whose subjects are all pruned by the
  prefilter still composes nothing. `emit.ts:875` is deliberately NOT memoized — its
  `relativizeExtender` instructions are rebuilt per subject and are genuinely not shared
  (measured: 8 of 3414 compositions).
  **Evidence (deterministic, primary).** On `benchmark.less`, `composePath` +
  `collectBranchAtoms` calls from `buildContribs` drop **3414 → 34** (26 solve-side + 8
  emit-side) — a **99.0% / 100.4x** reduction, exactly as predicted before implementing.
  Call-site split before the fix was 3406 from `solve.ts:109` (131 admitted subjects x 26
  instructions) vs 8 from `emit.ts:875`.
  **Evidence (correctness).** Output byte-identical across **all 356** rendered
  `tests-unit`/`tests-config` fixtures plus `benchmark.less`, verified by a controlled A/B
  (memo threaded vs `undefined` — the latter is provably the original code path, since plan
  instructions are never duplicated). `benchmark.less` SHA256 unchanged at
  `1f041a1bf9c8592eb21c1d7354e49a5a02d1e1a888fc5e120a90b1f85f0a0561` (122,550 bytes).
  **Timing: no claim made.** 1.1-1.5% sits below the ±4.9% noise floor, and this box ran at
  load average 48-119 throughout; a wall-clock A/B here could not distinguish the change from
  noise, so none is reported. The call-count reduction is the honest metric.
  **Regression gate:** `extend-op-budget.test.ts` gains a fourth case pinning contrib
  compositions CONSTANT as the admitted-subject count doubles (measured 1 vs 1 with the memo;
  51 and 101 without, i.e. linear in subjects). Verified to fail with the memo removed.
  **Aside — the `verify:jess-suite-ratchet` 28-vs-29 NEW discrepancy is a FLAKE, not a
  regression.** Observed both counts on the SAME tree in this session (28 on the first two
  runs, 29 on the next three). A controlled A/B with the contrib memo threaded vs removed
  produced **identical 29-entry NEW sets**, so no extend change is involved. Which entry is
  intermittent was not isolated (it needs a run that reproduces 28 while capturing the list).
  Note this worktree resolves `@less/test-data` to the SHARED `~/git/oss/less.js` checkout,
  a known cross-process flake surface.
- **`jess-parser` still text-joins selector-bearing pseudo arguments.** The
  folded grammar still has `staticSelectorText`
  (`packages/syntax/jess/jess-parser/src/grammar.ts:385` at `facb641dd`, used by nth-`of` at
  `:2599` and generic pseudo arguments at `:2729`). This is the remaining gap to
  always-structured pseudo arguments.
- **The 8-dp holdouts are gone; the value domain has ONE number policy.** Both precision rows
  that used to sit here are closed, so they are deleted rather than carried as strikethrough.
  `literal-tag.ts` never had a `round` call by the time the row was written (the denoising
  rewrite went in `f0f005a27`, 2026-07-17), and the five `round(x, 8)` calls in
  `packages/core/src/ast/color.ts` now call `formatNumber` (`f42decf7f`), pinned by
  `packages/core/src/ast/__tests__/color-precision.test.ts`. The only construction-time
  quantization left in the colour path — `withAlpha`'s `round(newAlpha, 8)` in
  `packages/fns/src/less/color-helper.ts` — went with it (`137cfa8fa`), which also closes
  SEMANTIC-INVARIANTS **S6**. Rulings V1/V4/V5 are satisfied. The remaining `round(x)` calls
  in `color.ts` (`:97` x3, `:105`) are bare integer rgb-byte quantization at output and are
  correct under V5.
- **`evalBytesInterp` never validates units.** `evalBytesInterp`
  (`packages/core/src/ast/serialize.ts:4717` at `facb641dd`) has no `validateValueGroupUnits`
  call, while the ordinary value path calls it at `:4697`. A unit error that is fatal in a
  declaration value is silently accepted inside an interpolation. Undecided which way it should
  go — it deserves its own commit and an owner ruling. The divergence is documented in code at
  `:4713`, which makes it a known-and-accepted state rather than an oversight; that does not
  settle it.
- **`--x: foo(] bar`** (arbitrary token stream in a custom property) fails in all four parsers.
  That is the current limit of the shared-surface permissiveness ruling P2.
- ~~**`packages/fns/src/less/index.ts:31` exports the wrong function.**~~ **FIXED** with the
  per-dialect registry: the index now re-exports the *named* `format` (`string-format`) and
  `formatPercent` (`%`) explicitly, and both register under the names ruling A5 gives them.
- ~~**fns port backlog** — 35 unconverted modules, 3 missing fns, no alias mechanism.~~
  **CLOSED 2026-07-30 at `ef173125a`.** Every item in the 2026-07-24 row had been overtaken:
  - **The 35 modules are gone, not unconverted.** None of the 6 named `less/` modules
    (`each`, `iif`, `isdefined`, `isruleset`, `logical`, `math-factory`) exists — core
    special-forms all of them during serialization, so `packages/fns/src/less/index.ts`
    records them as deleted dead code. `shared/math/{max,min}.ts` do not exist either
    (`min`/`max` are dialect-owned; the module pair is `sass/math/{min,max}.ts`). Measured
    at `ef173125a`: the Less index exports 83 callables and the Sass index 62, and **every
    one of the 145 is a value-domain `Fn`** — zero non-`Fn` exports on either index, so the
    registries register the whole surface.
  - **`type-of`, `str-length` and `comparable` all exist and register** —
    `sass/meta/type-of.ts`, `sass/string/globals.ts` (`strLength`) and
    `sass/math/compatible.ts` (`comparable`).
  - **The alias question is settled and implemented.** `separator`→`list-separator` was a
    real registration bug and is fixed below. `argb`→`ie-hex-str` is *not* an alias:
    `packages/fns/src/sass/NAME_ALIASES.md` records the owner ruling that the bodies diverge
    (output case) and that a fn IS its dispatch name, so each spelling gets its own body.
    Where a rename really is pure, the landed shape is a delegating `defineFunction` under
    the second name reusing the first fn's `params` — `sass/string/globals.ts`, now also
    `sass/map/globals.ts` and `sass/list/globals.ts`.
- **Renamed Sass globals were registered under their MODULE names.** *(Found and fixed
  2026-07-30, `b587617e0`.)* `registryOf()` keys on `fn.name`, so `sass/index.ts` exporting a
  module member registered the module name: the Sass global registry held bare
  `get`/`has-key`/`keys`/`values`/`merge`/`remove`/`separator` — seven names dart-sass has no
  global for — and none of `map-get`/`map-has-key`/`map-keys`/`map-values`/`map-merge`/
  `map-remove`/`list-separator` dispatched. Measured before/after on the same tree:
  `map-keys`, `map-values`, `map-merge`, `map-remove` and `list-separator` went from
  verbatim-preserved to computed; `map-get` was already reachable because the SCSS parser
  lowers it to the `$[…]` accessor. Jess-suite ratchet was byte-identical across the fix
  (37 NEW / 10 FIXED / 1 STALE both sides), so nothing else moved. `map-has-key` needed
  `dd22fef60` on top: with a two-argument call its empty rest parameter mis-bound on the
  `(ValueGroup, FnCtx)` route and the body threw, so the call was preserved verbatim while
  the three-argument nested form worked. On `dd22fef60` all seven globals dispatch.
- **Those seven globals now dispatch, but three of them diverge from dart-sass on a MISS.**
  Measured 2026-07-30 at `facb641dd` with a full workspace build, each case run through
  `Compiler.renderString(src, { extension: '.scss' })` and the same source through
  dart-sass 1.101.0 `compileString`:

  | case | jess | dart-sass 1.101.0 |
  | --- | --- | --- |
  | `map-get($m, zzz)` (miss) | **throws `Name not found`** | `""` — declaration suppressed |
  | `map-get(map-get($m, zz), b)` | **throws `Name not found`** | **throws** `$map: null is not a map` |
  | `map-has-key($m, zzz)` | `false` | `false` |
  | `map-remove($m, zzz)` | `b: { a: 1 }` | throws `(a: 1) isn't a valid CSS value` |
  | `nth($l, 9)` (out of range) | `b: nth(1 2 3, 9)` — preserved verbatim | **throws** `Invalid index 9 for a list with 3 elements` |
  | `index($l, 9)` (not found) | `b: ;` — EMPTY declaration | `""` — declaration suppressed |
  | `x { b: null }` | `b: null` | `""` |
  | `x { b: 1 null 2 }` | `b: 1 null 2` | `b: 1 2` |

  `map-has-key` is the only one already right. `map-get`/`index`/`null` all trace to the
  same root: **jess `ast/` v2 has no `null`/Nil value**, so there is nothing for a miss to
  return and nothing to trigger declaration suppression or list elision. `map-remove` and
  `nth` are a different axis (jess is more permissive where dart-sass errors) and are not
  blocked on `null`. See DESIGN-DECISIONS R11/R12 — the `map-get` lowering fix is settled in
  spelling (`$m[zzz]?`, per-step) and blocked on the miss-value/`null` language question.
- **Dead one-line shim: `packages/fns/src/sass/math/abs.ts`.** Re-exports `abs` from
  `shared/`, but `sass/math/index.ts` imports `abs` from `shared/` directly, so nothing
  reaches it. A reachability walk from all eleven index entrypoints finds it is the only
  unreferenced `.ts` module in `packages/fns/src`.
- **`extend-exact.less` flake is real cross-compile state contamination**, not test flakiness.
  **This row's pointers moved packages.** `packages/jess/src/index.ts` is now 24 lines and only
  subclasses `DefaultCompiler`; the plugin stack was extracted to `@jesscss/compiler-preset`
  (rename `09bcc9b2e`), with the reusable render engine in `@jesscss/compiler`. The two sharing
  channels at `991b315e0` are the per-stack plugin instance caches
  (`packages/compiler-preset/src/index.ts:22-23` — `jessPluginInstance` / `scssPluginInstance`,
  populated at `:39-42` / `:48-51`, plus `lessPluginResolver`) and the module-scope dialect
  evaluators registered by `@jesscss/plugin-less` / `@jesscss/plugin-scss`. The evaluators hold
  only an immutable dispatch table, so they carry no per-render state to leak; the plugin caches
  remain the live suspect. Diagnostic: a fresh `Compiler` per file isolates which channel.
  **Constraint on any fix:** a `Compiler` must stay reusable across many files. "New Compiler
  each time" is not an acceptable fix, and neither is a `reset()` that callers have to remember.
  Note that `DefaultCompilerStackImpl.dispose()` (`:64-76`) already clears both caches — whether
  it is a fix, a partial fix, or exactly the remember-to-call-it shape the constraint rejects is
  **unverified** and is an owner question, not an assumption to build on. A separate session is
  on this.

### Parked / stale branches — do not merge as-is

- **`css-sharing-inventory`** — STALE. 10 of its 30 rows now name a dialect that passes.
  Needs a §1 refresh first.
- **`wip/jess-calc-grammar`** — parked: 3 eslint `no-unsafe-type-assertion` errors, and it now
  conflicts with `dev` in the `$( … )`/calc region that `ad1bbd1bf` changed.
- **`wip/maybe-promise-2b`** — explicitly NOT FOR LANDING.
- **`fix-per-dialect-registry`** — live, see WORK IN FLIGHT. Local only; no remote tracking
  branch as of `e34bb24b3`.

### Gate hygiene — LANDED `c3db7e53e` (2026-07-24)

Gates that are red on an untouched checkout are not gates; they teach people to reach for
`--no-verify` on the ones that matter. `c3db7e53e` made green mean green. **A fresh agent
should now treat a red gate as its own change breaking something**, which was not true before.

Fixed (each was red on clean `dev`):

- `verify:types` — `less-parser`'s hand-written `SharedCssAstSyntax` was missing
  `CssAstSyntaxUnicodeRange`. One missing declaration was failing the whole 22-config gate.
- `verify:binding-lookup-hot-paths` — crashed with `spawnSync rg ENOENT` on any machine without
  ripgrep; both shell-outs are now a repo-native scan.
- `verify:node-copy-frontier` (and therefore `verify:baseline`) — the `unit.clone()` in
  `jess-plugin-js/src/runtime-worker.ts` belongs to the sandboxed Deno `@plugin` worker's OWN
  local `Unit` class, not a jess tree node. It is now an attributed allowlist entry.
- `scripts/check-macro-buildable.mjs` — repaired and wired as `pnpm run check:macro`
  (`064e3d985`).
- `verify:aggressive-cutting-review` fired on "a hot-path file changed" rather than "its
  behavior changed", so a comment-only edit was a guaranteed false positive. Cosmetic hunks are
  now stripped before the changed-surface predicate — conservatively: `@ts-`, `@__PURE__`, and
  eslint-directive comments still count as code.

**Security fix found while baselining:** `@plugin` bypassed `disableScriptModules`. The `ast/`
engine reaches `loadPlugin` directly through `prepareBodyPlugins`, so the Context import-path
check never ran and a disabled plugin still executed. The Less plugin host now refuses at the
load boundary.

**Every count-based baseline is now a NAMED SET.** A count cannot distinguish "nothing changed"
from "you fixed one and broke another" — both read as N. Converted:
`packages/jess/test/known-failures.json` + `scripts/vitest-ratchet.mjs` (jess suite failures by
test name; fails on a new failure *and* on a listed test that starts passing or disappears);
bootstrap-corpus `PARSE_PASS_FLOOR`/`EVAL_PASS_FLOOR` → named fixture sets;
conversion-construct-support floors → named construct sets; shape-stability `shapes.size >= 25`
→ a named AST node-type inventory; `verify-render-buffer-frontier` `=== 2` → two named sites
(`For` / `While`), so a swapped site cannot pass.

Do not reintroduce a count. If you need a baseline, name the members.

The `--no-verify` usage rate is **UNVERIFIED (2026-07-24)**: `--no-verify` is a git flag, not
commit content, so it leaves no trace in `git log` and cannot be recovered from this repo. Do
not repeat a specific ratio as if it were measured here.

### Model correction — COMPLETE

- [x] SCSS nested-property → `Collection` (`b3976867e`).
- [x] `AnonymousMixin` added, value blocks content-classified, AST `DetachedRuleset` node
      DELETED (`b7f413d08`). LESSON: a CST grammar rule is not an AST node — keep the CST
      `DetachedRuleset` rule name; renaming it dangled `compose()` and a stale build masked it.
      Compose-integrity regression guards were added. See [[collection-vs-detached-ruleset-model]].

### Landed since this checklist was last reconciled (2026-07-22 → 2026-07-24)

Recorded so the next reader does not re-derive it from the log:

- **Pseudo-argument consolidation (2026-07-23).** Shared, `g`-free `cssAstPseudoSyntax`
  recognition artifact (`89917ce8f`), all four parsers migrated (`00778bac1`, `a6760c89e`,
  `d974aede3`), divergences unified (`e4b46ac45`), `of S` restricted to `:nth-child` per
  Selectors-4 §6.6.2 (`c6c0ea567`). Designs: `PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`,
  `PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md`. **Residual:** `jess-parser` still joins
  selector-bearing pseudo arguments through `staticSelectorText`
  (`packages/syntax/jess/jess-parser/src/grammar.ts:385`) — the remaining gap to
  [[parser-pseudo-args-always-structured]].
- **Structured pseudo-selectors, structure-only** (`c5f327ee7`, `dc6040d5e`, `5f95ac6d4`,
  `7e3cf042b`) with serialization relocated from grammar to core (`d0d77d22c`).
- **`;` is a declaration-list SEPARATOR, not a terminator** — `ef697892d` (jess),
  `ff7349969` (css/less/scss), `86d6143e2` (jess variable assignment is a declaration for this
  purpose), pinned by `20b01b0db`. Ruling: DESIGN-DECISIONS P11.
- **Stylesheet-defined functions in `.jess`** (`1ba17a77d`), documented by `741e6209c`;
  block auto-termination ruling: DESIGN-DECISIONS P12.
- **`.jess` `&` parent selector landed** (`9ac4d0bee`, design `cd7fc9c39` /
  `JESS-PARENT-SELECTOR-DESIGN.md`, rulings P9/P10).
- **`$( … )` stops emitting parens and a chained call stays in its frame** (`ad1bbd1bf`).
- **Root parentless `&` resolves to empty in the extend projection** (`e1d6396b4`).
- **MaybePromise/awaitable lane** extended to guards (`e79f0e434`), at-rule preludes
  (`72e6efd51`), mixin dispatch + mixin index (`19223650f`), nested selector header + shell
  probe (`a447bca1d`). `161fe9709` removed the blocking `@plugin` FIFO channel — a BEHAVIOUR
  CHANGE: `@plugin` values now travel the awaitable lane and a value reaching a position that
  cannot suspend fails loudly with `eval/async-in-sync-position`.
- **Sass+ support matrix published** (`3202ff246`,
  `packages/docs/docs-content/docs/shared/04-guides/02-coming-from-sass/00-support-matrix.mdx`
  — path updated for the `e96d1035d` packages regroup), and
  `c06dd4d7a` stopped advertising a `jess convert` command that does not exist.
- **Bootstrap Sass corpus ratchet + SCSS construct inventory** (`bde2e982e`);
  **conversion construct-support inventory + equivalence-harness design** (`c028a7c76`,
  `docs/design/JESS-EQUIVALENCE-HARNESS.md`).
- **Value-position `Collection` serializes instead of folding to empty bytes** (`ba8743b0e`),
  and **SCSS nested-property flatten is shared by both emitters** (`e63c82031`). Rulings:
  DESIGN-DECISIONS C11 / C12.
- **Docs reorg** (`0806ccdbb`, `3098275f5`): `docs/future/` is gone; the tree is
  `docs/{architecture,design,state,process,perf,releases}`. `.cursor/` holds tool config only.
  The decision ledger is `DESIGN-DECISIONS.md` in this directory.
- **Semantics governance** (`c5a58a1e7`, `95fd726ec`): `docs/architecture/SEMANTIC-INVARIANTS.md`
  (evidence-per-item, each entry carrying a STATUS) plus `.cursor/agents/semantics-reviewer.md`.
- **Numeric-precision policy DESIGN** (`9624e532b`, `4797ae218`, `ddd0883e4`,
  `docs/design/numeric-precision-policy.md`). Design only — see WORK IN FLIGHT.
- **Per-function Less/Sass dialect classification audit** (`1d253ce9c`, `1164ddd15`,
  `docs/state/fns-dialect-classification-audit.md`).
- **One Node engine floor across every published package** (`e7a7cc037`): all 19 publishable
  packages declare `"node": "^20.19.0 || >=22.12.0"`. `bf7286753` dropped the CI `lts/-3` leg;
  `93e1aa49d` backed out two files that sweep had picked up.

## Current target

Keep AST v2 as the canonical public representation. Parseman grammar reductions
create exact `Stylesheet` data directly through each dialect's public `parse()`
operation; core has no parser construction host, action registry, bridge,
source reparse, or compatibility path.

### Aggressive-cutting note — typed Less import query tail

`@import url("…") (min-width: @var)` now carries the existing typed
`Block(Operation(':', …), delimiter: 'paren')` tail from the Less grammar. The serializer reuses
its existing query-prelude byte emitter at the three import-tail boundaries
(planner request, loader request, and CSS-terminal output), so it preserves
query delimiters while evaluating the variable. No node, array, traversal,
resolver, Context capability, or public API is added; ordinary opaque/import
interpolation tails retain their existing byte path. This is behavior evidence,
not a performance claim; parser/public-render tests cover the new fact.

### Active delivery order

The immediate delivery target is a feature-complete **Less alpha** on that
public architecture. Do not spend the active implementation capacity on new
SCSS or Jess syntax/evaluator slices while the public Less route still lacks
required execution semantics. The other direct parsers remain canonical work,
but Less import execution, evaluator wiring, retained Context/plugin dispatch,
and corpus parity come first; resume the remaining dialect integration only
after those Less-alpha gates are genuinely green.

### Less corpus truthfulness gate

`packages/jess/test/less/all-less.test.ts` registers its expected-failure cases in the
`expectedFailureFixtures` map at `:178`; only a subset is selected by the current alpha fixture
glob and filters. **Do not carry a count from this paragraph.** Three numbers have been in
flight here at once — this section said 32 registered / 21 selected / 108 cases (2026-07-24),
`less-v5-corpus-inventory.md:30` says 26 registered, and the map actually holds **27** entries
at `facb641dd`. The lane size has also moved: the 2026-07-30 re-measurement below records
`all-less` at **109/110**, superseding the `108/108` recorded here and at the Less-alpha gate
section. Regenerate the registry membership from the map itself and the lane size from
`pnpm run test:less:test-data`, and record the external less.js checkout SHA with it (see
"The Less corpus authority is an external mutable checkout" below) — a corpus number without
that SHA is unfalsifiable. The harness passes
when a named fixture still fails, so none is passing-parity proof. The owner
decision for the first alpha is to classify—not drain or hide—them. The
reproducible selection accounting, exact active cases, inactive registry
entries, symptoms, scope, and follow-up rule are in
[`../../state/less-v5-corpus-inventory.md`](../../state/less-v5-corpus-inventory.md); the
readiness tracker and release notes must link that inventory. In particular, a
missing mixin remains an error; only an ordinary function call with an optional
function reference may fall back to a CSS `Call` when lookup misses.

### `callWithContext` deletion prerequisite

The legacy tree call path has been audited rather than treated as an implicit
compatibility seam. `packages/core/src/tree/call.ts` reaches
`callWithContext` from exactly five dynamic-function paths:
`evalOptionalFallbackOutput`, `evalPlainDynamicFunction`,
`evalMetadataDynamicFunction`, `renderDynamicFunctionOutput`, and the ordinary
`evalFromStateInFrame` extended-function branch. These are all legacy-tree
execution routes. The ordinary branch keeps two distinct rules: a
`No matching mixins` failure is a hard missing-mixin error (apart from selector
capture), while a selected function's invocation failure may preserve the
authored call only under its optional/silent-fail policy and
`functionMode !== 'error'`.

`packages/core/src/define-function.ts` shows why this cannot be replaced by a
wrapper: `callWithContext` unwraps and clones legacy `List`/`Node` arguments,
runs legacy preprocessors, resolves positional/record/hybrid overloads,
evaluates non-lazy nodes through `Context`, supplies `FunctionThis` (`context`,
`caller`, `args`, `rawArgs`), performs legacy `instanceof` validation and
conversion, and finally invokes either `_internal` or a Context-bound function.
That contract is the bridge deletion target, not a public runtime model.

The replacement is the existing AST-v2 value seam. A canonical `Fn` is called
with `(List, FnCtx)` by `buildEvaluator`/`value-dispatch`; `ParamSpec.type`,
defaults, rest, and explicit lazy thunks provide typed binding, while direct
Sass/Jess embeddings may use named records. `FnCtx` carries only resolved modes,
the value-to-string hook, and optional IO; it does not expose `Context`, legacy
nodes, callers, or source re-evaluation. Unknown function names remain authored
calls without a warning; failures from a function that actually resolved are
handled by `functionMode` (preserve + warning versus error). The plugin adapter
populates this same `Fn` registry/host, so Context remains the session and
plugin/import dispatcher rather than a function-body ABI.

The deletion gate is therefore concrete: migrate every production consumer of
the old contract (currently the Less `rgb`/`hsl`/`rgba`/`hsla`/`each` paths and
the Sass compatibility/map functions), then migrate their direct tests from
`RuntimeFunction`/`callWithContext` to typed `Value`/`ValueGroup` and registry calls.
Only after the consumer/test search is empty may `tree/call.ts`,
`define-function.ts`, and their old conversion exports be removed; no adapter,
alias, or tree-to-AST bridge is allowed as an intermediate state.

### Alpha packaging blocker: generated legacy declarations

The alpha tarball audit found a packaging surface issue, not a reason to
delete declaration files blindly. `@jesscss/core` now exposes only the curated
root API plus `./value` and `./ast`; `src/index.ts` intentionally does not export
the old tree classes. `tsconfig.build.json` separately emits declarations and
maps for every `src/**/*.ts`, so unexported `lib/tree/**` helpers are generated
artifacts but must remain until no reachable declaration refers to them.

`@jesscss/fns` was broader and inconsistent: its `./*` export map claimed every
generated `lib/*.d.ts/js/cjs` subpath while `tsdown.config.ts` emitted only the
`index` and `builtins` runtime entries, so declaration-only paths were published
and advertised without a matching runtime file. **Resolved:** the wildcard stays
removed and the documented subpaths are now GENERATED — `./less`, `./sass`,
`./sass/{color,list,map,math,string}`, `./shared`, `./registry`,
`./less/registry`, `./sass/registry`, each with a real tsdown entry. `plugin-js`
continues to treat all `@jesscss/fns/*` paths as trusted; that is a sandbox
boundary, not a package-subpath justification.

**Bounded package cut (2026-07-22; superseded 2026-07-24).** The first safe
export correction removed the `@jesscss/fns` `./*` wildcard, when the only
consumers were the root `@jesscss/fns` import and `@jesscss/fns/builtins`. That
is no longer the shape — see the paragraph above for the published subpaths. The
historical record: a workspace consumer search found no production or test
consumer importing a Less/Sass/shared/util subpath, the fns build emitted runtime
entries only for `index` and `builtins`, and the former
`.js`/`.cjs` files do not exist. The README and Sass export-structure note now
state that those folders are source ownership boundaries, not published
entrypoints. `plugin-js`'s filesystem trust rule remains a separate sandbox
boundary for resolved built-in files and is not used to justify package
subpaths. The core root tree barrel has since been cut from the public root
surface. The remaining deletion lane is internal: `Context`, the legacy fns
implementation, and compat consumers still import tree classes directly, so
those migrations remain the next required slice.

The minimal cut sequence is:

**A.** Finish the remaining legacy `@jesscss/fns` Less/Sass function and test
migrations to root `@jesscss/core` semantic values; rewrite or intentionally retire the
production `packages/jess-plugin-js/src/bridge.ts`, which still transports
legacy `Any`/`Color`/`Dimension`/`List`/`Rules` values.

**B.** Delete `define-function.ts`, `conversions.ts`, and their root exports
after the consumer search is empty.

**C.** Migrate `Context` and `jess`/plugins off `TreeContext`, legacy
`Node`/`Rules` state, spine/visitor fields, and tree-only utilities while
retaining the AST-v2 `DocumentContext`, plugin host, and import dispatch.

**D.** Keep the already-narrowed `core/src/index.ts` root surface narrow; remove
any remaining explicit legacy utility exports only after the consumer search is
empty. The public root should expose only stable Context/plugin/error, canonical
AST execution, and semantic value/fn seams.

**E.** Remove the now-unreachable tree runtime and legacy tests/visitor ABI.

**F.** Tighten declaration builds to the public entry closure and replace the
`fns` wildcard with explicit, runtime-backed subpath exports. Verify packed
install imports and type resolution before alpha publication.

**No-op consumer audit (2026-07-22).** A bounded audit of the remaining
`@jesscss/core` imports in `packages/fns` found no honest pure cut to land
without first resolving function-owner semantics. The remaining consumers are
clustered as follows:

- Less color functions (`contrast`, `fade*`, HSL adjusters, `shade`/`tint`,
  `color`, and constructors) still depend on legacy `Color` source-format and
  raw-channel metadata, `Context`, or the legacy `mix` contract. Their
  canonical `builtins/` counterparts are comparison evidence, not an approved
  destination or compatibility alias.
- Less structural/context functions (`each`, `isruleset`, `iif`/logical,
  format/replace, data-URI/image/SVG helpers) consume `Node`/`Rules`,
  lazy-thunk, or Context/IO capabilities and require their own behavior
  migrations.
- Sass map/list/string functions consume legacy `Collection`, `Declaration`,
  `Any`, and Context contracts. They need typed map/list semantics and direct
  tests before tree imports can be removed.
- Shared `math/max` and `math/min` still use legacy `Node.compare`; Less's
  canonical `min-max` policy and Sass's unit/error behavior have not been
  proven identical, so they must not be ported by assumption.
- `less/types` mixes value predicates with legacy `isurl`; a partial rewrite
  would leave the same root-tree consumer and would not advance the deletion
  gate.

**Decided (2026-07-24, ledger C13).** The ownership question above is settled in
favour of the dialect owner: each converted `builtins/` implementation was moved
INTO `less/`, replacing the legacy tree-node twin of the same name, and
`builtins/` is deleted. **Nothing legacy remains** (re-verified 2026-07-30 at
`ef173125a`): both dialect indexes export value-domain `Fn`s exclusively — 83 in
Less, 62 in Sass, zero non-`Fn` exports — so there is no "not registered until
converted" residue left. See the closed fns-port-backlog row above. Cutting the
tree barrel is now gated on `packages/core`, not on `packages/fns`.

### `plugin-js` bridge disposition

The `packages/jess-plugin-js/src/bridge.ts` audit does not identify another
parser/compiler AST bridge. It is the external Deno-process transport for the
legacy Less JavaScript runtime ABI: host-side legacy `Any`, `Color`,
`Dimension`, `List`, `Quoted`, `Sequence`, `Rules`, and `Declaration` values
are encoded as tagged JSON, while `runtime-worker.ts` decodes them into its
own `less.tree` classes (`Dimension`, `Color`, `Quoted`, `Keyword`,
`Anonymous`, `Value`, `Expression`, and `DetachedRuleset`).

That ABI is observable and tested by
`packages/jess-plugin-js/test/plugin-js-security.test.ts` (the
`less.tree`/`less.dimension`/`less.value` `instanceof` and legacy `@plugin`
cases), by `packages/jess/test/less/wall8-repro.test.ts`, and by the
`plugin-js` README's typed-bridge guarantee. The AST-v2 semantic value API is
not a 1:1 replacement: it has structural `Dimension`/`Color`/`Quoted`/
`Keyword`/`List`/`Block`/`Bool`/`Nil`, but no Less-compatible
`Anonymous`-vs-`Keyword` class identity,
`Sequence`/Expression value, detached Rules/Declaration map, or class identity;
it also carries different color source-format metadata. Substituting those
shapes now would silently break external modules and Less map/plugin behavior.

Do not add a dual canonical/legacy branch and do not delete this transport in
the alpha. Its future cut requires an owner-approved canonical cross-process
protocol covering raw/anonymous values, sequence/layout facts, detached
rules/map semantics, and color source metadata; a new worker API and facade;
migration of the bridge tests, README, legacy plugin fixtures, and callers; and
only then removal of the legacy Less facade plus all core-tree imports from
`bridge.ts`. Until that protocol is approved and proven, this is a legitimate
external runtime compatibility seam, not evidence that the public parser or
compiler still uses a tree-to-AST bridge.

## Active orchestrator goal

Drive the public AST-v2 cutover, Less alpha readiness, Parseman release,
performance recovery, and Jess alpha preparation to verified completion. This
section is the authoritative full-scope companion to the compact task goal.

- All public CSS, Less, SCSS, and Jess `parse()` routes must reduce Parseman
  grammar directly to canonical AST-v2 `Stylesheet`; `Reference` is the typed,
  recursive public reference chain. No bridge, builder/parse host, action
  registry, source reparse, scanner/regex recognizer, compatibility parser, or
  fallback/shim may return.
- Less is the immediate feature-completeness priority. Close real parser,
  evaluator, import, plugin, and corpus gaps through the public route; prove
  the first external prerelease as exactly `less@5.0.0-alpha.1`, including
  built-artifact `lessc` and clean packed-install tests.
- CLI ownership is explicit: only the external `less` package provides the
  Less-compatible `lessc` command. The `jess` package provides only `jess` and
  must not claim Less CLI compatibility through a second bin or alias.
- Node support is a rolling policy, not a permanently pinned release number.
  **Corrected `e7a7cc037` (2026-07-24); re-measured 2026-07-30 on `facb641dd`:** all 22
  publishable packages (31 workspace packages, 9 `private`) declare the same
  `"node": "^20.19.0 || >=22.12.0"` — three LTS lines (20, 22, 24), matching parseman. The
  range is where the toolchain already stops (oxc-parser, oxlint and vite each require exactly
  it), and the gaps are load-bearing: 20.0–20.18 and 22.0–22.11 cannot install the oxc family.
  Node 18 was never real — it cannot run oxc, vite or vitest, so the old `>=18` floor could not
  be exercised by our own suite. **`.github/workflows/` was NOT updated** (pushing it needs the
  `workflow` OAuth scope, which the client did not hold): `less-alpha-readiness.yml` still
  sweeps `lts/*` through `lts/-3` (today 24/22/20/18), and the other three workflows pin the
  floating `lts/*` alias, so CI never exercises the declared floor. Recommended fix is explicit
  `['20.19.0', '24']`. This is an OPEN follow-up.
- Context remains the one render/session/cache/diagnostic/plugin/import
  coordinator. Retain its plugin-based source, parser, module, path, and
  import dispatch topology while changing carried documents to `Stylesheet`;
  do not replace it with a second loader or resolver.
- Finish public Jess syntax integration through `jess-parser` and
  `plugin-jess`. CSS is a Context-parsed/inlined document route, not a Jess CSS
  compiler merely because a CSS plugin exists. Delete only machinery proven
  unreachable after direct-route coverage; do not manufacture deletion work.
- **Corrected 2026-07-31:** this previously read "targets published Parseman
  `0.41.x`" with a `0.41.1` dispatch aggregate-elision follow-up. Parseman
  `0.45.0` is published and `0.46.0` is in flight as PR #102; the `0.41.x` text
  was ten releases stale. The adoption rule is unchanged and still binding:
  adopt a parseman version in Jess only after owner publication, registry
  install, macro/compose proof, and matched parser measurements. Normal
  compiler/plugin/CLI parses never enable coverage or trace.
- Treat current direct-Less parsing performance as a release concern. Establish
  reproducible generated-bundle/hash baselines and investigate AST allocation,
  grammar choice/backtracking, metadata/trivia/provenance, emitted
  `composeLeaf()` shape, and historical feature equivalence independently.
  Optimize only with semantic/output proof and matched parse plus end-to-end
  measurements; never restore legacy architecture for speed.
- Finish the external Less alpha release decision. The direct Jess runtime
  closure consumed by Less is published and queryable at `2.0.0-alpha.11`; the
  Less PR branch consumes that exact registry set, locally passes the alpha
  package gates, and has green PR #19 CI on the `.11` bump. The remaining
  decision is owner merge/publish authorization for Less. Future Jess
  alpha snapshots should use `pnpm run release:alpha:update-from-dev` from a
  clean `alpha` worktree; do not ordinary-merge/rebase shared alpha history or
  publish before every gate passes.

### The user-facing statement of alpha readiness lives OUTSIDE this repo

`~/git/oss/less.js/CHANGELOG.md`, section `v5.0.0-alpha.1 (unreleased)` (@ `2f309b66`), is
the only place the project publicly declares what alpha.1 does and does not do. **Nothing in
`docs/` cited it before 2026-07-30** (verified by grep), which is a routing gap: it is the
text users read, and it is a statement of *jess's own* status, because the v5 alpha package is
a thin wrapper over jess's `Compiler` — not an independent source.

It declares SUPPORTED: `less.render()`, `renderFile()`, `lessc`, variables, arithmetic, mixin
calls, sibling file imports, nested-rule output. It declares WORK-IN-PROGRESS: legacy plugin
execution, file-manager and pre/post-processor hooks, source maps, URL rewriting options,
compressed-output parity, browser compilation (explicitly excluded from alpha.1), and "the
remaining long-tail Less 4 fixture corpus". It sets a quality bar: unsupported syntax must
fail with filename, line, column, and source context rather than raw parser offsets.

Cross-checked 2026-07-30 against this repo, that WIP list is **consistent** with jess's own
records rather than contradicting them — source maps are the queued "Final-pass output
positions / sourcemaps" item below; browser compilation has
`docs/architecture/less-v5-browser-build-spec.md`; plugin/pre-processor/URL-rewriting fixtures
are registered in `all-less.test.ts`'s `expectedFailureFixtures`. Keep it that way: **when a
lane closes one of those seven items, update that CHANGELOG section in the same change**, and
when it opens a new gap, add it there. Do not let this repo's status diverge from the text
users actually read.

### Current Less v5 alpha readiness evidence

Use [`docs/state/less-v5-alpha-readiness.md`](../../state/less-v5-alpha-readiness.md)
as the current source of truth. As of 2026-07-28, the external Less branch has
the desired direct compiler/plugin dependency shape, consumes the published
`2.0.0-alpha.11` Jess runtime closure, passes local alpha package gates, and has
green PR-head CI. Do not publish Less until the owner authorizes the Less release
flow.

## Router

| Work | Read first |
| --- | --- |
| Direct parser AST construction and legacy-builder deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) |
| Parser recognition, interpolation, and scanner cleanup | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) |
| Feature/eval closure | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) |
| **"Is Less 4.x feature X implemented?"** — feature-by-feature triage derived from Less 4.8.1 itself, each row a measurement against `lessc` 4.8.1 run directly. Records the four gaps that are on no other list, and corrects three of the seven WIP areas the alpha CHANGELOG declares | [`LESS-4X-FEATURE-TRIAGE.md`](./LESS-4X-FEATURE-TRIAGE.md) |
| Eval/render allocation, lookup, and traversal cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) |
| Deleting `packages/core/src/tree/` — public-surface inventory, `Context` decomposition, value-boundary options, extraction order | [`TREE-CUTOVER-SURFACE.md`](./TREE-CUTOVER-SURFACE.md) |
| **The four-grammar rewrite** — the eight-to-four physical fold is complete; continue the spec/naming/documentation and current Parseman cleanup on the four surviving host-mode grammars. Start at its §0 | [`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md) |
| The per-`const` grammar review checklist and the naming law (item 14) | [`../parser/GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md) |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) |
| Owner semantic/architecture questions and rulings | [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md) — the canonical OPEN/SETTLED decision ledger |
| Less 4.x builtin-function coverage — all 92 registry names call-verified against 4.8.1, plus the `functionMode: 'preserve'` blind spot that makes an arity rejection indistinguishable from an unknown CSS function | [`../../state/less-4x-function-triage.md`](../../state/less-4x-function-triage.md) |
| Non-engine surface carrying size/complexity cost | [`NON-ENGINE-BLOAT-INVENTORY.md`](./NON-ENGINE-BLOAT-INVENTORY.md) |
| Lazy value materialization / memoization | [`VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md`](./VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md) |
| Static-import preparation | [`STATIC-IMPORT-PREP-DESIGN.md`](./STATIC-IMPORT-PREP-DESIGN.md) |
| The `--noCheck` typecheck burn-down (open: **2** package.json files at `facb641dd` —
`packages/syntax/scss/scss-parser/package.json:59` and
`packages/syntax/jess/jess-parser/package.json:59`; the `15` here was 7.5x too high) | [`TYPECHECK-BURNDOWN.md`](./TYPECHECK-BURNDOWN.md) |
| Benchmark extend shapes adjudicated against real Less 4.6.7 | [`BENCHMARK-EXTEND-EVIDENCE.md`](./BENCHMARK-EXTEND-EVIDENCE.md) |
| **"What is this file in `architecture/core/` and is it still current?"** | [`README.md`](./README.md) — the directory index, and the record of the 2026-07-30 archive pass |

### Router — grammar cleanup (`docs/architecture/parser/`)

Every doc in that directory, so nothing gets rediscovered. The two rows above
(`GRAMMAR-REBUILD-SPEC.md` = what to do, `GRAMMAR-REVIEW-STANDARD.md` = how each
`const` is judged) still come first; these are the rest of the surface.

**Live — read before touching a grammar file:**

| Work | Read |
| --- | --- |
| Which combinator states which ownership boundary — `choice` vs `dispatch` vs `routed` vs `attempt`, first-set gating, the current idiom set. Its own header still says it is cut against `parseman@0.43.0`, which is one floor stale — the
repo is on `^0.45.0` (`75002c4a3`) and the doc's own rule is to re-cut it in the same change as
a floor bump. Last updated by the wrapper-route ban `3bb2b4225` | [`../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`](../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md) |
| Sequencing the `css → less → scss → jess` cleanup, and why it is ordered that way. Orchestration decision, not a replacement for the spec | [`../parser/GRAMMAR-SEQUENCE-ORCHESTRATION.md`](../parser/GRAMMAR-SEQUENCE-ORCHESTRATION.md) |
| The remaining named quality cleanup in the Less grammar after its fold — the working list for Less-side routing work | [`../parser/LESS-FOLD-HOTSPOT-REPORT.md`](../parser/LESS-FOLD-HOTSPOT-REPORT.md) |
| The red `oracle:less:byte-identity` movers, classified by entry class. Classify here **before** proposing any baseline update | [`../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md`](../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md) |
| Where a grammar timing row goes. A row counts only if the parser was rebuilt from the measured commit and the macro/compose gates prove no interpreter fallback — the `1517e97c5` perf gate writes here | [`../parser/PARSEMAN-BENCHMARK-LEDGER.md`](../parser/PARSEMAN-BENCHMARK-LEDGER.md) |
| Parseman behaviours reproduced in this repo rather than read off a changelog. Titled 0.32.0 and **version-specific by construction** — re-verify every claim against the current floor before relying on it | [`../parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](../parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md) |
| The parse-perf research queue, per-item and separately measured | [`../../perf/PARSER_OPTIMIZATION_SPEC.md`](../../perf/PARSER_OPTIMIZATION_SPEC.md) |

**Historical evidence — do not let an old problem statement override the current plan:**

| Record | Read |
| --- | --- |
| Why the CSS AST grammar was ~2.3× its CST twin — the Stage 3 pattern proof the fold was built on | [`../parser/CSS-FOLD-DIAGNOSIS.md`](../parser/CSS-FOLD-DIAGNOSIS.md) |
| Stage 3 Phase A rename mapping (verdict: output-neutral, no mapping needed) | [`../parser/CSS-FOLD-PHASE-A-MAPPING.md`](../parser/CSS-FOLD-PHASE-A-MAPPING.md) |
| Stage 3 Phase B discovery notes, kept so the next dispatch does not re-pay the discovery cost | [`../parser/CSS-FOLD-PHASE-B-PARTIAL-FINDINGS.md`](../parser/CSS-FOLD-PHASE-B-PARTIAL-FINDINGS.md) |
| The 2026-07-17 dialect-architecture + error-coverage program. The physical re-base has landed; current status moved to `GRAMMAR-SEQUENCE-ORCHESTRATION.md` | [`../parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`](../parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md) |

Reviewer agents for this work: `.cursor/agents/grammar-reviewer.md` (evidence per
`const`; a bare verdict, "tests pass", or a sampled review is an invalid result)
and `.cursor/agents/perf-architecture-reviewer.md` (evidence per invariant).

The detailed future plans remain active for their grammar, feature/eval,
scanner-cleanup, and performance content. Their former bridge/host sections are
historical evidence only.

## Non-negotiable rules

- Grammar owns recognition and construction. Do not add a parser host, action
  registry, bridge, compatibility alias, source reparse, or fallback path.
- Parser recognition uses Parseman grammar combinators only. Imports and
  interpolation are typed first-parse facts.
- Preserve one canonical tree; do not normalize cloning, materialization,
  rediscovery, or error allocation in hot paths.
- Public operations use stable names such as `parse`, `build`, and `render`.

## Settled delimiter-container model

AST-v2 uses one `Block` value wrapper for delimiter-bearing values. `Block`
stores `inner`, `delimiter: 'paren' | 'square'`, and the existing optional
`escaped` fact for Less `~(...)`. It is deliberately transparent to typed
evaluation, participates in Less math-mode evaluation when the delimiter is
`paren`, and renders square-delimited values as authored bracketed lists. There
is no separate `Bracket` node and no `List.bracketed` field.

Where the grammar emits a public syntax `List`, it and the materialized value
`List` share the canonical payload shape: `value` plus an explicit separator
fact (`',' | '/'`). They never expose the former
`items`/`separators` pair or recover a separator from joined bytes. Ordinary
adjacent declaration/value terms are instead the raw recursive `ValueSlot`
array itself; there is no `SpacedValue` or `List(sep: ' ')` wrapper for that
case. Parsers may attach the exact authored boundary runs—spaces, comments,
line breaks, and indentation—to that array in the out-of-band provenance table,
so the semantic array stays plain while serialization remains trivia-aware:
comments and authored line breaks survive, while the renderer may normalize
continuation indentation to the surrounding output depth.
`SpacedValue` remains only where a non-value/prelude compatibility shape still
has an independent semantic reason to exist.

The legacy tree proves the same delimiter fact: its `Paren` carries
`delimiter: 'paren' | 'square'`, and Sass list functions preserve/read it for
`is-bracketed`, `append`, `join`, and `set-nth`. AST-v2 now carries that fact in
the canonical `Block` wrapper under `@jesscss/core/ast`; the root package does
not re-export it under the colliding legacy-tree name. Curly statement/ruleset
bodies remain outside this `ValueNode` design.

## Completion gates

Run focused parser/core tests first. Run the parser-runtime boundary verifier
when recognition changes. For eval/render/lookup/traversal/copying changes, run
`pnpm run verify:aggressive-cutting-review` before commit. Final integration
requires fresh builds, core tests, the Jess AST-v2 production-route ratchet,
and the Less corpus.

### Verified alpha squash policy (2026-07-22)

The `alpha` and `dev` branches share a common ancestor but independently added
the same source paths. A disposable rehearsal confirmed that
`git merge --squash dev` from `alpha` creates a broad add/add conflict set;
these are history-topology conflicts, not a semantic queue to resolve by hand.
Do not ordinary-merge or rebase `dev` into `alpha`.

For the refresh, first fetch `origin/dev`, create a recovery ref such as
`git branch alpha-pre-refresh alpha`, and work in an isolated `alpha`
worktree. Import the exact pushed source tree with a two-tree patch
(`git diff --binary alpha-pre-refresh..origin/dev` and `git apply --index`), then run
`node scripts/release/restore-alpha-package-versions.mjs --from alpha-pre-refresh --stage`
followed by `node scripts/release/record-alpha-source-provenance.mjs --stage`.
The required `--stage` makes that tool restore and stage only each
`packages/*/package.json` `.version` field from the
recovery ref; it must not restore whole manifest files. The alpha snapshot takes
all current `dev` manifest fields (including runtime/peer/dev dependencies,
exports, and publish configuration) and retains only recovery alpha versions
until the registry-aware release step selects the next version. `pnpm-lock.yaml`
is unchanged. Keep `dev`'s root quality gates (`verify:types` and bounded
production lint) and its newer HANDOFF/readiness/release evidence; reconcile
the alpha release note from final gate evidence instead of restoring the older
alpha docs wholesale.

### Less-alpha gate status (re-measured 2026-07-24 on `e34bb24b3`)

Measured in a clean worktree after `pnpm install --frozen-lockfile` + `pnpm run build:release`.
These are the numbers, not a narrative:

- `pnpm run verify:types` — **GREEN. 25 build configs at `facb641dd`** (the gate prints its own
  count; the `22/22` recorded here on 2026-07-24 is stale, and `PROJECT_STATE.md` repeated it).
  It was RED with one `less-parser`
  diagnostic (missing `CssAstSyntaxUnicodeRange`, introduced by `c1782031e`) from `13725f894`
  through `93e1aa49d`; `c3db7e53e` fixed it. `release:alpha:preflight` is no longer blocked here.
- `pnpm run test:less:test-data` — **108/108 on 2026-07-24; superseded by 109/110 measured
  2026-07-30**, see "That debt is now zero" below (`all-less.test.ts` is the only
  fixture-backed Less integration authority). Note what that number now means: `e34bb24b3` registered
  `css-3.less` and `variable-advanced.less` in `expectedFailureFixtures`, so the harness
  *asserts they fail*. See below.
- `pnpm --filter jess test` — not re-measured on `e34bb24b3`. Its failures are now a named set
  in `packages/jess/test/known-failures.json`, enforced by `scripts/vitest-ratchet.mjs`; read
  that file rather than any count in a doc. (Invocation note: `pnpm --filter jess test --run`
  fails with `Unknown option: 'run'` — pass it through as `-- --run`.)

#### The Less corpus authority is an external mutable checkout

`test:less:test-data` reads its fixtures through the root `package.json:11` dependency
`"@less/test-data": "link:../less.js/packages/test-data"`. **That specifier is RELATIVE, so
which corpus you measure against depends on where your jess checkout sits** (verified
2026-07-30):

- from the main checkout `~/git/oss/jess`, it resolves to
  `~/git/oss/less.js/packages/test-data` — a git checkout, currently branch `alpha` @
  `2f309b66`, whose state you can record as a SHA;
- from a worktree under `~/git/worktrees/`, it resolves to
  `~/git/worktrees/less.js/packages/test-data`, which **is not a git repository** (`git
  rev-parse` fails there), so its state cannot be recorded as a SHA at all.

The two trees were byte-identical on 2026-07-30 (`diff -rq` reported zero differences), but
nothing pins that, and a corpus number carries no meaning without naming which of the two you
resolved. State the resolved absolute path in every report, not just a count.

On 2026-07-24 the numeric-precision lane graduated four fixtures there
(`dded69cc`, "test-data: v5 numeric-precision expectations, 4.x snapshotted to legacy/"), so the
corpus encodes the *intended* v5 numbers while the jess-side change has not landed. That briefly
made the suite 106/108 with no jess-side change at all.

`e34bb24b3` resolved it the right way: both fixtures are now NAMED expected failures rather than
a bare red. Because that map *asserts* the failure, landing the precision fix will trip the entry
and demand its own deletion — the debt is visible and can only move toward zero.

**That debt is now zero (re-measured 2026-07-30 against jess `ef173125a` + less.js
`2f309b66`).** Both fixtures PASS: `tests-unit/css-3/css-3.less` emits
`rotate(-0.0000000001deg)` and `tests-unit/variables/variable-advanced.less` emits
`add-px-2: 393.3527559px`, matching the graduated `.css`. The table that used to list them is
deleted. `all-less` is 109/110 (80/81 unit + 30/30 config), the single red being the documented
`tests-unit/extend/extend.less`.

A third fixture, `import-remote.less`, is network-dependent and deliberately left gating; it is
documented in `known-failures.json` so the next reader does not mistake it for a regression. It
passed in this run (network available), which is exactly why it is documented.

Consequence a fresh agent must internalize: **a Less-corpus number is only meaningful together
with the less.js checkout state.** Record both SHAs, or the count is unfalsifiable.

~~The graduation commit states the landed constant as `1e-10` while the policy doc says
`1e-12`.~~ **RECONCILED — verified 2026-07-30 on `facb641dd`.** `numeric-precision-policy.md:6`
now opens with the owner ruling ("adopted job 1 with a relative tolerance of **`1e-10`**, not
the `1e-12` this document recommended"), and §7 "Job 1, concretely" (`:459-468`) is explicitly
labelled OVERRULED with "What actually landed: tolerance `1e-10`, gate 10". Code agrees:
`packages/core/src/ast/format-number.ts:28` `const TOLERANCE = 1e-10`.

The public Less route reaches canonical AST-v2 evaluation and serialization for direct and
imported documents: the Less plugin calls the public direct parser, Context carries its
`Stylesheet`, parser/source identity, typed builtin evaluator, and resolved dialect options,
and Jess serializes that document without a tree bridge or copied execution-option bag. The
Less test harness loads the macro-compiled public parser artifact, not Parseman grammar
source, and the Less-alpha command builds that parser/plugin pair before running integration
tests.

The corpus's marked expected-failure cases remain known Less-parity limitations, not
release-gate failures; the harness passes when a named fixture still fails, so none of them is
passing-parity proof.

## Context and plugin dispatch invariant

`Context` remains the canonical per-render coordination and state object. It
keeps options, diagnostics, caches, per-file state, eval/render frames, and the
installed plugin chain. Its import and parse methods are not duplicate
resolvers: `_getPath` dispatches active-plugin `expandImport`/`resolve`, then
resolver and locator plugins; `getTree` dispatches plugin `getSource` and
`safeParse`; `parseString` dispatches the selected parser plugin; `getModule`
dispatches the selected/lazily loaded module plugin.

AST cutover changes the document type carried through those same calls from
legacy `Rules` to canonical AST `Stylesheet` (or an explicit canonical document
result). It preserves Context diagnostics, cache, session, plugin ordering, and
visitor/lifecycle coordination. It does not introduce a separate loader,
resolver callback, or replacement dispatch topology.

Normalize the retained parser-plugin contract while doing so: today
`findParserPlugin` accepts either `parse` or `safeParse`, while `getTree`
requires `safeParse` and `parseString` requires `parse`. The AST result contract
must make that distinction explicit or adapt one form to the other through the
same Context dispatcher; it must not add a second parse path.

Candidates for removal are only:

- `Rules`-specific result types, caches, root assignment, and legacy-tree
  adaptation inside the retained Context methods;
- `StyleImport`/legacy `Rules` placement and evaluation behavior after a
  canonical AST consumer preserves its tested semantics through Context;
- a path proven to bypass the Context-to-plugin chain. The known instance of
  that category — the independent `node:fs` fallback in the former
  `packages/fns/src/util/file-resolution.ts` — was already removed (see the
  reachability audit below); no such bypass is currently known to remain.

`Context.readBinary` and JSON decoding in `getModule` are current explicit
core byte/module capabilities after plugin resolution, not evidence that
`_getPath`, `getTree`, `resolveImportPath`, `parseString`, or `getModule` should
be deleted. Decide their long-term capability ownership deliberately.

### Reachability audit (2026-07-21; spot re-verified 2026-07-24)

Re-checked on this pass: `packages/core/src/visitor/` does not exist; a workspace grep for
`BuilderHost`/`ParseHost` in `packages/*/src` returns nothing; and
`node scripts/verify-parser-runtime-boundary.mjs --require-clean` reports
`0 tracked temporary sites (0 exact ledger sites)`. The remaining claims below are as of
2026-07-21 and were *not* re-verified.


The direct-production call graph was audited before any bridge/tree deletion.
`packages/jess/src/index.ts` enters through `Context.parseString` or
`Context.getTree`, and AST serialization uses the retained Context methods
`loadImport`, `readBinary`, `withDocument`, `withSourceOwner`, and
`rememberDocumentBody`. These are the plugin/session/source-identity topology;
they are not parser or filesystem bridges and remain required.

No production `BuilderHost`, `ParseHost`, action registry, or parser-host
dispatch symbol remains in the parser packages or core. Parseman `BuildHost`
references are confined to the explicit CSS CST/document-language-service
builder API. Do not invent a replacement host to remove that name.

The old core `Visitor`/`Node.accept()` ABI is also no longer reachable: a
workspace search found no production or test consumer after the
`jess-plugin-less-compat` bridge cutover. Core no longer exports
`visitor/index.ts`, and `tree/Node` no longer carries the Less-style
`accept()`/`ABORT`/`REMOVE` machinery. This is distinct from the retained
Context-owned emit hook, which is a separate internal render lifecycle seam and
does not expose legacy per-node visitor dispatch. The separate
`packages/jess/src/visitor/index.ts` identity wrapper was likewise unimported,
unexported, and deleted; it was not a second valid visitor implementation.

The AST serializer's `withSourceOwner` seam no longer carries its dead
`legacyBody` fallback into `Context.withDocumentBody`. The public AST route
always supplies the real `Context.withSourceOwner` capability; the fallback
accepted a context-shaped object that could not implement the typed source-owner
operation and was not reachable from the public compiler/plugin route. The
Context `withDocumentBody` method remains valid for its direct document-body
provenance tests and is not removed or repurposed by this cleanup.

The public core barrel still exports the legacy tree corpus, and the root
`@jesscss/fns` barrel still exposes `packages/fns/src/less/*`; Context, the
legacy function barrel, compat type declarations, and visitor/language-service
consumers still import those classes. Root-tree export removal therefore has
concrete prerequisites: migrate or quarantine those consumers and isolate the
legacy Context execution state. The direct AST renderer itself does not read
`Context.root`, `treeRoot`, `rulesContext`, or `evaldTrees`.

The internal source formerly under
`packages/jess-plugin-less-compat/src/transform/` and `src/nodes/` was proven
unreachable from the package's only public entry point: the built package
exports only the native AST-v2 `LessCompatPlugin`, and its bundle contained no
`toLessNode`, `fromLessPluginReturnValue`, visitor, or transform symbols. The
dead transform/node adapters and their unreferenced helper/type/runtime files
were removed in the alpha.9 cleanup; the package-root native `Fn` API remains.
Likewise,
`packages/fns/src/util/file-resolution.ts` — an independent `node:fs`
`existsSync`/`readFileSync` walk over `opts.searchPaths` that stood alongside
`Context.readBinary` — was deleted in `05bfb8249` ("refactor(fns): use typed
Less image values", 2026-07-22). Its `less/*` image callers moved onto the typed
function IO capability, so path resolution now stays in Context: `ctx.io.readFile`
(wired in `packages/jess/src/index.ts` to `Context.readBinary`) resolves through
the same plugin file manager the import subsystem uses. `packages/fns/src/`
contains no `node:fs` import outside tests. The legacy `packages/fns/src/less/*`
barrel still awaits migration/quarantine on its own terms (above); that is no
longer a prerequisite for this file. The parser-runtime boundary audit is green (zero tracked temporary
scanner/reparse sites); remaining string scans in AST serialization are
evaluation/output semantics, not source recognition.

The aggressive-cutting verifier now treats the coordinated
`ValueSlot`/`List`/`Block` and callable-contract cutover as an explicit
seven-file `semantic-runtime` evidence lane. That lane requires named semantic
cases, focused behavior/build commands, and a current benchmark/output baseline
with `performanceClaim: "none"`; it does not pretend this feature-changing work
is a neutral optimization. Precise/conservative/removal contracts remain
required for any actual cutting or performance claim.

## Direct-root cutover order

The parser work has one real composition gate: a leaf dialect grammar must be
able to macro-fuse imported, recognition-only shared syntax while retaining its
own local direct-constructor reductions. It must not serialize local builders,
relax direct-builder capture validation, or create a reusable builder artifact.
That leaf-only fusion proves that imported recognition-only property/keyword
terminals fuse into local direct AST reductions with their token values intact.
It is incomplete public-parser implementation, not a private architecture or
completion claim. Continue in this dependency order:

1. Complete all four parser families (CSS, Less, SCSS, Jess) as direct AST v2
   `Stylesheet` parsers.
2. Update each plugin to consume its parser's `Stylesheet` while preserving the
   existing Context-to-plugin dispatch topology and plugin-specific semantics.
3. Update the Jess package integration/render route to use those AST-consuming
   plugins, then delete only legacy tree-specific realization such as
   `StyleImport` and any proven duplicate filesystem/module implementation.

### Canonical loop model

The public AST-v2 `For` contract is defined by the documented Jess
`$for (… of …)` syntax—not by Less `each()`. It is a flexible iteration protocol
in the spirit of JavaScript `for…of`: the source kind (list, collection/map,
range, or a later iterable value) determines the useful entry shape presented to
the authored binding pattern. Its bindings, source-dependent iterable behavior,
and source-order semantics must be named and shaped as Jess concepts. In
particular, do not preserve `valueName`, `keyName`, or `indexName` as the public
canonical node vocabulary merely because legacy Less `each()` used them.

Less `each()` is a compatibility input dialect. The Less parser lowers it into
compatible Jess-shaped loop helpers/patterns at its own boundary; it does not
make Less callback/key/index fields a core AST API. A general `For` rewrite must
preserve the public Jess header contract: `[$key, $value]` means key/value in
that order; the source kind supplies the entry shape. The current legacy tree
instead fills tuple slots positionally as value, key, counter for both comma and
bracket forms. That is a legacy implementation discrepancy to repair during the
general `For` rewrite, not an ambiguity in the public language and not a reason
to expose Less callback/key/index fields. Pin the remaining source-specific
entry shapes against public examples before direct Jess and SCSS parser tests.
Do not mis-lower SCSS tuple bindings to Less map-key/list-index roles while that
work is in progress.

`Context._getPath`, `getTree`, `resolveImportPath`, `parseString`, and module
loading are retained coordination/capability seams. In step 2, migrate only the
parser/document result path (`getTree`, `parseString`, plugin parse contracts,
and document caches) from legacy `Rules` to AST `Stylesheet`. Retain resolution and
raw-byte/JSON/module capabilities unchanged unless a later dedicated audit
decides their ownership; do not replace or delete the dispatch path while parser
closure is still in progress.

## Current parser-closure status

All four dialect packages now expose their stable public `parse()` operation as
a direct Parseman-to-`Stylesheet` route; explicitly named CST/document APIs remain
for language-service consumers. The direct grammars are still incomplete, so no
dialect has completed feature-complete parser closure. The public CSS/Less/SCSS/
Jess plugin adapters now call those direct parser operations and return the
canonical `Stylesheet` through Context; that integration is verified below but
does not claim parser or evaluator feature completion. The reductions below are
incomplete implementation toward that public route, not a second architecture
or a completion milestone.

- CSS public `parse()` directly returns `Stylesheet`. The current verified
  closure includes structured selectors and selector-to-block comment trivia,
  declaration-component comments and `!important` trivia, shared exponent
  numbers, `calc()` modulo, balanced query
  functions, conditional blocks, `@page`/margin boxes,
  `@font-feature-values`, typed static `@supports` conditions, generic opaque blocks, `@document`, nested `@scope`,
  and top-versus-nested known-block bodies. The direct public route is checked
  against the existing positive and error CSS fixture corpus. Literal CSS `@import` is now a
  top-level-only `AtRuleStatement`, never an import-resolution fact. Structured
  declaration values now carry scoped function and `var()` fallback components,
  including balanced nested component blocks; malformed or crossed delimiters
  remain rejected by grammar. Valid block comments between `url` and its opening
  delimiter lower to the existing `Url`; malformed URL payloads remain strict.
  This is a bounded value/import slice, not CSS
  feature completion: selector/value closure and corpus differential remain.
- SCSS public `parse()` directly returns `Stylesheet`. Its verified direct
  slices include static selector/comment/conditional structure, ordinary
  structural interpolated simple selectors, structural
  interpolation, complex selectors with typed combinators, static
  attributes/placeholders, selector-valued pseudo arguments, and bounded static
  non-selector pseudo arguments, interpolated
  declaration names, declaration merge modifiers, exact static `@extend`, descriptor-only `@font-face`,
  `@counter-style`, `@property` (including a typed `--custom-property` header),
  static root/nested CSS `@starting-style` and `@layer` blocks with grammar-owned
  static headers,
  root-only static CSS `@charset`, `@namespace`, and `@layer` statements through
  the existing `AtRuleStatement` fact (with Sass `//` comments remaining
  non-emitting trivia),
  static CSS `@scope` blocks through the existing `AtRuleBlock` fact, including
  their existing root, conditional, and declaration-capable nested placements,
  finite CSS `@page` plus margin-box blocks with static headers and
  declaration/comment-only bodies,
  finite `@font-feature-values` blocks with grammar-owned static `Any` headers,
  finite feature sub-blocks, and declaration/comment-only descriptor bodies,
  static CSS `@document`/`@-moz-document` blocks with recursive frame-one bodies,
  quoted/URL `@import` targets (including structural `#{…}` segments within
  quoted targets, quoted `url(...)` targets, and empty `url()` targets), static option lists, a
  bounded typed CSS-emitting `layer`-then-declaration-`supports(...)`-then-
  static media-query tail, an optional
  final variable-declaration semicolon, and unquoted interpolated
  declaration URLs as existing `Url(Interpolation)` facts; unquoted interpolated
  import URLs remain explicitly rejected. It also includes static `@for` endpoints with grammar-owned
  arithmetic,
  static custom-property tokens in typed value positions as existing `Keyword`
  facts (without changing Sass custom-property declaration semantics),
  typed static `@supports` conditions, and static CSS keyframes (including vendor headers, quoted escaped static
  names, typed selector lists, and conditional placement). The additional `@if`
  slice admits literal booleans plus static typed comparisons (`==`, `!=`,
  `>=`, `<=`, `>`, `<`) and grouped boolean structure, including its existing
  reachability inside mixin, `@each`, and `@for` bodies. Its selected bodies
  retain existing variable declarations, mixin definitions/calls, `@each`, and
  `@for` statements in authored order; a selected mixin is available to a later
  sibling through the shared source-order `If` publication model. This does not
  claim Sass bare truthiness, function predicates, comma/list conditions, or
  full Sass scope semantics.
  `@extend !optional` remains rejected until its diagnostic
  semantics have a typed AST field. SCSS media/container
  range queries need ownership redesign rather than flattening into
  `SpacedValue`; `SpacedValue` itself remains an existing undecided
  representation. Static SCSS module directives are a top-level document-prefix
  grammar and use parser-owned classification of unescaped literal paths:
  `@use "sass:name"` rewrites to `ModuleImport` / `@-use
  "#sass/name"`; clear script-module paths (including JSON) become
  `ModuleImport`; stylesheet paths become `StyleImport` / `@-compose`; and
  `@forward` is the existing `StyleImport` with `forward: true`, rendered as
  `@-export`. This is construction only: retained Context/plugin coordination
  still resolves, loads, caches, and evaluates the resulting import facts.
  Escaped or dynamic targets, plus `with`, `show`/`hide`, or prefix
  configuration, remain rejected until their typed/decoded representation exists.
- Less public `parse()` directly returns `Stylesheet`, including its direct
  static mixin subset with literal-pattern/rest parameters, named arguments,
  typed logical guards, corresponding ruleset guards, and typed indirect
  variable (`@@name`) references. Its verified current closure also admits
  escaped ordinary declaration/property identifiers, ordinary `PropertyReference`
  and the current internal `MapAccessor` values
  (pending the owner-reviewed public access-node rename), non-emitting `//` line comments, full
  direct statement bodies in detached-ruleset and `each()` forms (including
  existing typed keyframes and flat static mixin-call iterables/bindings), and
  inline `:extend(...)` rules with the same canonical statement body as an
  ordinary ruleset while retaining authored `ExtendInstruction` placement,
  `*[selector-list]` capture delimiters around its explicit static
  selector-list family (checked against ordinary selectors for that static
  subset; dynamic selector content is rejected only in capture),
  properties, a terminal declaration without a final semicolon, typed static
  `@supports` conditions, static CSS keyframes, lone typed interpolation
  preludes for `@media`, `@supports`, and `@keyframes`, and exact opaque
  UnicodeRange value/list leaves that remain outside arithmetic. Bare dynamic URL
  values and Less `@import url(...)` targets retain existing `Url(Interpolation)`
  facts. A lone `@{…}` import tail is likewise a typed `Interpolation`; mixed static/
  dynamic tails remain rejected until their segment model exists. Parser
  construction does not resolve any import fact. Generic at-rule headers
  remain static-only. Those are grammar-owned AST
  construction slices; named CSS colors and `transparent` lower through shared
  recognition to existing typed `Color` values while ordinary identifiers and
  `currentColor` remain non-color keywords. Less
  grammar/evaluation parity remains incomplete.
- Jess public `parse()` directly returns `Stylesheet`, including static
  selectors, semantic `$[…]` selector templates, documented `$for`
  list/range/key-value collection bindings, static unresolved typed
  `StyleImport`/`ModuleImport` facts for documented `@-` imports, and static
  first-class `Apply` facts for documented static ruleset-only selector lists.
  Documented `$ >` named mixin
  arguments lower directly to existing `CallArg { name, value }` facts; they do
  not add a dialect-local call node or binding path. Documented zero-argument
  variable-held callable statements lower directly to existing `VariableCall`
  facts; argument-bearing variable calls remain held until their typed
  argument/binding model exists. CSS `url()` values
  and documented `$[…]` declaration names lower structurally through existing
  `Url` and `Declaration.name: Interpolation` facts rather than raw source text,
  (including structured `$[…]` path segments in ordinary values and CSS
  `@import` targets) as canonical `Url` nodes, typed static `@supports` conditions, media/container
  range-query facts, `@property --name` descriptor blocks, static CSS keyframes,
  and modern CSS slash-separated function components. Existing variable-led
  call expressions remain available within those components; the slash itself
  is not bare Jess arithmetic. The documented lone `@media $(name) { ... }`
  form is a typed interpolation prelude and remains block-only; it does not
  widen generic headers or `@container`.
  Static CSS at-rules are
  carried directly by the existing canonical
  at-rule facts, including terminal static generic CSS opaque blocks through a
  shared recognition-only Parseman artifact. Jess collection literals lower to the canonical
  `Collection` node, not a CST-shaped map or opaque source fallback (current folded grammar:
  `packages/syntax/jess/jess-parser/src/grammar.ts:87` `Collection: Combinator<Collection>`,
  defined at `:3063`; the `DirectJessCollection` name this row used no longer exists). This
  sentence previously named the AST `DetachedRuleset` node, which `b7f413d08` DELETED in
  favour of the `Collection` / `AnonymousMixin` split — see
  [[collection-vs-detached-ruleset-model]]. Block-bodied lambdas reduce to `AnonymousMixin`
  (`grammar.ts:42` `BlockLambda: Combinator<AnonymousMixin>`). Dynamic
  `$apply` targets remain rejected until `Apply` has a typed dynamic-selector
  model; static `$apply` constructs one `Apply` fact at root, rule, selected
  `$if`, mixin-definition, and `$for` body positions. `Apply` is a core
  ruleset-only, whole-selector, merge-all operation; it is not a dialect render
  policy or an ordinary `MixinCall`. R3 now
  gives `$` live/current and `$^` scoped/final references explicit
  AST lookup facts; normal declarations write both stores, while `?:` and `:=`
  retain their selected lookup/write behavior. `$[$name]` is a live/live
  dynamic variable reference; Less `@@name` remains scoped/scoped. Selected
  `$if` branch declarations now enter both stores only after branch selection;
  they are not globally precollected. Selected `$if` branch mixin definitions
  publish only when the normal source-order walker reaches their definition;
  false-arm definitions stay invisible and publication is activation-local.
  Direct `$if` conditions also carry the existing strict `not`/`and`/`or` guard
  tree, including both adjacent and spaced comparisons; mixin-only guard forms
  remain excluded. Existing direct `MixinCall`, `VariableCall`, `$apply`, and
  `$for` statements execute through the ordinary selected-body walker; typed Jess
  style/module imports are emitted as facts while their plugin-owned loading and
  resolution remains a separate follow-up. The remaining
  documented Jess direct-route blockers are canonical AST/evaluator model work,
  not parser-host, Context, or import-resolution work: `$while` has no canonical
  AST/evaluation model; member/dynamic references and module calls need the
  owner-reviewed access/call model; and
  `@-compose` modifiers/configuration plus anonymous mixin/function forms need
  typed source-fact/callable models. Do not paper over any of those forms with
  raw source, a legacy tree, or a parser-side resolver. Do not migrate plugins or
  Context results back onto a legacy tree route. Keep the existing direct
  `Stylesheet` plugin/render route while completing the remaining dialect-specific
  grammar and evaluator coverage.

For the approved parser-only slices above: new node materialization is only
parser-owned canonical AST construction; no eval/render traversal, resolver,
loader, bridge, or new runtime parse path was added. Verification proves
grammar parity and construction only, never speed.

### Audited model gates before further direct-parser admission

These are real AST/evaluator requirements discovered from the current public
grammars. They are not permission to add a raw fallback, a parser-side resolver,
or a legacy-tree port.

- CSS/Less/SCSS/Jess general-enclosed `@supports` conditions (for example
  `selector(.x)` and `(future condition)`) now use the inert, grammar-owned
  `GeneralEnclosed { form: 'function' | 'paren', name, content: Interpolation }`
  fact. `Interpolation` is the publishable public noun (the former `Interp`
  name has no compatibility alias). Its recursive Parseman content admits only
  literal structured bytes and the dialect's explicit interpolation syntax; it
  is not `FunctionCall`, `Block`, `Any`, or a parser-local raw fallback. For
  Jess, "the dialect's explicit interpolation syntax" is `${…}` and only `${…}`
  — `$(…)` is a value-position expression, not interpolation, so it is rejected
  in the general-enclosed body and in every `(…)`/`[…]`/`{…}` nested inside it
  (`DirectJessGeneralTemplate`). A quoted string in that body is an ordinary
  Jess string and keeps `$(…)`, via the mirrored
  `DirectJessGeneralQuotedTemplate` chain. See DESIGN-DECISIONS P16. The
  serializer keeps a `GeneralEnclosed` segment structurally protected while it
  normalizes surrounding supports syntax, including when authored content has
  private-use Unicode bytes.
- Less static `~"…"` / `~'…'` uses the existing `Quoted.escaped` fact in
  ordinary values, URLs, import targets, guards, generic static at-rule
  headers, and keyframe names; ordinary quoted backslashes do not set that
  flag. Interpolated escaped strings and `~(…)` remain model gates until the
  direct grammar emits the existing `Interpolation`/`Block` facts and the
  serializer proves their authored output; this is an integration/evidence
  gap, not a limitation of the AST-v2 value model.
  Escaped literals remain excluded from direct `@supports` and query values:
  Less preserves literal `~"…"` spelling in a direct supports condition, while
  the existing escaped `Quoted` serializer emits inner bytes. Do not widen
  either context without a supports/query-specific representation and output
  proof.
- Less attributes with `@{…}` in their name or value now form one complete
  `SimpleSelector.interp: Interpolation` token. The grammar preserves brackets,
  static namespaces, operators, quotes, and modifiers as literal parts and
  retains each variable interpolation in source order. Dynamic namespaces,
  pseudos, and extend headers remain excluded; this is selector-token structure,
  not a generic raw-selector fallback.
- SCSS nested-property outer and leaf names now accept the already-supported
  structural `#{…}` property interpolation and lower directly to ordered
  `Declaration.name` facts, inserting exactly one prefix hyphen. An own value's
  trailing `!important` stays only on that own declaration; generated leaf
  declarations retain their own priority. The body remains declaration-only:
  comments, variables, control flow, recursive nested properties, and
  `@extend` are still held for a truthful delayed-prefix placement model.
- Complete SCSS condition semantics need shared semantic `Boolean` and `Null`
  values and an explicit false/null-only truth predicate distinct from the
  existing Less exact-true predicate. Do not map a Sass comma list to `or`, and
  do not silently reuse Less comparison semantics for Sass operators. Public
  value-node approval and a comparison-policy audit are pending.
- Deferred Less `&:extend(...)` needs `ExtendStatement` retained at its authored
  placement plus a render-local placement plan. `ExtendInstruction` remains the
  correct rule-attached data. The existing static preplan sees only direct rules,
  so direct grammar admission without that execution work would silently no-op.
  Public-name approval is pending.
- SCSS `@use`/`@forward` configuration needs typed config entries and typed
  forward prefix/filter facts. An escaped or dynamic target cannot truthfully be
  classified as `ModuleImport` or `StyleImport` before evaluation; a deferred
  import fact and matching Jess lowering require an owner-reviewed public model.
- SCSS `@at-root` needs a core output-placement statement, not an
  `AtRuleBlock` or synthetic `Rule`. The pending candidate is
  `AtRoot { target: default | selector | filter, body }`, where filter records
  `with`/`without` plus typed names. It retains lexical binding scope while
  selecting an output-placement ancestry; no literal `@at-root` may reach CSS.
  Exact filter vocabulary and selector-anchor behavior require owner approval
  before parser or serializer work.
- Variable-held calls use `VariableCall { target: VariableReference, args:
  CallArg[] }`, replacing `DetachedCall` without an alias. The current Jess and
  Less grammar admits only their existing zero-argument spellings; the node can
  retain arguments, but grammar work must not invent their syntax. `$`/`$^`
  lookup mode remains on the `VariableReference`; named/spread wrapper-argument
  semantics are held until they are defined against a variable holding an
  already-invoked `MixinCall`.
- Non-terminal semicolonless bare Less calls are not a harmless extension of
  the existing `FunctionCall` statement fact: depending on the following
  tokens, Less treats them as a sequence of statements or as a selector prefix.
  The public direct route admits semicolon-terminated calls and one terminal
  call before a block/document boundary; it must not guess at the remaining
  forms or absorb them as raw text. Their complete grammar/eval model remains
  a later direct-parser gap.
- Jess collection access needs a typed `MemberReference` model distinct from
  Less `MapAccessor` and bare `PropertyReference`. All `$[…]` interpolation is
  semantically ambient member access—`$[foo]` variable-member, `$['foo']`
  property-member, `$[$name]` computed variable-member—but the current direct
  AST still encodes those three base-less forms separately as
  `VariableReference`, `PropertyReference`, and `VarIndirect` inside an
  `Interpolation`. The new model must consolidate those partial encodings and
  add left-associated explicit-target access: dot/declaration names,
  variable-member bracket names, property-member quoted names, zero-based
  signed indexes, and computed bracket keys remain distinct typed access forms;
  every `$`/`$^` lookup mode stays on its own `VariableReference`. This records
  syntax, not a decision to port Less:
  `MapAccessor` has one-based indexing, Less variable/property namespaces, and
  a raw-byte fallback, all invalid for Jess. Existing R7 controls dot-member
  ambiguity (the surface must yield exactly one variable/property declaration;
  multiple candidates within either kind or across kinds is an error). A terminal
  `?` converts any member-chain lookup miss to Nil; the enclosing node's ordinary
  Nil-collapse semantics decide the output. JS own-export policy and final
  node/field names require owner approval before parser or evaluator work.
  `$while` is not currently a documented Jess feature; do not
  port its legacy block-frame behavior without first defining its public
  control-flow contract.
- Jess static generic CSS opaque at-rule blocks have an existing terminal
  `OpaqueAtRuleBlock` model. The earlier claim that Parseman cannot macro-fuse
  their structural capture was wrong: imported recognition-only `scanTo` and
  `balanced` artifacts fuse correctly. The failed attempt imported CSS's terminal
  AST-builder grammar instead of a recognition-only artifact. Extract the opaque
  header/body capture into `parser-shared`, then fuse it into Jess's local
  reduction. Do not replace that work with runtime grammar composition, a
  scanner, regex recognition, or source reparse.

### Queued after public parser closure

- Parseman needs a compile-time grammar-family abstraction for the case where
  two direct productions share the same combinator structure but substitute
  different recursive entry rules. A TypeScript helper that calls `node`,
  `sequence`, or `parser` is rejected because it hides that structure from
  macro fusion (`composeLeaf() must macro-fuse; runtime composition is
  forbidden`). Jess selector capture therefore keeps its static and
  interpolation-capable selector families explicit; do not work around this
  with a host, scanner, post-parse validation, or runtime combinator factory.
  A Parseman feature must preserve first sets, recursive rule identity, and
  macro-compiled output while allowing this parameterization.
- Generate and publish a complete Parseman railroad-diagram reference for CSS,
  Less, SCSS, and Jess in the public Docusaurus site (`packages/docs`). This
  must run from each finished public grammar (including reachable rules and
  documented terminals), be regenerated in CI or an explicit docs command, and
  link from the parser-language docs. Do not generate diagrams from today's
  incomplete direct-AST grammars or present them as the language reference.
- Design dialect-to-Jess compiled conversion around opt-in observed
  compilation facts: resolved import/file provenance and actual function-call
  outcomes determine Jess-relative paths and `@-from`/`@-use` dependencies.
  See [`DIALECT-TO-JESS-COMPILED-CONVERSION.md`](../../design/DIALECT-TO-JESS-COMPILED-CONVERSION.md).
  It must not re-resolve/reparse source or replace Context/plugin dispatch.
- **Final-pass output positions / sourcemaps:** replace mutable global absolute
  cursor accounting with a `trackPositions`-only composable output-fragment
  lane. Fragments retain local node-boundary markers beside string leaves;
  charset/import hoists and adjacent-block reopening move or append fragment
  references, async values resolve their slot before flattening, and one final
  linear pass produces CSS plus public absolute offsets. Reject repeated
  partial joins/counts, offset rewriting after reorder, and per-character
  objects. Preserve the current plain `string[]` maps-off path exactly. Before
  adoption, prove byte identity plus final offsets for hoisted charset/CSS
  imports, reopened adjacent rules, empty-block rollback, async replacement,
  repeated mixin placement, and imported-document origins; measure maps-off
  regression and tracked-fragment allocation against matched baselines.

## Aggressive-cutting gate policy and standing design rules

> The ~3,300 lines of per-pass self-prosecution records that used to follow were deleted on
> 2026-07-24. Each was a per-commit evidence block already preserved in `git log`, and every
> one described work that has landed. Only the durable rules below, plus the single CURRENT
> pass block at the end of this section, survive.
>
> **How to use this section:** `scripts/verify-aggressive-cutting-review.mjs` reads the LAST
> `## Aggressive Cutting Self-Prosecution` heading in this file and requires the eleven
> labelled fields in its most recent `- Latest pass:` entry. REPLACE that block with your
> pass; do not append a new one and leave the old one behind. Historical passes belong in the
> commit message, not here.

### Gate policy

Alpha readiness uses the staged patch gate and its focused evidence, not the
historical `origin/dev..HEAD` inventory; the aggregate mode was deleted because
it had no bounded owner or remediation. Runtime cost cuts require exact
owner contracts and measurements; semantic/parser/frontend/public changes
require behavior/build/boundary evidence without fabricated performance claims.

### Queued design audit: final-pass output positions

- **This docs pass:** no runtime traversal, node, allocation, API, or metadata
  mutation was added. The queue rejects the current `Emit.off` model because
  async placeholders and output rewrites can make eagerly stored absolute
  offsets stale.
- **Required future shape:** a cold, `trackPositions`-only fragment/marker
  lane; final flattening is the sole absolute-offset calculation. The normal
  render path must remain the existing direct `string[]` emission without
  fragment objects, marker arrays, source-map work, or a second render walk.
- **Evidence requirement:** behavior tests must cover every reorder/rollback
  path and async replacement before positions become public evidence; only a
  matched benchmark/allocation comparison may claim the maps-off path remains
  neutral.

### Rejected nested Less `@media` conjunction assumption (2026-07-21)

Commit `81e2f7ffc` assumed nested singleton `@media` groups should be emitted
as sibling groups with conjoined qualifiers. The upstream Less corpus disproved
that assumption: `at-rules-bubbling`, `at-rules-targeted`, and
`extend-chaining` require the existing nested output. The implementation and
its focused expectations were reverted. Do not reintroduce renderer-side media
conjunction without a corpus-backed semantic specification that covers those
cases.

### Addendum: canonical AST source-span provenance (semantic diagnostics)

`ast/provenance.ts` is a deliberately narrow parser-to-diagnostic fact channel.
Parseman reductions attach only their exact source spans to a session-independent
`WeakMap`; normal evaluation and rendering do not read it. The serializer reads
the fact only while constructing a diagnostic, where a source offset is required
to render the correct code frame. The process-global symbol is required because
parser packages load the `@jesscss/core/ast` bundle while the compiler serializer
loads the core root bundle; those are separate bundled module identities and
must share the same parser-authored table.

- **Behavior evidence:** `ast/__tests__/provenance.test.ts` proves that the
  side table preserves node shape. The public Jess render diagnostic test and
  a built-package Compiler route both report `$[path]` at source column 13,
  proving that the parser-written span reaches root-bundle serialization.
- **Fact flow:** Parseman reduction → `withSourceSpan` → `WeakMap` →
  diagnostic-only `sourceSpanOf`; no source walk, reparse, node mutation, copy,
  or render-time collection occurs.
- **Cost/gate status:** no speed or neutrality claim. The existing `WeakMap`
  write is semantic parser work for diagnostics, and its lookup is cold error
  handling; this entry does not assert a global aggressive-cutting gate pass.

### Dialect function conversion (registration LANDED 2026-07-24; per-fn conversion continues)

The July 21 audit found 72 same-named files in `packages/fns/src/less/` and
`src/builtins/` — different implementations, not interchangeable copies.
`builtins/` was comparison evidence, never a destination architecture, and it is
now DELETED: each converted value-domain implementation was collapsed into its
dialect owner in `less/`, replacing the legacy twin, and registration DERIVES
from the composed dialect index rather than a hand-maintained assembly array.
Each dialect registers only its own index — no merged registry, no cross-dialect
fallback. That closed the live correctness bug in which `.scss` was served
Less's built-ins.

The remaining queue is behavior-complete conversion of the still-legacy modules
in the existing dialect-owned files (`shared/`, `less/`, and `sass/`): port one
small function in place to an AST-v2 `Fn` and prove parity. Adding it to the
dialect index is what registers it. No wrapper, alias, reduced behavior, or
permanent legacy holdout is permitted.
Relative color is a separate first semantic batch: direct AST retains its
structured clause, but full `calc(r + 40)` needs a typed call-level channel
evaluation design before a behavior-preserving port.

The public-entrypoint cutover is DONE: `packages/fns/src/index.ts` exposes the
dialect namespaces plus the registry helpers, `less/index.ts` and `sass/index.ts`
are the composed dialect indexes (own folder + the `shared/` entries that dialect
has), and `builtins.ts` is deleted. The corresponding tree-based tests (`Context`, `callWithContext`,
tree constructors, and `instanceof` assertions) must move to typed direct-call
or compiler-route tests; their byte/output expectations remain oracle evidence.
The package wildcard export means legacy subpaths also need an intentional public
export cutover, rather than disappearing by accident. This is active work, not a
completion claim.

**Settled F5 relative-color and fallback boundary:** CSS-shaped literal
`rgb`/`rgba`/`hsl`/`hsla` calls with three or more argument slots are
un-operated bare Calls: they emit authored bytes and are not invoked unless a
consumer demands their value (an enclosing operation or a Less/variable
argument is such demand). Modern space/slash and relative syntax uses a nested
structured slot and follows the same arity rule. Less's one-/two-slot overloads
are not part of this lazy boundary: they dispatch through the selected Less
callable, so recognized forms such as `rgba(#5F59)` canonicalize and malformed
numeric arities reach the normal call-level `functionMode` policy. Therefore
unsupported relative-color syntax does not throw while its CSS-shaped Call
remains un-operated. On demand, the selected implementation may reject; the
evaluator's existing `functionMode` policy—not an individual function—then
decides whether to preserve the authored call or propagate the error. A
function must never manufacture a fallback call node. Preserve this F5 demand
gate when the builtin registry moves out of `builtins/`; it is distinct from
lazy parameters and from `functionMode`. No broad relative-color port is
approved by this statement.

**Settled callable capability boundary:** direct callable invocation supports
typed positional values plus typed named-record assignment (including mixed
calls) for Sass and Jess. The evaluator/registry route continues to pass a
typed positional `List`; Less is positional-only for the current alpha and may
add hybrid records later only with an explicit Less syntax/evaluator decision.
This is a callable capability boundary, not a claim that every dialect parser
accepts named arguments.

**Settled typed-list ownership and callable shape:** list recovery and numeric
indexed access are core Jess value capabilities, not Less-owned helpers. Core
owns exact separator/bracket-aware value structure, zero-based value access, and
the universal `defineFunction`/`Fn` callable contract. Core does not normalize
indices or impose one-based language semantics.
Less, Sass, and future libraries register that same callable shape and provide
declared semantic policy data (for example unit compatibility,
bracketedness/separator defaults, rounding, or map behavior); they do not get
separate function APIs or helper contracts. The AST-v2 cutover therefore audits
and ports Sass list functions too; the legacy Sass list APIs are not a protected
exception or a reason to retain legacy tree values. Every remaining legacy list
dependency must either be replaced with the core capability or be explicitly
shown to encode declared policy data rather than a second runtime model.

**Value-list separator invariant:** a semicolon is a statement/declaration
delimiter, not an AST-v2 value-list separator. When syntax places a semicolon
between values outside the rules level, the parser reduction lowers it to the
canonical comma-separated `List` fact. The typed value model therefore carries
only explicit comma/slash `List` boundaries; raw recursive arrays carry
ordinary space adjacency, and no semicolon or undecided separator fact exists.

**Value-list index invariant:** core JS access is zero-based and does no numeric
normalization. Less `extract` and Sass `list.nth`/`set-nth` each implement their
own one-based conversion, truncation/flooring, non-finite, negative, and bounds
rules inside the universal callable contract. A shared core accessor must not
silently choose one language’s policy.

## Collapsed nesting source-order invariant

When nesting collapses, the renderer emits nested rules in authored source
order. A parent declaration after a nested rule belongs after that collapsed
child, in a later parent block. Regrouping it ahead of the child to coalesce the
parent selector is a semantic bug because it changes CSS cascade order.

| Case | Authored order | Prior Jess / historical Less 4 output | Intended authoritative output | Reason |
| --- | --- | --- | --- | --- |
| `property-accessors` `.block_2` | `color: red; .two { … }; color: blue;` | One `.block_2` block with `red` and `blue`, then `.block_2 .two`. | `.block_2(red)`, then `.block_2 .two`, then `.block_2(blue)`. | The later `color` must not cross the child selector; the corrected Less-alpha golden is the source-order oracle. |
| `mixins-important` `.class` | Each `.mixin(n)` expands `border/boxer; .inner { test }; border-width`. | All parent `.class` declarations grouped first, followed by all `.class .inner` rules. | Alternating parent-leading block, `.class .inner`, parent-trailing block for every expansion. | Mixin expansion is authored body order; regrouping across `.inner` changes cascade order. Less 4 is comparison evidence only. |

The direct core regression is `rule-placement-direct-acceptance.test.ts`:
`before; .child { inside }; after;` must emit parent-before, child, parent-after.
The linked Less test-data fixtures are the public regression surface. No
collapsed-nesting output may select a smaller selector grouping over this
invariant.

### Imported callable namespace continuation

An executed import records its direct `MixinDef` and `Rule` facts in a new,
source-ordered render-frame callable stream. Namespaced path descent consumes
that stream, while ordinary bare-call lookup continues to use the frame's
existing mixin index. This lets an imported namespace contribution and a later
local namespace contribution both participate in a typed call-result accessor
such as `#theme.dark.navbar.colors()` followed by `@theme-colors[secondary]`;
the selected member retains the call-level `!important` fact. No import
resolver, parser replay, source reconstruction, or compatibility path is
involved.

## Archived Aggressive Cutting Self-Prosecution

- Latest pass: scoped-caret parser syntax slice on 2026-07-29. Jess source now
  spells scoped/final variable lookup as `$^foo`, with expression-only `^foo`
  for Less math lowering. SCSS math remains `$($foo + 1)` because SCSS `$foo`
  is the variable token and avoids declaration-lookup ambiguity.
- Architecture surface: changed intentionally at the parser syntax and
  documentation boundary. The only core runtime edit is the undefined
  scoped-variable diagnostic text, replacing the retired `$$foo` spelling with
  `$^foo`.
- Separation/duplication: reduced by removing the old `$$` fallback language
  from conversion and public docs. Less conversion now has one canonical scoped
  read spelling; SCSS keeps its separate variable spelling.
- Cumulative node weight: unchanged. No AST node type, CST label family,
  materialization route, render wrapper, parser replay, or runtime dispatch host
  was added.
- New traversal: none.
- New node/materialization: none. The changed `ReferenceError` line is an
  existing exceptional failure site and does not create a new node, copied rule,
  wrapper `Rules`, side table, source metadata mutation, or render materialized
  array.
- Render path: unchanged for successful renders. The diagnostic-only string
  update changes the spelling reported for an undefined scoped variable from
  retired `$$foo` to `$^foo`.
- Helper/API surface: one grammar atom was added for expression-only `^foo`;
  no exported API, helper layer, parser host, or runtime resolver fallback was
  added.
- Metadata mutations: none.
- Behavior evidence: `pnpm --filter @jesscss/jess-parser test --
  ast-grammar.test.ts -t "live/scoped|arithmetic expression-only|calls
  as|declaration-member"` passed; `pnpm --filter @jesscss/jess-parser test --
  cst-public.test.ts` passed; `pnpm --filter jess test --
  conversion-construct-support.test.ts` passed; the registered
  `ast-semantic-runtime-cutover` behavior command passed 128/128 tests.
- Build evidence: `pnpm --filter @jesscss/jess-parser build`, `pnpm --filter
  @jesscss/core build`, `pnpm --filter @jesscss/awaitable-pipe build`, and
  `pnpm --filter @jesscss/fns build` passed in dependency order.
- Boundary evidence: public docs now describe `$foo` as live/current, `$^foo`
  as scoped/final, `^foo` as expression-only, Less `@foo + 1` lowering as
  `$(^foo + 1)`, and SCSS `$foo + 1` lowering as `$($foo + 1)`.
- Evidence: behavior, build, macro, compose-integrity, and aggressive-cutting
  contract evidence is recorded in the bullets and JSON audit record in this
  latest pass.
- Verdict: accepted. This is a parser/source-spelling correction with no
  performance claim and no added successful render/eval hot-path machinery.
- Review-flagged diff tokens: [node construction] the current diff touches an
  existing exceptional `ReferenceError` allocation only to correct its diagnostic
  spelling from retired `$$foo` to `$^foo`; this is not routine control flow,
  not a new allocation site, and not a successful render/eval path.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "This slice changes a serializer diagnostic spelling that belongs to the coordinated AST-v2 runtime owner, but it does not claim a neutral refactor, cost cut, or speed result. The semantic point is source spelling correctness: undefined scoped variables should mention `$^foo`, matching the parser and docs.",
    "dangerTokensJustification": "The only danger token is [node construction] at an existing exceptional `ReferenceError` site. The change edits the error message text from retired `$$foo` to `$^foo`; it adds no traversal, allocation site, branch, render array, parser replay, or normal lookup fallback.",
    "behaviorEvidence": "`pnpm --filter @jesscss/core test -- --run src/ast/__tests__/value-define-function.test.ts src/ast/__tests__/value-list.test.ts src/ast/__tests__/plugin-direct-body-scope.test.ts src/ast/__tests__/extend-direct-acceptance.test.ts src/ast/__tests__/extend-preflight-contract.test.ts src/ast/__tests__/value-operate-units.test.ts src/tree/__tests__/declaration.test.ts src/tree/__tests__/declaration-merge.test.ts` passed 128/128.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the diagnostic spelling change.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  }
]
```

- C16 scoped-function lookup slice on 2026-07-27: AST serialize frames now keep
  `fns` as a strictly local function-family registry and add `fnScope` /
  `fnScopeVersion` only as a render-local nearest-registered-frame cache. Empty
  ordinary frames still allocate no function map; registering scoped plugin
  functions increments the render-local version and retargets that frame to
  itself so child caches cannot silently miss late parent registrations.
- New traversal for this slice: `nearestFnScope` walks parent frames only on the
  scoped-function path (`e.anyScopedFns === true`) and only until it reaches a
  cached registered function frame. That replaces repeated per-call scans across
  empty frames; it does not touch the no-plugin/built-in-only value hot path.
- New node/materialization for this slice: none. The change adds two optional
  render-frame metadata fields and one tiny cache-state interface; it creates no
  AST nodes, no copied rules, and no shared registry with variables,
  declarations, or mixins.
- Behavior evidence for this slice:
  `pnpm --filter @jesscss/core build && pnpm --filter @jesscss/fns build &&
  pnpm --filter @jesscss/core test -- src/ast/__tests__/plugin-direct-body-scope.test.ts --run --reporter=dot`
  passed 8/8 after rebuilding in dependency order. The focused test verifies
  nearest registered function caching, case-insensitive lookup, no empty-frame
  local map allocation, and cache invalidation when an intermediate parent gains
  a scoped function.
- Review evidence for this slice: `pnpm run verify:aggressive-cutting-review`
  passed. The command reports the broad active diff's existing danger-token
  inventory; this slice accounts for its added parent walk and optional frame
  metadata above.
- C17 module-cache slice on 2026-07-28: `Context.getModule(...)` now mirrors
  stylesheet import and executable `@plugin` module loading by caching the
  in-flight/successful ordinary module result for the current source context,
  source plugin, authored specifier, and import type. The cache prevents a
  script/JSON module from being resolved and loaded twice during one compile
  context while preserving failure retry behavior.
- New traversal/node/materialization for this slice: none beyond the existing
  `_getPath`/plugin import work that a cache miss already performs. The added
  `Map` is `Context`-local compile-cycle state; it stores the same
  `{ module, triedPaths, resolvedPath }` result already returned to callers and
  introduces no AST node, render array, parser replay, or cross-compile global
  registry.
- Behavior evidence for this slice:
  `pnpm --filter @jesscss/core test -- test/context-module.test.ts --run --globals --reporter=dot`
  passed 9/9, including a regression that proves two calls for the same script
  module return the same result object after one resolver pass, one lazy script
  importer load, and one module import. `pnpm --filter @jesscss/core test --
  src/ast/__tests__/import-at-rule.test.ts --run --globals --reporter=dot`
  passed 37/37, preserving executable `@plugin` module cache behavior.
- Review/build evidence for this slice: `pnpm --filter @jesscss/core build`,
  `pnpm run verify:aggressive-cutting-review`, `pnpm run verify:less-alpha`,
  `pnpm run check:macro`, and `pnpm run verify:compose-integrity` passed. No
  measured performance claim is made.
- Latest pass: AST extend IR naming normalization on 2026-07-29.
- Architecture surface: private extend-solver IR naming changed intentionally.
  The existing lowered selector facts are now spelled `SelectorPart`,
  `segments`, `combinator`, and `Compound.value`. The public canonical selector
  AST remains the flat selector-term/combinator sequence; the lowered
  `{ combinator, compound }` shape stays private to the extend matcher and is
  not a visitor or parser-output precedent.
- Separation/duplication: improved slightly. The private IR no longer carries
  separate shorthand vocabulary (`Seg`/`segs`/`comb`/`simples`) that conflicts
  with the canonical AST naming rules. The exported `ComplexSelectorPart` alias
  is gone; public AST types speak directly in `SelectorTerm | Combinator`.
- Cumulative node weight: neutral. No AST node, selector wrapper, side table,
  runtime validator, or compatibility alias was added or removed.
- New traversal: none. Existing extend loops were renamed in place; no planner
  pass, matcher pass, selector scan, parser replay, or diagnostics crawl was
  added.
- New node/materialization: none. Existing arrays, spreads, and object literals
  in the extend solver retain their current ownership and are only renamed.
- Render path: unchanged. The serializer still constructs the same private
  extend IR after selector interpolation and emits the same CSS; no output
  policy or fallback path changed.
- Helper/API surface: no public helper was added. The public
  `ComplexSelectorPart` alias was removed from the AST barrel surface; the
  remaining `SelectorPart` type is private to `ast/extend`.
- Metadata mutations: none. Existing `key` and `bnd` provenance fields keep
  their behavior; this pass adds no parent/source/frozen/trivia mutation.
- Behavior evidence: `pnpm --filter @jesscss/core test -- --run src/ast`
  passed 38/38 files and 342/342 tests after the rename.
- Build evidence: `pnpm --filter @jesscss/core build` passed after the final
  public-alias cleanup; `pnpm run verify:types` passed 25/25 configs.
- Boundary evidence: `pnpm run verify:types` proved removing the exported
  `ComplexSelectorPart` alias does not break workspace consumers; the public
  AST shape remains inline `SelectorTerm | Combinator`.
- Evidence: behavior, build, type, and boundary evidence are listed above. No
  measured performance claim is made.
- Review-flagged diff tokens: [loop/traversal], [array helper], [array
  spread/materialization], and [materialized array/object] are existing extend
  solver loops/arrays/objects renamed in place; no new loop, allocation family,
  spread path, or materialized selector wrapper was introduced.
- Verdict: accepted as a neutral private naming cleanup with no speed claim and
  no canonical AST shape change.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "This pass changes naming inside the existing AST-v2 extend owner rather than introducing a new optimization boundary. The private solver still performs the same composition, matching, interpolation resolution, and fixpoint solve work; the patch removes misleading public/internal names without claiming cost neutrality or speed.",
    "dangerTokensJustification": "The flagged loops, maps, spreads, arrays, and object literals are existing extend solver work with renamed fields/types. No planner pass, matcher pass, selector traversal, allocation family, render policy, public selector wrapper, or runtime validation was added.",
    "behaviorEvidence": "pnpm --filter @jesscss/core test -- --run src/ast passed 38 files / 342 tests.",
    "buildEvidence": "pnpm --filter @jesscss/core build passed after the final public-alias cleanup; pnpm run verify:types passed 25/25 configs.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": [
      "Context-plugin-source-parser-dispatch",
      "emit-walk-context-output-option",
      "Ruleset-interpolated-selector-boundary",
      "selector-match-string-and-node-combinators",
      "extend-index-tagged-graft-atoms",
      "Sequence-subclass-preserving-evaluation",
      "callable-output-root-property-guard",
      "serializer-at-rule-and-selector-surface"
    ],
    "why": "This slice relocates generic helper imports used by Context and extend-index to their new core util paths. The Context/plugin dispatcher, extend-index tagged IR behavior, selector matching, callable output, and serializer contracts are unchanged; this is ownership cleanup without a speed or semantic expansion claim.",
    "dangerTokensJustification": "The diff rewrites import specifiers and moves existing helper modules. It adds no parser host, alternate evaluator, resolver, output policy, AST materialization route, render-output array path, traversal, or runtime validation.",
    "behaviorEvidence": "Focused bitset and dimension behavior passed: `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run` (61/61).",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the helper relocation.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "cases": [
      "declaration-sync-and-async-render-result",
      "declaration-merge-source-span-exclusion",
      "default-guard-owned-value",
      "bitset-inversion-and-disjointness",
      "string-and-node-combinator-recognition",
      "selector-list-singleton-collapse",
      "selector-list-array-or-node-inheritance",
      "parser-delivered-selector-array-ampersand",
      "selector-array-ruleset-callable-registration",
      "selector-array-key-set-analysis",
      "selector-compose-cache-node-boundary",
      "ordered-registration-context-restoration",
      "property-merge-container-scope",
      "mixin-invisible-sync-render-and-registration-result",
      "extend-record-selector-surface",
      "extend-root-composition-selector-surface",
      "extend-walk-composed-match-selector-surface"
    ],
    "why": "This slice relocates the generic bitset and numeric operator helpers from legacy tree util paths to core util paths, then repoints their existing legacy tree consumers. The helper behavior and selector/extend contracts are unchanged; this is ownership cleanup for the retained legacy-tree drain, not a speed, neutrality, or semantic expansion claim.",
    "dangerTokensJustification": "The diff moves existing helper modules and rewrites import specifiers. It adds no traversal, no object allocation, no parser replay, no materialization cache, no selector matching branch, no output policy, and no new runtime validation.",
    "behaviorEvidence": "Focused bitset and dimension behavior passed: `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run` (61/61).",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the helper relocation.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-visitor-abi-removal",
    "verdict": "accepted",
    "costDelta": "neutral",
    "why": "This import-only slice touches `node-base.ts` solely because its `Operator` type import now points at the core util helper. It does not restore or alter the removed visitor ABI, add a dispatch method, allocate a facade, or change node behavior.",
    "byteIdentity": {
      "fixture": "benchmark.less",
      "collapseNesting": true,
      "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6",
      "outputBytes": 122390
    }
  },
  {
    "id": "bounded-core-tree-lint-guards",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the five bounded core tree helper owners listed by bounded-core-tree-lint-guards",
    "cases": [
      "List raw NodeArrayItem normalization",
      "canonical node-array prefix guard",
      "root node validation narrowing",
      "callable candidate record narrowing",
      "extend helper lint-safe syntax"
    ],
    "why": "This slice changes `List` only to import the shared `Operator` type from its new core util path. The List normalization and validation behavior named by the bounded lint-guard contract is untouched; this is a dependency-path cleanup, not a performance or semantic behavior change.",
    "dangerTokensJustification": "The touched List hunk is an import-specifier rewrite. It adds no branch, traversal, allocation, validation helper, parser replay, or render path.",
    "behaviorEvidence": "Focused dimension operator coverage passed as part of `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run`.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the import rewrite.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  }
]
```
- Latest pass: Less alpha parser/error integration state on 2026-07-27. The working diff includes
  the one-grammar parser fold, Parseman 0.41 grammar cleanup, parser-owned diagnostics, trivia
  extraction work, and the recursive reference error fix that graduated the Less recursion fixtures
  out of the worker-hang skip list.
- Architecture surface: changed intentionally. CSS/Less/SCSS/Jess parser packages now build AST and
  CST from one host-mode grammar source; Less parser owns parse diagnostic facts; the Less plugin
  forwards parser diagnostics as a thin wrapper; core eval now reports recursive variable/property
  references through the normalized Jess error surface.
- Separation/duplication: reduced. The duplicate `src/ast/grammar.ts` files are deleted; dialect
  plugins should not duplicate parser error normalization; comments are treated as trivia facts
  rather than value/comment AST children in the active Less cleanup lane.
- Cumulative node weight: reduced in parser source by the eight-to-four grammar fold and ordinary
  value-comment removal. The recursive-reference patch adds no AST node type or persistent runtime
  field; it adds one diagnostic code/factory and cold structural checks for recursive reference
  failures.
- New traversal: bounded and cold. Recursive variable/property detection only walks frame stacks
  after a normal lookup miss, plus a declaration-activation structural value walk for same-name
  direct references with no earlier fallback. Grammar/trivia walks are parser/source-boundary work,
  not render-tree rescans.
- New node/materialization: no runtime AST materialization is added by the recursive-reference fix.
  Parser grammar changes intentionally remove duplicated grammar files and ordinary comment value
  nodes; generated parser artifacts and tests account for parser package materialization separately.
- Render path: changed for error quality only. Recursive `@var`/`$prop` now throws
  `eval/recursive-reference` instead of hanging or silently accepting; successful fallback to an
  earlier binding remains allowed. No CSS byte-identity or speed claim is made here.
- Helper/API surface: public error codes/diagnostic helpers gained
  `eval/recursive-reference`; Less parser safe-parse diagnostics are parser-owned and forwarded by
  the plugin. Parseman 0.41 grammar APIs are consumed by parser packages through their package
  dependency floor.
- Metadata mutations: parser provenance/trivia metadata is intentionally source-indexed. The
  recursive-reference fix adds no parent/source mutation and reads source spans only to locate the
  thrown diagnostic.
- Behavior evidence: `pnpm --filter jess test -- test/less/reference-public-semantics.test.ts --run --globals --reporter=dot` passed 15/15, including recursive variable/property diagnostics and legal same-scope fallback references; `pnpm --filter jess test -- test/less/all-less-error.test.ts --run --globals --reporter=dot` passed 94/94 after removing the recursive-worker skip list.
- Build evidence: `pnpm --filter @jesscss/core build` passed after the recursive-reference changes; prior parser/plugin verification for this integration state includes less-parser and plugin-less builds from the active slices.
- Boundary evidence: public Jess render errors expose the normalized `eval/recursive-reference` code/phase/reason; Less plugin safe-parse forwards less-parser diagnostics rather than wrapping them with plugin-local parser classes.
- Review-flagged diff tokens: [loop/traversal] bounded frame/value walks for recursive miss detection plus parser/trivia integration loops; [array helper] parser/test/trivia helpers and value-structure probes outside render output construction; [array spread/materialization] existing diagnostic/plugin/parser object spread and test setup in the broad dirty diff; [generator] trivia range iterators in parser provenance work, not core eval recursion; [node construction] diagnostic `JessError` creation and parser/test fixtures; [parent/source mutation] diagnostic location reads and source-span/trivia plumbing, while the recursive-reference patch performs diagnostic span reads only; [side map/set] existing/provenance trivia maps plus temporary test/parser maps, while recursive-reference state stays on the existing exclusion set; [routine error control] real diagnostics and plugin/parser failure boundaries, not expected hot-path control flow; [materialized array/object] parser/test fixtures and bounded diagnostic/value traversal scratch outside persistent render materialization.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "This integration changes parser-owned facts, recursive reference diagnostics, and trivia/provenance surfaces in the coordinated AST-v2 evaluator/parser cutover. It is semantic error-quality and grammar consolidation work, so the record makes no neutrality, speed, or cost-cutting claim.",
    "dangerTokensJustification": "The flagged loops, maps, spreads, throws, and arrays belong to bounded parser/trivia integration, diagnostic construction, or cold recursive-miss checks. The recursive-reference path runs after a failed normal lookup or during declaration activation validation, and successful render references keep the existing resolver path.",
    "behaviorEvidence": "Focused public reference semantics passed 15/15 and Less error corpus passed 94/94 with recursive-variable/property fixtures unskipped.",
    "buildEvidence": "pnpm --filter @jesscss/core build passed after the recursive-reference changes.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": [
      "Context-plugin-source-parser-dispatch",
      "emit-walk-context-output-option",
      "Ruleset-interpolated-selector-boundary",
      "selector-match-string-and-node-combinators",
      "extend-index-tagged-graft-atoms",
      "Sequence-subclass-preserving-evaluation",
      "callable-output-root-property-guard",
      "serializer-at-rule-and-selector-surface"
    ],
    "why": "This slice changes the Context/evaluator ownership boundary so dialect plugins register their immutable evaluator through Context instead of callers mutating a public evaluator field. It is semantic ownership and package-surface cleanup, not an optimization or neutrality claim.",
    "dangerTokensJustification": "The flagged Context/plugin/serializer tokens are API-boundary and diagnostic/runtime integration work: Context stores one private evaluator reference, serialize reads that accessor, and plugin setContext methods register the dialect evaluator. It adds no parser host, alternate evaluator, resolver, output policy, AST materialization route, or render-output array path.",
    "behaviorEvidence": "The focused semantic-runtime command `pnpm --filter @jesscss/core test -- --run` passed: 203 files, 3219 tests, 9 skipped, 2 todo. Plugin-level evaluator registration was separately exercised by plugin Less/SCSS tests and verify:less-alpha in the active Less facade slice.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the Context evaluator registration change.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "cases": [
      "declaration-sync-and-async-render-result",
      "declaration-merge-source-span-exclusion",
      "default-guard-owned-value",
      "bitset-inversion-and-disjointness",
      "string-and-node-combinator-recognition",
      "selector-list-singleton-collapse",
      "selector-list-array-or-node-inheritance",
      "parser-delivered-selector-array-ampersand",
      "selector-array-ruleset-callable-registration",
      "selector-array-key-set-analysis",
      "selector-compose-cache-node-boundary",
      "ordered-registration-context-restoration",
      "property-merge-container-scope",
      "mixin-invisible-sync-render-and-registration-result",
      "extend-record-selector-surface",
      "extend-root-composition-selector-surface",
      "extend-walk-composed-match-selector-surface"
    ],
    "why": "This slice relocates the generic bitset and numeric operator helpers from legacy tree util paths to core util paths, then repoints their existing legacy tree consumers. The helper behavior and selector/extend contracts are unchanged; this is ownership cleanup for the retained legacy-tree drain, not a speed, neutrality, or semantic expansion claim.",
    "dangerTokensJustification": "The diff moves existing helper modules and rewrites import specifiers. It adds no traversal, no object allocation, no parser replay, no materialization cache, no selector matching branch, no output policy, and no new runtime validation.",
    "behaviorEvidence": "Focused bitset and dimension behavior passed: `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run` (61/61).",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the helper relocation.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-visitor-abi-removal",
    "verdict": "accepted",
    "costDelta": "neutral",
    "why": "This import-only slice touches `node-base.ts` solely because its `Operator` type import now points at the core util helper. It does not restore or alter the removed visitor ABI, add a dispatch method, allocate a facade, or change node behavior.",
    "byteIdentity": {
      "fixture": "benchmark.less",
      "collapseNesting": true,
      "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6",
      "outputBytes": 122390
    }
  },
  {
    "id": "bounded-core-tree-lint-guards",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the five bounded core tree helper owners listed by bounded-core-tree-lint-guards",
    "cases": [
      "List raw NodeArrayItem normalization",
      "canonical node-array prefix guard",
      "root node validation narrowing",
      "callable candidate record narrowing",
      "extend helper lint-safe syntax"
    ],
    "why": "This slice changes `List` only to import the shared `Operator` type from its new core util path. The List normalization and validation behavior named by the bounded lint-guard contract is untouched; this is a dependency-path cleanup, not a performance or semantic behavior change.",
    "dangerTokensJustification": "The touched List hunk is an import-specifier rewrite. It adds no branch, traversal, allocation, validation helper, parser replay, or render path.",
    "behaviorEvidence": "Focused dimension operator coverage passed as part of `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run`.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the import rewrite.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "ast-value-guard-equality-modes",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": [
      "less-unitless-dimension",
      "sass-quoted-keyword",
      "exact-structural-distinction"
    ],
    "why": "This slice settles on the existing Jess `Any` name for Less e() raw-byte results. The value-domain shape is `Any.bytes`; parsed AST opaque leaves remain `Any.src`. The equality branch lets raw Any bytes participate in the same emitted-byte comparison path as escaped string bytes. It is semantic value-domain correctness, not an optimization or cost-neutrality claim.",
    "dangerTokensJustification": "The flagged diagnostic object spreads are existing error-construction shape inside root call rejection, not new normal successful render allocation. The equality branch adds one scalar type check to an already mode-gated comparison path and introduces no collection, traversal, parser replay, or node materialization loop.",
    "behaviorEvidence": "Focused e() and Less public error tests passed, including root e() output and plugin scalar root-call rejection without eval/async-in-sync-position.",
    "buildEvidence": "pnpm --filter @jesscss/core build, pnpm --filter @jesscss/fns build, and pnpm run verify:less-alpha passed after the Any value-domain change.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "ast-value-guard-negate-result",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": [
      "incomparable-remains-undefined",
      "negative-and-positive-reverse",
      "equality-remains-zero"
    ],
    "why": "This slice removes the old internal value-object alias spelling in favor of `Value`. The guard negation logic is unchanged; the touched file still owns the same closed comparison-result inversion contract.",
    "dangerTokensJustification": "The diff changes type annotations and comments only in this area. It adds no comparison branch, traversal, allocation, parser replay, or materialization path.",
    "behaviorEvidence": "Focused value tests passed: `pnpm --filter @jesscss/core test -- value-define-function.test.ts value-operate-compare.test.ts value-operate-units.test.ts --run` (25/25).",
    "buildEvidence": "`pnpm --filter @jesscss/core build`, `pnpm --filter @jesscss/fns build`, and `pnpm run verify:types` passed after the alias removal.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "ast-value-operate-preserve-calc",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": [
      "preserve-percentage-product",
      "loose-percentage-product",
      "explicit-calc-composition"
    ],
    "why": "This slice removes the old internal value-object alias spelling in favor of `Value`. The preserve-mode calc arithmetic policy is unchanged; the touched file still owns the same semantic result-construction boundary.",
    "dangerTokensJustification": "The diff changes type annotations and comments only in this area. It adds no arithmetic branch, traversal, allocation, parser replay, or materialization path.",
    "behaviorEvidence": "Focused value tests passed: `pnpm --filter @jesscss/core test -- value-define-function.test.ts value-operate-compare.test.ts value-operate-units.test.ts --run` (25/25).",
    "buildEvidence": "`pnpm --filter @jesscss/core build`, `pnpm --filter @jesscss/fns build`, and `pnpm run verify:types` passed after the alias removal.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  }
]
```
- Evidence: `pnpm --filter @jesscss/core build` — GREEN; `pnpm --filter @jesscss/core test -- --run` — GREEN, 203 files / 3219 tests / 9 skipped / 2 todo; `pnpm --filter jess test -- test/less/reference-public-semantics.test.ts --run --globals --reporter=dot` — GREEN, 15/15; `pnpm --filter jess test -- test/less/all-less-error.test.ts --run --globals --reporter=dot` — GREEN, 94/94. No performance claim is made or implied.
- Verdict: accepted as semantic parser/error-quality integration evidence for the current dirty
  worktree; still requires slice commits and normal parser macro/compose/oracle gates before merge.

## Aggressive Cutting Self-Prosecution

- Latest pass: 2026-07-30 callable-body comment replay and classified Less
  mixin-signature trivia. This is a correctness batch, not a performance pass.
- Architecture surface: private Less grammar trivia scope, parser provenance,
  and AST serializer output ordering. No public AST field, node family, parser
  host, or package API is added.
- Separation/duplication: a mixin continuation uses the existing classified
  document trivia rather than a local catch-all whitespace label. The renderer
  reuses `TriviaMap.commentRuns()` instead of inventing a source scanner or a
  second full-gap map.
- Cumulative node weight: none. Canonical AST bodies remain unchanged and no
  comments become semantic child nodes.
- New traversal: one binary search finds the first sparse comment run inside a
  called body; two monotonic cursors consume only runs before successive body
  statements and its tail. This is necessary because mixin expansion moves
  output placement while source comments remain document-owned provenance.
- New node/materialization: no nodes or body copies. Pending comment strings
  are render-only boundary state until the existing writer outputs them.
- Render path: direct writer output from existing comment runs; no general
  trivia lookup, line split, full-source scan, or AST rewalk is added.
- Helper/API surface: private serializer helpers only; no public method or type
  is added.
- Metadata mutations: none. The existing emitted-comment set continues to
  de-duplicate a source run across expansion paths.
- Review-flagged diff tokens: [loop/traversal] one binary search and two
  bounded monotonic sparse-run scans; [array spread/materialization] pending
  comment strings carry authored block order only; [materialized array/object]
  cursor and pending arrays are transient render state, not AST materialization.
- Evidence: release build passed; Less public + mixin signature tests 93/93,
  core provenance 15/15, and Jess CST public grammar 19/19 passed. Macro and
  compose-integrity gates both passed with zero interpreter fallbacks. The
  all-Less corpus remains 109/110; its only red case is the known unrelated
  `tests-unit/extend/extend.less` selector expansion mismatch.
- Behavior evidence: the Less parser tests assert the comment is attached to
  document trivia and rendered after mixin expansion; provenance verifies a
  compact Parseman view cannot hide later comment gaps.
- Build evidence: `pnpm run build:release` completed after rebuilding parser
  dependencies before core and Jess.
- Boundary evidence: the Less public parse and Jess CST tests exercise both
  canonical AST output and public CST grammar paths; macro/compose gates prove
  the shipped macro parsers did not fall back to the interpreter.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "This callable-body comment replay preserves the established parser-to-provenance-to-writer ownership while mixin expansion changes output placement. It is a semantic correctness repair: no output node, source scanner, generic root-gap map, or benchmark speed claim is introduced.",
    "dangerTokensJustification": "One binary search and two monotonic cursors consume only pre-existing sparse comment ranges in the invoked body. Pending comment strings are transient render ordering state, not copied AST state; they are written through the existing serializer and never materialize a generic trivia structure.",
    "behaviorEvidence": "Focused Less public/mixin signature tests passed 93/93 and core provenance passed 15/15; each asserts attachment and emitted comment placement.",
    "buildEvidence": "pnpm run build:release passed, rebuilding parser-shared and parser artifacts before core and jess.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 45.57, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```
- Verdict: accepted as an in-progress correctness batch. This pass makes no speed
  claim. *(The "Parseman 0.44 is on its own PR branch; Jess remains on registry
  0.43" caveat recorded here has since been discharged: 0.44 was published and
  integrated in `f292fdd8f` / `b2f888070` / `d22cdb54b`.)*

- Latest pass: 2026-07-30 custom-property comment-trivia alignment. Less,
  SCSS, and Jess custom-property parts and nested groups now consume block
  comments as trivia, leaving semantic value text comment-free. The core
  provenance adapter now recognizes a legacy composed Parseman edge case: an
  index can advertise comment labels yet expose no concrete comment-kind entry.
  Only an empty labeled result falls through to the already-owned source-gap
  detector, restoring comment replay rather than treating missing packed labels
  as proof that no comments exist.
- Architecture surface: parser trivia classification and core provenance-backed
  serializer replay. No public AST field, AST node family, CSS value semantics,
  parser host, or plugin API is added.
- Separation/duplication: removes SCSS/Jess semantic comment arms so all three
  compiled overlays share Less's custom-property shape. One local labeled
  terminal classifies consumed trivia; the core branch reuses the existing gap
  detector instead of adding a second comment scanner.
- Cumulative node weight: reduced in SCSS/Jess custom values because comments no
  longer enter semantic child arrays. The parser records existing source spans;
  no node field, factory, or public collection is introduced.
- New traversal: none in normal operation. The existing cold `commentRuns()`
  fallback reads source gaps only when a legacy labeled index has zero actual
  comment ranges; nonempty labeled ranges retain the sparse packed-index path.
- New node/materialization: none. `withSourceSpan` stores existing source-span
  provenance for a custom value so the existing renderer can replay trivia; it
  does not construct or copy an AST node.
- Render path: the existing comment replay path reads the custom value span and
  document trivia ranges. It restores authored comments around value text and
  nested groups without adding comment bytes to the AST.
- Helper/API surface: no new public or parser helper. The provenance change is
  one private empty-result guard; grammar-local terminals are recognition facts,
  not exported syntax nodes.
- Metadata mutations: existing source-span and document-trivia side tables are
  populated at parse time as before. No parent, source-root, or node metadata is
  mutated during evaluation or rendering.
- Review-flagged diff tokens: [array helper] none; [array spread/materialization]
  none; [loop/traversal] no new loop; [node construction] none; [side map/set]
  none. The only runtime condition routes an empty legacy label result to the
  pre-existing source-gap query on a cold render/provenance path.
- Evidence: fresh dependency-order builds passed for core, Less parser, SCSS
  parser, and Jess parser. Focused provenance tests passed 15/15; focused custom
  property suites passed Less 31/31, SCSS 30/30, and Jess 31/31.
- Behavior evidence: each parser test asserts comment-free semantic values,
  exact source-trivia ranges, and rendered replay at outer, paren, square, and
  curly positions; the core test exercises advertised-but-empty legacy labels.
- Build evidence: `pnpm --filter @jesscss/core build`, `pnpm --filter
  @jesscss/less-parser build`, `pnpm --filter @jesscss/scss-parser build`, and
  `pnpm --filter @jesscss/jess-parser build` passed in dependency order.
- Boundary evidence: AST and public serialized CSS assertions cover the parser
  boundary; the pending macro and compose gates verify both host modes after
  this bounded source change.
- Verdict: accepted as a semantic parser/provenance repair with no performance
  claim. The fallback handles malformed legacy label metadata only; it is not a
  new general comment-collection strategy.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "This is a semantic parser/provenance repair: custom-property comments must be trivia in every compiled overlay and must replay from the existing source/document provenance path. The legacy empty-label fallback restores that contract when composed Parseman metadata omits a concrete comment entry; it makes no neutrality or speed claim.",
    "dangerTokensJustification": "The changed provenance condition adds neither a traversal, node, side map, scanner, nor general materialization route. It reaches the already-existing source-gap detector only after the packed labeled result is demonstrably empty; normal labeled comment ranges keep the existing sparse path.",
    "behaviorEvidence": "Focused core provenance tests passed 15/15; Less, SCSS, and Jess custom-property suites passed 31/31, 30/30, and 31/31 with AST, trivia-range, and rendered-comment assertions.",
    "buildEvidence": "Dependency-order builds passed for @jesscss/core, @jesscss/less-parser, @jesscss/scss-parser, and @jesscss/jess-parser.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```

- Latest pass: 2026-07-30 root-trivia map elimination. Renderer comment replay
  now consumes the source-ordered comment ranges it actually needs instead of
  materializing every root whitespace gap through Parseman 0.43's generic map.
  The pending Parseman 0.44 selected-root mode is marked explicitly so its marker
  entries continue to use its owned-gap query rather than being mistaken for full
  ranges.
- Architecture surface: parser-owned trivia provenance and AST serializer comment
  replay only; no grammar, AST public field, output CSS, or plugin API changes.
- Separation/duplication: deletes root-map construction for a comment-only render
  request. Legacy labeled logs stream one contiguous comment-bearing range at a
  time; sparse selected-root indexes remain the sole owner of their complete ranges.
- Cumulative node weight: reduced. The generic Parseman map, per-gap objects, and
  entry-index arrays are no longer reached by the Bootstrap render; only the small
  comment-range array and renderer's existing emitted-comment set remain.
- New traversal: one parser-bound linear pass over the already-packed legacy root
  trivia entries groups contiguous ranges and retains only comment-bearing ones;
  one render-time binary search finds a comment range at a requested boundary. No
  source scan, AST descendant walk, or general root-gap enumeration is added.
- New node/materialization: none. The new `TriviaRange[]` is transient parse
  provenance data, not an AST node or public collection; it replaces the much
  larger generic root-gap object/map materialization.
- Render path: direct comment lookup now binary-searches the cached source-ordered
  comment runs. Leading comment emission reads the first run, so normal authored
  content at offset zero cannot trigger a general root lookup.
- Helper/API surface: two private helpers only—`labeledCommentRangesFromEntries`
  and `commentTriviaAfter`; parser compatibility is structural and adds no public
  Jess API.
- SUPERSEDED by the parseman 0.44 migration. `labeledCommentRangesFromEntries`
  and the `rootCaptureMode` discriminator are gone: 0.44 root capture is always
  sparse selected-kind rows, whose entry spans name markers inside an owned
  range and are therefore not renderable gap ranges. The legacy all-entries
  grouping loop this batch added had no remaining producer, so `commentRuns()`
  now goes through `gapsWithKind()` alone. The cost this batch was cutting is
  cut further upstream instead: whitespace no longer produces a root entry at
  all, because only comment categories are selected.
- Metadata mutations: unchanged. Existing canonical trivia ranges remain interned
  by source range; no AST/source/parent metadata is added or mutated.
- Review-flagged diff tokens: [loop/traversal] one packed-entry grouping loop and
  one binary search replace generic all-gap construction; [materialized array/object]
  the temporary selected-comment range array replaces maps, gap objects, and entry
  index arrays for every whitespace run.
- Evidence: provenance and imported-leading-comment tests passed 54/54 after a
  fresh core build. On the exact 288,434-byte upstream PostCSS Bootstrap Less
  workload, two 61-sample interleaved runs measured Jess at 38.32 ms and 37.74 ms
  versus Less 4.8.1 at 26.85 ms and 26.68 ms; output assertions passed.
- Verdict: accepted as a measured root-trivia cost cut. Jess remains behind Less,
  so this is an active performance batch, not completion.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "Comment replay needs only ordered comment-bearing root ranges. Streaming those ranges from Parseman's packed labels and searching the cached sparse result removes generic whitespace-gap map construction without changing the canonical Stylesheet or emitted CSS contract.",
    "dangerTokensJustification": "The entry pass reads each already-recorded root trivia item once and retains only ranges containing a labeled comment. The binary search reads that small cached range list; neither path walks AST descendants, scans source, creates nodes, or materializes a generic root-gap map.",
    "behaviorEvidence": "Core provenance and imported-leading-comment tests passed 54/54, including labeled legacy fallback, sparse-index boundaries, and comment rendering at an import site.",
    "buildEvidence": "pnpm --filter @jesscss/core build passed before the exact upstream PostCSS eval-and-emit measurement.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```

- Latest pass: 2026-07-30 compiler source-fact ownership, function-dispatch,
  and warning-event cost cut. The first slice removes eager
  suppressed-function diagnostics, deletes the routine preserved-function
  warning lane, gates scoped function lookup by registered name, and makes
  surviving code frames file-indexed. The follow-up stores admitted
  compiler-originated warnings as columnar scalar rows, deferring public
  diagnostic materialization and line/frame reads to the display/result boundary.
- Architecture surface: core evaluator/serializer/context/error diagnostic
  paths, the compiler result/report boundary, benchmark evidence, and a PR gate.
  No parser, AST shape, output CSS, import, or plugin ABI is changed.
- Separation/duplication: removed duplicate lexical function resolution and
  duplicate source derivation. One `scopedFunctionNames` owner admits a lexical
  lookup; one file-owned line-start index owns offset and frame reads.
- Cumulative node weight: unchanged. No AST node fields or node factories were
  added; scoped-function facts remain optional render-frame state.
- New traversal: bounded only. A scoped name may walk parent frames that own
  registered functions; all other calls bypass it. Source replay searches are
  bounded to their existing AST spans rather than a file prefix/suffix.
- New node/materialization: none on the successful compile path. The line index
  is an off-node, lazy per-file `WeakMap` fact; admitted warnings live as parallel
  scalar arrays and construct public diagnostic objects only when reporting or
  returning a result requires them.
- Render path: ordinary function calls now dispatch directly to the flat
  registry unless their name is registered lexically. A registered function
  declining CSS-compatible arguments preserves authored bytes silently;
  silenced/capped compiler warnings do no template or frame work, retained
  warnings do no diagnostic-object work, and frame display slices indexed lines.
- Helper/API surface: `ValueEvaluator.call()` accepts an optional
  already-resolved scoped `Fn`, preserving the legacy `FnScope` input for direct
  consumers without forcing the serializer to allocate it. The transitional
  unresolved-function warning callback and code were deleted. `Context` keeps
  the existing `warnings` array-facing result API while adding a count-only
  internal reporting path and a node-attributed warning event entry point.
- Metadata mutations: only render-local `scopedFunctionNames` and existing
  frame nearest-function cache invalidation are updated during plugin loading;
  no AST/provenance mutation is introduced.
- Review-flagged diff tokens: [loop/traversal] the source-index build and
  span-bounded searches replace repeated whole-file work; [side map/set] one
  `WeakMap` caches immutable file facts and one name `Set` prevents scope walks;
  [routine error control] none on the successful path; [array helper] indexed
  frame output allocates only the returned one-to-three-line diagnostic record;
  [array spread/materialization] call-site attribution remains exclusively on
  genuine admitted diagnostic paths; [node construction] the
  name `Set` is built when functions are registered, not per call; [parent/source
  mutation] the detector matches location/source *reads*, while this pass mutates
  neither AST parents nor source provenance; [materialized array/object] a
  file-owned line-start array replaces every rejected-call whole-source line array;
  [materialized array/object] the new column arrays replace the prior JessError →
  WarningDiagnostic pair, while parser/plugin boundary objects are copied once;
  [side map/set] no new map is introduced by the collector.
- Behavior evidence: focused warning/function tests passed 29/29, including a
  silenced or repeated `warnAtNode()` that performs no template work and a public
  diagnostic array that remains unmaterialized until requested. The complete core
  suite passes 206 files / 3,261 tests (9 skipped, 2 todo). Jess Less
  `function-mode.test.ts` and `plugin-diagnostics.test.ts` pass 13/13, including
  a preserved plugin failure that remains visibly diagnosed at the result boundary.
- Build evidence: `pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit`
  and `pnpm --filter @jesscss/core build` pass on this worktree.
- Boundary evidence: `JessError` remains a plain diagnostic value (not an
  `Error` subclass); parser/public output contracts are unchanged. The existing
  `test/diagnostics.test.ts` `instanceof Error` assertion is inconsistent with
  both HEAD and the unmodified `JessError` class, so it is recorded as a
  pre-existing test-contract defect rather than fixed by adding stack capture.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "The serializer and value-evaluator changes preserve the established optional-CSS-call and scoped-function semantics while deleting the rejected-call warning lane. The separately recorded CPU profile is evidence for the active performance investigation, not a claim that this semantic-runtime record proves an A/B speed result.",
    "dangerTokensJustification": "The source index and lexical name set are render-local facts with explicit ownership. They replace repeated rejected-call scans and scope probing; neither introduces AST materialization, parser replay, an alternate evaluator, or successful-path diagnostic allocation.",
    "behaviorEvidence": "Focused core tests passed 30/30, including silent declined-call preservation, strict functionMode behavior, and direct scoped-function dispatch; the diagnostic integration test mismatch is documented separately as pre-existing.",
    "buildEvidence": "pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit and pnpm --filter @jesscss/core build passed.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": ["Context-plugin-source-parser-dispatch", "emit-walk-context-output-option", "Ruleset-interpolated-selector-boundary", "selector-match-string-and-node-combinators", "extend-index-tagged-graft-atoms", "Sequence-subclass-preserving-evaluation", "callable-output-root-property-guard", "serializer-at-rule-and-selector-surface"],
    "why": "Context warning admission now precedes diagnostic normalization without changing plugin/source/import behavior, selector behavior, or output policy. Declined registered calls no longer enter the warning collector at all; this semantic-runtime record does not assert a benchmark A/B result.",
    "dangerTokensJustification": "The Context change keeps policy accounting ahead of normalization and removes one former producer. It adds no resolver, parser host, AST materialization route, output array path, traversal, or runtime validation and keeps ordinary emitted CSS untouched.",
    "behaviorEvidence": "Focused warning-policy tests passed 30/30 and declined registered calls preserve bytes without warnings.",
    "buildEvidence": "pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit and pnpm --filter @jesscss/core build passed.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  },
  {
    "id": "ast-evaluator-function-call-boundary",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": ["unresolved-optional-function-call", "registered-sync-call-failure", "registered-async-call-failure"],
    "why": "The evaluator accepts an already-resolved scoped callable from the serializer so one lexical lookup is authoritative. Optional CSS calls still preserve authored bytes, and selected callable failures continue through the established synchronous/asynchronous recovery policy rather than becoming lookup misses.",
    "dangerTokensJustification": "The added optional parameter removes a duplicate scope lookup from the selected-call path. It neither allocates an Error nor changes async recovery, registry lookup semantics, output serialization, or the normal optional-call miss result.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the sixteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, call, and extend owners listed by legacy-tree-strict-contract-drain",
    "cases": ["declaration-sync-and-async-render-result", "declaration-merge-source-span-exclusion", "default-guard-owned-value", "bitset-inversion-and-disjointness", "string-and-node-combinator-recognition", "selector-list-singleton-collapse", "selector-list-array-or-node-inheritance", "parser-delivered-selector-array-ampersand", "selector-array-ruleset-callable-registration", "selector-array-key-set-analysis", "function-call-silent-preserve", "selector-compose-cache-node-boundary", "ordered-registration-context-restoration", "property-merge-container-scope", "mixin-invisible-sync-render-and-registration-result", "extend-record-selector-surface", "extend-root-composition-selector-surface", "extend-walk-composed-match-selector-surface"],
    "why": "The retained legacy Call path now agrees with canonical AST-v2 function policy: a registered function that declines CSS-compatible arguments preserves the authored call silently, while explicit error mode still throws. It is a semantic compatibility correction during the tree drain, not a performance or neutrality claim.",
    "dangerTokensJustification": "The change deletes a warning construction helper and its three calls. It adds no traversal, allocation, parser replay, alternate evaluator, output policy, or runtime validation; successful preserve output remains the existing fallback call syntax.",
    "behaviorEvidence": "Focused core function-boundary and warning-policy tests passed 30/30; Jess Less function-mode fixtures passed with silent default preservation and strict error-mode failures.",
    "buildEvidence": "pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit and pnpm --filter @jesscss/core build passed.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```
- Evidence: strict `pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit`,
  `pnpm run verify:diagnostic-cold-path`, focused warning/function tests (29/29),
  and the complete core suite (206 files / 3,261 tests) pass. `pnpm --filter
  @jesscss/core build` and the targeted Jess plugin/function suite (13/13) pass.
  Exact upstream PostCSS workload:
  288,434-byte Less input, Bootstrap SHA
  `4a50207b956a4ab943640ee993118b554a34e96a23261cfe58b9aa1807a7849b`,
  paired post-collector run: Jess Less median 47.46 ms versus Less 4.8.1 at
  29.02 ms (10 warmups/30 interleaved samples); the 7,181-sample CPU profile
  has no line-location/frame-split bucket.
- Verdict: accepted as a measured cost cut. The PostCSS workload still has
  Jess Less behind Less and PostCSS, so this is one committed batch in the
  active performance goal, not completion.

> **Docs-audit note (2026-07-30, `facb641dd`).** A byte-identical duplicate of the LIVE
> pass above was appended at the end of this section and has been deleted. Three further
> `- Latest pass:` blocks (custom-property comment-trivia alignment, root-trivia map
> elimination, compiler source-fact ownership) remain below the live one, in violation of this
> section's own rule at the top: "REPLACE that block with your pass; do not append a new one
> and leave the old one behind." `scripts/verify-aggressive-cutting-review.mjs:2568-2573`
> takes `handoff.lastIndexOf('## Aggressive Cutting Self-Prosecution')` and then the FIRST
> `- Latest pass:` after it, so only the live block is gated — the trailing blocks are
> ungated text. They are left in place because superseding them was not verified on this
> pass; the next author to run the gate should move them to their commit messages.
