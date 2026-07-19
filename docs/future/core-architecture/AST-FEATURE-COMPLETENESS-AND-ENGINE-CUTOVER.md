# AST Feature and Engine Closure — Current Program

The canonical AST and direct parser construction are the only runtime model.
Feature work closes behavior on that model; it does not add an alternate parser,
host, adapter, or render pipeline.

## Parser feature closure

Close grammar gaps structurally, beginning with interpolation in quoted values
and paths, at-rule preludes, custom-property names and values, and import
specifiers. Preserve typed segments from the first parse rather than recovering
shape from source bytes.

## Evaluation closure

Use the feature inventory to drive focused behavior work: list/map iteration,
cross-unit arithmetic, color-function argument semantics, mixin recursion, and
lazy variable/scope resolution. Treat declared v5 output semantics as deliberate
only when independent fixture evidence supports them.

## Correctness and performance gates

Prove each slice with focused parser or core tests, then run the relevant corpus.
Validate contested output against the independent Less reference. At integration
boundaries, require fresh builds, core tests, the Jess production spine ratchet,
and the Less corpus. Performance claims need matched measurements; correctness
evidence alone does not prove speed.

The previous dual-target cutover and bridge survey are historical evidence in
[`archive/AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER-host-bridge-history-2026-07-19.md`](./archive/AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER-host-bridge-history-2026-07-19.md).
