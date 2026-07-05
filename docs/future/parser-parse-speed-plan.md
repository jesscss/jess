# Parser parse-speed plan (closing the gap to Less 4.x)

## Goal
Our compiled parser produces a **full CST** (per-node source spans + trivia map)
that Less.js 4.x's lean AST does not. On a clean file both parse without error
(`bootstrap4.css`, 152 KB, 0 errors):

| Parser | median parse |
|---|---|
| Less.js 4.2.0 | ~6.9 ms |
| ours (compiled) | ~52 ms (**~7.4×**) |

The gap is inherent CST-construction cost, not a bug (two real bugs — a
`& when not` parse gap and an O(n²) comment-line lookup — were found and fixed
separately; neither affects this clean number). css-parser alone does the same
file in ~23 ms (~3.3×), so ~half the gap is CSS-superset grammar breadth and
~half is the extra Less node machinery.

## Audit (profile of the clean 52 ms parse, compiled less-parser)

Cost buckets (% self-time):

| bucket | % | what |
|---|---|---|
| compiled combinators (`_pf*`) | 59.7% | parsing — **dominated by per-`node()` CST-capture bookkeeping** |
| core node constructors | 17.2% | AST allocation (`Node` ctor alone 11%) |
| Jess builders (`_build*`) | 7.5% | dispatch switch, `spannedComponents`, span-packing |
| trivia + terminal regex | 5.9% | |
| GC | 4.3% | driven by per-node array allocation |

Each `node()` invocation (parseman `emitNode`) allocates **3 fresh arrays**
(`_ch`, `_raw`, `_tl`) + saves/restores 5 `_ctx` fields — thousands of times.

### Frame census (bootstrap4.css): 28,045 node() frames

| node type | frames | note |
|---|---|---|
| CompoundSelector | 6,404 | 76% collapse to a single token |
| LessComplexSelector | 5,986 | mostly single compound → collapse |
| LessSelectorList | 5,087 | mostly single selector → collapse (also used by pseudo-args) |
| **selector wrappers** | **17,477** | **= 62% of ALL node frames** |
| Declaration | 3,107 | |
| Num / Dimension / Color / PseudoSelector / … | ~7,461 | |

A plain `.btn { }` spins **3 collapsing selector frames** (List→Complex→Compound)
to produce the string `.btn`; ~5,000 such rulesets. **62% of node() bookkeeping
is collapsing selector wrappers.**

## Plan (ranked by payoff ÷ risk)

### P1 — Collapse the selector node() levels  ← TOP PRIORITY
Attack the 17,477 frames: fold `List → Complex → Compound` into **fewer** node()
frames (ideally one node() per selector-list whose builder assembles the nested
structure in a single pass). The assembly logic already exists across the three
builders (`_buildSelectorList` / `_buildComplexSelector` / `_buildCompoundSelector`);
this is a refactor into one nested pass, not new logic.
- Expected: cut ~11–12k frames (62% → ~20% selector overhead).
- Risk: HIGH — selectors are heavily tested and reused (pseudo-args, extend,
  ampersand, interpolation, spans). Do incrementally, run the selector suites
  after each step.
- Location: `packages/css-parser/src/{grammar,builders}.ts` +
  `packages/less-parser/src/{grammar,builders}.ts`.

### P2 — Pool the per-node() capture arrays  (parseman, IN FLIGHT via sub-agent)
Replace `const _ch=[], _raw=[], _tl=[]` per node with a shared arena / free-list
(reuse array objects, keep the `_build` call convention). Kills most of the
3-arrays-per-node allocation → cuts GC + allocation across *every* frame.
- Overlaps P1: P2 makes each frame cheap, P1 makes fewer frames — they compound.
- Location: `~/git/oss/parser-thing` `src/compiler/codegen.ts` `emitNode()`.
- Guardrail: parseman 654/654 + perf-guard green; measure downstream on css/less.

### P3 — Lighten / monomorphize the core `Node` constructor (17%)
`Node` ctor is 11% alone. Ensure monomorphic option shapes; defer non-essential
setup. CORE territory (`@jesscss/core`) — profile-guided, hand off.

### P4 — Lazy field/value spans  (LOW ROI — deferred)
`setFieldSpan`/`setValueSpans` pack per node but are only read by diagnostics /
source-maps / language-service. Compute on demand from `location` + source.
Ceiling is inside the 7.5% builder bucket — small; defer unless P1–P3 fall short.

### P5 — Direct build dispatch / avoid `spannedComponents` intermediates
Bind build fns directly instead of the `_dispatchBuild` string switch; iterate
rawChildren in place instead of materializing `Spanned[]` per node.

## Sequencing
P2 (pooling) is delegated and in flight; P1 (selectors) is independent (different
repo) and is the biggest single lever, so start it now. Measure P1 and P2 effects
against the ~52 ms / ~7.4× baseline as each lands; re-profile before P3/P4/P5.

## Status / findings (updated)

- **P2 (array pooling): DEAD END.** V8 allocates tiny empty arrays in young-space
  essentially for free; a free-list adds branch + pop/push + old-space promotion
  and *regressed* (css/selector −20%). Reverted. → allocation is not the cost.
- **P1 (reduce selector frames): DONE, but proved frames aren't the bottleneck.**
  Shipped as a parseman feature instead of a grammar rewrite: `node(...,
  { collapse: true })` returns the single child and skips build (parser-thing
  `8a60b8e`). Annotated `CompoundSelector` / `LessComplexSelector` /
  `LessSelectorList`. Result: node() build frames **28,045 → 13,503 (−52%)**,
  byte-identical output — but parse time only **~52 → ~51 ms**. So the per-frame
  build/bookkeeping is cheap; halving it barely moved the needle.

**Revised conclusion (superseded — see below).** Pooling + collapse both no-op'd,
which *looked* like proof the gap is inherent combinator cost. That was the wrong
generalization: those two experiments moved *array allocation* and *frame count*,
neither of which is the cost. They never isolated the **per-terminal trivia
push**, which turned out to be a big, cheap-to-remove chunk.

### P7 — Elide dead per-node CST-trivia capture  ← VALIDATED 16% WIN
Every `node()` frame threads `_ctx._cstTriviaLog` (a fresh `_tl` array) and every
whitespace/comment terminal does `if (_ctx._cstTriviaLog !== undefined) push(...)`.
That per-node trivia log is passed to the build as its **4th arg** — but **every
jess build is arity-3** (`(c, r, s) => mk(type, c, r, s)`) and never reads it.
Pure dead work, fired on every trivia token in a 152 KB file.

- **Ablation (built less lib, bootstrap4.css): 52.6 → 44.7 ms = 16% faster,
  AST structurally identical** (signature 8278038 == 8278038), public `trivia`
  map unaffected (it is fed by the independent global `_triviaLog`, not the
  per-node `_cstTriviaLog`).
- **Fix (parseman codegen, in flight via sub-agent):** arity-gate the per-node
  capture. When a build declares ≤3 params (can't read triviaLog), don't allocate
  `_tl`, set `_ctx._cstTriviaLog = undefined` for that scope, pass a shared frozen
  empty array. Automatic, no grammar change; CST-consuming grammars (arity-4 `mk`
  stub) keep capturing. Same treatment for the arity-5 `state` clone. Parity across
  interpreter / compiler / macro; conservative fallback (rest/destructure/unknown
  → keep capture).
- This finally answers "when do we NOT need a lean mode?" — leanness is automatic,
  per-node, driven by what the build consumes.

Post-P7 re-profile pending. Remaining real levers below.

### Remaining levers (harder, re-profile-driven)
- **P6 — per-token parse work.** The selector run does two `not(...)` regex
  lookaheads (`whenAhead`, `extendAhead`) at *every* simple/compound iteration —
  thousands of redundant regex execs for CSS with no `when`/`extend`. Cheaper
  boundary checks (single combined lookahead, or a char-peek gate) could help.
- **P3 — core `Node` constructor** (13.3% self-time in the parse profile). ✅ DONE.
  The base ctor ran `Object.defineProperties(this, {sourceNode, parent})` **per
  instance** to keep those fields non-enumerable. Replaced with **private-field
  backing + prototype getters** (`#sourceNode`/`#parent`): still invisible to
  JSON / `Object.keys` / structural `toEqual` (private fields aren't reflectable),
  but construction is **37.7× faster** and hot `.parent` reads cost **1.04×**
  (getter fully inlined). Plain enumerable assignment was rejected — it would drag
  `parent`/`sourceNode` into the many core tests that `toEqual`/snapshot nodes.
  Full core suite: **identical failure set** (106 pre-existing, diff empty) — zero
  regressions. `packages/core/src/tree/node-base.ts`.
- **"We have a codegen — compile to hand-tuning."** The remaining parse cost
  (combinators) is per-token function-call + regex-exec count. The genuine lever
  is combinator fusion in the compiler (emit fewer, coarser matches like a
  hand-written parser), NOT accepting the gap as inherent. P7 is the first proof
  the compiled output was doing removable work.

### Kept regardless
`collapse` is a good feature (byte-identical, −52% frames = less GC/work, cleaner
grammar, reusable across parseman grammars and expression ladders) even though
its *speed* win here was small.
