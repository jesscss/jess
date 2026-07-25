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

An explicit owner decision in the active task supersedes both prior plans and
these default operating preferences. Treat design documents as evidence and
plans to revise, not immutable law. In particular, an internal consumer,
compatibility adapter, or old node shape must not block replacing it with the
chosen canonical architecture; delete or intentionally break that internal
surface in the cutover, then repair only the consumers still in scope.

## Core Naming Boundaries

Name public production operations for the stable concept (`parse`, `build`,
`render`, `Document`, `RenderOptions`), not a temporary migration (`Ast`) or
an input dialect (`Less`, `Scss`, `Jess`). The module/package path identifies
the dialect; every dialect should expose the same operation vocabulary. Thus
`parseLess`/`renderLess` are transitional names to remove, not an API pattern
to spread. Test-only bridge labels may remain descriptive until that bridge is
deleted. When replacing a transitional seam, remove its name rather than
carrying it forward as an alias.

For AST construction, do not introduce a replacement `BuilderHost`,
`ParseHost`, generic action registry, or host-dispatch abstraction. The grammar
reduction in each parser owns construction and calls parser-local AST factory
functions directly. Move shared syntax only into explicit shared grammar
combinators or core node factories; never into a new runtime construction host.

## Parser Runtime Boundary

In `packages/css-parser`, `packages/less-parser`, `packages/scss-parser`, and
`packages/jess-parser`, runtime recognition belongs exclusively to Parseman
grammar combinators and their macro-compiled output. No handwritten runtime
`RegExp`, regex literal, `.exec`/`.test`/`.match`, `charCodeAt` scanner,
character-by-character recognizer, or recovery re-parser may survive in parser
package source. Move the recognition into Parseman grammar structure, or delete
it. This does not prohibit generated macro output or Parseman internals; it
prohibits handwritten runtime scanner/regex logic in the parser packages.

Imports obey the same rule: Parseman parses each source file exactly once into
typed import facts. Resolution may load an imported file and parse that new
file once, but must never re-parse already-read source for variables, options,
or splice boundaries. No import-specific parser, variable-sniff pass, or
text-splice protocol is allowed.

Interpolation is grammar structure, never a recognized string shape. For every
interpolation-bearing context—quoted strings, import specifiers, at-rule
preludes, selectors, property names, values, and paths—use Parseman
combinators, normally `many(choice(literalChunk, interpolation))`, or a
strictly better equivalent that retains the same typed segments. Do not scan,
sniff, regex-match, split, or re-parse text to find `@{…}`, `${…}`, `#{…}`, or
their exact-shape variants after grammar recognition.

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

## Branch And Sync Model

- `dev` is the single leading branch. It carries the current consolidated work (alpha readiness + the single-eval-emit cutover).
- Agents branch their worktrees from `origin/dev`, not from feature/backup branches.
- Sync work back to `dev` only when it is stable and tested. The sync gate is: core tests green, jess `ast-v2-production-ratchet` green, and jess `all-less` byte-identical (render corpus fully green).
- Agents do not push `dev` directly. The orchestrator (or a designated integration agent) performs the merge + push after the gate is confirmed green — never push red.

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

For active architecture queues, a "full pass" is a swath of adjacent queue work,
not one tiny cleanup. Keep working within the active lane until one of these is
true: the lane is drained, the next step has materially different semantics,
the next step needs user/product judgment, evidence says the approach is wrong,
or a failing test/debugging thread needs focused investigation. This applies to
binding/scope work and to broader performance/cutting work. Use small focused
tests while iterating, then run the expensive review/build/benchmark gates once
at the batch boundary. Commit and push the batch, not each trivial deletion.

During active unreleased architecture refactors, do not treat a method or
helper as protected API merely because it is currently exported, public on a
class, or reachable from tests. If the surface was introduced as transitional
refactor machinery, is undocumented, unreleased, or was not explicitly approved
as API, prefer deleting it over preserving no-op compatibility shims. Check
repo usage and downstream workspace consumers, but do not keep public-looking
registry/fallback wrappers solely because they exist today.

If two approaches both pass tests, prefer the one with better measured or
well-supported runtime speed. Use memory pressure as the next tiebreaker, and
use object-count reduction only as a proxy when it covers total runtime objects
and supports those goals.

## Performance Architecture

Before writing or reviewing code on a hot path (core tree/eval/render,
grammar/parser, extend/selector algorithms), work from the canonical perf
checklist:

- `docs/perf/V8-ARCHITECTURE.md` — the **9 invariants** ("before you write X,
  check Y") plus the regression-fixture catalogue of real incidents
  (`selectorAtoms` re-derivation, the `documentHasExtend` tree-walk, extend
  `.includes()` `O(n·m)`, polymorphic node shapes, the 20×7 `choice` fan-out,
  compose-integrity / stale-build degrade). Each invariant is backed by a
  mechanical gate where one exists; the gates run in
  `.github/workflows/pr-quality-gate.yml`.
- `docs/architecture/llm-quality-enforcement-design.md` — design of the enforcement
  layer (the `perf-architecture` skill, the `perf-architecture-reviewer` agent,
  and this cross-tool contract).

Load the `perf-architecture` skill before editing those paths; dispatch the
`perf-architecture-reviewer` before landing, and require **evidence per
invariant** from it — a bare "Approved" is not a valid review result. These
docs are the single source of truth; do not restate the invariant list in
tool-specific rules — point at `docs/perf/V8-ARCHITECTURE.md`.

## Semantics Architecture

Before deciding or changing **what Jess emits** — value serialization, selector
composition, dialect recognition, or any behavior visible in output CSS — work
from the canonical semantics checklist:

- `docs/architecture/SEMANTIC-INVARIANTS.md` — the **8 invariants** plus the
  incident catalogue (`emitValueInterp` precision split, the merge anchor
  flipped to less.js 4.x, parser-side selector joins, SCSS text-valued pseudo
  arguments). Each invariant carries a STATUS saying whether it is a gate, a
  buildable detector, a migration, or a reviewer obligation.
- `docs/architecture/core/DESIGN-DECISIONS.md` — the owner decision
  ledger. **A behavior with no ledger row is not a decided behavior.** Cite the
  SETTLED row a change relies on, or add an OPEN row.

Dispatch the `semantics-reviewer` before landing and require **evidence per
invariant**. A bare "Approved", "tests pass", or "matches less.js" is not a
valid review result — the last is forbidden as a justification by ledger rows
E1/E2/E5.

## Core Architecture Handoff

When working on the active evaluation-model refactor, use these docs as the canonical source:

- `docs/architecture/core/HANDOFF.md` for current architecture lanes,
  completion gates, the active queue, and verification
- `docs/architecture/core/AGGRESSIVE-CUTTING-REVIEW.md` and
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

<!-- BEGIN Guildhall MCP bridge -->
## Guildhall MCP Bridge

Jess is a Guildhall project. When Guildhall MCP tools are available, use them as the first source of project context before reading raw `.guildhall/` files.

Start with these MCP resources:

- `guildhall://project`
- `guildhall://project/tasks`
- `guildhall://project/artifacts`
- `guildhall://project/decisions`
- `guildhall://project/memory`

For artifact-scoped work, resolve IDs through `guildhall://project/artifacts` and prefer `guildhall.read_artifact` over guessing paths. If the task changes project state, use `guildhall.append_task_evidence` for audit notes when there is an active Guildhall task. If an external agent needs permission, tools, or host access it does not have, use `guildhall.create_capability_request` instead of silently working around the missing capability.

To start the local MCP server from this project root:

```sh
guildhall mcp serve .
```

If Guildhall MCP tools are not configured in the current agent session, say so explicitly and fall back to normal repository inspection. Do not imply that filesystem reads came from Guildhall MCP.
<!-- END Guildhall MCP bridge -->
