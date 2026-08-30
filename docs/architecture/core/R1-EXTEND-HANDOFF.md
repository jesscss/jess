# R1 EXTEND — status + handoff (tree2 rewrite)

## UPDATE — both engine gaps CLOSED; extend fully landed (this session)

All resolvable extend fixtures are byte-identical in their configured mode and
`extend-selector` cleanly defers (`UnsupportedShape`). The two KNOWN GAPs are
fixed and the `it.fails` trackers were promoted to real passing assertions:

- **extend-nest (FLAT)** — MATCHES alpha. Two fixes in `tree2/extend.ts`:
  (1) the extended FLAT header now runs through `siblingCompact`
  (`.button:hover, .submit:hover` → `:is(.button, .submit):hover`);
  (2) `substituteAmp` now wraps a MULTI-SEGMENT parent in `:is(…)` when the `&`
  is fused into a compound (`.amp-test-f:is(.amp-test-c …)`), instead of fusing
  the parent bare.
- **extend-exact (NESTED)** — MATCHES the proposed correction. Fix: a decl-less
  parent whose only child is a pure-`&` self-compound (`.e { && {…} }`) is now a
  TRANSPARENT collapse (`collapseTransparent` in the nested plan) — the child is
  emitted at the parent's level with `&` composed against the parent (`.e.e`) and
  behaves like a top-level rule (exact `.dbl:extend(.e.e)` folds/splits against
  the composed `.e.e`, splitting `.dbl` because `.e.e` has the surviving `&:hover`
  child). Blocks 3/4/5 are alpha's exact-into-children bug → gated against
  `proposed-alpha-corrections/extend-exact.css` (emitted this session), NOT
  alpha's buggy bytes.

Final matrix (all green in `extend-byte-identity.test.ts`): extend-chaining FLAT
MATCH alpha, extend-clearfix FLAT MATCH alpha, extend-media NESTED MATCH alpha,
extend-nest FLAT MATCH alpha, extend NESTED MATCH corrected, extend-exact NESTED
MATCH corrected, extend-selector DEFERRED. Full tree2 suite green (166 passed, 1
skipped). clone/inherit/withComponents stay structurally ZERO; no `src/tree2` →
`../tree` import; no `as any`. The R1 branch was committed and the cleanroom head
`experiment/tree2-cleanroom-20260715` fast-forwarded.

---

Branch: `experiment/tree2-r1-extend-20260715`. Reference: less.js `alpha` TOP-LEVEL
`.css`, read-only via `git show` (see `REFERENCE.md`). This doc SUPERSEDES the
reference wording in `_R1_IMPL_BRIEF.md` (that brief gated on `renderRealOracle`,
which is a KNOWN-BUGGY engine and is NOT the reference).

## UPDATE — config-driven per-fixture mode (harness fix, this session)

The byte-identity harness now renders EACH fixture in ITS OWN configured output
mode instead of gating everything NESTED. This removes the phantom "flat vs
nested" conflict: `extend-chaining`, `extend-clearfix`, `extend-nest` have NO
`styles.config.ts`, so the `tests-unit/` DIRECTORY config
(`output: { collapseNesting: true }`) cascades in and they render FLAT — their
top-level `.css` is flat, so gating them nested was comparing against the wrong
shape.

- `oracle-source.ts` gained `resolveCollapseNesting(fixture)` — reproduces the
  `styles-config`/cosmiconfig CASCADE (fixture's own `styles.config.ts` wins,
  else the `tests-unit/` directory config's `collapseNesting: true`) READ-ONLY
  over `git show alpha:…` (no hardcoded default; not coupled to the live less.js
  worktree branch, matching the rest of the locked helper). Handles both
  `output: {…}` and `output: [{…}]` shapes. Also added `legacyCss(fixture)` (reads
  the ONE allowed off-path sibling `legacy/{name}.css`; still throws on any other
  off-path read).
- `extend-byte-identity.test.ts` rewritten: renders each fixture in its resolved
  mode, gates vs top-level `.css` (or the proposed correction where alpha is
  buggy), defers `extend-selector` (asserts `UnsupportedShape`), and tracks the
  two real gaps as `it.fails` KNOWN GAPs (fail-loud: they flip red when fixed).
  Full tree2 suite green (166 passed, 2 expected-fail, 1 skipped).

### Confirmed default + corrected per-fixture matrix (resolved mode)

Default for a no-config fixture = `collapseNesting: true` (FLAT), SOURCED from
`tests-unit/styles.config.ts` (`output: { collapseNesting: true }`) via the
cascade — confirmed empirically (no-config `extend-nest`/`extend-clearfix`/
`extend-chaining` have structurally-flat top-level `.css`, e.g. top-level
`:is(.sidebar, …) .box`, not a nested `.box`).

| fixture         | resolved mode | gate result |
|-----------------|---------------|-------------|
| extend-chaining | FLAT (default)   | MATCH alpha |
| extend-clearfix | FLAT (default)   | MATCH alpha |
| extend-media    | NESTED (config)  | MATCH alpha |
| extend          | NESTED (config)  | MATCH proposed-correction (`extend.css`) |
| extend-selector | NESTED (config)  | DEFERRED (`UnsupportedShape`, R4) |
| extend-nest     | FLAT (default)   | KNOWN GAP (gaps a/b below) |
| extend-exact    | NESTED (config)  | KNOWN GAP (block 5 + exact-into-children) |

**flat-vs-legacy is NOT a tree2 gate.** `legacy/{name}.css` is the 4.x EXPANDED
form (`.clearfix:after, .foo:after, .bar:after`); tree2's flat mode emits the v5
`:is()`-COMPACTED form (`:is(.clearfix, .foo, .bar):after`). So tree2 flat diffs
`legacy/` for ALL fixtures — legacy/ is the 4.x reference, not a tree2 reference
(the v5 flat reference is the top-level `.css`). tree2 has no non-`:is()` emission
mode. The matrix column exists only informationally.

Still NOT fast-forwarded: `extend-nest` and `extend-exact` are genuine engine
gaps (not clean deferrals). Items 1–4 in "Remaining work" stand.

## What landed (done + verified)

1. **The extend engine is preserved and committed** (`tree2/extend.ts`, plus the
   bridge/nodes/serialize changes). FLAT mode (`collapseNesting:true`) implements
   the CORRECT extend semantics (see below) and is byte-clean by construction.

2. **Reference-lock (STEP 1) — the durable win.**
   - `docs/architecture/core/REFERENCE.md` — the fixed reference path + the
     pitfalls that repeatedly misled agents (legacy/ = 4.x expanded; graduate-v5 /
     alpha-release-port / other worktrees; upstream/alpha expanded; renderRealOracle
     buggy) + the "less.js worktrees are READ-ONLY" rule.
   - `packages/core/src/tree2-frontend/oracle-source.ts` — the SINGLE fixed-path
     helper. `expectedCss(fixture)` / `fixtureLess(fixture)` run exactly
     `git -C ~/git/oss/less.js show alpha:packages/test-data/tests-unit/<f>/<f>.{css,less}`
     and THROW on any `legacy/`, subpath, or `..`. No test can hand-pick an expected `.css`.
   - `extend-byte-identity.test.ts` rewired to fetch BOTH input `.less` and
     expected `.css` only through the helper. Green (asserts the confirmed subset).

## The CORRECT extend semantics (verified in FLAT mode; reference-derived)

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
match the buggy expected `.css`, do NOT edit any less.js file):

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

## Per-fixture matrix — CURRENT (nested re-projection LANDED on this branch)

Gated by `extend-byte-identity.test.ts` (green). NESTED is the gate.

| fixture         | nested status | detail |
|-----------------|---------------|--------|
| extend-chaining | MATCH alpha   | byte-identical both modes. GATED vs alpha. |
| extend-media    | MATCH alpha   | byte-identical both modes. GATED vs alpha. |
| extend-clearfix | MATCH alpha   | nested now byte-identical to alpha (the `&:after` crosses `&` → flattens). GATED vs alpha. |
| extend          | MATCH CORRECTED | byte-identical to alpha OUTSIDE the `.aa`/`.bb` bug region; that region emits the CORRECT re-nesting. GATED vs `proposed-alpha-corrections/extend.css` (the proposed patch). `.ext8`/`.buu`/`.fuu` hoists + `.aa`/`.bb` split all correct. |
| extend-exact    | 4/5 blocks correct | block 1 (`.rep_ace` multi-segment + `:is(.replace,.c)` compaction + flatten) ✓; blocks 3/4 (exact-into-children bug) emit the CORRECT re-nesting ✓. **BLOCK 5 GAP**: `.e { && {} }` needs a nested `&`-wrapper collapse (→ `.e.e { …; &:hover {} }` + split `.dbl`). Not gated. |
| extend-nest     | 2 GAPS        | `.sidebar*`/`.box`/`&:hover` hoists + sibling `:is()`-compaction all correct. **GAP a**: `.button2 { :hover {} }` should flatten to `.button2 :hover` (a plain-nesting flatten with no clear extend trigger — likely an alpha quirk or a standalone-`:extend()` interaction; needs reference-verified rule). **GAP b**: the `amp-test` `&`-substitution-inside-`:is` renders `.amp-test-f.amp-test-c :is(…)` where alpha renders `.amp-test-f:is(.amp-test-c :is(…))` (amp-form differs). Not gated. |
| extend-selector | DEFERRED      | `[data=@{attr-data}]` (interpolated selector — R4) + standalone `:extend()`; bridge raises `UnsupportedShape('statement: Rules')`. |

### What the nested re-projection does (LANDED — `tree2/extend.ts` + `serialize.ts`)

NESTED output re-nests the correct FLAT result. A rule STAYS NESTED and extend
rewrites its local selector in place; it FLATTENS (emitted flat at top level via
the flat path, bubbled out of its parent block) ONLY when the extend match
crosses the `&`. The three operational flatten triggers (validated against the
alpha reference):
- **B**: a nested rule that itself carries `:extend()` (its extender contribution
  spans the parent context) — e.g. `.type1 .sidebar3`, `.type2.sidebar4`.
- **P**: a nested rule whose parent is aliased by an `all`-extender whose target
  does NOT also hit the child's own compound (foreign parent-context alias) —
  e.g. `.sidebar .box`, `.clearfix &:after`. A UNIFORM alias that also rewrites
  the child's own compound (`.ff:extend(.bb all)` on `.bb { .bb {} }`) does NOT
  cross → stays nested (`.bb, .ff { .bb, .ff {} }`).
- **X**: a structural-leaf whose flat solve gained a whole-complex sibling that
  does not descend from the parent header — e.g. `.ext8 .ext9, .buu`; `.rep_ace`.

Plus: EXACT extenders folding into a target WITH surviving nested children SPLIT
to sibling rules (target's direct decls only, empty → dropped); `all`-extenders
fold and propagate; sibling `:is()`-compaction on hoisted headers.

### OWNER conflict flagged (needs a decision; does not block the LANDED work)

The owner's mid-task rule ("flatten IFF the match crosses `&`; a match ENTIRELY
in the parent portion does NOT cross → stays nested") predicts `.sidebar .box`
and `.clearfix &:after` STAY NESTED (the all-target `.sidebar`/`.clearfix` is
entirely in the parent portion). But alpha's `extend-nest.css` / `extend-clearfix.css`
expected `.css` emit them FLAT, and the handoff's GOAL for clearfix is to MATCH alpha's
flat expected output. These two cannot both hold. The LANDED code follows the reference
(alpha) — trigger P flattens `.box`/`&:after` to match the expected output — because the
owner also said "validate every `&`/hoist case against alpha's actual nested
`.css`". If the owner instead wants the literal "stays nested" rule, `extend-nest`
/ `extend-clearfix` alpha expected `.css` are themselves buggy (flat instead of nested)
and would move to the proposed-correction lane. The deferred `.header .header-nav
{ &:before }` case (owner's example) is NOT reproduced by trigger P and does not
gate (it lives in the DEFERRED extend-selector fixture).

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

## Remaining work (precise, for the next agent)

1. **extend-exact block 5 — nested `&`-wrapper collapse.** `.e { && { prop;
   &:hover {} } }` (`.e` is decl-less, its only child `&&` is a `&`-absorbing
   compound) must collapse: emit the `&&` rule at `.e`'s level with header =
   composed `.e.e`, keep its `&:hover` child nested, and SPLIT the exact extender
   `.dbl` (`.e.e` has a surviving child). This is a GENERAL nested-emit collapse
   (a decl-less parent whose children fully absorb it via `&`), not extend-only —
   scope it carefully so it does not disturb the plain nested emitter. Once done,
   emit `proposed-alpha-corrections/extend-exact.css` (blocks 3/4/5 are alpha
   bugs) and gate `extend-exact` against it.
2. **extend-nest gap a — `.button2 { :hover {} }` → `.button2 :hover`.** No clean
   extend trigger produces this; determine from the reference whether it is a plain
   nested-flatten (does v5 flatten a descendant `:hover` child?) or a standalone-
   `:extend(.button2:hover)` interaction, then encode the verified rule.
3. **extend-nest gap b — amp-form.** The `amp-test` deep `&`-inside-`:is`
   substitution must render `.amp-test-f:is(.amp-test-c :is(…))` (alpha), not
   `.amp-test-f.amp-test-c :is(…)` (current). The FLAT `substituteAmp` inlines the
   parent text; alpha wraps the substituted parent in `:is(…)` when the parent is
   itself a composed multi-segment token.
4. Resolve the OWNER conflict above (P-flatten vs literal "stays nested").

## Land decision
NOT fast-forwarded (deliberate). Resolvable fixtures are NOT all byte-identical:
`extend-exact` (block 5) and `extend-nest` (gaps a/b) remain. LANDED this branch:
- The NESTED re-projection engine (`tree2/extend.ts` `computeExtends` nested
  plan + `serialize.ts` hoist/split/flatten wiring). clone/inherit/withComponents
  stay structurally ZERO; `src/tree2` has NO `../tree` import; flat mode unchanged.
- Byte-clean NESTED: `extend-chaining`, `extend-media`, `extend-clearfix` (vs
  alpha) and `extend` (vs the proposed correction). Gated by
  `extend-byte-identity.test.ts` (green); full tree2 suite green (165 passed).
- `proposed-alpha-corrections/extend.css` (+ README) — the owner-applies patch
  for the `.aa`/`.bb` alpha bug.
Do items 1–4, then emit the `extend-exact` correction, gate both remaining
fixtures, and FF the cleanroom head `experiment/tree2-cleanroom-20260715`.
