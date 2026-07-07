# Extend as a closed term-rewriting system over a selector IR (design + build spec)

**Status:** design / prototype. Built PARALLEL to the existing walk (`extendSelector` in
`packages/core/src/tree/util/extend.ts`), validated by a differential oracle test — NOT a replacement
until it's byte-identical across the whole extend suite. Discovery is replaced; the *idea* is that match
AND rewrite both happen on one IR and iterate to fixpoint without round-tripping to selector nodes.

## Why (the thesis)
Extend is a **term-rewriting system**: rules `find → extendWith` applied to a corpus of selectors to
fixpoint (chained extends). The walk is subject-driven (for each selector, test each target → N×M).
This design is index-driven (build one index over the targets, let each subject's content jump to its
matches) and keeps the whole match→rewrite→match fixpoint in one IR, materializing to nodes ONCE.

The load-bearing property: **extend's rewrite is closed over the IR algebra** — every extend outcome is
one of a few constructors of the algebra, so once lifted into the IR you never leave it until output.

## The IR (a regular tree algebra — 1:1 with existing node types)
```
Sel      = Or [Seq]                     -- SelectorList (OR branches)
Seq      = [ (Combinator, Compound) ]   -- ComplexSelector (positional; combinator precedes each compound)
Compound = Set<Atom>                    -- CompoundSelector (unordered)
Atom     = SimpleId                     -- interned .foo/#id/[attr]/::el/&-ref  (int)
         | Is Sel                       -- PseudoSelector(:is) — recursive, first-class
```
Interning reuses `keySetLibrary`/`selectorBits`. A compound is a bitset over SimpleIds (plus any `Is`
atoms). `Is` is a *constructor*, not an escape hatch — the algebra closes on itself.

## Matching is a GRAPH, not tree recursion (seams)
A selector compiles to a match-graph (NFA): compound positions = states, combinators = transitions,
and two **seam** types are transitions with a crossing predicate. Match = trace the (back-to-front)
find-pattern as a valid path; bit-parallel NFA simulation (Glushkov / nrgrep bitset) — linear Shift-And
is the fork-free special case. The Set-Trie answers, per state, "which target pattern-symbols does this
compound satisfy" (subset query), feeding the NFA.

### Seam table (the full matching + fold spec)
| seam | match traversal | fold, by matched-span position |
|---|---|---|
| combinator (`>`,`+`,`~`,` `) | free | — |
| `:is(...)` | **tail** = graft, rooted at the parent position, traversable both ways (anchor / continue-right / continue-left-into-parent); **head** = one-way **WALL** (can enter the branch leftward from the tail, cannot exit the head into the parent's left neighbor) | matched simples in a compound → replace with `Is(extendWith)`; complex→complex gobbles the boundary compound each side into the `:is()` |
| `&` (implicit space / implicit-none-if-explicit-combinator / explicit, **at ANY position** e.g. `.b > &`) | free across the graft (parent Seq splices in at the `&` position) | **child-only** span → in-place (extender stays nested under parent) · **crosses seam** → **HOIST to root** (extender becomes top-level sibling; matches current engine) · **parent-only** span → **DROP** (it's a match on the parent, extended there; ignoring avoids double-extension) |

Symmetry to preserve: the `:is()` head-wall and the `&` parent-only-drop are the same "a match confined
to the inner/parent region is not a real match at this level" rule, enforced at two points.

`:is()` unwrap: a generated single-item `:is(.d)` materializes to bare `.d` — carry a `generated` bit on
`Is` atoms; the materialization catamorphism applies the existing unwrap/format rules (F_GENERATED etc.).

### Nesting / `&` details
- EVERY nested rule has a `&` at its head (implicit-space if no leading combinator; implicit-none if an
  explicit combinator leads; explicit if written) — so the `&`-graft chains recursively up the nesting.
- `&` can be interior (`.b > &` ⇒ `.b > <parent>`); the graft splices the parent Seq at the `&` position,
  child material may sit on BOTH sides. Span classification (child-only / crossing / parent-only) is by
  whether the matched span touches child material, parent-graft material, or both.
- **Hoist depth:** current engine hoists to ROOT on ANY crossing → replicate that for byte-identical
  parity. (Minimal-hoist — up to only the outermost crossed seam — is a future, output-CHANGING nicety;
  needs owner sign-off, out of scope for the oracle-validated build. Model it as: rewrite output carries a
  `placement` target; today it's binary {this-level, root}, minimal-hoist would make it level-indexed.)

## Rewrite (closed constructor ops — stays in the IR)
Only three outcomes, all landing back in the algebra:
1. add an OR-branch (`Or` gains a `Seq`);
2. swap atoms in a compound (`(c \ findAtoms) ∪ extendAtoms`, bitset op) or wrap (`∪ {Is(extendWith)}`);
3. hoist (emit a `Seq` into the ROOT `Or` instead of this level) — routing, still a `Seq`→`Or`.
So the fixpoint runs entirely on the IR.

## Fixpoint
Worklist: seed with all Seqs; a produced/changed Seq (including an `Is` payload) is pushed and queried
once against only the targets its content routes to (Set-Trie). Transitive closure by dataflow — no full
re-scan per round (this is the principled form of the landed "pass-scoped memo + target index" O(I²) fix).

## Materialize once
Catamorphism `Sel → SelectorNode → string`, reusing the existing generated-`:is()` unwrap + placement
formatting. Only step that touches nodes.

## Build plan (parallel + oracle-validated)
- New module `packages/core/src/tree/util/extend-index.ts` exposing
  `extendByIndex(target, find, extendWith, partial): ExtendSelectorSurface | 'NOT_FOUND'` — the SAME
  contract as `extendSelector`. Reuse the existing fold surgery where practical; the point is discovery.
- Differential test `packages/core/src/tree/util/__tests__/extend-index-differential.test.ts`:
  for each case run both `extendSelector` (ORACLE) and `extendByIndex`, assert `str(mine) === str(oracle)`
  (`.valueOf()`), using the existing builders (`el`, `sel`, `sellist`, `compound`, `is`, `co`).
- **Case ladder** (add one at a time; each new case tells you which layer is missing):
  1. exact single compound — `extendSelector(el('.a'), el('.a'), el('.b'), false)` → `(.a, .b)`
  2. subset in a compound (`all`) — `.b.c` find `.b` → `.b.c, <ext>.c`
  3. position in a sequence — `.x .b` find `.b`
  4. multi-compound sequence find — `.x .b` find `.x .b`
  5. `:is()` graft + head-wall — the `a > :is(x + b).d > c` matrix
  6. `&`: child-only / crossing→hoist / parent-only→drop (incl. interior `&` `.b > &`)
  7. `all`/partial vs exact
  8. chained fixpoint (target→ext→target)
  9. deep nesting + hoist depth
- Existing oracle-shaped tests to mine: `extend-unit.test.ts`, `extend-simplified-cases.test.ts`,
  `extend-selector-algorithm.test.ts`, `extend-combinator-handling.test.ts`,
  `extend-ampersand-boundary.test.ts`, `find-extendable-locations.test.ts`.
- Gate: differential test green for each landed case; core suite unaffected (new files only). No push.

## Non-goals (for the validated prototype)
Minimal-hoist (output change); replacing the walk (only after full-suite byte-identical); touching the
existing `extendSelector`/fold beyond what the parallel path reuses.
