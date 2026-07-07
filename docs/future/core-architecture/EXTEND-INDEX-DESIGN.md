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
Compound = List<Atom>                   -- CompoundSelector: ORDERED list, keeps dups; a SET only for MATCHING
Atom     = SimpleId                     -- interned .foo/#id/[attr]/::el/&-ref  (int)
         | Is Sel                       -- PseudoSelector(:is) — recursive, first-class
```
Interning reuses `keySetLibrary`/`selectorBits`. `Is` is a *constructor*, not an escape hatch — the
algebra closes on itself.

**Compound = DUAL representation (load-bearing).** A compound is a SET (order-independent): `.a.b` matches
`.b.a` — matching must never depend on atom order, and a bitset gives that for free (`(find & cand) === find`).
BUT a pure bitset loses order, and OUTPUT must be byte-identical to the oracle: `.b.a` must serialize as
`.b.a` (not re-sorted to `.a.b`), and `all`-mode substitution must put the extender in the MATCHED atom's
slot (`.b.a.c` find `.a` → `.b.x.c`, not `.x.b.c`). So a compound carries BOTH: a **match-bitset** (order-free
subset tests, the discovery hot path) AND an **ordered atom list** (used by rewrite + materialization to
preserve original order and substitution position). Matching reads the bitset; rewrite/output reads the list.

**DUPLICATES: the ordered list is a LIST, not a set — never dedupe it.** `.b.b.c` → list `[b,b,c]` (the
duplicate is syntactically real and must round-trip verbatim), match-bitset `{b,c}` (deduped — CORRECT,
because extend matching is set-containment not multiset: `.b.b.c` matches exactly the finds `.b.c` does).
Do NOT build `Compound` as a JS `Set` — that eats the dupe and breaks output. Whole principle in one line:
**the ordered list is the truth; the match-bitset is a lossy fingerprint (deduped + unordered) that is
exactly what matching wants.** Oracle-verify: a find with its OWN dupe (`.b.b`) is almost certainly treated
as `{b}` (set semantics) — confirm. And `all`-substitution when the found atom appears twice (`.b.b.c` find
`.b`) — which occurrence(s) get replaced — is oracle-defined; pin it, don't invent.

**DUP FULL-MATCH — OWNER-RULED: the walk is BUGGY here; do NOT enshrine it.** Two matching questions,
two semantics: PARTIAL/`all` = set-containment (dedup fine — "is the find INSIDE the target"); FULL/exact =
**consume-all / multiset** ("is the find EXACTLY the target — every target atom consumed"). A leftover dup
means NOT full. So `.b.b.c` find `.b.c` → **NOT_FOUND** (the 2nd `.b` is stranded) and `.foo.foo` find
`.foo` → **NOT_FOUND** (2nd `.foo` stranded). The current walk (`extendSelector`) gets `.foo.foo` right but
`.b.b.c` WRONG (returns FULL via a set-dedup shortcut that drops the stranded atom). The extend-corpus agent
faithfully reverse-engineered that quirk into `compoundFullEligible` (`full ⟺ dedup-set-equal AND (counts
equal OR ≥2 distinct classes)`) — **that is reproducing a bug and must be REPLACED** with the correct rule:
`full ⟺ target atoms all consumed (multiset-equal)`. The prototype should DELIBERATELY DIVERGE from the walk
on `.b.b.c` find `.b.c`, and `extend.ts` (the walk) has a real dup-full bug to fix separately.

**METHODOLOGY (load-bearing — the walk is NOT ground truth):** byte-identical-to-`extendSelector` is the
gate for REAL cases, but where the walk is wrong, matching it reproduces the bug. So a prototype↔walk
divergence is OWNER-ARBITRATED: usually "fix the prototype," sometimes "the walk is wrong — prototype does
the correct thing, walk gets fixed." Track those as `EXPECTED-DIVERGENCE` cases (prototype asserts the
CORRECT output, not the walk's) + a walk-bug list. This makes the prototype a walk-bug FINDER, not a replica.

## Representation lifecycle — a cached PROJECTION, not the parse-time primary rep
The IR is DERIVED and transient — computed lazily (at latest, when extend lifts the scoped set) and cached
on the selector. It is NOT the selector's primary representation, and should NOT be built at parse time as
the sole shape. Why the node tree stays primary:
- **Selectors aren't concrete until eval** — `.@{name}` interpolation has no interned id at parse, only after
  eval. Extend runs post-eval, so lifting there sees concrete selectors for free.
- **The node tree serves consumers the IR deliberately discards**: authored trivia/comments (round-trip),
  source spans (sourcemaps), interpolation placeholders, casing, plugin/visitor walks, positioned errors.
- So: node = primary; IR = lazily-computed **cached projection** — which is what `keySetLibrary`/`selectorBits`
  already is (the match-bitset half already lives on the node). Compute once, reuse across every extend
  iteration, ignore for other consumers.

Serialization is HYBRID: extend-**generated** selectors (no authored trivia) serialize straight from the IR
catamorphism; **original** selectors serialize from their node (trivia-faithful). Future (measure-gated only):
pre-intern the static-only fingerprint at parse and finalize at eval — pursue ONLY if the lift shows up hot.

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

### `&` crossing — VERIFIED representation + TWO extra gates (differential-probed, 2026-07-06)
- **Representation confirmed:** post-eval `&` is NOT flattened — it stays an `Ampersand` node holding a
  parent REFERENCE (`_selectorContainer.selector`, read via `getResolvedSelector()`); composition is on
  demand. The doc's graft model is correct. The oracle classifies crossing via a **two-probe differential**
  (`checkAmpersandCrossingDuringExtension`, extend.ts:3384): build the RESOLVED form (graft parent at the `&`
  position) and the EMPTY form (drop `&` + trailing implicit-space combinator); `crossed ⇔ find matches
  RESOLVED ∧ ¬find matches EMPTY`. Reproducible in-IR with ZERO node cloning (bitset subset tests over the
  lifted parent) — vs the oracle's two `selectorCompare` calls on fully-materialized `copySelectorTreeForExtend`
  clones. **Future-slim signal:** the oracle's per-amp double-clone+compare is heavier than the semantics need.
- **Gate 2 (STANDS) — simple-find parent-only → NOT_FOUND** (extend.ts:1589 full-skip + :1622 partial
  whole-location gate): a simple find matching ONLY the parent portion (`&.bar` parent `.foo`, find `.foo`
  — reachable from `.foo { &.bar {} }`) collapses to `NOT_FOUND` (both modes) — "parent-only" is `NOT_FOUND`
  for simple finds, not a plain drop. Input is well-formed → real semantics.
- **Gate 1 (WITHDRAWN — invalid-input artifact, do NOT encode).** The reported "relative-partial downgrade"
  came from a hand-built subject `sel([co('>'), compound([&→.parent, .child])])` — a ComplexSelector STARTING
  with a bare `>` combinator, i.e. a root-level leading-combinator selector, which is NOT a valid/reachable
  shape (a real `.parent { > &.child }` composes to `.parent > .parent.child` or lives nested; it never
  reaches extend as a dangling-`>` standalone). jess is lenient (renders root-level `> .child`), so the
  malformed input produced output and the differential matched it — but it documents undefined behavior, not
  a rule. Purge the case + its `gatedInPlace` handling.
- **METHODOLOGY (load-bearing): differential inputs MUST be reachable + well-formed.** Hand-built `el()/sel()`
  subjects are safe only for context-free shapes. For `&`/nesting/combinator cases, validity depends on
  context, so DERIVE the subject from real Less source through parse→eval (the actual selector the engine
  sees), never assemble a leading-combinator/detached subject by hand. Otherwise the oracle's behavior on an
  unreachable input gets mistaken for spec (that is exactly what produced the withdrawn Gate 1).

## Rewrite (closed constructor ops — stays in the IR)
Only three outcomes, all landing back in the algebra:
1. add an OR-branch (`Or` gains a `Seq`);
2. swap atoms in a compound (`(c \ findAtoms) ∪ extendAtoms`, bitset op) or wrap (`∪ {Is(extendWith)}`);
3. hoist (emit a `Seq` into the ROOT `Or` instead of this level) — routing, still a `Seq`→`Or`.
So the fixpoint runs entirely on the IR.

## Target index — many rules, one target (where the index BEATS the walk)
The index node for a find-pattern holds a **bucket** of `(extendWith, mode)`, not one. `.x:extend(.btn)`,
`.y:extend(.btn)`, `.z:extend(.btn)` → the `.btn` leaf = `[.x, .y, .z]`; one match against a `.btn`-satisfying
compound fires all three in a single lookup and fans out to three OR-branches. The walk re-scans the corpus
once per instruction (M passes); the index inverts it — group by target, one pass, fan out per match. This is
the indexed generalization of `applyExtendsToSelector`'s existing same-target batch.

## Fixpoint
Worklist: seed with all Seqs; a produced/changed Seq (including an `Is` payload) is pushed and queried
once against only the targets its content routes to (Set-Trie). Transitive closure by dataflow — no full
re-scan per round (this is the principled form of the landed "pass-scoped memo + target index" O(I²) fix).

## Materialize once
Catamorphism `Sel → SelectorNode → string`, reusing the existing generated-`:is()` unwrap + placement
formatting. Only step that touches nodes.

## Global flow — lift once, fixpoint in IR, materialize once (integration with `processExtends`)
The per-call `extendByIndex` contract (below) is for DIFFERENTIAL VALIDATION only (one selector × one find ×
one extendWith, vs the oracle). The real integration — what actually delivers "stay in the IR until done" —
is a global flow that replaces `processExtends`'s **apply** loop (the **gather** of which extends exist +
their scope stays):
1. **Lift once** — at `processExtends` entry (post-eval; selectors concrete), lift every in-scope selector
   into IR. The ONLY node→IR crossing.
2. **Build the target index once** — all extend rules → Set-Trie/automaton, each node a bucket of
   `(extendWith, mode)` (see Target index).
3. **Scope-bucket** — partition selectors × targets by scope (media / import / `&`-boundary) so a target only
   queries in-scope selectors; scope becomes a bucketing precondition, OFF the per-match hot path.
4. **Worklist fixpoint, entirely in IR** — drain the queue: match → rewrite (new / hoisted Seqs) → push
   changed Seqs → repeat. Same-target fan-out, chained extends, and "all extends applied in a row" are ALL
   just the queue draining. Zero node allocation per round.
5. **Materialize once** — fold each rule's IR `Or`-set → nodes → strings (hybrid, per Representation lifecycle).

Validation order: prove per-call parity on the case ladder FIRST (the current build); THEN wire this global
flow and re-validate against full-render output (`all-less` byte-identical).

## Build plan (parallel + oracle-validated)
- New module `packages/core/src/tree/util/extend-index.ts` exposing
  `extendByIndex(target, find, extendWith, partial): ExtendSelectorSurface | 'NOT_FOUND'` — the SAME
  contract as `extendSelector`. Reuse the existing fold surgery where practical; the point is discovery.
- Differential test `packages/core/src/tree/util/__tests__/extend-index-differential.test.ts`:
  for each case run both `extendSelector` (ORACLE) and `extendByIndex`, assert `str(mine) === str(oracle)`
  (`.valueOf()`), using the existing builders (`el`, `sel`, `sellist`, `compound`, `is`, `co`).
- **Case ladder** (add one at a time; each new case tells you which layer is missing):
  1. exact single compound — `extendSelector(el('.a'), el('.a'), el('.b'), false)` → `(.a, .b)`
  1b. **compound is a SET** — `.a.b` find `.b.a` MUST match (order-free); and output must PRESERVE order:
      corpus `.b.a` stays `.b.a`, and `all` substitution keeps the slot (`.b.a.c` find `.a` → `.b.x.c`)
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

## PROTOTYPE STATUS (2026-07-06) — own-construction validated, delegation OFF
All prototype files live in `packages/core/src/tree/extend/` (sibling to `util/`; the real extend engine
stays in `util/`). Not exported → bundle-excluded.
- **`extendByIndexOwn` CONSTRUCTS output itself** — no `extendSelector`/`applyExtendsToSelector` fallback;
  cloning-free (no `.clone()`/`composeSelector`/`copySelectorTreeForExtend`/`selectorCompare`). Unbuildable
  shapes return an exported `UNSUPPORTED` sentinel (fail-loud, never silent delegation).
- **Real-corpus proof (delegation off):** copies of the existing extend suites drive `extendByIndexOwn`,
  byte-compared to the `extendSelector` oracle (`corpus-harness.ts`, throws on any MISMATCH). Own-engine PASS:
  simplified 12/13, algorithm 25/35, combinator 7/7; 132 tests green across `tree/extend/`, full extend
  suite 529 pass / 0 fail (no regressions). **The thin cloning-free construction reproduces the walk
  byte-identically on every covered case** — the core validation of the whole idea, for the non-graft set.
- **`processExtendsByIndex`** (design + core prototyped): lift scoped selectors → IR worklist fixpoint
  (fire-once, chained/transitive) → materialize once; differential-tested vs `applyExtendsToSelector` 8/8
  incl. `.a→.b→.c→.d`. Scope = bucketing precondition. Not yet wired to `context`/`&`-hoist (honest: own
  construction doesn't build `&`/`:is`-graft outputs yet, so wiring would just relay `UNSUPPORTED`).

### NEXT RUNG — the UNSUPPORTED frontier (why each is gated, not wrong)
1. **Extending INTO a graft target** — `find`/target is `:is(...)`/`:not(...)`/pseudo-with-selector-arg;
   needs graft-aware recursion INTO the branch (the discovery already recurses for `:is` on the subject
   side; this is the extend-INTO side).
2. **Remainder-splitting** — `.a>.b.c` find `.a>.b` partial → oracle emits `.a>.b.c, .c.d`; the own
   construction doesn't yet split the unmatched remainder into a sibling.
Both gate cleanly to `UNSUPPORTED`. Closing them + wiring `processExtendsByIndex` to `context`/`&`-hoist is
the path to full corpus coverage and the end-to-end cloning-free win.

## Non-goals (for the validated prototype)
Minimal-hoist (output change); replacing the walk (only after full-suite byte-identical); touching the
existing `extendSelector`/fold beyond what the parallel path reuses.
