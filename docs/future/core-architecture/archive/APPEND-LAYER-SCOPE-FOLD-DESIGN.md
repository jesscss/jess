# Fold design: `@layer`, `@scope`, ampersand-append

**Governing spec:** `UNIFIED-EVAL-EMIT-DESIGN.md` §2/§4/§7 · `@see CUTOVER-CHECKLIST.md` P1/P2 "Next push".
**Branch:** `work/atrule-layer-scope` (base `cb19de6bc`).

This is the design pass for the three shapes the checklist grouped as the #1-recommended
next push. It records, per shape, **what the eval pass does that the spine does not**, the
**shared mechanism**, and the **fold plan**.

## Status reconciliation (found at baseline — the checklist prose is STALE)

Two of the three shapes were ALREADY folded and committed on this branch, AFTER the
checklist prose (lines 84-85, 149) was written:

- **`@scope`** — folded in `0c72e21bf` ("fold @scope into the spine (nestable conditional-group)").
  Added to `SPINE_ELIGIBLE_AT_RULES`; its `(start) to (end)` prelude rides the existing
  `rawPrelude.eval`-at-enter path (same as `@media (@w)`); body composes as a normal container.
  Ratchet-locked (three prelude forms: bare / `(.card) to (.content)` / var-bearing), byte-identical,
  `Rules.derive=0`.
- **`@layer`** — folded in `a7982e3a2` ("fold no-extend @layer into the spine (conditional-group)").
  See the GAP analysis below for why the layer-NAME registration side effect is output-invisible on
  the no-extend spine path. Ratchet-locked (simple / nested-name / var-in-body / var-ref name; plus a
  ratchet asserting extend-bearing `@layer` STAYS on eval).

So of the three, **only ampersand-append remains**. This design pass focuses there, and records
the `@layer`/`@scope` reasoning for completeness (they are NOT re-opened).

### Baselines (base `cb19de6bc`, this session)
- core suite: **3253 pass / 0 fail / 15 skip / 2 todo**
- all-less corpus: **91 / 93** (pre-existing fails: `extend-selector`, `import-remote` — both
  documented pre-existing/network, unrelated to append).

---

## 1. `@layer` — DONE (GAP analysis, for the record)

**What eval does that the spine doesn't:** the eval pass, when it descends a `@layer a.b { … }`,
calls `registerRoot(body, parent, { layerName })` into the extend-roots graph. This registration
exists SOLELY to scope extend-reach per named layer (an `:extend` inside layer `a` must not reach a
subject in layer `b`).

**Why it is NOT a GAP (output-invisible on the spine path):** the ONLY consumer of the layer-name
registration is the extend engine. And `isSpineExtendTopology` sets `ok = false` for ANY
extend-bearing at-rule body — so an `:extend` under `@layer` routes to the eval path, where the
registration happens as before. On the spine path a `@layer` is by construction extend-free, so the
registration has no consumer and skipping it changes nothing observable. This was verified against
the eval pass and ratchet-locked (extend-under-`@layer` stays on eval). Not a genuine unfoldable.

## 2. `@scope` — DONE (for the record)

**What eval does that the spine doesn't:** effectively nothing extra. The concern was the special
`(start) to (end)` prelude and the "scoped body". Empirically the prelude carries no eval-pass side
effect (no scope-frame or extend-roots registration beyond a normal conditional-group), and the body
composes like any nested container. So it rides `serializeSpineFrameAtRule` (prelude eval-at-enter +
body descent) unchanged, added to `SPINE_ELIGIBLE_AT_RULES`. Byte-identical, ratchet-locked.

---

## 3. Ampersand-append (`&-modifier` / `&-primary`) — THE REMAINING FOLD

### What the eval pass does that the spine does not (root cause)

An append selector (`.a { &-modifier { … } }`) is a `Ruleset` whose selector list contains an
`Ampersand` node carrying `appendValue: '-modifier'`. In the eval pass:

1. `Ampersand.evalNode` (ampersand.ts:587) sees `appendValue !== undefined`, reads the parent
   selector from `context.rulesetFrames` (top = enclosing ruleset), APPENDS the suffix
   (`appendSelector` → `.a` + `-modifier` = `.a-modifier`), and returns a selector marked
   **`hoistToRoot = true`** (via `finishAmpersandAppendPlacement`).
2. `Ruleset._finishRulesetSelectorPrep` (ruleset.ts:1923-1924) then propagates that onto the OUTPUT
   ruleset node: `if (sel.hoistToRoot) node.hoistToRoot = true`.
3. `Ruleset.isHoisted(options)` (ruleset.ts:676) reads `this.hoistToRoot` → **true**, so the block
   places at ROOT (not nested under `.a`), and `composeSelector` (ruleset.ts:347) respects
   `hoistToRoot` and does NOT re-prepend the parent.

The spine (`serializeSpineFrameContainer`) ALREADY does step 1 correctly: it evals the container's
selector against the live `rulesetFrames`, so `Ampersand.evalNode` produces the correct
`.a-modifier` (hoistToRoot-marked) selector, installed as `options.spineSelector`. **What it does NOT
do is step 2/3** — there is no output node, so `this.hoistToRoot` on the SOURCE ruleset stays
undefined, and `isHoisted` falls back to `collapseNesting`. Result (empirically probed):

| input | eval (target) | spine today (gate lifted) |
|---|---|---|
| `.a { &-modifier { color:red } }`, collapse | `.a-modifier { … }` (hoisted) | `.a { color:red }` (inlined into parent!) |
| same, expanded | `.a-modifier { … }` (hoisted) | `.a { .a-modifier { … } }` (stays nested) |
| `.a { &-b { &-c { … } } }` | `.a-b-c { … }` | THROWS `Cannot append "-c"` (intermediate frame) |
| `.a { & > &-x { … } }`, collapse | `.a > .a-x > .a-x` | `.a > .a-x > .a-x` ✅ (already works) |

So the gap is precisely: **the spine resolves the append selector but does not honor the resolved
selector's `hoistToRoot` for BLOCK PLACEMENT.** The template-merge form (`& > &-x`) already works
because it does not carry the hoist flag in the same way.

### The shared mechanism (why append rides the hoist frontier — the "folds alongside hoist" note)

The checklist says append "folds alongside the hoist work." The connection: block **hoist-to-root**
is exactly the mechanism `@media`→root hoisting already exercises through the spine
(`isHoisted`/`getHoistedParent`/the `hoisted` branch in `serializeRulesContainerInternal`). An append
ruleset is a RULESET that hoists to root. The single missing wire is propagating the resolved
selector's `hoistToRoot` into the `isHoisted` decision — the ruleset analogue of the at-rule hoist
already folded. No new placement machinery; it reuses the KEPT hoist path.

### Fold plan (incremental, byte-identical)

**Step A — hoist propagation.** Make `Ruleset.isHoisted(options)` (spine mode) also return true when
the resolved spine override selector for `this` carries `hoistToRoot`. The override is already
reachable via `effectiveHeaderSelector(options)` / `options.spineSelectorNode === this`. This is the
spine analogue of `_finishRulesetSelectorPrep`'s `node.hoistToRoot = true` — output-invisible on the
source node (read from the override, not mutated onto canonical state). With this, the collapse-mode
`.a-modifier` should place at root and `composeSelector` should stop re-prepending `.a`.

**Step B — intermediate-frame for nested append.** For `.a { &-b { &-c { … } } }`, the middle
`&-b` ruleset's resolved selector (`.a-b`, hoisted) must be what `&-c` composes against. The spine
pushes `context.rulesetFrames.push(node)` for descendants — verify the RESOLVED selector (not the raw
`&-b`) is what a child `Ampersand.evalNode` reads as its parent. If the push carries the source node
whose `.selector` is still the raw `&-b`, the child append throws. Fix: ensure the resolved selector
is visible to the child's append eval (either store the resolved selector on the pushed frame, or push
a frame whose `.selector` is the resolved form) — mirroring how the eval pass stores the resolved
selector on the output node it pushes.

**Step C — eligibility lift + ratchet.** Only after A+B are byte-identical across both collapse modes
(and the corpus holds 91/93): delete the `selectorHasAmpersandAppend` gate in
`isSpineEligibleContainer` (emit-walk.ts:530), flip the existing ratchet
(`emit-walk-ratchet.test.ts:125` "eligibility boundary excludes AMPERSAND-APPEND") to assert append
now FOLDS + is byte-identical + `Rules.derive=0`, and update the JSDoc.

### PERF note
Append is a selector-shape gate checked once per container at eligibility time
(`selectorHasAmpersandAppend` is a `walk`); lifting it removes a walk from the eligible path and adds
nothing to the hot leaf path (the hoist check `isHoisted` is already called). Confirm A/B on
benchmark.less before landing (no expectation of regression — the fold removes an exclusion walk).

### If genuinely unfoldable
Not expected — the mechanism is a flag propagation into the already-folded hoist path. If step B
proves to need eval-pass frame state the spine cannot reproduce, it will be surfaced as a GAP with a
spec (defer + ratchet-lock on eval), never left silently.

---

## LANDED (this session)

Steps A + B landed; the common append shapes fold byte-identical, three edge-shapes deferred precise.

- **Step A (hoist propagation)** — `Ruleset.isHoisted` (ruleset.ts) now reads the resolved spine
  override selector's `hoistToRoot` (`options.spineSelector` when `spineSelectorNode === this`), the
  spine analogue of `_finishRulesetSelectorPrep`'s output-node flag. Output-invisible (read from the
  transient override, no canonical mutation).
- **Transparent-wrapper fix** — `serialize-helper.ts`'s bare-`&` transparent-wrapper detection now
  excludes an APPEND ampersand (`appendValue !== undefined`): an append materializes its own hoisted
  header and must NOT be treated as a selector-transparent bare `&` (that bug inlined `.a-modifier`'s
  body into `.a` under collapse).
- **Step B (nested-append frame)** — new `Context.spineResolvedFrameSelector` WeakMap side-channel:
  `serializeSpineFrameContainer` records each frame's RESOLVED selector at descend; `Ampersand.evalNode`'s
  append path reads it before the raw `frame.selector`, so `.a { &-b { &-c {…} } }` → `.a-b-c` (each
  level appends against the resolved `.a-b`). No canonical mutation (the eval pass gets this by pushing
  the resolved output node).
- **Eligibility lift** — the `selectorHasAmpersandAppend` blanket gate in `isSpineEligibleContainer`
  (emit-walk.ts) is replaced by three PRECISE deferrals (ratchet-locked, byte-identical on eval,
  REQUIRED P4 items — not a permanent fallback):
  1. append ruleset with a nested NON-APPEND container child (`&-x { .inner {…} }`) — expanded-mode
     frame-split gap (SPEC: thread the resolved append selector into the nested-child compose frame).
  2. append child under a SELECTOR-LIST parent (`.a, .b { &-x {…} }`) — eval itself renders this
     unusually (list-append under-specified upstream; SPEC: per-branch append, pending owner pin).
  3. append × extend (`treeHasAmpersandAppend` + `engageExtendLayer`) — an append-generated selector
     may be an extend target the static gather can't see (SPEC: resolve append into the extend target
     index before SOLVE, mirroring OQ-A interpolated-target resolution).

**Verification.** 12 append shapes × 2 collapse modes: spine output BYTE-IDENTICAL to the eval baseline
(differential clean). Core suite 3255/0 (2 new ratchet tests: append-fold + edge-shape-deferrals). all-less
91/93 (unchanged — same pre-existing `extend-selector`/`import-remote`, zero new byte-diffs). Ratchet
`emit-walk-ratchet.test.ts` flipped: append now ADMITS + hoists + folds nested; deferrals locked. tsc:
374 errors both base and after (ZERO new). PERF A/B (synthetic 400-block heavy-nesting + append + `@media`,
collapse): base ~44.2ms vs folded ~44.5ms median — perf-neutral, identical output length.

Two PRE-EXISTING jess `spine-production-ratchet` failures (`@property` and nested-scope-mixin negative
routing ratchets) are UNRELATED to append — confirmed failing at base `cb19de6bc` (stale ratchets from
earlier `@property`/nested-mixin fold commits; out of scope for this fold).
