# Core Architecture Handoff

This is the stable router for Jess core architecture work. Keep it short: it
tells the next agent where to choose a focus, how to complete a pass, and where
progress is tracked. Do not rewrite this file just to switch focus; set the
chat/Guildhall goal from `FOCII.md` instead.

## Focus Router

Choose exactly one active focus before editing. If the user names a focus,
follow that. If the request is ambiguous, infer from the branch and latest user
instruction, then record the chosen focus in the final response instead of
changing this router. Use `FOCII.md` for the goal prompt, boundaries, stop rule,
and required docs.

- **Binding / lookup:** use `BINDING-LOOKUP-REMAINING.md` for the active queue,
  remaining scope, progress notes, and completion gates. Use
  `BINDING-INDEX-PROPOSAL.md` for design intent. This stream owns registryless
  lookup, direct crawl/frame lookup, reference handles, live/current binding,
  fallback bridge deletion, and lookup profiles.
- **Serialization / `writeSyntax`:** use `NODE-REWRITE-TRACKER.md` for the
  active node-family queue, historical row status, serialization contracts, and
  completion gates. This stream owns direct syntax/render emission, cold public
  string wrappers, render readback removal, and node-family row closure.
- **Performance evidence:** use `PERFORMANCE-HANDOFF.md` for benchmark
  protocol, profile history, rejected experiments, speed claims, and the
  performance campaign completion target. An evidence refresh can finish a
  pass, but the performance campaign is not complete until Jess beats Less 4.x
  on the canonical Less benchmark comparison with stable/usable wall-clock
  evidence.
- **Patch-shape review:** use `AGGRESSIVE-CUTTING-REVIEW.md` before changing
  AST, eval/render, lookup, traversal, copying, inheritance, output writer,
  source/root metadata, or this router.

## Shared Direction

The fastest credible runtime path remains:

- one canonical source tree;
- direct eval/render-to-string for normal output;
- live lookup/binding/placement state instead of routine copied eval trees;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- fewer hot-path objects, arrays, recursive walks, helper calls, branch ladders,
  promise/generator states, and metadata mutations.

Less is the optimizing path. Preserve SCSS-enabling seams only when they are
concrete and cheap or isolated behind cold extension boundaries.

Do not preserve an unreleased or self-invented public-looking method for
compatibility alone. If repo usage does not need it and the user has not
approved it as API, delete or reshape it.

## Completion Rules

When the user says `continue`, `do all queue items`, `complete the queue`, or
`full queue pass`, run an autonomous focus pass:

1. Snapshot `git status --short --branch`.
2. Read this router, `FOCII.md`, and the chosen focus tracker.
3. State one hypothesis before editing.
4. Work through the active queue as a swath, not one micro-edit.
5. Keep moving until the queue is drained, the next item has materially
   different semantics, the next step needs user/product judgment, evidence
   rejects the approach, or a failing test/debugging thread needs focused
   investigation.
6. Use focused tests while iterating; run full gates at the coherent batch
   boundary.
7. Update the chosen focus tracker with only facts that change the next
   worker's decisions.
8. Update `Aggressive Cutting Self-Prosecution` below for the latest pass.
9. Commit and push the batch with `--no-verify` when the pass is complete.

A queue item must be a whole task with its own proof surface. It may contain
several sub-tasks, helper deletions, rejected cuts, and tests. Do not create or
mark complete one-line queue items. If an active queue item remains unfinished
at wrap-up, record in the focus tracker and final response which item remains,
what blocked immediate continuation, and why stopping was necessary.

Each active focus tracker should keep at least 15 unchecked sizable tasks
available unless that focus is genuinely within 15 tasks of completion.
Reseeding the next queue is closeout work, not a queue item. Completed history
belongs in git, focused tracker rows, or `PERFORMANCE-HANDOFF.md`, not in this
router.

Use sub-agents when available for disjoint evidence or implementation slices.
Good assignments include one node-family row, one lookup family, focused test
surface discovery, profile/call-stack audits, or review against the aggressive
cutting rules. Workers must not make overlapping edits, revert unrelated work,
commit independently, or change the selected focus. The main agent owns
integration, verification, docs, commit, push, and continuation.

## Gate Rules

Always run the smallest relevant test first. Before commit, run:

```sh
git diff --check
pnpm run verify:aggressive-cutting-review
```

Then run the chosen focus gates from its tracker. For performance work, use
`PERFORMANCE-HANDOFF.md` before choosing the target and before making any speed
claim: target selection must come from V8/CPU profile samples, benchmark phase
timing, or scoped elapsed-time instrumentation, with counters treated only as
supporting diagnostics. Use `pnpm run verify:baseline -- --changed` when the
touched area needs a broader fixture gate. The current hook path has previously
looped, so commit and push with `--no-verify` after the explicit gates pass.

## Aggressive Cutting Self-Prosecution

Keep this section to the current pass only. Move historical evidence to
`PERFORMANCE-HANDOFF.md` or the focused tracker that owns it.

- Latest pass: kept extend instruction keyset carry. The CPU-backed target was
  `processExtends(...)`, with `selectorMayContainExtendTarget(...)`,
  `isEmptyBitSet(...)`, and `isDisjoint(...)` under it.
- Verdict: keep the carried target/extendWith bitsets and precomputed target
  opacity/library facts on each root extend instruction. It removes repeated
  target keyset rediscovery inside root and selector guards without adding a
  candidate index.
- New traversal: none. The existing instruction/root/ruleset loops are
  unchanged.
- New node/materialization: none added.
- Render path: unchanged. Rendering does not create nodes or arrays to
  stringify through this pass.
- Helper/API surface: no new helper or public API.
- Metadata mutations: none.
- Side maps/arrays/copies: no new side maps. Each instruction now carries the
  already-needed target bitset, target library/opacity facts, and extendWith
  bitset so later guards do not re-read/re-scan them. The two `.clone()` calls
  in the diff are the pre-existing aggregate initialization copies for visible
  target and extendWith bitsets; this pass changes their input from freshly
  read selector keysets to carried instruction keysets.
- Evidence: current-source refresh measured `186.04ms` average /
  `185.21ms` median and `183.65ms` average / `177.61ms` median on external
  canonical Less `benchmark.less --runs=24 --warmup=8 --math=parens-division`.
  CPU profile
  `profiling/core-architecture/20260618-205309-current-refresh-cpu/CPU.20260618.205309.10336.0.001.cpuprofile`
  showed `processExtends(...)` at `22` self / `109` total samples,
  `selectorMayContainExtendTarget(...)` at `6` self / `30` total, and
  `isEmptyBitSet(...)` at `14` self. Focused extend/bitset tests passed
  (`105` passed, `1` skipped), the ordered benchmark package chain rebuilt,
  and the kept patch benchmarked `183.44ms` / `181.00ms`,
  `184.82ms` / `181.26ms`, then `168.98ms` / `166.68ms`. CPU profile
  `profiling/core-architecture/20260618-205514-extend-instruction-keysets-cpu/CPU.20260618.205514.40928.0.001.cpuprofile`
  moved `processExtends(...)` to `15` self / `98` total,
  `selectorMayContainExtendTarget(...)` to `4` self / `16` total, and removed
  `isEmptyBitSet(...)` from named totals.
