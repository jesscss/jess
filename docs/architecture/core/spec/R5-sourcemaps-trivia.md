# R5 — Sourcemaps + trivia + deprecation/warnings (tree2 DESIGN SPEC)

> **Status: DESIGN ONLY — NOT BUILT.** This is the spec section for roadmap rung
> **R5** (`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md` §R5 + arch I.1–I.3).
> It is the **#1 divergence-risk rung**: unlike every rung before it, R5's reference
> (a source-map) is **not observable in the emitted CSS bytes**, so the CSS
> byte-identity ratchet that has guarded rungs R0–R4 **silently passes while the
> feature is wrong**. The spec's whole job is to name those traps and specify a
> second, independent reference.
>
> Branch of record: `experiment/tree2-cleanroom-20260715`. Companion R0 section:
> [`TREE2-DESIGN-SPEC.md` §R0](../TREE2-DESIGN-SPEC.md). Governing plan:
> [`TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md`](../TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md).

---

## 0. Scope

R5 adds three things and one governance mechanism:

1. **Sourcemap attribution** — a v5-correct `.map` that attributes every emitted
   chunk to the **source** node that authored it, across mixin placement,
   selector composition, and interned strings.
2. **Sub-node (delimiter) trivia** — round-trip fidelity for whitespace/comments
   sitting **between** the sub-components of a selector list / declaration value
   (the legacy `fieldSpans`/`valueSpans` domain). This is an **OPEN, MEASURED
   fork**, specified as an A/B decision, not a chosen implementation.
3. **Deprecation + warning emission** on `result.warnings` (v5-native).
4. **A sourcemap-identity ratchet** run alongside the CSS-identity ratchet.

R5 does **not** re-open structural (whole-comment) trivia: block/line comments
authored as body children are already carried STRUCTURALLY as tree2 `Comment`
nodes (`nodes.ts` §Comment) and are byte-identical with **zero** position
tracking (R0 invariant). R5 concerns the trivia that is NOT a body child — the
inter-token gaps — and the *provenance* (source offset) that even structural
comments lack.

---

## 1. What tree2 has today, and why it is insufficient

### 1.1 The coarse `trackPositions` lane

`serialize.ts` has an optional lane (`SerializeOptions.trackPositions`) producing
a `Position[]`:

```ts
export interface Position { node: Node; kind: Kind; start: number; end: number; }
```

Its `start`/`end` are **offsets into the GENERATED output** (`e.off` advances by
`s.length` per `put`), and `node` is the **emitted** tree2 node. It is emitted at
rule / selector-list / declaration / value / at-rule / root granularity
(`flushBlock`, `emitLeaf`, `emitNestedRule`, `emitAtRuleBlock`, `serialize`).

**Three structural facts make this lane, as-is, unable to produce a source map:**

- **A. No source offset anywhere.** A source map maps `generated (line,col) →
  source (file, line, col)`. tree2's `Position` carries only the **generated**
  offset. There is **no source offset on any tree2 node** — `node.ts`'s base
  `Node` owns nothing but `kind`, and the bridge (`tree2-frontend/bridge.ts`)
  *reads* `sourceSpanOf(legacyNode)` at bridge time only to `slice()` the source
  bytes, then **discards the span**. The one datum a source map needs — where in
  the source each node came from — is thrown away at the boundary.
- **B. Generated offset, not line/col.** The legacy pipeline stores
  `_spanStart`/`_spanEnd` as source offsets and derives line/col lazily
  (`print.ts` `offsetToLineCol`, `sourceSegmentFor`). tree2's byte offset is a
  fine internal representation but must be converted the same way — and converted
  on the **source** text for the origin side, on the **generated** text for the
  generated side.
- **C. Rule granularity is coarser than the intended-v5 map.** Less 4.x /
  alpha emit segment boundaries at selector and declaration-name/value
  granularity (a mapping at the start of each selector, each property, each
  value). tree2's lane has roughly that shape already (it pushes a `Position` for
  the selector node and one for the value node) — but this must be **confirmed
  against the intended v5 map granularity** (§10), not assumed from the coarse
  lane's current shape.

**Consequence:** R5 is not "turn the flag on." The coarse lane must be
**re-founded** to (1) carry a **source** provenance offset per emitted chunk and
(2) attribute that offset to the **SOURCE** node, not the emitted/placed node.

### 1.2 What structural-trivia byte-identity does NOT cover

R0–R4 proved CSS byte-identity with trivia carried structurally. That covers
**whole comments that are body children**. It does **not** cover:

- inter-member gaps in a **selector list** — `.a  ,  .b` vs `.a,.b`, and a comment
  *between* selectors: `.a /* x */ , .b`;
- inter-member gaps in a **value** — `1px  solid`, `a: yes /* c */`;
- the **provenance** of any of the above (which source offset each emitted byte
  maps to).

These are exactly the legacy `fieldSpans`/`valueSpans` responsibilities
(`CORE-CLEANUP.md` §"Provenance fields"; memory `span-array-drop-reverted`), and
tree2 has **no** analog. §3 specifies them as a measured fork.

---

## 2. Sub-spec A — Sourcemap attribution

### 2.1 Model

Reuse the legacy *output* contract, which is already v5-shaped and mozilla/
`@jridgewell` compatible (`tree/util/sourcemap.ts` → `GenMapping` → `toEncodedMap`).
The unit is a **segment**:

```ts
// mirrors tree/util/print.ts SourceSegment (0-based)
type SourceSegment = {
  genLine: number; genColumn: number;          // position in the GENERATED css
  source?: string;                             // authoring file path/name
  origLine: number; origColumn: number;        // position in that SOURCE file
};
```

R5's job is to make tree2's emit walk **produce `SourceSegment[]`**, then hand
them to the unchanged `buildSourceMap`. The generated side (`genLine/genColumn`)
is trivially derived from the emit offset via `offsetToLineCol(generatedCss, off)`.
The **origin side is the whole problem** and is what §2.3 specifies.

### 2.2 The source-provenance lane (the required node change)

tree2 nodes must be able to answer **"what source offset did the bytes I am about
to emit come from?"** The bridge already computes this (`sourceSpanOf(legacyNode)`
at `bridge.ts:66`) and drops it. R5 re-captures it, under these constraints:

- **Lean-node thesis is preserved by making it a lane, not a base field.** Do NOT
  add `_spanStart`/`_spanEnd` to the base `Node` (that reintroduces the fat-node
  weight tree2 exists to avoid, and every rung's race op-counts assume the base is
  `kind`-only). Instead: **the bridge stamps a source offset only when a source
  map is requested**, into a bridge-owned side lane. Two candidate carriers,
  decided by the §3 A/B alongside the trivia fork (they share the "sparse cold
  provenance" cost profile):
  - a **`srcStart` (and `srcEnd`) number pair** on the concrete leaf/selector/decl
    node, populated only in map builds (V8 note from `CORE-CLEANUP.md`: two inline
    SMIs, never a `{start,end}` object, never a packed >31-bit number);
  - a **bridge-built `Map<Node, number>`** side table populated only in map builds.
- **The source `file` + `source text` travel on the bridge context**, not per
  node (`bridge.ts` already threads `ctx.source`; extend it with the file
  path). One source text per bridged document (imports carry their own — see
  §2.5).
- **Zero cost when maps are off.** No stamping, no side-table writes, no offset
  math in the fast path — identical to today. This mirrors the legacy
  flag-gated provenance discipline (`F_HAS_VALUESPANS`, memory
  `span-array-drop-reverted`) and R0's "flattened mode is untouched" invariant.

### 2.3 Attribution algorithm — the hard rules

The whole rung turns on **which node a chunk attributes to**. tree2's decisive
architecture — canonical bodies placed in many positions, interned selector
strings, composed selectors — is exactly what makes naive attribution wrong.

**Rule A1 — attribute to the SOURCE node, never the placed/derived node.** When
the emit walk places a shared mixin body (`expandCall` / `expandNestedCall` walk
the def's `body` in place), every declaration it emits is the SAME
`Declaration` object at every call site. That is **correct and desirable** for
source maps: all N generated locations must map back to the ONE authored
`@mixin` body line. Because tree2 never clones the body, the emitted node **is**
the source node — `srcStart(node)` already yields the authoring offset. This is a
tree2 *advantage*: the "attribute to source not derived node" trap (arch I.1)
that the legacy clone-per-placement pipeline has to defend against is **absent by
construction** — provided we read the offset off the shared node and never off a
per-placement wrapper (there is none).

**Rule A2 — the call SITE is a second origin, and v5 must pick one.** A placed
declaration has two defensible origins: the `@mixin` body (where the bytes were
authored) and the call site (where the placement was requested). Less/alpha map
placed mixin content to the **definition** body. R5 attributes to the source
node (A1) = the definition. **Owner-confirm** the intended v5 choice (§10);
whichever is chosen, it must be a deliberate, tested decision, not a fallout of
which node happens to carry the offset.

**Rule A3 — composed selectors attribute at the granularity of the intended
map, and the composition draws from MULTIPLE source nodes.** In flattened mode
`composeOne('.a', '&:hover') → '.a:hover'` fuses bytes from the **parent** rule's
selector node and the **child** rule's selector node into one emitted string.
tree2 today pushes ONE `Position` for `rule.selector` (the child). Two policies,
**owner-confirm which is v5**:
  - **selector-granular (Less 4.x-parity, likely default):** one segment per
    emitted complex selector, attributed to the **child** selector node's source
    offset (the innermost authored selector). Coarse but matches Less.
  - **sub-selector-granular:** a segment at the `.a` bytes → parent origin, a
    segment at the `:hover` bytes → child origin. Finer; only if alpha emits it.
  In **nested mode** (R0, the v5 default) there is **no composition** — each rule
  emits its own local selector (`ownStrings`), so each selector maps cleanly to
  its own source node. Nested mode is therefore the *easier* attribution case and
  the one that actually ships; flattened-mode composition attribution is only
  needed for `collapseNesting:true` consumers.

**Rule A4 — interned / canonical strings LOSE source identity; the segment must
key on the NODE, not the string.** `Compound.canonical()` / `Complex.canonical()`
memoize a canonical string on the node, and the model shares one canonical body
string across many positions. **Two selectors `.a` authored on different source
lines produce the same canonical string.** If attribution ever keys on the string
(e.g. an intern table `Map<string, origin>`), it collapses distinct source
origins into one — a silent sourcemap corruption invisible to CSS byte-identity.
**Invariant:** attribution keys on the **emitting node instance** (which is
1:1 with an authored source location, even when its *string* is shared), never on
the canonical string value. The canonical-string interning is a byte/perf
optimization and must stay **orthogonal** to provenance.

**Rule A5 — a shared leaf emitted in a NEW position must NOT re-emit its authored
trivia (arch I.2).** Structural comments inside a mixin body ARE re-emitted per
placement (that is correct — the body including its comments is placed each time).
The trap is **inter-token/leading trivia that belongs to the ORIGINAL authored
position, not to the placement**: e.g. a value leaf whose authored form had a
leading comment tied to its *source* slot must not drag that source-gap trivia
into a different placement context where the surrounding gaps differ. Because
tree2 emits **canonical** bytes (it reconstructs `name: value;` with fixed
spacing, `flushBlock`/`emitLeaf`), it does NOT today replay authored inter-token
whitespace at all — so this trap is currently *dormant*. It **activates the
moment §3 adds sub-node trivia replay**: the trivia backend must resolve gaps
against the **authoring** source span of the node, and a placed/shared node must
either (a) replay the trivia of its single authored origin consistently in every
placement, or (b) suppress it in placements — **owner-confirm** which is v5, and
guard it with a placement-with-comments fixture (this is the exact class of bug
that broke `comments`/`comments2` in the legacy flat-drop, memory
`span-array-drop-reverted`).

### 2.4 Emit-walk integration

The `put(e, s)` primitive is the single choke point (every byte flows through it).
R5 threads a **current-origin** onto the `Emit` struct (the source offset of the
node currently being emitted), pushed/popped as the walk enters/leaves a node,
exactly as the legacy `sourceSegmentFor(origin, …)` reads the "current origin".
At each `put` that begins a mappable token (selector start, property start, value
start), if maps are on, record a `SourceSegment { gen = offsetToLineCol(out,
e.off), origin = current node's srcStart }`. This is a **strict superset of the
existing `Position` pushes** — the same call sites (`flushBlock`, `emitLeaf`,
`emitNestedLeaf`, `emitNestedRule`, `emitAtRuleBlock`) that already push
`Position` gain an origin offset. No new walk; the coarse lane is *upgraded*, not
replaced.

### 2.5 Imports and multi-source (arch G3)

`import-bridge.ts` inlines imported statements. Each imported node's source offset
is relative to **its own file**, and its segment's `source` must be that file's
path with its own `sourcesContent`. R5 must carry a **per-node source-file
identity** (not just an offset) through the import inline — the bridge context is
per-file, so the stamped provenance must record `(file, offset)`, or the side
lane must be keyed such that an inlined node resolves to its origin file.
`buildSourceMap` already handles multiple `source` values + `setSourceContent`
per source. **Owner-confirm** whether v5 emits `sourcesContent`.

### 2.6 Invariants (sourcemap)

1. **Source, not placed.** Every segment's origin is the authored source node's
   offset; a placed mixin body maps all its generated locations to the one
   definition-body origin (never to a per-placement derived node — there is none).
2. **Node-keyed, not string-keyed.** Provenance is keyed on node instance;
   canonical-string interning never participates in attribution.
3. **Zero cost when off.** Maps off ⇒ no stamping, no segment array, byte output
   and race op-counts identical to R0–R4.
4. **Boundary held.** No `tree2/` file imports `../tree`; the source-file
   identity + offset are captured at the bridge (`tree2-frontend`), stamped into a
   tree2-owned lane the serializer reads without knowing legacy provenance.
5. **Generated side derived, never stored per node** — `offsetToLineCol` over the
   final generated buffer (or incrementally as chunks flush).

---

## 3. Sub-spec B — Sub-node (delimiter) trivia: the MEASURED fork

### 3.1 The problem interned strings do NOT solve

A frequent misread (called out explicitly in the model context and
`CORE-CLEANUP.md` Q-32 / §"Provenance fields"): *"tree2 interns canonical
strings, so trivia is handled."* **It is not.** Interned/canonical strings encode
the *content* of a selector/value; they say nothing about the **whitespace and
comments in the gaps between sub-components**, and by construction they *discard*
authored spacing (that is why they are canonical). Two source forms `.a .b /*x*/
.c` and `.a /*x*/ .b .c` intern to the **same** canonical selector string. To
place `/*x*/` in the right gap on round-trip you need the **per-member boundary
offsets** — precisely the `fieldSpans`/`valueSpans` data. The interned string is
orthogonal to and cannot recover this.

This is the same **lost-gap-attribution** bug that reverted the legacy flat-drop
(`468747cc7` → `311cf9232`, memory `span-array-drop-reverted`): once per-member
boundaries are gone, a whole-node comment scan knows a comment's absolute offset
but **not which gap it belongs to**, and mis-places it. tree2 starts with *no*
per-member boundaries at all, so the trap is present from byte one the moment
sub-node trivia replay is attempted.

### 3.2 Does tree2 even need sub-node trivia replay?

**Owner-confirm, and this gates the whole sub-spec.** tree2 emits **canonical**
CSS (fixed `: ` after property, fixed `,\n` between selectors, single spaces in
spaced values). If the intended v5 output is **canonical** (does not preserve
authored inter-token whitespace/comments), then §3 collapses to *nothing to
build* for whitespace, and only **inter-member comments** (`.a /*x*/, .b`,
`a: yes /* c */`) need replay — a much smaller surface. The legacy pipeline
preserves these inter-member comments (the `comments`/`comments2` fixtures). So
the realistic R5 target is: **canonical whitespace + faithful inter-member
comments**, NOT full authored-whitespace round-trip. Confirm this scope with the
owner before building; it determines whether the fork below is needed at all or
only for the comment-bearing sparse case.

### 3.3 The three-way fork (decide by same-worktree A/B MEASUREMENT)

If §3.2 confirms inter-member comment fidelity is required, the backend is an
**OPEN owner fork** (perf #9; `CORE-CLEANUP.md` Q-32). **Perf is the reference — the
"never a WeakMap" standing rule does NOT decide this** (it was validated on
hot/universal provenance; this data is sparse/cold). The three candidates,
translated to tree2:

1. **Per-slot boundary lane (tree2 analog of the current `fieldSpans`/
   `valueSpans` side table).** The bridge stamps per-member `[start,end]` offset
   arrays onto `SelectorList` / `SpacedValue` / declaration value nodes, **only
   when the node's source span may contain a comment** (`spanMayContainComment`
   gate, `builders.ts` — comment-free containers pay nothing). Serialize-time,
   emit each member then the source-gap trivia between `member[i].end` and
   `member[i+1].start`. **Correct today in the legacy pipeline.** Cost: packed
   SMI array + lookup on comment-bearing containers only.
2. **Unified node-keyed side table.** Fuse per-slot boundaries + the trivia map
   into ONE `Map<Node, …>` (or lane) so a single lookup yields both boundaries and
   the comments to place. Restores per-gap attribution; still a side table but a
   tidier single exception.
3. **Serialize-time boundary recovery, gated on a cheap node-level "any comment in
   my span?" bit.** Store NOTHING per member. Only for the sparse comment-bearing
   nodes, recover member boundaries at emit time from the source slice / Parséman
   CST, and map comment-offset → gap. Kills the side table **without** per-member
   node weight; affordable *because* comment-bearing nodes are sparse.

**Decision protocol (mandatory, same as R0's byte-identity discipline):**
same worktree, toggle each candidate via git revert/cherry-pick (never A/B two
worktree dirs — memory `cross-worktree-bench-bias`); warmup + N-median of
**parse + total**; **byte-identical** normal render on the full corpus; and the
tree2 analog of `comments`/`comments2` **green**. Whatever measures best wins,
*including keeping the side table* if recovery's re-scan costs more than the map
it removes. **Do NOT pre-commit to option 3 on cleanliness grounds** — it is the
revert-trap candidate; it wins only if it measures best AND keeps the comment
fixtures green. Fold this A/B into the same parse-side measurement pass as the
§2.2 source-offset carrier decision (they share the sparse-cold cost profile and
should be decided together).

### 3.4 The `hasComment` honesty note (carry forward)

The gate primitive is really `hasNonWhitespace`, not `hasComment`
(`CORE-CLEANUP.md`: `makeTrivia` computes "any non-whitespace char in the run").
Parséman already carries labeled trivia KINDS; the jess-side `buildLazyTriviaMap`
discards them and re-derives the lossy bit. For tree2, the trivia source is the
same `opts.trivia` `TriviaMap`; R5 should prefer carrying Parséman's real trivia
kinds through (distinguishing `//` line vs `/* */` block, which matters for
inline-safety of placement) rather than re-deriving the lossy boolean.

### 3.5 Invariants (trivia)

1. **Structural comments unchanged.** Body-child `Comment` nodes remain carried
   structurally, byte-identical, zero-position (R0). §3 touches only inter-member
   gaps.
2. **Node-instance gap attribution.** A comment maps to a specific
   `(node, gapIndex)`, never inferred by source-order cursor over a flat scan
   (the reverted flat-drop mechanism — do NOT re-attempt).
3. **Interning stays orthogonal.** Canonical-string sharing must not be consulted
   for gap placement.
4. **Sparse + gated.** Comment-free containers pay nothing.
5. **Placement consistency (arch I.2 / Rule A5).** A shared/placed node replays
   its authored-origin gap trivia consistently (or suppresses it) per the
   owner-confirmed v5 rule; guarded by a placement-with-inter-member-comment
   fixture.

---

## 4. Sub-spec C — Deprecation + warnings on `result.warnings`

### 4.1 Model

The warnings infrastructure already exists and is v5-shaped
(`core/warnings.ts`: `WarningsConfig`, `resolveWarningsConfig`, per-code dedup/cap/
summary; `core/jess-error.ts`: `WarningDiagnostic { code, phase, message, reason,
fix, line, column }`; `core/deprecation.ts`: the `Deprecation.values` registry
with kebab ids like `mixin-call-no-parens`, `less-plugin`, `variable-in-at-rule-
prelude`). The `deprecation/<id>` code convention and `fatalDeprecations`/
`futureDeprecations` legacy mapping are already implemented in
`resolveWarningsConfig`. R5 does not build this machinery; it **wires tree2's
resolve/emit walk to raise into it** and surfaces the result on `result.warnings`.

### 4.2 Algorithm

- **A diagnostic sink threads through the walk**, analogous to the value-service
  seam: an injected `warn(diag: WarningDiagnostic)` on `SerializeOptions` (or the
  frontend `Compiler.render`), boundary-clean (tree2 raises structured
  diagnostics; the frontend owns the `WarningsConfig` dedup/cap/fatal processor).
  tree2 must NOT import the legacy warnings processor into `tree2/`; it emits
  plain `WarningDiagnostic` objects into an injected sink.
- **Location comes from the SAME provenance lane as §2** — a warning's
  `line/column` is `offsetToLineCol(sourceText, srcStart(node))`. This is why R5
  bundles warnings with sourcemaps: both need the source-offset lane. A warning
  with no location renders as a message-only one-liner (`warnings.ts` display
  ladder).
- **Which deprecations fire in v5.** Per memory `deprecation-emission-not-wired-v5`
  the infra exists but only parentless-ampersand / extend fire today. R5's tree2
  emit walk fires the registered deprecations as their shapes are recognized
  (e.g. `mixin-call-no-parens` at a paren-less mixin call, `less-plugin` at
  `@plugin`). Do NOT invent new deprecation ids; use `Deprecation.values`.
  **Owner-confirm the exact set that must fire in the v5 alpha** (§10).
- **Fatal + future.** `resolveWarningsConfig` already maps `fatalDeprecations` →
  `deprecation/<id>` in `fatal[]`; a fatal-matched diagnostic is thrown as a
  compile error (this intersects the error-reporting mode, memory
  `error-reporting-design`: "1 error & stop" is the compiler MODE, not a limit).

### 4.3 Invariants (warnings)

1. `result.warnings` is populated from the injected sink after render; shape =
   the existing processed `WarningDiagnostic[]` (dedup/cap/summary applied by the
   frontend processor, unchanged).
2. tree2 raises structured diagnostics only; no display/dedup logic inside
   `tree2/` (boundary).
3. Warning locations use the §2 source lane; no second provenance mechanism.
4. Silencing/fatal/future honored via the existing `resolveWarningsConfig`.

---

## 5. The sourcemap-identity ratchet (the point of the rung)

### 5.1 Why a second ratchet is mandatory

**CSS byte-identity does NOT imply sourcemap correctness.** The generated CSS can
be byte-for-byte perfect while every mapping points at the wrong source line —
because the mappings live in a *separate* `.map` artifact that the CSS ratchet
never inspects. Concretely, all of these pass the CSS ratchet while corrupting the
map:

- attributing a placed mixin declaration to the call site instead of the def
  (Rule A2);
- collapsing two same-string selectors' origins via a string-keyed intern table
  (Rule A4);
- off-by-one origin line after an inlined import (§2.5);
- a comment placed in the wrong gap (§3, the reverted-flat-drop bug) — this one
  *can* change bytes, but the whitespace-only variants do not.

So R5 introduces a **sourcemap-identity ratchet** that runs independently of and
alongside the CSS-identity ratchet, on the same corpus.

### 5.2 Reference

**The intended v5 sourcemap.** The proxy (as with CSS) is the REAL evaluating
pipeline rendered **with source maps on** (`oracle.ts` gains a
`renderRealOracleMap` that returns `{ css, map }` from the function-evaluating
pipeline with `trackPositions`/sourcemap enabled, mirroring `renderRealOracle`).
The legacy render is a valid proxy for intended-v5 **only where it agrees with the
owner expected outputs** — and for maps this proxy is **weaker** than for CSS, because the
legacy map itself is not owner-audited. Therefore:

- **primary ratchet:** decoded-mapping equality between tree2's map and the
  legacy pipeline's map, per fixture;
- **owner-audited anchors:** a small curated set of fixtures where the owner has
  confirmed the *intended* v5 mapping (esp. the divergence cases: mixin
  placement, composed selectors, imports) — these anchor the proxy where the
  legacy map may itself be wrong or coarser than intended.

### 5.3 Ratchet mechanism

- **Decode, don't string-compare.** Compare the **decoded** mapping list (via
  `@jridgewell/trace-mapping` or by decoding both `GenMapping`s), NOT the encoded
  VLQ string — two correct maps can differ in encoding (segment ordering, redundant
  segments). Assert: for each generated position sampled at segment starts, the
  resolved `(source, origLine, origColumn)` matches.
- **Positive, node-level assertions for the traps.** Because the proxy is weak,
  add explicit unit assertions that encode the Rules: a two-call mixin fixture
  asserts **both** generated locations resolve to the **same** def-body source
  line (A1/A2); a two-`.a` fixture asserts the two emitted `.a`s resolve to
  **different** source lines (A4, the interning trap); an import fixture asserts
  origin `source` = the imported file (§2.5).
- **Gate parity.** The ratchet runs in the same harness as the CSS byte-identity
  + boundary-guard + `composeStats` op-count ratchets (arch H). A negative move is
  triaged STALE-vs-REGRESSION exactly like the jess ratchet
  (memory `feedback-gate-on-jess-ratchet-too`).

---

## 6. Correctness traps (consolidated)

| # | Trap | Silent under CSS-identity? | Guard |
|---|---|---|---|
| T1 | Placed mixin decl attributed to call site, not def body | **Yes** | A1/A2; two-call same-origin assertion (§5.3) |
| T2 | String-keyed attribution collapses two same-string selectors' origins | **Yes** | A4; two-`.a` different-origin assertion |
| T3 | Composed selector `.a:hover` attributed to only one of its two source nodes at wrong granularity | **Yes** | A3; owner-confirm granularity |
| T4 | Shared/placed leaf re-emits authored inter-member trivia into a mismatched gap | Partly (comment variants change bytes; ws variants don't) | A5 / §3.5; placement-with-comment fixture |
| T5 | Interned string assumed to "handle trivia"; per-member boundaries lost → comment in wrong gap | Comment cases: no (bytes change) | §3.1/§3.3; `comments`/`comments2` analog green |
| T6 | Import origin off-by-one / wrong source file after inline | **Yes** | §2.5; import-origin assertion |
| T7 | Coarse rule-granularity map when intended v5 is finer (or vice-versa) | **Yes** | Owner-confirm granularity (§10); anchor fixtures |
| T8 | `hasComment` lossy bit mislabels `//` vs `/* */`, wrong inline-safety on placement | Possibly (bytes) | §3.4; carry Parséman kinds |
| T9 | Sourcemap lane adds cost when maps are OFF (regresses the R0–R4 perf thesis) | N/A (perf) | Invariant §2.6.3; race op-counts unchanged |

The load-bearing observation: **six of nine traps are invisible to the CSS
byte-reference.** That is the entire justification for R5 being its own rung with its
own ratchet, sequenced late (after the CSS-shaping rungs R0–R4 are stable) but
never skipped.

---

## 7. Where current tree2 must change (files the R5 BUILD will touch)

- **`packages/core/src/tree2/serialize.ts`** — upgrade the coarse `Position` lane
  to carry a per-chunk **source origin**; thread a current-origin on `Emit`;
  emit `SourceSegment[]` (or feed a segment sink); add the warning sink call
  sites. All additive/gated — the maps-off fast path stays byte- and op-identical.
- **`packages/core/src/tree2/node.ts` / `nodes.ts`** — IF the §2.2 A/B picks the
  inline-field carrier, add `srcStart`/`srcEnd` (two SMIs) to the concrete
  leaf/selector/decl/at-rule nodes, populated only in map builds. If it picks the
  side-table carrier, no node change. Base `Node` stays `kind`-only either way.
- **`packages/core/src/tree2-frontend/bridge.ts`** — stop discarding
  `sourceSpanOf(node)`; stamp `(file, srcStart)` into the chosen carrier when
  maps/warnings are requested. Thread the source **file path** on `BridgeCtx`
  (currently only `ctx.source` text).
- **`packages/core/src/tree2-frontend/import-bridge.ts`** — carry per-file source
  identity through inline so imported nodes attribute to their own file + content.
- **`packages/core/src/tree2-frontend/oracle.ts`** — add `renderRealOracleMap`
  (`{ css, map }`, maps on) as the sourcemap-identity proxy reference.
- **New `packages/core/src/tree2/sourcemap.ts`** (or reuse the frontend) — a
  boundary-clean segment→map builder, OR feed segments to the existing
  `tree/util/sourcemap.ts` `buildSourceMap` from the **frontend** (keeping
  `@jridgewell` out of `tree2/`; the encoder can live outside the boundary).
- **`packages/core/src/warnings.ts` / `deprecation.ts`** — unchanged; consumed by
  the frontend processor. tree2 emits `WarningDiagnostic` into an injected sink.
- **New tests** — `sourcemap-identity.test.ts` (decoded-mapping ratchet +
  trap-specific node-level assertions), `trivia-comment.test.ts` (the
  `comments`/`comments2` analog), `warnings.test.ts` (deprecations fire →
  `result.warnings`).
- **The §3 fork** additionally touches the trivia carrier (per-slot lane vs
  unified vs serialize-time recovery) and the `spanMayContainComment` gate — the
  A/B decides the exact surface.

---

## 8. Open owner-confirm items

1. **Sourcemap granularity (T3/T7).** Selector-granular (Less-parity) vs
   sub-selector-granular; property/value granularity. Source from the alpha map,
   do not assume from the coarse lane.
2. **Placed-mixin origin (A2/T1).** Confirm placed content maps to the definition
   body (assumed) vs the call site.
3. **Authored-whitespace scope (§3.2).** Confirm v5 output is canonical
   whitespace + faithful inter-member **comments** (assumed), NOT full authored
   inter-token whitespace round-trip. This decides whether the §3 fork is needed
   at all or only for the sparse comment case.
4. **`sourcesContent` emission (§2.5).** Does the v5 map embed source content?
5. **Which deprecations fire in v5 alpha (§4.2).** The exact subset of
   `Deprecation.values` the tree2 walk must emit (memory
   `deprecation-emission-not-wired-v5`).
6. **Placement trivia rule (A5).** Replay-consistently vs suppress-in-placement
   for a shared node's authored inter-member trivia.
7. **The §3 backend A/B (perf #9).** Owner selects the exact A/B protocol and
   accepts the serializer risk before a production worker starts (per
   `CORE-CLEANUP.md` Q-32 "TRANSFERRED TO OWNER-JUDGMENT").

---

## 9. Reference policy (R5)

- **CSS-identity is necessary but NOT sufficient.** It gates the *bytes*; it is
  blind to the map. R5 is complete only when **both** the CSS-identity ratchet
  and the **sourcemap-identity ratchet** (§5) are green across the corpus.
- **Sourcemap reference = intended v5 map.** Proxy = the real evaluating pipeline
  with maps on, valid only where it agrees with owner-audited anchor fixtures.
  The proxy is *weaker* for maps than for CSS (the legacy map is not owner-audited)
  — hence the explicit trap-encoding node-level assertions (§5.3) that hold
  regardless of the proxy.
- **Trivia reference = the `comments`/`comments2` fixtures** (their tree2 analog),
  plus byte-identity on the full corpus; perf decides the backend, correctness
  (comment fidelity) is a hard gate that outranks the slim/perf win (memory
  `span-array-drop-reverted`).
- **Warnings reference = intended v5 `result.warnings`** — the owner-confirmed set
  of firing deprecations, shape per the existing processor.
- When a tree2 map/warning diverges from Less/Sass, mark it **"needs owner
  confirmation of intended v5"** — not a bug (roadmap §4 reference stance).
