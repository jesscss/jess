# R2 — Native Value Evaluation

Value evaluation operates on canonical typed value nodes. It must not re-enter
a predecessor renderer, reparse expression text, record a whole-document
prepass, or convert through a bridge.

## Current design

- Keep value leaves lazy: emit verbatim bytes until an operation, comparison,
  guard, function call, or interpolation needs a typed value.
- Evaluate operators, guards, and functions over typed values. A synchronous
  function binding is acceptable; any async function lifts only the forcing
  declaration.
- Preserve configured math, unit, and function modes through explicit typed
  evaluation options.
- Do not add speculative caches, interning, or value-side allocation machinery.
  Value work must be justified by correctness or measured performance.

## Scope

The active closure work includes typed arithmetic and color behavior,
function-argument semantics, typed guard evaluation, pattern matching, and
lazy variable resolution. Interpolation sites, detached-ruleset values,
namespace/map semantics, live reassignment, and additional `calc()` work remain
separate semantic lanes.

## Proof

Use focused typed-value and guard tests first, then relevant Less corpus cases.
Preserve supported output behavior and measure matched workloads before claiming
a speed or memory win.

The retired record/replay and reparse scaffold analysis is preserved in
[`../archive/R2-value-eval-legacy-reparse-history-2026-07-19.md`](../archive/R2-value-eval-legacy-reparse-history-2026-07-19.md).
