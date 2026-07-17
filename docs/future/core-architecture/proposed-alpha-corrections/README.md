# Proposed alpha `.css` corrections (extend nested-mode bug)

These files are PROPOSED replacements for the corresponding
`less.js` `alpha:packages/test-data/tests-unit/<fixture>/<fixture>.css`
goldens. They are NOT applied here — the tree2 R1 work does not edit any
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
  drop-in golden.

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
  the file is a drop-in golden.


## Merge (`+` / `+_`) — FIRST-occurrence anchor, matches less.js (R4, task #36)

The `ast/` engine's `+`/`+_` merge now matches less.js 4.x `_mergeRules` EXACTLY:
a merged property's combined line anchors at its property's **FIRST** occurrence.
`r4-byte-identity.test.ts` gates the merge fixture against alpha's committed
`merge.css` golden directly (byte-identical), and the differential oracle
(`alpha-oracle-differential.test.ts`) records `merge/merge.less` as **MATCH**.

This SUPERSEDES the earlier "v5 LAST-occurrence anchor" intent (project memory
`spine-merge-last-occurrence-anchor`); the retired last-anchor golden that used
to live here (`merge.css`) is gone. NOTE: the legacy `tree/` spine/eval path
(`packages/core/src/tree/util/spine-merge.ts`) still implements last-occurrence
and is documented as such in `CUTOVER-STATUS.md` / `BENCHMARK-PERF-PATH.md`; those
paths were NOT changed by task #36 (ast/-render only) and now diverge from the
ast/ engine — reconcile when the eval path is retired.
