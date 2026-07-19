# Grammar → AST-v2 Fusion — eliminate the build stage (SPEC + landing plan)

DESIGN/SCOUT. Base: `origin/dev`. Owner's top-priority endgame: **"get rid of build,
grammar makes AST v2 ASAP."** This doc maps the current grammar↔host seam precisely,
specifies the fused single-producer architecture, states the hard gate (BuilderHost
must be gone), identifies the incremental win that can land BEFORE full BuilderHost
deletion, and predicts the perf.

Companion specs (referenced, not duplicated):
- `BUILDERHOST-RETIREMENT-DESIGN.md` — the collapse-to-one-producer + R0–R4 critical path.
- `GRAMMAR-RELOCATION-DESIGN.md` — the site-by-site regex relocation map.
- `VALUE-NODE-MODEL-DESIGN.md` — the landed `ast/` node set + factories the builds bind to.
- `TIER-B-INTERPOLATION-GRAMMAR-SPEC.md` / `QUOTED-GRAMMAR-STRUCTURING-PLAN.md` — prelude/§3.3 structuring.
- memory `parseman-cst-capture-bottleneck` — the CST-capture profile that decides the perf case.

---

## 0. TL;DR

1. **There is no separate build PASS today.** The build already happens INLINE at parse
   reduce: parseman's `node()` combinator, on matching, calls `ctx.build(type, children,
   fields, span, rawChildren, triviaLog, state)` right there. It is single-pass already.
   What the task calls "build" is: (a) the **per-node CST capture buffers**
   (`children`/`rawChildren`/`triviaLog`) parseman allocates so a build CAN read them,
   (b) the **generic-host dispatch** (`Map.get(type)` + a `BuildArgs` object allocation
   per node), and (c) node allocation. Per memory `parseman-cst-capture-bottleneck`,
   **(a) is ~half of parse time**; (b)+(c) are the smaller remainder of the ~13% "build".

2. **The fusion = give every grammar `node()` rule its OWN `build` callback** that
   constructs the AST-v2 node directly (calling the `ast/` factories `dimension`/`color`/
   `quoted`/`keyword`/`any`/… inline), replacing the generic `ctx.build` host. This
   deletes the dispatch (b) AND — the real prize — unlocks parseman's **per-rule
   arity-gated capture elision** so a rule that reads only `(children, fields, span)`
   pays **no trivia capture, no state clone** (and, with a small parseman gate, **no
   rawChildren capture**). Today a single generic host must declare the MAX arity any
   family needs, so EVERY node pays the full capture. Per-rule builds make the majority
   of nodes (value leaves) cheap.

3. **Hard gate:** fusing bakes the `ast/` factories into the grammar's `node()` builds,
   making the grammar **ast-v2-specific**. It can then no longer feed the legacy
   `BuilderHost` (tree/ nodes). So **BuilderHost must be retired first** — its critical
   path is owned by `BUILDERHOST-RETIREMENT-DESIGN.md` (R0–R4; the true blocker is the
   production-render cutover to the `ast/` spine).

4. **Incremental win available NOW (no grammar fork, byte-identity-provable):** implement
   `_parsemanTriviaKinds(type)` on the `ast/` dispatch-host so the highest-frequency node
   types whose actions demonstrably never read trivia (the value LEAVES) skip per-node
   trivia capture. This recovers a large slice of the ~28% trivia-capture cost on the
   ast/ path today, WITHOUT touching the shared grammar. Spec'd in §6 as **P1**; it is the
   first landing and does not wait on BuilderHost.

---

## 1. Current architecture — the exact seam

### 1.1 One grammar, one inline reduce, a pluggable `ctx.build`

`lessGrammar` (`packages/less-parser/src/grammar.ts`, Parséman **macro-compiled**;
`compose([cssGrammar, <Less delta>])`) is **host-agnostic**. Its own doc says it plainly:

> "Most returned rules are structural `node(parser)` entries that build via the injected
> `ctx.build` host."

A structural `node('Type', parser)` (no own `build`) works like this in parseman
(`parser-thing/src/combinators/node.ts`, and the compiled twin in
`compiler/codegen.ts` `emitNode`):

1. `beginCstNodeCapture` installs fresh per-node `children` / `rawChildren` /
   `triviaLog` buffers (+ a `_fields` array if the combinator declares fields).
2. the inner combinator parses, pushing terminals/sub-nodes into those buffers and
   trivia spans into `triviaLog`.
3. `endCstNodeCapture` finalizes them, then the node calls the injected host:
   `ctx.build(nodeType, children, fields, span, rawChildren, triviaLog, state)`.

The build happens **at the reduce, during the parse** — there is no CST-then-walk second
pass. The "intermediate representation" is only the **per-node capture buffers**, not a
persisted tree.

### 1.2 Two hosts consume that seam

| Host | File | Emits | Consumed by |
|---|---|---|---|
| **`ast/` dispatch-host** (`ParseBuildHost`) | `core/src/ast/parse-host/dispatch-host.ts` + `actions/*` (18 families) | AST-v2 plain-data nodes via `t2.dimension/color/quoted/keyword/any/…` | the `ast/` differential render (`render-doc.ts` / whole-doc driver) — the CORRECTNESS GATE |
| **`BuilderHost`** | `less-parser/src/builders.ts` (`LessGrammar`) + `functional-parser.ts` | legacy `@jesscss/core` `tree/` class instances | legacy production render (tree/ eval), the less-compat bridge, the ast/ import sub-parse |

Both run the SAME compiled `lessGrammar` through parseman's `run()`; they differ ONLY in
the `build` function handed in. The two hosts exist because they historically targeted
**different node models**. `BUILDERHOST-RETIREMENT-DESIGN.md` establishes the endgame:
collapse to ONE producer (the `ast/` model) and delete `BuilderHost`.

### 1.3 The `ast/` dispatch-host, precisely

`ParseBuildHost.build` (dispatch-host.ts:71) is:

```ts
build(type, children, fields, span, rawChildren, triviaLog) {   // arity 6
  const action = this._actions.get(type);                       // (b) Map dispatch
  if (action === undefined) return placeholder(type);
  const out = action({ type, children, span, rawChildren, triviaLog, ctx: this._ctx }); // (b) BuildArgs alloc
  if (type === 'Stylesheet') this.root = out;
  return out;
}
```

Each `actions/<family>.ts` exports `BuildAction[]` = `{ type, build: (args: BuildArgs) => node }`.
`BuildArgs` = `{ type, children, span, rawChildren, triviaLog, ctx }`. `parseToAst` drives
`run(entry, input, { build, trivia })` and returns the built `Root` directly.

**Dependency direction (load-bearing):** `render-doc.ts` module doc — core "never imports
`@jesscss/less-parser` (or any parser)". The grammar entry (`lessGrammar.Stylesheet`),
trivia (`lessGrammar.rw`), inline-JS guard, and value evaluator are all **injected** by the
consumer layer (`plugin-less` in production, the whole-doc test driver in tests).
`less-parser` has `@jesscss/core` as an **optional peer** dep — so a parser MAY import core,
but core imports no parser. This clean inversion is what the fusion must preserve.

---

## 2. What "build" actually costs (the profile that decides the design)

From memory `parseman-cst-capture-bottleneck` (measured, bootstrap.css, parseman-compiled):

- **Regex ≈ 2.6%** of parse — ranks LAST; not this design's concern.
- **CST capture ≈ HALF of parse.** Direct A/B forcing each buffer off (same span-end):
  skip per-node `triviaLog` **−28.6%**, skip `rawChildren` **−30.9%**, skip both **−51%**.
- A prior landed win: making the pure-CSS jess host **arity-4** (reads children+rawChildren,
  never trivia/state) gated OFF per-node trivia capture + state clone → **−21.2%**,
  byte-identical.

**The critical observation for THIS design:** that −21% is *not realized on the ast/ path*,
because the ast/ dispatch-host is **arity-6** — it declares `(type, children, fields, span,
rawChildren, triviaLog)`. parseman's runtime gate (codegen `emitNode`) reads host `.length`:
`>=5 ⇒ capture trivia`, `>=6 ⇒ clone state`. A **single generic host must declare the
MAXIMUM arity any of its 18 families needs** — and some families genuinely read trivia
(`comments`, `variables`, `value-expr` comment-peel; `selector` whitespace-before) — so the
host is arity-6 and **every structural node captures trivia** (and trips the state-clone
gate), including the millions of value leaves that never touch it.

That is the structural inefficiency the fusion removes: **arity is a per-HOST property today
(one max), and the fusion makes it a per-RULE property (each minimal).**

### 2.1 Which families actually read trivia (the elision opportunity)

Grep of `actions/*` for `triviaLog` reads:

| Reads per-node trivia | Does NOT read trivia |
|---|---|
| `comments` (lift block comments), `variables` (comment-peel of `@x:` value), `value-expr` (whole-value comment strip), `selector` (descendant-combinator whitespace) | **`value-leaf`** (Numeric/Color/NamedColor/Keyword/Quoted/EscapedValue/Url), `ruleset`, `at-rules`, `mixins-def`, `mixin-call`, `guard`, `custom-props`, `extend`, `charset`, `control-flow`, `selector-interp` |

The non-readers include the **highest-frequency node types in any stylesheet — the value
leaves.** Under per-rule builds they elide trivia capture entirely. `value-leaf.ts` reads
only `children` + `span` (via `leafBytes`); several read only `span`. Their per-rule arity
is 3 (`children, fields, span`) or less ⇒ no trivia, no state.

---

## 3. The fused architecture

### 3.1 Shape

Replace each structural `node('Type', parser)` + its `actions/<family>.ts` entry with a
grammar rule carrying its **own** build:

```ts
// today (grammar, host-agnostic) + a separate action file:
const Dimension = node('Numeric', noTrivia(sequence(numPart, optional(unit))));
// actions/value-leaf.ts:  { type: 'Numeric', build: (args) => t2.dimension(Number(a),b,bytes) }

// fused (grammar rule builds AST-v2 directly):
const Dimension = node('Numeric',
  noTrivia(sequence(numPart, optional(unit))),
  (children, _fields, span) => dimension(numOf(children), unitOf(children), src(span)));
```

- **No `ctx.build` host, no `Map.get(type)`, no `BuildArgs` object, no `type` string
  dispatch.** The reduce calls the rule's compiled `build` directly (positional args).
- **Single-pass, unchanged.** Emission still happens at reduce — the fusion changes WHO
  builds (the rule vs. an injected host), not WHEN. There is no new pass and no CST tree.
- **Per-rule arity elision fires.** `build-arity.ts` analyzes each rule's `buildSrc` at
  compile time: a `(children, fields, span)` build ⇒ no trivia capture, no state clone,
  and (with §3.3's parseman gate) no rawChildren capture. The comment/selector rules keep
  the params they need and pay only for themselves.

### 3.2 Where the factories live — the dependency decision (OPEN, recommended)

Per-rule builds must be **statically present at macro-compile time** for `build-arity.ts`
to read `buildSrc` and elide capture. A build injected at runtime does NOT get arity
elision (its source isn't visible to the compiler). So the grammar package must **statically
import** the AST-v2 factories. Options:

- **(A) Grammar imports `@jesscss/core` factories directly.** Works within the current
  layering — `less-parser` already peer-deps core, and core imports no parser, so there is
  **no static cycle** (core injects the grammar at runtime; the parser imports core's pure
  data factories). Simplest, but hard-couples every parser package (css/less/scss/jess) to
  core.
- **(B) Extract the factories to a tiny dependency-free package** (`@jesscss/ast-nodes`, or
  a core subpath with zero heavy deps) that BOTH core and the parser packages import. Keeps
  the parser free of a full-core dependency and preserves the cleanest layering. **Recommended.**

Either way the factories are the ALREADY-LANDED pure-data constructors (`dimension`,
`color`, `quoted`, `keyword`, `any`, `interp`, …) — no new node model. The `actions/*`
LOGIC (leaf classification consumption, `interpFromChildren`, comment-peel) moves verbatim
into the rule builds; it does not get rewritten, only relocated and made positional.

### 3.3 Preserve the parser-owns-structure keystone (adversarial check)

Single-pass emission does NOT weaken the keystone (`parser-owns-structure-no-byte-rederivation`):

- The grammar remains the **sole source of structure** — it already classifies leaves
  (Numeric/Color/Quoted/…), splits number/unit, and (per §3.3 Quoted / prelude structuring)
  emits structured interpolation/list children. The fused build **reads that structure** to
  construct the node; it does the SAME work `actions/*` does today, just inline. No build
  re-scans bytes; `src` verbatim threading (§2 of the retirement doc) is preserved because
  each leaf's build slices its own span (exactly as `value-leaf.ts` does now).
- **rawChildren elision needs a parseman gate.** node.ts today arity-gates trivia (5th) and
  state (6th) but NOT rawChildren (4th) — it always captures rawChildren. To realize the
  ~30% rawChildren lever for rules that don't read it, add a `buildReadsRawChildren` gate
  (arity `>=4`) mirroring `buildReadsTrivia`. This is a **parseman follow-on the fusion
  ENABLES** (per-rule arity makes it meaningful; a generic host reads rawChildren so it
  could never fire). Value leaves that read rawChildren (e.g. `numericLeaf` reads `children`)
  still capture — the gate only helps rules that genuinely ignore it (`leaf()`-built
  Color/Keyword read only `span`).

### 3.4 Dialect composability (adversarial check)

`lessGrammar = compose([cssGrammar, <Less delta>])`; SCSS/Jess grammars compose similarly.
If CSS-base rules carry ast-v2 builds, and Less/SCSS/Jess deltas override by name, then:

- **Every dialect's rules need ast-v2-producing builds.** The CSS base rules build the
  shared value/selector nodes; each dialect delta adds/overrides builds for its own
  constructs (Less `@{}` interp, SCSS `#{}`, Jess `$[…]`). This is exactly the seam that
  `interpolation-body-varies-by-dialect` already contemplates — the interp body combinator
  is overridable per dialect; its BUILD becomes overridable per dialect too.
- **This is why fusion must follow, not precede, the multi-dialect BuilderHost/host cleanup.**
  Today the dialect-specific ACTIONS live in one shared `actions/*` set keyed by `type`
  string — a Jess `$[…]` accessor and a Less `@{…}` ref map to different `type`s and
  different actions. Fusing distributes those into each dialect's grammar delta. The
  `compose()` name-wins semantics already give the delta its own rule; the delta simply
  carries its own build. No shared mutable dispatch map — additive, collision-free (the
  same property `actions/index.ts` has today, now expressed structurally in the grammar).
- **SCSS/Jess prerequisite:** `scss-parser`/`jess-parser` must be OFF the shared
  `LessGrammar`/BuilderHost first (the SCSS-parser rebase work), else fusing the Less
  grammar strands them. This is part of the gate (§4).

---

## 4. The hard gate + BuilderHost-deletion critical path

Fusion **cannot land on the shared grammar while `BuilderHost` still consumes it**: an
ast-v2-specific `node()` build cannot also produce legacy `tree/` nodes. So the critical
path IS `BUILDERHOST-RETIREMENT-DESIGN.md`'s. Restated as the fusion's blockers:

| Blocker | Nature | Clears when | Parallelizable? |
|---|---|---|---|
| **Production render still on tree/ eval** (consumes `parseLessFn().tree`) | The true gate (`memory:eval-load-bearing-post-flip`) | object-reduction spine becomes production render (the CUTOVER) | serial — the spine cutover is the long pole |
| **ast/ import sub-parse** reads legacy `.tree` (`import.ts:182`) | temporary piggyback | re-point `import.ts` to the dispatch-host (retirement **R0**) | YES — independent, do first |
| **less-compat bridge** maps tree/ nodes | external contract, **non-sacred** (owner-released) | bridge re-point to ast/ fields at **R4** | YES — bridge package lane |
| **scss-parser / jess-parser on LessGrammar+BuilderHost** | strands dialects if Less grammar fuses first | SCSS-parser rebase (off `LessGrammar`) | YES — separate parser lane, in flight per memory |
| **prelude / §S-A4 / §3.3 grammar structuring** (`R1`/`R2`/`R3`) | grammar must emit structured leaves the fused builds read | TB-3 / S-A4 / §3.3 land | YES — grammar lanes, gate on ast/ differential |

**Ordered critical path to fusion:**

1. **R0** (parallel-now): re-point `import.ts` off `parseLessFn` onto the dispatch-host.
   Removes the ast/-front-end's last coupling to BuilderHost.
2. **R1–R3** (parallel grammar lanes): land prelude query-split (TB-3), custom-prop-name
   split (S-A4), §3.3 Quoted structuring — each gated on the ast/ differential. These make
   the grammar emit fully-structured leaves so no fused build needs a byte re-scan.
3. **SCSS/Jess rebase** (parallel parser lane): get scss-parser/jess-parser off
   `LessGrammar`/BuilderHost so the Less grammar can become ast-v2-specific without
   stranding them.
4. **Spine cutover** (serial long pole): object-reduction spine becomes production render.
5. **R4**: delete `builders.ts` + `BuilderHost`; re-point the less-compat bridge to ast/
   nodes. **BuilderHost is now gone — the grammar has exactly one consumer.**
6. **FUSION** (this doc): distribute the `actions/*` logic into per-rule `node(type, parser,
   build)` callbacks across the CSS-base + dialect grammars; delete `dispatch-host.ts`'s
   `Map`/`BuildArgs` dispatch and the `actions/index.ts` registry; add the parseman
   `buildReadsRawChildren` gate. Gate on the ast/ differential + byte-identity.

Steps 1–3 and the SCSS lane parallelize; 4 is the long pole; 5 then 6 are serial tail.

---

## 5. Predicted perf (predict-before-building)

Baseline decomposition (memory `immediate-goal-less-alpha-4x-perf` + `ast-v2-perf-profile`):
render ≈ **32.5ms**; parse+build ≈ **65%** (~21ms), grammar ≈ **52%** (~17ms), so
build-attributable ≈ **13%** (~4.2ms). Within PARSE, CST capture ≈ half; per-node trivia
≈ 28.6%, rawChildren ≈ 30.9% (A/B-measured).

Fusion win components (of PARSE time ~21ms):

| Lever | Mechanism | Predicted parse-time reduction |
|---|---|---|
| **Trivia-capture elision** on non-reader rules | per-rule arity `<5` skips per-node `triviaLog`; value leaves are the highest-frequency non-readers | a large fraction of the 28.6% trivia cost — realistically **~15–22%** (leaves + ruleset/at-rule/mixin/guard/etc. dominate node count; comment/selector/variable/value-expr readers keep theirs). Conservative floor ~12%. |
| **rawChildren-capture elision** (needs `buildReadsRawChildren` gate) | rules reading only `span`/`children`-not-raw skip `rawChildren` | a fraction of the 30.9% — **~8–15%** (fewer rules qualify; many builds read children/raw). |
| **Dispatch removal** (Map.get + BuildArgs alloc) | direct positional call, no per-node object | portion of the ~13% build; **~2–4%** of parse. |

**Predicted aggregate: ~20–35% of PARSE time**, i.e. **~4–7ms off the ~32.5ms render**
(render → **~26–28ms**), dominated by trivia+rawChildren capture elision — an order of
magnitude bigger than the ~13% "build dispatch" the task names, because the real prize is
the **CST-capture** the current single-generic-host arity forces onto every node.

**These are PREDICTIONS from the existing A/B profile, not measurements.** Landing must
prove each lever with the controlled method (same-worktree git toggle, warmup, N-median,
byte-identical) per `perf-claims-need-controlled-measurement`. The −21% already banked on
the pure-CSS jess grammar is the empirical anchor for the trivia lever.

---

## 6. Incremental partials — what can land before fusion

### P1 — value-leaf trivia-capture skip via `_parsemanTriviaKinds` (READY, no grammar fork)

**The win, isolated to the ast/ dispatch-host, byte-identity-provable, no BuilderHost
dependency.** parseman's compiled `emitNode` honors a per-node-type trivia mask:
`codegen.ts:2183` installs `_ctx._triviaCaptureMask = _ctx.build._parsemanTriviaKinds(type)`
when the host exposes `_parsemanTriviaKinds`. The `ast/` dispatch-host does **not** implement
it today (grep: no `_parsemanTriviaKinds` in `core/src/ast`), so it captures ALL trivia for
ALL node types.

Implement on `ParseBuildHost`:

```ts
// mask 0 = capture no trivia kinds for this type; undefined = capture all (default)
_parsemanTriviaKinds(type: string): number | undefined {
  return TRIVIA_FREE_TYPES.has(type) ? 0 : undefined;
}
```

`TRIVIA_FREE_TYPES` = the value-leaf types whose actions provably never read `triviaLog`:
`Numeric, Color, NamedColor, Keyword, Quoted, EscapedValue, Url` (verified: `value-leaf.ts`
reads only `children`/`span`; the sole "trivia" hit is a comment about `noTrivia`). These
are the **highest-frequency nodes**, so skipping their per-node trivia capture recovers a
large slice of the 28.6% lever without touching the grammar or BuilderHost.

**Why safe:** the per-node trivia mask affects only THAT node's own `_cstTriviaLog`; a
parent captures whitespace between the leaf and its siblings in the PARENT's scope, and the
global `_triviaLog` diagnostic (run.ts) is unaffected. A leaf that ignores its own trivia
cannot change any parent's structure or the emitted bytes.

**Proof obligations to land (NOT run in this design pass):**
1. Build core + parsers (`lib/`), run the ast/ differential
   (`alpha-oracle-differential.test.ts`) — must stay green.
2. Run the per-family byte-identity suites (`actions/__tests__/*-host-byte-identity.test.ts`)
   — must stay byte-identical.
3. Controlled bench (same-worktree git toggle, warmup, N-median) on benchmark.less — record
   the delta; expect a measurable parse-time reduction concentrated in leaf-heavy input.

**Conservative extension after P1 proves out:** widen `TRIVIA_FREE_TYPES` to the other
non-reader families (`ruleset`, `at-rules`, `mixins-def`, `mixin-call`, `guard`,
`custom-props`, `extend`, `charset`, `control-flow`, `selector-interp`) one family at a
time, each gated on the differential + byte-identity — approaching the full per-rule
elision the fusion delivers, but reached incrementally on the SHARED grammar via the host
mask (which is a per-type property the generic host CAN express, unlike arity).

> This design pass did **not** land P1: the byte-identity + differential + controlled-bench
> gate requires a full workspace build cycle, and landing an unmeasured perf change would
> violate `predict-before-building` / `perf-claims-need-controlled-measurement`. P1 is
> specified ready-to-execute for a measured landing lane.

### P2 — BuildArgs → positional (deferred; marginal)

Convert `BuildAction` from `(args: BuildArgs)` to positional params, dropping the per-node
object allocation in `ParseBuildHost.build`. Byte-identical, isolated to `core/ast/parse-host`,
but touches all 18 action files for a predicted <2% (dispatch is the small remainder of the
~13% build). **Not worth the churn standalone** — it lands for free as part of fusion (§3.1),
where the object disappears entirely. Deferred to fusion.

### P3 — parseman `buildReadsRawChildren` gate (parseman-side, enables §3.3)

Add an arity `>=4` gate for rawChildren capture in `node.ts` / `codegen.ts` mirroring
`buildReadsTrivia`. Inert until per-rule builds exist (a generic host always reads
rawChildren), so it lands WITH fusion, not before. Specified here so the parseman lane can
schedule it.

---

## 7. OPEN(owner)

1. **Factory location (§3.2):** (A) grammar imports `@jesscss/core` directly vs. (B) extract
   a dependency-free `@jesscss/ast-nodes` shared package. Recommend (B) for layering; (A) is
   viable and simpler. Owner call.
2. **P1 landing lane:** who executes the measured P1 landing (+ conservative family
   widening). It is independent of BuilderHost and can start immediately.
3. **Fusion granularity at R4→step 6:** land fusion family-by-family (each `actions/<family>`
   → grammar builds, gated on the differential) vs. one cutover. Recommend family-by-family
   to keep each landing byte-identity-provable, mirroring how the actions were built up.
4. **Dialect delta ownership:** SCSS/Jess deltas carry their own ast-v2 builds (§3.4) — the
   SCSS-parser rebase lane should land its grammar deltas build-ready so fusion is additive.
