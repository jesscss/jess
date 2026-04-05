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

When working in the evaluation engine, optimize for:

- one canonical source tree
- lazy per-placement runtime state
- sparse shadow or patch state
- reduced object creation during eval
- copy-on-write only at real mutation boundaries
- edges only where they solve a concrete placement problem

Avoid treating these as acceptable end states:

- cloning as routine eval isolation
- materialization as a normal internal eval strategy
- helper or wrapper growth that does not map to the target runtime model
- local green slices presented as architectural completion
- preserving legacy generic runtime helpers just because they already exist
- adding new generic `.get(...)`, `clone(...)`, `copy(...)`, `inherit(...)`, or
  `adopt(...)` usage on hot canonical paths without proving the need
- paying edge bookkeeping cost on paths that could use direct canonical fields
  or a thin derived node instead

If two approaches both pass tests, prefer the one that better reduces object creation and moves the runtime toward the canonical-tree model.

Treat the architecture as a hard constraint, not a style preference:

- do not preserve legacy runtime patterns by default
- assume old generic node lifecycle machinery is debt unless a failing test
  proves a narrow exception is still required
- prefer deleting abstraction over accommodating it
- if a path is already on a resolved canonical object, use direct fields
- if a path truly diverges, use sparse state or a thin derived node
- only introduce or keep edge wiring when direct canonical reads plus
  copy-on-write are insufficient for that exact placement problem

## Node Copy Reduction Surfaces

When working on the active evaluation-model refactor, use these docs as the canonical source:

- `docs/future/node-copy-reduction/README.md` for the target model
- `docs/future/node-copy-reduction/session-instance-architecture.md` for the runtime shape
- `docs/future/node-copy-reduction/HANDOFF.md` for execution constraints
- `docs/future/node-copy-reduction/STAGES.md` or `docs/future/node-copy-reduction/dependency-graph.md` for current sequencing

Use those docs to understand the direction. Do not restate their volatile status details in permanent agent rules.

## Testing And Verification

- Run the smallest relevant test first while iterating.
- Before claiming completion, run the appropriate baseline or verification command for the affected area.
- If package B depends on package A, build A first when the workspace layout requires built outputs.
- When debugging, record what was tried, what happened, and the next step in the repo’s transient state files instead of expanding permanent guidance.
- For runtime-performance work, a green test is necessary but not sufficient:
  keep the change only if it also moves the runtime toward the canonical-tree,
  sparse-state, copy-on-write architecture. If a change passes tests but adds
  generic runtime overhead or preserves legacy machinery, it is not a valid
  completion.

## Tool-Specific Rules

Tool-specific rule systems should stay thin:

- point back to `AGENTS.md` for repo-wide goals
- keep only the workflow details unique to that tool
- avoid copying branch summaries, active stage snapshots, or large architectural explanations

When a tool-specific rule becomes stale, replace it with a pointer to the canonical source instead of refreshing a duplicate summary.
