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
   `name()`/important text directly without opening a call-level mark/readback;
   source syntax for no-trivia numeric/bool/color comma arg lists writes args
   directly without the inner trim mark/readback; trim-stable token args
   (`Any`/`Anonymous`/`Keyword`) now use that same simple source-arg writer and
   skip the inner arg-list trim mark when no trivia is active; plain/finalized
   call render now carries a string-only text state for known scalar/no-trivia
   args and content, including async scalar resolutions, so those paths return
   known text without whole-call writer readback. Color args are now also
   covered by the known evaluated scalar writer, matching the earlier
   `serializeRenderedArgs(...)` scalar classification and avoiding the
   fallback per-arg trim mark/readback. `evalArgNodes(...)` now runs a
   sync-first loop, evaluates non-`F_MAY_ASYNC` args through
   `evalImmediateSync(...)` instead of public `eval(...)`, and only enters an
   async continuation after an evaluated arg is actually thenable. Focused tests
   prove base sync args bypass public `Node.eval`, custom sync eval overrides
   still run, and the existing `copyWithReusableLeaves` ownership boundary plus
   `calcFrames` cleanup are preserved.
2. [ ] Finish `QueryCondition` dynamic render by removing the child mark probe
   only after child render contracts prove write-vs-return behavior directly.

   Current partial status: static child fast-path checks no longer call
   `Object.getPrototypeOf(...)` per child. QueryCondition now uses explicit
   owned scalar type/prototype contracts (`Any`/`Anonymous`/`Keyword`, `Bool`,
   `Dimension`/`Num`, `Color`) before direct `writeSyntax(...)`; custom render
   overrides still use the localized write-vs-return mark fallback. Exact base
   `Paren` children are now included in the direct static child contract, while
   `Paren` subclasses/custom syntax stay on the fallback readback path. Static
   render and direct flat-buffer render now avoid the top-level query
   mark/getSince readback for direct scalar/paren children, and dynamic render
   carries returned text locally so only uncertain/custom children pay the
   localized probe. QueryCondition child boundary spacing now writes the literal
   boundary directly instead of calling a one-line helper. A no-op audit kept
   the localized child probes because focused QueryCondition tests prove custom
   dynamic children may either return text without writing or write different
   text than they return.
3. [ ] Finish `AtRule` body-state staging and remaining custom
   eval/import/render branch ladders.

   Current partial status: dynamic leaf rendering no longer calls child
   public `toString(...)` from `renderLeafNodeToString(...)`; it writes child
   syntax directly and keeps the existing localized mark only for the needed
   string boundary. Nested `@layer` registration now reads at-rule name value
   identity directly instead of calling public name stringification while
   walking active parent layer records. `evalNode(...)` no longer wraps
   `evalBodyNode(...)` in a catch/rethrow or async rejection handler that only
   rethrows, and narrowed async body/prelude branches now call `.then(...)`
   directly instead of wrapping already-thenable values with
   `Promise.resolve(...)`. `getHeaderString(...)` now writes non-scalar header
   name/prelude text into detached `OutputWriter` instances instead of using
   the caller writer with `mark()/getSince()/restore()` rollback; trailing
   prelude comment trivia also writes to a detached writer while preserving active
   emitted-trivia state. Dynamic leaf at-rule name/prelude assembly now uses
   the same detached writer boundary for non-scalar pieces instead of
   caller-writer mark/readback. The root-only hoisted-parent frame scan now runs
   only when `context.bubbleRootAtRules && this.isRootOnly()` can use it, so
   ordinary at-rule body eval skips the frame walk. Leaf/header whitespace
   checks now use direct character scans instead of regex `trim()`/`replace()`
   probes, and prelude/post spacing no longer concatenates temporary strings
   only to test trailing whitespace. Body eval result finishing is lifted out of
   per-call nested closure scaffolding into node methods. Evaluated AtRule
   render now opens the prepared-writer buffer mark only when a shared flat
   buffer can consume it; segmented and non-shared buffer renders skip that
   dead mark and use the returned render text path.
4. [ ] Finish `Ruleset.getHeaderString(...)` capture removal for frame
   render/comparison paths and same-property duplicate declaration pre-render.

   Current partial status: `getHeaderString(...)` no longer writes selector
   syntax into the caller's active writer and then rolls it back with
   `mark()/getSince()/restore()`. Header selector text now uses a detached
   `OutputWriter`, restores the caller writer/trivia/reference-filter state in
   `finally`, and the focused Ruleset test asserts the caller writer receives
   no mark/readback/restore traffic. Duplicate declaration caches and the
   reverse same-property pre-render pass now allocate/run only after the first
   scan proves at least one declaration property repeats. Registration now
   calls `selector.eval(context)` directly instead of routing through a
   private one-line selector identity helper. Evaluated Ruleset render now opens
   the prepared-writer buffer mark only when a shared flat buffer can consume it;
   segmented and non-shared buffer renders skip that dead mark and use the
   returned render text path. Deeper selector composition, body prep, wrappers,
   direct container writer splitting, and render branches remain open.
5. [ ] Finish `Declaration` custom-property raw-source, merge-state, internal
   mark/replace, and materialization boundaries.

   Current partial status: custom-property fallback stringification now uses
   direct `writeSyntax(...)` with a detached writer instead of child
   `toString(...)`; custom value writing also uses direct syntax; non-custom
   declaration `writeSyntax(...)` now writes directly without the outer
   declaration mark/readback used only by cold string-return callers;
   space-merge rendering stopped returning an unused captured string; simple
   no-trivia `Any` property names and important flags now write known text
   directly without local trim marks. Raw custom-property scalar `Any` values
   without declaration-terminator line breaks now write directly and skip the
   custom value mark/replace/readback normalization boundary; trailing-line-break
   values intentionally stay on the normalization path, and that path now uses
   a character scan instead of regex replacement to detect/drop the terminal
   declaration newline. Buffer renders now write declaration syntax directly
   under their existing outer buffer mark instead of nesting the cold
   `declValueTrimmedString(...)` mark/readback helper. Known no-trivia
   `Any` name/value declaration buffer renders with default assignment and no
   merge/custom/interpolated state now write the final declaration text directly
   to the requested buffer without prepared-writer mark/readback setup.
   Render-assignment and
   custom-interpolated replacement chains now call `.then(...)` directly after
   `isThenable(...)` narrowing instead of wrapping already-thenable values with
   `Promise.resolve(...)`. Render-assignment merge adapter state no longer
   carries the unused stale `value` field; the selected render value remains on
   the outer declaration render state. Assignment normalization and eval value
   state now mutate the existing state object directly instead of allocating
   local setter closures and shadow state variables. Custom-property fallback
   function call assembly now reads scalar `Any` fallback names/args directly
   instead of opening detached writer/stringification paths for those parts;
   non-scalar fallback parts stay on the existing detached cold boundary.
6. [ ] Finish `Rules` root/body render, imports, placement state, merge output,
   and duplicate declaration materialization.

   Current partial status: root-owned `@charset` output now writes the
   context-owned scalar charset syntax directly instead of calling public
   `toTrimmedString(...)`. Root imports and leading comments before root imports
   now write direct syntax in both no-trivia and trivia-backed detached-writer
   branches instead of public `toString(...)`/`toTrimmedString(...)` transport,
   and the root serializer only allocates the leading-comment suppression list
   when it actually suppresses comments. Source-mode non-container leaf rules
   now write direct syntax instead of calling public `toTrimmedString(...)` and
   discarding its returned string. Source-mode child `Rules` wrappers now emit
   their body directly through `_emitSourceRulesBody(...)` instead of public
   `toTrimmedString(...)` preview transport; the caller mark is only kept to
   discard genuinely empty child output. Render-mode static/evaluated child
   `Rules` wrappers now emit their body directly through `_emitRenderRulesBody(...)`
   instead of `writer.preview(...)` around public `render(...)` transport.
   Static declaration registration prep now calls `.then(...)` directly after
   `isThenable(...)` narrowing instead of wrapping already-thenable prepared
   nodes with `Promise.resolve(...)`. Render-mode unprepared dynamic child
   `Rules` wrappers now set up the child rules context and stream the child body
   directly instead of entering `writer.preview(...)` around public
   `render(...)` transport. Hoisted parent selector headers now write selector
   syntax directly instead of calling the parent selector public `toString(...)`
   into the detached header writer. `Rules.render(..., buffer)` now prepares
   its print state with the requested render buffer and uses the prepared
   writeback helper, so shared flat-buffer writers do not append a second copy
   of the rendered rules body; the helper writes only a missing returned-text
   suffix when a shared writer already emitted the prefix.
   Broader body render, placement state, merge output, and duplicate declaration
   materialization remain open.
7. [ ] Finish `Reference` public value materialization, rules-like surfaces,
   merged assign normalization, key conversion, and remaining cold copy/inherit
   ownership.

   Current partial status: non-buffer `Reference.render(...)` now prepares the
   context-owned render print state once and passes it to resolved child
   renders, fixing detached scalar child writes without adding public
   materialization. Buffer `Reference.render(...)` now strips explicit writers
   before resolved child renders and writes only the returned text to the
   requested render buffer. Array-valued reference syntax keys now stream each
   owned key segment to the writer instead of concatenating a temporary key
   string before one write.
8. [ ] Finish `Mixin` guard/default/body copy interactions and callable
   candidate output.

   Current partial status: callable finalization now reuses an already-attached
   single-output mixin slot when it matches the same source rules, output rules,
   and ambient lookup policy instead of rebuilding child segments, maps, and
   placement arrays. Interpolated mixin registration now evaluates the dynamic
   name before deriving the replacement mixin, so the prepared wrapper owns the
   final `Any` name directly instead of copying the interpolated name subtree
   and replacing it afterward. Callable candidate state no longer assigns the
   owned output rules to the source mixin body's parent just before adopting
   those same rules into the actual candidate parent; focused tests prove the
   canonical mixin body remains parented to the source mixin while the owned
   output rules land on the definition parent. Guard/default/body ownership
   remains open.
9. [ ] Finish `Interpolated` cold replacement capture, selector/generic
   materialization, and replacement arrays.

   Current partial status: whole-selector and embedded selector interpolation
   with owned scalar token replacements (`Any`/`Anonymous`/`Keyword`) now build
   selector text from the replacement value directly instead of calling public
   `toTrimmedString(...)`. Public `replace(...)` also reads owned scalar token
   text directly for those replacements. Generic `Any` materialization now
   writes evaluated replacements directly instead of calling public
   `Interpolated.toTrimmedString(...)` on itself. Embedded selector-list
   replacements now write generated `:is(...)` wrapper text directly instead of
   materializing a temporary generated `PseudoSelector` only to serialize it.
   Public `replace(...)` now
   writes non-scalar replacements through direct `writeSyntax(...)` on its cold
   string boundary instead of calling public replacement
   `toTrimmedString(...)`. Whole and embedded non-scalar selector assembly now
   use the same direct replacement writer instead of public replacement
   `toTrimmedString(...)`. Generic materialization now builds interpolated text
   through a private direct text builder instead of routing through
   `writeWithReplacements(...)` and its writer mark/readback capture. Eval and
   resolve replacement arrays are now allocated lazily only after a replacement
   changes. Compound selector interpolation now scans simple selector tokens
   directly instead of using regex `match(...)`, a token array, and a pre-sized
   selector array. Rendered scalar replacements now write owned token text
   directly instead of opening a trim mark around scalar `writeSyntax(...)`, and
   render buffer output reuses the outer render mark instead of taking a second
   inner mark just to return emitted text. Semantic selector ownership
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
11. [x] Finish `Node` base/source render fallback so inherited source render no
   longer routes hot render through public `toTrimmedString(...)`.

   Completion status: base `Node.writeSyntax(...)` no longer calls child
   public `toString(...)`; child values write syntax directly. Base
   `toTrimmedString(...)` also writes child values directly, using the
   source-trivia emitter instead of child public stringification when trivia is
   active. Base `renderSource(...)` now writes inherited no-trivia source syntax
   directly through `writeSyntax(...)` instead of routing through public
   `toTrimmedString(...)`. Custom `toTrimmedString(...)` overrides and active
   source-trivia emission remain documented compatibility/source-preservation
   boundaries.
12. [ ] Finish scalar wrapper leftovers in `Block`, `Paren`, `Url`, `Quoted`,
   `Negative`, and `AttributeSelector` where localized mark/readback remains
   outside documented cold/public boundaries.

   Current partial status: `Block` and `Url` no longer route trivia-backed
   child emission through public child `toString(...)`; they use direct
   source-trivia syntax emission. `RawRules` received the same child-emission
   cut even though it is tracked in the node tracker rather than this scalar
   wrapper row. `AttributeSelector` now writes common scalar non-bare forms
   (`Any`/simple `Quoted` values, including resolved variable values) without
   writer mark/readback, and raw `@{...}` attribute interpolation now uses one
   direct token parser instead of duplicate regex `match(...)` paths in eval and
   resolve. `Block` scalar `Any` flat-buffer render and
   `Negative` scalar dimension flat-buffer render now write known text without
   print-state setup, writer mark/readback, or a second writer-to-buffer copy.
   Non-scalar `Block` buffer render now writes syntax directly under the
   existing outer buffer mark instead of nesting the cold
   `renderBlockSyntax(...)` mark/readback helper.
   Resolved `Any` negative render now writes `-value` directly instead of
   entering child render/operation transport, while public resolve materializes
   the scalar `Any('-value')` node.
   `Url` scalar `Any` render now writes/buffers normalized `url(...)` text
   directly after value selection, without prepared writer setup,
   mark/getSince, replaceSince, or a second writer-to-buffer copy. Non-scalar
   URL buffer render now writes syntax directly under the existing outer buffer
   mark instead of nesting the cold `renderUrlSyntax(...)` mark/readback helper;
   simple non-escaped quoted URL values now take the direct flat-buffer text
   path as well. Non-buffer quoted rendering and non-scalar URL normalization
   still keep their localized boundaries.
   `Paren` dynamic wrapped render now keeps child
   intermediate render text out of explicit writers and writes only the final
   wrapped string to the requested writer or buffer. Resolved no-trivia `Any`
   paren values now write known wrapper text directly instead of rendering the
   scalar child to intermediate text. Resolved synchronous non-scalar paren
   children now stream flat-buffer output as open delimiter, child output, and
   close delimiter instead of rendering the child to a standalone string and
   writing the wrapped result back. `Quoted` escaped literal render now
   writes final raw text to explicit writers and keeps buffer output out of
   those writers. `Quoted.compare()` now uses value semantics instead of
   public `toString()` transport. `AttributeSelector.valueOf()` now uses node
   value semantics for node-valued names instead of public
   `toTrimmedString()` transport. A no-op audit kept Paren escaped
   semicolon-list render on the existing `renderListValueSyntax(...)` string
   boundary because the render path already avoids replacement-list
   materialization; cutting the remaining mark/readback belongs to shared
   List string-return contracts. The same audit kept Quoted non-scalar/
   interpolated value wrapping on the cold `renderQuotedSyntax(...)` boundary.
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

   Current partial status: `List.operate(...)` and `Sequence.operate(...)` no
   longer derive a copied left container and then mutate its value array with
   `push(...)`. Addition now allocates the final output array length up front
   and copies left/right operands into their final slots while keeping the
   existing `copyWithReusableLeaves(...)` ownership boundary. The shared flat
   render-buffer suffix helper now reads the active buffer parts from the mark
   directly instead of calling writer `getSince(...)` a second time, preserving
   the existing one-read List/Sequence shared-buffer contract. Remaining work:
   decide whether the copied leaves/output ownership boundary itself can be
   narrowed further without violating canonical-parent tests.
15. [ ] Finish `Operation` arithmetic materialization and preserve-mode calc
   fallback/materialization ownership without adopting unchanged canonical
   operands.

   Current partial status: sync render/resolve operand evaluation now uses
   `evalImmediateSync(...)` for non-`F_MAY_ASYNC` operands instead of public
   `eval(...)` plus thenable checks. Preserved-operation flat-buffer render no
   longer leaks intermediate operand text into a caller-supplied explicit
   writer. `withOperands(...)` now owns unchanged source operands with
   `copyOwnedWithReusableLeaves(...)` instead of reusing source-free scalar
   leaves as output operands. Preserve-mode `calc(...)` fallback now always
   builds an owned operation wrapper through `withOperands(...)` before marking
   fallback operands evaluated, so unchanged source operands stay parented to
   the canonical source operation. Broader arithmetic/list materialization
   remains open.

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

Current pass: Direct node fields, static `childKeys`, parser/plugin direct
field reads, and real `defineFunction` callables.

- New traversal: no new runtime tree walks. The pass adds static `childKeys`
  metadata to node classes so existing traversal/clone machinery can use known
  child fields instead of falling back to payload rediscovery. `List` and
  `Sequence` now declare `['value']` as their static child contract; the current
  `Node` base still iterates raw array-valued nodes directly, so this is a
  contract migration and not a new walker. `Call`, `Mixin`, `JsImport`,
  `StyleImport`, and `AtRule` now declare their constructor-owned child
  contracts directly.
  Selector containers now declare structural child contracts directly:
  `SelectorList`, `CompoundSelector`, and `ComplexSelector` use `['value']`,
  `AttributeSelector` uses `['name', 'attributeValue']`, `SelectorCapture`
  uses `['selector']`, `InterpolatedSelector` uses `['value']`, and scalar
  selector leaves such as `BasicSelector`, `Combinator`, and `Ampersand` use
  `null`.
  `Comment`, `Dimension`, `Num`, `Negative`, `ExtendList`, `StyleImport`,
  `If`, `For`, `While`, and `SelectorCapture` now preserve parser-supplied
  tree context at construction, and the existing cold `Comment` placement-copy
  paths carry the source node tree context instead of dropping it.
  `While` declares `['condition', 'rules']`; `If` declares `['branches']`, and
  `For` declares `['pattern', 'iterable', 'rules']`, so cold serializers and
  structural proof tooling read their constructor-owned direct fields instead
  of reopening legacy payload records. The
  control loops flagged in this diff are the existing branch/binding adoption
  and render-selection loops with reads moved from `this.value.*` to direct
  fields; no extra branch, declaration, or tree walk was added. The new
  `serializeTypes(...)` childKeys loop is cold test/proof serialization only:
  it walks the static key list for one node being printed so snapshots show
  current direct fields instead of stale constructor payloads.
- New node/materialization: `eachImplementation` still creates the existing
  public `For` node plus tuple `VarDeclaration`/`Any`/`Nil` parameter nodes for
  the Less `each()` result. `conversions.ts` and `number.ts` still return public
  `Num` nodes for conversion/operator API boundaries; this pass changed those
  reads from `.value.number` to `.number`. `Interpolated` and `Reference` still
  materialize public `Any` fallback/generic nodes, but now carry `role` through
  direct fields and constructor options instead of mutating option payloads.
  `Interpolated.replacements` is a direct reference to the constructor-provided
  array, not a newly materialized array. `Operation` calc fallback now creates
  an owned fallback operation for the materialized public `calc(...)` boundary
  instead of embedding the source operation and creating a parent cycle; only
  that fallback operation is marked evaluated, while its copied operands remain
  unstamped syntax children. Parser-only argument disambiguation now mutates
  the parse-owned canonical `List.value` slots after the mixin definition/call
  branch is known; it no longer allocates a replacement `List` merely to swap
  ambiguous `Any` placeholders. Extend bubbling and SCSS `@at-root` lowering
  create replacement nodes only where direct payload mutation would stale
  readonly fields. Interpolated mixin name registration now returns a
  replacement `Mixin` carrying the evaluated `name` field instead of mutating
  `node.value.name` after construction. `new ReferenceError(...)` sites in
  `call.ts` are unchanged exceptional failure boundaries; the diff only changes
  error text reads from `name.value.key` to `name.key`. Selector evaluated
  surfaces for `SelectorList`, `CompoundSelector`, and `ComplexSelector` now use
  concrete constructors instead of generic `Reflect.construct(...)`; this
  removes a generic construction hook without changing public materialization
  semantics. `If`, `For`, and `While` now read constructor-owned `branches`,
  `pattern`, `iterable`, `rules`, and `condition` fields. `AtRule` now uses
  direct `name`, `prelude`, and `rules` fields for eval/render/public-result
  state instead of mutating `node.value.*` after construction. AtRule public
  result derivation still constructs replacement AtRule nodes at public
  materialization boundaries; direct eval of a mutable at-rule writes the
  evaluated prelude field in place to preserve the existing same-node eval
  contract. `deriveAtRule(...)` builds a small source-parts object only when no
  explicit source record is supplied; it replaces the old `this.value` payload
  read and does not add a tree walk. `Ruleset` now uses direct `selector`,
  `rules`, `guard`, and `selectorBeforeExtend` fields with matching static
  `childKeys`; eval, registration prep, render/header composition, extend-root
  mutation, and serialize helpers now read or update those fields directly
  instead of mutating `node.value.selector`, `node.value.rules`, or
  `node.value.guard` after construction. `PseudoSelector` now uses direct
  `name`, `arg`, and `generatedPseudoPlacementOverride` fields with static
  `childKeys` for `['name', 'arg']`; eval, keyset calculation, rendering,
  selector matching, extend placement, and public clone/copy boundaries read
  those fields directly. Generated extend placement still mutates generated
  pseudo args, but that mutation writes the direct field and pairs adoption
  with cache invalidation instead of syncing a payload object.
  `AttributeSelector` now owns direct `name`, `op`, `attributeValue`, and `mod`
  fields; Less-compat reads those direct fields, and attribute eval now returns
  an owned replacement selector when name/value children evaluate instead of
  relying on generic base eval to mutate the old constructor payload object.
  That replacement selector uses the existing reusable-leaf copy boundary for
  unchanged or externally-owned node children so evaluated selector output does
  not reparent canonical declaration values or source selector children.
  `Log` now owns direct `level` and `message` fields with static `childKeys`.
  `JsImport` now preserves parser-provided tree context at its constructor
  boundary and parser tests read direct `path`/`imports` fields. Its
  `childKeys` intentionally stay `['path']`: named import specifiers are
  scalar ESM metadata, not node children.
  Focused CSS/Less parser selector tests now read `Ruleset.selector` directly
  instead of reopening `ruleset.value.selector`; their stale `Sequence` and
  `CompoundSelector` AST text expectations were updated to the current static
  `childKeys` shape.
  `Func` now preserves parser-provided tree context at its constructor
  boundary, and focused SCSS parser assertions read existing direct
  `Call`/`Ruleset`/`Reference`/`Mixin` fields instead of reopening constructor
  payload objects.
  `Condition` now preserves parser-provided tree context at its constructor
  boundary; Less, SCSS, and Jess parser productions already passed that context
  into `new Condition(...)`, so this carries existing parser metadata instead
  of rediscovering it later.
  `Operation` now preserves parser-provided tree context at its constructor
  boundary, and its owned `withOperands(...)` materialization path carries that
  context onto preserved/calc-fallback operation surfaces.
  `Call` and `Expression` now preserve parser-provided tree context at their
  constructor boundaries. Runtime-created `Call` outputs for calc fallback and
  finalized dynamic calls carry the source call/operation context through their
  existing owned output constructors.
  `Reference` now preserves parser-provided tree context at its constructor
  boundary, derived call/declaration reference wrappers carry the source
  context when they synthesize a replacement reference, and focused Less parser
  interpolation assertions read direct `Reference.key` instead of reopening the
  constructor payload object.
  `Interpolated` now preserves parser-provided tree context at its constructor
  boundary, reads direct `source` and `replacements` fields in its own runtime
  paths, carries context through evaluated replacement surfaces, and
  `VarDeclaration` interpolated-name normalization now rebuilds from direct
  fields instead of reopening the constructor payload object.
  `Mixin` and `Extend` now preserve parser-provided tree context at their
  constructor boundaries. Mixin-derived registration wrappers and callable
  output copies carry the source mixin context while continuing to read direct
  `name`/`params`/`rules`/`guard` fields. Focused Jess parser mixin assertions
  now read direct `Mixin.name` and `Mixin.guard` fields.
  Parser-created scalar wrapper nodes `Paren`, `Block`, `Quoted`, and `Rest`
  now preserve parser-provided tree context at their constructor boundaries;
  `Paren`/`Block`/`Quoted` derived `withValue(...)` replacement paths carry the
  source context rather than dropping it on evaluated/public wrapper surfaces.
  Parser-created scalar selector leaves (`BasicSelector`, `Combinator`, and
  `Ampersand`) now preserve the parser-provided tree context in their existing
  constructor boundary while staying leaf nodes with `childKeys = null`.
  `Ampersand.appendValue` is now a constructor-owned direct field; append,
  derive, and bare-ampersand checks read it directly instead of opening the
  legacy payload object.
  `BasicSelector.evalNode(...)` still returns the source node, but routes
  through the shared selector eval hook first so standalone eval attaches the
  existing selector-bit library instead of leaving keyset reads to rediscover
  context.
  Callable helper reads now use direct `Mixin`/`Ruleset` fields where the entry
  is a real node, while synthetic `callable-rules` records still own their
  small `value` object. Focused callable helper tests now use that accessor
  surface and direct `Mixin` fields instead of restating payload reads in test
  adapters. `If` branch rendering now sends the selected `Rules`
  directly to the
  caller's render buffer instead of rendering through a detached print-state
  string and writing that text back. Import queue matching, top-import
  evaluation, hoisted at-rule bubbling, Less-compat `AtRule`/`Ruleset`
  adapters, SCSS `@at-root` lowering, control-node callable resolution, and
  `Reference` mixin/ruleset materialization now read already-migrated
  `AtRule`/`Ruleset`/`Mixin` fields directly instead of reaching back through
  constructor payloads. The only remaining production scan hits for
  `.value.rules`/`.value.guard` in the migrated field set are the intentional
  synthetic `callable-rules` records in `callable-entry.ts`.
- Render path: no render path now resolves into arrays/nodes just to stringify.
  `Any`, `Dimension`, `Quoted`, `Color`, `Range`, `Reference`, `Interpolated`,
  scalar leaves, simple wrappers, `Extend`, `ExtendList`, `Func`, `Log`, and
  `Call`, `Mixin`, `JsImport`, `StyleImport`, and `List`/`Sequence` option
  reads now expose direct fields for hot reads. Reference key/target hot reads
  stay on direct fields; the remaining payload read in Reference syntax is the
  scalar `rawKey` compatibility slot. The wrapper context pass added no render
  node materialization or stringify transport; it only carries existing parser
  metadata through construction and existing owned replacement constructors.
  The `Call`/`Expression` context pass likewise only stores already-supplied
  parser metadata and carries it through existing output constructors; it does
  not change call/evaluation rendering strategy. The `Interpolated` direct-read
  pass removes local payload reopening and preserves existing replacement
  evaluation/render strategy. The `Mixin`/`Extend` context pass likewise only
  stores existing parser metadata and carries it through existing Mixin output
  constructors.
  `Color.childKeys` is `['node']`, not the old `null`, because the current tree
  can preserve a call node as color syntax. Empty selector-list/compound/complex
  public string capture now returns `''` without writer readback; non-empty
  public string capture remains the cold `mark()/getSince()` boundary. `$if`
  selected-branch rendering keeps direct render-buffer identity; the remaining
  newline trim is a local compatibility normalization on the selected rules'
  returned string and final string segment. The three `slice(0, -1)` matches are
  that newline normalization only; they do not allocate syntax arrays or
  materialize nodes for render.
- Helper/API surface: named implementation exports were added for cross-function
  composition and direct lazy tests: `rgbImplementation`, `hslImplementation`,
  `eachImplementation`, `isdefinedImplementation`, and
  `isrulesetImplementation`. They replace test/runtime dependence on wrapper
  `_internal` spelunking for fns composition while preserving `callWithContext`
  support for `defineFunction` wrappers. `serializeNodeChildFields(...)` is a
  cold test utility helper that keeps `serializeTypes(...)` aligned with the
  static `childKeys` contract; it is not imported by eval/render code.
  `assignPseudoArg(...)` is a local extend helper only; it keeps generated
  pseudo argument adoption and cache invalidation in one mutation boundary and
  is not a public setter API.
- Metadata mutations: removed the `new Proxy`/generic reflective getter fallback
  from `defineFunction`; metadata is attached directly with
  `Object.defineProperties`. Test-only `hasOwnProperty` checks prove the
  metadata is attached to the function object rather than served by proxy traps.
  Remaining `_internal` metadata is an explicit `callWithContext` bridge on real
  function objects. `Color` conversion and setter paths now write only direct
  channel fields (`_rgbChannels`, `_hslChannels`, `_alphaValue`) instead of
  mirroring those runtime updates back into the constructor payload object.
  Production parser/plugin node `.set()` calls were removed from CSS/Less/SCSS
  parser productions and Less-compat declaration/sequence adapters; remaining
  `.set()` search hits in those folders are Map/cache registrations.
  CSS parser production helpers no longer use reflective property gets to select
  parse-rule methods; the two remaining dynamic production lookups are plain
  indexed table reads against the parser instance and are not eval/render
  metadata probes.
  Control-node `adopt(...)` calls flagged by the verifier are constructor
  adoption of existing child nodes moved from `value.*` reads to direct fields;
  they preserve the existing parent contract rather than restoring metadata
  after the fact. AtRule `adopt(...)` calls flagged by the verifier are direct
  field writes replacing old post-construction `value.name`, `value.prelude`,
  and `value.rules` mutation; they preserve parent/source flags at the mutation
  point instead of syncing a parallel payload object. Ruleset `adopt(...)`
  calls flagged by the verifier are the same direct-field mutation boundary for
  evaluated selectors, evaluated bodies, guard clearing, and root-extend
  selector replacement. The local `assignLocalSelector(...)` helper in
  `extend-roots.ts` exists only to keep the required adopt/cache-invalidation
  pair together while replacing old `ruleset.value.selector = ...` writes; it
  does not add a tree walk or public API surface. `serializeTypes(...)` gained
  a cold proof-only `childKeys` path so AST snapshots report current direct
  child fields instead of stale constructor payload objects, reusing the
  existing cycle-detection `Set<Node>` from the serializer rather than adding
  runtime metadata. Reusable-leaf copy now has a `PseudoSelector` constructor
  path that reads direct `name`/`arg`/generated placement fields. This is a
  cold/public placement-copy boundary for extend and clone/copy surfaces; it
  avoids reintroducing payload synchronization after generated pseudo arg
  mutation. Scalar selector leaf constructor tree-context assignment preserves
  already-supplied parser metadata; it is not a late source-root walk or
  defensive metadata repair. `Comment`, numeric nodes, `Negative`,
  `ExtendList`, `StyleImport`, control nodes, and `SelectorCapture`
  constructor tree-context assignment is the same parser/adoption edge.
  Existing generic `Reflect.construct(...)` remains
  in the shared
  copy helper for unmigrated node families and in Ampersand placement code;
  `PseudoSelector.clone(...)` no longer uses it. Callable output copying now
  has cold direct-field constructor paths for `Mixin`, `Ruleset`, and `AtRule`
  so copied callable output surfaces do not reconstruct those node families
  from stale constructor payload.
  Rejected/staged direct fields: `Declaration` still mutates payload fields
  after construction, so readonly aliases there would go stale until its
  mutation paths move to direct fields or replacement nodes.
  A current-state audit found the remaining mutation sites in `Rules`
  `setDefined` assignment and merge coalescing, so declaration `name` /
  `declarationValue` / `important` fields remain staged until those writes are
  replaced at the owning declaration/rules boundary.
  `AttributeSelector.attributeValue` is the direct field for the right-hand
  side because `value` still names the inherited constructor payload. The
  broader `Declaration`/`VarDeclaration` value field remains staged because
  `Declaration.value` has the same collision and declaration mutation paths
  still need a coherent replacement-node or direct-field design before readonly
  aliases are safe.
- Evidence: builds passed for `@jesscss/core`, `@jesscss/fns`,
  `@jesscss/plugin-less-compat`, `@jesscss/plugin-js`, `@jesscss/less-parser`,
  and `@jesscss/scss-parser`; affected builds were rerun after the parser and
  Less-compat `.set()` cleanup. Focused node-family tests passed for Bool,
  Comment, DefaultGuard, Dimension, Negative, Range, Quoted, Interpolated,
  Rest, Expression, Url, Block, List, Operation, and `define-function.test.ts`.
  Focused parser/plugin tests passed for Less parser mixins/guards/selectors,
  CSS parser Less-output fixtures, SCSS parser parse-only/AST serialization,
  and Less-compat visitor/adapter tests. `sequence.test.ts` remains non-green in
  this dirty tree, and CSS parser `ast-serialize.test.ts` hung when run together
  with `less-output.test.ts`; neither is counted as proof for this pass. Known
  dirty-tree failures also remain in render-buffer/readback tests such as
  `color.test.ts` preserved-node color syntax, `paren.test.ts`, broader
  `call.test.ts`/`declaration.test.ts`, and stale `node-mutation.test.ts`
  `evalSync` expectations.
  Latest Color direct-field proof: `Color` channel conversion/setter paths no
  longer write `value.rgb`, `value.hsl`, or `value.alpha`, color operation reads
  `Dimension.number`/`Dimension.unit` directly, and call-backed color tests read
  preserved call syntax through `Color.node` plus `Call.name`. Focused proof
  passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/color.test.ts --testNamePattern "RGB/HSL
  Conversion|RGBA/HSLA Getters|call-backed colors|Operations|invalid operation"`;
	  `@jesscss/core` build passed; and a targeted scan for Color payload channel
	  writes plus `node.value.name` and Dimension payload reads in the touched Color
	  files returned no matches.
	  Latest define-function/Color docs proof: lazy `Color` function tests now read
	  preserved call syntax through direct `Color.node`, the stale proxy wording in
	  `define-function.ts` was removed, and the Sass/Less-compat color analysis
	  docs now describe direct `Color.node` plus direct channel/format fields
	  instead of the old Color payload node shape. Focused proof passed with
	  `pnpm --filter @jesscss/core exec vitest run
	  src/__tests__/define-function.test.ts --testNamePattern "rest parameters and
	  lazy evaluation|lazy evaluation of object parameters"`; `@jesscss/core`
	  build passed; targeted stale-shape scans in the touched files and a
	  repo-wide reflective-getter scan returned no matches.
	  Latest AtRule/Call test direct-read proof: core import postlude tests now read
	  nested wrapper at-rule names through direct `AtRule.name`, and CSS parser
	  container tests now read parsed container function names through direct
	  `Call.name`. The CSS parser expectations were also updated to the current
	  explicit `childKeys` serializer shape for `List` and `QueryCondition`.
	  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
	  src/tree/__tests__/import-style.test.ts --testNamePattern "supports/layer
	  postludes wrap inline source in order"` and `pnpm --filter
	  @jesscss/css-parser exec vitest run test/container.test.ts
	  --testNamePattern "scroll-state"`; `@jesscss/core` and
	  `@jesscss/css-parser` builds passed; targeted scans for the old nested
	  payload-name reads and the repo-wide reflective-getter scan returned no
		  matches. Declaration remains intentionally staged: current owner paths still
		  mutate declaration payload values/important flags in `call.ts` and
		  `rules.ts`, so adding direct readonly declaration fields before replacing
		  those mutation boundaries would create stale reads.
		  Latest CSS parser direct-read proof: CSS parser AST/trivia tests now read
		  parsed nested rules through direct `Ruleset.rules`, and function argument
		  tests now read parsed arguments through direct `Call.args`; Declaration
		  name/value reads in the same tests remain staged with the Declaration
		  mutation boundary. Focused proof passed with `pnpm --filter
		  @jesscss/css-parser exec vitest run test/ast-serialize.test.ts
		  --testNamePattern "function argument comments|same-line comments before
		  nested selectors|declaration value comments|declaration name comments"`
		  and `pnpm --filter @jesscss/css-parser exec vitest run
		  test/container.test.ts --testNamePattern "scroll-state with QueryCondition
			  argument"`; `@jesscss/css-parser` and `@jesscss/core` builds passed;
			  targeted old `Ruleset.rules`/`Call.args` payload-read scans and the
			  repo-wide reflective-getter scan returned no matches.
			  Latest AtRule prelude parser-test proof: CSS and Less parser container
			  query tests now read at-rule prelude nodes through direct
			  `AtRule.prelude`, and the parser AST investigation note no longer spells
			  the old AtRule payload prelude access as an example shape. Focused proof
			  passed with `pnpm --filter @jesscss/css-parser exec vitest run
			  test/container.test.ts --testNamePattern "simple query parses|scroll-state"`
				  and `pnpm --filter @jesscss/less-parser exec vitest run
				  test/container-media-roles.test.ts`; `@jesscss/css-parser` and
				  `@jesscss/less-parser` builds passed; targeted prelude payload-read scans
				  and the repo-wide reflective-getter scan returned no matches.
				  Latest settled-field consumer audit: a cross-package scan for migrated
				  node-family payload reads in parser, fns, language-service, Jess CLI,
				  plugin-js, and Less-compat surfaces found no remaining safe
				  `Call`/`AtRule`/`Ruleset`/`Mixin`/`Reference`/`Range`/`Operation`/
				  `Condition`/`Func`/`StyleImport`/`JsImport`/`Log`/selector-family
				  direct-field reads to migrate outside Declaration-shaped paths. The
				  remaining consumer hits are `Declaration`/`VarDeclaration` name/value
				  reads in fns map helpers, parser/fns tests, and Less-compat declaration
				  adapters, plus intentional old Less API mutation surfaces. Declaration
				  direct fields remain blocked on an explicit owner-boundary/API choice:
				  current core owners still mutate declaration payload value/important
				  fields, and the field name for the public value slot should be chosen
				  deliberately rather than invented mid-pass.
				  Latest constructor tree-context proof: `pnpm --filter @jesscss/core build`,
  `pnpm --filter @jesscss/fns build`, and parser builds for `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, and `@jesscss/jess-parser`
  passed. `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/dimension.test.ts src/tree/__tests__/negative.test.ts
  src/tree/__tests__/extend.test.ts src/tree/__tests__/control.test.ts
  src/tree/__tests__/import-style.test.ts --testNamePattern "preserves parser
  tree context"` passed 5 focused tests. Broader parser AST serializer runs
  still hit stale direct-field snapshot expectations such as `Quoted.value`,
  `List.value`, and `Rules.value`; they are not counted as proof for this
  constructor-context slice.
  Latest parsers/fns direct-read cleanup proof: fns `each()` tests, Less parser
  `each()` value tests, SCSS parser `@if` comparison baseline tests, and Jess
  parser nested-control AST serialization now read `For`, `If`, and `Ruleset`
  direct fields instead of stale control/ruleset payload shapes. Focused proof
  passed with `pnpm --filter @jesscss/fns exec vitest run
  src/__tests__/each.test.ts`, `pnpm --filter @jesscss/less-parser exec vitest
  run test/values.test.ts --testNamePattern "each\\(\\)|For control|callback
  params"`, `pnpm --filter @jesscss/scss-parser exec vitest run
  test/baseline.test.ts --testNamePattern "@if comparisons"`, and `pnpm
  --filter @jesscss/jess-parser exec vitest run test/ast-serialize.test.ts
  --testNamePattern "nested control blocks"`. Builds passed for
  `@jesscss/fns`, `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/jess-parser`; a targeted scan for
  `.value.(iterable|rules|branches|pattern|condition)` in those fns/parser
  test paths returned no matches.
  Latest fns Dimension direct-read proof: Less `convert`, `rgb`, `hsl`, `min`,
  `max`, shared math helpers, and Sass `unitless` now read `Dimension.number`
  and `Dimension.unit` directly instead of reopening `Dimension.value`. Focused
  Less function tests passed with `pnpm --filter @jesscss/fns exec vitest run
  src/less/__tests__/convert.test.ts src/less/__tests__/min.test.ts
  src/less/__tests__/max.test.ts src/less/__tests__/rgb-rgba-branches.test.ts
  src/less/__tests__/rgb-relative-errors.test.ts
  src/less/__tests__/hsl-branches.test.ts
  src/less/__tests__/hsl-relative-errors.test.ts src/less/__tests__/unit.test.ts
  src/less/__tests__/get-unit.test.ts src/less/__tests__/reexports-smoke.test.ts`;
  Sass math proof passed with `pnpm --filter @jesscss/fns exec vitest run
  src/__tests__/sass-math-functions.test.ts
  src/sass/__tests__/math-functions.test.ts`; `@jesscss/fns` build passed; and
  a targeted scan for fns `Dimension.value.number` / `Dimension.value.unit`
  payload reads returned no matches.
  Latest core test direct-read cleanup proof: control/mixin/rules tests now
  read `If.branches`, `For.rules`, `While.rules`, `Mixin.rules`, and
  `Ruleset.rules` directly instead of stale payload shapes. Focused proof
  passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/control.test.ts --testNamePattern "forces public
  rulesVisibility"`, `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/mixin.test.ts --testNamePattern "scope|guard|default"`,
	  and `pnpm --filter @jesscss/core exec vitest run src/tree/__tests__/rules.test.ts
	  --testNamePattern "scope|variable|mixin|nested|ruleset"`. A targeted core-test
	  scan for `.value.(branches|rules|pattern|iterable|condition)` returned no
	  matches.
	  Latest `Call`/`PseudoSelector` core test direct-read cleanup proof: async CSS
	  call parent assertions now use `Call.args`, calc fallback assertions use
	  `Call.args`, and resolved selector-list pseudo assertions use
	  `PseudoSelector.arg` instead of stale constructor payload reads. Focused proof
	  passed with `pnpm --filter @jesscss/core exec vitest run
	  src/tree/__tests__/call.test.ts --testNamePattern "async CSS call arguments"`,
	  `pnpm --filter @jesscss/core exec vitest run src/tree/__tests__/operation.test.ts
	  --testNamePattern "calc fallback"`, and `pnpm --filter @jesscss/core exec
	  vitest run src/tree/__tests__/selector-list.test.ts --testNamePattern
	  "owns single resolved selector-list output"`; `@jesscss/core` build passed;
	  and a targeted core-test scan for `.value.arg` / `.value.args` returned no
	  matches.
	  Latest Ruleset selector/rules core-test direct-read cleanup proof: focused
	  ampersand, comment-trivia, and sourcemap tests now read `Ruleset.selector`
	  and `Ruleset.rules` directly instead of reopening constructor payloads.
	  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
	  src/tree/__tests__/ampersand.test.ts --testNamePattern "derives appended
	  framed|complex selector parent frames"`, `pnpm --filter @jesscss/core exec
	  vitest run src/tree/__tests__/comment.test.ts --testNamePattern "preserves
	  printable block trivia"`, and `pnpm --filter @jesscss/core exec vitest run
	  src/tree/util/__tests__/sourcemap.test.ts --testNamePattern "maps nested
	  rules content lines"`; `@jesscss/core` build passed; and a targeted scan
	  across those touched tests for `.value.selector` / `.value.rules` returned
	  no matches. The later Ruleset selector test-adapter proof removes the old
	  `fast-reject` `.value.selector` writes by constructing the patched
	  selector container up front.
	  Latest import-path parser cleanup proof: Jess and SCSS parser baseline/feature
	  tests now read `StyleImport.path` and `JsImport.path` directly instead of
	  `value.path`. Focused proof passed with `pnpm --filter @jesscss/jess-parser
  exec vitest run test/baseline.test.ts test/features.test.ts --testNamePattern
  "compose|export|imports|@-compose|@-export"` and `pnpm --filter
  @jesscss/scss-parser exec vitest run test/baseline.test.ts --testNamePattern
  "Sass imports|@import|sass:map|@use"`. Builds passed for
  `@jesscss/jess-parser` and `@jesscss/scss-parser`, and a parser-test scan for
  `.value.path` returned no matches.
  Additional focused proof for the latest object-node slice: core `Mixin` and
  `StyleImport` suites passed, a narrow `Call` direct-field smoke pattern
  passed, Less parser functions/mixins/values passed, fns `each`/lazy
  isdefined/isruleset passed, and Less-compat visitor/to-less/adapter tests
  passed. Latest selector-container proof: `pnpm --filter @jesscss/core build`
  passed; `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-list.test.ts
  src/tree/__tests__/selector-attr.test.ts
  src/tree/__tests__/selector-compound.test.ts
  src/tree/__tests__/selector-complex.test.ts
  src/tree/__tests__/selector-pseudo.test.ts
  src/tree/__tests__/selector-capture.test.ts
  src/tree/__tests__/selector-interpolated.test.ts` passed 80 tests; `pnpm
  --filter @jesscss/core exec vitest run
  src/tree/util/__tests__/extend-ampersand.test.ts
  src/tree/__tests__/extend.test.ts
  src/tree/__tests__/extend-eval-integration.test.ts` passed 46 tests; Less
  parser selector/nested-pseudo tests passed 52 tests; SCSS parser filtered
  selector/extend/placeholder parse and AST tests passed 48 tests with 65
  skipped; CSS parser filtered selector fixtures passed 12 tests with 25
  skipped. CSS parser `ast-serialize.test.ts` with a selector-oriented
  `--testNamePattern` still hung and was killed; it is not counted as proof.
  Latest control-node proof: `pnpm --filter @jesscss/core build` passed; `pnpm
  --filter @jesscss/core exec vitest run src/tree/__tests__/control.test.ts
  src/tree/util/__tests__/callable-binding.test.ts` passed 64 tests; SCSS parser
  filtered control/import parse and AST tests passed 53 tests with 60 skipped.
  The full `call.test.ts` suite is still non-green in this dirty tree, so it is
  not counted as proof. Latest AtRule proof: `pnpm --filter @jesscss/core build`
  passed; `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/at-rule.test.ts src/tree/__tests__/import-style.test.ts
  --testNamePattern "at-rule|media|supports|container|keyframes|page|prelude|body|directive-bearing"`
  passed 70 focused AtRule tests with 4 skipped and selected import-style
  directive-bearing/media checks. Latest Ruleset proof: `pnpm --filter
  @jesscss/core build` passed; `pnpm --filter @jesscss/core exec vitest run
  src/tree/util/__tests__/serialize-types.test.ts` passed 3 tests; `pnpm
  --filter @jesscss/core exec vitest run src/tree/__tests__/ruleset.test.ts
  src/tree/__tests__/at-rule.test.ts
  src/tree/__tests__/extend-import-style.test.ts
  src/tree/__tests__/extend-eval-integration.test.ts
  src/tree/__tests__/import-style.test.ts --testNamePattern
  "ruleset|nested|guard|media|extend|reference|import|compose|selector|visibility"`
  passed 189 tests with 51 skipped after updating the extend AST snapshots to
  serialize direct `childKeys` fields. Latest PseudoSelector/direct-copy proof:
  `pnpm --filter @jesscss/core build` passed; `pnpm --filter @jesscss/core exec
  vitest run src/tree/__tests__/extend-eval-integration.test.ts
  --testNamePattern "exact extend matches a single OR-branch"` passed after
  fixing reusable-leaf copies to read direct pseudo args; `pnpm --filter
  @jesscss/core exec vitest run src/tree/__tests__/selector-pseudo.test.ts
  src/tree/__tests__/selector-list.test.ts src/tree/__tests__/ampersand.test.ts
  src/tree/__tests__/ruleset.test.ts src/tree/__tests__/extend.test.ts
  src/tree/__tests__/extend-eval-integration.test.ts
  src/tree/util/__tests__/selector-match-unit.test.ts --testNamePattern
  "pseudo|:is|selector|extend|ampersand|ruleset|generated|arg"` passed 176
  tests with 17 skipped.
  Latest callable direct-field proof: `pnpm --filter @jesscss/core build`
  passed; `pnpm --filter @jesscss/css-parser build` passed after the core
  rebuild; `pnpm --filter @jesscss/core exec vitest run
  src/tree/util/__tests__/callable-candidate-state.test.ts
  src/tree/util/__tests__/callable-special-case.test.ts
  src/tree/util/__tests__/callable-candidate-loop.test.ts
  src/tree/util/__tests__/callable-candidate-execution.test.ts
  src/tree/util/__tests__/callable-candidate-match.test.ts
  src/tree/util/__tests__/callable-collection.test.ts` passed 19 tests. After
  direct `Ruleset.selector`/`Ruleset.rules`/`Mixin.rules`/`AtRule.name`/`AtRule.rules`
  lookup reads were fixed, the narrow `.person.sayGender` mixin fixture passed
  with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/mixin.test.ts --testNamePattern "does not emit an empty
  interpolated selector frame when a nested mixin consumes its scope"`. The
  broader focused callable/mixin/rules run passed with `pnpm --filter
  @jesscss/core exec vitest run
  src/tree/util/__tests__/callable-candidate-state.test.ts
  src/tree/util/__tests__/callable-special-case.test.ts
  src/tree/util/__tests__/callable-candidate-loop.test.ts
  src/tree/util/__tests__/callable-candidate-execution.test.ts
  src/tree/util/__tests__/callable-candidate-match.test.ts
  src/tree/util/__tests__/callable-collection.test.ts
  src/tree/__tests__/mixin.test.ts src/tree/__tests__/rules.test.ts
  --testNamePattern "callable|mixin|namespace|lookup|ruleset|params|default|interpolated selector frame"`
  at 207 tests passed with 48 skipped. A filtered strong-type scan, `pnpm
  --filter @jesscss/core exec tsc -p tsconfig.build.json --noEmit --pretty false
  2>&1 | rg "callable-|cloning.ts|selector-pseudo.ts|rules.ts|ruleset.ts|mixin.ts|static-rules.ts"`,
  produced no matching errors; the full raw `tsc --noEmit` remains noisy with
  unrelated dirty-tree type debt and is not counted as a clean repo-wide gate.
  Latest migrated-field cleanup proof: `pnpm --filter @jesscss/core build`,
  `pnpm --filter @jesscss/css-parser build`, `pnpm --filter
  @jesscss/scss-parser build`, and `pnpm --filter
  @jesscss/plugin-less-compat build` passed. Focused core proof passed with
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/at-rule.test.ts src/tree/__tests__/import-style.test.ts
  src/tree/__tests__/control.test.ts src/tree/__tests__/reference.test.ts
  --testNamePattern
  "at-rule|import|top import|charset|control|for|while|each|ruleset|mixin|reference|materialize"`
  at 366 tests passed with 32 skipped. SCSS parser parse-only proof passed with
  `pnpm --filter @jesscss/scss-parser exec vitest run test/parse-only.test.ts
  --testNamePattern "at-root|use|import|ruleset|at-rule|media|supports|layer"`
  at 21 tests passed with 52 skipped. Less-compat proof passed with `pnpm
  --filter @jesscss/plugin-less-compat exec vitest run
  test/unit/transform/to-less.test.ts test/unit/transform/adapter.test.ts
  test/integration/less-visitor.test.ts
  test/integration/directive-compatibility.test.ts --testNamePattern
  "at-rule|ruleset|visitor|to-less|adapter|transform|directive"` at 12 tests
  passed with 20 skipped. CSS parser proof passed with `pnpm --filter
  @jesscss/css-parser exec vitest run test/ast-serialize.test.ts
  test/css-files.test.ts test/less-output.test.ts --testNamePattern
  "at-rule prelude comments|at-rule name uses AtKeyword|important.css|tests-unit/container/container.css"`
  at 4 tests passed with 57 skipped. Broad SCSS/CSS AST serializer runs still
  hit stale static-child snapshot expectations and are not counted as proof.
  Latest AttributeSelector direct-field proof: `pnpm --filter @jesscss/core
  build`, `pnpm --filter @jesscss/css-parser build`, `pnpm --filter
  @jesscss/less-parser build`, and `pnpm --filter @jesscss/plugin-less-compat
  build` passed. `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-attr.test.ts` passed 9 tests. `pnpm --filter
  @jesscss/css-parser exec vitest run test/css-files.test.ts
  --testNamePattern "selector|colon-selector|pseudo-selectors"` passed 3
  focused fixture tests with 28 skipped. `pnpm --filter @jesscss/less-parser
  exec vitest run test/selectors.test.ts --testNamePattern "should parse
  attribute selector"` passed 1 focused test with 45 skipped. `pnpm --filter
  @jesscss/plugin-less-compat exec vitest run test/unit/transform/to-less.test.ts
  test/unit/transform/adapter.test.ts --testNamePattern
  "attribute|selector|adapter|to-less"` passed 7 tests with 9 skipped. A
  broader Less selector run now passes after updating the host pseudo
  `CompoundSelector.value` snapshot for the static-child serializer shape.
  Latest scalar selector/log proof: `pnpm --filter @jesscss/core build &&
  pnpm --filter @jesscss/css-parser build && pnpm --filter
  @jesscss/less-parser build && pnpm --filter @jesscss/scss-parser build`
  passed. `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-basic.test.ts
  src/tree/__tests__/combinator.test.ts src/tree/__tests__/ampersand.test.ts
  --testNamePattern
  "BasicSelector|Combinator|Ampersand|selector|combinator|ampersand"` passed
  38 tests. CSS parser selector fixtures passed with 3 focused tests and 28
  skipped; Less parser `test/selectors.test.ts --testNamePattern
  "selector|attribute|ampersand|combinator"` passed 39 focused tests with 7
  skipped; SCSS parser diagnostic parse-only proof passed 5 focused tests with
  68 skipped.
  Latest Ampersand direct-field proof: `pnpm --filter @jesscss/core build`,
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/ampersand.test.ts src/tree/__tests__/ruleset.test.ts
  --testNamePattern "Ampersand|ampersand|bare|nest|selector"` passed 41
  focused tests with 22 skipped. `pnpm --filter @jesscss/css-parser build`,
  `pnpm --filter @jesscss/less-parser build`, and `pnpm --filter
  @jesscss/scss-parser build` passed. `pnpm --filter @jesscss/less-parser exec
  vitest run test/selectors.test.ts --testNamePattern "ampersand|selector"`
  passed 38 focused tests with 8 skipped.
  Latest callable direct-field test-contract proof: `pnpm --filter
  @jesscss/core exec vitest run
  src/tree/util/__tests__/callable-candidate-loop.test.ts
  src/tree/util/__tests__/callable-candidate-state.test.ts
  src/tree/util/__tests__/callable-candidate-match.test.ts
  src/tree/util/__tests__/callable-candidate-execution.test.ts
  src/tree/util/__tests__/callable-special-case.test.ts
  src/tree/util/__tests__/callable-collection.test.ts
  src/tree/__tests__/mixin.test.ts --testNamePattern
  "callable|candidate|collection|namespace fast path"` passed 64 focused tests
  with 123 skipped. `pnpm --filter @jesscss/fns exec vitest run
  src/__tests__/each.test.ts` passed 6 tests. Latest JsImport direct-field
  proof: `pnpm --filter @jesscss/core build`, `pnpm --filter
  @jesscss/jess-parser build`, and `pnpm --filter @jesscss/jess-parser exec
  vitest run test/baseline.test.ts test/features.test.ts
  test/ast-serialize.test.ts --testNamePattern "@-from|JsImport|from"`
  passed 9 focused tests with 100 skipped. Targeted scans for
  stale `JsImport` payload reads and the forbidden reflective getter returned
  no hits. Latest Func/SCSS direct-field proof: `pnpm --filter @jesscss/core
  build`, `pnpm --filter @jesscss/scss-parser build`, `pnpm --filter
  @jesscss/core exec vitest run src/tree/__tests__/func.test.ts
  --testNamePattern "serializes function definitions|resolves function
  definitions"` passed 2 focused tests with 2 skipped, `pnpm --filter
  @jesscss/core exec vitest run src/tree/__tests__/node-render-buffer.test.ts
  --testNamePattern "next node surfaces"` passed 1 focused test with 21
  skipped, and `pnpm --filter @jesscss/scss-parser exec vitest run
  test/baseline.test.ts test/parse-only.test.ts --testNamePattern
  "@content|@function|plain function call|nested legacy Sass @import|interpolation
  inside @include mixin names|interpolation inside @mixin names"` passed 11
  focused tests with 129 skipped. The full `func.test.ts` eval cases still fail
  in this dirty tree with function lookup errors (`'add' is not defined`,
  `'answer' is not defined`), so they are not counted as proof for this
  constructor/direct-read slice. Targeted scans for `Func` payload reads, SCSS
  migrated-field payload reads, and the forbidden reflective getter returned no
  hits. Latest Condition constructor-context proof: `pnpm --filter
  @jesscss/core build`, `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/condition.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "Condition|condition"` passed 26 focused tests with 22 skipped, parser builds
  passed for Less, SCSS, and Jess, `pnpm --filter @jesscss/less-parser exec
  vitest run test/functions.test.ts --testNamePattern
  "if\\(\\)|comparison condition|guarded mixin comma state"` passed 5 focused
  tests with 17 skipped, `pnpm --filter @jesscss/scss-parser exec vitest run
  test/baseline.test.ts test/parse-only.test.ts --testNamePattern
  "@if|comparison|condition"` passed 6 focused tests with 134 skipped, and
  `pnpm --filter @jesscss/jess-parser exec vitest run test/baseline.test.ts
  test/features.test.ts test/ast-serialize.test.ts --testNamePattern
  "condition|if|comparison"` passed 6 focused tests with 103 skipped. The broad
  Less guard run is not counted: it still has dirty-tree default-guard semantic
  failures and one stale direct-field serializer expectation outside this
  constructor metadata slice. Targeted scans for condition payload reads and
  the forbidden reflective getter returned no actionable hits; the only
  condition-looking test hit is `Paren.value` wrapping a `Condition`. Latest
  Operation constructor-context proof: `pnpm --filter @jesscss/core build`,
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/operation.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "Operation|operation|calc|arithmetic"` passed 15 focused tests with 22
  skipped, parser builds passed for CSS, Less, and SCSS, `pnpm --filter
  @jesscss/less-parser exec vitest run test/ast-serialize.test.ts
  --testNamePattern "^operation$"` passed 1 focused test with 80 skipped,
  `pnpm --filter @jesscss/less-parser exec vitest run test/functions.test.ts
  test/math-value.test.ts test/values.test.ts --testNamePattern
  "calc\\(\\)|mathValue|slash values|division-like"` passed 9 focused tests
  with 31 skipped, and `pnpm --filter @jesscss/scss-parser exec vitest run
  test/ast-serialize.test.ts test/parse-only.test.ts --testNamePattern
  "arithmetic|slash|operation|calc"` passed 6 focused tests with 107 skipped.
  The broader CSS serializer pattern is not counted because it currently hits
  unrelated stale Url/List direct-field fixture expectations. Targeted scans
  for `Operation` payload reads and the forbidden reflective getter returned no
  hits.
  Latest Declaration mutation-boundary proof: `Call.makeImportant(...)` no
  longer mutates declaration important state on declarations returned from mixin/JS
  call output. It now derives a replacement `Declaration`, adopts that
  replacement into the owning `Rules`, and swaps the owned array slot at the
  mutation boundary. `Declaration.deriveWithParts(...)` is a narrow temporary
  replacement helper for the remaining payload-backed Declaration family; it
  copies unchanged name/value/important leaves through the existing
  `withParts(...)` derivation boundary and preserves registration prep state.
  This is not the final Declaration direct-field API and does not claim the
  family migrated. The remaining production payload writes are still staged in
  `Rules.setDefined(...)` and coalesced declaration merge code because those
  sites are tied to scope-frame source nodes and declaration occurrence maps.
  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/call.test.ts --testNamePattern "marks declarations important"`.
  The staged mutation scan now leaves only selector attribute scalar checks and
  the known `rules.ts` Declaration payload writes; the forbidden
  reflective-getter scan returned no hits.
  Latest Declaration name-field proof: `Declaration` now owns a direct
  constructor-written `name` field, inherited by `VarDeclaration`. Core
  registration, scope-frame deferred-name checks, VarDeclaration parameter
  printing, `Rules.toObject(...)`, merge-chain name grouping, and readonly
  import collision checks now read `Declaration.name`/`VarDeclaration.name`
  instead of reopening `node.value.name`. This is the Less-compatible part of
  the Declaration surface. The RHS remains deliberately payload-backed for now
  because `Rules.setDefined(...)` and merge coalescing still mutate that part;
  choosing a direct RHS field name also needs a human API call because
  `Declaration.value` is still the inherited constructor payload object.
  `Call.makeImportant(...)` replacement proof still passes, and focused
  `rules.test.ts` setDefined/name lookup proof passes. The focused Declaration
  serializer subset for non-custom public-string transport still fails in this
  dirty tree (`":  "` output when child `toTrimmedString` methods are
  monkey-patched), so it is not counted as proof for this name-field slice.
  Latest Declaration name-read sweep proof: stable production consumers in
  control `$for`/`$while`, style-import variable keys, callable parameter
  matching, serialize duplicate-declaration grouping, and direct declaration
  lookup now read `Declaration.name`/`VarDeclaration.name`. Safe core test
  adapters were moved to the same surface. `reference.ts` and `scope-frame.ts`
  now use direct fields for deferred dynamic-name promotion as well; the last
  core-tree production `.value.name` read is `callable-entry.ts`, where the
  value is a synthetic callable-rules record rather than a node payload. The
  prep replacement path added one bounded `rules._scopeFrame` declaration-name
  entry loop in `_replacePendingDeclarationNameNode(...)`; it only runs when a
  prepared `VarDeclaration` replacement has to take over the same source slot,
  and it keeps existing semantic placement state current instead of adding a
  later lookup rediscovery. Focused proof passed with `reference.test.ts` for
  dynamic-name promotion and Less merge-chain property refs; `control.test.ts`,
  `import-style.test.ts`, `rules.test.ts`, callable candidate match/execution
  tests for lookup/import/callable/parameter paths; targeted `mixin.test.ts`
  namespace/interpolated-collapse cases; and `pnpm --filter @jesscss/core
  build`. A broad combined run that overlapped with `pnpm --filter @jesscss/core
  build` hit package-entry resolution failures while `lib` was being cleaned;
  the affected reference/mixin cases passed after the build completed. No
  performance claim; this was a direct-read contract pass.
  Latest parser/fns Declaration name-read sweep: Sass map key helpers in
  `@jesscss/fns`, Less parser guard conversion, the core visitor replacement
  test, and Less-compat Declaration/VarDeclaration `name` getters now read the
  direct `name` field. Focused proof passed with the fns each/map Sass tests,
  `@jesscss/fns` build, `@jesscss/less-parser` build, the core visitor
  replacement test, and `@jesscss/plugin-less-compat` build. The broad Less
  parser serialize run is not counted because it currently fails on dirty-tree
  serializer text shape churn while the parsed trees still report no parse
  errors for the focused cases. Remaining `.value.name` production hits are
  intentionally bounded to `callable-entry.ts` synthetic callable-rules payload
  reads and the deprecated Less-compat `name` setters; the setters cannot be
  made direct-field writes without deciding the legacy adapter mutation /
  replacement protocol. The forbidden reflective getter scan returned no hits.
  Latest parser-test Declaration name-read cleanup proof: Jess parser variable
  assertions and Less parser `each()` callback pattern assertions now read
  `VarDeclaration.name` directly instead of reopening `value.name`. Focused
  proof passed with `pnpm --filter @jesscss/jess-parser exec vitest run
  test/features.test.ts test/ast-serialize.test.ts --testNamePattern
  "var|variable|dollar"` and `pnpm --filter @jesscss/less-parser exec vitest
  run test/values.test.ts --testNamePattern "each|callback|params"`. The
  parser/fns test scan for `value.name` returned no hits.
  Latest SCSS extend-selector direct-read proof: `findDisallowedExtendSelector`
  no longer uses `as any` payload reads to walk `SelectorList`,
  `CompoundSelector`, or `ComplexSelector` children; it now relies on `isNode`
  narrowing and direct `.value` reads on the typed selector nodes. Placeholder
  target detection likewise no longer opens untyped selector payloads; it checks
  direct `BasicSelector.value` and unwraps singleton typed selector containers
  through their direct `.value` arrays. The Sass
  placeholder `@extend` baseline now asserts the direct `Extend.namespace`
  field instead of expecting `serializeTypes(...)` to print scalar metadata
  omitted by `Extend.childKeys`. Focused proof passed with
  `@jesscss/scss-parser` build and a clean post-build rerun of
  `pnpm --filter @jesscss/scss-parser exec vitest run test/baseline.test.ts
  test/parse-only.test.ts test/ast-serialize.test.ts --testNamePattern
  "@extend|extend|placeholder|selector list|compound"`. The targeted scan for
  the old untyped extend-selector payload reads returned no hits.
  Latest Less-compat reverse-conversion proof: detached Less ruleset conversion
  no longer reads declaration-like Less nodes through untyped payload casts; the
  loop already guards `Declaration`/`Rule` shaped records, so it reads
  `rr.value` directly. Focused transform proof passed with
  `pnpm --filter @jesscss/plugin-less-compat exec vitest run
  test/unit/transform/from-less.test.ts test/unit/transform/adapter.test.ts
  test/unit/transform/to-less.test.ts --testNamePattern
  "declaration|ruleset|detached|transform|adapter|to-less|from-less"`, and
  `@jesscss/plugin-less-compat` build passed. The active-code scan for
  untyped payload-read pattern now returns no hits;
  only handoff prose mentions removed legacy patterns.
  Latest control childKeys proof: `If` and `For` now have static `childKeys`
  that name their direct constructor-owned structural fields, matching `While`
  and removing the cold serializer's legacy payload fallback for those control
  nodes. No runtime read migration was needed in this slice because control
  render/eval paths were already using `branches`, `pattern`, `iterable`, and
  `rules` directly. Focused proof passed with core control/render-buffer tests,
  Jess parser control serializer/baseline tests, SCSS parser `@if`/`@each`
  serializer/baseline/parse tests, and builds for `@jesscss/core`,
  `@jesscss/jess-parser`, and `@jesscss/scss-parser`. A no-own-childKeys scan
  now leaves only inherited contracts (`Keyword`, `Num`, `Collection`,
  `RawRules`, `CustomDeclaration`, `VarDeclaration`) plus `Declaration`, whose
  RHS child field still needs a human API naming decision before it can get a
  truthful direct child contract. The forbidden reflective getter scan returned
  no hits.
  Latest Ruleset selector test-adapter proof: `fast-reject.test.ts` no longer
  patches `clonedParent.value.selector` after construction, which produced a
  stale payload/direct-field split for `Ruleset.selector`. The eval-context
  selector compare cases now construct the replacement parent with the patched
  selector in its constructor payload, so the direct `selector` field and
  legacy payload record agree without adding a setter or post-construction
  mutation path. Focused proof passed with the two eval-context fast-reject
  tests. The migrated-field payload scan no longer finds `value.selector`
  mutation in active tests; remaining hits are synthetic callable records,
  deprecated Less-compat Declaration name setters, legitimate child-node value
  reads, and an old design-doc snippet. The forbidden reflective getter scan
  returned no hits.
  Latest Declaration important-field proof: `Declaration` now owns a direct
  constructor-written `important` field, inherited by `VarDeclaration`. Core
  render/eval/registration, reference important propagation, `Rules.toObject`,
  Less parser guard conversion, and Less-compat declaration metadata now read
  the direct field. Cross-scope merge coalescing no longer writes important
  state into the payload object; when a prior merged declaration contributes
  `!important`, it derives a replacement declaration and swaps the owned
  `Rules.value` slot at that mutation boundary. This adds one owner-slot
  `indexOf` lookup only on the already-mutating cross-scope merge path where a
  replacement is required to keep direct state current. Focused proof passed
  with `declaration.test.ts` important/contextual-important plus direct merge
  propagation cases, `call.test.ts` important replacement cases, the reference
  and mixin regression slice, the lookup/import/callable focused slice, and
  builds for `@jesscss/core`, `@jesscss/less-parser`, and
  `@jesscss/plugin-less-compat`. Scans for payload important reads and the
  forbidden reflective getter returned no hits in the touched production/test
  surface. No performance claim.
  Latest Less-compat `@plugin` prelude extraction proof: the deprecated
  `@plugin` path extractor no longer hard-codes nested generic payload reads
  while trying to discover quoted/url plugin paths. It now uses local
  `unknown`-typed guards for node-like value and `valueOf()` surfaces, bounded
  to the legacy directive parser. No plugin loading behavior changed, no core
  node API was widened, and no render/eval traversal was added. Focused proof
  passed with `pnpm --filter @jesscss/plugin-less-compat exec vitest run
  test/integration/at-plugin.test.ts` and
  `pnpm --filter @jesscss/plugin-less-compat build`; the active-code scan for
  forbidden reflective getter use still returns no hits. No performance claim.
  Latest Negative direct-read cleanup proof: `Negative.toTrimmedString(...)`
  no longer reopens scalar child fields through repeated `this.value.*`
  chains after narrowing to `Dimension` or `Any`; it captures the narrowed
  direct child once and reads that child's direct fields. This adds no helper,
  traversal, node materialization, or behavior change. Focused proof passed
  with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/negative.test.ts src/tree/__tests__/node-render-buffer.test.ts
  --testNamePattern "Negative|negative"` and
  `pnpm --filter @jesscss/core build`; the exact `Negative` stale-read scan
  and forbidden reflective getter scan returned no hits. No performance claim.
  Latest Range constructor-context proof: `Range` already had direct
  `start`/`end`/`step` fields and static `childKeys`, and now also preserves
  parser-provided tree context at its constructor/factory boundary like the
  surrounding scalar/control nodes. This is a construction-time metadata carry,
  not a render/eval traversal or materialization change. Focused proof passed
  with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/range.test.ts src/tree/__tests__/node-render-buffer.test.ts
  --testNamePattern "Range|range"` and
  `pnpm --filter @jesscss/core build`; the forbidden reflective getter scan
  returned no hits. No performance claim.
  Latest PseudoSelector constructor-context proof: `PseudoSelector` already
  had direct `name`/`arg` fields and static `childKeys`, and now honors the
  parser-provided tree context argument that CSS selector productions were
  already passing. Evaluated pseudo construction and cold pseudo-copy
  construction also pass through the source tree context at construction time
  before inheriting broader metadata. This adds no traversal, render transport,
  or semantic selector change. Focused proof passed with
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-pseudo.test.ts src/tree/__tests__/node-render-buffer.test.ts
  --testNamePattern "PseudoSelector|pseudo"`,
  `pnpm --filter @jesscss/css-parser exec vitest run
  test/ast-serialize.test.ts --testNamePattern "pseudo"`,
  `pnpm --filter @jesscss/css-parser exec vitest run
  test/nested-pseudo.test.ts`, and builds for `@jesscss/core` and
  `@jesscss/css-parser`; the forbidden reflective getter scan returned no hits.
  No performance claim.
  Latest Color constructor-context proof: `Color` already had a direct
  `node` child contract and direct channel fields, and now honors the
  parser-provided tree context argument that CSS/Jess parser token conversion
  was already passing. The preserved-call color path also now writes through
  direct syntax writers instead of falling back to public string transport:
  `Call.writeSyntax(...)` writes direct `name`/`args`/`contentNode` fields, and
  `List.writeSyntax(...)` writes list children directly while reusing the
  existing separator/trivia logic. The added `List.writeSyntax(...)` loop is
  the syntax-writer equivalent of the existing list string/render loops: it
  walks the already-owned list values once and writes each child directly, so
  preserved syntax callers do not rediscover output through public string
  transport. Its `try/finally` only restores the existing trivia suppression
  flag around child syntax writes, matching the older list item writer shape.
  No color channel conversion, operation, or fns behavior changed.
  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/color.test.ts --testNamePattern
  "preserves parser tree context"`, full
  `pnpm --filter @jesscss/core exec vitest run src/tree/__tests__/color.test.ts`,
  focused `Call` syntax-writer coverage, builds for `@jesscss/core`,
  `@jesscss/css-parser`, and `@jesscss/jess-parser`, and
  `pnpm --filter @jesscss/css-parser exec vitest run
  test/ast-serialize.test.ts --testNamePattern
  "numbers and dimensions|plain identifier color|url function"`. The CSS
  serializer expectations for `Url`/`List`/`Color` were updated to the current
  static `childKeys` direct-field shape. A broad `call.test.ts` pattern still
  hits unrelated dirty-tree perf-counter and optional-JS failures, so it is not
  counted as proof for this color/list/call writer slice. The forbidden
  reflective getter scan returned no hits. No performance claim.
  Latest scalar/Declaration constructor-context proof: `Any`/`Keyword`,
  `Bool`, `Nil`, `JsFunction`, `Declaration`, and `VarDeclaration` now accept
  and preserve parser-provided tree context at construction/factory boundaries.
  Parser productions were already carrying this context for several scalar and
  declaration nodes; this slice makes the concrete constructors honor it
  directly instead of dropping it or requiring any generic runtime probe. The
  `VarDeclaration` helper also forwards the optional tree context. This adds no
  traversal, node materialization, render transport, proxy, or reflective
  property lookup. Focused proof passed with `pnpm --filter @jesscss/core exec
  vitest run src/tree/__tests__/any.test.ts src/tree/__tests__/bool.test.ts
  src/tree/__tests__/nil.test.ts src/tree/__tests__/js-host.test.ts
  --testNamePattern "preserves parser tree context|renders Any|renders
  bool|nil|resolves JS functions"`, `pnpm --filter @jesscss/core exec vitest
  run src/tree/__tests__/declaration.test.ts --testNamePattern "preserves
  parser tree context"`, builds for `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, and `@jesscss/jess-parser`,
  and `pnpm --filter @jesscss/css-parser exec vitest run
  test/ast-serialize.test.ts --testNamePattern "numbers and dimensions|plain
  identifier color|url function|at-rule name"`. A constructor scan found no
  remaining concrete core node constructors missing a tree-context parameter,
  and the forbidden reflective getter scan returned no hits. A broader
  `declaration.test.ts` pattern still exposes unrelated dirty-tree declaration
  render-buffer failures, so it is not counted as proof for this constructor
  metadata slice. No performance claim.
  Latest Declaration RHS direct-field proof: `Declaration` now owns a direct
  constructor-written `valueNode` field and declares static child fields as
  `['name', 'valueNode', 'important']`; `VarDeclaration` and
  `CustomDeclaration` inherit that direct child contract. Core declaration
  eval/render/registration, reference lookup finalization, scope-frame binding
  snapshots, callable parameter matching, attribute selector dynamic lookup,
  style-import live slots, Less guard parser conversion, Sass map helpers, and
  fns `each()` tests now read declaration RHS through `valueNode` instead of
  reopening `decl.value.value`. Merge coalescing now composes from direct
  `valueNode` state and derives replacement declarations for merged output
  value changes. One semantic in-place mutation boundary remains by design:
  `setDefined` assignment updates the existing declaration placement without
  deriving a placement declaration, and `syncDeclarationValueNode(...)` keeps
  the legacy payload and direct field in sync at that assignment boundary. The
  deprecated Less `@plugin` adapter path also explicitly syncs `name` and
  `valueNode` when old Less visitor code assigns `node.name` or `node.value`;
  this is bounded to the deprecated compatibility adapter and is covered by a
  focused adapter test. No proxy or reflective getter was added.

  New traversal: none for the `valueNode` field migration itself. Existing
  merge-coalescing walks remain the same ownership path; this slice removed an
  old payload unwrap (`getDeclValue(...).value`) that had exposed raw child
  arrays to merge item comparison. New materialization: merged declaration
  value changes use the existing `deriveWithParts(...)` replacement path, while
  `setDefined` stays in-place because current tests require no placement
  derivation there. Metadata mutation: the two explicit compatibility/semantic
  assignment boundaries use `Object.defineProperty(...)` to keep readonly TS
  fields synchronized with legacy payload objects; normal compiler paths remain
  constructor-written/direct-read. Focused proof passed with `pnpm --filter
  @jesscss/core exec vitest run src/tree/__tests__/rules.test.ts
  src/tree/__tests__/reference.test.ts --testNamePattern "setDefined variable
  assignment|updates static setDefined variables"`, `pnpm --filter
  @jesscss/core exec vitest run src/tree/__tests__/declaration.test.ts
  --testNamePattern "coalesces merged declaration lists|continues a property
  merge chain|normalizes merged declaration|merged declaration"`, `pnpm
  --filter @jesscss/plugin-less-compat exec vitest run
  test/unit/transform/adapter.test.ts --testNamePattern "declaration value
  mutation|adapter identity|declared fields"`, `pnpm --filter @jesscss/fns
  exec vitest run src/sass/__tests__/map-functions.test.ts
  src/__tests__/each.test.ts --testNamePattern
  "map|get|has-key|values|each|Nil"`, builds for `@jesscss/core`,
  `@jesscss/less-parser`, `@jesscss/fns`, and
  `@jesscss/plugin-less-compat`, `git diff --check`, and the forbidden
  reflective getter scan. The targeted remaining `value.value` scan only
  returns constructor/payload-sync sites or non-declaration scalar/container
  reads. No performance claim.
  Latest control/JS-function direct-read proof: `$while` mutation sync and
  `$for` rules-iterable binding now read declaration RHS through
  `VarDeclaration.valueNode` / `Declaration.valueNode` instead of reopening
  `value.value`. `JsFunction` now owns a direct constructor-written `fn` field,
  and `Call` plus `Reference` JS-function invocation paths call `fn` directly
  instead of unwrapping the inherited `value` payload. Focused core tests were
  updated to assert declaration RHS through `valueNode` where they were
  restating old payload shape; live-binding cell value assertions remain
  `cell.value.valueOf()` because those are not declarations. This adds no new
  traversal, no node materialization, no render transport, and no proxy or
  reflective getter. The only new field is the constructor-owned `JsFunction.fn`
  alias for the existing callable payload.

  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/control.test.ts --testNamePattern
  "while|each|For|pattern|tuple|range|JsFunction"`, `pnpm --filter
  @jesscss/core exec vitest run src/tree/__tests__/js-host.test.ts`, `pnpm
  --filter @jesscss/core exec vitest run src/tree/__tests__/call.test.ts
  --testNamePattern "direct function bindings|metadata JS functions|referenced
  JS function|callback arg lists|JsFunction"`, `pnpm --filter @jesscss/core
  exec vitest run src/tree/__tests__/reference.test.ts --testNamePattern
  "static function binding handles|JsFunction|setFunctionBinding|function
  key"`, and a focused declaration/rules/mixin/import-style assertion sweep
  covering the updated `valueNode` expectations. `@jesscss/core` build and
  `git diff --check` passed, and targeted scans for forbidden reflective getter,
  JS-function invocation through `.value`, and old control declaration
  `value.value` reads returned no hits. A broad `call.test.ts` pattern still
  reports unrelated dirty-tree call render/readback failures and is not counted
  as proof for this direct JS-function field slice. No performance claim.
  Latest Url direct-child proof: `Url` now owns a constructor-written direct
  `node` child field, declares static child fields as `['node']`, and routes
  URL render/resolve/source string reads through that direct field instead of
  the inherited payload. The deprecated Less compatibility adapter still
  exposes old Less-facing `.value`, but now derives it from `Url.node` at the
  adapter boundary. This keeps normal compiler traversal on the static direct
  child contract while preserving the deprecated plugin surface.

  New traversal: none; render and resolve keep their existing single child
  evaluation path. New materialization: no normal render materialization was
  added; the existing `withValue(...)` replacement path remains resolve-only
  when a non-static URL child evaluates to a different node. Helper/API
  surface: one direct readonly field replaces internal payload reads and is
  covered by a focused constructor-owned-field assertion. Metadata mutation:
  only construction-time tree context carry and existing inherit metadata on
  resolve replacement. Focused proof passed with `pnpm --filter @jesscss/core
  exec vitest run src/tree/__tests__/url.test.ts`, `pnpm --filter @jesscss/core
  exec vitest run src/tree/__tests__/url.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern "Url|url"`,
  `pnpm --filter @jesscss/css-parser exec vitest run
  test/ast-serialize.test.ts --testNamePattern "url function"`, and builds for
  `@jesscss/core`, `@jesscss/css-parser`, `@jesscss/less-parser`, and
  `@jesscss/plugin-less-compat`. No performance claim.
  Latest Negative direct-child proof: `Negative` now owns a constructor-written
  direct `node` child field, declares static child fields as `['node']`, and
  routes syntax/render/eval reads through that direct field instead of the
  inherited payload. The deprecated Less compatibility adapter still exposes
  old Less-facing `.value`, but now derives it from `Negative.node` at the
  adapter boundary. Focused parser serializer expectations were refreshed where
  already-migrated direct fields (`Declaration.valueNode`, `Url.node`, and
  direct list `value:` labels) had left stale golden text behind.

  New traversal: none; Negative still evaluates its single child once on the
  existing render/eval path. New materialization: no render materialization was
  added; existing scalar fast paths still write negative dimensions and plain
  identifiers directly, while compound dimensions remain on the public
  operation boundary covered by tests. Helper/API surface: one direct readonly
  field replaces internal payload reads and is covered by a focused
  constructor-owned-field assertion. Metadata mutation: construction-time tree
  context carry only. Focused proof passed with `pnpm --filter @jesscss/core
  exec vitest run src/tree/__tests__/negative.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "Negative|negative"`, parser serializer checks for CSS/Less/SCSS direct-field
  expectations, and builds for `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/plugin-less-compat`. No performance claim.
  Latest Rest direct-child proof: `Rest` now owns a constructor-written direct
  `node` field and declares static child fields as `['node']`. Rest can carry
  either a node child or a raw string name, so the public `name` getter remains
  the Less/Sass-facing accessor while syntax/render/name reads use the direct
  constructor field instead of the inherited payload. Less parser serializer
  expectations were refreshed where rest parameters now serialize as
  `Rest.node`, and where already-migrated direct fields (`Declaration.valueNode`,
  `List.value`, and `Rules.value`) had stale golden text around the same
  focused fixtures.

  New traversal: none; Rest remains a scalar/direct wrapper and performs no
  child evaluation. New materialization: none; render still writes string/Any
  rest forms directly and delegates only non-Any node forms to the existing
  source render path. Helper/API surface: one direct readonly field replaces
  internal payload reads and is covered by a focused constructor-owned-field
  assertion. Metadata mutation: construction-time tree context carry only.
  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/rest.test.ts src/tree/__tests__/node-render-buffer.test.ts
  --testNamePattern "Rest|rest"`, callable rest argument/parameter helper
  tests, focused mixin rest tests, Less and SCSS parser serializer checks for
  rest/spread fixtures, and builds for `@jesscss/core`, `@jesscss/css-parser`,
  `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/plugin-less-compat`. No performance claim.
  Latest InterpolatedSelector direct-child proof: `InterpolatedSelector` now
  owns a constructor-written direct `node` field and declares static child
  fields as `['node']`. Selector interpolation is an internal selector wrapper,
  so the child field can use the same `node` name as the other single-child
  wrappers without changing a Less-facing public value contract. Syntax,
  resolve/eval, render, and source string reads now use the direct field.
  Less parser serializer expectations were refreshed for `InterpolatedSelector
  node:`, and an SCSS selector fixture was refreshed where `ComplexSelector`
  already serializes its direct `value:` field.

  New traversal: none; selector interpolation still resolves the same owned
  interpolated child once on the existing selector path. New materialization:
  none; existing tests still prove resolving interpolated selectors does not
  clone the source interpolated child or reusable selector leaves. Helper/API
  surface: one direct readonly field replaces internal payload reads and is
  covered by a focused constructor-owned-field assertion. Metadata mutation:
  construction-time tree context carry only. Focused proof passed with `pnpm
  --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-interpolated.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "InterpolatedSelector|interpolated selector"`, focused Less and SCSS parser
  serializer checks for selector interpolation/selector fixtures, and builds
  for `@jesscss/core`, `@jesscss/css-parser`, `@jesscss/less-parser`,
  `@jesscss/scss-parser`, and `@jesscss/plugin-less-compat`. No performance
  claim.
  Latest Block direct-child proof: `Block` now owns a constructor-written direct
  `node` field and declares static child fields as `['node']`. Block remains a
  single-child wrapper for square/curly custom values, so the direct child uses
  the same `node` name as the other wrapper migrations. Syntax, render,
  resolve, and eval reads now use `Block.node`; `list-like` bracketed-list
  unwrapping and the focused control test tuple helper were updated to read
  `Block.node` as well. CSS parser serializer expectations were refreshed where
  already-migrated direct fields (`Declaration.valueNode`, `List.value`, and
  `Sequence.value`) had stale golden text in the same focused fixture.

  New traversal: none; Block still evaluates its single child once on the
  existing render/eval path. New materialization: no render materialization was
  added; the existing `withValue(...)` replacement path remains resolve-only
  when a non-static block child evaluates to a different node. Helper/API
  surface: one direct readonly field replaces internal payload reads and is
  covered by a focused constructor-owned-field assertion. Metadata mutation:
  construction-time tree context carry and existing inherit metadata on resolve
  replacement only. Focused proof passed with `pnpm --filter @jesscss/core exec
  vitest run src/tree/__tests__/block.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "Block|block"`, focused control block-pattern tests, focused CSS/Less parser
  serializer checks for block/custom/list fixtures, and builds for
  `@jesscss/core`, `@jesscss/css-parser`, `@jesscss/less-parser`,
  `@jesscss/scss-parser`, and `@jesscss/plugin-less-compat`. No performance
  claim. There is no dedicated `list-like.test.ts`; the helper path is covered
  here by build plus block/control behavior.
  Latest Paren direct-child proof: `Paren` now owns a constructor-written
  direct `node` field and declares static child fields as `['node']`. Paren is
  a single-child grouping wrapper, so it follows the `Block`/`Negative`/`Rest`
  direct-child name. Source syntax, eval/resolve, Less parser unwrapping,
  Sass/fns bracketed-list assertions, and Less `svg-gradient` paren flattening
  now read `Paren.node` instead of the inherited payload. CSS/Less/SCSS parser
  tests that explicitly inspect Paren children were refreshed to assert
  `node:`.

  New traversal: none; Paren still evaluates its single child once on the
  existing render/eval path. The textual `while (value instanceof Paren &&
  value.node)` verifier hits are the pre-existing nested-Paren unwrap loops
  rewritten from `.value` to `.node`, not added traversal. New materialization:
  no render materialization was added; the existing `withValue(...)`
  replacement path remains resolve-only when a non-static grouped child
  evaluates to a different node. Render path: simple empty/nil/Any wrappers
  write directly without `mark/getSince`, and resolved compound children stream
  wrapper delimiters plus child render output into the active writer/buffer
  instead of using child render as string transport and writing the whole
  wrapped result afterward. Helper/API surface: one direct readonly field
  replaces internal payload reads; small private delimiter/simple-wrapper
  helpers are local to Paren and remove repeated branch/string transport in the
  render path. Metadata mutation:
  construction-time tree context carry and existing inherit metadata on resolve
  replacement only. Focused proof passed with `pnpm --filter @jesscss/core exec
  vitest run src/tree/__tests__/paren.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "Paren|paren"`, focused Less parser Paren/function/container checks, focused
  CSS parser container Paren checks, focused SCSS Paren/bracket/condition
  checks, focused fns Sass bracketed-list checks, and builds for
  `@jesscss/core`, `@jesscss/css-parser`, `@jesscss/less-parser`,
  `@jesscss/scss-parser`, and `@jesscss/fns`. No performance claim.
  Latest Expression direct-child proof: `Expression` now owns a
  constructor-written direct `node` field and declares static child fields as
  `['node']`. Expression is a single-child runtime wrapper, so it uses the same
  direct `node` naming as `Paren`/`Block`/`Negative`/`Rest`. Eval, resolve,
  render, and source syntax reads now use `Expression.node`; `control.ts`
  iterable unwrapping and SCSS `@each` iterable unwrapping read the direct field
  as well. Less/SCSS parser serializer expectations were refreshed where
  Expression children now print as `node:`.

  New traversal: none; Expression still evaluates or directly renders its
  single child through the existing paths. The textual generator hit in
  `resolveEntries(...)` is the existing Expression iterable unwrap with the
  child read changed from `.value` to `.node`, not a new generator or walk. New
  materialization: none; the existing render path still renders evaluated
  values directly and keeps list and sequence children on their direct render
  path without evaluating the Expression wrapper. Helper/API surface: one
  direct readonly field replaces internal payload reads and is covered by a
  focused constructor-owned-field assertion. Metadata mutation: construction-time
  tree context carry only.
  Focused proof passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/expression.test.ts src/tree/__tests__/control.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "Expression|expression|each"`, focused Less/SCSS/Jess parser Expression
  serializer and behavior checks, and builds for `@jesscss/core`,
  `@jesscss/less-parser`, and `@jesscss/scss-parser`. No performance claim.
  Latest ExtendList direct-child proof: `ExtendList` now owns a
  constructor-written direct `nodes` field and declares static child fields as
  `['nodes']`. This node is a narrow internal extend side-effect list, and the
  existing render implementation already named its child array `nodes`, so the
  direct field does not create a broad public container naming precedent.
  Syntax, render side-effect execution, and async continuation paths now read
  `ExtendList.nodes`; the legacy `value` payload remains present for
  compatibility and is covered by a focused assertion. The verifier's
  materialized-array/object hit for `readonly nodes: Extend[]` is the typed
  direct field aliasing the constructor-provided array, not a new array
  allocation.

  New traversal: none; ExtendList still loops over the same child extend nodes
  to run side effects. New materialization: none; render still returns invisible
  effect output and does not call child render or public eval output.
  Helper/API surface: one direct readonly field replaces internal payload reads
  and is covered by a focused constructor-owned-field assertion. Metadata
  mutation: construction-time tree context carry only. Focused proof passed with
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/extend.test.ts src/tree/__tests__/node-render-buffer.test.ts
  --testNamePattern "ExtendList|extend lists|extend side effects|Extend
  render"` and `pnpm --filter @jesscss/core build`. No performance claim.
  Latest SelectorList direct-child proof: `SelectorList` now owns a
  constructor-written direct `selectors` field and declares static child fields
  as `['selectors']`. The name follows existing local API (`withSelectors`) and
  the node's semantic role as a selector-alternative container; the legacy
  `value` payload remains present for compatibility and is covered by a focused
  assertion. `SelectorList` render/eval/flatten/keyset paths now read
  `selectors`, and typed selector-list consumers in ampersand composition,
  ruleset composition, selector matching, extend helpers, Less parser extend
  grouping, and SCSS at-rule lowering read the direct field where the receiver
  is definitely a `SelectorList`.

  New traversal: none added for the field migration. Existing selector-list and
  `:is()` loops now read `selectors` instead of `value`; they still iterate the
  same alternatives on the same code paths. New materialization: none added by
  the field itself; `readonly selectors: Selector[]` aliases the constructor
  array. Existing extend/ruleset replacement paths remain construction paths
  for semantic selector results, not render-only materialization. Render path:
  SelectorList still writes selector output directly through `writeSyntax`; no
  array/node construction was added just to stringify. Helper/API surface: one
  direct readonly field replaces public-payload reads for this node family and
  no new helper was added in this slice. Metadata mutation: construction-time
  tree context carry only; no `Reflect.*` usage was introduced. Focused proof
  passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-list.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "SelectorList|selector list|selector|direct child"`, selector/extend-heavy
  core tests (`selector-list`, `selector-pseudo`, `extend`,
  `selector-compare`, `match-selector`, `extend-walk`), and builds for
  `@jesscss/core`, `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/css-parser`. Parser AST serialization sweeps were not accepted as
  proof for this slice because their selected broad `serialize` pattern still
  hits unrelated stale expectations from earlier direct-field migrations; the
  CSS serializer run stalled and was killed. No performance claim.
  Latest CompoundSelector direct-child proof: `CompoundSelector` now owns a
  constructor-written direct `components` field and declares static child
  fields as `['components']`. The name follows the existing local
  `withComponents(...)` API and the CSS selector model: a compound selector is
  an ordered collection of simple-selector components. The legacy `value`
  payload remains present for compatibility and is covered by a focused
  assertion. Compound syntax writing, value/keyset calculation, eval/resolve
  component evaluation, collapse/finalization, ruleset ampersand substitution,
  selector matching, walk-and-consume extend matching, SCSS extend validation,
  and Less mixin-reference key normalization now read `components` where the
  receiver is definitely a `CompoundSelector`.

  New traversal: no new traversal was added. Existing compound component loops
  in selector render/eval, keyset computation, selector comparison,
  `:is(...)` expansion, and extend matching now read `components` instead of
  reopening the inherited payload. New materialization: no new render
  materialization was added; `readonly components: SimpleSelector[]` aliases the
  constructor array. Existing extend/matching code still constructs replacement
  compound selectors only at semantic selector-result boundaries. Render path:
  compound syntax still writes components directly to the active writer, and
  empty compound string output still returns `''` without writer readback.
  Helper/API surface: one direct readonly field replaces payload reads for this
  node family; no new helper was added in this slice. Metadata mutation:
  construction-time tree context carry only; no `Reflect.*` usage was
  introduced. Focused proof passed with `pnpm --filter @jesscss/core exec
  vitest run src/tree/__tests__/selector-compound.test.ts
  src/tree/__tests__/node-render-buffer.test.ts --testNamePattern
  "CompoundSelector|Compound Selector|compound selector|direct child|compound"`,
  the selector/extend-focused core suite (`selector-compound`,
  `selector-pseudo`, `selector-compare`, `match-selector`, `extend-walk`), and
  builds for `@jesscss/core`, `@jesscss/less-parser`, `@jesscss/scss-parser`,
  and `@jesscss/css-parser`. No performance claim.
  Latest ComplexSelector direct-child proof: `ComplexSelector` now owns a
  constructor-written direct `components` field and declares static child
  fields as `['components']`. The name follows the existing local
  `withComponents(...)` API and the CSS selector model: a complex selector is
  an ordered selector-component sequence that may include combinators. The
  legacy `value` payload remains present for compatibility and is covered by a
  focused assertion. Complex syntax writing, value/keyset calculation,
  eval/resolve component evaluation, collapse/finalization, ruleset
  composition, ampersand append/substitution, selector matching, extend walk
  and application, reference-key normalization, and Less/CSS/SCSS parser
  complex-selector handling now read `components` where the receiver is
  definitely a `ComplexSelector`.

  New traversal: no new traversal was added. Existing complex selector loops in
  render/eval, keyset computation, selector comparison, parser canonicalization,
  and extend matching now read `components` instead of reopening the inherited
  payload. New materialization: no render materialization was added;
  `readonly components: ComplexSelectorValue` aliases the constructor array.
  The extend normalization path now avoids rebinding selector payload arrays and
  constructs replacement selector nodes only when normalized children actually
  differ. Render path: complex syntax still writes components directly to the
  active writer, and empty complex string output still returns `''` without
  writer readback. Helper/API surface: one small local array-identity helper was
  added in `extend.ts` to preserve source selectors when normalization is
  unchanged; it prevents unnecessary replacement construction and avoids a
  child-as-inherit-source cycle found while migrating the direct fields.
  Metadata mutation: construction-time tree context carry only; no
  `Reflect.*` usage was introduced. Focused proof passed with
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/selector-complex.test.ts`, the selector/extend-focused
  core suite (`selector-complex`, `selector-pseudo`, `selector-list`,
  `selector-compound`, `selector-compare`, `match-selector`, `extend-walk`,
  `extend-selector-algorithm`, `extend-ampersand`), and builds for
  `@jesscss/core`, `@jesscss/less-parser`, `@jesscss/scss-parser`, and
  `@jesscss/css-parser`. No performance claim.
  Latest List direct-child proof: `List` now owns a constructor-written direct
  `items` field and declares static child fields as `['items']`. The name
  follows the existing local terminology for list contents and the Sass/Less
  function-library usage of list items. The legacy `value` payload remains the
  same backing array for compatibility and old plugin-shaped access, and the
  focused test asserts that `items` aliases that constructor payload. Core
  `List` render/eval/compare/addition paths, call-argument handling, list-like
  utilities, parser canonicalization, and fns helpers now read `items` where
  the receiver is definitely a `List`; `Sequence` remains on `value`.

  New traversal: no new traversal was added. Existing list loops now read
  `items` instead of reopening the inherited payload. New materialization: no
  render materialization was added; `readonly items: T[]` aliases the
  constructor array, and existing replacement `List` construction remains at
  eval/operation/parser semantic boundaries. Render path: list rendering still
  writes items directly and dynamic render still streams evaluated items
  without replacement-list materialization. Helper/API surface: one direct
  readonly field replaces typed payload reads for this node family; no helper
  was added in this slice. Metadata mutation: parse-time canonicalization still
  adopts replacements before in-place array writes, and no `Reflect.*` usage
  was introduced. Focused proof passed with `pnpm --filter @jesscss/core exec
  vitest run src/tree/__tests__/list.test.ts src/tree/__tests__/paren.test.ts
  src/tree/__tests__/control.test.ts src/tree/util/__tests__/callable-args.test.ts
  src/tree/__tests__/operation.test.ts`, and builds for `@jesscss/core`,
  `@jesscss/less-parser`, `@jesscss/css-parser`, `@jesscss/scss-parser`, and
  `@jesscss/fns`. Broader `Call`/`Declaration` serialization tests still have
  existing open failures around public string transport and mark/readback
  counts; they are not accepted as proof for this List field slice. No
  performance claim.
  Latest Sequence/QueryCondition direct-child proof: `Sequence` and
  `QueryCondition` now own/read a constructor-written direct `items` field and
  declare static child fields as `['items']`. The first attempted name was
  `nodes`, but the fns declaration build caught the architectural conflict:
  `Node` already has a public `nodes(...)` iterator method, so a direct
  `nodes` array would make `Sequence` structurally incompatible with `Node` in
  TypeScript. `items` therefore deliberately matches `List` for list-like
  array contents while `QueryCondition` inherits the same field shape from
  `Sequence`. The legacy `value` payload remains the same backing array for
  compatibility, and focused tests assert the alias.

  New traversal: no new traversal was added. Existing sequence/list-like loops
  now read `items` instead of reopening the inherited payload. New
  materialization: no render materialization was added; `readonly items:
  Node[]` aliases the constructor array. Sequence addition was adjusted to keep
  the existing no-`push` construction shape while reading direct fields.
  Render path: no Sequence serialization-row rewrite was accepted in this
  slice; broad Sequence tests still expose existing public string transport and
  mark/readback failures, so this slice claims only the direct-field contract
  and operation/parser/fns read migration. Helper/API surface: one direct
  readonly field replaces typed payload reads; no helper was added. Metadata
  mutation: none added, and no `Reflect.*` usage was introduced. Focused proof
  passed with `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/sequence.test.ts src/tree/__tests__/query-condition.test.ts
  --testNamePattern "constructor-owned direct field|inherits the sequence
  direct child field|sequence addition|list values|source list children|source
  sequence children"`, builds for `@jesscss/core`, `@jesscss/less-parser`,
  `@jesscss/css-parser`, `@jesscss/scss-parser`, and `@jesscss/fns`, plus
  focused fns tests for color/list/extract helpers. No performance claim.
  Latest Rules direct-child proof: `Rules` now owns a constructor-written
  direct `rules` field and declares static child fields as `['rules']`. The
  name matches the node's public model and avoids the generic `value` payload
  for declaration/ruleset lists. The legacy payload remains the same backing
  array for Less/plugin compatibility, and the focused test asserts the alias.
  Core `Rules` registration, lookup, render, eval, source-order replacement,
  import placement, callable lookup, call output, static-render checks,
  parsers, fns-visible helpers, and Less compat conversion now read `rules`
  where the receiver is definitely a `Rules`.

  New traversal: no new traversal was added. Existing Rules child scans now
  read `rules` instead of reopening the inherited payload. New materialization:
  no render materialization was added; `readonly rules: Node[]` aliases the
  constructor array. Existing eval/registration/import paths still replace or
  reorder entries only at their existing semantic mutation boundaries. Render
  path: rules rendering still streams child output through the active writer or
  render buffer; this slice did not add public string transport. Helper/API
  surface: one direct readonly field replaces typed payload reads; no helper
  was added. Metadata mutation: construction-time tree/source context setup is
  unchanged, and no `Reflect.*` usage was introduced. Focused proof passed with
  `pnpm --filter @jesscss/core exec vitest run
  src/tree/__tests__/rules.test.ts --testNamePattern "constructor-owned rules
  as the direct child field|setDefined|readonly|lookup|render|visible"`, a
  focused core suite covering rules/call/import/callable-candidate consumers,
  and builds for `@jesscss/core`, `@jesscss/less-parser`,
  `@jesscss/css-parser`, `@jesscss/scss-parser`, `@jesscss/jess-parser`,
  `@jesscss/fns`, and `@jesscss/plugin-less-compat`. No performance claim.
  Quoted direct-child proof: `Quoted` intentionally keeps `value` as its direct
  child field and static child field `['value']`. This is not an unfinished
  rename: the historical direct-field migration commits (`126699f`, `a08023a`,
  `2e7f282`) also used `Quoted.value`, Less-compatible plugin objects expose
  `Quoted(quote, value, escaped)` and `.value`, plugin-js bridge tests assert
  `quotedResult.value`, and Sass string fns already consume `string.value`.
  The current base `Node` owns a constructor-written readonly `value`, so
  `Quoted` already has the direct readonly field required here while preserving
  Less 4.x compatibility. Focused proof asserts `Quoted.childKeys ===
  ['value']`, the child value aliases the constructor payload, and adoption
  still parents node-valued strings. No new traversal, materialization, helper,
  metadata mutation, or render string transport was added for this exception.
  Latest resumed direct-read cleanup: the inherited `childKeys` audit found no
  missing per-class static arrays that need duplicate overrides:
  `Keyword -> Any(null)`, `Collection`/`RawRules -> Rules(['rules'])`,
  `VarDeclaration`/`CustomDeclaration -> Declaration(['name', 'valueNode',
  'important'])`, and `Num -> Dimension(null)`. Production typed payload reads
  were then migrated where the receiver is definitely one of the direct-field
  node families: `RawRules.rules`, declaration merge/list helpers, call args,
  list-like helpers, fns `min`/`max`, relative-color calls/operations, parser
  paren/expression/rest/operation helpers, Less-compat declaration/call
  adapters, selector-list/compound/complex reads in extend and ruleset
  metadata paths, `Reference.rawKey`, `StyleImport.with`, and ampersand append
  helpers. The Less-compat adapter test now asserts deprecated Less-style
  declaration mutation routes through the Jess direct field instead of keeping
  the stale payload object synchronized.

  New traversal: no new runtime traversal was added. Existing loops still scan
  the same rule, argument, selector, or merge arrays; they now read the
  constructor-owned direct arrays/fields instead of generic payload slots. New
  materialization: no render-only materialization was added. Existing extend
  selector construction remains semantic selector-result construction, and the
  targeted snapshot update only records the current direct `serializeTypes`
  field names. Helper/API surface: `Reference.rawKey` and `StyleImport.with`
  are direct readonly constructor fields replacing payload reads for existing
  values; no generic proxy/fallback helper was added. Metadata mutation: no new
  `Reflect.*` usage; the forbidden reflective-getter scan returns no matches.
  Remaining broad `.value` scan hits are base `Node` payload machinery,
  scalar-leaf APIs (`Any`, `Bool`, `Combinator`, `BasicSelector`, `Quoted`,
  etc.), generic cold copy/materialization helpers, or Less-compat external
  object handling. Focused proof passed with `pnpm --filter @jesscss/core
  build`, the focused core suite over `rules-raw`, `declaration`, `extend`,
  `extend-eval-integration`, `selector-list`, and `reference`, fns `min`/`max`
  tests, Less-compat adapter/at-plugin tests, and scans for the forbidden
  reflective getter and `childKeys = ['value']` (only the intentional `Quoted`
  hit remains). No performance claim.
  Follow-up mutation API cleanup: the stale public generic node mutation helper,
  its type helpers, and tests that existed only to prove generic node mutation
  were removed. The remaining node metadata test now asserts current
  constructor tree-context/source-root behavior. A focused `.set(` scan over
  core production/test files now leaves Map/cache/bitset/source-tree writes and
  Sass `map.set` docs/functions, not node mutation calls. Focused proof passed
  with `pnpm --filter @jesscss/core build` and `pnpm --filter @jesscss/core
  exec vitest run src/tree/__tests__/node-mutation.test.ts
  src/tree/__tests__/node-flags.test.ts`. No performance claim.
- Verdict: accepted as the direct-field/childKeys migration pass for the active
  goal: no known production forbidden reflective getter, public generic node
  mutation helper, stale typed payload-read, or missing static child-key blocker
  remains from this audit.
  Broader render/eval architecture lanes above remain open. No performance
  claim; this was build/test evidence, not a benchmark pass.
