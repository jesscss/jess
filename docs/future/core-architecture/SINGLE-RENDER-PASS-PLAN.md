# Single-Render-Pass Plan — the deep rework that reaches C4

**Status:** DESIGN (read-only analysis). This is the executable slice plan for the deep
"single-render-pass" rework — the ONLY remaining blocker to deleting `propagateFlagsFrom` +
`F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD` (the flag-walk goal's endpoint, **C4**).

**Read first (do not re-derive — build on):**
- `FLAG-WALK-DELETION.md` — Phase A/B DONE; Phase D slices 1/3/4/D2 DONE; STEP-0 RESULT (deep
  value-tree copies already ZERO; root blocker = `adopt`→`setParent` reparent, `node-base.ts:689`,
  gated `if(!node.frozen)`); the class-2 reuse-gate verdict (c) BLOCKED with the FIVE reader
  populations; the CPU-profile reprioritization (Phase-D surface is **<1% self-time**).
- `../../../packages/core/perf/INHERIT_MUTATION_DESIGN.md` — the inherit investigation: threading
  `inherit`'s span+flag stamps off-node is REJECTED (per-output-node identity read at serialize off
  `this`; extend needs different flags per placement of the same shared source; relocating rebuilds
  more than it removes). Per-mutation table (`inherit`, `node-base.ts:1390`): rows 1/3/4/10/11/12
  already non-mutating on a shared node (`!frozen`-guarded parent + `??=` write-once); the
  irreducible in-place writes on a shared node are **rows 2 + 5–9** (source span + `F_VISIBLE`
  clear + `F_IMPLICIT_AMPERSAND`/`F_EXTENDED`/`F_EXTEND_TARGET`/`F_GENERATED`).

**This plan does NOT re-open those verdicts.** It asks the one question they left open: does doing
sub-problem A (non-mutating placement / provenance record) **together with** sub-problem B
(fold eval into the render walk / dynamic-leaf-share), *as the coupled enabler for C4*, change the
cost/benefit that killed each in isolation — and if so, how is it staged so every slice is
independently byte-identical-gated.

---

## 0. Where we are (the DAG's starting node)

Landed and banked on `dev`:
- **Phase A complete** — `F_MAY_ASYNC` deleted (reactive), `F_AMPERSAND` re-scoped to the selector
  subtree, 4 provably-pure leaf `F_STATIC` skips deleted. `propagateFlagsFrom` (`node-base.ts:704`)
  now bubbles ONLY `F_STATIC`/`F_NON_STATIC` + `F_HAS_NODE_CHILD`.
- **Phase B complete** — B0/B1 (operation operands share, no clone), B2-pre + B2 (selector
  placement shares child selectors via `PlacementCloneOptions.shareChildren` freeze-share seam,
  `node-base.ts:1210/1225`), B4 (collapse-survivor) + extend materialization = the surviving
  mutate-after-copy clones, LEFT (genuine per-output-node copies).
- **Phase D partial** — Slice 1 (`AtRule.frames` → walk), Slice 3 (root at-rule hoist stamp →
  walk), Slice 4 (composition **already** on the serialize walk; dead `_composedSelector` slot
  removed), **D2** (render-direct fast-path `static-rules.ts` DELETED — class-4 `F_STATIC` consumer
  gone), and **D3 already substantially done**: `Rules.render` (`rules.ts:4757`) drives a single
  entry — the old separate pre-eval pass is gone, replaced by the `preSerializeRoot` hook
  (`rules.ts:4764`) that runs post-eval/pre-render plugin visitors on the just-evaluated tree.

**Critical correction to the brief's framing of D3.** The compiler eval-then-render *split* is
NOT two top-level passes any more. `render()` calls `evalForRender()` (`rules.ts:4723`) → which
calls `this.eval(context)` → then `serialize(state)` on the resulting `state.output`. So "fold eval
into render" is NOT "collapse two compiler passes" (already done). It is the deeper thing:
**eval still produces a materialized output tree that serialize then walks a second time.** Two
tree walks, one entry. Sub-problem B is about collapsing *those two walks* so a dynamic leaf need
not be copied into the output tree — it stays shared in the source tree and is looked up per-frame
as serialize descends. That is the multi-week piece.

### The five reader populations gating C4 (from the class-2 verdict, re-confirmed against dev)

| # | population | reads | retire mechanism | needs deep rework? |
|---|---|---|---|---|
| 1 | class-2 reuse gates: `canReuseAsLeaf` (`node-base.ts:1171`), `canReuseLeaf` (`util/cloning.ts:12`), `canReuseStaticScalarLeaf` (`util/callable-binding.ts:5`) | `!F_NON_STATIC` **and** `!F_HAS_NODE_CHILD` (both bubbled) | dynamic-leaf-share (B) makes copy unnecessary | **YES** (B) |
| 2 | container static short-circuits in `evalNode`/`resolve`/`render` — verified ~14 checks / 8 files: `sequence.ts:360/459`, `list.ts:303/383`, `at-rule.ts:842/1755`, `at-rule-statement.ts:76/134`, `query-condition.ts:301/424`, `selector-capture.ts:88`, `declaration.ts:421/1474/2012`, `rules.ts:6956` (+ selector/value branches `:5540/5656/5661`) | `this.hasFlag(F_STATIC)` — bubbled (these types set NO ctor F_STATIC) | reactive fall-through byte-identical + render fast-paths relocated | **YES** (A+B) |
| 3 | name/selector predicate: `_isStatic`/`_hasStaticName` (`rules.ts:5538/5617`) + selector branch `rules.ts:5656` | mostly **leaf-local name-node** F_STATIC; ONLY `:5656` (Interpolated/Ampersand selector) reads the **bubbled** selector flag | construction-time `isInterpolated`/`nameIsStatic` predicate on name/selector types (A2 pattern) | **NO** — landable now |
| 4 | callable-guard static: `callable-guard.ts:87/123/172/204`, `callable-candidate-execution.ts:72` | `guard.hasFlag(F_STATIC)` on the guard **expression** node — **bubbled** | guard-local property computed at guard construction | **NO** — landable now |
| 5 | type-guards: `scope-frame.ts:491`, `reference.ts:194` (name-node, leaf-local), `reference.ts:2577` (general value node, bubbled) | `hasFlag(F_STATIC)` | value type test (`instanceof`/`isInterpolated`); `:2577` is closer to class-2 (gates return-value sharing) | **MOSTLY** — `:491`/`:194` now; `:2577` with (1) |

`F_HAS_NODE_CHILD`'s only readers are the three class-2 gates → it deletes precisely WITH population 1.

---

## 1. The dependency DAG (today → C4)

```
                 [DONE: A1 A2 A3 | B0 B1 B2pre B2 | D-slice1 D-slice3 D-slice4 D2 | D3-hook]
                                          │
        ┌─────────────────────────────────┼───────────────────────────────────┐
        │ INDEPENDENT READER-RETIREMENTS   │  SUB-PROBLEM A (provenance record)  │  SUB-PROBLEM B
        │ (land now, disjoint, code-health)│  (non-mutating placement)           │  (eval→render fold)
        │                                  │                                     │
        │ R3 name/selector predicate ──────┼── (unblocks rules.ts:5656)          │
        │ R4 callable-guard-local ─────────┤                                     │
        │ R5a type-guard value-checks ─────┘                                     │
        │    (scope-frame:491, reference:194)                                    │
        │                                                                        │
        │                          A0  provenance-record spike ────┐            │
        │                          A1s collapse-survivor fresh-shell│  (I2)      │
        │                          A2s per-output provenance rec  ──┤            │
        │                              on serialize walk           │            │
        │                                                          ▼            ▼
        │                                            B1s frame carries structural/registration state
        │                                            B2s serialize descends source tree (not output tree)
        │                                            B3s dynamic leaf looked up per-frame, not copied
        │                                                          │
        └──────────────────────────────────────┬──────────────────┘
                                                ▼
                        C1  delete class-2 reuse gates + clone-to-freeze machinery
                        C2  delete F_HAS_NODE_CHILD (residual → value check)
                        C-cont  delete container static short-circuits (population 2)
                        R5b  reference.ts:2577 → value check (falls with C1)
                                                │
                                                ▼
                        C4  delete F_STATIC / F_NON_STATIC / F_CHILD_DERIVED / propagateFlagsFrom
```

**Edges that matter:**
- R3/R4/R5a have **no edge** to A or B — they are pure construction-time re-expressions of
  bubbled/leaf reads and land now (see §5). They shrink the reader set but do NOT reach C4.
- Sub-problem A (provenance) and sub-problem B (eval-fold) are **the coupled pair**. B is what makes
  a dynamic leaf shareable at render; A is what lets a *shared* placed node carry per-output
  provenance without being copied. Neither alone deletes population 1 or 2. C4 needs both.
- The B4/extend copies (`selector-complex.ts:367`, `copySelectorForExtend` family) are **intrinsic
  per-output-node copies** and stay through C4 (they model a genuine second output; see §6). They
  are NOT class-2 and do not block flag deletion.

---

## 2. Sub-problem A — placement must never MUTATE a shared node

### 2.1 What forces the surviving copies (grounded)

`inherit` (`node-base.ts:1390`) writes, on a shared receiver, the irreducible set (INHERIT doc §1):
source span (`node-base.ts:1399`, unconditional), `F_VISIBLE` clear (`:1415`),
`F_IMPLICIT_AMPERSAND`/`F_EXTENDED`/`F_EXTEND_TARGET` (`:1420-1427`), `F_GENERATED` OR (`:1432`).
`frozen` guards the parent reparent (`:1394`) but NOT this span/flag block. Two shared-receiver
sites remain: collapse-survivor `selector-complex.ts:367` (`only.inherit(this)`) and extend
materialization (`copySelectorForExtend(...).inherit(el)`). The INHERIT investigation already
verified the extend receiver is a **fresh** `cloneForPlacement` shell (shared frozen children) — so
extend is NOT a shared-node-mutation hazard; only collapse-survivor is.

### 2.2 The provenance-record design (does A+B change the isolation verdict?)

The inherit investigation REJECTED threading span+flags off-node **in isolation** because: (a) span
is read at serialize time off `this` via `writer.add(text, this)` in ~35 serializers →
`OutputWriter.markSource` → `sourceSegmentFor(origin)` → `spanStartOf(origin)`
(`util/print.ts`), with **no frame on the serialize path**; and (b) extend needs the same shared
source to carry DIFFERENT flags per placement. A per-output-node record read at print time "IS a
node under another name" — you re-created the copy.

**Does coupling with B rescue it?** Partially, and only for a NARROW record — this is the new
finding this plan contributes:

- The rejection assumed the record must be threaded to **every** `writer.add(text, this)` call in
  ~35 serializers. That is true only if the record carries the **span** (row 2). But once B lands
  (§3), serialize descends the **source** tree, so a leaf's span is ALREADY its authored span read
  off the source node — no relocation needed. The span mutation exists today ONLY because eval
  produces a *derived output node* that must carry the source node's span back. Under B, there is no
  derived output node for the shared leaf → **row 2 evaporates for the shared-leaf case** rather
  than being relocated. This is the coupling the isolation analysis could not see.
- What remains per-output-position is the **flag** subset (rows 5–9): visibility + extend/generated
  provenance. These are read at far fewer sites than span (the extend/reference-mode output filter
  in `serialize-helper.ts`, `ruleset.ts`, `selector-list.ts`; `:is()` unwrap for `F_GENERATED`;
  visibility gating ~10 files). A **narrow provenance record keyed by (walk position, source node)**
  carrying just `{visible, extended, extendTarget, generated, implicitAmpersand}` — written when the
  walk enters a placed position, read at those filter sites — is materially smaller than the ~35-way
  span plumbing that made isolation lose. The number of read-sites for the flag subset is the crux;
  the enumeration agent's serializer count (see §7) confirms span dominates the ~35, flags are the
  minority.

**So the coupled calculus differs from isolation:** with B removing the span half, the residual
A-work is a **flag-only, position-keyed provenance record at the ~10 extend/visibility filter
sites** — not a per-node span shadow through 35 serializers. That is plausibly worth it *as the
enabler for C4*, where isolation (span+flags, no B) was not. **This remains the riskiest claim in
the plan (see §8) — it is a design hypothesis, not a measured result; A0 spike must prove it before
committing A2s.**

### 2.3 First executable slice for A + its gate

**Slice A0 — provenance-record spike (READ-ONLY / throwaway branch, no merge).** Instrument (behind
a dev-only flag, reverted before any real slice) the serialize walk to build the flag-only
position-keyed record for the extend/visibility filter sites, and assert it reproduces the exact
`hasFlag` answers those sites read off `this` today, across the collapse + dynamic + all-extend
fixtures. **Gate:** the recorded flags match the on-node flags at every filter read (instrumented
equality assertion), on `collapse-bench` + `dynamic-bench` + all 23 extend fixtures. **Purpose:**
prove §2.2's hypothesis (flag subset is position-derivable at ~10 sites) BEFORE building A2s. If A0
shows a flag whose value genuinely differs per-placement of the same shared node in a way position
cannot key (the extend-registry-reuse case), that flag stays on an intrinsic copy and A shrinks to
"visibility + generated only" — still progress, but re-scope C1 accordingly.

**A0 RESULT — VERDICT: HYPOTHESIS HOLDS. GO for A2s.** (spike done, throwaway instrumentation reverted,
tree clean, output-neutral: all-less 90/3 with A0 on/off.) Measured across 10 workloads (collapse both
modes, dynamic, all 7 extend fixtures) via an `A0_SPIKE`-gated recorder hooked at `Node.visible`/
`.generated`/`.hasFlag` inside the serialize walk:
- **Residual is flag-only** — span is read off `this` at ~40 `writer.add` sites (`print.ts:200`→`spanStartOf`)
  on a frameless path, exactly what B's source-tree descent removes; the serialize *flag* reads are a
  distinct **~20-site / 3-file cluster** (`serialize-helper.ts` visibility gating; `ruleset.ts`/
  `selector-list.ts` extend/reference filtering) — the "~10-site" claim, confirmed materially smaller than
  the 40-site span pervasion.
- **Position-derivable — CONFIRMED:** 0 inconsistent (node,flag) pairs across all 10 workloads (object-identity
  keying is a clean function); read-stream + CSS stable across 2 renders for all 10.
- **The one placement-varying flag is `F_EXTENDED`/`F_EXTEND_TARGET`**, only in the extend multi-placement
  fan-out (`extend-chaining`: 1 authored selector → 5 placement objects, 1 true/4 false) — and those ride
  distinct intrinsic `copySelectorForExtend` copies (NOT class-2; survive to C4), so A2s does NOT need to
  position-key them. `F_VISIBLE`/`F_GENERATED`/`F_IMPLICIT_AMPERSAND` are deterministic-per-node everywhere.
- **A2s scope refinement:** the position-keyed record needs to cover visibility only; extend-fan-out flags
  stay on the intrinsic copy. No case found where a flag can't be keyed by walk position.

**Slice A1s — collapse-survivor fresh-shell (this is INHERIT doc's I2; independently landable NOW,
does not need A0).** Make `selector-complex.ts:367` hand `inherit` a **fresh** shell with B2
`shareChildren` frozen children instead of a shared `only`. After this, `inherit` only ever mutates
FRESH nodes — the "placement mutates a shared node" invariant is clean tree-wide. **Gate:**
byte-identical on both benches + selector/extend suites green (core ~2746/0). Small, isolated,
reuses the proven B2 seam. **This is the first thing to land for A.**

---

## 3. Sub-problem B — fold eval into the render walk (dynamic-leaf-share)

### 3.1 What "fold" concretely means here

Today: `Rules.render` → `evalForRender` → `this.eval(context)` **materializes an output tree**
(`state.output`) → `serialize(state)` **walks that output tree**. A dynamic leaf gets *copied into
the output tree* during eval (that copy is what the class-2 reuse gate decides share-vs-copy for);
serialize then reads it off the output node. Two walks.

Fold = serialize walks the **source** body and resolves values against the current frame *as it
descends*, so:
- structural/registration state that eval computed into the output (selector composition — ALREADY
  on the serialize walk per Slice 4; registration index; extend gathering) lives **in the frame /
  walk state**, and
- a dynamic leaf is **looked up per-frame at the serialize position** rather than copied into an
  output node. The leaf stays shared in the source tree; its evaluated value is a per-frame lookup,
  not a materialized node.

### 3.2 What state moves to the frame

- **Registration/lookup index** — today built by `_prepareRegistrationOnce` (`rules.ts:5309`) into
  the Rules node, gated by `_hasStaticName`/`_isStatic` (`rules.ts:5617/5538`). Slice 5's
  investigation found this is **eval-bound** (Context-keyed invalidation, reference-import wiring,
  interpolated-name retry loop, live-binding per-placement scopes) — the same coupling. B must move
  the *name index* to a construction-time structure and the *per-placement bindings* to the frame,
  so a serialize-time descent can resolve a `@var` against the frame stack without a prior eval pass
  having baked declarations into an output Rules.
- **Extend gathering** — today `processExtends` runs at walk-end off gathered roots
  (`extend-roots.ts`); fold means gather in-walk as serialize descends.
- **Composition + root at-rule hoist** — ALREADY relocated (Slices 1/3/4). No new work.
- **Per-frame value lookup** — a dynamic leaf's evaluated value for the current frame. This is the
  new machinery: serialize asks "what is this Reference/Call/Operation in THIS frame" instead of
  reading a pre-evaluated output node.

### 3.3 First executable slice for B + its gate

The whole fold cannot be one slice. The safe first executable slice is the one that proves the
per-frame-lookup seam on the **most isolated** dynamic-leaf case without touching registration or
extend:

**Slice B1s — per-frame lookup for a scalar dynamic leaf in a static container.** Pick the single
narrowest case: a Declaration whose value is a dynamic scalar leaf (e.g. `width: @w`) inside an
otherwise static ruleset. Today eval copies the resolved leaf into the output; the class-2 gate
(`canReuseAsLeaf`, `node-base.ts:1171`) decides share-vs-copy. B1s: keep the source leaf shared,
resolve it against the frame at the serialize position, emit the resolved text WITHOUT materializing
an output copy. Introduce the frame-lookup entry point but scope it to this one node shape (feature
flag / node-type guard); every other shape still goes through the existing eval-then-serialize path.
**Gate:** byte-identical on both benches; core suite green; the class-2 gate is provably NOT hit for
this shape (instrumented counter = 0 for the targeted shape, unchanged elsewhere). **This is the
first thing to land for B, and the point where the whole approach is validated or refuted** — if
byte-identity can't be held for even this shape (sourcemap offset, trivia boundary), B is refuted
early and cheaply.

Subsequent B slices widen the shape set (nested containers → B2s; declarations with node-children →
B3s; then the container static short-circuits fall as reactive fall-through, population 2). Each
widening is its own byte-identical gate.

---

## 4. Ordered slice sequence (the drivable list)

Each slice: scope · files · gate · retires · deps · fan-out. Gate everywhere = **build core (+jess
for benches); core suite green (confirm current count, isolate the known `mixin.test.ts`
sibling-collapse flake); byte-identical on `collapse-bench` + `dynamic-bench` across all
collapse×bubble combos; bench neutral (same-directory A/B).**

| # | slice | scope / files | retires | deps | fan-out |
|---|---|---|---|---|---|
| **R3** | name/selector `isInterpolated`/`nameIsStatic` predicate (A2 pattern) | name+selector node types; `rules.ts:5538/5617/5656`; `selector-*.ts` | population 3 (incl. bubbled `:5656`) | none | serialize vs extend/selector track |
| **R4** | callable-guard-local static property | `callable-guard.ts:87/123/172/204`, `callable-candidate-execution.ts:72`; guard ctor | population 4 | none | disjoint (callable-*) |
| **R5a** | type-guard value checks | `scope-frame.ts:491`, `reference.ts:194` | part of population 5 (leaf-local) | none | disjoint |
| **A1s** | collapse-survivor fresh-shell (INHERIT I2) | `selector-complex.ts:367` (reuse B2 `shareChildren`) | shared-node-mutation hazard (invariant clean) | B2 (done) | disjoint |
| **A0** | provenance-record spike (throwaway, no merge) | serialize walk instrumentation | nothing (proves §2.2) | — | serialize (blocks A2s) |
| **B1s** | per-frame lookup, one scalar-leaf shape | new frame-lookup seam; `rules.ts` render path; `declaration.ts` | nothing yet (proves §3) | A1s | serialize/eval (serialize) |
| **A2s** | flag-only position-keyed provenance record at filter sites | `serialize-helper.ts`, `ruleset.ts`, `selector-list.ts`, `util/print.ts` | enables C1 flag reads to drop | A0, B1s | serialize |
| **B2s** | widen per-frame lookup: nested static containers | `rules.ts`, `ruleset.ts`, `list.ts`, `sequence.ts` | begins population 2 | B1s | serialize |
| **B3s** | widen: dynamic leaves with node-children; registration→frame/construction index | `rules.ts` `_prepareRegistrationOnce`/`_isStatic`; `scope-frame.ts` | population 3 residue; enables C1 | B2s, R3 | serialize (HOT `rules.ts` — serialize hard) |
| **Bx** | extend gather → in-walk | `extend-roots.ts`, `extend.ts` | last eval-bound structural work | B3s | extend track |
| **C1** | delete class-2 reuse gates + clone-to-freeze machinery | `node-base.ts:1171/1179/1195`, `util/cloning.ts`, `util/callable-binding.ts` | population 1 | A2s, B3s, Bx | serialize |
| **C2** | delete `F_HAS_NODE_CHILD` (residual → `hasNodeChild()` value check) | `node-base.ts`, `import-style.ts` | the flag | C1 | with C1 |
| **C-cont** | delete container static short-circuits (reactive fall-through) | `sequence.ts`, `list.ts`, `at-rule.ts`, `at-rule-statement.ts`, `query-condition.ts`, `selector-capture.ts`, `declaration.ts`, `rules.ts:6956` | population 2 | B2s/B3s | serialize per-file |
| **R5b** | `reference.ts:2577` return-value share → value check | `reference.ts` | population 5 residue | C1 | disjoint |
| **C4** | delete `F_STATIC`/`F_NON_STATIC`, `F_CHILD_DERIVED`, `propagateFlagsFrom` | `node-base.ts:704/299/~1160`; all ctor setters | THE GOAL | all above | final, alone |

**Parallelizable now (disjoint files, no A/B dep):** R3, R4, R5a, A1s. **Must serialize:** the whole
A2s→B*→C* spine (all touch `rules.ts`/serialize, the HOT shared surface).

---

## 5. Where reader-retirements 3/4/5 sequence

**BEFORE, and independently of, A/B.** R3 (name/selector predicate), R4 (callable-guard-local), and
R5a (type-guard value checks) are construction-time re-expressions of bubbled/leaf reads that the
Phase A2 `F_AMPERSAND`-to-selector-scope move already proved as a pattern. They:
- do NOT touch the eval/serialize walk coupling,
- shrink the C4 reader set to just populations 1 + 2 (+ R5b's `reference.ts:2577`, which falls with
  C1), and
- are pure code-health per the CPU profile (<1% self-time either way).

They should land FIRST as low-risk, fan-out-disjoint slices (R3 on the selector/extend track, R4 on
callable-*, R5a on scope-frame/reference), banking reader reduction before the expensive spine. They
do **not** reach C4 alone — after all three, populations 1 and 2 still require A+B.

**One caveat on R3:** `rules.ts:5656` is the ONLY genuinely-bubbled read in population 3; the rest of
`_hasStaticName` reads leaf-local name-node F_STATIC (Quoted `:77/79` / Interpolated `:198` ctor).
R3 must give the selector types a construction-time `nameIsStatic`/`isInterpolated` predicate so
`:5656` asks the selector, not the bubble. This is the same move A2 made for `F_AMPERSAND`.

---

## 6. Where the plan can go WRONG (fixtures/behaviors most likely to break)

All flagged "NOT copies, stay" in the source docs — these are the byte-identity landmines for the
A/B spine:

1. **Sourcemaps (highest risk).** Sub-problem A's whole rejection turned on span being read off
   `this` at serialize with no frame. B removes the span half by descending the source tree — but
   any B slice that changes WHICH node the writer attributes a chunk to shifts sourcemap offsets
   silently (byte-identical CSS, wrong map). **Mitigation:** every B slice's gate must include a
   sourcemap-identity check, not just CSS-identity. This is not currently in the standard gate — add
   it. (See §8.)
2. **Authored-trivia round-trip.** `detachTrivia` (`node-base.ts:1269`) and the boundary
   offset/comment machinery (`serialize-helper.ts`) consume file-owned whitespace/comments at source
   offsets. A shared leaf looked up per-frame must NOT re-consume trivia from its authored boundary
   in a new output position (the exact bug `detachTrivia` exists to prevent). B1s's narrow shape was
   chosen partly because it minimizes trivia exposure; widening (B2s/B3s) is where this bites.
3. **Extend per-match flags.** The extend registry reuses ONE shared source selector across many
   matches, each needing its own `F_EXTENDED`/`F_EXTEND_TARGET` (INHERIT §2). This is the case A0
   must prove position-keying can (or cannot) reproduce. If it cannot, extend keeps its intrinsic
   per-output copy (`copySelectorForExtend`) — which is fine (it's not class-2) — but A2s must not
   assume those flags are position-derivable.
4. **`$while` cross-iteration state** (`i = i+1`) — genuine per-iteration variable state; NOT a
   copy; stays until per-iteration state lives fully in the frame. B's per-frame lookup must not
   assume a leaf's value is frame-position-stable inside `$while`.
5. **`+:` decl-merge** (`deriveWithParts`, `rules.ts:5960/6112/6188` per source doc) — constructs a
   genuinely NEW combined value; NOT a placement copy; stays.

---

## 7. Serializer touch-point enumeration (supporting the §2.2 narrow-record claim)

The INHERIT investigation cited "~35 serializers" doing `writer.add(text, this)`. **Verified count:
40 `writer.add(text, node)` calls across 15 files** (any/at-rule-statement/bool/color/combinator/
comment/default-guard/dimension/extend-list/import-style/negative/query-condition/range/rest/
selector-basic) — the "~35" slightly understated. The span-read chain is `writer.add(text, origin)`
(`util/print.ts:457`) → `OutputWriter.markSource` (`:447`) → `sourceSegmentFor(origin)` (`:198`) →
`spanStartOf(origin)` (`util/provenance.ts:78`, reads `fieldsOf(node)._spanStart`) /
`origin.sourceRoot?._treeContext`, origin === the node, no frame. The material point for A: the
**span** read is what pervades those 40 sites; the
**flag** reads (`F_EXTENDED`/`F_EXTEND_TARGET`/`F_GENERATED`/`F_VISIBLE`) cluster at a much smaller
set — the extend/reference-mode output filter (`serialize-helper.ts` `flattenVisibleRulesForRender`
+ `canMergeSameHeaderRuleset` at `:199`, `ruleset.ts`, `selector-list.ts`), `:is()` unwrap
(`selector-pseudo.ts`), and visibility gating (~10 files). B collapses the span pervasion (source
descent); A only needs the flag cluster. *(Exact per-file counts: see the companion enumeration; the
structural conclusion — span is the ~35-way pervasion, flags are the ~10-site cluster — is what
drives the design and is not sensitive to the exact count.)*

---

## 8. Riskiest slice + mitigation

**Riskiest: A2s (flag-only position-keyed provenance record).** It is the slice whose *premise*
(§2.2: the flag subset is position-derivable at a small site cluster, and B has already removed the
span half) is a design hypothesis the isolation investigation explicitly did not believe for the
full span+flag record. If the premise is wrong — if any C1-relevant flag genuinely varies
per-placement of a shared node in a way walk-position cannot key — A2s cannot be made byte-identical
and the copy it was meant to remove has to stay, leaving population 1 partially alive and C4 blocked.

**Mitigations:**
- **A0 spike gates A2s.** Do not write A2s until A0's instrumented equality assertion is green across
  collapse + dynamic + all-extend fixtures. A0 is throwaway and cheap; it converts the hypothesis to
  a measured fact before any real code lands.
- **Sourcemap-identity gate added to the standard gate for every A/B slice** (not just CSS bytes).
  The `render-scaling`/guardrail discipline from FLAG-WALK-DELETION's guardrail slice applies: gates
  were complexity-blind once (the comment-scan quadratic); here they must also be *mapping-blind*-
  proof. Add a sourcemap-equality fixture to the gate.
- **B1s is the early-refutation point.** If the narrowest per-frame-lookup shape cannot hold
  byte + map identity, stop — B is refuted at low cost and the honest outcome is "bank A+B partials,
  park C4."

**Second-riskiest: B3s** (registration → frame/construction index) — it touches the HOT `rules.ts`
registration machinery whose eval-binding Slice 5 already found deep (Context-keyed invalidation,
reference-import wiring, interpolated-name retry, live-binding scopes). Mitigation: it is late in the
spine (after B1s/B2s prove the lookup seam), depends on R3 having already removed the name-predicate
flag reads, and is gated per the same discipline.

---

## 9. REALISM verdict

**Genuinely multi-week, high-regression, and NOT a perf lever.** The fresh CPU profile
(`REPROFILE_CURRENT.md`) puts the entire Phase-D surface — eval-fold, registration, copy, reuse
gates, `propagateFlagsFrom` — at **<1% self-time**. This is code-health / "do-less-work" simplicity,
not speed. The owner's standing decision (FLAG-WALK-DELETION "REPRIORITIZED") is: **attack the
measured hotspots first (comment-scan quadratic ~70%, extend matcher ~25%), then finish this as
cleanup.** This plan does not contest that ordering — it makes the cleanup *drivable* for when it is
picked up.

**Can a prefix deliver value before the whole thing lands? Yes:**
- **R3 + R4 + R5a + A1s** land now, disjoint, byte-identical, retiring reader populations 3, 4, and
  part of 5, and making `inherit` mutate only fresh nodes (invariant clean). This is real reader
  reduction + a cleaner invariant, banked without touching the spine.
- After that prefix, `propagateFlagsFrom` still bubbles `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`,
  but its *live reader set* has shrunk to populations 1 + 2 (+ `reference.ts:2577`). The flags are
  not deleted, but the "why do these still exist" surface is halved and documented.

**Is there a smaller "80%" target that retires class-2 + containers WITHOUT the full compiler-split
collapse?** The compiler-split collapse (D3) is **already done** (§0) — so that is not the 80% cost.
The real 80% question is: *can populations 1 + 2 be retired without the full dynamic-leaf-share
fold?* Honest answer: **no clean 80%.** Population 1 (class-2 gates) exists precisely because a
dynamic leaf is copied into the output tree; the only way to stop copying it is to look it up
per-frame at serialize (B). Population 2 (container short-circuits) exists because eval and serialize
are separate walks; they fall as reactive fall-through only once B removes the separate eval
materialization. Both are B. There is no cheaper lever — the inherit route was rejected, the class-2
route was blocked, and both point at B. The ONLY sub-80% wins available are the reader-retirements
(R3/R4/R5a, ~40% of the reader *count*, 0% of the mechanism) and A1s (invariant hygiene). Retiring
the flags themselves is all-or-nothing on B.

**Recommendation (matching the owner decision point):** land the R3/R4/R5a/A1s prefix as
code-health now; run A0 as a cheap spike to convert §2.2's hypothesis to fact; and gate the B spine
(hence C4) behind the hotspot-perf work per the reprofile. If/when B is committed, drive it slice-by-
slice on the table in §4 with the sourcemap-identity gate added.

---

## 10. Gates (delta from the standard flag-walk gate)

Standard gate (FLAG-WALK-DELETION §Gates) PLUS, for every A/B slice:
- **Sourcemap-identity** on a sourcemap fixture (CSS-byte-identity is insufficient — §6/§8).
- **Instrumented share-vs-copy counter** for B slices: assert the targeted class-2 gate is NOT hit
  for the shape the slice folded (0), unchanged elsewhere — the linearity/guardrail discipline.
- A0 is throwaway (no merge); A1s/R* land normally, one slice at a time, disjoint fan-out only.
