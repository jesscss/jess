# Extend: AST-v2 port design (the cohesive target)

Status: DESIGN for adversarial review, then piece-by-piece port. Not yet implemented.

This supersedes the hand-wavy parts of `EXTEND-4TH-OPTION-SYNTHESIS.md`. It is grounded in a
**verified reference algorithm** (not a prediction) and the owner-specified architecture. The task
is to **port the correct dual-cursor extend algorithm onto the AST-v2 flat `Branch` IR — smarter and
faster** — not to patch the current ast-v2 matcher (which is structurally wrong on `:is()`).

## 0. Why (the confirmed defect)

The current ast-v2 matcher (`packages/core/src/ast/extend/match.ts`) does NOT crawl into `:is()`.
Verified via the real pipeline:

```
.x:is(.a, .b) { color: red }
.y:extend(.x.a) { }
⟶  .x:is(.a,.b) { color: red }     ← .y NOT appended. WRONG.
```

Correct (asserted green in the reference `extend-selector-algorithm` spec):
`.x:is(.a,.b)` + full `.x.a` ⟶ `.x:is(.a,.b), .y` (the OR-branch `.a` combines with `.x` to a whole
match; extendWith appends as a SIBLING because the match spans the whole compound).

Root cause: `branchExpansions` (match.ts) only expands a **sole** `:is()` graft compound
(`simples.length === 1`), never `:is(.a,.b).x`; the match decision is string-key / multiset, not a
cursor walk. It is the "trash" engine. Increments A (linear fold), B (reorder), C (conflict guard)
are correct byte-identical patches on it, but they cannot give it the dual-cursor algorithm.

## 1. The verified reference

- **Behavior spec (green):** `extend-selector-algorithm.test.ts` — the dual-cursor / OR-fork /
  exhaustive-full-match rules. Ran live (subset): 71/71. Canonical cases:
  - `:is(.a,.b)` + full `.a` + `.c` ⟶ `:is(.a,.b,.c)` — match IS the whole `:is` ⟹ join the OR-branch.
  - `:is(.a,.b).c` + full `.a.c` + `.d` ⟶ `:is(.a,.b).c, .d` — match spans the whole compound ⟹ SIBLING.
  - `:is(a).info` + full `.info` ⟶ unchanged — partial-in-full reject (full match must be EXHAUSTIVE).
- **Bitset reject present:** `extend.ts:1415 isSubsetOf(find.requiredKeySet, target.keySet)`.
- **Parent bits enter via context:** `extend-roots.ts:663 parentSel.keySetLibrary ??= context.selectorBits`.
- NOTE the reference is NOT a single clean commit: `68e158bb7` (Apr) has the algorithm green but is an
  expensive **invisible-&-per-ruleset** dead side-branch; `98acd6d9d` (Jun, lean, in dev lineage) has
  16 failing extend tests (reference-import/ampersand). We port the **algorithm + the owner-specified
  architecture**, not any one commit's whole tree. `valueOf()` string compares pervade the reference —
  we replace them with structural/bitset compares (the "smarter/faster").

## 2. The cohesive design (what to port)

1. **IR** — the flat `Branch` IR (`ast/extend/ir.ts`): a branch is segments (`{comb, compound}`); a
   compound is `simples: (Text | {t:'is', branches})[]`. Canonical, plain-data, monomorphic.
2. **Matcher — dual-cursor, back-to-front, OR-forking.** Two cursors, one over the `target` (find) and
   one over the branch being tested, advancing **back-to-front**; at every OR fork (an `:is()` graft)
   **each cursor duplicates**, one per OR-branch, and a full match is any cursor path that reaches the
   front having consumed the target **exhaustively**. Structural comparison of simples (atom identity),
   never `valueOf()` strings. This replaces both `branchExactEquivalent` (opaque grafts) and the
   sole-graft `branchExpansions`.
3. **Match on the composed/implicit branch + a STRUCTURAL AMPERSAND-BOUNDARY MARKER (the load-bearing
   part).** Matching happens on the fully-composed ("implicit") selector — the parent is already baked
   into the branch (ast-v2 is compose-first via `composePath`), so it is NOT re-passed for keys. BUT the
   branch MUST carry a marker of **where the ampersand boundary is**, because the match's position
   relative to that boundary decides three DISTINCT behaviors (§3a).
   **LANDED (RUNG P-amp):** the marker is a per-SEGMENT `bnd: Int8Array` on `Branch` (`ir.ts`,
   pre-declared `undefined` in `mkBranch` beside `key` — one hidden class, no megamorphism): `bnd[i] === 0`
   is own-local, `k>0` is the k-th enclosing `&`-hop. `composePath` now **SPLICES the parent's segments in
   as separate `Seg`s** (a standalone `&` under `.outer .mid` yields the three matchable segments
   `.outer .mid .leaf`, never one embedded-space text simple — the pre-P-amp collapse that silently
   dropped a crossing extend) and stamps each output segment's origin. `branchText`/atoms/`textSimples`
   ignore `bnd`; `cloneBranch` copies it; serialization is byte-identical. The origin classifier is
   `classifyMatchBoundary(b, target, partial)` (`match.ts`) — it locates the matched span exactly as
   `applyInstruction` does and reads `bnd` over it → `'local' | 'within' | 'crossing' | 'none'`. This is
   the structural port of `detectAndHandleBoundaryCrossing` / `classifyExtendMatch`'s 3-way `MatchResult`.
4. **Bitset reject — parent atoms enter via the composed branch (compose-first), so no SEPARATE union.**
   Front-gate with the shares-atom prefilter (`solve.ts` `branchSharesAtom`, `plan.mayMatch`). NOTE the
   correction to the earlier "drop the parent union" wording: the parent atoms are **REQUIRED** in the
   available set — but because ast-v2 stays **compose-first** (`composePath` bakes the parent into the
   candidate branch before the reject runs), those atoms are already present in the composed seed the
   prefilter reads, so no *separate* parent-atom union is materialized. A future lazy matcher that defers
   the parent-splice would have to union the parent atoms explicitly (tree-v1 `extend-roots.ts:421`);
   full laziness is a **deferred perf follow-on** (RUNG P-amp kept compose-first — MUST-HAVE was correct
   output + the structural boundary, not the laziness). Do not regress the compose-gating. O(1) reject;
   zero-extend docs short-circuit entirely.
5. **Extend-roots integration.** The scope/reachability pass (which rulesets an extend reaches — self +
   descendant roots, never ancestors; `@media`/`@layer`/`@container` scoping) is the source of the
   parent context + bits and decides *where* the matcher runs. Port it alongside the matcher, not after.
6. **Perf discipline (V8 guardrails).** Cloning-free rewrite (reuse `match.ts`'s existing
   `rewriteBranchPartial`/`substitute*`), monomorphic `Branch` shapes (pre-declared fields — Increment
   A discipline), the linear fold (Increment A), **no invisible-&-per-ruleset** (context passed in,
   never materialized), no `valueOf()` on the hot path, cached branch keys.

## 2a. Pseudo-selector transparency (P0 must model this; verified against the reference)

Structured pseudos are NOT one kind. Two classes, different matching:
- **`:is()` (and `:matches()`) — TRANSPARENT / crossable.** The OR-branch content **splices into the
  surrounding compound/complex**: a match can start outside, enter a branch, and continue outside.
  `:is(.a,.b).c` is matched by `.a.c`. The graft is the crossable OR-fork.
- **`:where()`, `:not()`, `:has()`, … — SEALED / contained.** The argument is a nested selector-list the
  matcher may recurse INTO, but the match **cannot cross the pseudo boundary** into surrounding simples.
  Three verified behaviors (`extend-where-selector.test.ts`): (a) find matches the **whole pseudo unit**
  `:where(.a)` ⟹ sibling append `:where(.a), .b`; (b) find matches **inside** the args ⟹ extend adds to the
  arg list, **preserving the pseudo name** `:where(.a,.b)` (NOT `:is`); (c) `.foo:where(.a)` + `.a` ⟹
  `.foo:where(.a,.b)` — `.foo` stays outside, the match is contained. `:not()` matching-inside is further
  constrained (negation). So the structured pseudo carries `{ name, args: SelectorList, crossable: bool }`
  — `crossable` true only for `:is`/`:matches`; the matcher forks-and-crosses when crossable, else
  recurses-but-seals (and the whole-unit match is a third mode for both classes).

## 3. Output-shape rule (the intricate part, from the spec)

Where extendWith lands depends on what the match SPANS (per `EXTEND_RULES.md §3/§3a` + the reference):
- Match == a whole `:is()` **AND a single-segment branch** ⟹ **join the OR-branch**: `:is(.a,.b)`+`.c`
  → `:is(.a,.b,.c)`. (A sole graft that is one segment of a COMPLEX, e.g. `:is(.a,.b) .c` matched by
  `.b .c`, does NOT join — it is whole-branch, so SIBLING. The predicate is sole-graft-AND-single-segment.)
- Match spans the whole compound/selector (graft + siblings, or whole branch) ⟹ **comma SIBLING**:
  `:is(.a,.b).c`+`.a.c` → `:is(.a,.b).c, .d`.
- Partial (`all`) match of a sub-part ⟹ **`:is(matched, extendWith)` wrap** of just the matched span.
- Decide by **what the match produces** (does it span combinators / the whole compound?), never by AST
  type or path length (`EXTEND_RULES.md §3a`).

### 3a. Ampersand-boundary rule (the hoist decision — from the composed branch's `bnd`)
Given the per-segment `bnd` marker (§2.3), `classifyMatchBoundary` reads the matched span's origins:
- Match falls **entirely inside an ancestor `&`** (span all `bnd > 0`) ⟹ `'within'`. In tree-v1 this is
  "NO effect — the parent carries it and the child inherits via `&` at render." In **compose-first**
  ast-v2 the child was already composed against the *raw* parent, so the equivalent correct output is
  produced by the in-place substitution on the composed branch (a single-compound parent slot
  `.item .box` → `.item :is(.box, .z)`), OR — for a multi-branch / foreign-alias parent — by the emit
  layer FLATTENING and recomposing (trigger P). So `'within'` does **not** universally mean "no effect"
  under compose-first; it means "no *new* boundary is crossed by this rule's own selector."
- Match **crosses** the boundary (span mixed `bnd = 0` and `bnd > 0`) ⟹ **HOIST**.
- Match falls **entirely own-local** (span all `bnd === 0`) ⟹ apply in place, **NO hoist**.

**Hoist LEVEL — per-boundary, LANDED (owner review point).** tree-v1 always hoists to ROOT. Per-boundary
hoists to the nesting level of the crossed `&`, keeping the strictly-outer ancestors as wrappers. RUNG
P-amp landed the FLAT-mode structural fix (a crossing sub-span grafts in place — `.outer :is(.mid .leaf,
.z)` — byte-identical to always-root at root, since flat mode has no nesting). The **NESTED-mode**
per-boundary placement is now **implemented** (committed, owner-review-gated): `matchBoundarySpan` reports
the crossed span's `maxBnd` (the deepest ancestor `&` the match reaches); emit's **trigger C** detects the
multi-segment `all` sub-span crossing that triggers P (single-compound) and X (whole-branch) miss — and
that dev **silently dropped** in nested mode — and sets `NestedRulePlan.hoistBubble = maxBnd`; the
serializer's hoist queue **re-hoists** a `bubble > 1` entry up the ancestor chain (decrementing each level)
so it lands exactly `maxBnd` blocks up, with the flat solve's leading wrapper-ancestor segments STRIPPED
(the enclosing blocks re-supply them). Case G (`.outer { .mid { & .leaf } }` + `.z:extend(.mid .leaf all)`)
now renders `.outer { :is(.mid .leaf, .z) { … } }` — NO double-compose. No top-level hoist queue is needed:
a rule bubbling `k` levels from depth `D` lands via the ancestor at depth `D − k`, which drains at root when
`D − k == 0`.

**NOTE — the hoist distance is `MAX positive bnd` in the span, not `min`.** The earlier wording above said
`min positive bnd`; that is imprecise. A contiguous span that includes own-local (`bnd 0`) and reaches an
outermost ancestor `bnd = maxBnd` must clear ALL `maxBnd` crossed levels — hoisting only `min` would leave a
crossed ancestor both absorbed into the graft AND standing as a wrapper (a double-compose). For a
single-boundary crossing (the required Case-G / interior-`&` fixtures) `min == max`, so the distinction only
bites a match that crosses ≥ 2 nesting levels (a 3+-level nest whose target spans ≥ 2 ancestors); the landed
code uses `max` and an `extend-nested-boundary` fixture pins the `bubble = 2` re-hoist. This `max` vs
`min`/`always-root` choice is the standing **owner-review point**.

**Text-heuristic retirement (partial).** `classifyMatchBoundary` replaces the *match-span* input the old
triggers approximated with text prefixes. It does NOT by itself replace trigger X's `descendsFrom`, which
tests the **EXTENDER branch's** relationship to the parent header (does the appended sibling still nest
under the same parent?) — a fact the match-span `bnd` does not carry. A full retirement of
`descendsFrom`/`extendedParentHeader` therefore needs the extender-relationship modeled too; it is
sequenced with the nested-hoist placement work above, not landed in P-amp (the text triggers stay in
place and remain byte-identical on the whole corpus).

> **Standing note — nested output is the Jess default, per-boundary hoist is PRIMARY.**
> Jess renders **NESTED** by default (`collapseNesting:false`); nested extend placement and the
> per-boundary ampersand hoist above are first-class shipped behavior, **not deferrable** and not a
> flat-mode afterthought. The flat all-less/extend corpus is a testing convenience, not the target — do
> NOT treat the §3a hoist as "moot because no flat fixture hits it." It must be honored and tested (add
> nested fixtures where the corpus is a coverage gap).

## 4. Port pieces (re-scoped after adversarial review — most of the old ladder already exists)

Each piece: reference `extend-selector-algorithm` cases (and alpha `.css`, the real oracle) as ast-v2
acceptance tests FIRST (red), implement, green, byte-identity on the full extend corpus,
`perf-architecture-reviewer` sign-off, land.

- **P0 — STRUCTURED pseudo-selectors in the parser/AST (the prerequisite; IN SCOPE).** Today
  `SimpleSelector` is `{type,text,interp}` with NO structured args and there is NO `PseudoSelector`
  node; `branchFromComplex` carries `.x:is(.a,.b)` as one opaque text simple, so the OR-fork has nothing
  to fork on. Structuring it inside the extend engine (re-parsing the text) violates invariant 2/R1
  ("parser owns structure"), so the AST model + all 4 grammars must carry a structured pseudo node
  `{ name, args: SelectorList, crossable }` per §2a (`:is`/`:matches` crossable; `:where`/`:not`/`:has`
  sealed). Hard constraints: byte-identical serialization for the ~11K existing selector sites (the
  canonical text must round-trip), and this is its own adversarially-reviewed design + byte-gated build
  BEFORE P1 (it touches SimpleSelector, which is everywhere). **Blocks P1.**
- **P1 — ONE recursive OR-fork matcher** replacing THREE existing predicates (`branchExactEquivalent`,
  `branchExpansions`, `matchesWholeBranchSubset`) + the `target.segs.length>1` guard. Recursive descent
  carrying `(segIdx, simpleIdx)` by value + a remaining-find multiset, recursing into graft branches via
  the JS call stack (no cloned cursor objects → invariant 5), **memoized over `(pos, remaining-find
  signature)` → polynomial** (bounds the nested-`:is` cartesian; add a `guardMax`). Single-compound is
  the zero-graft case, so P1 covers old P1+P2. Structural comparison, no `valueOf()`.
- **P2 — wire the match SPAN-signal** into JOIN vs SIBLING (§3, local decision) and into the EXISTING
  substitution (`substituteSingleCompound`/`substituteMultiCompound`/`recurseIntoGrafts` already encode
  §3a partial-wrap) and the EXISTING emit hoist triggers (§3a boundary rule).
- **P3 (verify, not build) — bitset gate**: adopt `requiredKeySet ∩ visible` (drop the parent union);
  op-budget zero-on-extend-free + linear. The partial prefilter (`branchSharesAtom`) already holds.
- **P-amp (LANDED — nested hoist owner-review-gated) — structural ampersand boundary marker + hoist**: the
  composed branch carries the per-segment `bnd` marker (§2.3) via a parent-segment-splicing `composePath`,
  and `matchBoundarySpan`/`classifyMatchBoundary` give the §3a three-way verdict plus the crossed-span
  `maxBnd`. LANDED: (a) the FLAT-mode structural fix (a crossing sub-span grafts in place; Case G/F
  red→green; whole corpus — 721 core extend tests + all-less flat — byte-identical); (b) the **NESTED-mode
  per-boundary hoist** — emit trigger C (multi-segment sub-span crossing) → `NestedRulePlan.hoistBubble =
  maxBnd`, serializer re-hoist queue bubbles the rule `maxBnd` levels with the wrapper-ancestor prefix
  stripped; new `extend-nested-boundary` fixtures cover crossing at 1 level, 2 levels deep (Case G — no
  double-compose), 2 boundaries (`bubble = 2`), interior `&` (Case F), surviving sibling, within, and local;
  flat mode + tree-v1 oracle unchanged. STILL DEFERRED (owner-review-gated): the `max`-vs-`min`/`always-root`
  policy call (§3a NOTE) and the full retirement of `descendsFrom`/`extendedParentHeader` (needs the
  extender-parent relationship, not just the match-span `bnd`; triggers P/X remain in place). See §3a.
- **P5 (verify, not build) — scope/reachability** (`reaches`, media/layer scope, `referenceBoundary`)
  already exists in ast-v2 (`plan.ts`/`solve.ts`); confirm it still holds under the new matcher.

## 5. Gates
- The reference `extend-selector-algorithm` behaviors ported as ast-v2 red→green (the spec).
- Full ast-v2 extend corpus byte-identical (no regression) at every landing.
- `extend-op-budget`: zero matcher work on extend-free; linear growth; bitset reject fires.
- `perf-architecture-reviewer` evidence per invariant per piece (shapes, alloc, complexity, no valueOf).

## 6. Open questions for review
- Cursor representation on the flat IR: index-pair + graft-stack vs materialized position — which stays
  monomorphic + allocation-lean under the fork?
- Does P2's whole-`:is` vs whole-compound distinction need the parent context (P5), or is it decidable
  from the match span alone? (Sequence P2 before P5 only if independent.)
- Reference-import visibility + `@media` chain closure: keep eval-routed (as tree-v1 does) or fold in?
