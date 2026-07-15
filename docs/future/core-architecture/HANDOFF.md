> ⚠️ **The active cleanup queue is now [`CORE-CLEANUP.md`](./CORE-CLEANUP.md).** The
> per-focus trackers this doc references (SINGLE_FRAME_PLAN, NODE-REWRITE-TRACKER,
> PERFORMANCE-HANDOFF, BINDING-LOOKUP-REMAINING) were consolidated there; their history
> lives in git history. This doc is kept for its routing/guardrail context.

# Core Architecture Handoff

This is the stable router for Jess core architecture work. Keep it short: it
tells the next agent where to choose a focus, how to complete a pass, and where
progress is tracked. Do not rewrite this file just to switch focus; set the
chat/Guildhall goal from `archive/FOCII.md` instead.

## Focus Router

Choose exactly one active focus before editing. If the user names a focus,
follow that. If the request is ambiguous, infer from the branch and latest user
instruction, then record the chosen focus in the final response instead of
changing this router. Use `archive/FOCII.md` for the goal prompt, boundaries, stop rule,
and required docs.

- **Binding / lookup:** use `CORE-CLEANUP.md` for the active queue,
  remaining scope, progress notes, and completion gates. This stream owns registryless
  lookup, direct crawl/frame lookup, reference handles, live/current binding,
  fallback bridge deletion, and lookup profiles.
- **Serialization / `writeSyntax`:** use `CORE-CLEANUP.md` for the
  active node-family queue, historical row status, serialization contracts, and
  completion gates. This stream owns direct syntax/render emission, cold public
  string wrappers, render readback removal, and node-family row closure.
- **Performance evidence:** use `CORE-CLEANUP.md` for benchmark
  protocol, profile history, rejected experiments, and speed claims.
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

## Active Semantics: Compose Extension Surfaces

The current `dev` correctness lane includes one unresolved compose/extend
contract. `mutable` is placement-local but should propagate through nested
`@-compose` boundaries by default; an explicit protected boundary stops that
propagation. A different composition of the same module remains protected
unless it is also mutable.

`$extend` namespaces are immediate-boundary filters, not full nested namespace
paths. In `library|.box`, `library` is consumed when entering `library.jess`,
then `.box` is matched through its reachable mutable child modules. An internal
alias such as `foundation` remains available to extend statements written
inside `library.jess`; it is not required in the outer query. Bare `.box` is
the unfiltered search across all mutable surfaces accessible from the current
extend.

The implementation must land with focused tests for nested mutable propagation,
explicit protection barriers, placement-local behavior, immediate namespace
filtering, and bare-target lookup. Do not mark this contract complete from docs
alone.

## Completion Rules

When the user says `continue`, `do all queue items`, `complete the queue`, or
`full queue pass`, run an autonomous focus pass:

1. Snapshot `git status --short --branch`.
2. Read this router, `archive/FOCII.md`, and the chosen focus tracker.
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
belongs in git or `CORE-CLEANUP.md`, not in this router.

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

Then run the chosen focus gates from `CORE-CLEANUP.md`. Use its benchmark
protocol before making any speed claim. Use
`pnpm run verify:baseline -- --changed` when the touched area needs a broader
fixture gate. The current hook path has previously looped, so commit and push
with `--no-verify` after the explicit gates pass.

## Current State — the single-eval-emit cutover

The core-architecture work is mid **single-eval-emit cutover**: collapse
eval→output-tree→visitor→serialize into one downward spine (`emit-walk.ts`),
folding each node shape off the eval path until the monolith can be deleted.

Live boards (kept current — read these first, not this router, for what's landed
and what's in flight):

- **`CUTOVER-STATUS.md`** — compact at-a-glance board: what's landed on the spine
  (extend modes, mixin surface-sink, `@layer`/`@scope`, conditional/scope-mutating
  decls, root-level calls, …), what's in flight, what's gated.
- **`CUTOVER-CHECKLIST.md`** — the executable phased plan (P0–P5) + the HARD RULES
  every cutover agent works under (drive to the target, no permanent eval fallback).
- **`UNIFIED-EVAL-EMIT-DESIGN.md`** — the settled architecture spec both boards
  point to (one pass, live-frame threading, extend PLAN/SOLVE/EMIT, flag-walk
  endgame). This is the SPEC; the current eval code is what's being torn out.

Other active docs in this dir:

- **`CORE-CLEANUP.md`** — the single live @jesscss/core cleanup queue (binding/lookup,
  serialization, node field budgets, perf evidence). Focus router above points here.
- **`AST-FROM-SCRATCH-DESIGN.md`** — isolated greenfield fast-AST experiment:
  non-1:1 semantic shapes are allowed, CSS output is the acceptance oracle,
  dynamic behavior has explicit legacy escapes, and debug projection remains
  cold. The experiment is not production-wired until its stage-separated
  comparisons prove a useful end-to-end path.
- **`PARSER-RECOGNIZER-GAP.md`** — parser-generation attribution: the current
  Parseman recognizer still pays runtime structural protocol work. A separate
  compile-time-stripped recognizer POC now exists as unpublished local commit
  `c84d777`; Jess adoption remains deferred pending a consumable dependency and
  a fresh parser/render A/B. The generic zero-copy builder POC is now retained
  locally as Parseman commit `950e8b4` in
  `/private/tmp/parseman-zero-copy-builder-20260715`: it improved the generic
  structural benchmark `10.97→4.35 ms` with identical output, but regressed
  transient heap `1.95→7.17 MB` and cannot be adopted by Jess until the
  `compileLinkable`/fused host boundary is solved. No Jess speed claim exists.
- **`AGGRESSIVE-CUTTING-REVIEW.md`** — the patch-shape refusal checklist; run before
  committing changes to AST/eval/render/lookup/traversal/copy/output/metadata.
- **`STRINGS-OVER-NODES.md`** — active reference (producer flips still pending).
- **`ASSIGNABLE-CONTROL-NODES-PLAN.md`** — queued future feature track.

Tree2 status: the isolated no-class arena now passes `11/11` distinct focused
tests (`22/22` only in the root aggregate because Vitest runs the same file in
two projects) and
has exact output hashes on its exploratory static/mixed probes. It is not an
accepted performance change. The canonical raw `benchmark.less` route still
uses one whole-document legacy escape (`native=0`, `legacyRoot=1`), so its
timing cannot support a tree2 speed claim. Require an evaluated canonical route
or an explicit rejection before any production integration. The eight-file
implementation is staged but uncommitted in the isolated worktree; its
checkpoint was stopped by aggressive-cutting review because the unwired
`packages/core/src/tree2/` surface has no production cost-contract entries.
No hook bypass was used. The design record is durable here; the source remains
an explicitly preserved local experiment pending artifact review.

The evaluated mixed-root follow-up completed in the same worktree on
2026-07-15. It passed `30/30` focused tests and the exact `TREE2_BENCH` static
and mixed fixtures under both `3/5` and `20/45`; the mixed route produced `720`
native rulesets plus one legacy `@layer` island with no whole-document
fallback. Static hash: `b7d402d73e705d8cfcfa93e1d24045bee3b384531e7b68e85ae7d0b01b9b953b`;
mixed hash: `52866c029f75245a20900e21e591ce3f1f5c39f9436ddacda7c8f2d08c740836`.
The canonical evaluated route was rejected on exact-output mismatch (legacy
`450437656c359981eb751275e0ac56150f8ee02ddd9c8c98a306395f0061d319`, tree2
`d76a17d9ae71958b9e815d59acea93b0111e5fdda1d98b8605140acb0b7d869e`). Native
render timings exclude evaluation and adapter construction, so this is not a
performance claim or production AST result. Keep the worktree isolated until
canonical evaluated parity is repaired or the POC is explicitly retired.

## Q-40 — Less statement-dispatch proof (rejected, 2026-07-15)

The isolated `blockItem` reorder proof is complete and rejected. Moving
`Declaration` before `Ruleset` caused premature declaration successes and
stopped the canonical parse at byte `93,456` with `3` errors. The probe was
removed; no parser source change was retained. Full evidence, the adversarial
syntax matrix, and the no-op controls are recorded in
[`PARSER-RECOGNIZER-GAP.md`](./PARSER-RECOGNIZER-GAP.md), with the isolated
handoff at commit `0d6879277`.

## Q-40 — scope-frame empty pending-name vector (rejected, 2026-07-15)

A read-only flow/heap audit found `3,200` scope-frame creations and about
`2.32 MB` sampled allocation in `buildScopeFrame`; the current
`pendingDeclarationNames ?? []` creates a fresh empty array even when no
dynamic declaration name is pending. The canonical route also performs
`10,777` ordinary preparation/evaluation/normalization entries after one
extend-topology spine abort. The audit rejected duplicate lookup, source-order,
prototype-chain, `isNode`, callable-miss, OutputWriter-tail, and direct-writer
lanes as already owned or disproven.

The active bounded proof is to share an empty pending-name sentinel and
materialize a private array before the sole mutation path. Ownership is limited
to `scope-frame.ts` and focused ScopeFrame/reference/mixin tests. It must prove
empty/non-empty activation, total allocation or retained-heap impact, semantic
parity, exact output, and the canonical parse+render/render-only A/B before it
can land. The candidate failed semantic proof because `rules.ts` directly
mutates the array, contaminating later empty frames. Production code was
removed; only the regression test and rejection evidence in commit `6dc929a36`
remain. The trial regressed parse+render `244.214500→245.270125 ms` and
render-only `196.456375→198.914833 ms`, with no retained-heap improvement and
higher RSS. Detailed evidence is in [`CORE-CLEANUP.md`](./CORE-CLEANUP.md).

## Q-40 — compiler-root writer readback (completed isolated proof, 2026-07-15)

The OutputWriter/RenderBuffer audit found no safe new tail-bookkeeping cut; the
existing tail prototype remains rejected as noisy and more complex. It did
find a separate compiler-owned seam: the flat, source-map-off shared writer
already aliases `buffer.parts`, yet root evaluation still constructs a full
string through writer readback before public finalization joins those parts.
The audit observed `13,235` `getSince()` calls scanning `109,102` chunks and
`10,907` `trimEndSince()` calls.

The isolated proof restricted the change to a private writer-only root result
for that compiler-owned path. Caller-owned buffers, segmented buffers,
source-map paths, nested return contracts, and OutputWriter internals remain
unchanged. It reduced fallback `getSince()` readbacks from `3` to `1` and
whole-buffer reads from `2` to `0`, with exact focused output (`color: red;\n`)
and canonical output of `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
The isolated A/B was parse+render `237.066→236.102 ms` (`23/45` wins) and
render-only `197.764→198.235 ms` (`23/45` wins): no stable speed win, but the
readback/allocation simplification is behaviorally useful. Focused tests, full
core (`3,333` passed), builds, compiler reuse, public API, spine ratchet
(`137` passed), and all-less (`106` passed) passed. The candidate remains
unmerged at worker commit `763eb1535` because its aggressive-review registry
needs out-of-scope handoff/registry edits; no push was performed. Detailed
ownership and gates are recorded in [`CORE-CLEANUP.md`](./CORE-CLEANUP.md).

## Q-40 — parser-host duplicate Spanned[] (rejected, 2026-07-15)

The parser/CST audit confirmed that the shipping Less parser uses functional
Parseman; the old Chevrotain `consumeName` helper is not on the benchmark path.
The current Less host builds the same declaration raw children into `Spanned[]`
twice across the CSS/Less builder boundary. The bounded reuse proof eliminated
`1,938→0` duplicate conversions per external benchmark parse while Less
declaration builds remained `2,800`; parse median was neutral at
`57.274→57.359 ms`, with transient heap `46.24→45.54 MiB`. The canonical A/B
was parse+render `232.230→227.630 ms` (`23/45` wins) and render-only
`196.080→196.483 ms` (`24/45` wins), so no stable speed claim is allowed.
Output remained exact at `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
Focused parser suites, core `3,329`, baseline, spine `137/137`, all-less
`106/106`, and compatibility `62/62` passed, but aggressive review rejected
the lane because the parser builders lack required machine-readable cost
contracts and adding them was outside ownership. Rejection commit `9f35c2921`
retains no source or test changes.

## Q-40 — source-order normalization admission gate (accepted, 2026-07-15)

`Rules._finishSourceOrderEvaluation` now calls the normalization walk only when
the producer-owned `hasDirectChildRuleSurface` fact proves that a direct child
rule can have produced `callDeclarationOutput`. On the canonical profile this
covered `10,777` finishes: `7,853` scans were skipped and `2,924` remained
admitted. The cut is a structural work reduction with unchanged source-order,
lookup, and serialization behavior; it is not a generic cache or fallback.

Worker commit `5280032ba` is merged into `dev` as `bc00da8f2`. Focused tests,
core (`3,331` passed, `15` skipped, `2` todo), spine (`137/137`), all-less
(`106/106`), aggressive review, and ESLint passed. The worker's A/B was
parse+render `254.67→253.75 ms` and render-only `214.99→214.98 ms`, with
near-even wins; no stable speed claim is made. The current benchmark contract
still requires a fresh same-checkout measurement after the integration build.

## Q-40 — ordinary reference-evaluation transport proof (rejected, 2026-07-15)

Removing the temporary args object around `evaluateReferenceNode` passed
reference tests but produced no clear speed win and was reverted. The separate
scope-slot experiment had zero canonical activation and ran `3.6–4.2%` slower
on its synthetic activating workload. The remaining `43,167` ordinary
declaration cache misses are a direct-lookup/rules investigation target, not a
reason to add a generic lookup cache or prototype-chain scope. No worker source
change remains.

## Q-40 — shared flat-writer fragment proof (rejected, 2026-07-15)

The source-map-off shared-writer experiment could not prove caller-owned
trivia/reentrant state because `OutputWriter.restore()` clears queued
spacer/trivia state. Aggressive review also required an out-of-scope handoff
cost-contract update, so all temporary source and tests were reverted. Core
(`3,331` passed), spine (`137/137`), and all-less (`106/106`) passed; the raw
parse+render A/B was `259.712→250.248 ms` (`41/45` wins) and render-only
`207.468→205.590 ms` (`30/45` wins), but it is not an accepted performance
result. Output was exact at `135,794` bytes with the current Jess hash.

## Q-40 — imported/reference partial admission (rejected, 2026-07-15)

The worker tested provisional spine admission followed by a strict
post-import/reference gate. The canonical `.prose h1:extend(h1)` shadows the
`h1` branch in `h1, h2 > a > p, h3`; relaxing the gate then fails with
`EMIT contribution collapsed to empty (extender IS a target ancestor)`. The
strict boundary remains required, and production `emit-walk.ts` and
`spine-extend.ts` were unchanged.

The retained rejection test and focused coverage passed; full core was
`3,331` passed, spine `137/137`, all-less and aggressive review were green.
The worker recorded one spine attempt and `846` derives. Its branch-local
output was `133,983` bytes; current-dev no-op controls were exact at
`135,794` bytes and showed no speed signal. Do not reopen partial admission
without a source-order-aware reference/extend topology proof.

## Q-40 — extend/spine topology audit (no new performance lane, 2026-07-15)

The audit traced the canonical root admission through the extend-topology abort,
ordinary evaluation, registration, and final `processExtends()`. The benchmark
has `1,651` extend registrations, `42,926` classification probes with `42,847`
no-matches, and `39,605` apply calls with only `43` selector changes. Existing
append×extend, extend-serialized, compound-amp, root-admission, and fallback
worktrees already own or reject the relevant performance paths. A direct
same-layer `@layer` admission fixture is an unowned correctness/coverage idea,
not a Q-40 speed lane, so no duplicate worker was dispatched.

The current-dev append×extend revalidation is now also closed. On the canonical
fixture, `spineAttempts=1`, `ampAppend=7`, `extend=26`, and append-target
collisions were `0`; the append cases at lines `4254–4264` were already safely
foldable. The remaining abort comes from imported/reference topology at lines
`3986–4042`, not from compound or append-generated targets. The worker retained
only the test-only rejection record `91f4881d9`, with focused append/extend/
differential/spine coverage `157/157`, spine `137`, full core `3,329`, builds,
API Extractor, aggressive review, and all-less identity green. Its canonical
external output was `133,983` bytes with SHA-256
`adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`; the
20-warmup/45-pair numbers were baseline=0/candidate=0 controls, not a source
improvement. Do not reopen the stale append worktrees for this benchmark.

## Q-40 — fresh canonical control refresh (2026-07-15)

The current `dev` no-op control used the external `benchmark.less`, Node
v25.9.0 arm64, 20 warmups, and 45 alternating pairs. Parse+render medians were
`235.084→233.454 ms` with `20/45` candidate wins; render-only medians were
`200.186→203.527 ms` with `19/45` wins. Render-only standard deviations were
about `49.9/45.1 ms`, so these are a noise-floor refresh only, not a speed
claim. The current exact Jess output remains `135,794` bytes with hash
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.

## Q-40 — import-placement audit handoff

The fresh read-only retained-placement audit is recorded in detail in
[`CORE-CLEANUP.md`](./CORE-CLEANUP.md). Its four scale points report exact CSS
parity (`exact: true`) at 1×, 2×, 4×, and 8×. The corresponding `Ruleset`
placement-clone counts are 1000 / 2000 / 4000 / 8000; `varsByName` setter writes
are 2002 / 3004 / 5008 / 9016, with every write producing an empty map; and
`heapUsed` after render is about 25.07 / 29.56 / 32.33 / 37.15 MB. These are
heap-audit observations, not throughput or speed claims.

The lazy `EMPTY_DECLARATION_BUCKETS` sentinel is a rejected/no-op proof, not an
accepted Q-40 win. It passed scope-frame `18/18`, rules/reference `300/305`,
core build, and exact import-placement output; on the activating import fixture
at 1×, Map constructors were unchanged at `5,041→5,041`, Map sets differed only
`66,184→66,186`, and after-render heap was within noise. `varsByName` is usually
already defined on this path, so the sentinel is not a useful Q-40 cut.

The all-empty writes do not make `varsByName` directly removable:
`_stampRegistrationMaps` uses the empty `Map` as the registration-complete
sentinel, while `buildScopeFrame` uses undefined-versus-defined
`varsByName` to set `declarationsCovered`. A future cut must preserve both
states. The property-merge/sequence simplification remains a proposal, not an
implemented or rejected result. The tree-shaken exported-custom-property
dependency graph remains a future product/design direction, not proven runtime
work.

## Q-40 — terminal direct-lookup miss-state proof (rejected, 2026-07-15)

The isolated candidate reused a readonly terminal-miss sentinel in
`findWithinScopeSurface`, without adding a generic lookup index, cache, or
prototype-chain scope. Its semantic matrix, core suite, build, and all-less
corpus were green and the output was byte-identical at `135,794` bytes with
SHA-256 `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.

The fixed-contract A/B was neutral/noisy: parse+render `238.904→238.728 ms`
(`18/45` wins) and render-only `201.534→202.190 ms` (`24/45` wins). The
candidate also failed the hot-path cost-contract review. It was rejected and
left unmerged; only the evidence record was retained in commit `3056554`.

## Aggressive Cutting Self-Prosecution

- Latest pass: Q-40 EVALUATOR/SERIALIZER FRAME BOUNDARY — select the per-entry
  processor once after expansion. A container with no frame-bearing mixin,
  import, or loop expansion cannot have `spineFrame` entries, so the common body
  driver calls `processNodeInner` directly; frame-bearing expansions retain the
  existing `processNode` wrapper and async restoration. The bounded change is
  landed in current-dev commit `d211e8964` and is retained as a structural
  simplification, not a speed claim.
- Architecture surface: `packages/core/src/tree/util/serialize-helper.ts` and
  `packages/jess/test/q40-evaluator-serializer-frame-boundary.test.ts`. No
  writer, formatting, provenance, fallback, node field, or public API changed.
- Separation/duplication: one container-local function selection replaces one
  per-entry frame-presence branch/call ladder on the no-expansion path. Mixin,
  folded-import, and loop expansion sites conservatively mark the body
  frame-aware before the existing wrapper remains selected.
- Cumulative node weight: zero. No node, scope field, retained state, writer,
  map, set, or output tree was added.
- New traversal: none. The change removes a per-entry branch/call on the proven
  no-expansion path; expansion and source-order traversal remain unchanged.
- New node/materialization: none. The selected function reference is transient
  container-local state; no output or source tree is materialized.
- Render path: source-map off/on direct-body output and frame-aware mixin output
  are byte-identical through the caller-owned render buffer. The existing
  `processNode` save/restore remains the sole frame switch for expanded entries.
- Helper/API surface: no export or public method changed. The only retained
  runtime addition is `frameAwareEntriesOccurred` plus `processEntry` selection.
- Metadata mutations: none. No parent/source/provenance field or context frame
  is changed by the direct path.
- Review-flagged diff tokens: none. No loop, array helper, map/set, node
  construction, copy, routine error path, or generic cache was added.
- Evidence: the worker's focused tests passed `30/30`; its canonical counters
  were `1,644` direct-body drives, `0` frame-aware drives, `5,116` wrapper and
  inner entries, `4,085` declaration fallbacks, `13` stable leaves, and `0`
  rules-preview routes. Its branch-local output was `133,983` bytes with hash
  `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840` with
  source maps off/on. The worker's parse+render medians were
  `221.569709→220.894500 ms` and render-only medians were
  `189.014834→190.553792 ms`; paired statistics were noise, so this is retained
  as a structural simplification, not a speed win. Current-dev dependency
  builds and focused replay tests pass. Current-dev dependency builds,
  aggressive review, full core (`3,329` passed, `15` skipped, `2` deferred test
  declarations),
  `spine-production-ratchet` (`137/137`), and `all-less` (`106/106`) are green.
  The fresh same-checkout canonical A/B was parse+render
  `234.714→234.657 ms` (paired delta `-0.878 ms`, `24/45`) and render-only
  `198.801→198.271 ms` (paired delta `+2.695 ms`, `21/45`); output was exact at
  `135,794` bytes with hash
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
  The normal pre-commit lint check found only pre-existing diagnostics in
  `serialize-helper.ts` outside this hunk; the explicit gates passed before the
  narrowly scoped commit used `--no-verify`.
- Verdict: accepted and pushed to `dev` as a narrowly scoped structural
  simplification; no speed win is claimed.
- Hot-path cost contracts:
```json
[
  {
    "id": "serialize-helper-duplicate-declaration-prescan",
    "necessity": {
      "status": "proven",
      "factSource": "declaration names and merge/output metadata remain owned by the existing child-node surface",
      "rediscovery": "the existing serializer pre-scan remains unchanged and is not part of this frame-boundary cut",
      "carryForward": "the accepted singleton admission and duplicate counters remain the existing contract",
      "whyNotCarried": "the frame-boundary change is structurally separate and does not replace or bypass duplicate declaration handling"
    },
    "admission": {
      "predicate": "stable singleton node shape check",
      "cost": "cheap",
      "before": "collection and allocation"
    },
    "calls": 895,
    "admittedCalls": 895,
    "containers": 1644,
    "featureBearingContainers": 895,
    "itemsVisited": 4367,
    "featureItems": 91,
    "noFeatureAllocations": 0,
    "noFeatureMisses": 749,
    "admissionCalls": 1644,
    "admissionItemsVisited": 5116,
    "commonCaseProof": "counter test and benchmark.less 20-warmup/45-pair alternating benchmark",
    "benchmark": {
      "fixture": "benchmark.less",
      "warmup": 20,
      "pairs": 45,
      "parse-render": {
        "beforeMedianMs": 221.569709,
        "afterMedianMs": 220.8945,
        "medianDeltaMs": -0.986125,
        "wins": 25,
        "byteIdentical": true,
        "outputBytes": 133983,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840"
      },
      "render": {
        "beforeMedianMs": 189.014834,
        "afterMedianMs": 190.553792,
        "medianDeltaMs": 0.041792,
        "wins": 22,
        "byteIdentical": true,
        "outputBytes": 133983,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840"
      }
    },
    "verdict": "accepted"
  }
]
```

- Latest pass: Q-40 CHILD-RULE CONTAINER CLASSIFICATION FAST PATH + COMPATIBILITY TEST
- Architecture surface: `packages/core/src/tree/rules.ts` checks the concrete
  `Rules` instance before the existing `N.Rules` duck-typed fallback in
  `childRulesOf()`; `packages/core/src/tree/__tests__/child-rules-of.test.ts`
  proves the local subclass and foreign-protocol cases.
- Separation/duplication: no new lookup, cache, traversal, or serializer
  mechanism; the production change only orders the existing concrete and
  protocol checks.
- Cumulative node weight: no production field, map, set, wrapper, or placement
  state was added. The test constructs bounded compatibility fixtures only.
- New traversal: [loop/traversal] the test iterates six bounded child values;
  production `childRulesOf()` adds no traversal.
- New node/materialization: [materialized array/object] and
  [array spread/materialization] are test-only fixture setup; no production
  array, object, or node materialization was added by the fast path.
- Render path: existing child-container classification is preserved; no
  serializer/writer behavior changed, and canonical output bytes and hash are
  identical.
- Helper/API surface: no new export or package API; `childRulesOf()` remains
  module-local.
- Metadata mutations: none in production; the test only assembles its bounded
  parent fixture.
- Review-flagged diff tokens: [loop/traversal] [array spread/materialization]
  [materialized array/object] are bounded test-only setup; the production
  hunk contains no corresponding machinery.
- Evidence: focused compatibility test passed; core `3,329` passed with `15`
  skipped and `2` marked cases; build, baseline/all-less, spine `137/137`, Less alpha,
  ESLint, diff-check, and aggressive review passed. The exact 20-warmup,
  45-pair A/B was byte-identical at `133,389` bytes with SHA-256
  `39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c`;
  timing was modest and environment-sensitive, so it is not a causal speed
  claim.
- Verdict: accepted as a bounded classification work reduction; do not
  generalize it to a global `isNode` rewrite.
- Hot-path cost contracts:
```json
[]
```

- Latest pass: IMPORT-PLACEMENT STATE-CONSTRUCTION CUT — carry the existing
  closed-static `(multiple)` discard/admission result into first-use placement
  construction so a discarded placement does not allocate child-segment records
  or retain mapping state.
- Architecture surface: `packages/core/src/tree/import-style.ts` only. The
  placement `Rules` wrapper, shallow child array, source/frame wiring, and
  reentrant spine descent remain unchanged. No second recursive static check,
  side map, descriptor, fallback path, or new placement representation was added.
- Separation/duplication: the existing admission result is passed directly into
  state construction and materialization; it is not recomputed and no second
  recursive static-shape check was added.
- Cumulative node weight: discarded placements retain the existing shallow
  `children` array and required child copies, but allocate no child-segment
  array, segment records, or retained placement-state entry.
- New traversal: none. The existing `canDiscardSpinePlacementState` walk remains
  the sole admission walk; the construction loop is still a direct-child loop.
- New node/materialization: [materialized array/object] only the pre-existing
  shallow child array remains on the discarded path; conditional segment storage
  is omitted. Test-only fixtures are bounded and do not enter production.
- Render path: no serializer or render-to-node route changed. Child/frame wiring,
  output buffers, source maps, comments, variables, mixins, nested imports, and
  excluded shapes retain the existing route.
- Helper/API surface: no new exported helper or package API; existing mapping
  readers return `undefined` for the deliberately unretained state.
- Metadata mutations: no parent, source, frame, location, trivia, or source-map
  mutation was added.
- Review-flagged diff tokens: [node construction] test-only `Rules`/trivia
  fixtures and expected-error assertions; [side map/set] test-only trivia maps;
  [routine error control] test-only `try/finally` restores the spy and options;
  [materialized array/object] production retains only the pre-existing child
  array, with the segment array conditional. No new production machinery is
  represented by these tokens.
- Hot-path cost contracts:
```json
[]
```
- Render path and metadata: no serializer or render-to-node route changed; no
  parent, source, frame, location, trivia, or source-map mutation was added.
  Dynamic, comment-bearing, source-map, nested, mixin, and excluded shapes retain
  the existing mapping state.
- Evidence: focused import coverage was `95 passed, 1 skipped`; core/plugin/Jess
  builds and API Extractor passed; spine ratchet `137/137`; all-less `106/106`;
  aggressive review, ESLint, and diff check passed. At 1×/2×/3× the candidate
  retained zero states/segment arrays/segment records versus `500/1000/1500`
  transient segment records in the control, with exact CSS bytes
  `28,462/56,924/85,386`. Canonical output remained exact at `133,389` bytes,
  hash `39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c`.
  Timing was mixed (`219.872→223.442 ms` parse+render and
  `189.103→187.030 ms` render-only), so this is an allocation/retained-state
  cut, not a speed claim.
- Verdict: accepted as a bounded allocation cut; do not broaden the admission
  predicate or claim canonical throughput improvement.

- Latest pass: MERGE-OUTPUT SURFACE CARRY — delete recursive merge-admission
  rediscovery by carrying an explicit presence fact from the producer seams to
  `Rules._finishSourceOrderEvaluation`.
- Architecture surface: `packages/core/src/tree/rules.ts` owns the packed
  `R_HAS_MERGE_OUTPUT_SURFACE` bit, `hasCarriedMergeOutputSurface`, the direct
  constructor/derive/append/replacement paths, and the bounded
  `refreshMergeOutputSurface()` repair. The named carry-forward support seams
  are `apply.ts`, `control.ts`, `import-style.ts`, `util/callable-surface.ts`,
  `ruleset.ts`, `at-rule.ts`, and `call.ts`.
- Separation/duplication: the old finish-time recursive scan is removed. The
  coalescer remains the sole owner of merge semantics; the new bit is only an
  admission fact. The declaration source fact is `Declaration.options.normalizedFromAssign`;
  `Mixin`, `Ruleset`, and `AtRule` are definition/scope boundaries and are not
  searched through by a parent-surface admission.
- Cumulative node weight: one boolean was added to the already packed
  `Rules.rulesFlags` integer, not as a new own property, map, WeakMap, array, or
  placement record. The flag is part of `R_DERIVED_STATE_MASK` and is copied or
  recomputed with the existing Rules lifecycle.
- New traversal: [loop/traversal] the recursive per-admission scan is deleted.
  Direct-child loops remain in the constructor and `derive()` because those are
  the producer boundary where the fact is first available. `refreshMergeOutputSurface()`
  is a bounded repair only after destructive whole-array replacement; it is not
  called by the ordinary admission path. No parent walk or child-surface
  rediscovery was added.
- New node/materialization: [materialized array/object] no normal-path array,
  map, set, wrapper, or node is introduced. [side map/set] none. Existing
  `Rules` arrays are updated in place at their actual insertion/replacement
  seams.
- Render path: [render path] coalescing, serialization, writer ownership,
  source-map behavior, and output bytes are unchanged. The live merge fixture
  still reports `admissionCalls=4`, `admissionItemsVisited=0`, `admittedCalls=3`,
  `calls=3`, `featureBearingContainers=3`, and `noFeatureMisses=1`.
- Helper/API surface: [helper/API surface] `hasCarriedMergeOutputSurface` is
  module-internal runtime plumbing; no package export or public API changed.
  The verifier gained an explicit, named support-file coverage mode so producer
  seams cannot be mistaken for unrelated evaluator surfaces.
- Metadata mutations: [metadata mutations] no new parent/source/location
  mutation. Existing `adopt()` calls remain where the owning array already
  requires them. An initial attempt to set the bit in `adopt()` was rejected
  because adoption can precede insertion and caused false positives; that code
  was removed, and the bit is now set only after actual insertion/replacement.
- Review-flagged diff tokens: [loop/traversal] direct producer loops and bounded
  destructive-rewrite repair are accounted for above; the deleted recursive
  admission walk is the net traversal reduction. [inherit/adopt/frozen] existing
  adoption is preserved, while the unsafe adopt-time flagging was removed.
  [parent/source mutation] none added. [materialized array/object] and
  [side map/set] none in production. [node construction] none.
- Evidence: the fresh runtime profile reports `admissionCalls=10,777`,
  `admissionItemsVisited=0`, `admittedCalls=15`, `calls=15`,
  `featureBearingContainers=15`, `noFeatureMisses=10,762`, and
  `noFeatureAllocations=0`; the pre-cut profile visited `69,901` admission
  items. Focused declaration/tree/live-merge tests pass. The exact 20-warmup,
  45-pair A/B is byte-identical: parse-render `236.04→234.38 ms` with
  `21/45` wins and paired-delta median `+2.41 ms`; render-only
  `202.71→203.00 ms` with `24/45` wins and paired-delta median `−0.31 ms`.
  These are neutral/noisy measurements, not a speed claim. Output is 135,794
  bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
- Verdict: accepted — explicit producer fact carried, recursive rediscovery
  deleted, byte identity held, and the cut is accepted as an allocation/pass
  reduction rather than a canonical benchmark win.
- Hot-path cost contracts:
```json
[
  {
    "id": "rules-merge-coalescing",
    "necessity": {
      "status": "proven",
      "factSource": "Declaration.options.normalizedFromAssign explicitly identifies merge assignments at construction/evaluation boundaries",
      "rediscovery": "The old hasMergeOutputSurface recursively scanned every Rules surface and child Rules node at finish time",
      "carryForward": "Rules.rulesFlags carries one merge-presence bit; constructors, derive, actual insertions, replacements, and destructive-array repair update it",
      "whyNotCarried": "This pass establishes the missing producer-to-consumer carry path; bounded refresh remains only after destructive whole-array rewrites"
    },
    "admission": {
      "predicate": "hasMergeOutputSurface(rules)",
      "cost": "cheap",
      "counter": "admissionCalls",
      "workCounter": "admissionItemsVisited",
      "maxItemsPerContainer": 8,
      "before": "collection and allocation"
    },
    "calls": 15,
    "admittedCalls": 15,
    "admissionCalls": 10777,
    "admissionItemsVisited": 0,
    "containers": 10777,
    "featureBearingContainers": 15,
    "itemsVisited": 16730,
    "featureItems": 27,
    "noFeatureAllocations": 0,
    "noFeatureMisses": 10762,
    "commonCaseProof": "fresh canonical profile plus live merge fixture counter test",
    "benchmark": {
      "fixture": "benchmark.less",
      "warmup": 20,
      "pairs": 45,
      "parse-render": {
        "beforeMedianMs": 236.04,
        "afterMedianMs": 234.38,
        "medianDeltaMs": 2.41,
        "aggregateMedianDeltaMs": -1.66,
        "wins": 21,
        "byteIdentical": true,
        "outputBytes": 135794,
        "outputSha256": "9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc"
      },
      "render": {
        "beforeMedianMs": 202.71,
        "afterMedianMs": 203.00,
        "medianDeltaMs": -0.31,
        "aggregateMedianDeltaMs": 0.29,
        "wins": 24,
        "byteIdentical": true,
        "outputBytes": 135794,
        "outputSha256": "9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc"
      }
    },
    "verdict": "accepted"
  }
]
```

- Latest pass: PROOF-OF-NECESSITY / NO-REDISCOVERY GATE — an admission is no
  longer reviewable merely because it avoids a downstream expensive pass.
- Architecture surface: `necessity` metadata in the machine-readable cost
  registry plus validation in `scripts/verify-aggressive-cutting-review.mjs`;
  focused regression coverage is `6/6`. No Jess runtime source changed.
- Separation/duplication: the gate adds review-time metadata and validation
  only; it adds no runtime field, scan, counter, or benchmark path.
- Cumulative node weight: zero. Registry and audit records are documentation
  and verifier data, never runtime AST state.
- New traversal: none in production; the verifier checks four fact-flow
  strings and one status per contract.
- New node/materialization: none in production.
- Render path: unchanged; no output behavior or performance claim applies.
- Helper/API surface: private verifier validation only; no package API changed.
- Metadata mutations: none.
- Review-flagged diff tokens: review-time JSON/prose only; no production token.
- Evidence: the focused verifier suite passes `6/6`; the gate now requires each
  contract to name its authoritative fact, rediscovery action, carry-forward
  location, and reason for non-carrying. The merge admission is explicitly
  marked `audit-required` because its scan has not earned a necessity proof.
- Verdict: accepted as process hardening. The full AST-to-serialization action
  audit is now the primary Q-40 lane; “avoids a more expensive pass” is not a
  sufficient justification without total-work evidence.

- Latest pass: BUILD-FRESH EXECUTABLE-EVIDENCE GATE — stop review tooling from
  accepting profile output produced by stale ignored `lib/` artifacts.
- Architecture surface: `scripts/precommit-changed-checks.mjs` now runs the
  affected upstream baseline/runtime dependency build before the full
  aggressive-cutting verifier;
  staged pre-commit review passes `--skip-executable-evidence` and retains the
  static contract, source-surface, and danger-token checks. The verifier's
  skip flag is explicit and does not weaken the upstream/push gate.
- Separation/duplication: this is review workflow ordering only. It adds no
  runtime flag, cache, traversal, node state, benchmark path, or generated
  output dependency to Jess.
- Cumulative node weight: none.
- New traversal: none in production; the pre-push path only reorders existing
  build and review commands.
- New node/materialization: none in production. The skip option is a review
  process argument.
- Render path: unchanged; no output or performance claim applies.
- Helper/API surface: one explicit verifier CLI option and one pre-commit
  option pass-through; no package export changed.
- Metadata mutations: none.
- Review-flagged diff tokens: none in production; command ordering and CLI
  plumbing only.
- Evidence: a complete clean runtime-chain build still reports
  `admissionCalls=10,777`, `admissionItemsVisited=69,901`,
  `admittedCalls=15`, `calls=15`, and `featureBearingContainers=15` on the
  canonical fixture. The stale result was the earlier `10,420` actual
  coalescer-call figure from before the presence gate; it is not the current
  admission count. The proposed per-admission counter was rejected because
  its candidate build changed the observed path and did not provide trustworthy
  same-source semantics. The focused verifier suite passes `5/5`, changed
  scripts pass `node --check`, and the explicit static-only verifier mode
  passes.
- Verdict: accepted as review-workflow hardening. Live executable evidence is
  now only admissible after the upstream build gate; the legacy merge contract
  remains open for re-targeting to a live feature-specific path.

- Latest pass: RUNTIME ADMISSION-WORK EVIDENCE — make rare-pass contracts
  measure the admission itself, not only the expensive operation that follows.
- Architecture surface: `packages/core/src/tree/rules.ts` now exposes
  profile-only counters for merge admission calls, visited admission items,
  admitted calls, and actual coalescer calls; `scripts/profile-less-benchmark.mjs`
  reports those counters and has a blocking `--assert-merge-contract` mode.
  `scripts/verify-aggressive-cutting-review.mjs` requires every registered
  contract to name its admission/work counters and a bounded work budget.
- Separation/duplication: the counters are inactive unless the existing global
  profile hook is installed; no production cache, flag, traversal, or second
  merge implementation was added. The executable evidence command now checks
  the live built path instead of trusting hand-entered counter prose alone.
- Cumulative node weight: none. No Node, Rules field, scope state, output
  buffer, map, or retained diagnostic object was added to the normal runtime.
- New traversal: no new production traversal. The existing merge admission's
  traversal is now measured; the canonical profile recorded `10,777` admission
  calls and `69,901` visited admission items, which proves that the prior
  “cheap” label concealed non-trivial scan work and is a follow-up target.
- New node/materialization: none in production. Profile counters are scalar
  increments in an opt-in global record; review JSON is transient evidence.
- Render path: the public `Compiler.render()` parity probe remains
  `133,983` bytes with SHA-256
  `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`.
  The new same-process build comparator's direct tree transport is separately
  byte-identical at `135,794` bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
  This diagnostic/guard change makes no speed claim.
- Helper/API surface: no package export or runtime API. The profile-only
  counter key is an existing diagnostic convention, and the verifier's
  contract helpers remain review-time only.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal] refers to the pre-existing
  admission scan being measured; [materialized array/object] is limited to
  profile JSON and verifier records. No new normal-path danger-token category
  was added.
- Evidence: `mergeStats` on the canonical fixture reports
  `admissionCalls=10,777`, `admissionItemsVisited=69,901`,
  `admittedCalls=15`, `calls=15`, `featureBearingContainers=15`, and
  `noFeatureMisses=10,762`; the executable `--assert-merge-contract` check
  passes the `8`-items-per-inspected-container budget. The same-process
  before/after build A/B measured parse-render `223.362→226.763 ms` medians
  (paired median delta `+0.035 ms`, `22/45` wins) and render-only
  `183.157→183.461 ms` (paired median delta `−0.176 ms`, `25/45` wins), with
  identical direct-tree output bytes/hash. Core build passed, and the verifier
  regression suite plus aggressive review are the remaining commit gates. No
  performance claim applies.
- Hot-path cost contracts:
```json
[
  {
    "id": "rules-merge-coalescing",
    "necessity": {
      "status": "audit-required",
      "factSource": "Declaration.options.assign and normalizedFromAssign explicitly identify merge assignments",
      "rediscovery": "hasMergeOutputSurface recursively scans every Rules surface and child Rules node",
      "carryForward": "Rules construction or evaluation can carry one merge-presence bit with the surface",
      "whyNotCarried": "No evidence currently justifies rediscovering explicit declaration metadata at every finish step"
    },
    "admission": {
      "predicate": "hasMergeOutputSurface(rules)",
      "cost": "cheap",
      "counter": "admissionCalls",
      "workCounter": "admissionItemsVisited",
      "maxItemsPerContainer": 8,
      "before": "collection and allocation"
    },
    "calls": 15,
    "admittedCalls": 15,
    "admissionCalls": 10777,
    "admissionItemsVisited": 69901,
    "containers": 10777,
    "featureBearingContainers": 15,
    "itemsVisited": 16730,
    "featureItems": 27,
    "noFeatureAllocations": 0,
    "noFeatureMisses": 10762,
    "commonCaseProof": "executable canonical profile: admission work and coalescer call counters",
    "benchmark": {
      "fixture": "benchmark.less",
      "warmup": 20,
      "pairs": 45,
      "parse-render": {
        "beforeMedianMs": 223.362,
        "afterMedianMs": 226.763,
        "medianDeltaMs": 0.035,
        "wins": 22,
        "byteIdentical": true,
        "outputBytes": 135794,
        "outputSha256": "9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc"
      },
      "render": {
        "beforeMedianMs": 183.157,
        "afterMedianMs": 183.461,
        "medianDeltaMs": -0.176,
        "wins": 25,
        "byteIdentical": true,
        "outputBytes": 135794,
        "outputSha256": "9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc"
      }
    },
    "verdict": "accepted"
  }
]
```
- Verdict: accepted as diagnostic/review hardening, with the measured
  admission scan explicitly reopened as the next optimization target. A future
  “cheap” admission cannot land without live counter evidence and a bounded
  admission-work assertion.

- Latest pass: ADMITTED-CALL COUNTER RELATION — make the cost contract reject
  an expensive operation whose call count outruns the cheap admission that
  supposedly justified it.
- Architecture surface: `parseCounterRelation`,
  `evaluateCounterRelation`, and the registry/audit validation in
  `scripts/verify-aggressive-cutting-review.mjs`, with regression coverage in
  `scripts/__tests__/verify-aggressive-cutting-review.test.ts`. No Jess runtime
  source changed.
- Separation/duplication: the check is generic review-time arithmetic over
  declared counters; it adds no runtime instrumentation and no second
  benchmark harness. The coalescer contract now states `calls <= admittedCalls`
  and `admittedCalls <= featureBearingContainers`.
- Cumulative node weight: zero. Test records and verifier-local counter values
  are not runtime nodes, frames, caches, or output state.
- New traversal: none in production. The verifier parses declared relation
  strings and compares scalar record fields.
- New node/materialization: none in production. The new test builds only small
  JSON-like records for the review helper.
- Render path: unchanged. This is a pre-commit review failure, not a render
  branch or runtime admission mechanism.
- Helper/API surface: one private relation parser/evaluator pair is exported
  only for focused verifier tests; no Jess package API changed.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal] and [materialized array/object]
  are review/test bookkeeping only; no production hot-path category was added.
- Evidence: the focused verifier tests pass `2/2`; the negative case rejects
  `calls=10,000, admittedCalls=0, featureBearingContainers=0`, while the
  consistent admitted chain passes. `node --check`,
  `pnpm run verify:aggressive-cutting-review`, and `git diff --check` pass.
  No performance claim applies.
- Verdict: accepted as a review-system hardening pass; future expensive-call
  contracts cannot omit the admission-to-feature counter relation.

- Latest pass: SOURCE-SURFACE COST CONTRACT OWNERSHIP — refine the hot-path
  review gate from file-level ownership to changed-hunk ownership, allowing
  multiple disjoint contracts in a hot file while failing closed when a hunk
  matches none or more than one registered surface.
- Architecture surface: `scripts/verify-aggressive-cutting-review.mjs`
  (`changedHunks`, `contractsForChangedHunk`, and the production coverage
  checks) plus the registry rule in
  `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md`. No Jess
  runtime, parser, AST, evaluator, lookup, writer, or output source changed.
- Separation/duplication: the verifier reuses the existing Git diff and
  registry; it adds no runtime counters, source-tree walk, cache, or second
  benchmark path. Contract identity is now the named caller/operation surface,
  not the entire file.
- Cumulative node weight: zero. All arrays/sets are review-time bookkeeping;
  no Node, frame, placement, output, or retained benchmark state changed.
- New traversal: review-time parsing of unified-diff hunks only. No production
  traversal, parser work, eval work, or render work was added.
- New node/materialization: none in production. The verifier materializes only
  short-lived hunk strings and contract-match sets while reviewing a patch.
- Render path: unchanged. A source hunk cannot inherit an unrelated contract's
  audit record or executable evidence merely because both changes share a file.
- Helper/API surface: private verifier helpers only; no package export or Jess
  runtime API was added.
- Metadata mutations: none. The verifier reads Git/source/Markdown state only.
- Review-flagged diff tokens: [loop/traversal] and [materialized array/object]
  are review-time hunk bookkeeping, not production runtime changes.
- Evidence: `node --check scripts/verify-aggressive-cutting-review.mjs`,
  `git diff --check`, and `pnpm run verify:aggressive-cutting-review` pass.
  A temporary unrelated `rules.ts` comment hunk was rejected with
  `does not touch any registered source surface`; the probe was removed.
  No performance claim applies.
- Verdict: accepted as review-system hardening; future changes in `rules.ts`
  must register and measure their own disjoint surface instead of inheriting
  the merge-coalescer contract.

- Latest pass: CANONICAL BENCHMARK EVIDENCE CONTRACT — require every changed
  production hot-path contract to record both parse+render and render-only
  same-checkout A/B medians, exact 20 warmups/45 alternating pairs, wins, and
  byte count/hash parity before the change can pass review.
- Architecture surface: review-time `validateCostContractRegistry` and
  `validateCostAuditRecords` in `scripts/verify-aggressive-cutting-review.mjs`.
  No Jess runtime source, parser, AST, evaluator, lookup, writer, or output
  path changed.
- Separation/duplication: the verifier extends the existing cost-contract
  record; it does not add a second benchmark harness or runtime measurement
  pass. Focused tests remain behavior evidence, while the canonical A/B record
  is explicitly required for performance claims.
- Cumulative node weight: zero. No runtime node, frame, cache, side table,
  buffer, or retained benchmark state was added.
- New traversal: review-time validation of two phase records only; no production
  traversal or parser/eval/render work was added.
- New node/materialization: none in production. The JSON record is handoff
  evidence, not runtime data.
- Render path: unchanged. The gate now rejects a production hot-path change
  that omits either benchmark phase or output parity evidence.
- Helper/API surface: no runtime helper or package API; existing verifier
  validation only.
- Metadata mutations: none. The verifier reads Markdown JSON and Git/source
  state only.
- Review-flagged diff tokens: [loop/traversal] is review-time record checking;
  no production danger-token category was added.
- Evidence: current canonical control refresh on `benchmark.less` was
  parse+render `221.24ms` baseline versus `222.02ms` env-toggle candidate
  (median delta `+1.51ms`, `21/45` wins), and render-only `195.46ms` versus
  `196.35ms` (median delta `+1.51ms`, `21/45` wins). These are neutral controls,
  not code A/B or speed claims. `node --check`, `git diff --check`, and the
  aggressive review passed after the guard was added.
- Verdict: accepted as review-system hardening; future runtime changes must
  provide actual before/after values and parity rather than copying this
  illustrative zero-valued documentation example.

- Latest pass: GUARDED CONTRACT-HUNK OWNERSHIP — require a changed production
  hot-path hunk to touch the caller, expensive operation, or admission guard
  named by its one-file cost contract; a broad file-level contract cannot cover
  an unrelated evaluator/serializer edit.
- Architecture surface: review-time `validateChangedContractSurface` in
  `scripts/verify-aggressive-cutting-review.mjs`, with the declarative rule in
  `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md`. No Jess runtime
  source, node, evaluator, lookup, writer, or parser changed.
- Separation/duplication: the check reuses the existing registry and Git diff;
  it adds no runtime counter, side table, or duplicate production traversal.
- Cumulative node weight: zero. No node, frame, AST field, output buffer, or
  retained review artifact was added to the runtime.
- New traversal: review-time registry iteration only. It scans three existing
  source anchors per changed contract and runs outside parse/eval/render.
- New node/materialization: none in production. Review diagnostics use the
  existing strings/arrays only; no runtime node or materialized output shape is
  introduced.
- Render path: unchanged. The guard does not execute or alter rendering; it
  blocks a hot-path change before it can land without a surface-specific proof.
- Helper/API surface: one private verifier helper; no package export or runtime
  API was added.
- Metadata mutations: none. The verifier reads source text and Git diffs only.
- Review-flagged diff tokens: [loop/traversal] is review-time registry
  bookkeeping, not production traversal. No production danger-token category
  was added.
- Evidence: `node --check scripts/verify-aggressive-cutting-review.mjs`,
  `git diff --check`, and `pnpm run verify:aggressive-cutting-review` passed.
  The verifier now rejects a changed production file whose diff does not touch
  the guarded surface named by its contract; this closes the prior file-level
  ownership loophole. No performance claim applies.
- Verdict: accepted as a review-system hardening pass; keep the evaluator COW
  investigation separate and require its own contract if it changes
  `rules.ts` outside the merge-coalescer surface.

- Latest pass: DUPLICATE-DECLARATION SINGLETON ADMISSION — skip the duplicate-property count map and pre-scan when a rendered container has one stable, non-expanding child; retain the existing scan for dynamic expansion shapes and multi-item containers.
- Architecture surface: `packages/core/src/tree/util/serialize-helper.ts`, inside `serializeRulesContainerInternal`; the admission is the local `skipInitialDuplicateDeclarationScan` predicate before `recomputeDeclCounts()`.
- Separation/duplication: this does not add an index, cache, node flag, or second duplicate algorithm. It only proves that one stable child cannot contain two sibling declarations at this container level; `Call`, `StyleImport`, and `For` singleton shapes remain on the existing scan because they can expand.
- Cumulative node weight: zero. No node field, scope field, side table, output buffer, or retained cache was added.
- New traversal: stable singleton containers remove the old count-map allocation and one-item scan; all other containers retain the existing duplicate-property scan. The canonical counter probe measured `1,644` comparison containers, `749` stable singletons, `4,367` post-cut rules visited versus `5,116` before, and `895` count-map allocations versus `1,644` before.
- New node/materialization: none. The existing `Map`/`Set` state remains lazy and is created only for containers that still need duplicate analysis or duplicate recording.
- Render path: canonical/no-repeat/repeated-property output probes remained byte-identical in the worker proof (`133,983`, `58`, and `54` bytes respectively). Full candidate core tests passed `3,326` with `15` skipped; the existing suite status was unchanged. The agreed `benchmark.less` binary A/B with `20` warmups and `45` alternating pairs was parse+render `489.94ms → 491.11ms` (median delta `+2.76ms`, mean delta `-0.29ms`, `22/45` wins) and render-only `355.09ms → 354.10ms` (median delta `-0.75ms`, mean delta `+0.32ms`, `24/45` wins); both are neutral/noisy controls, not a speed claim.
- Helper/API surface: no export or public method was added; the new admission and counters are local to the existing serializer function.
- Metadata mutations: none. The admission reads the already-rendered child shape and does not attach fields, alter parents, or mutate source/provenance state.
- Review-flagged diff tokens: [side map/set] the existing duplicate-analysis maps are now allocated lazily after the singleton admission; no additional retained side state exists and the stable-singleton path allocates zero runtime maps.
- Evidence: canonical counter probe `containers=1,644`, `calls=895`, `admittedCalls=895`, `stableSingletonContainers=749`, `featureBearingContainers=895`, `rulesVisited=4,367` versus `5,116` pre-cut, `countMapAllocations=895` versus `1,644` pre-cut, `noFeatureAllocations=0`, `noFeatureMisses=749`, `repeatedPropertyContainers=91`; core build and full core tests passed; focused basic-render tests passed `9/9`; all performance samples above were collected from separate before/after binaries on the same machine.
- Hot-path cost contracts:
```json
[
  {
    "id": "serialize-helper-duplicate-declaration-prescan",
    "admission": {
      "predicate": "stable singleton node shape check",
      "cost": "cheap",
      "before": "collection and allocation"
    },
    "calls": 895,
    "admittedCalls": 895,
    "containers": 1644,
    "featureBearingContainers": 895,
    "itemsVisited": 4367,
    "featureItems": 91,
    "noFeatureAllocations": 0,
    "noFeatureMisses": 749,
    "stableSingletonContainers": 749,
    "countMapAllocations": 895,
    "preCutCountMapAllocations": 1644,
    "preCutItemsVisited": 5116,
    "commonCaseProof": "same-fixture duplicate-declaration counter probe and 20-warmup/45-pair binary benchmark",
    "verdict": "accepted"
  }
]
```
- Verdict: accepted as a measured no-feature allocation/traversal cut. It is not a canonical benchmark speed win; preserve the source-level guard and one-file contract before changing this pass.

- Latest pass: MERGE-COALESCER ADMISSION — gate the post-evaluation property-merge coalescer behind a cheap feature-surface scan before the coalescer's maps, declaration-item arrays, and recursive merge walk are entered.
- Architecture surface: `Rules._finishSourceOrderEvaluation` now calls the module-private `hasMergeOutputSurface(rules)` admission predicate before `_coalesceMergedDeclarations`. The predicate visits declarations and inline `Rules` output only; it deliberately does not cross `Ruleset` or `AtRule` scope boundaries.
- Separation/duplication: the admission scan is the same inline-output surface that the coalescer already owns and is a short-circuiting proof, not a second merge implementation, index, cache, or property lookup table. It prevents the feature-only pass from being entered on ordinary containers.
- Cumulative node weight: zero. No Node field, scope field, side table, output buffer, or retained cache was added. The no-feature path creates no coalescer `Map`/array state; the predicate is shared at module scope and creates no per-call closure.
- New traversal: one bounded, short-circuiting scan of direct children and inline `Rules` surfaces per finished container. It does not recurse through selector/at-rule scopes. The scan replaces 10,405 no-feature entries into the old coalescer; feature-bearing containers still run the existing coalescer unchanged.
- New node/materialization: none in production. The focused test uses `Nil`/list/sequence values and prototype spies only to prove the caller gate; no test-only shape is admitted by the runtime.
- Render path: canonical `benchmark.less` output remains 133,983 bytes with SHA-256 `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840` on the merged checkout. The worker's same-checkout parity probe remained byte-identical to its baseline. `+:`, `&,:`, `&_:` list/sequence behavior and mixin-output important state remain covered.
- Helper/API surface: two module-private admission helpers only; no export or public method was added. `_coalesceMergedDeclarations` remains the existing private feature pass.
- Metadata mutations: none. The guard reads normalized declaration assignment metadata and does not attach fields, alter parents, or mutate source/provenance state.
- Review-flagged diff tokens: [loop/traversal] is the bounded admission scan; [node construction] is test-only `Nil` setup; [generic defensive read] is absent; [side map/set] remains only inside the now-gated existing coalescer; [materialized array/object] is absent from production. The no-feature path adds no additional runtime allocation category.
- Evidence: focused Declaration coverage `80/80`; focused tree suites `231 passed, 5 skipped`; core and Less plugin builds passed; canonical compiler-path counter probe recorded **15** coalescer calls after the guard versus the pre-cut profile's **10,420** calls, with the same **15** feature-bearing containers and **10,405** no-feature containers. The canonical output length/hash above held. Same-checkout 20-warmup/45-pair A/B was parse+render `217.235→217.779 ms` (median delta `+0.456 ms`, `17/45` wins, `t=-0.40`) and render-only `184.05→183.90 ms` (paired median delta `+0.74 ms`, `16/45` wins, `t=-0.81`); these are neutral/noisy controls, not a speed claim.
- Hot-path cost contracts:
```json
[
  {
    "id": "rules-merge-coalescing",
    "admission": {
      "predicate": "hasMergeOutputSurface(rules)",
      "cost": "cheap",
      "before": "collection and allocation"
    },
    "calls": 10420,
    "coalescerCalls": 15,
    "containers": 10420,
    "featureBearingContainers": 15,
    "itemsVisited": 16730,
    "featureItems": 27,
    "noFeatureAllocations": 0,
    "noFeatureMisses": 10405,
    "commonCaseProof": "same-fixture counter probe: admission checks 10,420; coalescer calls 15; pre-cut calls 10,420",
    "verdict": "accepted"
  }
]
```
- Verdict: accepted as a measured no-feature pass/allocation cut. It is not a canonical benchmark speed win; keep the admission contract and source-level caller check in place for future coalescer changes.

- Latest pass: RARE-PASS ADMISSION/COST GUARDRAIL — the aggressive-cutting verifier now rejects a hot-path change that lacks structured admission evidence, common no-feature counters, and a source-level guard for the known merge-coalescing caller. The registry is now enforced as a closed-world, exactly-one-owner map for reviewed production files, and every registered caller/call/guard must still exist in its source file.
- Architecture surface: `scripts/verify-aggressive-cutting-review.mjs` owns review-time contract validation; `docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md` owns the declarative registry. No runtime node, evaluator, lookup, or writer surface changed.
- Separation/duplication: the registry describes recurring rare-pass obligations once, while the handoff record carries current-pass measurements. The verifier reuses the existing danger-token scan and adds no runtime instrumentation or duplicate production pass.
- Cumulative node weight: none. The change adds no Node field, frame state, cache, output buffer, or evaluator allocation. Review-time `Set`/`Map` values are verifier-local bookkeeping only.
- New traversal: [loop/traversal] verifier loops validate registry entries and audit records; they run at review time, not in Jess parse/eval/render. No production traversal is added.
- New node/materialization: [node construction] [side map/set] [materialized array/object] all matches are verifier-local arrays/sets/maps or diagnostic records; no production node or output materialization is introduced.
- Render path: none; the verifier does not execute or alter rendering. The known coalescing contract records the prior baseline evidence: 10,420 calls, 15 feature-bearing containers, 16,730 declaration visits, and 10,405 no-feature allocations/misses, with verdict `rejected` until a cheap presence guard is in the runtime caller.
- Helper/API surface: `readCostContractRegistry`, `validateCostContractRegistry`, `validateCostAuditRecords`, and `validateSourceChecks` are private verifier helpers. They add review-time checks only and no package API.
- Metadata mutations: none. The verifier reads Git diffs, source text, and Markdown JSON; it does not write node/source metadata.
- Review-flagged diff tokens: [loop/traversal] review-time contract loops only; [array helper] review-time diff/path slicing only; [node construction] [side map/set] verifier-local diagnostics and registry bookkeeping only; [routine error control] JSON/source validation errors are exceptional verifier failures, not runtime control flow; [materialized array/object] review-time records only. No production hot-path token was added.
- Hot-path cost contracts:
```json
[
  {
    "id": "rules-merge-coalescing",
    "admission": {
      "predicate": "cheap merge-output-surface presence check (missing in baseline)",
      "cost": "cheap",
      "before": "collection and allocation"
    },
    "calls": 10420,
    "containers": 10420,
    "featureBearingContainers": 15,
    "itemsVisited": 16730,
    "featureItems": 27,
    "noFeatureAllocations": 10405,
    "noFeatureMisses": 10405,
    "commonCaseProof": "counter profile: canonical no-merge container workload",
    "verdict": "rejected"
  }
]
```
- Evidence: `pnpm run verify:aggressive-cutting-review` and `git diff --check` pass after this record is added. The verifier also rejects duplicate contract ownership, contracts outside the reviewed production roots, and stale source-check metadata. The guardrail itself has no speed claim; it makes the known 10,405 no-feature allocation pattern fail review instead of being accepted as an unexplained local optimization.
- Verdict: accepted — review infrastructure strengthened; runtime coalescing remains an explicitly rejected/open target for the existing merge owner lane.

- Latest pass: IMPORT PLACEMENT STATE POC — omit only the retained `ImportPlacementState` association after a closed root literal `(multiple)` import has already populated its existing placement `Rules` surface.
- Architecture surface: `packages/core/src/tree/import-style.ts` gates the existing association write. The admitted source has only static declarations/rulesets; every root child is the same unescaped quoted literal `(multiple)` import. Parser-normalized `once: false` is accepted only as the redundant representation of that authored `(multiple)` option.
- Separation/duplication: existing placement `Rules`, frame parent, source provenance, shallow placement copies, registration, and render descent remain. No cache, compact descriptor, output segment model, or fallback bypass is introduced.
- Cumulative node weight: the admitted 18,463-byte source has 500 rules and 2,000 declarations. At 1/2/4/8 root placements, the cut removes 1/2/4/8 retained state records, 2/4/8/16 retained child/segment arrays, and 500/1,000/2,000/4,000 retained segment records. It removes no AST node, frame, or shallow clone.
- New traversal: [loop/traversal] the static-body walk and root-child confirmation run only after the import has passed the exact literal/root checks; non-candidates return before either walk. The static walk proves absence of dynamic/callable content, while the root walk proves no later root consumer.
- New node/materialization: no production node, frame, placement surface, clone, or output buffer is created. [materialized array/object] changed object/array syntax is confined to focused tests and benchmark-result fixtures; the production cut stops retaining pre-existing child/segment arrays.
- Render path: exact Less CSS bytes hold at 1/2/4/8 placements (28,462/56,924/113,848/227,696 bytes). Source maps, comments/trivia, references, variables, interpolation, calls, mixins, nested imports, at-rules, extends, postludes, non-literal/configured imports, and any later root property/callable consumer all retain the association. Canonical `benchmark.less` has zero admission; this makes no canonical speed claim.
- Helper/API surface: two private admission helpers only; no export or public runtime model changes.
- Metadata mutations: none. The placement still receives its existing parent/source wiring before the optional association write.
- Review-flagged diff tokens: [loop/traversal] is the bounded admission proof above. [array helper] is test-only repeated-import fixture construction. [node construction] is test-only parsing/assertion setup. [side map/set] is test-only trivia setup for the comment rejection. [materialized array/object] is test/benchmark fixture data only; production retains fewer arrays. No production side map, generic fallback cache, or alternate placement representation is added.
- Evidence: same-checkout baseline/candidate builds used three rounds of 10 warmups plus 15 timed samples per round for each scale and phase, with Less parity checked in every run; raw JSON is in `packages/jess/benchmark/import-placement-multiple/`. Candidate activation is 1/2/4/8 and retained association counts are all zero; baseline retains the counts stated above. Focused core import coverage is 117 passed with 1 skipped; spine is 137/137, including Less parity at every scale; full core is 3,325 passed with 15 skipped and 2 pre-existing deferred test declarations; all-less is 106/106; aggressive review and diff check pass.
- Verdict: retain only as an architectural/resident-allocation reduction. Remaining risk is intentionally confined to the conservative static/trivia/root proof; do not broaden to dynamic import behavior, frames, surfaces, clones, source maps, or canonical benchmark claims without separate semantic evidence.
- Import-placement diagnostic harness (2026-07-14): the existing measurement lane is now in current `dev` as `scripts/measure-import-placement.mjs`, with 1×/2×/3× fixtures and a `3/3` byte-identity test. A bounded run (`--warmup=3 --iterations=5 --rounds=2`) preserved hashes `968aae69fe6308b993af30ab888dcbec9b9d7b2715420a704df6ae42f7d0a2b6`, `6deb4dde14a98bfde5b9b268dd91029f5d4eedf23dfa0173aa096f5b64987609`, and `6139ff0d9d569f5269c3987387ca80161704d66f81fcfc2fd79aebc83d0ab592`; source-tree import hits were `0/1/2` after one miss, while placement/registration/spine calls scaled `1/2/3`, `2/4/6`, and `1/2/3`. This is diagnostic evidence only; the next implementation must prove a smaller placement/dependency record without changing dynamic import, fallback, source-map, mixin, or reentrancy semantics.

- Latest pass: RULESET ABSENT-METADATA CARRY.
- Architecture surface: `Ruleset` now creates and derives `guard` and `selectorBeforeExtend` only when their value is defined. Direct value reads remain unchanged, and a defined field is still copied to derived placement shells.
- Separation/duplication: construction carries semantic absence as absence; no alternate ruleset shape, side table, cache, or lookup branch was introduced.
- Cumulative node weight: canonical evaluation removes 8,310 undefined own slots across 4,155 live Rulesets. No field is added to nodes, placement records, frames, source trees, or output buffers.
- New traversal: none.
- New node/materialization: none. Constructor and derive continue to create the same Ruleset surfaces; this pass only omits two absent own properties.
- Render path: unchanged. Passing and failed guards retain their established eval behavior, and defined guard/selector-before-extend metadata remains owned by its source/derived shell.
- Helper/API surface: none.
- Metadata mutations: none. The focused `Object.hasOwn` assertions are test-only shape evidence; production uses direct reads only.
- Review-flagged diff tokens: [node construction] the three test-only `TypeError` assertions narrow the existing polymorphic derive return to a Ruleset before inspecting it; production constructs no node or new runtime object. [parent/source mutation] the two `sourceNode` comparisons are test-only proofs that derive keeps its existing canonical-source ownership; production adds no parent/source write. [generic defensive read] the six `Object.hasOwn` assertions are focused test-only own-slot checks; production uses no structural probe or defensive read.
- Evidence: focused Ruleset coverage is `61/61`; full core `3,323` passed (`15` skipped, `2` deferred); spine `136/136`; and all-less `106/106` byte identity passed. Same-checkout Node v25.9.0 alternating 20-warmup/45-pair A/B measured parse+render `239.68→239.63 ms` (median delta `-0.46%`) and render-only `211.78→207.04 ms` median but only `22/45` candidate wins and a mixed paired delta. This is a resident-slot reduction, not a speed claim.
- Verdict: accepted — keep absent Ruleset metadata absent at construction/derive; do not add retained environment switches or delete fields after semantic evaluation.

- Latest pass: DETACHED WRITER SOURCE-MAP GATE.
- Architecture surface: `renderNodeText` creates detached writers for declaration fallback, rules preview, and its general syntax fallback. It now passes `tracksSources` only when the caller explicitly requests `sourceMap: true`; the caller-owned writer and output-buffer ownership model are unchanged.
- Separation/duplication: this reuses the existing `OutputWriter` source-tracking switch rather than adding a second writer type, map cache, or render branch. Detached text remains a string; source-map callers retain their existing map-aware writer state.
- Cumulative node weight: no AST, placement, lookup, source-span, trivia, or output-buffer field is added. Maps-off detached writers no longer allocate source-tracking arrays that their returned text cannot use.
- New traversal: none. Existing syntax writes and source-map marking retain their control flow.
- New node/materialization: none in production. [node construction] the three changed `new OutputWriter(options.sourceMap === true)` sites create the same required detached writers; only their previously idle source-array mode is gated. The focused mapping test constructs an `OutputWriter`, `TreeContext`, and test tree solely to prove maps-on output remains correct.
- Render path: maps-off CSS is byte-identical at `133,983` bytes and the existing source-map segment/mapping path remains asserted when enabled. No chunks-to-buffer transport or reentrant/caller-buffer behavior changes here.
- Helper/API surface: no public API, helper, or node method was added.
- Metadata mutations: none. `sourceMap` selects the writer's pre-existing tracking mode; it does not write node metadata.
- Review-flagged diff tokens: [node construction] accounted above; no production Node construction occurs. The test-only tree/source construction is bounded evidence for source-map parity, not normal rendering machinery. [array helper] is the concurrent declaration-option serialization `Object.keys(...).filter(...)` change below: it remains a cold `showOptions` inspection path and does not enter detached-writer construction or rendering. [generator] appears only in the Q-40 evidence below as the Less property-merge terminology; this documentation update adds no generator, iterator, or runtime traversal.
- Evidence: maps-off detached writers with source tracking fall `14,903 → 10,805`; source-map arrays fall `59,612 → 43,220` (`-16,392`), while writer count stays `14,903`. Focused 69 tests, full core `3,321` passed (`15` skipped, `2` deferred), spine `136/136`, and all-less `106/106` passed. Same-checkout 15-sample timing was noisy (`262.23 → 265.15 ms` median), so this is accepted only as an allocation cut, not a speed claim.
- Verdict: accepted — gate source-map-only writer state on the source-map request, preserving maps-on mapping correctness and maps-off CSS bytes.

- Latest pass: PARSER DECLARATION/OPTION-BAG SLIM.
- Architecture surface: `packages/css-parser/src/builders.ts`, `packages/less-parser/src/builders.ts`, and `packages/jess-parser/src/builders.ts` now pass absent constructor options as `undefined`; `LessGrammar._buildLessDeclaration` stores assignment metadata only for `+:` and `+_:`; `serializeTypes` reads the own stored option record without invoking the lazy getter and preserves the public default `assign: ':'` view.
- Separation/duplication: parser construction carries absence at its source instead of allocating an empty record for `Node.options` to represent later. No compatibility wrapper or alternate declaration representation was added.
- Cumulative node weight: `Declaration` loses the default per-node `{ assign: ':' }` record; no node fields, caches, indexes, or runtime state are added.
- New traversal: none. Parser construction loses empty-object allocations; `serializeTypes` reads the own stored option record instead of invoking the lazy options getter.
- New node/materialization: none. No node, wrapper, side map, source span, parent, or provenance representation was added or moved.
- Render path: unchanged. The public benchmark output remains byte-identical (`671970c15aba5bf05472eeb1f02468f21411fdd20e203674d446775c51c4f9a5`, 130,772 bytes).
- Helper/API surface: no exported API or node method changed. `serializeTypes(..., { showOptions: true })` retains `Declaration assign: ':'` while remaining non-mutating.
- Metadata mutations: none.
- Review-flagged diff tokens: [array helper] `packages/core/src/tree/util/serialize-types.ts` retains its pre-existing cold `Object.keys(...).filter(...)` option serializer; this pass changes its input from `n.options` to the own stored option record, so AST inspection does not allocate a retained option bag. The temporary key array exists only when `showOptions` serialization is requested and does not enter parser construction or render. [node construction] the aggregate diff also includes the separate OutputWriter source-map gate: its `OutputWriter` and test `TreeContext` constructions are pre-existing construction sites or focused mapping-test fixtures; that gate only supplies the existing writer with its already-supported source-map boolean and adds no runtime object family.
- Evidence: canonical raw parse census is `12,048` nodes before and after; option bags fall `7,533 → 4,344`, empty bags `1,067 → 665`, reachable graph objects `24,820 → 21,631`, and the single-process post-GC retained delta `7.329 → 7.146 MiB`. Focused declaration/merge, AST serialization, and comment/provenance coverage pass; full core is `3,320` passed (`15` skipped, `2` marked deferred), spine-production-ratchet is `136/136`, and all-less byte identity is `106/106`. Same-checkout public benchmark samples were unstable (`261.15 → 255.14 ms` median), so this is allocation/memory evidence only, not a speed claim.
- Verdict: accepted — this carries absent parser options as absence and removes declaration option records without changing grammar, AST shape, serialization, visitor behavior, or rendered output.

- Latest pass: BITSET DISJOINT ALLOCATION CUT — `isDisjoint()` now directly scans ordinary, non-inverted numeric bitset words instead of allocating `a.and(b)` and then scanning that temporary intersection. Inverted or non-array backing data retains the existing intersection path; cross-library inputs still throw.
- Architecture surface: `packages/core/src/tree/util/bitset.ts` only, with a focused `bitset-disjoint` semantics test. No profile global, cache, fixture, writer, or selector-result index is retained in the production change.
- Separation/duplication: this is a rejection fast-path shared by the two existing extend callers. It changes neither selector equivalency nor extend policy; it only answers the same "do these key sets overlap?" question without a throwaway bitset.
- Cumulative node weight: no Node, placement, frame, source, trivia, or output field is added. The ordinary canonical path removes the temporary `and()` bitset allocation.
- New traversal: one bounded word loop replaces the library's intersection construction plus the existing intersection-data scan. It reads no AST/tree state and attaches no result to runtime state.
- New node/materialization: none. `isNumberArray()` now uses the same bounded numeric-word check without allocating an `Array.every()` callback; the test-only `BitSetLibrary`, typed-array, and `Context` construction are coverage fixtures only.
- Render path: unchanged. `isDisjoint()` only short-circuits selector mismatch work; selector matching, extend application, and serialization retain their existing routes.
- Helper/API surface: no export or helper was added.
- Metadata mutations: none.
- Review-flagged diff tokens: [loop/traversal] the two production loops are the numeric-backing validation and direct intersection test described above; [node construction] the four apparent constructions are test-only fixtures. No side map, output buffer, AST, or runtime profile field is added.
- Evidence: canonical profiling observed 25,439 direct ordinary scans and zero fallback on the measured fixture. Heap sampling removed the `isDisjoint → and/parse` allocation family (13,576 B `parse` plus 1,424 B `and` in the control sample). Three 5-warmup/15-pair A/B rounds showed no stable regression: canonical candidate/control medians `262.529/264.714 ms`, and the repeated-import 1×/2×/3× controls `3.917/4.209`, `10.070/10.534`, `18.609/20.006 ms`; this is an allocation result, not a speed claim. Integration gates: core build; core `3320` passed (`15` skipped, `2` deferred); spine `136/136`; all-less `106/106`; and aggressive review green.
- Verdict: accepted as a bounded resident/transient allocation cut. Keep the normal/inverted fallback split; do not turn it into a selector index or a profiling hook on the production hot path.

- Latest pass: Q-40 BENCHMARK CONTRACT + POST-EXPANSION DUPLICATE-STATE GATE — the benchmark scripts now run the real Less plugin/import path and profile that same public compiler path; serialization allocates duplicate-output maps/sets and performs the reverse duplicate-key pass only when the final, post-expansion declaration sequence actually repeats a property.
- Architecture surface: `serialize-helper.ts` retains the existing per-container declaration count map because expansion can splice imports, loops, and mixin bodies. Its new repeated-property flag is recomputed after every existing splice; unique final sequences never allocate the skip/key maps and never enter `runDedupPass`. `compare-less-parse-render-env.mjs` and `profile-less-benchmark.mjs` are diagnostic harnesses only, not runtime API or output paths.
- Separation/duplication: this does not restore the removed cached declaration-output representation and does not add a second serializer. Duplicate declarations still use the existing key comparison and normal final emission when repeats exist; unique declarations already bypass key rendering by contract.
- Cumulative node weight: no AST node field, placement, scope, source/trivia/provenance field, or runtime node cache was added. The two existing container-local duplicate maps are now absent for unique containers.
- New traversal: none. The existing count pass remains necessary to see post-expansion declarations; the reverse duplicate pass is skipped when that count proves no repeated property can affect output.
- New node/materialization: none. The benchmark harness builds ordinary `Context`/`Compiler` instances only to exercise the public compiler; production serialization constructs neither nodes nor an output tree for this cut.
- Render path: the benchmark output hash remains exactly `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840` (133,983 bytes). Full core, spine-production-ratchet, and all-less retain byte identity.
- Helper/API surface: no package export or public runtime method changed. The profile harness finds the Less checkout through `LESS_REPO_ROOT`, a sibling checkout, or the local checkout convention; its parse-failure `Error` is a malformed benchmark/harness failure, never routine runtime lookup control flow.
- Metadata mutations: none.
- Review-flagged diff tokens: [array helper] `path.join()` is confined to fixture/plugin paths in the diagnostic script; it allocates no runtime AST/output array. [node construction] `new Context` and `new Compiler` are measurement-harness setup only. [side map/set] the existing duplicate-key `Map` and skipped-index `Set` are lazily created only after a repeated property is proven; the cut introduces no persistent side map. [routine error control] the harness throws only when parsing the explicit fixture produces no tree, an exceptional benchmark setup failure.
- Evidence: focused `ruleset` `59/59`; full core `3315` passed, `15` skipped, `2` deferred; core/Jess builds; spine-production-ratchet `136/136`; all-less `106/106`; `git diff --check`. Same-checkout public benchmark was `276.31 ms` and parse-once render paired medians `217.85/216.90 ms`, versus earlier ≈270 ms/214 ms controls: no causal speed claim. The cut is accepted as bounded state reduction; Q-40 remains active because this is not material progress toward <40 ms.
- Latest evidence: profiling now splits direct declaration cache misses by `v` (variable), `p` (property), and `d` (declaration), and separates entered child surfaces into public/optional/miss outcomes. The canonical benchmark recorded `33,607` `d` cache misses, `37,560` child entries, `37,554` child misses, and only `6` child public hits. This proves a repeated declaration-search topology worth attribution; it does not justify a cache/index until the reference forms and semantic filters behind those searches are classified.
- Aggregate scaling evidence: this is not a fixed compiler setup cost. With the public Less compiler path, repeated canonical work through `@import (multiple)` grew from `408 ms` at one placement to `675 ms` at two and `1,040 ms` at three while CSS bytes stayed near-linear; four placements exceeded `900 MiB` and OOMed during warm-up. Literal duplicated roots reach the same cliff even earlier. Recursive placement work likewise grows superlinearly: grid columns `12/24/36` produce `83,423/89,243/97,943` scope-frame reads and `8,657/10,901/14,585` `Rules.eval` calls. Derive and frame-create counts stay linear. A bounded three-placement heap profile must name the growing object/array family before any lookup or frame redesign.
- Rejected POC: a pass-local extend-root chained-target index was byte-identical to Less and POC-off for a literal 32-extend payload at one/two/three `(multiple)` imports, with focused extend/import/ampersand coverage green. Its 5-warmup, 15-pair alternating A/B rounds did not clear the speed gate: the three-placement medians were `2.960→2.978`, `2.868→2.802`, and `2.778→2.814 ms`; two placements were mixed too. The implementation was deleted. Do not add a root/selector result cache from this allocation profile alone.
- Rejected POC: the static-local `(slot)` binding proof was correct and byte-identical (212 focused tests, core build, binding checks, aggressive review), but the canonical benchmark took that path zero times. Same-worktree medians were public `277.43→280.88 ms`, parse+render `262.81→271.25 ms`, and render `226.23→216.44 ms`; no stable target improvement exists. Leave its committed experiment unmerged and do not widen to parent slots or a prototype representation until a target workload actually exercises the admitted family.
- Fresh activation check (2026-07-14): `f6bca2ba4` passed the focused scope-slot proof (`4/4`) and core compile. A synthetic static-local workload activated the slot path `359,997` times and preserved checksum `23,999,994`, but four sequential 1,000,000-read runs measured candidate medians `259.619 ms` and `260.924 ms` versus current `origin/dev` baseline medians `250.790 ms` and `250.473 ms` (roughly `+3.6–4.2%`). This is an activating mechanism check, not a canonical benchmark claim; combined with zero canonical activation, do not cherry-pick the slot POC or widen it to parent/prototype slots.
- Reference.evalNode audit (2026-07-14): five clean current-dev profile runs reproduced `3,577` calls (`2,667` variable, `491` function, `397` mixin-ruleset, `22` declaration) and `68.42–76.70 ms` total. The `33,607` declaration misses belong to the 22 explicit property-merge references, which carry source-order starts, exclusions, semantic filters, and required assignment kinds; they are not ordinary variable misses. Do not open a generic Reference cache/index or a new prototype-chain lane. The bounded ordinary-variable path is already owned by `jess-scope-slot-proof`; a future merge-specific predecessor index would require declaration/rules/lookup ownership and merge-chain, mixin-boundary, cross-scope, exclusion, and `!important` parity.
- Parser boundary evidence: after regenerating the Less grammar against the Parseman profile branch, the canonical 106,797-byte fixture (Node v24.11.1, M4 Pro, 12 warmups + 45 samples) measured compiled recognizer-only `12.784 ms`, structural capture `28.873 ms`, and CSS-CST host construction `37.558 ms`; all 45 fully consumed with invariant 56,043-node counters. On the same runtime, Less 4.6.3 `less.parse()` to its native AST was `4.417 ms` with `processImports: false`. The models differ, but the outputless 2.89x recognizer gap disproves “Jess AST construction is the whole parser delta.” Profile generated recognizer control flow against Less before choosing a Parseman-level POC.
- Parseman generic follow-up handoff (2026-07-14): the analysis-only audit is recorded in `/Users/matthew/git/oss/parser-thing/notes/PERF_IDEAS.md` (isolated documentation commit `916c52b`). The first implementable generic target is opt-in zero-copy structural builder input with shared capture storage and range/cursor views, preserving separate semantic/raw channels. A genuinely compile-time-stripped recognizer is a separate higher-upside architecture proof; runtime output suppression is not equivalent. The audit excluded existing Parseman worktrees, ran focused JSON/GraphQL/CSS measurements, and keeps CSS/Less late-value materialization outside Parseman's generic contract. No Parseman implementation was made.
- Parseman true recognizer POC (2026-07-15): Parseman branch `feature/true-recognizer-20260715`, local commit `c84d777`, now has an opt-in code-generation mode that returns only acceptance/end/failure-cursor data and removes CST/raw/trivia/fields/host/profile/output-slice work while retaining recognition and rollback. JSON-like parsing improved `0.180875→0.095291 ms` (`47.32%`) and the real Less grammar `7.38425→5.534 ms` (`25.06%`), with p95 and GC also improved/neutral. Typed map-source overloads and `compileLinkable`/`fuseRules` parity are covered; focused contract tests are `39/39`, perf `5/5`, and typecheck/build/lint pass. The Parseman full suite still has the unrelated baseline `build-arity` source-shape failure at `test/unit/build-arity.test.ts:116` (`1,735` passed, `1` failed). The branch could not push from this checkout because GitHub SSH credentials were unavailable. Do not claim Jess speed movement until the published dependency is rebuilt and Jess's own parser/render contract is A/B tested.
- Parseman true-recognizer Jess adoption proof (2026-07-15, rejected for now): disposable Jess baseline `d9c4873` versus candidate `c84d777` built and consumed successfully under the exact `benchmark.less` contract (`20` warmups, `45` alternating pairs, `collapseNesting:true`, Less plus compatibility plugins, `JESS_STATIC_NAMESPACE_TABLE=0`). Parse+render was `273.558292→260.023458 ms` (`−4.95%`), while render-only was `60.901166→61.567417 ms` (`+1.09%`); parser-stage medians were `42.302375→39.217000 ms` and render-stage medians were `227.818083→221.846249 ms`. Output was exact in both phases at `131,578` bytes, SHA-256 `98a0536086c7e555b1a98e2372ad4000d51e25f1418c6345b6b8a9a97d80972f`. Reject adoption: Jess's current grammar does not opt into `mode:'recognizer'`, and render-only regressed, so the local Parseman win is not a Jess win. No Jess or published Parseman source changed; the test used disposable copies only.
- Scope-frame diagnostic: a globally gated profile separates cached `getScopeFrame` reads from creation without changing normal runtime behavior. The canonical run recorded `65,836` cache hits (including `28,061` placement hits) and `3,200` creations (`1,359` placement); its instrumented timing total is `25.868 ms` for hits and `13.107 ms` for creation. Instrumentation depth-walk/timer overhead means these are attribution evidence, not production cost claims.
- Review-flagged instrumentation tokens: [loop/traversal] the profile-only parent-chain depth walk runs only when its global counter object is present and does not enter normal runtime; [parent/source mutation] the `sourceNode` comparison is read-only placement classification, not a mutation; [materialized array/object] `BindingCell[]` appears in the architecture specification to define per-placement ownership, and this diagnostic allocates no array/object on the normal path.
- Verdict: accepted as a small, output-neutral state cut and benchmark-harness repair. Next, profile the serializer/eval boundary with counters that separate declaration lookup strategies; do not revive stale lookup indexes or bypass the detached declaration fallback writer without a dedicated formatting/provenance design.
- Q-40 refresh (2026-07-14): current uninstrumented same-checkout, alternating no-op controls on Node v25.9.0 arm64 (20 warmups, 45 pairs) are `238.98 ms` parse+render and `202.92 ms` parse-once/render-only. Less 4.6.3 on the same fixture/runtime (20 warmups, 45 samples) is `4.258 ms` parse with imports disabled and `31.101 ms` full render. The `33,607` direct declaration traversals are only 22 property-merge references; the only safe dominance shortcut activates once, so reject a lookup cache/index. Keep parser recognition/capture work separately gated (equal-contract recognizer `12.58 ms` versus Less AST parse `6.01 ms`), but prioritize eval/render toward the <40 ms goal.
- Q-40 control refresh (2026-07-14, same-checkout no-op): on Node v25.9.0 arm64 with the canonical fixture, `JESS_STATIC_NAMESPACE_TABLE`, 20 warmups, and 45 alternating pairs, parse+render was `239.933 ms` versus `242.942 ms` (median delta `-1.501 ms`, mean delta `+2.709 ms`, `26/45` wins); parse-once/render-only was `194.292 ms` versus `195.835 ms` (median delta `+1.421 ms`, mean delta `+2.293 ms`, `19/45` wins). These are order-dependent/noisy no-op controls and carry no speed claim; use them as the current same-checkout noise floor.
- Q-40 control refresh (2026-07-15, same-checkout no-op): current `dev` with the same fixture/runtime, `JESS_STATIC_NAMESPACE_TABLE`, 20 warmups, and 45 alternating pairs measured parse+render `227.30 ms` baseline versus `231.27 ms` no-op candidate (paired median delta `+1.66 ms`, mean `+3.24 ms`, `19/45` wins), and parse-once/render-only `194.43 ms` versus `193.02 ms` (paired median delta `+2.43 ms`, mean `+1.05 ms`, `17/45` wins). This is the fresh noise floor, not a speed claim; the following diagnostic profile recorded `Reference.evalNode` 3,577 calls / 68.31 ms and `Context.getTree` 5 calls / 133.88 ms under instrumentation.
- Q-40 flow/heap attribution refresh (2026-07-15, diagnostic only): `prepareRegistration` was `200.4 ms` inclusive and `_prepareRegistrationOnce` allocated about `45.84 MB` in the sampled render path; retained heap leaders were `RulesLookupState` (`11,088` / `1.52 MB`), `Ruleset` (`8,526` / `1.17 MB`), and `Map` (`36,128` / `1.10 MB`). Direct declaration-child collection allocated `18.58 MB` inclusive; source-order preparation/evaluation each ran `10,777` times despite no reorder; serializer sampling retained about `50,665` arrays / `1.55 MB`. These are investigation rankings, not normalized speed claims. `Context.getTree` itself is path/cache/load/parse/diagnostics/cache insertion; its earlier `133.88 ms` instrumented figure included wrappers. Direct root parse was about `36.38 ms`, while static import misses/hits were about `0.44/0.24` and `0.14/0.13 ms`; do not pursue a generic path cache from that evidence.
- Q-40 producer-fact admission cut (2026-07-15): four `rulesMayContain*` helpers now short-circuit on their existing producer facts. Canonical recursive visits fell declaration `1,447→412`, var-declaration `14,552→14,096`, and ruleset `2,058→2,006`. Exact Jess output remained `135,794` bytes with hash `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`; A/B timing was noise-level (`248.38→246.39 ms` parse+render, `20/45` wins; `199.53→201.46 ms` render-only, `18/45` wins). Core `3326`, spine `137/137`, all-less `106/106`, focused source-map/render `126`, and aggressive review passed. Keep this as eliminated work, not as a speed win.
- Q-40 combined final A/B (2026-07-15): with the producer-fact and import-placement cuts together, fresh current-`dev` versus candidate build comparison (20 warmups, 45 alternating pairs, constant generated parser/plugin artifacts) measured parse+render `217.181792→216.742542 ms` (`−0.20%`, `21/45` wins) and render-only `182.083875→181.264208 ms` (`−0.45%`, `18/45` wins). Both phases were byte-identical at `133,389` bytes, SHA-256 `39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c`; this is noise-floor evidence, not a speed claim.
- Q-40 lazy registration pending lanes (2026-07-15, integrated `3a3f71d9e`): `Rules` registration-prep state now allocates declaration and ordered-identity pending lanes only on first use. The worker saw `3,131` prep states, `485` pending states (`15.5%`), and `2,646` common states avoiding `5,292` lane objects and `10,584` arrays; `1,118` nodes entered the pending path. Exact output was `135,794` bytes, SHA-256 `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`. Matched A/B (20 warmups/45 pairs) was parse+render `233.34→239.29 ms` and render-only `213.04→202.67 ms`; no speed claim. Worker gates passed, and the combined integration batch also passed core `3,328`, spine `137/137`, all-less `106/106`, baseline, build, and aggressive-cutting gates.
- Q-40 declaration-child assignment metadata cut (2026-07-15, integrated `d443a559b`): direct declaration-child collection now asks for uncovered assignment-target metadata only when the `Rules` surface already advertises a variable-declaration or reference-import producer. Instrumented canonical counts fell collection `27,899→15,714`, inclusive time `18.707→7.170 ms`, uncovered-surface calls `6,927→204`, assignment propagation `6,927→204`, nested propagation `10,190→3,467`, and source items `101,693→71,975`. Matched A/B was parse+render `229.09→237.50 ms` and render-only `193.11→193.83 ms`; no speed claim. Output was `135,794` bytes with SHA-256 `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`; focused reference, core, spine, all-less, build, lint, and aggressive gates passed.
- Q-40 current post-cut control/profile refresh (2026-07-15, diagnostic only): the latest same-checkout no-op control on Node v25.9.0 arm64 measured parse+render `227.150542→227.980167 ms` (means `229.840→233.436 ms`, `24/45` candidate wins, paired median ratio `−0.176%`, mean ratio `+1.884%`) and render-only `186.348125→183.990750 ms` (means `192.249→189.799 ms`, `25/45` wins, paired median ratio `−0.358%`, mean ratio `−0.635%`). The spread remains a noise floor, not a speed claim. The following instrumented profile took `541.84 ms` and recorded `4,098` preview calls (`4,085` declaration fallbacks, `13` leaves), `1,644` duplicate-comparison containers, `884` prerendered declarations, `10,777` merge-admission calls with only `15` feature-bearing surfaces and zero child-item visits, `5` import-tree calls (`3` misses/`2` hits), and `43,167` direct declaration cache misses—all `.d` strategy—with `53,360` child-entry admissions, `16,486` child scans, and only `6` public hits. Live shape census counted `10,007` Declarations, `8,405` Rulesets, `7,211` References, `4,803` Dimensions, and `3,604` Colors. These measurements rank work; instrumentation distorts timing and does not justify a generic lookup index.
- Q-40 unminified CPU call-tree refresh (2026-07-15, diagnostic only): a real compiler-path Node CPU profile with 2 warmups and 2 alternating pairs, run after an unminified core build and followed by restoration of the normal minified build, sampled `isNode` at `129.19 ms`, GC at `123.41 ms`, `extendSelector` at `62.62 ms`, `findWithinScopeSurface` at `42.64 ms`, `applyExtendsToSelector` at `40.57 ms`, `findMixinsFastForUncoveredCallable` at `39.43 ms`, and `processExtends` at `25.68 ms`. Call-tree attribution puts about `27.46 ms` of sampled `isNode` time under `childRulesOf`, `12.75 ms` under `walk`, and `10.54 ms` under `collectSelectorSubtreeValues`. The sample is too small for throughput claims, but it identifies a concrete `childRulesOf` fast-path proof target; no global `isNode` rewrite is implied.
- Q-40 `childRulesOf` fast path (2026-07-15, accepted in `c08feb9a9`, source candidate `ce60697f4`): `childRulesOf()` now checks the real `Rules` instance before the three ordinary `isNode` protocol checks and retains the duck-typed `N.Rules` fallback. The focused compatibility test covers all five local `Rules` subclasses plus a foreign `N.Rules` value; full core passed `3,329` tests (`15` skipped, `2` todo), spine ratchet `137/137`, baseline/all-less `106/106`, Less alpha verification, core/plugin/Jess builds, ESLint, aggressive review, and `git diff --check`. The current exact rebuilt-chain A/B used 20 warmups and 45 alternating pairs: parse/render `237.349125→231.947792 ms` (−5.401333 ms, `−2.275691%`, `31/45` wins) and render-only `199.381666→197.704750 ms` (−1.676916 ms, `−0.841058%`, `27/45` wins). Output was byte-identical at `133,389` bytes, SHA-256 `39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c`. The signal is modest and environment-sensitive, so retain this as a bounded work reduction with no causal speed claim; do not generalize to a global `isNode` rewrite.
- Q-40 `hasDirectChildRuleSurface` pre-collection guard (2026-07-15, rejected): the find-within-scope audit identified a distinct possible cut—skip `collectDirectDeclarationChildEntries()` when the existing producer fact is false. The implementation proof found that `derive()` intentionally clears `R_HAS_DIRECT_CHILD_RULE_SURFACE` while sharing the child array, so a derived placement can contain a direct Rules child while the proposed guard reads false. Repairing that would require another traversal/state graph or a new authoritative ownership protocol, violating the bounded-cut rule. No source change or POC was retained; keep the existing child-entry path and do not use this flag as a lookup shortcut.
- Q-40 extend chain-only preparation audit (2026-07-15, pending owner proof): the extend audit found that `applyExtendsToSelector()` eagerly prepares `collectSelectorSubtreeValues()`, expanded extend targets, tuples, and the target index even when no selector changes and chained discovery is never entered. The current dirty user checkout already contains a partial lazy-preparation change in `packages/core/src/tree/util/extend.ts`; it was not touched or duplicated. Removing/reusing the subtree scan remains rejected without a focused matrix covering chained/partial/list/`:is`/ampersand/self/circular/reference/protected-root semantics plus canonical A/B. The existing target index and pass memo remain required and must not be revived as a root-level cache.
- Q-40 local artifact/worktree reconciliation (2026-07-15): superseded registration-prep `f4ee226ce` and declaration-child-metadata `42c707c7a` worktrees are explicitly retired in `CORE-CLEANUP.md` in favor of integrated `3a3f71d9e` and `d443a559b`; the uncommitted import-placement variant remains audit-only. CPU/heap and parser profile files under `/private/tmp` are local diagnostics whose durable summaries are in the tracker, not published artifacts.
- Q-40 reference-surface allocator audit (2026-07-15, rejected as a new cut): the semantically valid fixed-shape candidate was benchmark-activated (`1,428` seam calls on `benchmark.less`, `1,200` on a dynamic fixture), but showed no causal speed or consistent memory win and was materially more complex, so the source was reverted. Benchmark parse/render was `230.686→231.084 ms` and render-only `200.831→197.308 ms`; dynamic fixture parse/render was `243.909→216.267 ms` and render-only `134.793→134.009 ms`, without a stable canonical signal. Outputs were exact: benchmark `135,794` bytes with SHA-256 `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`, dynamic `192,519` bytes with SHA-256 `38a968f24a8bd34be03fc667cddb679bc0e35a9335fbb731ec0cef38e0f337cc`. Focused `515/516`, core `3,331`, full build, spine `137/137`, all-less, aggressive review, and ESLint passed. Evidence-only worker commit is `a69f51b5d`; do not reopen the lane without a new workload and a simpler, consistently beneficial shape.
- Q-40 explicit merge-only lookup audit (2026-07-15, rejected): the canonical profile reproduced `43,167` declaration cache misses, `53,360` child-entry admissions, `16,486` child scans, only `16` local matches, and `22` declaration references. A merge-heavy fixture rendered exactly (`186` bytes, SHA-256 `4d01b5cbdf83e120e5d3b16f9a8ef8c05288976185f74df0c515e1da58067dfe`) but activated zero direct-lookup counters, including an eval-forcing probe, because its merges were structurally coalesced before `findAnyDeclarationOccurrence`. A bucket-only descriptor therefore has no activating proof and cannot be admitted without reintroducing cross-scope/import/mixin visibility plus self/source-order filtering. No source change or commit was made.
- Q-40 source-order preparation audit (2026-07-15, rejected as a new canonical cut): the earlier legacy-only profile measured `_prepareForEval` `10,420` calls / `865.8 ms`, `_prepareRegistrationOnce` `3,060` / `85.7 ms`, and `_evaluateSourceOrder` `10,420` / `807.4 ms`; normalization found `8` candidates but performed `0` reorders, while live-binding placements repointed `6,987` times. A follow-up current-dev instrumentation corrected the activation story: canonical `benchmark.less` makes one spine root attempt, then enters the normal fallback path `10,777` times for `_prepareForEval`, `_evaluateSourceOrder`, and `_normalizeCallDeclarationRulesOrder` (imports-only preparations: `0`). This is real canonical work, not legacy-only work; nevertheless, the existing normalization target is owned by `7bb9b483e`, and broader route consolidation risks source-order, import, call, and live-binding semantics. No new bounded candidate or duplicate worker was dispatched.
- Q-40 OutputWriter trim-tail audit (2026-07-15, rejected): the live canonical path counted `15,581` writers, `13,400` marks, `7,123` restores, `13,235` `getSince()` calls scanning `109,102` chunks, and `10,907` `trimEndSince()` calls causing `69,780` position updates; `capture()`/`preview()` were unused. A no-source-map tail-bookkeeping prototype was exact in `68/68` writer/source-map tests and the core build, but parse-render `234.925→232.575 ms` had paired median delta `+1.187 ms` with `20/45` wins, and render-only `198.693→197.714 ms` had paired delta `−0.066 ms` with `23/45`. Output was exact at `135,794` bytes, SHA-256 `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`; reject the complexity and preserve `_posLength`/source-map behavior. Rejected uncommitted artifact remains isolated at `/private/tmp/jess-outputwriter-trim-tail-20260715`.
- Q-40 callable uncovered-child result adoption audit (2026-07-15, rejected): the only bounded candidate after the callable full-index/miss-sentinel work was adopting the first fresh result array in `findMixinsFastForUncoveredCallable()` instead of allocating an aggregation array. Synthetic counters proved direct hits `2`, recursive hits `2`, source order, filters, reference fallback, miss/unsupported, and bucket immutability. Canonical `benchmark.less` activated zero direct/recursive hits on either side (`9,225` misses and `1,407,375` unsupported outcomes per `45`-sample phase), so parse-render `237.47→219.28 ms` was non-causal; render-only `189.70→186.27 ms` was noise. Focused callable coverage was `217/217`, output was byte/hash-identical, and no source change remains.
- Q-40 current no-op control refresh (2026-07-15): clean current `dev` (`e44fc7764`) with the same `JESS_STATIC_NAMESPACE_TABLE` `0→1` control, `20` warmups, and `45` alternating pairs measured parse-render `237.499→238.559 ms` (`20/45` wins, median ratio `+0.38%`, `t=0.15`) and render-only `184.529→182.927 ms` (`21/45` wins, median ratio `+1.08%`, `t≈0`). Treat this as noise-floor evidence only.
- Parser flow attribution: outputless Parseman profiling is not a separately compiled `voidOf` artifact — every structural rule still runs generated collector-context save/install/restore plus profile-mode branches. Less keeps one cursor and its `primary()` tries declaration before ruleset; 2,024/2,902 (69.7%) benchmark declarations take the raw `anonymousValue()` route rather than its full value grammar. Jess eagerly enters `valueList → valueSequence → topSum → topProduct → operand → value`, and overlapping body dispatch places Ruleset before Declaration. First prove a compile-time stripped recognizer with no structural frames; separately prove safe statement dispatch. Lazy raw values are an evaluation-materialization design, not a parser micro-cut.
- Static `(multiple)` import attribution: 1×/2×/3× static imports retain one source tree (one cache miss then hits); current-runtime growth is `Rules`/`ScopeFrame`, `ImportPlacementState` children/segments, segment record, and shallow placement copies. Output buffers are transient. This proves source reuse, **not** that every wrapper/array/clone is semantically required: a closed source needs repeated output occurrences and placement identity, possibly as a smaller descriptor/direct segment. Field-by-field minimality proof is required before a cache or reuse POC.
- Fresh import-placement ownership audit (2026-07-15): the current-`dev` audit found no new implementation to port. The closed-static-`(multiple)` mapping-state cut is already landed in `aadd0710b`; the worker made no source or docs change. Focused import tests passed `94/94` with `1` skipped, core/Jess/relevant plugin builds passed, and the production import ratchet was blocked only by the unavailable isolated `@jesscss/style-resolver` build. No benchmark was run. Treat the landed gate as the current source of truth and require a smaller descriptor/direct-segment proof before reopening this lane.
- Fresh static-local scope-slot audit (2026-07-15): the current-dev port of stale proof `f6bca2ba4` remained isolated at `/Users/matthew/git/worktrees/jess-scope-slot-audit-20260715` and was not committed or merged. The narrow layout/slot/cell shape passed its focused semantic checks, core `3328`, spine `137`, Less corpus `77` with known expected failures, builds, and byte identity (`133,389` bytes; SHA-256 `39a4812a…73a4c`). It activated on the synthetic admitted case (`slot=1,fallback=0`) and used fallback on the dynamic case (`slot=0,fallback=1`), but canonical `benchmark.less` activated it zero times. Same-worktree medians were `+0.56%` parse+render and `+0.41%` render-only, so reject it for the current target; do not widen to parent/prototype slots without an activating real-shape benchmark and total-allocation evidence.
- Rejected direct custom-declaration fallback writer POC: its map-off, comment-free shortcut writes `Declaration.writeSyntax()` directly, but that method deliberately emits `important` only in its non-custom formatting branch. A custom property with `!important` therefore loses that suffix. The POC remains isolated and unmerged; repairing it would broaden into declaration-format ownership, not a narrow detached-writer transport cut.
- Rejected broader direct-container declaration route: its default-shape predicate admits `4,069/4,085` canonical fallback calls and preserves the canonical hash, but bypasses evaluated-text ownership and changes `44/106` Less fixtures, exposing unresolved `$['color']`/`$??(...)` forms. All canonical fallbacks are non-static evaluated-tree emissions after spine restoration; no safe already-evaluated discriminator exists. `renderNodeText()` remains the evaluator-to-outer-formatting boundary. The temporary POC was deleted.
- Rejected source-node attachment for residual inline comments: standalone comments already lift to `Comment` nodes, while the three canonical non-lifted ranges sit inside bare string-selector headers with no semantic node boundary. Derived nodes self-own `sourceNode`, and `inherit()` intentionally does not carry source boundary trivia into a new placement. A direct attachment needs a new selector-string slot plus placement carry policy, so retain boundary comments in the shared source map and reduce whitespace persistence at capture instead.
- Rejected Parseman trivia-call guard: exact 12-warmup/45-sample phase medians regressed `11.958→11.985 ms` recognizer, `28.850→28.938 ms` capture, and `26.551→26.603 ms` host construction. The POC was deleted; no first-byte trivia guard remains.
- Rejected recognizer-only Parseman node-frame bypass: it preserved the focused structure/count contract but regressed `11.875→16.469 ms` recognizer, `28.446→36.819 ms` capture, and `26.297→33.984 ms` host construction over 12 warmups/45 samples. The POC was deleted; retain generated node-frame setup and pursue only the independent capture representation proof.
- Rejected raw-child collector alias proof: the matched real-LessGrammar 12-warmup/45-sample POC-off/candidate medians regressed recognizer `12.052→12.676 ms` (+5.2%), capture `28.608→30.247 ms` (+5.7%), and host `40.524→43.491 ms` (+7.3%). The Parseman worktree, temporary Jess phase harness, and standalone script were deleted with no commit. Do not reopen collector aliasing; finish generated-recognizer attribution first.

- Latest pass: OUTPUTWRITER TRANSIENT-STATE LAZINESS — no-source-map writers no longer allocate idle captured-segment or queued-spacer fields, and the unused trailing-newline-origin diagnostic state/accessor is removed.
- Architecture surface: `packages/core/src/tree/util/print.ts` retains the existing chunk, scalar-position, source-map, and inline-import state. Capture segments and queued-spacer state become own properties only when their corresponding writer feature runs.
- Separation/duplication: this is a writer-shape cut, not a new output representation. `_posLength` deliberately remains eager because no-source-map `mark`/`restore` needs its rollback history; source-map arrays retain the prior lazy `tracksSources=true` boundary.
- Cumulative node weight: no AST node, placement, scope, lookup, parent/source/trivia metadata, or output buffer state was added. The change removes one dead field and three eager transient writer fields from ordinary writer construction.
- New traversal: none. Writer add, capture, replace, restore, and spacer paths keep their existing control flow; the new conditional clears avoid materializing absent transient properties.
- New node/materialization: none. Captured source-map segments still use the existing arrays only when source tracking is on; no-source-map capture has no segment state to retain.
- Render path: text, whitespace, rollback, captures, and source-map segment behavior are covered by the 55-case writer suite. The generated core bundle confirms a fresh no-source-map writer has no captured-segment or queued-spacer fields before or after a plain add.
- Helper/API surface: `OutputWriter` is module-internal (core's public entry exports only `PrintOptions`); no workspace or downstream consumer uses `getLastNewlineOrigin`, so deleting that unused diagnostic accessor does not alter the package surface.
- Metadata mutations: none. No node metadata is created or changed.
- Review-flagged diff tokens: [array helper] the diff creates no persistent array; existing segment arrays are only read under `tracksSources`. [node construction] the focused test's `new OutputWriter(false)` proves shape only. [generic defensive read] the test-only `Object.hasOwn()` checks the emitted writer shape; production code adds no defensive read path. [materialized array/object] zero output/node materialization is added; the cut removes eager own properties from the normal writer shape.
- Evidence: full core suite passed (`3311` tests, `15` skipped, `2` deferred); focused writer suite `55/55`; core build passed. Exact same-checkout `benchmark.less` A/B used 15 iterations, 5 warmups, and 3 rounds per side (Node v25.9.0 arm64): temporary control `253.67 ms`, first candidate `289.79 ms`, restored-candidate repeat `242.93 ms`. The order-dependent 46.86 ms candidate swing makes this environment signal non-actionable, so this is a slimming-only cut with no speed claim.
- Verdict: accepted as a bounded, owned writer-object reduction. The next writer question is the separately-tracked `_posLength` rollback representation; do not trade it for an O(n) restore scan without a profile and a representative mark/restore workload.

- Latest pass: ROOT FLAT WRITER/BUFFER TRANSPORT — compiler-owned flat root buffers now alias `OutputWriter.chunks` through `RenderBuffer.parts`; the root spine writes its document prelude and body into that one array, while caller-owned buffers, segmented buffers, and source-map output retain detached ownership.
- Architecture surface: `packages/jess/src/index.ts` marks only the compiler's flat render buffer with `shareWriter`; `packages/core/src/tree/util/render-buffer.ts` supplies the aliasing print state and shared-result seam; `packages/core/src/tree/rules.ts` routes root and eval-buffer serialization through that seam; `packages/core/src/tree/util/emit-walk.ts` frames the shared spine prelude/body boundary.
- Separation/duplication: the former root path kept writer chunks, joined them into a returned string, then pushed that string as a separate `RenderBuffer.parts` entry. The new compiler-owned flat path keeps the writer chunks as the buffer parts and only joins for the public returned string/finalization; explicit caller buffers and segmented/source-map paths remain separate because their ownership and source-map semantics differ.
- Cumulative node weight: no AST node field, constructor, prototype, placement record, lookup state, or node-owned cache was added. The only new runtime marker is an optional compiler-owned buffer flag, and it is not stored on nodes.
- New traversal: none. The spine still descends the same root once; shared output adds one prelude boundary and uses existing writer trim/replace operations when a late prelude mismatch requires repair.
- New node/materialization: no production node or output-tree materialization. The path reuses the existing `OutputWriter` and flat `parts` array; a fresh detached `OutputWriter` remains only for prelude serialization and source-map/caller-owned boundaries.
- Render path: shared spine output writes `@charset`/top imports before descent, trims the direct body to the public framing, and appends one terminal newline without joining chunks. Eval and nested serializer seams reconcile only when their writer already contains a partial result; byte-identical output remains the contract.
- Helper/API surface: `FlatRenderBuffer.shareWriter` is an optional internal compiler marker; no new package export or public method was added. `prepareBufferPrintState` preserves the existing detached behavior unless the marked flat buffer is compiler-owned and source maps are off.
- Metadata mutations: no source, parent, placement, span, provenance, trivia-map, or node metadata mutation was introduced. Writer position state continues to belong to the existing `OutputWriter`.
- Review-flagged diff tokens: [array helper] focused tests use `parts.join('')` only to assert one shared byte stream, and `text.slice()` handles only an unwritten suffix; [node construction] `new OutputWriter(false, buffer.parts)` reuses the existing writer type for the alias boundary and does not construct nodes; [materialized array/object] the existing flat `parts` array is intentionally shared, while the test fixtures and cold prelude writers do not add persistent render state; traversal, copy helper, map/set, and routine error categories are unchanged.
- Evidence: focused core render-buffer/rules/node-buffer tests passed `121/121` with `5` skipped; core and Jess compile passed; matched same-checkout control with sharing disabled measured `246.64 ms` versus the final shared candidate `245.77 ms` on `benchmark.less` (Node v25.9.0 arm64, 15 iterations, 5 warmups, 3 rounds), a `-0.87 ms` / `-0.35%` candidate delta with usable but noisy signal and no strong speed claim; the earlier clean baseline was `239.76 ms`. The eval-fallback owner audit found no safe `emit-walk.ts`-only removal: the benchmark fallback is gated by `spine-extend.ts` topology analysis, while unresolved interpolated imports and root-direct loops remain semantic gates.
- Verdict: accepted as a bounded flat transport/slimming pass with exact-output ownership tests and a qualified neutral speed result. The remaining eval fallback is explicitly owner-gated architecture work, not counted as removed by this transport change.

- Latest pass: OUTPUTWRITER SOURCE-MAP ARRAY LAZINESS — `tracksSources=false` writers no longer allocate the four source-map-only arrays; the common `_posLength` rollback history remains eager and unchanged.
- Architecture surface: `packages/core/src/tree/util/print.ts` keeps `OutputWriter.chunks`, length, spacer, and inline-source state on the common path. `_segments`, `_posLine`, `_posColumn`, and `_posSegments` are initialized only by the source-map constructor path; source-tracking methods retain the same array representation when enabled.
- Separation/duplication: this is an allocation-shape cut inside the existing writer, not a new source-map representation and not the flat-buffer sharing experiment. The existing `OutputWriter.chunks`/`RenderBuffer.parts` duplication remains separately profiled and intentionally unmodified because root Rules readback and reentrant buffer ownership still need their own semantic gate.
- Cumulative node weight: no AST node fields, constructors, prototypes, or node-owned lookup state changed. The pass reduces per-writer source bookkeeping allocation without moving state onto nodes or adding a side map.
- New traversal: none. The only changed branches are writer construction, source-map position maintenance, rollback, capture, and segment access; no render-tree, parent, source, or trivia traversal was added.
- New node/materialization: none in production. The four arrays are existing source-map state allocated only for `tracksSources=true`; `getSegments()` returns a fresh empty array only on the cold no-source-map accessor path. The test's `new OutputWriter(false)` is a direct shape assertion, not runtime production construction.
- Render path: output text, rollback positions, source-map segments, and `getSegments()` behavior remain byte-compatible. The no-source-map path still records `_posLength` for `mark`/`restore`; source-map writers still allocate and use all parallel position arrays.
- Helper/API surface: no public method or type was added. Existing `preview`, `replaceSince`, `capture`, and `getSegments` contracts remain in place; non-null assertions are confined to branches proven by `tracksSources` construction.
- Metadata mutations: none. No source, parent, placement, span, provenance, or node metadata is written.
- Review-flagged diff tokens: [array helper] the three new `.slice()` calls preserve existing segment-capture behavior and run only for source-tracking writers; [node construction] the test-only `new OutputWriter(false)` verifies the no-source-map shape and adds no production construction; [materialized array/object] the four existing source-map arrays are now conditional allocations, while the cold `getSegments()` fallback's `[]` preserves the old empty-array return contract and does not persist per writer.
- Evidence: focused OutputWriter/source-map tests passed `58/58`; full core passed `3311` tests with `15` skipped and `2` deferred tests; spine-production-ratchet passed `136/136`; all-less passed `106/106` byte-identical; targeted ESLint passed for both touched source/test files; core compile and `git diff --check` passed. Direct shape assertions show `tracksSources=false` has no `_segments`/position-map arrays while `_posLength` remains populated. The matched `benchmark.less` runs were noisy: earlier control `230.26 ms`, after samples `251.21–262.40 ms`; this is not accepted as causal because the clean rebuilt control was blocked by the independent less-parser generated-grammar `unwrapTrivia` crash, so no speed claim is made.
- Verdict: accepted as a slimming-only writer-shape cut; the flat writer/buffer sharing candidate is deferred to a separate experiment with ownership-specific tests and a clean-build A/B gate.

- Latest pass: Q-33 LAZY AT-RULE IDENTITY CACHE — the eager `_valueOf` class slot is now declaration-only, so an uncached `AtRule` instance keeps the lean prototype shape while `valueOf()` still memoizes the same identity string.
- Architecture surface: `packages/core/src/tree/at-rule.ts` changes only the `_valueOf` declaration and three invalidation sites. Cache clearing is conditional, so invalidation does not materialize an own slot on an instance that has never used `valueOf()`.
- Separation/duplication: this is a bounded refinement of the existing AtRule field audit, not a new at-rule representation, identity algorithm, or broader field split. Structured preludes and `Node.compare()` continue through the existing identity path.
- Cumulative node weight: uncached AtRule instances no longer carry the eager identity slot; cached instances retain the same memoized value. No replacement state, side channel, or wrapper was added.
- New traversal: none. The diff changes one field declaration and conditional cache invalidation; evaluation, rendering, comparison, and structured-prelude walks are unchanged.
- New node/materialization: none. The cache is only materialized by the existing `valueOf()` path; no output node or temporary identity object is introduced.
- Render path: focused identity, structured-prelude, mutation, and interpolated-name preparation tests preserve output and registration behavior; full baseline and spine ratchet remain green.
- Helper/API surface: no export, method, node-class, or public-type changes. `node.type` remains the prototype string discriminant and is unrelated to this pass.
- Metadata mutations: no source, parent, placement, span, or provenance writes were added.
- Review-flagged diff tokens: [field] the removed eager slot is the intended shape cut; [cache] memoization and invalidation semantics are retained; [negative guard] an uncached instance remains uncached until `valueOf()` is called.
- Evidence: focused AtRule tests passed `87/87`; full baseline passed core `3310/15/2todo`, all-less `106/106`, compatibility `62/62`, and frontier/export/metadata checks; `spine-production-ratchet` passed `136/136`; clean core and Jess builds, aggressive review, and `git diff --check` passed. Same-directory clean-build `benchmark.less` A/B used 36 samples per side: control round median `226.27 ms`, candidate `222.65 ms`; the candidate was unstable and trimmed medians were `227.97 ms` versus `228.91 ms`, so no speed claim.
- Verdict: accepted and closed as a shape/allocation-only AtRule refinement. The next typed-value lane is Q-30: after Q-28D/E/F ownership resolves or explicitly releases, refresh the D-EVAL owner from current `dev`, then start with Dimension/Num, followed by Color, then keyword/bool unification.

- Latest pass: Q-28B SCALAR LESS VALUE LEAVES — the Less variable-declaration producer now leaves one inert static identifier as a raw declaration string; semantic/calculated values remain nodes.
- Architecture surface: `packages/less-parser/src/builders.ts` changes only `_buildVarDeclaration` and `_assembleLessValue`; the final scalar-to-`Keyword` wrapper is removed, and `_assembleLessValue` returns a string only for a single string component. Custom declarations, grammar, SCSS composition, and core consumers are untouched.
- Separation/duplication: this is the bounded scalar Less variable producer slice, not a global `_lessKeyword` change and not Q-28C's custom-property fallback. It reuses the existing `DeclarationValue` string contract and lazy coercion boundary; no parallel serializer or resolver was added.
- Cumulative node weight: inert scalar variable values no longer allocate a per-value `Keyword` node. Colors, dimensions/numbers, references/accessors, calls, namespace paths, interpolation, operations, parens, and list/group elements retain their existing node shapes; mixin parameter/default and named-argument keywords remain nodes.
- New traversal: none. The producer adds one `valItems.length === 1`/string check and removes one wrapper branch; no walk, rediscovery, or consumer traversal is introduced.
- New node/materialization: none. The winning path constructs no value node for the inert scalar. Existing semantic nodes and list arrays remain unchanged; no output tree, side map, cache, or placement state is added.
- Render path: direct render and eval parity are locked for `@mode: block; .sample { display: @mode; }`; the full all-less corpus remains `106/106` with its expected failures. Mixin keyword and declaration/custom-property guards remain green.
- Helper/API surface: no exports, methods, node classes, or public types changed. The existing string-capable declaration value is exercised; `node.type` remains the node discriminant and is not removed or repurposed.
- Metadata mutations: none. The raw scalar carries no new per-token span; declaration-level source/provenance remains the existing anchor, and no parent/source-root/location/index field is assigned.
- Review-flagged diff tokens: [string field] the producer now returns the already-supported declaration string shape; [routine node] the removed `Keyword` wrapper is the intended allocation cut; [negative semantic guards] all calculated/reference/interpolated forms remain node-backed; [test typing] shape assertions use the real `Node` class guard and do not weaken runtime invariants.
- Evidence: worker ownership review found only `builders.ts` plus focused Less tests; staged lint, parser compile, and aggressive review passed. Focused/adjacent Less suites passed `142/142`; full `verify:baseline` passed core, both parser families, compatibility, frontier, package-export, and metadata gates; `git diff --check` passed. Compiled parser probe over 1,000 `@vN: block;` declarations: 0 parse errors, 1,000 variables, 1,000 raw-string values, 0 value nodes. Matched `benchmark.less` on Node v25.9.0 arm64, 100 iterations × 5 repeats × 20 warmups: control `245.59 ms` median / `251.50 ms` trimmed, usable with `34/500` outliers; after `252.54 ms` / `253.11 ms`, unstable with `55/500` outliers. The apparent slowdown is not causal evidence; no speed claim.
- Verdict: accepted and closed as a shape/allocation-only Less producer win. Q-28D is the next queued producer audit; CSS/SCSS/selector slices remain sequenced and ownership-gated.

- Latest pass: Q-28C EXISTING LESS PERMISSIVE-PARSE LANE — finished and triaged `work/permissive-props-interp` before assigning the scalar-value row. Custom-property fallback text remains verbatim/interpolation-only, and unknown-at-rule prelude values preserve the required quoted and multi-token variable/interpolation paths; current-dev ratio handling was retained during merge conflict resolution.
- Architecture surface: `packages/less-parser/src/grammar.ts` removes the structured custom-value alternative from the interpolation-only `--*` fallback; `packages/less-parser/src/builders.ts` keeps the existing custom declaration path literal while adding only the prelude cases owned by the lane. The baseline caught that SCSS composes the Less grammar's `customValue` rule, so the rule remains exported as an SCSS-only composition seam while Less no longer selects it. Parser/declaration fixtures and the all-less expected-failure ledger record the scope.
- Separation/duplication: this is the pre-existing permissive lane, not a reimplementation of Q-28B. Q-28B remains limited to scalar Less variable-declaration values; custom declarations and grammar/trivia ownership are explicitly excluded from that worker.
- Cumulative node weight: custom-property bare text no longer becomes a structured Less value tree; only `@{…}`/`${…}` interpolation creates the existing interpolated path. Quoted/multi-token at-rule handling reuses existing `Quoted`, `Reference`, `QueryCondition`, and tokenization helpers; no new node family, field, side map, or compatibility wrapper was introduced.
- New traversal: none. The lane uses the existing source capture and prelude builder; its tokenization is local to one multi-token feature value and does not add a tree walk or candidate rediscovery pass.
- New node/materialization: no output-tree or eval materialization was added. Literal custom-property fallback uses the existing string-capable declaration field and the existing lazy coercion boundary.
- Render path: focused Less and SCSS parser suites, the full all-less corpus, and the repo baseline passed; the permissive fixture remains explicitly expected-failing only for its unrelated variable-value and selector-capture gaps.
- Helper/API surface: no public export or method change. The existing `DeclarationValue` string contract and prelude builder paths are exercised; `node.type` remains the prototype string discriminant and is not part of this pass.
- Metadata mutations: none. The new literal paths do not attach per-token spans or ad-hoc node fields; existing coarse declaration/prelude provenance remains the anchor.
- Review-flagged diff tokens: [routine node] custom fallback no longer builds a call/value tree; [string field] this is safe because declaration rendering/eval already lazy-coerces strings; [grammar] only the custom-property fallback alternative is removed; [API] no exported surface change.
- Evidence: existing-lane worktree and branch audit completed; Less parser focused suites passed; SCSS focused grammar/baseline passed `519` tests with `2` expected failures and `5` skipped; full all-less corpus passed `106/106`; full `verify:baseline` passed core, both parser families, compatibility, frontier, and package checks; aggressive-cutting review and `git diff --check` passed. Matched stable `benchmark.less` on Node v25.9.0 arm64, 100 iterations × 5 repeats × 20 warmups: control `266.14 ms` median with unstable signal (`69/500` outliers, `24.2%` RSD); after `285.82 ms` median with usable but noisy signal (`42/500` outliers, `28.0%` RSD). The observed `+19.68 ms` / `+7.4%` is not treated as causal, so there is no speed claim.
- Verdict: accepted and closed as the existing permissive producer lane. Q-28B is now the active next row: scalar Less identifier leaves, with the custom-property fallback explicitly excluded.

- Latest pass: Q-28A STATIC CSS AT-RULE PRELUDES — comment-free generic statement and opaque-block at-rule preludes now use bare strings; `@charset` remains the role-bearing `Any`, and comment-bearing preludes retain `Any` because the current trivia emission path needs a span-bearing wrapper. The core spine admission predicates accept static strings alongside static nodes, preserving the existing `@layer`/CSS-import fold routes.
- Architecture surface: `packages/css-parser/src/builders.ts` changes only the two generic CSS at-rule producer paths; `packages/css-parser/test/ast-serialize.test.ts` locks string shapes, charset preservation, and comment safety; `packages/core/src/tree/util/emit-walk.ts` widens two existing static-prelude predicates. Less/SCSS import-specific builders, interpolation, math/coercion, reference results, and calculated values are untouched.
- Separation/duplication: reuses the existing `AtRule`/`AtRuleStatement` string-field contracts and the existing spine admission/render path. No new parser grammar, trivia map, serializer, resolver, or compatibility wrapper was introduced.
- Cumulative node weight: comment-free static prelude payloads no longer allocate throwaway `Any` nodes; comment-bearing payloads and `@charset` deliberately retain nodes for provenance/trivia semantics. No Node field, Rules field, placement state, map, set, or side table was added.
- New traversal: none. The producer reads the existing source slice to detect block comments, and the consumer changes are two type checks; no walk or rediscovery pass is added.
- New node/materialization: no new runtime node family or output tree. The only new node constructions are the existing compatibility fallback for comment-bearing preludes; static comment-free paths construct no payload node.
- Render path: comment-free `@layer` and opaque at-rule headers render through the existing string branches; comment-bearing headers retain byte/trivia behavior; the full Less corpus remains byte-green.
- Helper/API surface: no public export or method changes. `AtRuleStatement.prelude` and `AtRule.prelude` already accepted strings; the change only exercises those existing fields and updates the existing spine predicates.
- Metadata mutations: none. The parser records no per-token span for strings; it retains the existing at-rule name span and uses the existing span-bearing `Any` fallback when comments need anchoring.
- Review-flagged diff tokens: [routine node] `Any` remains only for the documented charset/comment cases; [span/trivia] the source-slice comment check is the narrow reason not to drop those wrappers; [loop/traversal] no new traversal; [materialization] no output/eval materialization; [API] no exported surface change.
- Evidence: CSS parser focused `48/48`; full CSS parser `251 passed, 17 skipped`; Less parser and core suites passed through the full baseline; core `3308 passed, 15 skipped, 2 deferred tests`; spine-production-ratchet `136/136`; all-less `106/106`; Less compatibility `62/62`; clean core/CSS/Less parser/Jess builds; aggressive review, frontier, package-export, metadata, and `git diff --check` passed. Matched clean-build `benchmark.less` on Node v25.9.0 arm64, 100 iterations × 5 repeats × 20 warmups: control `262.91 ms` median / `264.24 ms` trimmed, parser-only `262.14 / 261.52`, final core-consumer run `247.25 / 246.84` with unstable signal from a `1324.86 ms` outlier. No speed claim.
- Verdict: accepted and closed as the first bounded Q-28 producer slice. It handed off to Q-28C for the existing custom-property lane, then to active Q-28B for scalar Less identifier leaves.

- Latest pass: STATIC NAMESPACE-PATH ARRAY ADMISSION — completed only the pure static child-combinator namespace-path residual from the existing guarded-namespace lane. Array-shaped call keys now enter the spine only when every segment is a string and the reference carries the parser's authored `rawKey` marker; source-span order handles candidates in disjoint authored subtrees. Guarded namespace-segment visibility, parent mutation, deduplication, and routine guard-miss errors remain out of scope.
- Architecture surface: `packages/core/src/tree/util/emit-walk.ts` adds the authored-path gate to `isSpineEligibleMixinCall`, imports the existing `spanStartOf` helper for candidate ordering, and adds no rules/namespace registry changes. The focused ratchet covers a three-segment static path and two disjoint namespace definitions.
- Separation/duplication: reuses the existing `Call.eval`/`findMixinPath` resolution and callable sink; the diff adds only admission and ordering around that sink. No second namespace resolver, candidate traversal, or serializer is introduced.
- Cumulative node weight: no Node, Rules, Ruleset, placement, cache, or side-map field is added. The change reads the existing reference marker and source span.
- New traversal: none. `spanStartOf` is a scalar metadata read; no walk, recursive descent, or candidate rediscovery is added.
- New node/materialization: none. No Node, array, map, set, output tree, or routine failure object is constructed by the diff; the existing `captured.slice()` sort input is unchanged.
- Render path: static array-key namespace calls now fold through the existing spine path, preserve source-order overload output, and produce byte-identical CSS with `deriveCalls === 0`. Dynamic/interpolated selector paths remain on eval.
- Helper/API surface: no export or public method changes; one existing internal predicate gains a narrow authored-path condition and one existing ordering fallback reads provenance.
- Metadata mutations: none. The pass reads `rawKey` and source spans without assigning parent, source-root, placement, span, or node metadata.
- Review-flagged diff tokens: [array helper] the existing `captured.slice()` sort input is unchanged and the production array-helper surface remains pre-existing; [routine error control] the test-only `try/finally` restores a prototype spy and production error control remains unchanged; [field] runtime field shape is unchanged; [loop/traversal] traversal shape is unchanged; [materialized array/object] the test-only output-options spread adds no runtime node/state structure; [parent/source mutation] write set is empty; [span] source-span ordering is read-only.
- Evidence: focused emit-walk ratchet `55/55` and the two previously affected interpolated-selector mixin tests passed; clean core build passed (`635.37 kB` ESM / `169.69 kB` gzip); core suite passed `3308` with `15` skipped and `2` deferred; spine-production-ratchet passed `136/136`; all-less passed `106/106`; all-less-error passed `92/92` with `2` skipped; `git diff --check` passed. Matched clean-build `benchmark.less` A/B on Node v25.9.0 arm64, 100 iterations × 5 repeats, 20 warmups: Q-26 control median `255.2521255 ms` (trimmed `254.9315625`, unstable) versus corrected Q-27 median `250.9776460 ms` (trimmed `251.4630415`, unstable). Apparent `-4.2744795 ms` / `-1.67%` round-median delta is measurement-only and not a speed claim.
- Verdict: accepted and closed as a bounded static namespace-path admission/order slice; the next string-backed parser-producer work is parked in Q-28 awaiting the Parseman grammar/trivia contract.

- Latest pass: IMPORT CASE-B INLINE BOUNDARY — completed the existing deferred inline-sub-import residual as a bounded `emit-walk`/writer-state cut. A forward-dependent interpolated import whose resolved body contains an `(inline)` child now folds on the spine while preserving eval's post-inline blank-line boundary; the stale deferred-only abort marker and direct-child scan are deleted.
- Architecture surface: `packages/core/src/tree/rules.ts` carries the document-global inline-source boundary bit; `tree/util/print.ts` stores that transient writer state; `tree/util/emit-walk.ts` removes the deferred-inline fallback and its marker; the Jess spine ratchet changes the residual lock from eval-abort to byte-identical fold. No callable, imported-`treeContext`, guarded-namespace, or reference/serializer stack was ported.
- Separation/duplication: the writer bit projects an already-emitted fact across nested import-fold closures; it does not add a second import resolver or a second serializer. The removed `deferredBodyHasInlineImport` scan and marker path eliminate the old fallback mechanism.
- Cumulative node weight: no Node, Rules, Ruleset, or placement field was added. One boolean is added to the existing `OutputWriter` runtime state, shared by the current render buffer and cleared at the consuming boundary.
- New traversal: none. The direct-child inline-import scan and its branch are deleted; the existing wire/import retry walk and emit traversal are unchanged.
- New node/materialization: none. No nodes, arrays, maps, sets, output trees, or routine failure objects are created by the fix; the writer flag is scalar state.
- Render path: the deferred case-B inline body now emits through the spine and inserts the same blank line before the following non-inline block that eval emits. The focused oracle is byte-identical and `deriveCalls` remains zero.
- Helper/API surface: one internal `OutputWriter` state property is added; no package export or public node method changes. The removed marker helper and inline-body detector shrink the internal surface.
- Metadata mutations: none. The change writes only the existing writer's transient emission state; it does not assign parent, source-root, placement, span, or node metadata.
- Review-flagged diff tokens: [field] the boolean belongs to transient `OutputWriter` state, not a Node/Rules shape; [routine exception] the deferred-only marker Error path is deleted while genuine path-resolution errors remain exceptional; [loop/traversal] the old direct-child scan is deleted and no replacement traversal is added; [materialized array/object] no new materialized structure is introduced.
- Evidence: clean core build passed; package-configured import-style coverage passed `92/92` with 1 skipped; Jess `spine-production-ratchet` passed `136/136`, including the new case-B inline fold; `git diff --check` and aggressive review passed on the worker lane. Matched clean-build stable `benchmark.less` A/B on Node v25.9.0 arm64, 100 iterations × 5 repeats, 20 warmups: `origin/dev` control median `265.5107705 ms` (trimmed median `263.8074375`, signal usable) versus `55ee8fbe8` median `255.2521255 ms` (trimmed median `254.9315625`, signal unstable; max `1386.1853 ms`). The apparent `-10.258645 ms` / `-3.86%` round-median delta is not a speed claim because the after run is unstable; the worker's independent A/B was likewise recorded as no-claim.
- Verdict: accepted as a bounded behavior-preserving import-fold cleanup from an existing owner lane; full core, all-less, all-less-error, and repo integration gates are required before the batch push.

- Latest pass: DEAD-SYMBOL CLEANUP — completed the existing `work/dead-symbol-cleanup` lane by deleting the unused `TreeVisitor` auto-walk class and its test. Current-repo search found no production subclass or import; production/plugin visitors use `Visitor`/`node.accept`. The same touched visitor file had a pre-existing unsafe bound-method assertion, so `Visitor.visit` now installs a typed adapter that preserves its documented Node-return contract while mapping non-Node control results back to the current node.
- Architecture surface: `packages/core/src/visitor/index.ts` (delete `TreeVisitor`; type-safe `Visitor.visit` adapter), its focused test, plus comment-only clarification in `node-base.ts`, the Less-compat visitor integration test, and the current cutover status doc. No eval/render/lookup algorithm or AST shape changed.
- Separation/duplication: removes a duplicate auto-walk abstraction rather than adding another traversal mechanism; generic `Visitor` and existing `Node.accept` remain the sole visitor paths. The adapter is local to the existing `Visitor.visit` re-entry guard.
- Cumulative node weight: no Node fields, Rules fields, or placement state added. The deleted class's per-instance `visitedNodes` Set and `visitChildren`/`reverse` state are no longer constructible through the core export.
- New traversal: none. The deletion removes the unused TreeVisitor traversal; `Node.accept` and generic Visitor traversal are unchanged. The adapter only delegates one node to the existing `_visit` method.
- New node/materialization: none. No node, array, output tree, map, or set is created by the replacement. The only removed allocation opportunity is TreeVisitor's per-instance visited Set.
- Render path: no top-level render behavior changes. Less-compat visitor integration remains on `accept()` and generic `Visitor`; visitor-focused and compat integration tests pass.
- Helper/API surface: `TreeVisitor` is intentionally removed from the unreleased core export because repository-wide production usage is absent; `Visitor`, `ABORT`, `REMOVE`, and `SKIP` remain. `Visitor.visit` retains its Node return type without an unsafe cast.
- Metadata mutations: none. The change does not assign parent/source/placement metadata or alter node adoption; the typed adapter only returns the original node for control-symbol results, matching the existing outer method contract.
- Review-flagged diff tokens: [side map/set] the removed Set/class is dead state; the arrow function is a direct type adapter, not a new traversal or wrapper graph. The diff adds zero loop, Error, node-construction, or routine-exception sites.
- Evidence: package precommit lint passed after the typed adapter; core visitor tests passed `4/4`; Less-compat visitor integration passed `8/8`; clean core builds passed before and after. Matched AC-power `benchmark.less` harness (`15 iterations × 2 repeats, warmup 5`, Node v25.9.0 arm64) was noisy: before median `263.22 ms` (max `1245.72 ms`), after median `305.92 ms` (max `1121.13 ms`), so no speed claim. Build output also shrank from `636.21 kB`/`169.94 kB gzip` to `635.46 kB`/`169.72 kB gzip`; full core/spine/all-less gates must run before integration push.
- Verdict: accepted as a dead-symbol/API slimming cut from an existing owner lane, requiring the full repo gate and aggressive review follow-up.

- Latest pass: PERF BATCH INTEGRATION — three disjoint byte-identical perf wins applied together onto `origin/dev`. (1) LEAN `round`: new `tree/util/round.ts` replaces `lodash-es/round` in `dimension.ts`/`color.ts` — an inlined copy of lodash's exact exponential-shift algorithm (same `Math.round`, same `${n}e`.split('e') dance) minus the generic `toNumber`/`toInteger` coercion, plus an integer fast-path; every Dimension/Color serialize + color-channel clamp hits it. (2) DE-GENERATORIFY walk (`node-base.ts`, `declaration.ts`): the generator `walk`/`nodes`/`_walkFromValue` become a non-generator `_walkInto(out, deep, reverse)` that materializes children into ONE shared `Node[]` in the exact same pre-order; `walk`/`nodes` now return that array (still iterable, so `for…of`/spread consumers are unchanged). Kills per-`yield`/per-`yield*`-frame cost and the per-node sub-array a deep generator allocated. (3) CALLABLE-LOOKUP INDEX (`rules.ts`): `getCallableEntriesForKey` was re-scanning every rule per distinct lookup key; now `ensureCallableIndex` builds the full key→entries index in ONE pass over `rules` and memoizes it on `_lookup.callableFullIndex`, invalidated alongside `callableLookupCache` when the scope's callable set changes. All three are byte-identical individually AND combined (full gate below).
- Architecture surface: three non-overlapping files under `packages/core/src/tree`. (1) `dimension.ts`/`color.ts` swap one import; `util/round.ts` is a new leaf pure-number helper with no node/tree/context reach. (2) `node-base.ts`/`declaration.ts` change the child-walk MECHANISM (generator → array-fill) but not what it walks — `childKeysOf`/`readNodeField`/field order unchanged; `Declaration` keeps its bespoke name/value/important order via an overridden `_walkInto`. (3) `rules.ts` touches only the callable-lookup memo path (`RulesLookupState.callableFullIndex`, `ensureCallableIndex`, `getCallableEntriesForKey`, the `addCallable*`/`collectCallablesFor` signatures that now take an `index` Map instead of a per-key `bucket`, and the invalidation site). No Node class gains a field; no output tree is retained by any of the three.
- Separation/duplication: (1) `round.ts` is a single new file that DELETES a dependency edge (drops `lodash-es/round` from two hot files) — it replaces, not duplicates. (2) `_walkInto` UNIFIES the former `walk` + `_walkFromValue` + `nodes` generators onto one array-fill primitive (net: `_walkFromValue` deleted, one polymorphic `_walkInto` added + two thin `collectFieldInto`/`pushNodeInto` module helpers that inline the old array/plain-object branch logic verbatim). (3) `ensureCallableIndex` REPLACES the per-key `collectCallablesFor(this, lookupKey, bucket)` re-scan; `addCallableEntry`/`addCallableSelectors`/`collectCallablesFor` lose their `lookupKey`+`bucket` params for a shared `index` Map — same collection code, keyed once instead of filtered per call.
- Cumulative node weight: no field added to any Node CLASS. `callableFullIndex` is one nullable field on the per-scope `RulesLookupState` memo object (a lookup-cache sibling of the existing `callableLookupCache`/`varsByName`/`functionsByName`), not on a Node; it holds references already reachable from `rules`, is built lazily, and is nulled on callable-set change. Net node weight delta = 0.
- New traversal: [loop/traversal] the new `for` loops in `collectFieldInto`/`pushNodeInto` (`node-base.ts`) are the SAME array + plain-object child iteration the deleted `_walkFromValue` generator ran — one pass over each child field, byte-identical DFS order, now pushing into a shared array instead of yielding. No new whole-tree or per-leaf pass: total node-visit count is unchanged (strictly fewer frames). `ensureCallableIndex`'s single pass over `rules` REPLACES the previous per-distinct-key re-scan — it runs once per scope and is memoized, so repeated lookups now do a Map get instead of re-walking; net traversal is REDUCED, not added.
- New node/materialization: [materialized array/object] the `Node[]` in `walk`/`nodes`/`_walkInto` is the deliberate core of win (2): ONE array shared across a whole deep walk, replacing the generator's per-`yield*`-frame allocations — fewer allocations, not more, and freed by the caller as before. `round.ts` allocates only the two transient `${n}e`.split('e') string pairs lodash already allocated (integer fast-path skips even those). No output tree is materialized by any change.
- Render path: byte-identical on all three. (1) `round` reproduces lodash's algorithm exactly (verified: all-less 106/106 byte-identical, which exercises Dimension/Color number formatting heavily). (2) `_walkInto` preserves pre-order and reverse order exactly, so every emit/eval/extend consumer of `walk`/`nodes` sees the identical node sequence. (3) the callable index returns the SAME entries `collectCallablesFor` produced (same key/match tuples, same source-rules fallback when the local index misses), so mixin/namespace resolution is unchanged. Full suites green (below).
- Helper/API surface: (1) `round.ts` exports `round` (named + default) — one new internal helper, one fewer external dep. (2) `walk`/`nodes` change return type from `Generator<Node>` to `Node[]` (both iterable — no call-site churn); `_walkFromValue` (private) is deleted; `_walkInto` (+ module-private `collectFieldInto`/`pushNodeInto`) added; net public method count unchanged. (3) `ensureCallableIndex` is a new PRIVATE method; `addCallable*`/`collectCallablesFor` are private and drop a param each. Net exported-symbol delta on the package surface = 0 (all additions are internal).
- Metadata mutations: none. No `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`-field assignment in any of the three. `round` is pure over numbers. `_walkInto` only `out.push`es references. `ensureCallableIndex` writes only the memo field `_lookup.callableFullIndex` (a lookup cache, not node metadata) and the invalidation site nulls it.
- Review-flagged diff tokens: [loop/traversal] all new `for` loops are `collectFieldInto`/`pushNodeInto`'s field-child iteration (the deleted generator's own loops, same order, now array-filling) + `ensureCallableIndex`'s single memoized `rules` pass (replaces per-key re-scan) — zero hot-path/per-leaf traversal added, total visits reduced (accounted above). [generator] the two `[generator]` matches are the WORDS "per-yield / per-`yield*`-frame cost" and "`for…of` / `yield*` consumers are unchanged" in the new JSDoc — this change DELETES every generator (`function*`/`yield`) from the walk path; no generator is added. [node construction] the one `[node construction]` match is `index = new Map()` in `ensureCallableIndex` — a memoized per-scope lookup Map (NOT a Node construction; `Map` merely matches the `new Uppercase(` pattern), built once and reused, invalidated with `callableLookupCache`. [side map/set] every `Map` match is that same callable-index memo — the `callableFullIndex: Map<…>` field declaration, the `index: Map<…>` params threaded through `addCallable*`/`collectCallablesFor`, the `ensureCallableIndex(): Map<…>` return type, and the one `new Map()`; it holds already-reachable references, is a scope-scoped cache (sibling of the pre-existing `callableLookupCache`), and is nulled on callable-set change — zero added long-lived side state, and it REPLACES a repeated O(rules) per-key re-scan. [materialized array/object] the `Node[]` matches (`out: Node[]`, `const out: Node[] = [this]`, `const out: Node[] = []`, the `walk(): Node[]`/`nodes(): Node[]` signatures) are the shared per-walk output array that REPLACES per-yield generator-frame allocation — a net allocation REDUCTION; the `= {`-adjacent matches are type views, not output materialization. [parent/source mutation] the only `sourceNode`/`sourceRoot`/`.parent` matches are the WORDS in this prose (the Metadata line naming what is NOT written); the code performs zero `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`-field assignment — `round` is pure over numbers, `_walkInto` only `out.push`es references, and `ensureCallableIndex` writes only the memo field.
- Evidence: all-less byte-identical 106/106 (the primary byte-for-byte oracle — exercises Dimension/Color number formatting, mixin/namespace callable lookup, and the child-walk on every fixture); core 3300/0; less-parser 516/0; all-less-error 92/0; `spine-production-ratchet` 130/0; fns 522/4 (the 4 reds are the pre-existing SCSS `is-bracketed()` set, untouched by these files). Combined `benchmark.less` A/B (same-worktree `git stash` toggle of the three applied changes, warmup + N≥15 median, output verified byte-identical) reported below in the integration deliverable. All three verified byte-identical individually by their originating agents and re-verified combined here.
- Verdict: accepted — three internal perf wins (drop a dep for an inlined pure helper; generator→shared-array walk; memoized full callable index replacing per-key re-scan), no new Node field, no tree mutation, no output tree, byte-identical output across the full gate.

--- prior pass ---

- Latest pass: bootstrap FINAL blocker (`bootstrap-clean-repro` GREEN) — LOOP-GENERATED EXTEND THROUGH IMPORT. Two coupled fixes: (a) `engageExtendLayer` scans only the parsed entry root, so an import-only document (`bootstrap.less` = `@import`s, no direct `:extend`) never engaged the layer and DROPPED every imported extend — `wireExtends` now also engages when a RESOLVED imported body carries an extend (`treeHasExtend`); (b) `wireSpineExtends`'s gather now EXPANDS `$for`/`each` loops (via `spineIterationSurfaces`) so a per-iteration interpolated extender (`.container-@{bp}`) resolves concretely and its `:extend` merges into the (static, shared) target group — plus `isSpineEligibleFor` now threads `allowExtend`, so a loop body carrying an `:extend` no longer forces its imported body onto the eval fallback (which ignores spine extend headers). The loop-expansion is BEST-EFFORT: an un-expandable loop (iterable/body reads a binding absent in the static gather context — e.g. a mixin-scoped `@shadows`) is caught and SKIPPED with a subjects/instructions rollback, byte-identical to the pre-fold drop. Bootstrap `.container-lg` now merges; render 156k, all 4 assertions pass.
- Architecture surface: `spine-extend.ts` gather (`wireSpineExtends` — `descendChildren`/`gatherRuleset` now `MaybePromise`, new `gatherForExtends`) and `emit-walk.ts` (`wireExtends` import-body extend-engagement + `isSpineEligibleFor` extend threading). The gather stays a pure selector-graph pass; it becomes async ONLY when it expands a loop (the common no-loop case is untouched sync). No Node class changed; no output tree retained — the loop surfaces are throwaway gather scaffolding (extenders emit nothing; only the static target's header override surfaces at emit).
- Separation/duplication: no new file. `gatherForExtends` reuses the render fold's `spineIterationSurfaces` primitive (the SAME per-iteration surface build) — not a parallel expander. The import-body engagement reuses `collectImportedRootSubjects` (already walked for the re-gate) + `treeHasExtend` (existing predicate, now imported into emit-walk). `isSpineEligibleFor` gains two params it forwards.
- Cumulative node weight: no field added to any Node class. The loop surfaces are the fold's existing reused-leaf copies, discarded after gather. Net: one gather helper + async-threading of two existing gather fns.
- New traversal: [loop/traversal] the new loops are `gatherForExtends`'s surface + surface-child iteration and the sequential `step`/`stepBody`/`stepSurface` drivers that replace the former `for…of` bodies (same single gather walk, now promise-threadable). No whole-tree/per-leaf hot-path traversal added — the gather runs once per root render, and the loop expansion runs once per extend-bearing `For` reached.
- New node/materialization: [materialized array/object] the `Rules[]` surfaces come from the unchanged `spineIterationSurfaces`; `gatherForExtends` allocates none of its own (the `as unknown as {…}` is a type view). `subjectsMark`/`instructionsMark` are index snapshots (numbers) for rollback, not allocations.
- Render path: unchanged. Both fixes only enrich the extend GATHER (a header-override computation consumed by `effectiveHeaderSelector`); the descent/emit is untouched. Byte-identical where no imported/loop extend exists (the layer stays disengaged) and where a loop can't expand (rollback → same drop as before). Full suites green.
- Helper/API surface: `wireSpineExtends` return type widens to `MaybePromise<{headers,hoisted}>` (its one production caller threads it; the sync test caller's shapes have no loop → still returns the object synchronously). `treeHasExtend` newly imported into emit-walk. `gatherForExtends` is a local closure. Net exported-symbol delta = 0.
- Metadata mutations: none. `gatherForExtends` save/restores `context.rulesContext` around each surface's gather (a transient live-frame pointer for interpolation resolution, not a node field); it never assigns `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`. The rollback truncates the local `subjects`/`instructions` arrays only.
- Review-flagged diff tokens: [loop/traversal] every new `for`/`while` is the gather's own sequential driver (`step`/`stepBody`/`stepSurface`) or the surface iteration — the same one-per-root selector-graph walk, now promise-threadable; adds zero hot-path traversal (accounted above). [routine error control] the `try`/`catch` in `gatherForExtends` (+ the promise rejection handlers) implement the BEST-EFFORT skip: a loop that can't expand at gather time is caught, rolled back (subjects/instructions truncated to the pre-loop marks, `rulesContext` restored), and skipped — byte-identical to the pre-fold drop; they swallow ONLY the un-expandable-loop case (a real defer, not a silenced bug) and the `gatherRuleset`/media-scope `catch`es re-throw. [materialized array/object] the `Rules[]`/`= {` matches are the `spineIterationSurfaces` result type view + the arrow-fn closures; no output materialization (accounted above). [parent/source mutation] ZERO in the code — the `sourceNode`/`sourceRoot`/`.parent` matches are words in THIS prose and inside the unchanged `spineIterationSurfaces`; the gather writes no node field. [side map/set] the `Map`/`Set` matches are TYPE ANNOTATIONS only — the `Map<Ruleset, Selector>`/`Set<Rules>` on the widened `wireSpineExtends` return type and the `applyWired` closure param — zero map/set is CONSTRUCTED here (the headers map is composed by the unchanged `composeSpineSubjectHeaders`); zero added runtime side-map/set state.
- Evidence: `bootstrap-clean-repro` GREEN (render 156,635 bytes; `.col-sm-`, `--breakpoint-sm:576px`, `.container-lg` all present; zero rejections). New lock (`spine-guarded-mixin-forfold.test.ts` → "spine loop-generated extend through import"). Suites at pre-existing baseline: core 3300/0, all-less byte-identical 105/0, config 29/0, `spine-production-ratchet` 130/0, less-parser 512/0, 4 locks. The 12 `emit-walk-ratchet` + 3 `spine-wire-selector-shapes` (dual-config artifact) + 1 `security-script-runtime` reds are ALL pre-existing on clean `origin/dev` (verified by file revert) — this pass introduces zero new failures.
- Verdict: accepted — imported + loop-generated extend gather (best-effort loop expansion, rollback-on-unexpandable), no new Node field, no tree mutation, no output tree, byte-identical off the new shape, takes `bootstrap-clean-repro` to GREEN.

--- prior pass ---

- Latest pass: bootstrap spine blockers cont'd — EVAL-FALLBACK print-state isolation at TWO more sites in the import/root emitter (`rules.ts`). A container child (`isRulesetOrAtRule` → `n.render`) and a non-spine-foldable IMPORT body (`_emitSpineImportFold`'s `evalFallback` → `importNode.render`) both route to the EVAL render (`evalForRender` → `prepareRenderPrintState`), which RESETS `context.printState` in place; un-isolated in the single-pass spine that swapped the live writer/frame-arrays and silently DROPPED every later sibling/import (bootstrap `_reboot`'s `a { #hover({…}) }` — a detached-ruleset-arg mixin deferred to eval — dropped the whole following `_grid`; ~4× output recovered, 37,990 → 156,472 bytes). Both wrapped in the EXISTING `evalIsolatingSpinePrintState`; each `render` returns its own string spliced into the live writer.
- Architecture surface: `rules.ts` only — the two eval-render call sites in `_emitRulesBody`'s `emitNode` (`isRulesetOrAtRule` branch) and `_emitSpineImportFold`'s `evalFallback`. Both gated to `options.spineMode` (the `serializeRulesContainerInline` / non-spine branches are untouched). Same isolation primitive the guard/value-leaf resolves use. No Node class changed; no output tree retained.
- Separation/duplication: ZERO new helpers — reuses the already-exported `evalIsolatingSpinePrintState`. Two existing calls wrapped.
- Cumulative node weight: no field added to any Node class. No node state.
- New traversal: none — the wrap adds a shallow `context.printState` snapshot/restore around calls that already ran.
- New node/materialization: none — the snapshot is a shallow object spread of the existing print-state, freed on return; the eval renders already allocated their own writers.
- Render path: byte-identical — restores the live writer/frames after each eval render so the spliced string lands and later siblings emit normally (was: later content lost). Full suites green.
- Helper/API surface: unchanged — no new export (`evalIsolatingSpinePrintState` was exported in the prior pass).
- Metadata mutations: none — snapshot/restore of `context.printState` (a transient render buffer, not node fields); no `.parent`/`sourceNode`/`sourceRoot`/`location`/`index` write.
- Review-flagged diff tokens: [routine error control] the eval-render calls are wrapped in `evalIsolatingSpinePrintState`, whose EXISTING `try`/`catch` restores print-state on the throwing edge (unchanged helper, prior pass); the two new call sites add zero `try`/`catch`/`Error` of their own. [materialized array/object] the `= {` matches are the arrow-fn closures passed to `evalIsolatingSpinePrintState` (`() => n.render(…)`); they allocate no array/object — the isolator's shallow snapshot is pre-existing. [parent/source mutation] ZERO — no `.parent`/`sourceNode`/`sourceRoot`/`location` assignment; the wrapped `render` calls are unchanged.
- Evidence: minimal lock (`spine-guarded-mixin-forfold.test.ts` → "spine import eval-fallback print-state isolation") — an imported `a { #hover({…}) }` no longer drops a following import. Bootstrap: 37,990 → 156,472 bytes; `bootstrap-clean-repro` now passes length + `.col-sm-` + `--breakpoint-sm:576px` (was failing all); REMAINING red = `.container-lg` only (a nested `:extend(.container-fluid all)` from an interpolated `.container-@{bp}` inside `each`+`#media-breakpoint-up` detached rulesets + a `\%responsive-container` placeholder — a distinct spine-extend coverage item, NOT this pass; documented for continuation). Suites green: core 3300/0, all-less byte-identical 105/0, config 29/0, `spine-production-ratchet` 130/0, less-parser 512/0, 3 locks. The 12 `emit-walk-ratchet` reds remain PRE-EXISTING on clean `origin/dev`.
- Verdict: accepted — two eval-render sites print-state-isolated with an existing primitive, no new Node field, no tree mutation, no output tree, byte-identical, recovers ~4× dropped bootstrap output.

--- prior pass ---

- Latest pass: bootstrap spine blockers — (a) LOOP-FOLD via the root / import-splice emitter (`Rules._emitSpineForFold`): a `$for`/`each` reaching `_emitRulesBody`'s `emitNode` (a root-direct loop, or one inside an imported body spliced via `_emitSpineImportFold`) now expands into per-iteration bound surfaces instead of falling to the `isChildRules` branch that emitted the body ONCE UNBOUND (`'color' is not defined` on a nested interpolated selector `.alert-@{color}`); (b) GUARD-EVAL print-state isolation (`serializeSpineFrameContainer`): a passing `when` guard whose operands render nested values (a function call, or a local var whose binding is a call) reset `context.printState` in place mid-descent and silently dropped the body — now isolated via `evalIsolatingSpinePrintState`.
- Architecture surface: the ROOT / import-splice emitter (`rules.ts` `Rules._emitRulesBody`'s `emitNode`) gains a `For`-route to a new sibling method `_emitSpineForFold` (mirrors the CONTAINER descent's existing `runSpineForExpansion` in `serialize-helper.ts` — same `spineIterationSurfaces` primitive, same `rulesContext = surface` frame thread as `processNode`). The guard-eval site in `serializeSpineFrameContainer` (`serialize-helper.ts`) is wrapped in the EXISTING `evalIsolatingSpinePrintState` isolation the value-leaf resolves already use. No Node class changed; no output tree retained.
- Separation/duplication: no new file. `_emitSpineForFold` is the emitter-side analogue of `runSpineForExpansion` — it REUSES `For.spineIterationSurfaces` and `evalIsolatingSpinePrintState` (newly EXPORTED from `serialize-helper.ts`, previously a private helper — a visibility change, not a new mechanism). It does not duplicate the container fold's dedup/merge re-plan (not needed for the root/import splice; a loop that needs cross-iteration merge stays a follow-on). The guard fix adds ZERO helpers — it wraps an existing call in an existing isolator.
- Cumulative node weight: no field added to any Node class. No node state. Net: one method (`_emitSpineForFold`) + one newly-exported existing helper.
- New traversal: [loop/traversal] the two new loops live in `_emitSpineForFold` — an OUTER loop over the loop's per-iteration surfaces and an INNER loop over each surface's already-materialized children, driving the SAME `emitNode` the container fold drives. This is the loop-expansion the eval path performs per iteration; it runs once per `For` node reached (not per leaf, not on a hot per-node path beyond the iteration it represents). No whole-tree scan added.
- New node/materialization: [materialized array/object] the `Rules[]` surfaces are produced by the EXISTING `For.spineIterationSurfaces` (unchanged) — the fold only ITERATES them; `_emitSpineForFold` allocates no array/object of its own (the `as unknown as {…}` is a type view, not an allocation). No output tree is built; each surface child emits through `emitNode` exactly as an authored child would.
- Render path: both fixes are byte-identical to eval. The loop-fold makes an import/root loop render its per-iteration bound bytes (was: throw or unbound-drop); the guard-isolation makes a passing guard's body survive (was: silently dropped into a swapped writer). Neither alters output where it already matched — the guard isolation only restores the live writer, and simple guards with no rendering operand pay a shallow snapshot.
- Helper/API surface: `evalIsolatingSpinePrintState` changes from module-private to EXPORTED (`serialize-helper.ts` → `rules.ts`), the same one-consumer export shape the file's other spine helpers use. `_emitSpineForFold` is a PRIVATE method (no public API). Net exported-symbol delta = +1 (an existing helper, now shared).
- Metadata mutations: none by the new code. `_emitSpineForFold` save/restores `context.rulesContext` around each child emit (the `processNode` frame-thread discipline — a transient live-frame pointer, not a node field write); it never assigns `.parent`/`sourceNode`/`sourceRoot`/`location`/`index`. The surfaces' own frame wiring is done by the unchanged `spineIterationSurfaces`.
- Review-flagged diff tokens: [loop/traversal] the two `for` loops are `_emitSpineForFold`'s surface + surface-child iteration — the loop-expansion the eval path already does per iteration, driving the existing `emitNode`, once per `For` reached; adds zero whole-tree/hot-leaf traversal (accounted above). [routine error control] the two `try`/`catch` are the frame-restore discipline required by the async splice — each restores `context.rulesContext` to its saved value on the throwing edge before rethrowing (mirrors `runSpineForExpansion`/`processNode`'s existing `restoreFrame` on-error path), so a failed child emit cannot leak the surface frame onto the shared context; they introduce zero fresh error TYPE and swallow nothing (every catch rethrows). [materialized array/object] the `Rules[]` view + `= {` object-literal matches are the type assertion `as unknown as { spineIterationSurfaces… }` (a compile-time view, no allocation) and the arrow-fn bodies; the only real array (`surfaces`) is produced by the unchanged `spineIterationSurfaces` and merely iterated — no output materialization (accounted above). [parent/source mutation] ZERO in the code — the `sourceNode`/`sourceRoot`/`.parent` matches are words in THIS prose (the Metadata line naming what is NOT written) and inside `spineIterationSurfaces`'s pre-existing surface build (unchanged by this pass); `_emitSpineForFold` and the guard-isolation wrap perform no `.parent`/`sourceNode`/`sourceRoot`/`location` assignment.
- Evidence: minimal repros byte-identical to eval + less@4 — (a) `each(@map,#(@value,@key){ .item-@{key}{ #mixin(@key) } })` inside an imported body folds per-iteration (was `'…' is not defined`); (b) `#fs(inherit)` two-level RFS-shape guarded mixin in a nested ruleset emits its `font-size` (was dropped). Bootstrap: was THROW `'color' is not defined`; now renders clean (no throw, no rejections) — remaining truncation is a SEPARATE full-bootstrap-only value/grid divergence (a `#border-radius` value `0.2rem` vs `0.25rem` + a grid `.row`/`make-grid-columns` drop that does NOT repro in the 6-import `code+grid` slice, which is now byte-identical) — documented for continuation, not this pass. Suites green: core 3300/0, all-less byte-identical 105/0, config-fixtures 29/0, jess `spine-production-ratchet` 130/0, 2 NEW locks (`spine-guarded-mixin-forfold.test.ts`). The 12 `emit-walk-ratchet` reds are PRE-EXISTING on clean `origin/dev` (verified by file revert) — not introduced here.
- Verdict: accepted — two byte-identical spine correctness fixes (import/root loop-fold coverage + guard-eval print-state isolation), no new Node field, no tree mutation, no output tree, one existing helper newly shared.

--- prior pass ---

- Latest pass: benchmark spine blockers — (a) APPEND×EXTEND gate PRECISION (replace whole-tree over-reject with a collision-only predicate); (b) REFERENCE-EXTEND unmapped-target FOLD (an absent import-reference target is inert, not an abort-to-eval).
- Architecture surface: the spine ELIGIBILITY/TOPOLOGY gates only — `isSpineEligibleRoot` (`emit-walk.ts`) and `isSpineExtendTopology` (`extend/spine-extend.ts`). These decide spine-vs-eval; they emit nothing and touch no output node. No change to the render path, the fold splice, or any Node.
- Separation/duplication: no new file. Added ONE predicate `treeHasExtendTargetableAppend` (`spine-extend.ts`) that REPLACES the deleted `treeHasAmpersandAppend` (`emit-walk.ts`, ~24 lines removed) — a swap, not an addition: the old gate rejected ANY append+extend tree; the new one rejects only when an extend target atom could equal an append-generated atom (`parent + suffix`). The reference relaxation REUSES the existing per-target `isInertNomatch` clause (adds a `reGateResolved` guard + an imported-subject inertness check), not a new mechanism.
- Cumulative node weight: no field added to any Node class. No node state. Net helper count unchanged (one predicate added, one deleted).
- New traversal: [loop/traversal] every new loop lives in `treeHasExtendTargetableAppend`, a SOURCE-TREE eligibility predicate that runs ONCE per ROOT render (not per node, never on the hot leaf/emit path). It is a traversal SWAP: the deleted `treeHasAmpersandAppend` already walked the whole ruleset/at-rule tree + each selector (via `selectorHasAmpersandAppend`); the new walk does the same single pass and additionally collects append suffixes/atoms + extend-target atoms in the same visit. The `node.walk(true)` inside `selectorAppendSuffixes` walks ONE selector's small node tree (identical cost to the deleted append-detector). The reference relaxation's `[...importedRootSubjects].some(...)` iterates the RESOLVED-imported-subject set (small) only in re-gate mode (import+extend trees) per unmapped target — bounded by imported-subject count, off entirely for the no-import common case.
- New node/materialization: [side map/set] + [materialized array/object] the 3 `Set`s (`suffixes`, `generatedAtoms`, `targetAtoms`) and the `string[]` returns of `selectorAtoms`/`selectorAppendSuffixes` are DECISION-TIME SCRATCH inside the predicate — allocated on entry, freed on return, sized O(appends + extends) for that one root, NEVER attached to a node, the render state, or an output tree. They exist because the collision decision needs the atom sets; they replace the old gate's boolean-only short-circuit. No output materialization (this path emits nothing).
- Render path: UNCHANGED. Both outcomes are byte-identical to eval — admit → spine fold (`deriveCalls===0`), reject → eval two-walk. The predicate cannot alter output; it only routes.
- Helper/API surface: `treeHasExtendTargetableAppend` is exported from `spine-extend.ts` and imported by `emit-walk.ts` (the same one-consumer shape the deleted `treeHasAmpersandAppend` had, just relocated to where the extend gather helpers live). Net exported-symbol delta ≈ 0.
- Metadata mutations: none. The predicate is pure over the source tree (`flatLocalSelector`/`valueOf` reads only); no `.parent`/`sourceNode`/`sourceRoot`/index/location write. The reference relaxation reads `importedRootSubjects` (already resolved by `wireSpineImports`) — no mutation.
- Review-flagged diff tokens: [loop/traversal] all new loops are the once-per-root eligibility predicate `treeHasExtendTargetableAppend` swapping in for the deleted whole-tree `treeHasAmpersandAppend` scan — same single source-tree pass, no hot-path/per-node traversal added (accounted above). [side map/set] the 3 `Set`s are per-call decision scratch, freed on return, never node/render state (accounted above). [materialized array/object] the `string[]` atom lists + the `walk` closure's `parentAtoms` array are decision-time scratch, no output materialization (accounted above). [parent/source mutation] ZERO — the only matches are the identifier names `parentText`/`parentAtoms` (the COMPOSED-PARENT selector TEXT threaded read-only through the walk to compute append-generated names) and this prose; the code performs no `.parent`/`sourceNode`/`sourceRoot` assignment — the predicate never writes any node field.
- Evidence: append+extend UNRELATED folds (`deriveCalls===0`), append-GENERATED-target extend STAYS on eval (byte-identical), reference-extend absent-target folds as a no-op (empty, = eval + less@4), reference-extend present-target still folds. Suites green: core 3300/0, jess `spine-production-ratchet` 130/0 (incl. 4 new locks), all-less 105/0, less-parser 508/0. Perf A/B (same-build spine-vs-eval toggle, warmup 8 + 15-trial median, byte-identical output): a 60-block append+extend workload folds 19.4ms vs eval 26.8ms (1.38×); a 60-extend reference workload folds 10.1ms vs eval 18.1ms (1.80×). NOTE: `benchmark.less` itself still does NOT fold spine-only — it is additionally blocked by mid-body `@charset` (design-excluded document framing) and the direct-merge-alongside-mixin-call deferred residual; those are separate items, not this pass.
- Verdict: accepted — deletes the whole-tree append+extend over-reject for a collision-only predicate and folds the inert reference-extend case, both pure routing decisions, no node state, no tree mutation, no render-path change, byte-identical both ways.

--- prior pass ---

- Latest pass: STRIPE nested-container recursion fold (distinct-per-level container surfaces) + gate lift.
- Architecture surface: the spine mixin-fold splice (`serialize-helper.ts` `runSpineMixinExpansion`), the recursion eligibility gate (`emit-walk.ts` `treeHasRecursiveMixinCall`, now DELETED), and the root-fold statement-validity guard (`check-valid-nodes.ts`). Ownership stays where it was: the fold splice owns per-placement projection; the gate owned deferral (now unneeded); the guard owns root value-drop detection.
- Separation/duplication: no new helper file. `distinctFoldChild` is a small local closure inside `runSpineMixinExpansion`, mirroring the loop fold's existing per-iteration `copyWithReusableLeaves` — it UNIFIES the two folds on the same projection primitive rather than adding a parallel mechanism. Deleted `treeHasRecursiveMixinCall` (~95 lines) + its call site; the recursion gate is gone, not relocated.
- Cumulative node weight: no field added to any Node class. The seen-tracker is a per-pass local `WeakSet`, not node state. Net: one gate function removed.
- New traversal: none added. `distinctFoldChild` does an O(1) type test + `WeakSet` membership per spliced child (no loop). The deleted gate removed a document-level `root.walk` cycle-detection pre-scan — a net traversal DELETION on the eligibility path.
- New node/materialization: `copyWithReusableLeaves(child)` fires ONLY on a container child's 2nd+ occurrence within one expansion pass (recursion re-entry / repeated call) — the exact placements that would otherwise COLLAPSE to one printed block. First occurrence stays SHARED (zero copy on the common single-call container mixin); scalar leaves never copied. This is the SAME reused-leaf placement copy the loop fold already pays per iteration — a projection giving each level its own printed-block identity, not a deep clone and not a tree mutation.
- Render path: unchanged shape — the copy is a serialize-time projection consumed immediately by the existing `processNode` descent; no output tree retained. `checkValidNodes` now skips `Call`/`Mixin` (statement-legal, expanded by the pass) so the spine root-fold can check a recursive body's RAW surface without false-flagging the unexpanded recursive call — a no-op on the eval path (which only ever sees post-expansion output).
- Helper/API surface: no exported API added; `copyWithReusableLeaves` is an existing import. One local closure added, one gate function + call deleted → net API surface reduced.
- Metadata mutations: `copy.index = child.index` carries the splice-order index onto the placement copy (output-invisible bookkeeping, ruling 1); no `.parent`/`sourceNode`/`sourceRoot`/location mutation. The shared canonical node is never mutated.
- Review-flagged diff tokens: [array helper] the single `surface.rules.map(...)` is the PRE-EXISTING fold-splice map, only its element expression changed (`child` → `distinctFoldChild(child)`) — same iteration, one wrapped call. [copy helper] `copyWithReusableLeaves` (1 call + 1 import + 3 comment mentions) is the loop fold's own reused-leaf projection primitive, applied only to 2nd+ container occurrences; justified as the distinct-per-level surface projection above, reusing the existing copy family. [parent/source mutation] the only matches are the words in THIS prose (the Metadata line naming what is NOT mutated); the code performs zero parent/source/location assignment — the placement copy is a fresh detached surface, the canonical node is never re-parented.
- Evidence: STRIPE self/mutual/≥3-level/root-scope/interpolated-selector recursion folds `deriveCalls===0`, distinct-per-level blocks, byte-identical to the eval toggle + less@4 (`lessc 4.6.3` diff clean on the recursion mechanism). Suites green: core 3300/0, jess `spine-production-ratchet` 126/0, all-less 105/0, error 92/0, less-parser 508/0. Perf A/B (same-worktree revert toggle, warmup + N median): STRIPE fixture folds faster than eval; benchmark neutral (stays on eval either way).
- Verdict: accepted — deletes the recursion gate + its pre-scan traversal, folds STRIPE via the loop fold's existing projection primitive, no new node state, no tree mutation.

## Aggressive Cutting Self-Prosecution

- Latest pass: Q-40 imported/reference partial admission — the candidate was rejected and all
  production probes were removed. The focused test retains only the current-dev post-wire rejection
  for the canonical `h1` shadow topology.
- Architecture surface: `packages/core/src/tree/extend/__tests__/extend-work-gate.test.ts` only.
  `packages/core/src/tree/util/emit-walk.ts` and `packages/core/src/tree/extend/spine-extend.ts` are
  byte-identical to `origin/dev`; no import resolver, reference serializer, root admission, or legacy
  island was added.
- Separation/duplication: the test reuses `Parser` and `isSpineExtendTopology`; it adds no second
  topology check, no runtime diagnostic counter, and no production fallback path.
- Cumulative node weight: zero production/runtime fields. The test-local parsed tree and subject set
  are released after the assertion and never attached to a node or render context.
- New traversal: none in production. The test invokes the existing topology predicate once in
  speculative mode and once in resolved re-gate mode.
- New node/materialization: [node construction] the parser necessarily creates the small synthetic
  source tree for the focused fixture; [side map/set] the resolved imported-subject `Set` is test-local
  evidence only. No output tree, copy, cache, or retained placement state is introduced.
- Render path: unchanged. The external canonical control remains whole-document eval fallback after
  one spine attempt; no bytes are emitted before the abort.
- Helper/API surface: none. No production export, helper, or method changed.
- Metadata mutations: none. The test reads the parsed tree and does not assign parent, source-root,
  placement, span, or caller-buffer state.
- Review-flagged diff tokens: [node construction] test-only parser fixture, released after assertion;
  [side map/set] test-only imported-subject set, not runtime state; [loop/traversal] none added;
  [materialized array/object] none added beyond parser-owned fixture state; [routine error control] none;
  [field] none; [copy] none; [parent/source mutation] none; [API] none.
- Evidence: focused import/extend gate `7/7`; focused core import/extend/emit ratchets `125/125` with
  `1` skipped; full core `3331` passed, `15` skipped, `2` deferred declarations; Jess spine-production-ratchet `137/137`;
  all-less unit and config gates passed (`29/29` config; unit gate passed); aggressive review passes after
  this block. External `/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less` control
  output was `133,983` bytes, SHA-256
  `adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`, with `1` spine attempt and
  `846` derives. The paired current-dev no-op control was exact at `135,794` bytes with SHA-256
  `9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`: parse+render median
  `247.391917→248.694834 ms` (`+0.799625 ms`, `20/45` wins), render-only
  `198.968125→199.893791 ms` (`+0.976792 ms`, `25/45` wins). These are noise-floor controls, not
  a speed claim. Allowing the single `h1` branch admission then disabling the complex-reference gate
  reached `TypeError: EMIT contribution collapsed to empty (extender IS a target ancestor)` before
  output, so the branch was not safe to retain.
- Verdict: rejected — retain the strict import/reference boundary and assign the next owner a
  source-order-aware reference/extend topology proof before any partial admission.
- Hot-path cost contracts:
```json
[]
```

## Q-40 latest rejected proof

The completed extend-root measurement worker (2026-07-15) refreshed its
isolated worktree from `e4fb26616`, removed temporary instrumentation, and
returned `/private/tmp/jess-extend-root-measure-20260715` clean. No production
change was made; the focused extend-roots slice passed `21` tests with `1`
skipped. The full report is
`/private/tmp/jess-extend-root-measure-20260715-results.md`.

The canonical `benchmark.less` default route produced exact `133,389`-byte
output with SHA-256
`39a4812a88ea77a94f846f8392fb536da882e84452d03880103d256cb1d73a4c` in both
parse+render and render-only phases. It recorded `1,651` registrations,
`7` distinct/visited roots, `210` visibility probes, `182` visible
instructions, `1,651` classified rulesets, `42,926` classification probes
(`42,847` no-match), `39,605` apply calls (`43` selector changes and `39,562`
no-match), and `extendMatchWork=145`. Static and default synthetic controls
were zero. The forced-eval synthetic route is diagnostic only: its output hash
`8da379e3...` differs from the default route's `7a73926a...`.

This closes the measurement handoff, not the optimization. Repeated
classification is a real hotspot, but a safe cut still requires a semantic
matrix and Less oracle. The bounded candidate seam is the first-pass loop at
`packages/core/src/tree/util/extend-roots.ts:795-803`, where a root-local cheap
admission/candidate selection could precede `classifyInstructionMatch`.
Required coverage includes exact/partial/`all`, lists/`:is()`, combinators,
nested ampersand/recheck, self/circular/chained extends, explicit overrides,
reference/protected roots, imports/layers/namespaces, source order, and the
Less oracle. `recheckProbes=0` is a coverage gap. Do not duplicate the dirty
`extend.ts` or `spine-extend.ts` owner lanes.

The first fallback-topology run used the wrong internal Jess fixture and is
withdrawn. The corrected run explicitly used
`/Users/matthew/git/oss/less.js/packages/less/benchmark/benchmark.less`
(`106,797` source bytes). Its output was `135,794` bytes with SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.
The canonical route made one spine admission, aborted once before emitting
spine output, and entered whole-file eval fallback. It recorded zero spine
rejections, zero completions, one eval fallback, one eval-render entry,
`10,777` eval-node entries, `10,777` preparation entries, `10,776` repeated
preparations, and `846` derive entries. The first and only fallback reason was
`extend topology`.

The fixed 20-warmup/45-pair controls were parse+render
`235.873584→236.721125 ms` (median ratio `+0.359320%`) and render-only
`195.819292→197.385416 ms` (median ratio `+0.799780%`). Both phases were
byte-identical and are noise-floor controls, not a speed result. The generated
less-parser issue recurred, so the worker reused the matching built parser
artifact and did not investigate Parseman. Temporary instrumentation was
removed and the isolated worktree is clean at `e4fb26616`. No safe
`emit-walk.ts`-only cut was found; follow-up remains owner-gated to imported-
extend topology/parity work under `spine-extend.ts`.

The separate root-local extend admission POC was also rejected without a
patch. Its `18`-case matrix had `14/17` comparable Less matches already exact,
but the candidate skipped `0` canonical classifications; it therefore did not
reduce the `42,926` probes or `39,562` no-matches. The implementation and
instrumentation were deleted after `162` focused tests plus `1` skipped, and
the uninstrumented A/B was noise (`235.90→234.06 ms` parse+render,
`200.42→200.31 ms` render-only). Do not revive the stale root-index POC.

The corrected CPU/heap attribution lane (2026-07-15) used the same fixed
20-warmup/45-pair contract on Node v25.9.0 arm64 Darwin. Its 0→0 controls were
parse+render `227.862→229.434 ms` (paired median delta `+0.033 ms`, `22/45`
wins) and render-only `197.435→200.022 ms` (paired median delta `+0.951 ms`,
`22/45` wins), with no speed claim. The profile output was `135,794` bytes,
SHA-256
`9a58451bd3b0c9d80913df38be3b199994d2b93d34a9d2851f1b18d9dcaaa7cc`.

Corrected render-only sampled self-time per render ranked `isNode` (`13.6 ms`),
GC (`7.6 ms`), `findWithinScopeSurface` (`6.9 ms`), `consumeName` (`5.5 ms`),
`extendSelector` (`5.3 ms`), and `processExtends` (`4.5 ms`). Allocation
sampling across three renders totaled `39.9 MiB` (`13.3 MiB/render`, sampled
allocation rather than retained heap). Largest self-allocation families were
`Map` (`8.30 MiB`), `Set.set` (`5.64 MiB`), `buildScopeFrame` (`2.32 MiB`),
`Rules` construction (`2.25 MiB`), `makeTrivia` (`2.16 MiB`), callable
selector/live-slot setup (`1.28 MiB` each), `varsByName` (`1.25 MiB`), and
direct declaration-child entries (`0.88 MiB`).

The next unowned proof seam is the evaluator–serializer frame/state boundary
around `serialize-helper.ts:826/1569` and `rules.ts:4930`. Registration/source
order fallback is already owner-held by `7bb9b483e`; scope/lookup allocation,
callable misses, global `isNode`, extend-chain preparation, and OutputWriter
tail work are already occupied or rejected. No source change was made.

The registration-map sentinel proof (2026-07-15) at
`/private/tmp/jess-varsbyname-proof-20260715` tested reusing
`_registrationPrepared` instead of allocating an empty `varsByName` map for
every prepared `Rules` surface. The bit is set early for re-entrancy and
`resetDerivedState()` deliberately preserves it while clearing `varsByName`
(`rules.ts:1570-1575`), so it cannot safely mean “declaration buckets are
covered” after derive/reset. A safe replacement needs a second lifecycle fact
or broader registration/reset plumbing. The diagnostic baseline recorded
`3,131` registration stamps, `3,249` empty-map writes, `5,366`
`RulesLookupState` allocations, and exact `133,983`-byte output (SHA-256
`adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840`). The
worktree is clean with no source or commit; no focused/A-B gate was run because
the semantic proof failed first.

- Q-40 scope-frame callable `Map.has` + `Map.get` proof (2026-07-15, rejected): the semantically valid candidate replaced the two probes in `lookupScopeFrameCallable` with one `Map.get`, preserving absent-key (`undefined`) versus cached-null-bucket behavior. Focused scope-frame/rules tests passed `110` with `5` skipped; output stayed at `130,772` bytes with SHA-256 `671970c15aba5bf05472eeb1f02468f21411fdd20e203674d446775c51c4f9a5`. Same-checkout render-only medians over three 5-warmup/45-sample runs were baseline `227.92`, `219.20`, `214.43 ms` versus candidate `238.08`, `216.09`, `212.72 ms`; no speed claim. Aggressive review rejected the unregistered `scope-frame.ts` production hunk; leave it uncommitted and do not add a generic lookup cache or index.
- Parseman range-builder fused-host integration proof (2026-07-15, rejected): connecting local commit `950e8b4` through `compileLinkable` was technically repaired with a minimal `_CstRangeStore` prelude/metadata fix, preserving exact CSS/Less output and passing `26` focused tests plus typecheck. The required 20-warmup/45-pair run regressed real Less parse `58.6→88.6 ms` (`+51%`), p95 transient heap `57.3→62.5 MB`, CSS transient heap `38,360→44,784` bytes, and generated code grew `747` bytes. Keep the POC isolated; do not wire it into Jess.
- Q-40 allocation-audit follow-up (2026-07-15, no new worker): `RulesLookupState` is already the one lazy fixed-shape `_lookup` slot, and declaration-only leaves avoid it. Direct declaration-child collection remains a real allocator (`~18.58 MB` inclusive, `~4.8 MB` self), but the existing producer flag is invalid on derived placements sharing children, so the proposed guard and rediscovery repair are rejected. Targeted heap inspection found only eight retained empty serializer frame arrays and two `OutputWriter` instances, so the aggregate array census does not justify another writer worker. The only plausible next allocation proof is owner-scoped registration instrumentation around `_createRegistrationPrepState` and retry arrays; extend the existing registration lane rather than creating a duplicate.
- Q-40 root candidate-admission proof (2026-07-15, rejected): a fresh worker tested a cheap predicate before the root `classifyInstructionMatch` loop in `extend-roots.ts`. Its focused test failed immediately (`10/10`) because `isEmptyBitSet` was not a function; canonical skip count was `0`, output/hash parity was unproven, and no benchmark or full gate was run. No source was committed. Do not revive the root-admission lane without a valid focused proof that skips nonzero canonical work and preserves the full extend semantic matrix.

## History

Landed design/plan/readout/audit docs and this router's former pass-by-pass
`Aggressive Cutting Self-Prosecution` log live in **`archive/`** (see
`archive/README.md` for the index). Full content is preserved — read one when you
need the *why/how* behind a shipped mechanism. Notably `archive/HANDOFF-history.md`
holds the self-prosecution log.
