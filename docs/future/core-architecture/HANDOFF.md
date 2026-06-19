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
- `Node.sourceParent` only for canonical source ancestry; runtime placement,
  callable output ownership, render indentation, and scope/frame relationships
  must live in explicit state, not in source ancestry;
- `sourceParent` is write-once canonical source ancestry. Parser/
  construction/adoption may set it on a newly owned canonical child; after that
  established value must not be rewritten. Explicit cold
  materialization may create a new detached/materialized tree and stamp ancestry
  on those new public nodes, but it should stamp once, should not leave the
  ancestry pointer mutable, and must not move canonical nodes or pretend
  runtime placement is source ancestry. `inherit()` is replacement metadata
  only, not ownership, placement, or source ancestry;
- normal eval/render/callable/lookup/import code must not rewrite `sourceParent`.
  Source ancestry should be established by parser/construction/adoption of the
  canonical tree, then treated as immutable runtime metadata. If a runtime path
  thinks it needs to move `sourceParent`, carry placement/scope/owner state
  directly instead;
- `.inherit(...)` is a shrinking compatibility/replacement helper, not a design
  primitive. It should become rare: replacement scalar results, isolated public
  materialization, or selector/extend subset construction are the expected
  remaining families. Treat every hot-path call as debt to audit or delete. Do
  not add new uses without deleting larger machinery, and prefer constructor/
  adoption-time metadata or direct result state over repeated inherit stamping.
  `inherit()` must not indirectly adopt children or rewrite source ancestry for
  placement; split selector/keyset metadata inheritance from source ownership
  when needed. Do not preserve frequent `.inherit(...)` calls just because the
  helper no longer copies `sourceParent`: call volume is itself suspicious in
  eval/render/callable/lookup/import paths and must be driven down or isolated
  to a named cold/materialization boundary. A queue pass that touches a file with
  hot-path `.inherit(...)` sites should either delete/isolate at least one site
  family or record why that family is selector/extend/public-materialization
  work outside the active lane;
- direct eval/render-to-string for normal output;
- live lookup/binding/placement state instead of routine copied eval trees;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- no deep child copies for callable, mixin, eval, render, lookup, or
  registration ownership. The only exceptions are narrowly scoped selector
  subset copies for Less extend behavior after source-backed selector state is
  not viable, and third-party JavaScript function interop materialization of
  live binding/rules values;
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

Every sub-agent prompt must include minimum setup steps before it edits or
measures:

1. Work in its assigned worktree only; never use the base dev checkout.
2. Run `git status --short --branch` and read this router plus the selected
   focus tracker.
3. Materialize built workspace libraries before tests, profiling, declaration
   builds, or external Less harness runs. The minimum setup is `pnpm build`
   from the assigned worktree before package-specific commands; this root
   script builds the Jess runtime/library dependency chain, not docs or editor
   packaging. Performance agents should then use the ordered benchmark-path
   build list in `PERFORMANCE-HANDOFF.md` after edits so affected packages are
   freshly built in dependency order. If a workspace package cannot resolve
   another Jess package, treat that as missing build output/setup, not as a
   reason to skip verification.
4. Report exact tests, builds, benchmark commands, and any setup failures back
   to the main agent. Sub-agents do not commit or push.

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

- Latest pass: explicit adoption for hot object/tuple constructor families.
- Verdict: accepted as a measured performance cut, not goal completion.
  `Operation`, `Declaration`, `Ruleset`, and `Mixin` now opt out of base
  constructor `_processNodes(...)` and adopt their known child slots in the
  concrete constructor.
- New traversal: direct child-slot adoption in four constructors. It replaces
  the previous generic base object/tuple `_processNodes(...)` scan for the same
  constructor values; it does not recurse into arbitrary object values or
  discover new child surfaces.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: one internal constructor flag only.
- Metadata mutations: direct `adopt(...)` calls for known node slots. They
  preserve the previous source-parent/static/async flag adoption semantics, but
  run in concrete constructors instead of the generic base scanner.
- Copy/materialization: none.
- Materialized array/object note: no new arrays or objects are created by this
  pass.
- Danger-token note: none added. No clone/copy/materialization path was added.
- Evidence: ordered affected-package rebuild passed; focused
  `@jesscss/core` visitor/operation/declaration/ruleset/mixin/reference/rules
  suite passed (`629` passed, `14` skipped, `9` deferred markers); live comparator on
  `benchmark.less` used `--runs=100 --warmup=25 --less4=measure` and measured
  patched Jess at `130.16ms` median / `131.48ms` trimmed average, then
  `123.94ms` / `126.13ms`; after restoring explicit non-node guards, the final
  checked shape measured `126.12ms` / `127.46ms`, improving on the prior kept
  constructor batch.
