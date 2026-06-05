# Agent Guidelines

This file is the stable cross-tool contract for working in this repo.

Use it as the default guidance for Codex, Cursor, Claude, and any other agent system. Tool-specific rules may add workflow details, but they should not duplicate volatile project state here.

## Canonical Sources

Use guidance in this order:

1. `AGENTS.md` for repo-wide operating rules
2. Area architecture docs for design intent and constraints
3. Tool-specific rules for execution details
4. Transient state files for current baselines, recent failures, and next steps

If a permanent rule and a transient note disagree, prefer the permanent rule unless the transient note clearly says it supersedes it for the active task.

## Keep Guidance Durable

Permanent guidance should avoid information that goes stale quickly:

- do not hard-code current stage numbers, pass counts, or failure counts
- do not duplicate active branch status if a canonical status doc already exists
- do not copy long command lists into multiple places

When information is volatile, point to the canonical source instead of restating it.

## Core Working Rules

- Work from repo evidence first. Read the code and the relevant docs before asking questions.
- Cite file paths when explaining decisions or tradeoffs.
- Preserve Jess behavior unless the task explicitly requires a behavior change.
- Do not weaken tests, lower baselines, or redefine expected semantics just to make a refactor appear complete.
- Prefer small, verifiable changes over broad speculative rewrites.
- If a fix depends on undocumented behavior, stop and ask instead of inventing semantics.

## AST And Runtime Safety

- Maintain valid parent/child relationships at all times.
- Fix structural bugs where they are created, not by filtering around them later.
- Do not use `as any` to bypass node/runtime invariants.
- Do not attach ad-hoc properties to nodes unless the repo already treats that property as part of the runtime model.

## Performance Direction

Performance work in this repo is primarily about runtime architecture, not micro-style changes.
Optimize for fastest real-world Less evaluation/render first and lowest memory
second. Fewer objects and fewer function calls are useful only when they
improve speed, memory, parse/execute size, or the canonical-tree runtime model.

When working in the evaluation engine, optimize for:

- one canonical source tree
- lazy per-placement runtime state
- sparse shadow or patch state
- reduced object creation during eval/render, including AST nodes,
  state/tracking records, `WeakMap` side maps, and helper arrays
- reduced recursive node walks and repeated source/placement rediscovery
- smaller hot-path function-call ladders where they show up in real eval/render
  work

Errors are for exceptional failure, not routine control flow. Do not throw,
catch, allocate, or return `Error` instances to represent expected misses,
ordinary branch results, negative lookup results, failed candidate matches, or
other hot-path control states. Use typed result objects, booleans, sentinels, or
diagnostic records instead; only create real `Error` objects when the caller is
actually expected to handle an exceptional failure.

Avoid treating these as acceptable end states:

- cloning as routine eval isolation
- materialization as a normal internal eval strategy
- helper or wrapper growth that does not map to the target runtime model
- trading one deleted node for more expensive state graphs, recursive walks, or
  function-call overhead
- local green slices presented as architectural completion

If two approaches both pass tests, prefer the one with better measured or
well-supported runtime speed. Use memory pressure as the next tiebreaker, and
use object-count reduction only as a proxy when it covers total runtime objects
and supports those goals.

## Core Architecture Handoff

When working on the active evaluation-model refactor, use these docs as the canonical source:

- `docs/future/core-architecture/HANDOFF.md` for current architecture lanes,
  completion gates, the active queue, and verification
- `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md` and
  `pnpm run verify:aggressive-cutting-review` before committing queue passes
  that touch eval/render/lookup/traversal/copying paths

Use the handoff to understand the direction. Do not add broad status trackers
or stale architecture documents that mostly describe machinery the repo does
not currently have; update the bounded lane gates or node-family tracker
instead.

## Testing And Verification

- Run the smallest relevant test first while iterating.
- Before claiming completion, run the appropriate baseline or verification command for the affected area.
- If package B depends on package A, build A first when the workspace layout requires built outputs.
- When debugging, record what was tried, what happened, and the next step in the repo’s transient state files instead of expanding permanent guidance.

## Tool-Specific Rules

Tool-specific rule systems should stay thin:

- point back to `AGENTS.md` for repo-wide goals
- keep only the workflow details unique to that tool
- avoid copying branch summaries, active stage snapshots, or large architectural explanations

When a tool-specific rule becomes stale, replace it with a pointer to the canonical source instead of refreshing a duplicate summary.
