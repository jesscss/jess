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

## Not yet proposed

- `extend-exact.css` — blocks 3/4 (the `.a` / `.c,.a` exact-into-children bug)
  and block 1 (`.rep_ace` multi-segment) are already correct in tree2, but
  block 5 (`.e.e` from `.e { && {} }`) needs a nested `&`-wrapper collapse that
  tree2 does not yet implement, so a complete corrected `extend-exact.css` is
  not emitted here. See `R1-EXTEND-HANDOFF.md`.
