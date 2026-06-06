# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short and
operational.

Use the three-doc split:

1. `HANDOFF.md`: how to perform the next pass, the active work, gates, focus
   spec, and completion steps.
2. `AGGRESSIVE-CUTTING-REVIEW.md`: hardline patch-shape rules.
3. `PERFORMANCE-HANDOFF.md`: benchmark/profile protocol, evidence history,
   target queues, and rejected experiments.

## How To Work

1. Read this handoff first.
2. Read `AGGRESSIVE-CUTTING-REVIEW.md` before changing AST, eval/render,
   lookup, traversal, copying, inheritance, output writer, source/root metadata,
   or this handoff.
3. Read `PERFORMANCE-HANDOFF.md` before making or accepting any speed claim, or
   before touching a measured hot path.
4. Start each non-correctness pass from the benchmark leash below.
5. State one hypothesis before editing.
6. Make the smallest behavior-preserving cut that removes measured work or
   clearly wrong machinery.
7. Run focused tests first, then the required gates.
8. Keep, reshape, or revert based on the benchmark evidence and the aggressive
   cutting self-prosecution.
9. Commit and push the completed pass.

## Focus Spec

Active mode: **benchmark-leashed aggressive cutting**.

The goal is the fastest credible path from parsed Less to CSS output:

- one canonical source tree;
- live lookup/binding/placement state instead of routine copied eval trees;
- direct eval/render-to-string for normal output;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- fewer hot-path objects, arrays, traversals, helper calls, branch ladders,
  promise/generator states, and metadata mutations.

Less is the optimizing path. Preserve SCSS-enabling seams only when they are
concrete and cheap or isolated behind cold extension boundaries.

## Active Work

Correctness queue: no active correctness blockers. If a `.less` fixture fails
to parse/evaluate, add a focused repro before changing expected output. If CSS
differs, review semantics manually before changing tests.

Benchmark leash:

1. Record a post-selector/callable-cut stable hot-path snapshot.
2. Profile broad `benchmark.less`.
3. Choose the next deep cut from measured evidence, not smell alone.
4. Rerun the same benchmark/profile after the patch.
5. Keep the patch only if it improves real runtime cost, removes measured
   object/memory pressure without slowing runtime, or fixes correctness.

Immediate benchmark commands are defined in `PERFORMANCE-HANDOFF.md`.

Next deep-cut queue:

0. [x] Move callable `default()` guard classification out of
   `prepareCallableEvalCandidates(...)`. Parsed Less now passes explicit
   `hasDefault: true | false` for guarded mixins/rulesets, and the hot
   candidate loop trusts carried metadata instead of recursively scanning
   guards.
1. [ ] Split `Node.evalStatic(...)` into immediate eval/render and cold public
   materialization so routine eval replacement does not imply `.inherit(...)`.
2. [ ] Replace `StyleImport` first-use placement copies with placement state
   that points at canonical source children and preserves import visibility.
3. [ ] Collapse `StyleImport.deriveRulesSurface(...)` wrappers whose only job
   is source/visibility/placement bookkeeping.
4. [ ] Replace remaining `Rules` merge output copies with direct merge
   placement/render state or a narrow owned-item copier proven by merge tests.
5. [ ] Convert registration-prep expected misses away from routine `try/catch`
   only after adding tests for unresolved declaration/identity behavior.
6. [ ] Continue selector/extend factory cuts separately; do not hide selector
   placement copies inside another generic copy helper.
7. [ ] Replace callable binding copies for static containers with explicit
   binding/placement state. Static containers should not be copied merely
   because they contain child nodes; `F_HAS_NODE_CHILD` is only a cheap current
   ownership boundary, not a final architecture.
8. [ ] Attack the measured copy stack next: `copyChild`,
   `copyWithReusableLeaves`, `copyCallableRulesValue`, `constructCopy`, and
   `.inherit(...)`. CPU evidence says these are mostly registration derivation,
   selector header rendering, JS function argument ownership, reference value
   eval, and binding clone debt; do not justify them as render output copying.
9. [ ] Audit repeated callable/mixin evaluation from the profile before making
   more local helper cuts. If a mixin candidate or output body is evaluated
   more than the semantic call count requires, carry placement/binding state or
   cache the cold public materialization boundary instead of copying/evaluating
   again.

## Gates

Before editing:

- Build or inspect the relevant code path.
- Capture or identify the benchmark/profile target when touching hot paths.
- State the hypothesis in this handoff or in the working notes for the pass.

Required before commit:

```sh
pnpm run verify:aggressive-cutting-review
git diff --check
```

Also run the smallest focused tests for touched behavior.

For performance work, use the exact before/after benchmark/profile lane from
`PERFORMANCE-HANDOFF.md`. Do not report profiler elapsed time as app runtime;
label evidence as real benchmark, instrumented profiler, or CPU profile.

Use `pnpm run verify:baseline -- --changed` when the touched area needs the
broader gate. If Vitest workers stall, report it as inconclusive; do not mark
the gate passed.

## When Done

1. Update the queue item status.
2. Update the self-prosecution block below with exact files/functions and a
   clear verdict.
3. If the pass produced benchmark/profile evidence, add the evidence summary to
   `PERFORMANCE-HANDOFF.md`.
4. If the pass changes the cutting doctrine, update
   `AGGRESSIVE-CUTTING-REVIEW.md`.
5. Run gates.
6. Stage only related files.
7. Commit and push.
8. Report:
   - commit hash;
   - machinery deleted, rejected, or deferred;
   - focused tests and gates;
   - benchmark/profile result or why it was inconclusive;
   - intentionally dirty unrelated files.

## Aggressive Cutting Self-Prosecution

- New traversal: `packages/core/src/tree/util/callable-entry.ts`
  centralizes `callableGuardContainsDefault(...)` for cold/direct
  construction-time inference only. Its loops and cycle `Set` are accepted
  solely as an API/synthetic-entry fallback when a caller omits
  `options.hasDefault`; parsed Less avoids this traversal by passing explicit
  `hasDefault: true | false` from `packages/less-parser/src/productions/root.ts`.
- New node/materialization: none. No new `Node`, copy, wrapper `Rules`,
  `.inherit(...)`, `.adopt(...)`, or `frozen` path was added.
- Render path: unchanged. This pass removed guard rediscovery from callable
  candidate preparation; it does not resolve or materialize nodes to stringify.
- Helper/API surface: one recursive detector was moved out of
  `prepareCallableEvalCandidates(...)` and reused by `Mixin`/`Ruleset`
  constructors and synthetic callable entries. This is accepted only because it
  deletes the measured candidate-loop traversal and is bypassed by parsed Less
  when the parser has the fact.
- Metadata mutations: removed the redundant hot-loop
  `candidate.options.hasDefault = true` write. Constructors allocate a tiny
  replacement options object only when direct API callers omit the flag and a
  guard actually contains `default()`.
- Evidence: before CPU profile had `guardContainsDefault` as the top frame
  (`313` samples). After the parser/core change and rebuild, CPU profile
  `profiling/core-architecture/CPU.20260605.174243.84124.0.001.cpuprofile`
  reports `guardContainsDefault = 0` and `callableGuardContainsDefault = 0`
  samples; the same run now points at copy/ownership and lookup surfaces.
- Verdict: accepted.
