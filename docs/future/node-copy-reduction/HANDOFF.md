# Node Copy Reduction Handoff Moved

The active core architecture handoff is now:

`docs/future/core-architecture/HANDOFF.md`

This file remains only as a compatibility pointer for older agent instructions
and links. The old "node copy reduction" framing was too narrow: the current
work optimizes total core eval/render cost, including AST node creation,
state/tracking object creation, `WeakMap` side maps, recursive node walks,
function-call overhead, parse size, source parentage, and public API
boundaries.

Start every new architecture pass from the new handoff.
