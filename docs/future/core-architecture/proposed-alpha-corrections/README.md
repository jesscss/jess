# Proposed alpha `.css` corrections (extend nested-mode bug)

These files are PROPOSED replacements for the corresponding
`less.js` `alpha:packages/test-data/tests-unit/<fixture>/<fixture>.css`
expected outputs. They are NOT applied here — the tree2 R1 work does not edit any
less.js file. The owner applies them on alpha after review.

## Why

Alpha's hand-converted NESTED `.css` has a systematic bug: an EXACT extender
(`:extend(X)` with no `all`) that targets a rule X which HAS nested children is
folded into X's selector list (`.aa, .cc { .dd … }`), which WRONGLY leaks the
extender into the children (`.cc .dd`). The correct rule (owner-confirmed):

> An exact extender folds into a block header ONLY IF the block has no child
> rules. If the block HAS children, the extender is emitted as a SEPARATE
> sibling rule carrying only the block's DIRECT declarations (empty → dropped).
> `all`-extend DOES propagate into sub-parts and stays folded.

tree2 emits the CORRECT re-nested output (the flat result — which IS
byte-identical to alpha in `collapseNesting:true` mode, locked by
`extend-byte-identity.test.ts` — re-nested). Each file here is exactly that
output and is byte-identical to alpha OUTSIDE the buggy region.

## Files

- `extend.css` — corrects the `.aa` and `.bb` blocks:
  - `.aa, .cc { color:black; .dd,.ee {…} }` → `.aa { color:black; .dd,.ee {…} }`
    PLUS separate `.cc { color:black; }`.
  - `.bb, .cc, .ee, .ff { … .bb,.ff {…} }` → `.bb, .ff { background:red; .bb,.ff {…} }`
    PLUS separate `.cc { background:red; }` and `.ee { background:red; }`
    (`.ff` is `all` → stays folded and propagates to the inner `.bb`).

  The rest of `extend.css` (`.error`/`.badError`, `.ext*`, `.buu`/`.fuu`
  hoists, etc.) is byte-identical to alpha and is included so the file is a
  drop-in expected `.css`.

- `extend-exact.css` — corrects three exact-into-children instances:
  - block 3 `.a { prop:is_effected; .b {…} .b.c {…} }` — `.effected:extend(.a)`
    is exact and `.a` has children, so alpha's `.a, .effected { .b … }` (which
    leaks `.effected .b`) becomes `.a { … }` PLUS separate
    `.effected { prop:is_effected; }`.
  - block 4 `.c, .a { .b, .a { .a, .c {…} } }` — extended by `.effected` (via
    `.c` and `.a`) exact; the block has children and NO direct declarations, so
    the split rule is empty and `.effected` is dropped entirely.
  - block 5 `.e.e { prop:extend-double; &:hover {…} }` — `.dbl:extend(.e.e)` is
    exact and `.e.e` has the surviving `&:hover` child, so alpha's
    `.e.e, .dbl { …; &:hover {…} }` (which leaks `.dbl:hover`) becomes
    `.e.e { … }` PLUS separate `.dbl { prop:extend-double; }`. The `.e.e` header
    itself is the decl-less `&&` self-collapse (`.e { && {…} }` → `.e.e { … }`).

  The rest of `extend-exact.css` (block 1's `.rep_ace` multi-segment +
  `:is(.replace, .c)` compaction) is byte-identical to alpha and is included so
  the file is a drop-in expected `.css`.


## Merge (`+` / `+_`) — v5 LAST-occurrence anchor (R4)

`merge.css` is a DIFFERENT kind of correction from the extend files above: it is
NOT a bug fix but an intended **v5 semantic divergence**. Alpha's committed
`merge.css` encodes Less's FIRST-occurrence line anchor for interleaved merge
groups; Jess v5 anchors each combined `+`/`+_` line at the property's **LAST**
occurrence (owner decision, project memory `spine-merge-last-occurrence-anchor`).

Only two blocks differ from alpha's expected `.css` (member content is identical; only the
combined LINE position moves):

- `.test-rule-interleaved` — `transform`'s last member (`t3`) follows
  `background`'s last (`b2, b3`), so under last-occurrence `background:` anchors
  first: `background: b1, b2, b3;` then `transform: t1, t2, t3;` (alpha emits
  `transform` first).
- `.test-rule-spaced` — same swap: `background: b1 b2, b3;` then
  `transform: t1 t2 t3;`.

`.test-rule-interleaved-with-spaced` is byte-identical to alpha (there
`transform`'s last member already precedes `background`'s, so first- and
last-occurrence agree). Every other block matches alpha, so `merge.css` is a
drop-in v5 expected `.css`. tree2's R4 merge fold is gated against THIS file
(`r4-byte-identity.test.ts`), never against alpha's first-occurrence expected `.css`.

**Differential-reference hand-off (like `scope.less` #989, GOAL1-SCORECARD §2):**
because the ast/ engine correctly emits the v5 LAST-occurrence order (matching
`CUTOVER-STATUS.md:44` "LAST-occurrence anchoring kept" and the legacy `tree/`
spine/eval path), it DIFFs from alpha's committed first-occurrence `merge.css`.
That divergence is recorded in `alpha-oracle-baseline.json` as an **expected
`DIFF`** for `merge/merge.less` — the expected `.css` is the outlier, not ast/. The alpha
corpus `merge.less`/`merge.css` (READ-ONLY, owner-maintained) needs the upstream
correction to LAST-occurrence captured by THIS `merge.css`; once synced, the
baseline entry promotes to `MATCH`. Task #36 wrongly flipped ast/ to FIRST to
chase the outlier expected `.css`; reverted on `fix/merge-anchor-revert-to-last`.


## extend `all` sub-span `:is()` wrapping — NEW upstream fixture (task #30)

`extend-subspan-all.less` / `extend-subspan-all.css` are a PROPOSED NEW `alpha`
test-data fixture (not a correction of an existing expected `.css`). They demonstrate the
v5 extend-`all` sub-span behavior the `ast/` engine now implements (owner-DECIDED
design; supersedes 4.x's positional string-replace):

> `:extend(TARGET all)` matches TARGET by COMPOUND-SUBSET against every existing
> selector (each TARGET compound ⊆ the aligned selector compound, combinators
> aligned — so `.a > .c` matches `.a.b > .c.d`) and unions the extending selector
> with the matched span. A WHOLE-selector match degenerates to a plain
> comma-append; a MID-complex sub-span is wrapped `:is(<matched-span>, <ext>)`
> IN PLACE, with the surrounding combinator context preserved verbatim on BOTH
> sides.

The `.css` here is the `ast/` v5 render (the v5 reference), captured via
`bridgeToAst` + `serialize({ collapseNesting: true })` and locked in-repo by
`packages/core/src/ast/parse-host/__tests__/extend-subspan-wrap.test.ts` (ast/)
and `packages/jess/test/spine-production-ratchet.test.ts` (production spine,
`SUB-SPAN #30` cases).

**Divergence from current alpha** (verified by running `alpha`'s own `lessc` on
`extend-subspan-all.less`): alpha only comma-appends the WHOLE-EXACT combinator
match (case 3, `.m > .n, .z`); for the compound-SUBSET cases (1 and 2) it emits
`WARNING: extend '<target>' has no matches` and leaves the selector UNCHANGED —
4.x/alpha has no compound-subset complex-target matching. So alpha's current
output for this fixture is:

```css
.a.b > .c.d {
  color: red;
}
div + .e.f > .g.h ~ .child {
  color: blue;
}
.m > .n,
.z {
  color: green;
}
```

Adopting `extend-subspan-all.css` upstream requires implementing the compound-
subset sub-span match + `:is()` wrap in less.js alpha (cases 1 and 2). Case 3 is
already alpha-correct and is included so the file is a drop-in expected `.css`.

### NOTE — the task-#30 design examples transpose `&`/argument in their prose

The design spec (EXTEND-REDESIGN / the #30 brief) illustrates the feature with:

```less
.a.b > .c.d {}
.a > .c { &:extend(.x all); }   /* prose: "&=pattern searched, .x=added" */
```

In standard Less/alpha semantics `&:extend(.x all)` searches for the ARGUMENT
(`.x`) and adds the rule's own selector — i.e. the prose's role labels are
transposed. Run literally, the input above produces NO match in alpha
(`WARNING: extend ' .x' has no matches`) and no change — confirmed against
`alpha` `lessc`. The intended END outputs quoted in the brief
(`.a.b > .c.d, .x` and `div + :is(.a.b > .c.d, .x) ~ .child`) are reproduced
EXACTLY by the only self-consistent direction — search the extend TARGET, union
the extending selector — which is also the direction the `.zoo`/`.zap` corpus
cases (kept green) require. The fixture here therefore uses that direction
(`.x:extend(.a > .c all)`), producing the brief's exact expected CSS.
