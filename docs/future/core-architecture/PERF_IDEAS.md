# AST v5 render — PERF IDEAS (measured, ideas-only)

Ranked candidate optimizations for the `ast/` v5 whole-document render of
`packages/jess/benchmark/benchmark.less`. **Nothing here is implemented.** Every
item carries measured evidence, a predicted win, and a break-even/byte-safety
argument. The **~50 ms median is the floor to beat — never regress it.**

## How this was measured

- Driver: `renderAstFile`/`renderAstDoc` (the test-space whole-doc AST-v2 path:
  `parseToAst` → `resolveDirectImports` → `serialize`), same worktree, warmup 20,
  N=60 median for phase timing; a V8 sampling CPU profile (50 µs interval, 200
  iterations after 30-iteration warmup) for self-time attribution.
- Fixture: real `benchmark.less` (4446 lines), CSS output 131,713 bytes.
- Total median: **51.9 ms** — consistent with the owner's ~50 ms baseline, so the
  breakdown below is representative of the real render.

### Measurement caveats (read before acting on any parser lever)

- The harness runs under **vitest/vite source transform**: both `@jesscss/core`
  and `@jesscss/less-parser` execute from **`src/*.ts`**, not their built `lib/`.
  The production render (jess-plugin-less) uses the bundled `lib/`. Absolute
  parser numbers can shift against the built bundle; **re-confirm any parser lever
  against `lib/functional-parser.js` before committing to it.** The *relative*
  hotspot ranking (below) is stable.
- Self-time line numbers from V8 under esbuild transform are unreliable; **file
  and function-name attribution are trustworthy**, line offsets are not.

## Measured phase breakdown (N=60 median)

| Phase | Median | Share |
|-------|--------|-------|
| parse + build (`parseToAst`) | 33.65 ms | **64.8%** |
| import resolve (`resolveDirectImports`) | 0.34 ms | 0.7% |
| serialize (`serialize`) | 18.13 ms | **34.9%** |
| **total** | **51.9 ms** | 100% |

### Self-time by file — PARSE-ONLY profile

| File | % of parse self-time |
|------|----------------------|
| `less-parser/src/grammar.ts` | **80.8%** |
| (native / GC / vm) | 4.9% |
| `ast/parse-host/actions/custom-props.ts` | 2.6% |
| `ast/parse-host/dispatch-host.ts` | 2.2% |
| `ast/nodes.ts` | 1.1% |
| `ast/parse-host/actions/value-leaf.ts` | 1.1% |

→ parser grammar ≈ 0.808 × 33.65 = **~27 ms (~52% of the whole render)**.

### Self-time by file — SERIALIZE-ONLY profile

| File | % of serialize self-time |
|------|--------------------------|
| `ast/extend/ir.ts` | 23.1% |
| `ast/extend/emit.ts` | 16.8% |
| `ast/serialize.ts` (serializer proper) | 16.0% |
| `ast/extend/match.ts` | 14.7% |
| `ast/extend/solve.ts` | 11.6% |
| (native / GC) | 5.8% |
| `ast/extend/compose.ts` | 3.1% |
| `ast/extend/plan.ts` | 2.2% |
| `ast/mixin-dispatch.ts` | 1.6% |
| `ast/value-operate.ts` | 1.4% |

→ **The extend engine is ~71.5% of serialize self-time** (`ir + emit + match +
solve + compose + plan`). That is **≈ 0.715 × 18.13 = ~13 ms = ~25% of the entire
render** — spent on **26 `:extend()` instructions** in the fixture. The
serializer proper is only ~3 ms; value-eval/mixin ~1 ms.

### Top self-time functions (full-pipeline profile)

```
 5.7%  _r_topSum            grammar.ts    (value additive precedence climb)
 5.2%  _r_topProduct        grammar.ts    (value multiplicative precedence climb)
 3.6%  _r_ComplexSelector   grammar.ts
 3.4%  branchText           extend/ir.ts  (selector-branch → string)
 3.3%  _fd..._tf0           grammar.ts    (trivia frame)
 3.0%  (garbage collector)
 2.7%  rewriteBranchPartial extend/match.ts
 2.5%  _r_value             grammar.ts
 2.3%  _r_CompoundSelector  grammar.ts
 2.3%  _r_SelectorList      grammar.ts
 2.2%  _r_Declaration       grammar.ts
 1.9%  _r_InterpolatedSelector grammar.ts
 1.8%  computeExtends       extend/emit.ts
 1.8%  applyInstruction     extend/match.ts
 1.7%  _r_PseudoSelector / _r_Ruleset  grammar.ts
 1.5%  runFixpoint          extend/solve.ts
 1.4%  multisetSubset       extend/ir.ts
 1.3%  ownFlatten           extend/emit.ts
 1.0%  listKey / simpleText extend/{solve,ir}.ts
```

---

## Ranked ideas (highest predicted-win-per-effort first)

### 1. Extend: prune whole-document per-subject work to the affected rules only  — HIGH win / MEDIUM effort

**Hot spot:** `extend/emit.ts::computeExtends` and everything it drives
(`ir.ts`, `match.ts`, `solve.ts`, `compose.ts`) — **~13 ms, ~25% of the render**,
for only 26 extends.

**Why it's hot (root cause, verified in source):** `collectPlan` (`plan.ts:46`)
records **every `Rule` in the document** as a `PlanSubject` (thousands in this
fixture). `computeExtends` then runs several full passes *over all subjects*:
- loop @`emit.ts:231` — `composePath(s.path)` (raw) **and** `solveComposed(s)`
  (which calls `composePath` again for the seed), then serializes **both** branch
  lists with `listKey`/`branchText` purely to detect change (`listKey(flat) !==
  listKey(raw)`);
- the `&&`-collapse pass, the flatten-decision pass (`ownFlatten` →
  `composePath`/`branchText`/`parentHeaderSet` for nested subjects), and the
  per-subject nested-header pass — again over *all* subjects.

The target-atom prefilter (`solve.ts:75`) already proves **~92% of subjects are
untouched** (seed shares no atom with any target). But it only short-circuits the
*fixpoint*; those subjects still pay 2× `composePath` (full Branch-IR allocation)
+ 2× `listKey` full serialization + the flatten machinery.

**Byte-safety (verified):** the serializer consumes the result purely by lookup
with a raw-fallback — `serialize.ts:1026` `flatByRule.get(rule) ?? rawComposed`,
`:1768`/`:1837` `nestedPlan.get(node)?.flatten`, `hoistHeader.get(rule) ?? …`.
**A rule absent from the maps emits its authored/raw form.** So `computeExtends`
only needs entries for rules the extends actually change. Populating maps for
exactly the reachable + atom-sharing subjects (and their flatten-cascade
descendants) is byte-identical to today by construction.

**Proposed change (idea):** gate the per-subject passes on
`reaches(inst, subject) && branchSharesAtom(seed, plan.targetAtoms)`. Compose each
subject's branches **once** and thread that single value through the raw/flat/
flatten passes instead of recomposing. Untouched subjects contribute no map entry.

**Predicted win:** extend is ~13 ms; the ~92% untouched subjects account for the
bulk of `ir.ts` (branchText/clone) + the double `listKey`. Conservatively
**6–10 ms saved → ~42–46 ms total.** Allocation-bound (Branch-IR clones + string
concat), so the GC 3% should also fall.

**Risk to the floor / bytes:** must keep the flatten *cascade* correct — a
flattened parent forces descendants to flatten (`emit.ts:330`), so the prune set
must include cascade descendants even if they don't themselves share an atom.
Gate behind the existing prefilter-soundness differential test (ON==OFF byte
identity) extended to the prune.

### 2. Extend: return a `changed` flag from `solveComposed`, drop the double `listKey`  — MEDIUM win / LOW effort

**Hot spot:** `listKey`/`branchText` (`solve.ts:38`, `ir.ts:52`) — `computeExtends`
serializes **every** subject's branch list **twice** (`listKey(flat)` and
`listKey(raw)`, `emit.ts:239`) just to ask "did anything change?".

**Why it's hot:** `solveComposed` already *knows* the answer — a prefilter miss
returns the seed unchanged (`solve.ts:75`), and `runFixpoint` tracks a `changed`
flag (`solve.ts:96`). The caller throws that knowledge away and re-derives it by
full string serialization of both lists.

**Proposed change (idea):** have `solveComposed` return `{ branches, changed }`;
skip `listKey(flat)`/`listKey(raw)`/`siblingCompact` when `changed === false`.

**Predicted win:** `listKey`+`branchText`+`simpleText` are ~4–5% of the pipeline;
removing one of the two per-subject serializations for ~92% of subjects ≈
**2–4 ms.** This is a strict subset of #1 and the cheapest first step — land it
alone if #1's cascade bookkeeping proves fiddly. Byte-safe: `changed===false`
means `flat` equals `raw`, so `flatByRule` gets no entry either way today.

### 3. Parser: cut the value additive/multiplicative speculative descent  — MEDIUM win / HIGH effort — PARSER-OWNED

**Hot spot:** `_r_topSum` (5.7%) + `_r_topProduct` (5.2%) = **~10.9% ≈ 5.7 ms**,
the largest grammar hotspot pair.

**Why it's hot (from the profile + standing note
`less-math-mode-is-parse-time`):** every value climbs the additive→multiplicative
precedence ladder, but most values in the fixture are non-arithmetic
(`#fff`, `10px`, keywords, functions). This is the **shared-prefix ordered-choice
backtrack class** (`parser-shared-prefix-backtrack-class`): descend, fail to find
an operator, roll back.

**Proposed change (idea):** a `peek`/`ahead` fast-path (parseman 0.27 has the
combinator) that skips the sum/product descent when no infix math operator
follows the first term. **This is grammar territory — do NOT edit
`grammar*.ts`/`builders.ts`; a parallel agent owns it and Tier-B is in flight.**
Hand this to the parser owner as a measured lever.

**Predicted win:** **2–3 ms** if the common non-math value avoids the descent.
Break-even: the peek must be cheaper than the current rollback for the arithmetic
case not to regress. **Re-measure against built `lib/` first** (caveat above).

### 4. Parser: capture-frame / trivia-frame overhead  — LOW–MEDIUM win / MEDIUM effort — PARSER-OWNED

**Hot spot:** trivia frame `_fd..._tf0` (3.3%) + capture frames `_pf47`/`_pf57`
(~1.5%) = **~4.8% ≈ 2.5 ms**. Confirms the standing `cst-capture-bottleneck` /
capture-frame lever with data (it's real but modest, not dominant).

**Proposed change (idea):** reduce capture-frame allocation on the hottest rules
(selectors/declarations). Grammar-owned; coordinate with the parser agent.

**Predicted win:** **1–2 ms.** Allocation-bound. Re-confirm against built `lib/`.

### 5. Extend IR: memoize/intern `branchText`, trim clone churn  — LOW win / LOW–MEDIUM effort

**Hot spot:** `ir.ts` = 23% of serialize self-time — `branchText`/`compoundText`/
`simpleText` (string concat) and `cloneBranch`/`cloneSeg`/`cloneSimple` (object
clones), re-run per branch per subject.

**Why it's hot:** the IR re-serializes and re-clones the same branches repeatedly
across `computeExtends`'s passes. Allocation-bound (string + object churn feeding
GC's 3%).

**Proposed change (idea):** cache `branchText` per `Branch` (immutable within a
run); avoid the defensive `cloneBranch` where the consumer does not mutate.

**Predicted win:** **1–2 ms standalone**, but **largely subsumed by #1** (fewer
subjects processed ⇒ far fewer clones/serializations). Do #1 first, then
re-measure before investing here.

---

## Levers evaluated and *refuted* as major wins

- **Serialize-path monomorphism.** `serialize.ts` proper is only **16% of
  serialize ≈ 3 ms**. The serializer node dispatch is not a meaningful lever at
  this fixture size — the serialize phase is dominated by the extend engine, not
  the emit walk. Do not spend effort megamorphic-dispatch-tuning the serializer.
- **`builders.ts` regex re-parsing.** Not visible as a distinct hotspot in the
  parse profile (grammar rule functions dominate, not builder host code); the
  Tier-B removal will absorb whatever remains. No independent action.
- **Import phase.** 0.34 ms (0.7%). Ignore.

## Priority summary

| # | Idea | Predicted win | Effort | Owner | Byte-risk |
|---|------|---------------|--------|-------|-----------|
| 1 | Extend: prune per-subject work to affected rules | 6–10 ms | Medium | core | gated (cascade correctness) |
| 2 | Extend: `changed` flag, drop double `listKey` | 2–4 ms | Low | core | none |
| 3 | Parser: skip value math speculative descent | 2–3 ms | High | **parser** | re-measure vs lib |
| 4 | Parser: capture/trivia-frame overhead | 1–2 ms | Medium | **parser** | re-measure vs lib |
| 5 | Extend IR: memoize branchText / trim clones | 1–2 ms (mostly in #1) | Low–Med | core | none |

**Headline:** the single biggest, most self-contained, byte-safe lever is the
**extend engine processing every rule in the document instead of the ~26 it
touches (#1 + #2, ~8–12 ms)** — this is core-owned and does not require touching
the parser grammar. The next tier (#3, #4) lives in the parser and must be
handed to the parser owner and re-measured against the built bundle.

---

## dart-sass competitiveness — comparative audit (2026-07-18)

Fresh-dev `e7ee8cc57` (ast/ production cutover on `d67e7f581`). Same methodology
as above (worktree source-transform harness, warmup ≥25, N=60 median; V8 sampling
CPU profile at 50 µs, 200/300 iterations after 30-iter warmup). This section adds
the **dart-sass comparative lens** to the internal breakdown above; it does not
restate or contradict the ideas already ranked. Every number below is either a
`benchmark.less` internal stage measurement or the synthetic 3-way cross-engine
measurement — each claim states which.

### 1. Cross-engine baseline (measured)

`packages/jess/benchmark/compare-sass.mjs`, the 3-way matched-workload harness
(220 components × 6 variants; **synthetic** — dart-sass cannot read `.less`, so
both dialects are generated from one spec; 275 KB Less / 288 KB SCSS in →
~368 KB CSS out), `WARMUP=15 N=31`, two independent runs:

| Engine | median | vs dart-sass |
|--------|--------|--------------|
| dart-sass (`sass` npm, dart2js) | 71.8 / 73.1 ms | 1.00× |
| **Jess ast/ v2** (`renderAstLess`) | 90.2 / 91.2 ms | **1.25–1.26× slower** |
| Jess legacy (`render`, tree/ eval) | 259.6 / 268.9 ms | 3.62–3.68× slower |

The two Jess rows are **byte-identical** (sha `23f86af75557`); dart-sass differs
by 218 bytes (formatting, expected). **This 1.25× is the only cross-engine number
here** and it rides the synthetic workload. All *stage* attribution below rides
`benchmark.less` (4446 lines, 129,317-byte CSS) — the two workloads are not
interchangeable, so the per-stage split of the 1.25× gap is *inferred* from
`benchmark.less`'s stage profile, not measured on the synthetic sheet.

### 2. Stage-by-stage: where the ~1.25× gap lives

`benchmark.less` internal phase medians on fresh dev (N=60):

| Phase | Median | Share |
|-------|--------|-------|
| parse + build (`parseToAst`) | 29.77 ms | **63.8%** |
| serialize (fused eval + emit + extend) | 16.02 ms | **34.3%** |
| **total** | **46.63 ms** (min 42.19) | 100% |

The **~50 ms floor holds** (46.6 ms median here; the 51.9 ms in the header is an
earlier run — same order, ordinary machine variance). CSS is 129,317 bytes vs the
header's 131,713 — a small render-shape drift landed since; not a regression.

**The gap to dart-sass lives in PARSE.** Parse is 63.8% of our render, and the
parse-only profile puts **`grammar.ts` at 72.4% of parse self-time ≈ 21.6 ms
(~46% of the whole render)**. dart-sass's parser (`lib/src/parse/parser.dart`,
verified) is a hand-written single-pass `SpanScanner` over code units with **no
token stream, no CST capture, and no per-node trivia frame** — whitespace is
consumed inline (`whitespace()`), and backtracking is bounded explicit
`scanner.state` save/restore (`tryUrl`, `scanIdentifier`). Jess's parseman
combinator grammar is structurally heavier *by design*: the trivia frame `_tf0`
alone is **5.2% of parse (~1.6 ms)** and it fires on every node, while capture
frames + speculative ordered-choice descent account for the rest. Neither eval nor
serialize is where we trail: our **fused eval+serialize walk** (single pass,
`serialize.ts`) and **lazy value model** (single-unit fast path, un-materialized
bare strings — see memory) are competitive with or ahead of dart-sass's separate
`CssStylesheet` + `_SerializeVisitor`. Value-eval is ~1 ms on this fixture.

### 3. BuilderHost weight + retirement win (measured)

The task flags two "BuilderHost" surfaces; they are **not the same code and only
one is on the ast/ render path**:

- **Parser-side `BuilderHost`** (`less-parser/src/functional-parser.ts` →
  `builders.ts::buildNode`): the **legacy tree/ producer**, driven by
  `parseLessFn`/`LessParser.parse`. **It does not appear anywhere in the ast/
  render CPU profile.** `parseToAst` passes *core's* dispatch host as the grammar
  `build` callback, so grammar rules build ast nodes directly and never touch
  `buildNode`. **Predicted free render win when it retires with legacy tree/: ≈ 0
  ms on the ast/ path.** Its payoff (the ~34 `builders.ts` regex vanishing) is
  code-hygiene / two-producer removal, *not* ast/ throughput — do not budget a
  render speedup for it.
- **Core-side dispatch/build host** (`ast/parse-host/dispatch-host.ts` +
  `actions/*.ts` + node constructors in `nodes.ts`/`node.ts`/`index.ts`): this IS
  on the path and is the **keeper**, not a deletion target. Measured share of
  parse self-time: `dispatch-host` 2.7% + `custom-props` 3.4% + `comments` 1.9% +
  `selector` 1.1% + `host-context` 0.7% + `value-leaf` 0.6% + smaller actions
  ≈ **12.5%**, plus node construction ~2.7% → **~15% of parse ≈ 4.5 ms**. That is
  irreducible node-building work, not overhead to be deleted.

**Net:** the "BuilderHost is slated for deletion" note is about the *legacy*
producer, whose deletion buys a cleaner parser and zero ast/ render time. There is
no free render win hiding behind BuilderHost retirement.

### 4. Ranked dart-sass learnings (skipping already-listed / already-landed)

Cross-checked against `git log --oneline -40`: `#{}` in-grammar (interp char-scan
deletion) already landed `9e2810a73`; structured comma-list value node
`33a545633`; value-materialization memoization design `106bfd482`. None of those
is proposed here. The value-math speculative descent (#3) and generic
capture/trivia frame (#4) above are *not* re-listed — item D below **sharpens #4**
with a dart-sass-grounded mechanism rather than duplicating it.

**A. Selector interp speculative-descent — skip `InterpolatedSelector` when no
`@{` follows.** *dart-sass technique:* `lookingAtIdentifier()` peeks before
committing to a selector arm; no wasted descent on the common case. *Our cost:*
`interpOrBasic = choice(InterpolatedSelector, basicSel)`
(`less-parser/src/grammar.ts:403`) tries `InterpolatedSelector`
(`grammar.ts:372`) **first** on every `.`/`#`/ident-leading simple selector; for a
plain `.btn` it matches `[.#]` + ident, then fails `lessInterp` (no `@{`) and
backtracks into `basicSel`. `_r_InterpolatedSelector` is **3.5% of parse ≈ 2.1 ms**,
almost all of it wasted on non-interpolated selectors (the large majority).
Selectors are the biggest grammar cluster overall — `_r_ComplexSelector` 6.4% +
`CompoundSelector` 4.2% + `SelectorList` 3.9% + `InterpolatedSelector` 3.5% +
`PseudoSelector` 3.1% + `simpleSelector` 2.0% + `LessAmpersand` 1.5% ≈ **24.6% of
parse ≈ 7.3 ms**, bigger than the value-math pair (#3, 8.6%). *Transfers?* Yes
within the LAW: a parseman `peek`/`ahead` for `@{` before the interp arm stays in
the combinator model (this is the `parser-shared-prefix-backtrack-class` lever
applied to selectors — a **distinct rule** from #3's value ladder). *Win:* **M
(2–3 ms)**; *effort* Medium; *break-even:* the `@{` peek must be cheaper than the
current `lessInterp`-fail rollback — trivially true (one char-class test).
**Parser-owned; re-measure vs built `lib/`.**

**B. Variable-lookup last-hit + name→depth index cache.** *dart-sass technique:*
`Environment` keeps `_variableIndices` (name → scope index, filled lazily) plus
`_lastVariableName`/`_lastVariableIndex` for an O(1) repeat-hit short-circuit, so
`getVariable` rarely rescans the scope list. *Our cost:* `resolveVarStack`
(`serialize.ts:637`, via `resolveVarRef:690`) walks own frame → every `parent` →
`fallback`, doing `Map.get(name)` at each frame — O(scope-depth) per read, **no
last-hit or name→depth cache**. *But:* value-eval is **~1 ms on `benchmark.less`**
(`value-operate` 1.4% of serialize), so this is **LOW win on the current corpus**.
*Transfers?* Cleanly (a `Map` index + two scalar fields; no LAW impact). *Win:* **L
here**, potentially M on variable-dense real sheets; *effort* Low. Log it as cheap
insurance, not a `benchmark.less` lever — do not invest until a variable-heavy
fixture shows lookup in the profile.

**C. Interned/empty-scope fast exit on the parent walk.** *dart-sass technique:*
lookups fall straight through to the global module map when local frames are
empty, never allocating per-frame structures for scopes that declare nothing.
*Our cost:* every `Frame` carries `vars`/`mixins`/`rulesets` maps (many `null`
until needed — already lazy), but the resolve walk still visits each frame. On
`benchmark.less` this is sub-millisecond (folded into the ~1 ms eval). *Win:* **L**;
*effort* Low. Listed only for completeness — **refuted as a `benchmark.less`
lever**; the lazy-map design already captures most of the benefit.

**D. Gate the trivia frame to the nodes that consume trivia (sharpens #4).**
*dart-sass grounding:* no per-node trivia frame exists at all — whitespace is
scanned inline. *Our specific finding:* `captureTriviaForNode` returns `true`
**only for `CompoundSelector`** (`functional-parser.ts` / core host), yet the
`_tf0` trivia frame is **5.2% of parse ≈ 1.6 ms** and fires on **every** built
node; the captured trivia is discarded for every type except `CompoundSelector`.
So most trivia-frame allocation is pure waste. This is a **concrete mechanism** for
the generic #4 ("capture/trivia-frame overhead"): gate the frame off wherever
`captureTriviaForNode` is false rather than allocating-then-discarding. *Win:*
raises #4's ceiling toward **~1.5–2 ms**; *effort* Medium; *break-even:* the gate
test must be cheaper than the frame it elides — it is (a `type ===` check).
**Parser-owned; folds into #4, re-measure vs built `lib/`.**

### 5. What NOT to copy from dart-sass

- **A hand-coded imperative scanner replacing the combinator grammar.** dart-sass
  buys its parse speed partly by hand-writing `parser.dart` with ad-hoc character
  logic. That directly violates Jess's committed LAW (no regex/char-scan outside
  parseman `regex()`; parser owns structure via the combinator model). The
  transferable part is **peek-gating inside** the grammar (A, D), not abandoning it.
- **A separate `CssStylesheet` AST + `_SerializeVisitor`.** dart-sass evaluates
  into a full CSS tree, then serializes it in a second pass. Jess deliberately
  **fuses eval + serialize** in one walk (`serialize.ts`), skipping an entire
  intermediate tree and its allocation. Copying dart-sass here would *add* GC
  pressure — keep the fused walk.
- **Blanket value interning / immutable value objects with structural sharing.**
  dart-sass leans on Dart's cheap small-object allocation and its own GC. On V8,
  Jess's **lazy materialization** (single-unit number fast path, lazy HSL,
  un-materialized bare strings — see memory) already wins on memory; forcing
  eager immutable value wrappers to mirror `SassNumber`/`SassString` would regress
  both allocation and the lazy fast paths. Do not.
- **Dart AOT / dart2js numeric assumptions.** N/A on V8.

### Priority summary — folding in the dart-sass findings

| # | Idea | Predicted win | Effort | Owner | Byte-risk |
|---|------|---------------|--------|-------|-----------|
| 1 | Extend: prune per-subject work to affected rules | 6–10 ms | Medium | core | gated (cascade correctness) |
| 2 | Extend: `changed` flag, drop double `listKey` | 2–4 ms | Low | core | none |
| A | **Parser: peek `@{` before `InterpolatedSelector` arm** | **2–3 ms** | Medium | **parser** | re-measure vs lib |
| 3 | Parser: skip value math speculative descent | 2–3 ms | High | parser | re-measure vs lib |
| 4+D | Parser: gate trivia frame to `CompoundSelector`-only consumers | 1.5–2 ms | Medium | parser | re-measure vs lib |
| 5 | Extend IR: memoize branchText / trim clones | 1–2 ms (mostly in #1) | Low–Med | core | none |
| B | Var-lookup last-hit + index cache | L now / M on var-dense sheets | Low | core | none |

**dart-sass headline:** we are **1.25× off dart-sass** on the synthetic 3-way, and
the gap is **PARSE**, not eval or serialize — our fused eval+serialize and lazy
value model already hold their own. The largest *new* parser lever is **selector
interp speculative-descent (A, ~2–3 ms)**, since selectors are 24.6% of parse (the
biggest grammar cluster) and `InterpolatedSelector` is tried-first-then-rolled-back
on the non-interpolated majority. **BuilderHost retirement is a code-hygiene win
with ≈ 0 ms of ast/ render behind it** — do not budget parse time for it. Every
parser lever (A, 3, 4+D) stays inside the parseman combinator LAW as peek-gates and
must be re-measured against the built `lib/` before landing.
