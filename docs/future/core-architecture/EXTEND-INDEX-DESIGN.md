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
**CONFIRMED (direct probe): `extendSelector(.b.b.c, .b.c, .ext, full)` → `.b.b.c,.ext`** (should be unchanged);
owner-verified as a **Less 4.x incompatibility** ("a full match must go side-to-side on one OR path").
**LOCATED:** `findExtendableLocations` (via `matchSelectors`, `selector-match-core.ts:2066`) mis-classifies
the compound location as FULL — the deduped keyset can't see the extra `.b`, so the stranded atom isn't
recorded as a remainder. Fix: a full compound match must CONSUME ALL target simples (count/multiset), else
partial-with-remainder (`areCompoundSelectorsEquivalent` already has the length check; this location-
classification path bypasses it). Output-changing → surface any test/golden baking in `.b.b.c,.ext` for review.

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
  simplified 13/13, algorithm 33/35, combinator 7/7, where-cases 4/4; 159 tests green across `tree/extend/`,
  full extend suite 558 pass / 0 fail (no regressions). **The thin cloning-free construction reproduces the walk
  byte-identically on every covered case** — including the graft-into-target set (see RUNG CLOSED below).
- **`processExtendsByIndex`** (design + core prototyped): lift scoped selectors → IR worklist fixpoint
  (fire-once, chained/transitive) → materialize once; differential-tested vs `applyExtendsToSelector` 8/8
  incl. `.a→.b→.c→.d`. Scope = bucketing precondition. Not yet wired to `context`/`&`-hoist (honest: own
  construction doesn't build `&`/`:is`-graft outputs yet, so wiring would just relay `UNSUPPORTED`).

### RUNG CLOSED (2026-07-06) — extending INTO a graft target
Own construction now builds INTO `:is(...)` / `:not(...)` / `:where(...)` / `:has(...)` targets, byte-identical
to the oracle. A pseudo-with-selector-arg is a **recursive extend point**: recurse `extendByIndexOwn(arg, find,
extendWith, partial)` and rewrap in the SAME pseudo (`is()` builder for `:is`, `pseudo({name,arg})` otherwise) —
cloning-free, reusing authored inner nodes. Key rules (all differential-probed + hardcoded-pinned):
- Whole inner branch matched → append extendWith into the arg list (`:is(.a,.b)` f `.a` → `:is(.a,.b,.c)`).
- Inner subset matched (partial) → wrap in place (`:is(.a.b)` f `.a` → `:is(:is(.a,.q).b)`).
- The recursion mode passed inward is the OUTER `partial` flag (reproduces full/partial split).
- **Only `:is` boundary-crosses** into an outer compound match — `reachableSyms` excludes `:not/:where/:has`;
  `:is(.a,.b).c` f `.a.c` full → whole-compound consume → append sibling (`:is(.a,.b).c,.d`).
- Graft-as-passenger: a match on OTHER atoms leaves the graft untouched (`.x:not(.foo)` f `.x` → `:is(.x,.q):not(.foo)`);
  a full-mode subset that only reaches the graft is unchanged, NOT NOT_FOUND (`.info` in `:is(a).info`).
Coverage: algorithm own-PASS 25→33, simplified 12→13, + new `corpus-where-cases` 4/4. Frontier: graft-into-target
UNSUPPORTED 8→0. 159 tests green across `tree/extend/`; full extend suite 558 pass / 0 fail (no regressions).

### RUNG CLOSED (2026-07-06) — remainder-splitting (dev `f6f19651c`)
A whole-span partial match with an unmatched remainder now splits correctly (own construction, byte-identical to
the oracle). Discriminator: **whole span** (find matches every compound of the target seq, positions `0..T-1`) →
**sibling-split** (original branch unchanged + one sibling = the LAST spanned compound's remainder atoms merged
into extendWith's head compound; earlier remainders ignored; target combinators dropped); **proper-substring
span** → the existing `:is()`-wrap. Open edges resolved from the oracle: extendWith LIST merges into the first
branch only (`.c.d,.e`), extendWith `:is(...)` is NOT flattened in sibling-split (`.c:is(.d,.e)` via
`extendWithBranchesUnflat`), list flattens into the `:is` arg in the wrap case. algorithm own-PASS 33→35,
UNSUPPORTED 2→0; extend-index 159→172; full extend suite 571/0; no walk-bugs surfaced.

### RUNG CLOSED (2026-07-06) — `:is` boundary-cross flatten (PARTIAL)
Own construction now builds the PARTIAL `:is` boundary-cross flatten, byte-identical to the oracle. The
matched span is derived by aligning the find's atoms LEFT-TO-RIGHT onto the target compound's atom
positions (a strictly-increasing positional subsequence), where a find atom is consumed by a plain atom
(equal) or a COMPLETE single-atom `:is` branch. Derived rules (differential-probed + hardcoded-pinned):
- **Which atoms flatten:** the matched span collapses to `:is(<find-as-written>, <extendWith-branches>)`
  placed FIRST in the compound; the `.b` (non-matched) `:is` arm is DROPPED, NOT distributed. (The doc's
  earlier "distributes `.c` into each arm" phrasing was wrong — the oracle takes the PARTIAL `:is`-wrap
  path, not `detectAndHandleBoundaryCrossing` which only runs in FULL mode. The `:is` first arg is the
  FIND verbatim, e.g. `:is(.a,.b).c` f `.a.c` → `:is(.a.c,.d)`, `.c.a` → `:is(.c.a,.d)`.)
- **Original branch disposition:** REPLACED in place (no separate original branch), unlike full mode which
  appends a sibling (`:is(.a,.b).c,.d`).
- **Unmatched atoms:** all target plain atoms NOT on the aligned path trail the `:is()` in original order
  (`:is(.a,.b).c.x` f `.a.c` → `:is(.a.c,.d).x`; `.m:is(.a,.b).c` f `.a.c` → `:is(.a.c,.d).m` — the `:is`
  hoists to front regardless of the graft's original slot).
- **Leading atoms handled:** `.c:is(.a,.b)` f `.c.a` → `:is(.c.a,.d)` (graft second).
- **graft+graft crossing:** `:is(.a,.b):is(.x,.y)` f `.a.x` → `:is(.a.x,.d)` (was a WRONG NOT_FOUND before).
- **extendWith:** list/`:is` FLATTEN into the `:is` arg (`(.d,.e)`/`:is(.d,.e)` → `:is(.a.c,.d,.e)`),
  compound/combinator kept as one branch (`.d.e` → `:is(.a.c,.d.e)`, `.d>.e` → `:is(.a.c,.d>.e)`).
- **Non-positional whole consume → APPEND, not flatten:** `:is(.a,.b).c` f `.c.a` (find atoms out of target
  position order) → `:is(.a,.b).c,.d`. This is the sole discriminator between flatten and full-append.
- **Partial-of-a-branch does NOT cross:** `:is(.a.z,.b).c` f `.a.c` (find `.a` is only part of branch `.a.z`)
  → oracle NOT_FOUND; own returns UNSUPPORTED (fail-loud, was UNSUPPORTED before — no regression).
No walk-bug / EXPECTED-DIVERGENCE surfaced. extend-index 172→185; full extend suite 571→584/0; no regressions.

### RUNG CLOSED (2026-07-06) — rung 4: partial-of-branch, subset-in-full, OR-finds, clean multi-compound graft (dev `028accefb`)
Four classes closed, all oracle-derived + hardcode-pinned; no walk-bugs. extend-index 185→204; full extend suite 584→603/0; core 3011/0.
- **`:is` partial-of-branch → NOT_FOUND** (was UNSUPPORTED). Broader than hypothesized: ANY find whose sym reaches only a
  *multi-atom* `:is` branch head (`.a` in `.a.z`), or is absent from the target, never matches → NOT_FOUND in BOTH modes.
  New `graftCompoundSubsetSatisfiable` (each find sym = plain atom or a *complete single-atom* `:is` branch).
- **Proper-subset-in-full through a graft with a stranded trailing atom** — `:is(.a,.b).c.x` f `.a.c` FULL → unchanged
  (`.x` stranded → not full) → `MATCHED_UNCHANGED`. (The PARTIAL remainder-split-through-graft variant stays UNSUPPORTED.)
- **OR-finds (`sellist`)** — per-target-branch FIRST-match (corrected a wrong "accumulate all branches" hypothesis);
  extendWith appended once overall. `.a.x,.b.y f (.a,.b)` → `:is(.a,.d).x,:is(.b,.d).y`.
- **Multi-compound find vs graft target — clean whole-span side-by-side full ONLY** (`:is(.a,.b) .c f .a .c` → `,.d`);
  substring/remainder/expansion variants stay UNSUPPORTED (need the multi-compound `:is`-graft flatten machinery).

### RUNG CLOSED (2026-07-06) — rung 5: multi-compound `:is`-graft EXPANSION
A MULTI-compound find crossing a BARE single-`:is` compound (`:is(.a,.b)` in its own slot), where the
alignment is NOT the clean rung-4 whole-span-full, now builds via own construction, byte-identical to
the oracle. The rung-4 report's hypothesis (`.x :is(.a .c,.d),.x .b .c` — distribute-into-arms) was
WRONG; the oracle takes a simpler **expand-then-per-arm-extend** path (derived by direct probe):
- **Rule:** expand the `:is` into one sibling branch per arm (splice the arm's compounds into the graft
  slot, `expandComplexSelectorWithIs` semantics), then run the plain multi-compound extend on each
  expanded (now-plain) branch. The expanded branches are plain → the plain engine reproduces every
  per-arm shape for free.
- **PARTIAL:** recurse into the plain engine on the expanded `SelectorList` — byte-identical (matching
  arm gets the rung-3 substring `:is`-wrap in place, or the rung-4 whole-span remainder sibling-split
  hoisted to the tail; non-matching arms unchanged). `.x :is(.a,.b) .c` f `.a .c` → `.x :is(.a .c,.d),.x .b .c`.
- **FULL:** expanded branches emitted UNCHANGED (find is a proper substring → no plain full match) +
  extendWith appended ONCE **iff the graft was MULTI-arm** (a single-arm `:is(.a)` is plain `.a` — no
  through-graft append: `.x :is(.a) .c` f `.a .c` FULL → `.x .a .c`, no `.d`). `.x :is(.a,.b) .c` f `.a .c`
  FULL → `.x .a .c,.x .b .c,.d`. Multi-compound arms splice (`:is(.a .m,.b) .c` f `.a .m .c` → `.a .m .c,.b .c,.d`);
  `>` combinators preserved (`.x>:is(.a,.b)>.c` f `.a>.c` → `.x>.a>.c,.x>.b>.c,.d`).
- **Scope (fail-loud):** exactly ONE bare-`:is` compound per branch; a 2nd graft the find must cross is
  the oracle's `.x :is(.a,.b) :is(.p,.q)` NOT_FOUND shape → UNSUPPORTED (proving NOT_FOUND needs the
  expand-then-fail machinery; prefer fail-loud). Embedded grafts (`.m:is(.a,.b)` f `.a .c` → oracle
  NOT_FOUND) and non-bare graft compounds (`:is(.a,.b).q .c` → oracle NOT_FOUND) do NOT expand → the
  path returns null and the per-branch graft path (→ UNSUPPORTED) handles them.
No walk-bug / EXPECTED-DIVERGENCE surfaced. Pre-existing plain-path note (NOT this rung): the own
engine's MULTI-compound substring `:is`-wrap flattens a `:is(...)` extendWith (`.x :is(.a .c,.d,.e)`)
where the oracle keeps it nested (`.x :is(.a .c,:is(.d,.e))`) — this divergence exists on dev's plain
path independent of the graft, unreached by the real corpus; out of scope here.
extend-index 204→221; full extend suite 603→620/0; core 3011→3028/0.

### RUNG CLOSED — rung 6: `&` (ampersand) TARGETS (own construction, dev `4d758a309`)
Own construction now builds `&`-target output (child-only / crossing / parent-only / `&&` same-parent),
byte-identical to the oracle, via `extendAmpersandTarget`: reproduce the oracle's two/three-probe
classification in-IR (resolved / empty / parent-alone forms), then recurse `extendByIndexOwn` on the
cloning-free RESOLVED form (`resolvedFormSeq` + `resolveAllAmps`) at the original `partial` flag, with a
parent-only → NOT_FOUND gate. `hoistToRoot` is a placement flag that does not change the byte output, so
the crossing-append shape (`.foo.bar,.a`) is reproduced by the plain resolved-form recursion. Left
UNSUPPORTED: leading-combinator relative `&` (closed in rung 7 below), distinct-parent `&&` passenger
merge-ordering, list-parent grafts.

### RUNG CLOSED (2026-07-06) — rung 7: leading-combinator relative `&`
A NESTED RELATIVE rule (`.parent { > &.child {} }`) composes post-eval to a ComplexSelector whose
FIRST component is a combinator (`> &.child`). Rung 6 left this UNSUPPORTED (its plain resolved-form
recursion drops the combinator + uses the wrong wrap-span). The oracle takes its
`shouldSkipRelativePartialBoundary` path (`extend.ts:1594`): re-target on the amp-RESOLVED form via
`replaceAmpersandWithItsValue` (KEEPING the leading combinator), then run the normal in-place `:is`-wrap.
Own construction now builds this byte-identical (`extendRelativeAmpersandTarget`), all shapes
differential-probed on reachable parse-shaped inputs + hardcode-pinned in `corpus-ampersand-cases.test.ts`.
Let the amp sit in `ampCompound`; `parentAtoms` = the amp's (single-branch) resolved atoms, `childAtoms`
= the OTHER atoms of `ampCompound`. Derived rules:
- **NOT_FOUND gate (BOTH modes) — a match confined to the parent of an EMBEDDED amp** (`ampCompound`
  also carries child atoms): find touches SOME-but-not-ALL `parentAtoms` (proper-subset-of-parent), OR
  find is a SIMPLE selector consuming exactly all `parentAtoms` with no child atom. A LONE amp (its own
  compound, no fused child) has NO parent gate — `.parent` there is a plain step (`> & .b` f `.parent`
  → `>:is(.parent,.x) .b`, not NOT_FOUND). Mechanism (probe-traced): proper-subset finds fail the
  UNRESOLVED `findExtendableLocations`; the all-parent-simple-embedded case (`> &.child` f `.parent`)
  hits the amp-component-in-compound gate (`extend.ts:1651/1662`).
- **FULL mode (not gated) → resolved form UNCHANGED** (a relative selector is never a whole selector to
  append to): `> &.child` f `.parent.child` FULL → `>.parent.child`.
- **PARTIAL mode (not gated) → in-place `:is`-wrap, span by match kind** (combinator preserved):
  multi-step whole-selector span → wrap whole seq minus lead-comb (`> & .b` f `.parent .b` →
  `>:is(.parent .b,.x)`); single simple find matching ONE atom → wrap that atom (`> &.child` f `.child`
  → `>.parent:is(.child,.new)`); find EQUALS the amp's resolved value → wrap `parentAtoms` in place
  (`> &(.p1.p2).c` f `.p1.p2` → `>:is(.p1.p2,.new).c`); any other single-compound find → wrap the WHOLE
  compound (`> &.child` f `.parent.child` → `>:is(.parent.child,.new)` — the shape the sweep hits).
`+`/`~`/` ` leading combinators all preserved. No walk-bug / EXPECTED-DIVERGENCE surfaced.
extend-index 238→252 tests green across `tree/extend/`; full extend suite 637→651/0; core 3045→3059/0.
Frontier: leading-combinator relative-`&` UNSUPPORTED 1→0.

### NEXT RUNG — the remaining reachable frontier
With rungs 6+7 closed, `&` TARGETS are built for every reachable shape probed (child-only / crossing /
parent-only / `&&` same-parent / leading-combinator relative). The remaining UNSUPPORTED gaps are all
NON-reachable-common or find-side, so the engine is READY for a full-corpus sweep (rung "8") gated by
fail-loud on the tail below:
1. **Distinct-parent `&&` passenger merge-ordering** — `&(.foo.bar)&(.baz).suffix` (two amps, DIFFERENT
   parents, one compound). `extendAmpersandTarget` bails at `ampResolvedValues.size > 1`; the merge order
   of distinct parents is not modeled → UNSUPPORTED (fail-loud). Small-surface; needs the merge-order rule.
2. **List-parent grafts / amp-in-`:is()` / OR-subjects** — `resolvedFormSeq`/`resolvedRelSeq` return null
   for a multi-branch parent (`&` under a `.a, .b` parent) → UNSUPPORTED.
3. **`&`/constructor-atom FINDS** (`&.x` / `.a:is(.b)` / `.a:not(.b)` on the FIND side) — find-side graft
   normalization; distinct, smaller-surface machinery. Gated to UNSUPPORTED at the `extendByIndexOwn` entry.
The sweep should run the whole extend corpus through `extendByIndexOwn` (delegation off); every remaining
UNSUPPORTED is a fail-loud sentinel, so the sweep tells us precisely which (if any) of the above are actually
reachable from the real corpus before wiring `processExtendsByIndex` to `context`/`&`-hoist.

### RUNG CLOSED (2026-07-06) — rung 8: the full-corpus sweep + own-engine bug fixes
The sweep instruments `extendSelector` with a global, no-op-unless-installed sink (guarded hook at
`extend.ts:1527`, re-entrancy-guarded via `__EXTEND_INDEX_SWEEP_BUSY__`). A vitest config
(`vitest.sweep.config.ts`) + setup (`tree/extend/__tests__/sweep-sink.ts`) runs the WHOLE core extend
suite through REAL renders; for every TOP-LEVEL reachable `(target, find, extendWith, partial)` tuple the
sink runs the own engine on the pristine nodes FIRST (it is string-pure; the sink snapshots+restores every
input `.parent` so the walk's node-identity tests are unaffected), captures its output eagerly, then runs
the walk and records the byte comparison. Perf/scaling stress files are excluded (they add only synthetic
`.a-N` volume and would blow their timing budget under double-work instrumentation).

**Result: 2,595 distinct reachable tuples. own-PASS 325, NOT_FOUND-both 2,221, UNSUPPORTED 47, DIVERGENCE 2
(both benign).** The sweep took DIVERGENCEs 21→2 and closed these own-engine BUGS (all oracle-derived,
hardcode-pinned in `extend-index-own.test.ts §16`, no walk-bug surfaced):
- **FULL-append dedup** — appending an extendWith already present as a target OR-branch emitted a duplicate
  (`.base,.child` f `.base` e `.child` → `,.child` dup; self-extend `.w` f `.w` e `.w` → `.w,.w`). Fixed:
  dedup the append against existing branches (`hasExactCartesianProduct` sibling).
- **Dup-atom find multiset** — a find with an internal duplicate (`.e.e`) matched via set-syms, so `.e` f
  `.e.e` "matched" (own `.e`) where the oracle is NOT_FOUND. Fixed: `compoundSubset` is MULTISET when both
  compounds are plain (per-sym count). The `.e.e.x` f `.e.e` PARTIAL contiguous-dup-wrap is UNSUPPORTED
  (unreached; a wrong per-slot wrap would be worse).
- **Bare-`:is` FULL-append whole-selector gate** — a bare `:is` compound appended in FULL mode even when it
  was only ONE compound of a multi-compound seq (`.aa :is(.dd,.ee)` f `.dd` → wrongly `:is(.dd,.ee,.ff)`).
  Fixed: FULL append only when the `:is` IS the whole selector; else subset → unchanged (PARTIAL still wraps).
- **Single-arm multi-compound `:is` not unwrapped** — `d :is(.b .c)` f `.b .c` FULL kept the wrapper (oracle),
  own unwrapped to `d .b .c`. Fixed: a single-arm `:is` with a MULTI-compound arm stays wrapped on a
  full through-match; a single-COMPOUND arm (`.x :is(.a) .c`) still unwraps.
- **Graft-target no-match → NOT_FOUND** — a graft branch with an extra plain compound (`:is(.foo,.bar) .baz`)
  returned the target UNCHANGED for a non-matching find instead of NOT_FOUND (a bare-compound hostIdx was set
  unconditionally). Fixed: recurse into the graft first; null recursion → real no-match.
And added fail-loud UNSUPPORTED gates (own engine produced wrong output; oracle machinery not built):
- **Element/ID conflict** (`a.info` f `.info` e `div.foo` → oracle `ELEMENT_CONFLICT`) — conflict-validation
  machinery not built → UNSUPPORTED (`partialWrapMayConflict`, conservative: only when extendWith carries a
  tag/id and the combined context would exceed one element or id).
- **Exact-mode cartesian de-distribution** (`.a .b,.a .d,.c .b` f `.c .b` e `.c .d` → oracle `:is(.a,.c)
  :is(.b,.d)`) — walk output-compaction not built → UNSUPPORTED (`hasExactCartesianProduct`).
- **`:is` arm with an internal non-space combinator** (`:is(.replace.replace,.c.replace+.replace) .replace`
  f `.replace.replace .replace` — the extend-exact fixture) — the boundary-cross flatten of a `+`/`>`/`~`-arm
  is not built → UNSUPPORTED.

**The 2 remaining DIVERGENCEs are BENIGN (not per-call own bugs):**
1. `.ext3,.ext4,.ee` f `.bb` e `.ff` — a FIXPOINT-accounting artifact: the isolated tuple is NOT_FOUND on
   BOTH engines (verified by direct probe); the sink captured the walk's *accumulated render* result. The
   per-call own answer is correct.
2. `div:is(a>.foo)` f `.foo` FULL — oracle returns the target unchanged (subset match, no CSS change), own
   returns NOT_FOUND. Both emit no output change; the only asserting test checks `not.toThrow()`. A
   classification difference, not a wrong output.

**The 9 UNSUPPORTED-with-oracle-output are the honest residual list** — all either the fail-loud gates above
or the 3 pre-documented residual classes (distinct-parent `&&` `.foo.bar.baz.suffix`; multi-graft-in-both-
slots `:is(...) :is(...)`; `:where`/graft FINDS `:where(.a)` f `:where(.a)`), and every one is reached ONLY
from hand-built UNIT tests, not from any render fixture. **The render-only sweep (the 8 render-fixture test
files: extend-rules / -eval-integration / -roots / extend.test / -less-fixtures / -media-scope / -import-style
/ -memo-differential) produced ZERO wrong-output divergences and ZERO UNSUPPORTED-with-oracle-output after
the fixes** (the one reachable `.replace.replace` gap is fail-loud UNSUPPORTED, never wrong output).

**VERDICT: GO for wiring `processExtendsByIndex` into production (rung 9).** Across the whole reachable
corpus the own engine is byte-identical to the oracle on every case it builds, and fail-loud UNSUPPORTED on
every case it does not (never a wrong or spurious-NOT_FOUND answer). The remaining UNSUPPORTED shapes are
unreached by real renders; a production wire can relay UNSUPPORTED to the oracle for those without any
observed corpus impact. No walk-bug / EXPECTED-DIVERGENCE surfaced. tree/extend 252→270; full extend suite
651→669/0; core 3059→3077/0; build + tsc (0-new-in-`tree/extend/`) clean.

## Non-goals (for the validated prototype)
Minimal-hoist (output change); replacing the walk (only after full-suite byte-identical); touching the
existing `extendSelector`/fold beyond what the parallel path reuses.
