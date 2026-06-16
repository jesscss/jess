# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short and
operational.

Use the four-doc split:

1. `HANDOFF.md`: how to perform the next pass, the active work, gates, focus
   spec, and completion steps.
2. `AGGRESSIVE-CUTTING-REVIEW.md`: hardline patch-shape rules.
3. `PERFORMANCE-HANDOFF.md`: benchmark/profile protocol, evidence history,
   target queues, and rejected experiments.
4. `NODE-REWRITE-TRACKER.md`: node-by-node rewrite table and completion
   status.

Active implementation specs:

- `BINDING-INDEX-PROPOSAL.md`: binding-index implementation spec for
  reference lookup, Less contextual semantics, Jess/Sass-style live bindings,
  and removal of transitional fallback bridges. It is active while the
  `Active Binding Implementation Lane` below has unchecked items.

## How To Work

1. Read this handoff first.
2. Read `AGGRESSIVE-CUTTING-REVIEW.md` before changing AST, eval/render,
   lookup, traversal, copying, inheritance, output writer, source/root metadata,
   or this handoff.
3. Read `PERFORMANCE-HANDOFF.md` before making or accepting any speed claim, or
   before touching a measured hot path.
4. Choose work from the highest-priority active lane below. An unchecked active
   implementation lane outranks benchmark cutting, node cleanup, and smell
   sweeps unless this handoff explicitly marks that lane paused.
5. Start each non-correctness pass from the benchmark leash below when the
   selected lane touches measured hot paths.
6. State one hypothesis before editing.
7. Make the smallest behavior-preserving cut that removes measured work or
   clearly wrong machinery.
8. Run focused tests first, then the required gates.
9. Keep, reshape, or revert based on the benchmark evidence and the aggressive
   cutting self-prosecution.
10. Commit and push the completed pass.

Temporary push rule: use `git push --no-verify` after focused tests, build,
benchmark leash, and `verify:aggressive-cutting-review` pass. The current
pre-push `verify:baseline` path can hang silently and should not be used again
until that hook is patched.

## Focus Spec

Active mode: **node `writeSyntax` render/stringification rewrite**.

Temporary lane switch: the binding-index lane is paused by explicit
user-direction until the `writeSyntax` node queue in
`NODE-REWRITE-TRACKER.md` is complete or this handoff explicitly switches back.
Do not let binding cleanup, generic smell sweeps, or unrelated performance
experiments overrule the `writeSyntax` queue while this mode is active.

Focus lock: Jess core work has one active focus at a time. The current focus is
the repo-wide node serialization rewrite, spanning all remaining node families.
No secondary queue may compete for the front of the line. Do not start
selector/equality cleanup, binding-index work, lookup redesign,
copy/materialization cleanup, benchmark tuning, or general smell sweeps as
separate work while this focus is active. If one of those areas is touched, it
must be only because the currently selected node-family serialization task
cannot be completed without that exact local edit, and the self-prosecution
must name the selected node row it serves.

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

Work shape while `writeSyntax` is active: run autonomously across the full
open tracker, not one-node dribbles. When the user asks for a full queue pass
or to continue, keep selecting the next highest-value unfinished
node/family row in `NODE-REWRITE-TRACKER.md`, implement the bounded cut, test,
update docs, commit, push, and immediately continue to the next row. Do not
stop to report ordinary progress after a single partial cut. Stop only when
all open tracker rows are complete, a test exposes a real semantic blocker,
the repo becomes unsafe to proceed, or the next remaining work is explicitly
benchmark-first tradeoff/design work rather than an evident serialization cut.

If context compacts mid-run, resume from the live tracker and git state rather
than restarting the audit. Treat each commit as a checkpoint, not the end of
the user's request. A full autonomous run should leave one or more whole
families complete whenever the code allows it; a pass is invalid if its
primary result is selector/equality cleanup, benchmark-chasing, lookup cleanup,
copy cleanup, or generic helper polish instead of node serialization
completion.

Use sub-agents when the tool environment supports them. Good sub-agent work is
independent, evidence-gathering, and bounded: assign separate open node rows,
hot call-stack audits, test-surface searches, or "smallest equivalent rewrite"
proposals. Do not ask sub-agents to make overlapping edits in the same files,
commit independently, or change the active focus. The main agent owns final
judgment: compare sub-agent findings against repo evidence, implement the
chosen cuts in the primary worktree, run the gates, update handoff/tracker
docs, commit, push, and continue.

Queue items must be **entire tasks**, not micro-items. A queue item is a
meaningful node-family or runtime-path objective with its own proof surface,
for example "finish the `Call` render/stringification cleanup" or "remove
`AtRule` leaf/body render string transport where semantics allow it." It may
contain several sub-tasks, helper deletions, rejected cuts, and tests, but those
sub-tasks are not themselves queue items. Do not mark a queue item complete
because a one-line helper moved, a single closure was lifted, one regex was
replaced, or one narrow fast path was added while the larger stated task remains
open.

Queue floor: after every handoff update, leave at least **15 unchecked sizable
queue items** available across the active lane unless the lane is genuinely
within 15 tasks of completion. If fewer than 15 remain, split by whole
node-family/runtime boundary, not by one-line edits.

A valid autonomous queue run should complete every currently safe cut across
the open tracker, preferably closing one or more whole queue items. It may
record a partial cut under an open item only as an intermediate checkpoint
before immediately continuing, or when the current whole item is blocked by a
semantic decision, benchmark-first tradeoff, or unsafe behavior boundary. Do
not create new numbered queue entries just to memorialize every tiny cut.

Sweep the unchecked node/family list in `NODE-REWRITE-TRACKER.md`, land every
bounded deletion that shares the same proof surface, and stop only when the
remaining candidates require a larger semantic design, a behavior decision, or
benchmark-first tradeoff work. For each touched node, split direct emission
from public string capture, make render call the direct writer path after value
selection, and prove output with focused tests. Run the aggressive cutting
gate, record any benchmark/profile status if a touched node is hot, then commit
and push the whole coherent batch. Reject changes that make `render(...)` call
public `toString(...)`/`toTrimmedString(...)` as transport, or that add helper
objects/arrays only to describe syntax.

Serialization contract for this lane:

- `writeSyntax(...)`: direct syntax/source emission to the provided writer,
  with no returned string and no public string API as transport.
- `render(...)`: select/evaluate the runtime value, then write directly to the
  writer or render buffer. Render must not capture a public string just to
  write it back out.
- public `toString(...)` / `toTrimmedString(...)`: cold capture wrappers only.
  They may use `mark/getSince`; render-only paths may not.
- no render-only `mark/getSince`, `capture`, `preview`, writer readback,
  helper object, temporary syntax array, or detached writer allocation remains;
  if one cannot be removed in this focus, the node row must document the cold
  public materialization boundary or semantic blocker before moving on.

## Active Work

Correctness queue: no active correctness blockers. If a `.less` fixture fails
to parse/evaluate, add a focused repro before changing expected output. If CSS
differs, review semantics manually before changing tests.

Performance leash:

1. Start from the current selector `writeSyntax` baseline:
   broad `benchmark.less` profiler status had `OutputWriter.mark` `54534` and
   `OutputWriter.getSince` `49502`.
2. Choose the next node/family task from `NODE-REWRITE-TRACKER.md`; use
   caller-stack evidence for priority when several unchecked serialization rows
   are available.
3. Rerun focused tests and, for hot nodes, broad `benchmark.less` profiler
   status after the patch.
4. Keep the patch only if it completes or materially advances the selected
   serialization row and does not violate the benchmark leash. Performance is
   a gate here, not the active queue, and a benchmark result does not justify
   switching focus.

Immediate benchmark commands are defined in `PERFORMANCE-HANDOFF.md`.
Performance evidence/history stays parked there; this handoff owns the active
work lane and the gates for proving each slice complete.

Binding status: paused while `writeSyntax` is active. The compact binding lane
below records completed production facts and the one open binding-handle task.

## Active Binding Implementation Lane

This lane tracks `BINDING-INDEX-PROPOSAL.md`. It is currently paused by the
Focus Spec, but these facts matter when work returns here.

Completed:

- [x] Harness semantic proof for current reads, `$!` occurrence reads, `:=`
  parent-cell mutation, and child `:` shadowing.
- [x] Static-variable `ScopeFrame` lookup facade.
- [x] Source-order/current-read hardening, including explicit `$!` syntax.
- [x] Declaration-bucket binding identity for covered static variable reads.
- [x] Explicit covered `MISS` vs `UNCOVERED` fallback.
- [x] Parent-frame coverage for nested static variable lookup.
- [x] Already-static pending declaration-name promotion before facade lookup.
- [x] Frame-owned declaration coverage for manual/prebuilt frames.
- [x] Fallback-frame lookup ownership for covered static variable reads.
- [x] Standalone lookup-cache attempt rejected; do not bolt on a separate
  cache layer.
- [x] Callable-record prototype for simple static callable hit/miss cases.

Current facts:

- Covered static variable hits/misses should stop in the binding facade.
- `UNCOVERED` is only for explicitly unmodeled/cold cases: explicit targets,
  interpolated keys, non-snapshot contextual `start`, still-dynamic or async
  deferred declaration names, and frames whose declaration surface is not
  covered.
- Ordinary current reads and explicit `$!` source-position reads are distinct;
  do not revive `$^` or `$~`.
- No evaluated-value cache exists. Repeated lookup reuse should come from a
  coherent binding-handle system, not a side cache.

12. [ ] Binding handle reuse model.
   Design and prototype one coherent binding/index system for repeated
   references. Do not add a separate "lookup cache" layer. A reference should
   ask for a binding handle that already carries scope/version, reference
   shape, resolved declaration/callable/property identity, static/dynamic/live
   facts, and whether evaluated value or rendered scalar text can be reused.
   Example target: repeated `.a.b.c[@color-1]` in the same evaluated scope
   should not rediscover the `.a.b.c` callable/ruleset path and declaration
   binding twice.

   Completion gate:
   - no separate cache layer beside binding/index state
   - binding handles carry identity from existing reference/path/scope state,
     not rebuilt string joins or arrays on every lookup
   - repeated compound-reference fixture proves the same binding facts are not
     rediscovered
   - no rules/mixin output caching
   - no public materialization cache on the hot render path
   - evaluated value/text reuse requires explicit static/effect facts on the
     binding handle
   - benchmark before/after proves value

   Current status:
   - Static compound reference key arrays now keep their original array
     identity when they already contain strings. This is a binding-handle
     adjacent cut, not the finished handle system: it stops rebuilding a path
     fact the reference already owns.
   - Callable namespace lookup now walks static path arrays by offset instead
     of allocating `[segment, ...rest]` at every namespace hop.
   - Runtime variable binding lookup no longer allocates a defensive
     `Set<ScopeFrame>` on every lookup, and scope-frame variable lookup no
     longer allocates a per-call `blockedSource` closure just to test
     `context.searchScope.has(...)`. Check-only recursion probes read the
     existing `_searchScope` field directly so misses do not lazily create the
     set.
   - `findVarDeclarationFast(...)` now reuses one `Set<Rules>` for its
     independent scope-surface walks instead of allocating a new visited set
     for every parent/fallback surface search, and `buildReferenceFilter(...)`
     no longer allocates a noop pass-through filter or calls a one-line
     search-scope helper on every filter hit.
   - Ordinary variable lookup no longer builds the Reference filter callback
     before trying binding-frame and fast declaration lookup. It carries the
     original caller filter, `_searchScope`, and param-var rules context as
     fields and only synthesizes a registry callback for non-variable
     `Rules.find(...)` paths.
   - `Rules` callable/ruleset namespace helpers now reuse one `Set<Rules>` per
     helper invocation for their independent surface searches instead of
     allocating a fresh visited set for each parent scope.
   - A focused reference test proves the mixin array-path lookup receives the
     original static key array instance.
   - No cache, evaluated-value reuse, side map, materialized node, output
     wrapper, or render-path change was added.
   - Current completion boundary: this item is only the callable-record
     prototype. `Binding handle reuse model` remains open because repeated
     reference reuse is not implemented as one coherent binding-handle system.

Secondary deep-cut queue:

Do not add micro-items here. Completed pass history belongs in git and
`PERFORMANCE-HANDOFF.md`; this queue should tell the next agent what remains.

Completed highlights:

- [x] Callable `default()` guard classification moved out of hot candidate
  prep.
- [x] Static non-rules-like reference values can return directly without
  routine copy.
- [x] `PseudoSelector` and `Ampersand` have structural render/placement cuts.
- [x] `Reference` passes 1-10 removed wrapper closures, duplicate copy/eval
  branches, option-object plumbing, render-only post-eval copy/inherit, and
  several hot lookup helper allocations.
- [x] Sync immediate eval/render split landed for the covered nodes; routine
  render replacement should not imply public materialization or `.inherit(...)`.

Open tasks:

Current active queue, refreshed every pass. Each item is a whole task with its
own proof surface; do not convert these into micro-items. Keep exactly this
shape current before commit.

1. [ ] Finish `Call` render/stringification cleanup: callable output selection,
   remaining whole-call return/readback boundaries, `evalArgNodes(...)` copy
   pressure, non-scalar/custom/trivia arg trim marks, async helper ladders, and
   repeated eval.

   Current partial status: empty string-name calls skip writer readback;
   rendered args are side-effect writes instead of discarded strings; plain and
   evaluated CSS-call buffer render reuses the caller mark; scalar-contract args
   (`Num`, `Dimension`, `Color`, `Bool`, `Any`, `Anonymous`, `Keyword`) skip
   per-arg trim/eval when no trivia is active and base `Node.eval` is intact;
   `writeEvaluatedSyntax(...)` also writes those same static scalar token
   contracts directly instead of calling `evalImmediateSync(...)`; the scalar
   check uses direct type tags rather than the generic `isNode(...)`
   classifier; stylesheet `Func` calls now pass the source arg list to the
   callable binding surface instead of pre-evaluating a copied replacement
   `List`; finalized empty string-name fallback calls write the known
   `name()`/important text directly without opening a call-level mark/readback.
2. [ ] Finish `QueryCondition` dynamic render by removing the child mark probe
   only after child render contracts prove write-vs-return behavior directly.

   Current partial status: static child fast-path checks no longer call
   `Object.getPrototypeOf(...)` per child. QueryCondition now uses explicit
   owned scalar type/prototype contracts (`Any`/`Anonymous`/`Keyword`, `Bool`,
   `Dimension`/`Num`, `Color`) before direct `writeSyntax(...)`; custom render
   overrides still use the localized write-vs-return mark fallback.
3. [ ] Finish `AtRule` body-state staging and remaining custom
   eval/import/render branch ladders.

   Current partial status: dynamic leaf rendering no longer calls child
   public `toString(...)` from `renderLeafNodeToString(...)`; it writes child
   syntax directly and keeps the existing localized mark only for the needed
   string boundary.
4. [ ] Finish `Ruleset.getHeaderString(...)` capture removal for frame
   render/comparison paths and same-property duplicate declaration pre-render.
5. [ ] Finish `Declaration` custom-property raw-source, merge-state, internal
   mark/replace, and materialization boundaries.

   Current partial status: custom-property fallback stringification now uses
   direct `writeSyntax(...)` with a detached writer instead of child
   `toString(...)`; custom value writing also uses direct syntax; non-custom
   declaration `writeSyntax(...)` now writes directly without the outer
   declaration mark/readback used only by cold string-return callers;
   space-merge rendering stopped returning an unused captured string.
6. [ ] Finish `Rules` root/body render, imports, placement state, merge output,
   and duplicate declaration materialization.

   Current partial status: root-owned `@charset` output now writes the
   context-owned scalar charset syntax directly instead of calling public
   `toTrimmedString(...)`. Plain no-trivia root imports now write direct
   `AtRule` syntax instead of calling public `toString(...)` on a detached
   writer. Plain no-trivia leading comments before root imports now write
   direct `Comment` syntax instead of calling public
   `Comment.toTrimmedString(...)` on a detached writer. Complex root import and
   trivia-backed leading-comment stringification, body render, placement state,
   merge output, and duplicate declaration materialization remain open.
7. [ ] Finish `Reference` public value materialization, rules-like surfaces,
   merged assign normalization, key conversion, and remaining cold copy/inherit
   ownership.

   Current partial status: non-buffer `Reference.render(...)` now prepares the
   context-owned render print state once and passes it to resolved child
   renders, fixing detached scalar child writes without adding public
   materialization. Buffer `Reference.render(...)` now strips explicit writers
   before resolved child renders and writes only the returned text to the
   requested render buffer.
8. [ ] Finish `Mixin` guard/default/body copy interactions and callable
   candidate output.
9. [ ] Finish `Interpolated` cold replacement capture, selector/generic
   materialization, and replacement arrays.

   Current partial status: whole-selector and embedded selector interpolation
   with owned scalar token replacements (`Any`/`Anonymous`/`Keyword`) now build
   selector text from the replacement value directly instead of calling public
   `toTrimmedString(...)`. Public `replace(...)` also reads owned scalar token
   text directly for those replacements. Generic `Any` materialization now
   writes evaluated replacements directly instead of calling public
   `Interpolated.toTrimmedString(...)` on itself. Embedded selector-list
   replacements still use the generated `PseudoSelector` semantic wrapper for
   `:is(...)`, but now write that wrapper through `writeSyntax(...)` instead of
   public `PseudoSelector.toTrimmedString(...)`. Public `replace(...)` now
   writes non-scalar replacements through direct `writeSyntax(...)` on its cold
   string boundary instead of calling public replacement
   `toTrimmedString(...)`. Whole and embedded non-scalar selector assembly now
   use the same direct replacement writer instead of public replacement
   `toTrimmedString(...)`. Replacement arrays and semantic selector ownership
   boundaries remain.
10. [x] Finish `StyleImport` first-use placement copies by replacing them with
   canonical source placement state, or document the exact semantic blocker.

   Completion status: configured import variable-key matching and binding
   attachment no longer call declaration-name public `toString(...)`; normal
   `Any` names use direct `.value`, with non-Any names falling back to
   `valueOf()`. The remaining first-use child copies are documented in
   `NODE-REWRITE-TRACKER.md` as semantic placement state: focused tests require
   owned placement children and source-child mapping. Do not remove them as a
   convenience-copy cut without a replacement placement-state model.
11. [ ] Finish `Node` base/source render fallback so inherited source render no
   longer routes hot render through public `toTrimmedString(...)`.

   Current partial status: base `Node.writeSyntax(...)` no longer calls child
   public `toString(...)`; child values write syntax directly. Base
   `toTrimmedString(...)` also writes child values directly, using the
   source-trivia emitter instead of child public stringification when trivia is
   active. Base `renderSource(...)` still routes through
   `toTrimmedString(...)`; `node-render-buffer` has a deliberate source-only
   adapter that currently makes this a compatibility boundary, so the item
   remains open.
12. [ ] Finish scalar wrapper leftovers in `Block`, `Paren`, `Url`, `Quoted`,
   `Negative`, and `AttributeSelector` where localized mark/readback remains
   outside documented cold/public boundaries.

   Current partial status: `Block` and `Url` no longer route trivia-backed
   child emission through public child `toString(...)`; they use direct
   source-trivia syntax emission. `RawRules` received the same child-emission
   cut even though it is tracked in the node tracker rather than this scalar
   wrapper row. `AttributeSelector` now writes common scalar non-bare forms
   (`Any`/simple `Quoted` values, including resolved variable values) without
   writer mark/readback. `Block` scalar `Any` flat-buffer render and
   `Negative` scalar dimension flat-buffer render now write known text without
   print-state setup, writer mark/readback, or a second writer-to-buffer copy.
   `Url` scalar `Any` render now writes/buffers normalized `url(...)` text
   directly after value selection, without prepared writer setup,
   mark/getSince, replaceSince, or a second writer-to-buffer copy. Non-scalar
   URL normalization and non-scalar wrapper render still keep localized
   mark/readback boundaries. `Paren` dynamic wrapped render now keeps child
   intermediate render text out of explicit writers and writes only the final
   wrapped string to the requested writer or buffer. `Quoted` escaped literal
   render now writes final raw text to explicit writers and keeps buffer output
   out of those writers. `Quoted.compare()` now uses value semantics instead
   of public `toString()` transport. `AttributeSelector.valueOf()` now uses
   node value semantics for node-valued names instead of public
   `toTrimmedString()` transport.
13. [x] Finish `List`/`Sequence` public render string-return compatibility:
   either document it as the cold public boundary or split a direct buffer-only
   path that avoids returning a string when callers do not need it.

   Completion status: `Sequence.renderResolvedValue(...)` no longer passes
   an explicit caller writer into the single-node child render when a render
   buffer is the requested sink. The child result is rendered to a string and
   written once to the render buffer, so buffer-only sequence rendering no
   longer also mutates an unrelated explicit writer. This covers both the
   resolved `value instanceof Node` branch and the single non-`Nil` child
   branch. `List` does not share this exact leak because its buffer path already
   goes through `prepareBufferPrintState(...)`, which strips explicit writers.
   Both `render(context)` overloads and `RenderBufferNode.render(...)` still
   return `MaybePromise<string>` by public API contract, and the buffer helpers
   return the text they write. Treat that returned string as the documented
   public compatibility boundary, not as an open render-only capture bug.
14. [ ] Finish `List`/`Sequence` addition/materialization copy ownership,
   including `deriveAdditionSequence(...)`, `copyWithReusableLeaves(...)`, and
   output ownership after arithmetic/list operations.
15. [ ] Finish `Operation` arithmetic materialization and preserve-mode calc
   fallback ownership without adopting unchanged canonical operands.

   Current partial status: sync render/resolve operand evaluation now uses
   `evalImmediateSync(...)` for non-`F_MAY_ASYNC` operands instead of public
   `eval(...)` plus thenable checks. Preserved-operation flat-buffer render no
   longer leaks intermediate operand text into a caller-supplied explicit
   writer. `withOperands(...)` copy pressure and preserve-mode `calc(...)`
   fallback ownership remain open.

Parked until the current `writeSyntax` focus ends:

- selector/extend equality and factory cuts;
- binding-index fallback bridge cleanup;
- broad copy-stack work that is not required by the selected node family;
- benchmark tuning that is not a leash for the active serialization task.

Evidence pointer: use `NODE-REWRITE-TRACKER.md` for per-node status and
`PERFORMANCE-HANDOFF.md` for benchmark/profile history.

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

1. Update queue status only at the whole-task level. Mark a queue checkbox done
   only when the stated task objective is complete against its proof surface.
   Otherwise record the change as partial status under the still-open item and
   keep the checkbox open.
2. Replace the self-prosecution block below with exact files/functions and a
   clear verdict for the current pass. Do not append pass history.
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

This section is deliberately current-pass only. Replace it on each pass; do not
append pass history here. Durable status belongs in the active queue/tracker,
performance evidence belongs in `PERFORMANCE-HANDOFF.md`, and old prose stays
recoverable from git history.

Current pass: `Rules` root leading-comment direct syntax cut.

- New traversal: none. `packages/core/src/tree/rules.ts` adds no loop,
  recursion, parent/source walk, side-map lookup, object/array scan, generator,
  or collection helper.
- New node/materialization: none. Existing visible root `Comment` nodes are
  written directly; no wrapper, copy, inherit, adopt, source/root metadata, or
  array materialization was added.
- Render path: plain no-trivia leading comments before root hoisted imports now
  emit `node.writeSyntax(options)` directly instead of
  `printDetached(...node.toTrimmedString...)`. Trivia-backed comments remain on
  the detached stringification boundary.
- Helper/API surface: one local predicate,
  `canWriteRootLeadingCommentSyntaxDirectly(...)`, guards only the already
  direct no-trivia comment case and keeps complex comments on the old path.
- Metadata mutations: none added. The new source-root read only keeps
  source-trivia-backed comments on the existing detached path; existing
  visible-comment suppression/restoral around top imports is unchanged.
- Error/control flow: no production error objects or throw/catch control flow
  added. The new throw is test-only monkey-patch proof.
- Rejected/deferred cut: root body serialization, complex/trivia-backed leading
  comments, complex imports, placement state, merge output, and duplicate
  declaration materialization remain open.
- Evidence: focused red/green test
  `streams root charset and imports without capture scaffolding` failed when
  leading `Comment.toTrimmedString(...)` threw before the cut and passed after.
- Verdict: accepted as a bounded `Rules` root serializer cut. Keep item 6 open
  for the remaining root/body serializer and materialization boundaries.
