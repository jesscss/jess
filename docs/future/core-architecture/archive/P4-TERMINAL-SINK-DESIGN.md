# P4 TERMINAL/SINK REWORK — unified design

**Status:** DESIGN PASS (design-first, no folds landed yet). Base `fa525e055`, branch
`work/p4-terminal-rework`.
**Governs:** `UNIFIED-EVAL-EMIT-DESIGN.md` §2 (frame-threading spine) + §3 (no-canonical-mutation /
body reuse). Companion to `CUTOVER-CHECKLIST.md` P3-precursor (MIXINS) + P3 (EXTEND) progress logs.

## 0. Baselines (recorded BEFORE any change)
- **Core suite:** `cd packages/core && pnpm test` → **3249 passed / 0 failed / 15 skipped / 2 todo**
  (188 files; 186 passed / 2 skipped). *(Requires the parser chain built first —
  `@jesscss/css-parser`, `@jesscss/less-parser`, `@jesscss/scss-parser`, `@jesscss/style-resolver`,
  `@jesscss/core` — else vitest transform trips `ERR_MODULE_NOT_FOUND` on `@jesscss/css-parser/jess`.)*
- **all-less corpus:** `packages/jess` → `TEST=true npx vitest run test/less/all-less.test.ts` →
  **91 passed / 2 failed (93)**. The 2 failures are PRE-EXISTING, unrelated to this rework:
  `extend-selector` (a `:is(...)` whitespace/formatting quirk — string-equal-but-`Object.is`-false) and
  `import-remote` (network fetch, empty output offline). This is the byte-identity reference; equal-or-better
  after every fold.

## 1. Why these three converge on ONE thing — the CALLABLE TERMINAL

The cutover replaces eval→output-tree→serialize with a single downward spine (`emit-walk.ts`). Mixins
fold through a **surface sink**: `resolveSpineMixinCall` (emit-walk) installs `context.spineMixinSurfaceSink`,
drives the call's own `eval()` ONCE so all the KEPT machinery runs (candidate match, arg-bind, guard,
recursion `callMap`, caller frame), and the terminal hands each guard-passed candidate's **bound surface**
(shared body + wired live-cell frame, NO output tree) to the sink instead of `rules.eval()`-ing an output
`Rules`. The serializer (`runSpineMixinExpansion`) splices captured surface children into the render feed.

The eval callable terminal has **two arms**, and the sink is wired into only ONE:

| candidate kind | terminal function | consults sink? |
|---|---|---|
| **Mixin definition** (`N.Mixin`) | `executeCallableCandidate` → `evaluateCallableCandidateOutput` (`callable-candidate-output.ts:51`) | **YES** — `sink(rules, sourceRules, candidateIsMixin=true)` |
| **Ruleset-as-mixin** (`N.Ruleset`) | `evaluateCallableSpecialCaseCandidate` (`callable-special-case.ts:43-78`) | **NO** — eval-materializes, returns `{handled:true, output}`, the loop pushes it to output-state and `continue`s (`callable-candidate-loop.ts:84-90`) |

So the ruleset arm never reaches the sink. That single asymmetry is the root of BOTH mixin #3 and #5,
and the recursion item (#1) is the same terminal made **re-entrant**. Extend #4a is measured separately
below and found **separable** — it rides the extend EMIT pipeline, not the callable terminal.

### The three shapes, precisely located

1. **Recursion / nested-call-in-body** — a Mixin def whose body itself contains a mixin CALL
   (`.wrapper(){ .base(@c); }`, or self-call `.loop(){…; .loop(); }`).
   - Gate: `treeHasMixinDefinitionWithNestedCall` (`emit-walk.ts:1380`), fired at `emit-walk.ts:1214`.
   - Runtime reject: `isSpineSimpleMixinSurface` returns `false` for a body child that
     `isSpineEligibleMixinCall` (`emit-walk.ts:308-310`).
   - Termination is ALREADY handled: `evaluateCallableCandidateOutput` runs inside the `callMap`
     recursion-guard bracket (`callable-candidate-output.ts:31,60-66`), and the sink is consulted INSIDE
     that bracket — a recursive body still trips `callMap`.

2. **Ruleset-as-mixin (#3)** — a lone `.foo(){}`… no, a lone `.foo {}` ruleset called as `.foo()`.
   The ruleset candidate is eval-materialized by the special-case arm; the sink is never called
   (`captured` empty → `resolveSpineMixinCall.finish` returns `kind:'eval'`). Correct today, but on eval.
   - Gate: folded INTO `treeHasMixinRulesetMixedMatch` / the `!candidateIsMixin` sink reject
     (`emit-walk.ts:372`); a pure ruleset-as-mixin resolves as `kind:'eval'` (zero sink calls).

3. **Mixed-match (#5)** — `.foo{}` (ruleset) + `.foo(){}` (mixin) both matched by `.foo()`.
   The mixin candidate is sink-captured; the ruleset goes through the special-case eval-output path; then
   `resolveSpineMixinCall.finish` (`emit-walk.ts:398-400`) **DISCARDS the eval output whenever `captured`
   is non-empty** (`return {kind:'fold'}` ignores the ruleset's contribution). To avoid the drop the whole
   tree is gated to eval.
   - Gate: `treeHasMixinRulesetMixedMatch` (`emit-walk.ts:1515`), fired at `emit-walk.ts:1176`.
   - Ratchet locking it on eval: `mixin-fold-p4-sequenced.test.ts`.

## 2. THE UNIFIED SINK — what the eval terminal does that the spine sink doesn't yet

Eval assembles a call's output by pushing EVERY matched candidate's contribution (mixin bodies AND
ruleset-as-mixin bodies) into a single **output-state** list (`pushCallableOutputRule` /
`recordCallableOutputSourceRules`, `callable-candidate-loop.ts:85-90,106`), then the eval path orders them
by document position (`compareCallableOutputPosition`) and flattens into the call site.

The spine sink today captures ONLY Mixin-definition surfaces and folds them; it treats a captured
ruleset (or any `!candidateIsMixin`) as a rejection. The unified sink makes the sink the **single
terminal for every candidate kind**, so the sink's `captured` list is the exact spine analogue of eval's
output-state list. Concretely:

### 2.1 Route the Ruleset candidate through the sink (fixes #3 + the mixin half of #5)
`evaluateCallableSpecialCaseCandidate` must, for a **plain (unguarded) Ruleset** candidate, consult
`context.spineMixinSurfaceSink` with the **bound callable surface** BEFORE eval-materializing — exactly
as `evaluateCallableCandidateOutput` does. The surface it hands over is `createCallableRules(sourceRules)`
(already no-deep-clone, `callable-special-case.ts:52-53`) descended under its own frame.

- The sink's third arg is `candidateIsMixin`. A ruleset-as-mixin passes `false`. The sink must **stop
  rejecting on `!candidateIsMixin`** — instead capture it (with a `kind` tag so EMIT knows a
  ruleset-as-mixin ALSO emits standalone at its own source position, vs a mixin body which emits only at
  the call site). See §2.3.
- If the sink returns `true` (captured), the special-case returns `{handled:true}` with **no output**
  (mirrors `evaluateCallableCandidateOutput` returning `undefined`). If `false` (not spine-simple, or a
  GUARDED ruleset — keep the existing `rulesetGuard instanceof Nil` split, a guarded ruleset stays on the
  eval-output arm), fall through to today's eval-materialize.
- **Guarded ruleset** (`callable-special-case.ts:44-45` handles only `Nil`-guard; a guarded ruleset
  currently returns `{handled:true}` with no output at 46, i.e. it is inert until guard-eval). Keep guarded
  rulesets deferred in this batch — sink only the unguarded `rulesetGuard instanceof Nil` case.

### 2.2 Make `finish` assemble BOTH kinds in document order (fixes #5's drop)
`resolveSpineMixinCall.finish` (`emit-walk.ts:398-425`) currently: `if (anyRejected || captured.length===0)
→ kind:'eval'` else fold the sorted mixin surfaces. Once rulesets are captured too:
- `anyRejected` no longer trips for a ruleset-as-mixin (it becomes a captured entry, not a rejection).
- `finish` folds when EVERY matched candidate was captured (mixin OR ruleset); it already SORTS `captured`
  by source document order (`emit-walk.ts:406-413`) — this is the exact analogue of eval's
  `compareCallableOutputPosition`, so mixed contributions emit in source order byte-for-byte.
- The sort key must be the CALL-SITE contribution order (all candidate bodies emit AT the call site in
  candidate/source order), which the existing sort already produces. A ruleset-as-mixin's STANDALONE
  emission at its own source position is a SEPARATE concern handled by the normal spine ruleset descent
  (the `.foo {}` ruleset is a body child that streams where it's authored) — the fold must NOT suppress
  it. This is why the `kind` tag matters: a captured mixin surface contributes ONLY at the call site;
  a captured ruleset-as-mixin contributes at the call site AND is left in place to stream standalone.

### 2.3 Shared data structure — the captured-entry tag
Extend the sink capture entry from `{surface, source}` to `{surface, source, kind}` where
`kind ∈ {'mixin', 'ruleset'}`. This is the ONLY new shared structure. `finish` uses `kind` to decide
call-site-only vs also-standalone; the document-order sort is unchanged (keyed on `source` position).
No new flag on any canonical node — the tag lives on the transient capture entry (§3 no-canonical-mutation).

### 2.4 Recursion (#1) — the sink made re-entrant, NOT a terminal change
The recursion item needs NO change to the terminal or sink shape — it is a **serializer** change plus a
gate lift:
- `runSpineMixinExpansion` (`serialize-helper.ts:831-865`) splices a folded surface's children FLAT into
  `rulesToRender`, tagged with `spineFrame = surface`, and re-scans via `expandFrom(i + childEntries.length)`.
  A nested call that is a **direct body child** of the surface therefore becomes a top-level feed entry and
  IS re-scanned by the same loop — the machinery is ALREADY re-entrant for direct-child nested calls.
- The blocker is purely the two gates that pre-empt it: `isSpineSimpleMixinSurface` rejects a body
  containing a `isSpineEligibleMixinCall` child (`emit-walk.ts:308-310`), and
  `treeHasMixinDefinitionWithNestedCall` gates the whole tree to eval (`emit-walk.ts:1214`).
- **Fold plan:** lift both, and VERIFY the spliced nested call carries the correct `spineFrame` so it
  resolves against the OUTER surface's definition frame (the nested call's args reference the outer
  mixin's params/closure). The nested call's OWN resolution then re-installs the sink via a nested
  `resolveSpineMixinCall` — the `callMap` bracket guarantees termination for genuine recursion (a
  self-call trips `callMap.add` → `evaluateCallableCandidateOutput` returns `undefined`, no output, exactly
  as eval). RISK: a nested call inside a nested CONTAINER body child (not a direct child) is NOT re-scanned
  by the flat splice — that stays under `treeHasContainerBodyMixinDefinition` (a separate, still-deferred
  gate), so lift ONLY the direct-child nested-call gate here.

## 3. Fold order (incremental, each byte-identical + ratcheted)

Ordered by dependency and risk. Each lands as its own commit with: spine==eval byte-identical on a
component test + eval-path output-unchanged (shared machinery) + a ratchet + corpus equal-or-better.

1. **FOLD A — ruleset-as-mixin (#3).** Route the unguarded Ruleset candidate through the sink; add the
   `kind` tag; teach `finish` to fold a ruleset-only capture (call-site body + leave standalone in place).
   Corpus payoff: ruleset-as-mixin is a Less-corpus shape (`.foo` called as `.foo()`), so this should move
   corpus routing (not just Jess-native). Flip the `mixin-fold-p4-sequenced.test.ts` #3-family ratchet from
   "stays on eval" to "folds".
2. **FOLD B — mixed-match (#5).** Builds directly on A: with rulesets captured, `finish` already assembles
   both by document order. Lift `treeHasMixinRulesetMixedMatch` (`emit-walk.ts:1176`). Rewrite the
   `mixin-fold-p4-sequenced.test.ts` #5 tests from "stays on eval / spineRan=false" to "folds / both
   contributions in document order + ruleset also standalone". This is the smallest of the three once A
   lands.
3. **FOLD C — recursion / direct-child nested call (#1).** Lift `isSpineSimpleMixinSurface`'s nested-call
   reject (`emit-walk.ts:308-310`) and `treeHasMixinDefinitionWithNestedCall` (`emit-walk.ts:1214`).
   Verify `spineFrame` propagation for the spliced nested call + `callMap` termination on a genuine
   self-recursive mixin. Keep `treeHasContainerBodyMixinDefinition` (nested-container body) deferred — a
   nested call inside a nested container is NOT reached by the flat re-scan; that is a distinct later piece.
   Add a ratchet: `.wrapper(){ .base(@c) }` folds; a self-recursive counted loop folds + terminates
   byte-identical to eval.

Order rationale: A unlocks B mechanically (shared `finish` assembly); C is orthogonal (serializer +
gates, no sink-shape change) and can land before or after A/B, but is placed last because it is the item
the checklist calls "the one genuinely architectural item" and benefits from the sink being settled first.

## 4. Extend #4a — SEPARABLE (assessed OUT of this cluster)

Extend #4a is the **expanded-mode (`collapseNesting:false`) crossing/hoist block-relocation** gap.
- **Gate:** `spine-extend.ts:750-751` — a crossing/hoist target (`.header .header-nav`, a nested
  subject's composed path) is admitted ONLY under `collapseNesting:true`, because the hoist verbatim-override
  PRECONDITION is that the nested block already emits at ROOT (true only under collapse). Under expanded
  mode the block stays nested and hoist would need **block relocation** (moving a nested ruleset's emission
  to root) — deferred → stays on eval.
- **Why separable:** this is the extend **EMIT pipeline** (`tree/extend/`), not the callable
  terminal/sink. It shares NO data structure with the mixin sink (`spineMixinSurfaceSink`, the captured-entry
  list, `finish`). Its mechanism is "relocate a nested block's serialization to root under expanded mode"
  — a serializer/print concern (`print.ts:97`, `ruleset.ts:1480,1700`), independent of callable resolution.
- **Verdict:** #4a does NOT ride this rework. It is a distinct P4 extend-EMIT item. Recommend it be
  sequenced separately (its own spec below). It is byte-correct on eval today and ratchet-locked there.

### #4a SPEC (for the separate extend-EMIT batch, captured here so it isn't lost)
Under `collapseNesting:false`, when SOLVE rewrites a NESTED subject whose target is a crossing/composed
path, the produced branch must appear at ROOT (the extender is a root-level selector), but the subject's
block is authored nested. The fold needs a **block-relocation EMIT step**: emit the nested subject's block
BOTH in place (its own nested header) AND hoisted-at-root under the extender's composed header — the
expanded-mode analogue of the collapse-mode verbatim override. Coupling is EMIT-ordering only (the hoist
must run after the nested block's own header is composed). Bounded by the crossing-target count. Keep
ratchet-locked on eval (`spine-wire-selector-shapes.test.ts` #2 expanded-mode nested in-place) until landed.

## 5. PERF discipline (shared hot callable machinery)
`resolveSpineMixinCall` + the special-case terminal are on the hot callable path (every mixin/ruleset
call). Routing the Ruleset candidate through the sink adds one sink-consult per ruleset-as-mixin candidate
— a function-pointer check + a runtime surface gate, paid only when a sink is installed (spine mode) AND a
ruleset-as-mixin is matched. The common single-namespace / plain-mixin path is untouched. Still: measure
A/B (the `spineRenderCounter` + a micro-bench on a ruleset-as-mixin-heavy fixture) before landing each
fold; never ship a defensive slowdown. If a fold regresses the hot path, find a faster shape or sequence
it with a measured spec — do not abandon (HARD RULE #6).

## 7. FOLD C recursion gap (found during the fold) — SEQUENCED, spec captured

FOLD C made the fold splice re-entrant (`runSpineMixinExpansion` re-scans a folded surface's
spliced children from `i`, pushing each entry's `spineFrame` around the resolve drive). This
folds ALL non-recursive nested-call shapes byte-identical: plain nested call (`.a(){ .b() }`),
multi-level chains (`.a→.b→.c`), and nested calls with outer-param OR Operation args
(`.b((@a - 1))`).

`callMap` terminates genuine recursion (verified: a `.loop(@n)` self-call produces exactly
`n` bounded expansions, no hang). BUT a RECURSIVE call (self OR mutual — a name-cycle among
mixin defs) whose ARG is frame-dependent (`.loop((@n - 1))`) does NOT fold: `'n' is not
defined` on the recursive re-drive. Root cause: the re-entrant expansion pushes the entry's
`spineFrame` (the OUTER surface) around the resolve — which correctly binds a one-level nested
call's arg — but a recursive re-drive needs EACH LEVEL's freshly-bound param frame threaded
through the CALL's own arg-binding eval (`Call.evalNode`→arg eval), not just
`context.rulesContext`. Non-recursive chains work because each level is a distinct def with its
own frame; a recursive cycle re-enters the SAME def and the per-level param binding is lost for
arg resolution.

**GATE (landed):** `treeHasRecursiveMixinCall` — a cheap document-level name-cycle detector
over the mixin-def→called-names graph (DFS). A tree with a recursive mixin cycle stays on eval,
byte-identical. Ratchet-locked (`mixin-fold-sequence-gate.test.ts`: flat self-recursion +
mutual recursion + recursion+nested-container all `eligible=false`, render byte-correct on eval).

**SPEC to land it (REQUIRED P4 item — no permanent fallback):** thread the per-level bound
surface frame through the recursive call's ARG-BINDING eval. Before driving a recursive nested
call, install the freshly-resolved surface's param frame as the caller/param frame
`matchCallableParams` binds args against — so `(@n - 1)` resolves against level N's `@n`,
producing level N-1's surface, etc. Mechanism candidates: (a) drive the nested call's arg eval
under the surface's `getScopeFrame()` pushed as the caller frame (not just `rulesContext`); or
(b) resolve+bind the recursive call's args at splice time against `entryFrame` before the sink
drive. Bounded by `callMap` (already terminates). SHARED hot call/arg-binding eval — measure
A/B before landing; no defensive slowdown on the common non-recursive path. Recursion is a
low-frequency Less loop idiom; sequencing, not abandonment.

## 6. Anti-backpedal / invariants (binding on the folds)
- No canonical mutation: the `kind` tag + captured surfaces are transient (§3 always-share); no
  `F_*` flag on a source node.
- No dual path for a COVERED shape: once ruleset-as-mixin folds, its ONE path is the spine; the eval
  special-case arm serves only DEFERRED shapes (guarded ruleset, nested-container body) + the byte-identical
  fallback, which dies in P4.
- Document-order assembly is the eval path's `compareCallableOutputPosition` reproduced by the existing
  `finish` sort — reuse it, don't reinvent.
- NEVER `git stash` / destructive git. Commit per fold on `work/p4-terminal-rework`. Do not push.
