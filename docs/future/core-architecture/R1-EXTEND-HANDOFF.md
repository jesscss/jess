# R1 EXTEND — status + handoff (tree2 rewrite)

Branch: `experiment/tree2-r1-extend-20260715`. Oracle: less.js `alpha` TOP-LEVEL
`.css`, read-only via `git show` (see `ORACLE.md`). This doc SUPERSEDES the
oracle wording in `_R1_IMPL_BRIEF.md` (that brief gated on `renderRealOracle`,
which is a KNOWN-BUGGY engine and is NOT the oracle).

## What landed (done + verified)

1. **The extend engine is preserved and committed** (`tree2/extend.ts`, plus the
   bridge/nodes/serialize changes). FLAT mode (`collapseNesting:true`) implements
   the CORRECT extend semantics (see below) and is byte-clean by construction.

2. **Oracle-lock (STEP 1) — the durable win.**
   - `docs/future/core-architecture/ORACLE.md` — the fixed oracle path + the
     pitfalls that repeatedly misled agents (legacy/ = 4.x expanded; graduate-v5 /
     alpha-release-port / other worktrees; upstream/alpha expanded; renderRealOracle
     buggy) + the "less.js worktrees are READ-ONLY" rule.
   - `packages/core/src/tree2-frontend/oracle-source.ts` — the SINGLE fixed-path
     helper. `expectedCss(fixture)` / `fixtureLess(fixture)` run exactly
     `git -C ~/git/oss/less.js show alpha:packages/test-data/tests-unit/<f>/<f>.{css,less}`
     and THROW on any `legacy/`, subpath, or `..`. No test can hand-pick a golden.
   - `extend-byte-identity.test.ts` rewired to fetch BOTH input `.less` and
     expected `.css` only through the helper. Green (asserts the confirmed subset).

## The CORRECT extend semantics (verified in FLAT mode; oracle-derived)

Extend operates on FULLY-COMPOSED selectors:
- **EXACT** (`:extend(X)`, `flag=1`, no `all`): matches a rule iff the rule's
  WHOLE composed complex equals `X`. Appends the extender's composed form as a new
  whole sibling branch. It NEVER reaches sub-parts / children.
- **ALL** (`:extend(X all)`, `flag=0`): additionally matches `X` as a sub-span of a
  longer complex; substitutes the matched span in place with
  `:is(<matched span>, <extenders…>)`, compacting `:is()` MAXIMALLY. Expands to a
  comma list ONLY when the matched span is the whole complex.
- Transitive chaining, self/circular avoidance, `@media` scope reachability all
  hold. clone/inherit/withComponents op-counts stay structurally ZERO.

FLAT output confirmed correct e.g. for `extend`:
`.aa, .cc { color:black }` + `.aa :is(.dd, .ee) { … }` (no `.cc .dd`, no `.ff` —
`.ff:extend(.dd)` is EXACT and `.dd`'s composed is `.aa .dd` ≠ `.dd`), and inner
`:is(.bb, .ff) :is(.bb, .ff)`.

## Owner-confirmed ALPHA BUG (systematic): exact-extend folded into a parent-with-children

When an EXACT extender targets a rule X that HAS nested children, alpha's
hand-converted NESTED `.css` folds the extender into X's selector list
(`.aa, .cc { .dd … }`), which WRONGLY leaks the extender into the children
(`.cc .dd`). CORRECT rule (tree2 must emit; PROPOSE as a corrected `.css`, do NOT
match the buggy golden, do NOT edit any less.js file):

> An exact-extender folds into a block header ONLY IF the block has no child rules.
> If the block HAS children, the extender is emitted as a SEPARATE sibling rule
> carrying only the block's DIRECT declarations (a childless rule with no direct
> decls → the separate rule is empty → dropped). `all`-extend DOES propagate into
> sub-parts and stays folded.

### Enumerated instances (nested extend fixtures needing the correction)

- `extend.css`:
  1. `.aa` block — `.cc:extend(.aa)` exact, `.aa` has child `.dd`. Alpha
     `.aa, .cc { color:black; .dd,.ee {…} }` → CORRECT: `.aa { color:black; .dd,.ee {…} }`
     PLUS separate `.cc { color:black; }`.
  2. `.bb` block — `.cc:extend(.bb)` and `.ee:extend(.bb)` exact, `.bb` has child
     `.bb`. Alpha `.bb, .cc, .ee, .ff { … .bb, .ff { … } }` → CORRECT:
     `.bb, .ff { background:red; .bb, .ff { color:black; } }` PLUS separate
     `.cc { background:red; }` and `.ee { background:red; }`. (`.ff` is `all` → stays
     folded and propagates to the inner `.bb`.)
- `extend-exact.css`:
  3. `.a` block — `.effected:extend(.a)` exact, `.a` has children `.b`, `.b.c`.
     Alpha `.a, .effected { prop:is_effected; .b {…} .b.c {…} }` → CORRECT:
     `.a { prop:is_effected; .b {…} .b.c {…} }` PLUS separate `.effected { prop:is_effected; }`.
  4. `.c, .a` block — `.effected:extend(.c)`+`:extend(.a)` exact; block has children
     and NO direct decls. Alpha folds `.c, .a, .effected { … }` → CORRECT: drop
     `.effected` entirely (its separate rule is empty).
  5. `.e.e` block — `.dbl:extend(.e.e)` exact, `.e.e` has child `&:hover`. Alpha
     `.e.e, .dbl { prop:extend-double; &:hover {…} }` → CORRECT:
     `.e.e { prop:extend-double; &:hover {…} }` PLUS separate `.dbl { prop:extend-double; }`.

`extend-clearfix`, `extend-chaining`, `extend-media`, `extend-nest` have NO
exact-into-parent-with-children instance (their exact extenders target childless
rules, so they correctly fold).

## Per-fixture matrix (NESTED mode vs alpha; nested is the gate — flatten has no
independent alpha golden and matches only non-nested fixtures)

| fixture         | status | detail |
|-----------------|--------|--------|
| extend-chaining | MATCH  | byte-identical both modes |
| extend-media    | MATCH  | byte-identical both modes |
| extend-clearfix | needs HOIST | tree2 FLAT is byte-identical to alpha (alpha's golden IS the hoisted/flat form). Nested over-nests `&:after`; needs the child-hoist to equal flat. |
| extend          | PROPOSED-FIX (bug 1,2) + HOIST | outside the `.aa`/`.bb` region, alpha already matches tree2 FLAT (incl. `.buu`/`.fuu` already hoisted). `.aa`/`.bb` region = alpha bug → propose corrected `.css` below. Nested also needs `.buu`/`.fuu` composed-whole-complex hoist. |
| extend-exact    | PROPOSED-FIX (bug 3,4,5) + gaps | also has a MISSING extend `.rep_ace:extend(.replace.replace .replace)` (multi-segment target not matched) and a child `:is()`-compaction gap (`… .replace, … .c` should compact to `… :is(.replace, .c)`). |
| extend-nest     | HANDOFF | needs (a) sibling `:is()`-compaction `.button:hover, .submit:hover` → `:is(.button, .submit):hover`; (b) `.box`/`&:hover` child hoist; (c) the `amp-test` `&`-substitution-inside-`:is` monster. |
| extend-selector | DEFERRED | contains `[data=@{attr-data}]` (interpolated selector — R4 rung) and standalone `:extend()` selectors; bridge raises `UnsupportedShape('statement: Rules')`. Also holds the interpolated-target extend deferral case. |

## Remaining engine work (precise, for the next agent)

The FLAT solve (`solveComposed` in `extend.ts`) is CORRECT. The gaps are all in
NESTED projection + two compaction/matching features:

1. **NESTED re-projection = re-nest the FLAT result.** For each rule, group the
   correct flat rows by authored nesting. An exact-extender folds into a block
   header only when the block has NO child rules; otherwise split it into a
   separate sibling rule with the block's direct decls (see the bug rule above).
   Replace the current `solveSubject`/`nestedByRule` own-local path (it matches
   exact against own-local, over-propagating into children — the `.ff`-on-`.dd`
   and `.cc/.ee`-on-inner-`.bb` diffs).

2. **Child HOIST.** A child that, after extend, gains a branch not descending from
   its (extended) parent must be emitted at the parent's level (removed from the
   parent body, emitted as a sibling, composed via the existing `:is()`
   parentToken). Forms observed:
   - parent all-extended, descendant child → `:is(<ext parent>) .box` (extend-nest).
   - parent extended, `&`-child → `:is(<ext parent>):after` (extend-clearfix).
   - child's OWN composed wholly matches an `all` target, gaining a non-descendant
     sibling → `.ext8 .ext9, .buu` (extend `.buu`/`.fuu`).
   CAVEAT — the STEP-2 hoist rule as written ("`&`-child → flatten") is WRONG:
   alpha keeps `.header .header-nav { &:before }` NESTED (extend-selector) even
   though it is a `&`-child of an all-extended parent. That case is inside the
   DEFERRED extend-selector fixture, so it does not gate now, but do NOT encode the
   naive rule — derive hoist from "branch no longer descends from the parent".

3. **Sibling `:is()`-compaction.** Two whole sibling branches sharing a common
   suffix and differing in one compound compact to `:is(…)` (`.button:hover,
   .submit:hover` → `:is(.button, .submit):hover`). Not applied to branches that
   share nothing (`.error, .badError` stays a comma list). extend-nest + the
   extend-exact first rule need this.

4. **`amp`-substitution-inside-`:is`** (extend-nest `amp-test`) and **multi-segment
   exact target** (`.rep_ace:extend(.replace.replace .replace)`, extend-exact).

## Deferred (fail-loud `UnsupportedShape`, not faked)
- interpolated-target extend `[data=@{x}]` (needs R4 selector-interp rung) —
  guarded in `bridge.ts::guardExtendTargetSupported`.
- reference-import extend — no fixture in scope; surfaces as a diff, not faked.

## Land decision
NOT fast-forwarded. Resolvable fixtures are not yet all byte-identical in nested
mode (clearfix/extend/extend-exact need the nested re-projection + hoist;
extend-nest needs compaction + amp). Progress is committed on the branch. The
oracle-lock (STEP 1) and the correct FLAT engine + this precise handoff are the
deliverables. Do the nested re-projection + hoist + compaction, then propose the
corrected `.css` for `extend`/`extend-exact` (bug instances 1–5) and FF the
cleanroom head.
