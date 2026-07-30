# Parse-drift hypotheses — AST-slower-while-CST-neutral

Base SHA: `0dbfc89f03ce4f90ee9317d7e1103dd63959ae38` (branch `perf-drift-hypotheses`, from `origin/dev`).
Parseman: `0.43.0`, resolved at
`/Users/matthew/git/oss/jess/node_modules/.pnpm/parseman@0.43.0/node_modules/parseman/dist/index.cjs`.

**These predictions were written and committed BEFORE any measurement was taken.**
Nothing below the "Predictions" line was edited after a number was collected;
results are appended in a separate, clearly marked section.

Lane: explain *why* the drift exists (mechanism). A separate agent owns *where*
it entered (bisect). No `grammar.ts` is modified by this work.

## Two structural facts established by reading (not measuring)

**F1. The four dialect grammars do not compose `cssGrammar`.**
The coordinator's framing was `compose([cssGrammar, <dialect delta>])`. That is
not what ships. `packages/syntax/less/less-parser/src/grammar.ts:6311` is
`composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules(..., lessGrammarFactory)])`.
`composeLeaf` composes *terminal leaf recognition* (`cssSyntax`, `lessSyntax`,
`cssPseudoSyntax` from `@jesscss/parser-shared/recognition`), not a grammar
subtree. Less has its own complete 6331-line factory and never imports
`cssGrammar`; the "CSS base:" line at `grammar.ts:4` is a source-lineage
comment. So "an overridden CSS rule stays reachable in the composed artifact"
cannot be the mechanism here — there is no CSS grammar in the Less artifact to
override. This retires a chunk of the compose-level hypothesis space up front.

**F2. AST and CST differ by exactly one flag, and that flag gates per-node capture.**
Each dialect exports four artifacts from one factory; the only difference is
`hostMode: 'cst'` (`css/css-parser/src/grammar.ts:4013-4031`,
`less/less-parser/src/grammar.ts:6311-6319`). Inside parseman's `emitNode`
(`dist/index.cjs:9057-9078`):

```js
const structural = def.build === void 0 && def.project === void 0;
const cstOut = ctx.hostMode === "cst" && !structural;
const capturesTrivia   = cstOut || mkType !== null || ... || (!structural && !hasProject && buildReadsTrivia(def));
const clonesState      = !structural && (cstOut || (!hasProject && buildReadsState(def)));
const capturesChildren = !structural && (cstOut || mkType !== null || def.unwrap || def.collapse || def.project !== void 0 || buildReadsChildren(def));
const capturesRaw      = !structural && (cstOut || mkType !== null || (def.project === void 0 && buildReadsRaw(def)));
const capturesFields   = hasFields && !structural && (cstOut || (!hasProject && buildReadsFields(def)));
```

In **CST** mode `cstOut` is true, so every non-structural node captures
children + raw + fields + trivia and clones state **unconditionally**. In
**AST** mode each capture is decided individually by `buildReads*(def)`, which
is *static source-text analysis of the reducer function* via
`confirmedBuildArity` (`dist/index.cjs:3272-3322`):

```js
function confirmedBuildArity(src) {
  const m = PARAM_LIST_RE.exec(src.trim());
  if (!m) return null;
  if (m[3] !== undefined) return 1;              // single-ident arrow `x => ...`
  const inner = (m[1] ?? m[2] ?? "").trim();
  if (inner === "") return 0;
  const parts = inner.split(",");
  for (const part of parts) {
    if (!CONFIRMABLE_PARAM_RE.test(part.trim())) return null;   // <-- footgun
  }
  if (/\barguments\b/.test(src)) return null;
  return parts.length;
}
// PARAM_LIST_RE       = /^(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/
// CONFIRMABLE_PARAM_RE = /^[A-Za-z_$][\w$]*\s*\??\s*(?::[^,=]+)?$/
```

Thresholds: `arity >= 1` captures children, `>= 2` fields, `>= 4` raw,
`>= 5` trivia, `>= 6` clones state. **`arity === null` turns on all five.**

`CONFIRMABLE_PARAM_RE` matches only a bare identifier with an optional `?` and
an optional non-`,`/non-`=` type annotation. It therefore returns `null` — the
maximum-cost answer — for a reducer whose parameter list uses **destructuring**
(`({ a, b }) =>`), a **default value** (`(c, s = 0) =>`), a **rest param**
(`(...args) =>`), a **generic/union type annotation containing a comma**
(`(c: Foo<A, B>) =>` splits on the comma and fails the per-part test), or any
body mentioning `arguments`. A reducer passed as a **reference to a hoisted
named helper** is analyzed by `def.build.toString()` of that helper, so its
declared signature — not the call site — decides the cost.

This is the AST/CST asymmetry generator, and it is exactly the class the
coordinator named ("looks right, compiles to something else", cf. the
`'cst' as const` macro footgun): **it is invisible in the grammar source and
free in CST mode.** Every hypothesis below is ranked against it.

---

# Predictions

Ranked most to least likely. Each: mechanism, location, predicted magnitude and
direction, why AST and not CST, and the experiment that kills it.

## H1 — Reducer-arity capture escalation (PRIMARY)

**Mechanism.** Grammar cleanup commits rewrote reducers. Any rewrite that (a)
raised a reducer's declared arity past a threshold, or (b) made the parameter
list unconfirmable (destructuring / defaults / rest / comma-bearing generic type
annotation), or (c) replaced an inline arrow with a reference to a hoisted named
helper whose own signature is wider, flips `capturesRaw` / `capturesTrivia` /
`clonesState` from `false` to `true` for that node **in AST mode only**. Each
flip costs, per node instance per parse: an array materialization for raw, a
trivia-log slice, and — for `clonesState` — a state object clone.

The cleanup range is full of exactly the refactors that do this:
`7c936af4c` "consolidate general templates", `8f919c373` "unify custom value
groups", `12d8e1b18` "unify pseudo argument groups", `22b066edc` "factor mixin
statement tail", `cad6f68ad` "share mixin statement interior", `e44af334d`
"factor unary value". Factoring N inline reducers into one shared helper is the
single most likely way to widen a signature.

**Location.** Emission site `parseman dist/index.cjs:9070-9078`; the analyzer
`dist/index.cjs:3272-3322`. The affected reducers are the `node(...)` build
arguments across all four
`packages/syntax/{css,less,scss,jess}/*-parser/src/grammar.ts`.

**Predicted magnitude/direction.** Dominant contributor. I predict this accounts
for **most of the unattributed CSS AST +7.5%** and **the larger share of the
Less AST ~13%**, with **0% (or slightly negative) on CST**. Concretely I predict
the count of `arity === null` or `arity >= 4` reducers on hot paths
(value, selector, declaration, block-item) is **non-trivially higher at HEAD
than at the pre-fold/pre-cleanup baseline** — I'll call the prediction
**at least 10 additional hot-path nodes escalated**, and I expect
`clonesState` (arity >= 6 or null) to be the most expensive single flip.

**Why AST and not CST.** `cstOut` short-circuits every one of these to `true` in
CST mode, so CST already pays the maximum and cannot regress from a widened
signature. Only AST mode can move.

**Falsification.** Static count, zero noise floor: extract every `node(...)`
reducer from each grammar at HEAD and at the baseline SHA, run the *actual*
`confirmedBuildArity` regex pair over each reducer's source, and tabulate
children/fields/raw/trivia/state capture. **If the HEAD tabulation is not worse
than baseline on hot-path nodes, H1 is refuted** regardless of any timing.
Second, independent check: instrument a built artifact to count realized
state-clone and raw-array allocations per parse of the same corpus. A count that
did not rise refutes H1.

## H2 — `project` removal / structural-node loss

**Mechanism.** `hasProject` (`node(..., { project })`) forces `capturesRaw`,
`capturesFields`, and `clonesState` to `false`, and `structural`
(no `build` *and* no `project`) disables *all* capture. Cleanup that converted a
`project` node or a structural node into a node with a build reducer silently
turns on capture in AST mode. Note `capturesChildren` is `true` when
`def.project !== void 0` — `project` is cheap but not free.

**Location.** Same emission site, `dist/index.cjs:9061`, `9074-9076`. Repo-side:
any `node(` that gained a reducer during the cleanup.

**Predicted magnitude.** Second-order versus H1; **+1–3% AST, 0% CST**. Fewer
sites should be affected because `project` is not the common authoring shape.

**Why AST and not CST.** Same short-circuit as H1.

**Falsification.** Count `node(...)` calls with `{ project` and count structural
`node(name, parser)` two-argument forms, HEAD vs baseline, per grammar. No net
decrease refutes it.

## H3 — Comment-to-trivia migration (explains the CST *improvement*)

**Mechanism.** The Less hotspot report records that `ValueComment` was deleted
and that custom-property values, opaque at-rule preludes, and value/function
comments moved from semantic grammar nodes into parseman's trivia log
(`docs/architecture/parser/LESS-FOLD-HOTSPOT-REPORT.md`, "Comment-as-trivia debt
audit"). CST mode stops building those `Comment` nodes → CST gets **faster**.
AST mode never built cheap comment nodes to begin with but now carries a longer
trivia log, and every node with `capturesTrivia` slices a longer log.

**Predicted magnitude.** **Explains most of the CST-faster-than-baseline half**
of the signature, plus a **small +0.5–2% on AST**, concentrated on
comment-dense fixtures. This is a *partial* explanation only: it cannot by
itself produce +7.5% AST.

**Why AST and not CST.** Asymmetric in the opposite direction — it *helps* CST
and mildly *hurts* AST, which is why it is a good fit for the observed shape but
a poor fit for the magnitude.

**Falsification.** Parse a comment-stripped copy of the corpus. If the AST delta
largely survives comment removal, H3 is not the driver. Also: count trivia-log
length per parse, HEAD vs baseline.

**Refuted sub-claim, already, by reading:** the obvious suspect
`createTriviaMapFromParseman` (`packages/core/src/ast/provenance.ts:214`, called
AST-only at `less-parser/src/index.ts:90-93`) is **lazy** — it allocates two
empty `Map`s and closures and does no per-gap work at construction. It is O(1)
and cannot be the cost. The hotspot report's suggestion to "isolate ...
`createTriviaMapFromParseman`" is a dead end at this SHA. Recorded so nobody
re-spends the time.

## H4 — `attempt(...)` in ordinary valid traffic (symmetric — explains magnitude, NOT asymmetry)

**Mechanism.** The hotspot report names a surviving `attempt(...)` after `(` in
the Less mixin definition-versus-call gate, plus the `rulesetNotDeclaration`
regex preflight. Speculative consume-then-rollback on ordinary valid input costs
recognition time.

**Predicted magnitude.** Real, and plausibly a large share of the absolute
pre-fold→now regression (report: 20–22ms → 36–42ms AST, 15–16 → 33–37 CST). But
it is **recognition-layer**, so it must hit **both** modes roughly equally.

**Why it does NOT explain the target signature.** The observed drift is
AST-only. **I predict this shows up on CST too**, and therefore that it is a
separate (larger, older) problem from the one I was asked to explain. If a
candidate shows Less AST +13% with CST flat, H4 is refuted *for that candidate*.

**Falsification.** Measure the same candidate on both host modes. Symmetric
movement supports H4; AST-only movement refutes it.

## H5 — `mkType` inline-build forces capture

**Mechanism.** `analyzeMkInlineBuild` (`dist/index.cjs:6899`) pattern-matches a
reducer against `MK_BUILD_RE`; on a match the node uses an inlined node
constructor — but `mkType !== null` also forces `capturesTrivia`,
`capturesChildren`, and `capturesRaw` to `true` (`9073-9076`). A cleanup that
changed a reducer's spelling so it *stopped* matching `MK_BUILD_RE` loses the
inline fast path; one that started matching gains the fast path but pays three
captures.

**Predicted magnitude.** **±1–2% AST, 0% CST.** Sign genuinely uncertain, which
is why it is ranked here and not higher.

**Falsification.** Count `MK_BUILD_RE` matches per grammar, HEAD vs baseline.

## H6 — `composeLeaf` / compose-level duplication (coordinator's angle)

**Mechanism as posed.** Overridden-but-still-reachable rules, duplicate
productions, or first-set gating lost across a compose boundary.

**Predicted magnitude.** **LOW — near zero**, and I am predicting this before
testing precisely so the prediction is falsifiable. Per **F1**, the dialects do
not compose the CSS grammar; `composeLeaf` merges terminal leaf recognition
only, and each dialect's rule map comes from its own single `rules()` factory.
There is no override layer in which a shadowed-but-live base rule could hide.
The known tooling gap (`composedGrammarCoverageDefinitions` throws on opaque
artifacts, `compiledGrammarCoverageDefinitions` returns empty for macro-built
compose results) is real but, if F1 holds, it is not load-bearing here.

**Falsification.** Dump the built artifact's rule map per dialect and count
duplicate rule names and rule count versus the source `const` count. A duplicate
count of ~0 and a rule map matching the single factory confirms F1 and refutes
H6. A rule map materially larger than the factory's own rules confirms H6 and
makes it a **parseman finding to report, not to fix here**.

## H7 — Megamorphic keyed node stores / hidden-class churn

**Mechanism.** Node objects built through many differently-shaped reducers
produce polymorphic ICs at the shared construction sites in `@jesscss/core/ast`.

**Predicted magnitude.** **LOW, and deliberately deprioritized.** This repo has
already measured this class once and been wrong by 8x (16 maps assumed, 2
observed; noise floor ±4.9%). I predict that if measured, realized map counts
will again be far below intuition, and that this is **not** the driver. I am
recording the prediction rather than spending the budget.

**Falsification.** `--allow-natives-syntax` + `%HaveSameMap` on sampled node
objects, or `--trace-maps`. Counting realized maps, not assuming them.

## H8 — `hostBranchElided` AST-mode path

**Mechanism.** `dist/index.cjs:9071` sets `ctx.hostBranchElided = true` whenever
a non-structural node is compiled in AST mode. Unknown whether this disables a
downstream optimization or is merely bookkeeping.

**Predicted magnitude.** Unknown; recorded as an explicit unknown rather than
guessed. Genuinely AST-only by construction, so it deserves a look.

**Falsification.** Read every consumer of `hostBranchElided` in the parseman
compiler and determine whether it gates codegen.

## Predicted ranking of contribution to the AST-only signature

1. H1 (reducer-arity capture escalation) — majority share
2. H3 (comment→trivia) — explains the CST-faster half, small AST cost
3. H2 (`project`/structural loss) — small
4. H5 (mkType) — small, uncertain sign
5. H8 — unknown
6. H6, H7 — predicted near-zero

**Predicted for the record:** H4 is real but symmetric and therefore *not* the
answer to the question asked. If the eventual data shows the Less AST ~13% with
CST flat, H4 is refuted as the cause of *that* candidate.
