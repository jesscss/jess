# Core Architecture Focii

This file is the goal menu for Jess core architecture work. Pick one focus,
set it as the chat/Guildhall goal, and keep that focus until its stop rule
fires. `HANDOFF.md` is only the stable router; the focused tracker files own
queue detail and proof surfaces.

Use the spelling `focii` in task titles if that helps search continuity.

## How To Use A Focus

1. Choose exactly one focus before editing.
2. Paste or paraphrase the `Goal prompt` into the active goal.
3. Read the listed `Required docs`.
4. Work through the focus queue as a swath, not a micro-edit.
5. Stop only on the focus stop rule, a semantic blocker, failed evidence, or
   explicit user direction.
6. Update the focus tracker and `HANDOFF.md` self-prosecution block before
   commit.

Do not move active queues into `HANDOFF.md`. Do not rename a tracker as a
handoff. Completed history belongs in git, focused tracker rows, or
`PERFORMANCE-HANDOFF.md`, not in the router.

## Focus: Serialization / `writeSyntax`

**Goal prompt:** Complete the Jess serialization / `writeSyntax` focus queue by
closing the remaining node-family render/string transport rows in
`NODE-REWRITE-TRACKER.md`, preserving Less/Jess behavior, updating the tracker
and aggressive self-prosecution evidence, committing, pushing, and continuing
until the queue is drained or a real semantic/design blocker is reached.

**Required docs:**

- `HANDOFF.md`
- `NODE-REWRITE-TRACKER.md`
- `AGGRESSIVE-CUTTING-REVIEW.md`
- `PERFORMANCE-HANDOFF.md` before any speed claim or benchmark-leashed hot-path
  decision

**Active queue:** `NODE-REWRITE-TRACKER.md`.

**Current priority:** continue the repo-wide node serialization rewrite. Hot
unfinished rows include `Ruleset`, `Declaration`, `QueryCondition`, `Call`,
`Rules`, `AtRule`, `Reference`, `Mixin`, `Ampersand`, and `Interpolated`.

**Boundaries:**

- Direct syntax emission must live in `writeSyntax(options): void` or an
  equivalent node-local writer method.
- `render(...)` should select/evaluate the runtime value, then write directly.
- Public `toString(...)` / `toTrimmedString(...)` are cold wrappers only.
- Selector/equality cleanup, lookup redesign, copy/materialization cleanup,
  benchmark tuning, and broad smell sweeps are allowed only when required by
  the selected node-family row.

**Stop rule:** stop only when all serialization rows are complete, the next
remaining candidate needs semantic/product judgment, evidence rejects the
approach, a failing test requires focused debugging, or the remaining work is
explicitly benchmark-first design/tradeoff work.

**Gates:** focused node tests first, then `git diff --check`,
`pnpm run verify:aggressive-cutting-review`, tracker-specific gates, and
`pnpm run verify:baseline -- --changed` when touched fixtures or broad render
paths require it.

## Focus: Binding / Lookup

**Goal prompt:** Complete the Jess binding / lookup / registryless focus by
draining every remaining work cluster in `BINDING-LOOKUP-REMAINING.md`, not
just the currently visible checklist. Repeatedly reseed the active queue from
the remaining clusters, deleting registry-shaped fallback bridges, hot-path
materialization, unnecessary child scans, broad invalidation, and object-heavy
handle/result shapes where frame/binding facts already prove the answer.
Preserve Less/Jess semantics, update binding tracker evidence and aggressive
self-prosecution, commit, push, and continue until the binding completion
criteria are satisfied or a real semantic/design blocker is reached.

**Required docs:**

- `HANDOFF.md`
- `BINDING-LOOKUP-REMAINING.md`
- `BINDING-INDEX-PROPOSAL.md`
- `AGGRESSIVE-CUTTING-REVIEW.md`
- `PERFORMANCE-HANDOFF.md` before any speed claim or profile-backed lookup
  decision

**Active queue:** `BINDING-LOOKUP-REMAINING.md`.

**Current priority:** use modeled scope frames, child-surface facts, reference
handles, and per-key versions to close the full registryless family: direct
declaration/property lookup, scope-frame current cells, callable/namespace
reference-import paths, reference-handle slimming, fallback bridge deletion,
and final simple-read proof.

**Boundaries:**

- Do not count a task complete because the old registry class is gone.
- A covered simple path must prove it avoids the fallback bridge, direct child
  scan, broad invalidation lane, and public materialization wrapper.
- Guarded/configured/imported surfaces may keep a bridge only when the dynamic
  uncertainty is explicitly modeled and tested.

**Stop rule:** stop when the binding tracker has no remaining active cluster
and the completion criteria are satisfied, the next deletion needs semantic
judgment, focused tests expose an unmodeled Less/Jess behavior, or
profile/counter evidence shows the approach is wrong. An empty checklist is not
a stop condition if `Remaining Work Clusters` still names registryless
binding/lookup work.

**Gates:** focused lookup/reference/mixin tests first, then `git diff --check`,
`pnpm run verify:aggressive-cutting-review`, binding tracker gates, and
`pnpm run verify:baseline -- --changed` for broad fixture exposure.

## Focus: Performance Evidence

**Goal prompt:** Drive the Jess core architecture performance/cutting campaign
from the refreshed active target queue in `PERFORMANCE-HANDOFF.md` until Jess
exceeds Less 4.x speed on the canonical Less benchmark set with stable
wall-clock evidence. Do not hard-code the work to one tactic in the chat goal:
`PERFORMANCE-HANDOFF.md` owns what to do next, why that target is active, how
to measure it, and when to reseed. Run repeated benchmark-leashed
implementation rounds: refresh or read current evidence, choose the next target
from the active queue, make a coherent implementation cut, rerun the named
wall-clock benchmarks and CPU/profile/counter checks, keep correctness-passing
machinery reductions unless they materially regress, update the tracker,
commit, push, and continue. A measurement refresh may complete one pass, but
the performance goal itself is not complete until the Less 4.x comparison
target is beaten.

**Required docs:**

- `HANDOFF.md`
- `PERFORMANCE-HANDOFF.md`
- the tracker for the selected implementation focus
- `AGGRESSIVE-CUTTING-REVIEW.md` if code changes are made

**Active queue:** `PERFORMANCE-HANDOFF.md` owns the performance campaign state,
current evidence, rejected experiments, active target queue, and next measured
target. Each implementation round may temporarily select another focus tracker
for the touched code path, but it returns here for before/after evidence,
keep/revert decision, and queue reseeding.

**Boundaries:**

- Performance is a leash or evidence pass, not a reason to abandon the selected
  implementation focus.
- Only benchmarks/profiles can justify "faster"; tests and code inspection can
  justify "less machinery."
- Rejected experiments in `PERFORMANCE-HANDOFF.md` must not be retried without
  a new hypothesis or changed code shape.
- Do not mark the performance focus or chat/Guildhall goal complete just
  because the current evidence pass produced a next target. That is only a
  pass boundary.

**Stop rule:** a single pass may stop after producing a current
profile/benchmark interpretation, a rejected experiment record, or one concrete
implementation target for the active focus. The overall performance campaign
stops only when Jess beats Less 4.x on the canonical Less benchmark comparison
with stable/usable wall-clock evidence, or when the next step needs explicit
user/product judgment.

**Gates:** the benchmark/profile commands named in `PERFORMANCE-HANDOFF.md`,
plus focused behavior tests for any code touched during the evidence pass.
