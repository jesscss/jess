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

**Goal prompt:** Complete the Jess binding / lookup focus queue by deleting
remaining registry-shaped fallback bridges and hot-path materialization where
frame/binding facts already prove the answer, preserving Less/Jess semantics,
updating `BINDING-LOOKUP-REMAINING.md` and aggressive self-prosecution
evidence, committing, pushing, and continuing until the active binding queue is
drained or a real semantic/design blocker is reached.

**Required docs:**

- `HANDOFF.md`
- `BINDING-LOOKUP-REMAINING.md`
- `BINDING-INDEX-PROPOSAL.md`
- `AGGRESSIVE-CUTTING-REVIEW.md`
- `PERFORMANCE-HANDOFF.md` before any speed claim or profile-backed lookup
  decision

**Active queue:** `BINDING-LOOKUP-REMAINING.md`.

**Current priority:** use modeled scope frames, child-surface facts, reference
handles, and per-key versions to delete fallback ladders, recursive child
rediscovery, object-heavy handle/result shapes, and public `Rules.find*`
materialization on ordinary reads.

**Boundaries:**

- Do not count a task complete because the old registry class is gone.
- A covered simple path must prove it avoids the fallback bridge, direct child
  scan, broad invalidation lane, and public materialization wrapper.
- Guarded/configured/imported surfaces may keep a bridge only when the dynamic
  uncertainty is explicitly modeled and tested.

**Stop rule:** stop when the active binding queue is drained, the next deletion
needs semantic judgment, focused tests expose an unmodeled Less/Jess behavior,
or profile/counter evidence shows the approach is wrong.

**Gates:** focused lookup/reference/mixin tests first, then `git diff --check`,
`pnpm run verify:aggressive-cutting-review`, binding tracker gates, and
`pnpm run verify:baseline -- --changed` for broad fixture exposure.

## Focus: Performance Evidence

**Goal prompt:** Refresh Jess core architecture performance evidence by running
the benchmark/profile protocol in `PERFORMANCE-HANDOFF.md` for the currently
selected implementation focus, recording only evidence-backed interpretations,
and returning a concrete next implementation target without making unsupported
speed claims.

**Required docs:**

- `HANDOFF.md`
- `PERFORMANCE-HANDOFF.md`
- the tracker for the selected implementation focus
- `AGGRESSIVE-CUTTING-REVIEW.md` if code changes are made

**Active queue:** no standalone code queue. Performance evidence selects or
checks a target for another focus.

**Boundaries:**

- Performance is a leash or evidence pass, not a reason to abandon the selected
  implementation focus.
- Only benchmarks/profiles can justify "faster"; tests and code inspection can
  justify "less machinery."
- Rejected experiments in `PERFORMANCE-HANDOFF.md` must not be retried without
  a new hypothesis or changed code shape.

**Stop rule:** stop after producing a current profile/benchmark interpretation,
a rejected experiment record, or one concrete implementation target for the
active focus.

**Gates:** the benchmark/profile commands named in `PERFORMANCE-HANDOFF.md`,
plus focused behavior tests for any code touched during the evidence pass.
