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
3. **Match on the composed/implicit branch + an AMPERSAND-BOUNDARY MARKER (the load-bearing part).**
   Matching happens on the fully-composed ("implicit") selector — the parent is already baked into the
   branch (ast-v2 is compose-first via `composePath`), so it is NOT re-passed for keys. BUT the branch
   MUST carry a marker of **where the ampersand boundary is** (which segments/simples came from the
   parent-compose vs the ruleset's own-local), because the match's position relative to that boundary
   decides three DISTINCT behaviors (§3a). Parent context enters as this boundary marker, not as keySet
   bits. This is the reference's boundary-crossing logic (`detectAndHandleBoundaryCrossing`; the
   `extend-ampersand-boundary` tests).
4. **Bitset reject (corrected — no parent union).** Front-gate with the EXACT-mode gate
   `requiredKeySet(target) ∩ visibleKeySet(target)` subset test — NOT raw `keySet` (raw over-rejects
   `:is(.c,.q).a.b` ≡ `.a.b.c`, since `requiredKeySet` is empty for OR-parts). Partial path uses the
   `isDisjoint`/shares-atom prefilter (already correct in ast-v2, `solve.ts` `branchSharesAtom`). The
   parent-keySet UNION is **redundant** in the compose-first model (parent already in the composed
   branch) — drop it. O(1) reject; zero-extend docs short-circuit entirely.
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

### 3a. Ampersand-boundary rule (the hoist decision — from the composed branch + boundary marker)
Given the ampersand-boundary marker (§2.3), classify the match by its position relative to the boundary:
- Match falls **fully inside the ampersand(s)** (entirely the parent-composed part) ⟹ **NO effect** —
  the extend does not apply (matching only the inherited parent is not a match of this ruleset).
- Match **crosses** the boundary (part parent, part own-local) ⟹ **HOIST** the extended result to root.
- Match falls **entirely outside** the ampersand(s) (own-local only) ⟹ apply in place, **NO hoist**.
This is `EXTEND_RULES.md §5` + `detectAndHandleBoundaryCrossing`; the emit-layer hoist triggers already
exist (`emit.ts`), so this piece is "feed the boundary classification into the existing hoist," not new.

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
- **P4 (verify, not build) — ampersand boundary marker + hoist**: ensure the composed branch carries the
  boundary marker (§2.3) and the §3a three-way classification feeds emit's existing hoist. No new matcher
  parameter — the matcher needs no parent for correctness (compose-first); only the boundary marker.
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
