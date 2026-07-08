# Overnight readout — 2026-07-08 (for morning triage)

All landed on `origin/dev` (tip `0ca46136d`), gated byte-identical (alpha `all-less` 90/3 unchanged) + core suite green + tsc 0-new. Nothing risky/gated was implemented unreviewed.

## Landed
- **Node field-budget met.** `Rules` 7→4 class-unique fields (dropped dead `pendingExtends`; folded `lookupVersion`+`varsByName` into lazy `_lookup`). Codebase-wide audit: every node class ≤5 EXCEPT base `Node` (10) — see below. Audits: `RULES_FIELD_BUDGET.md`, `NODE_FIELD_BUDGET.md`.
- **Unified single-eval-emit design finalized** — `UNIFIED-EVAL-EMIT-DESIGN.md`. One downward pass: eval + per-node (canonical-or-fresh shape → inline visitor hook → serialize), live value-frame threaded through emit (the B1s fix), extend PLAN/SOLVE/EMIT folded in. Verdict: **cutover, not incremental**; code-health + correctness, **not a perf lever** (<1% self-time). Absorbs the flag-walk C4 endgame (deletes reuse gates, clone families, container short-circuits, `propagateFlagsFrom`).
- **Extend pipeline complete + validated (bundle-excluded):** `plan.ts` (reachability + target index) → `solve.ts` (document fixpoint, local-apply) → `emit.ts` (compose-relative-to-target + `&`-hoist + collapse/`:is`-grouping). Each oracle-validated; **EMIT fixes the nested-extender composed-selector bug** (`.type1 .sidebar3` + `:is(...)` grouping) that current `extend-nest`/`extend-selector` get wrong.

## Decisions waiting for you
1. **Extend production wire-in (the smaller, high-value option).** PLAN→SOLVE→EMIT operate purely on selectors — **no value-frame dependency**, so wiring them into production (replacing `processExtends`/`extend-roots` apply) is a BOUNDED cutover, **decoupled from** the full single-eval-emit render monolith. It fixes the composed-selector bugs AND delivers the extend-matcher perf. Recommendation: consider this as its own step before/independent of the render cutover.
2. **Full single-eval-emit render cutover** (the monolith). Multi-week, high-regression, not-a-perf-lever; the frame-threading spine is a coordinated flag-flip, no incremental path (B1s proved it). Go / defer?
3. **Base `Node` (10 fields) → ≤5.** Its fields (`_spanStart/_end`, `_sourceRoot`, `_treeContext`, `_options`, `flags`, `_requiredSemi`, `sourceNode`, `index`, `parent`) are foundational; getting under budget needs deciding which the unified pass still requires per-node (e.g. does every node need `sourceNode`/`treeContext`?). Design-gated on #2. (`_requiredSemi`→flag bit is a cheap 10→9 but high blast radius for little gain — not worth it alone.)
4. **Design open questions:** OQ-A **resolved** (reachability is cleanly single; only interpolated extend *targets* entangle, and they're already broken today — pre-existing, not new). OQ-F **resolved** (per-node inline visitor). Remaining minor: OQ-B (buffer-per-subject vs streaming), OQ-D/E (confluence / `:is`-graft termination bound) — sensible defaults unless you object.

## Not touched (deliberately)
The production cutover(s), base-`Node` reshape, and anything that would change ratified output without your review. The extend pipeline is bundle-excluded (zero production impact) until you decide on #1.
