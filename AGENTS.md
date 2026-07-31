# Agent Guidelines

This file is the stable cross-tool contract for working in this repo. **It is
the front door.** It assumes you have the repository, a shell, and nothing else
— no conversation history, no memory of prior sessions, no access to the owner.

Use it as the default guidance for any agent system. Tool-specific rule
directories (`.cursor/`, `CLAUDE.md`) are one system's routing layer and may add
workflow details; **nothing load-bearing lives only there**, and you are not
required to read them.

---

## Start Here — the largest active project

**The four-grammar rewrite.** Each of the four dialect parsers (`css`, `less`,
`scss`, `jess`) started with two hand-maintained grammars — `src/grammar.ts`
(positioned CST, consumed by the language service) and `src/ast/grammar.ts` (the
shipping compile path). **The physical eight-to-four fold has landed:** each
dialect now ships AST and CST from one host-mode grammar source. The active work
is polishing the surviving grammars so they are small, readable, spec-shaped,
well documented, and idiomatic Parseman (the floor is `^0.45.0` as of `75002c4a3`;
re-check `package.json` rather than trusting a version written here).

**The spec is [`docs/design/GRAMMAR-REBUILD-SPEC.md`](docs/design/GRAMMAR-REBUILD-SPEC.md).
Read its §0 first** — it states the goal in the owner's own words, the current
status, the plan, what gates what, and how to re-verify every time-sensitive
claim in it. The per-`const` review checklist that governs any grammar edit is
[`docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md`](docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md).

Two things to know before you plan anything:

- **The parseman hostMode floor is paid.** The mechanism that lets one grammar
  file serve both the AST and the CST is parseman's `hostMode`, and the repo
  resolves registry `parseman@0.45.0` through `^0.45.0` ranges (`f292fdd8f`;
  `pnpm-lock.yaml:18442` is the sole parseman entry). Publishing
  future parseman releases is still owner-only. Spec §0.2 says exactly what to
  check and how.
- **Order is `css` → `less` → `scss` → `jess`.** CSS is the base; the dialects
  link back to it rather than restating it; no copy-paste from the old grammars.
- **Use Parseman `dispatch(...)` narrowly and deliberately.** It is the right
  shape when one routed same-family opener has already been consumed, such as
  `url(`/generic `name(`, pseudo-functions, or known/generic at-keywords. Keep
  `choice(...)` for body/list item families, closed keyword/operator tables,
  and context decisions whose delimiter has not been consumed yet. The quick
  reference is
  [`docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`](docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md).
- **Comments are trivia.** Do not preserve grammar-level `Comment` nodes,
  value-comment leaves, or repeated `many(blockComment)` plumbing as the target
  parser architecture. Those shapes are migration debt unless a scanner-local
  `scanTo(...)` / `balanced(...)` skip needs to avoid terminating inside a
  comment. Opaque unknown at-rules and custom-property values still should not
  capture comments as semantic bytes; the parser should extract comment trivia
  once into the source/document trivia index, and render/language-service
  consumers should query that index by source offsets. Less's block-comment-only
  rulesets still need to render; implement that as a trivia-backed
  empty/renderability check, not by keeping `Comment` children in grammar
  bodies.

A **separate, parallel track** is the deletion of `packages/core/src/tree/` —
inventory in [`docs/architecture/core/TREE-CUTOVER-SURFACE.md`](docs/architecture/core/TREE-CUTOVER-SURFACE.md).
It neither blocks nor is blocked by the grammar work.

## The Failure Class This Repo Pays For

**A check that reports success because it cannot see the failure mode.** Nearly
every expensive defect in this repo's history is an instance. Each rule below has
its reason attached, because a prohibition without one gets optimised away.

- **Build in dependency order, `parser-shared` FIRST**, before trusting any test
  number. All four parsers depend on it; build them first and they link against a
  stale recognition library and **the suite goes green** while masking real
  failures. Order: `parser-shared` → parsers → `awaitable-pipe` → `core` →
  `fns` → `styles-config` → `style-resolver` → plugins → `jess`.
  `pnpm run build:release` does the whole thing.
- **The config package is named `styles-config`, not `@jesscss/config`.** A
  `pnpm --filter` on the wrong name matches nothing — **and a filter that matches
  nothing exits 0.** Check what a filter actually selected before trusting a
  count taken through it.
- **Tests run from `lib/`, not `src/`.** A stale build silently measures an older
  commit and reports it as today's number. A fresh worktree has no
  `node_modules` at all.
- **Stale artifacts fail silently and cleanly** — stale `dist/`, stale `lib/`,
  stale `.cache/` worktrees, and `link:` overrides that dangle and resolve *up*
  into a parent checkout's `node_modules`. **Report the resolved path and
  resolved version per package as evidence, ahead of any numbers. If a run
  cannot show what it loaded, its numbers are unfalsifiable.**
- **Capture baselines as NAMED SETS before changing anything, and compare names,
  not counts.** A matching count hides "one fixed and one broken" perfectly.
- **`git grep` cannot see every file.** `scripts/lint-violation-report.mjs`
  contains literal NUL bytes, so git treats it as binary and `git grep -I` skips
  it — while it holds the grammar-lint scope list. Use `grep -r` when a negative
  result is load-bearing.
- **Perf harnesses are not verdicts.** The grammar/workload perf gates (which
  live in the **parseman** repo, not here) have produced confident FAILs on
  byte-identical inputs. Noise floor ≈ ±1.9%. Treat a perf run as
  confirmation-only **in both directions** — a PASS certifies nothing.
- **`check:macro` and `verify:compose-integrity` are CORRECTNESS gates, not perf
  gates.** A build that degrades to the parseman interpreter **emits a different
  tree**. They must show **0 interpreter fallbacks**. A green test suite does not
  clear a fallback — the suite can pass on the interpreted tree while the shipped
  compiled tree differs, and a red run invalidates any differential taken on that
  build.

## Hard Prohibitions

- **Never `git stash`, `git restore`, `git checkout -- .`, or `git reset --hard`
  without explicit permission.** `git stash` has silently destroyed work here.
  Back up first (`git diff > /tmp/backup.patch`) and record where. **Commit
  before measuring** — that is the supported way to compare two states.
- **Never `as any`, `: any`, `@ts-ignore`, or `@ts-nocheck`.** `pnpm
  lint:absolute` detects these. It reports **hundreds of pre-existing violations
  and is deliberately not wired to a blocking gate** — that is a backlog, not a
  dead rule. Do not add to it.
- **Never add `await` to a test assertion to silence a lint warning.** Hundreds
  of assertions deliberately omit `await` on `MaybePromise`-returning calls;
  `Node.eval()` and `Node.render()` are not `async`, and the omission is what
  pins the synchronous fast path under test. Adding `await` silently deletes that
  coverage and the suite still passes. Use `test/expect-sync.ts` where synchrony
  should be asserted explicitly.
- **`.css` fixtures are Less v5 alpha expected output and are owner-maintained.**
  A top-level diff against one is **a jess bug by default**, not a fixture to
  update.
- **Agents never merge or release parseman PRs.** That is the owner's, always.

Tests are imperfect encodings of the documented design, and the design is the
source of truth — but the less-compat bridge is a real external contract.

---

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
This prohibition is about AST construction hosts. It does not ban a Parseman
grammar-level routing combinator such as `dispatch(combinator, when(...),
otherwise(...))`, whose job is recognition and macro-compilable branch
selection.

## Parser-Owned Shape Rules

Parsers own AST validity. Core nodes are cheap value objects that assume their
inputs are already right. View every parser/AST shape decision through the
repo's performance pressure: prefer grammar-time decisions, macro-compilable
Parseman structure, simple value objects, and typed construction over runtime
branching. Do not push parser-shape enforcement into hot-path runtime
constructors, node methods, eval/render visitors, or compatibility facades. If
a shape can be made invalid only by parser construction, fix the parser
reduction and pin it with parser AST tests. Diagnostics may optionally audit or
report invalid shapes, but diagnostics are not the source of truth that makes
nodes valid.

Selector parsers must emit the smallest authored selector shape:

- A selector-list branch with no combinator is a selector term, not a
  `ComplexSelector`.
- A `CompoundSelector` is only for multiple adjacent simple selector tokens. A
  single simple, basic, pseudo, or parent selector remains that selector.
- A `ComplexSelector` is only for selector-term/combinator/selector-term
  sequences and must contain at least one combinator. It must never wrap one
  selector term.
- A `RelativeSelector` is only for combinator-leading relative selector branches
  and must contain that leading combinator followed by at least one selector
  term.
- Combinators remain primitive strings in selector sequences; do not wrap them
  in objects.
- Do not admit leading-combinator branches through a generic selector
  production. Contextualize the grammar so relative selectors are accepted only
  where the language permits them, such as nested selector position or selector
  function arguments that allow relative selectors.
- Do not enforce these invariants with runtime shape rejection in core nodes.
  Parser reductions should coalesce into legal shapes, and parser AST tests
  should assert that one-item compounds, one-term complex selectors, and
  out-of-context relative selectors are not produced.

## Parser Runtime Boundary

In `packages/syntax/css/css-parser`, `packages/syntax/less/less-parser`,
`packages/syntax/scss/scss-parser`, and
`packages/syntax/jess/jess-parser`, runtime recognition belongs exclusively to
Parseman grammar combinators and their macro-compiled output. No handwritten
runtime `RegExp`, regex literal, `.exec`/`.test`/`.match`, `charCodeAt` scanner,
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

Reparsing is rejected parser architecture. A grammar may recurse through its own
Parseman rules, but it must not recognize a broad source region and then parse
that same region again through a second rule, helper, lookahead route, or
post-processing pass. Broad lookahead is also a finding by default; keep
lookahead as small and local as possible, and require a const-level review to
prove that no clearer Parseman structure (`dispatch`, `routed`,
context-parameterized rules, separator helpers, or explicit recursion) can own
the same language. In particular, Less `:extend(...)` must be collected as a
contextual selector tail while parsing the selector once, not by reparsing
selector branches through an inline-extend route.

When sibling arms re-recognize the same broad token family, and the
already-consumed routed value itself decides exact known cases plus a same-family
generic fallback, use Parseman's `dispatch(combinator, when(...),
otherwise(...))` shape. The first combinator parses once; `when()` handles exact
or matcher cases; `otherwise()` owns the generic continuation; `routed()` lets
the selected branch place the already-consumed value/span inside its CST/AST
node. Keep `choice(...)` or left-factor/context-helper shapes when the real
decision is a later delimiter, caller context, closed table, or body/list
construct family.
Use one `makeWhen(...)` / `makeWord(...)` helper per real matching policy in the
actual grammars; avoid separate helper names for pseudos, functions, at-rules, or
words when the case-sensitivity and boundary policy are the same.

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
- Before adding or exporting a canonical-AST visitor/traversal API, write the
  design and get an adversarial review against the materialization/eval/render
  story and the historical Less/Jess visitor surfaces. Do not introduce
  diagnostics-only object crawls as a substitute for a reviewed traversal shape.

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

- `docs/perf/V8-ARCHITECTURE.md` — the **numbered invariants** (1-11 at `facb641dd`;
  count them in the file rather than trusting a number here) ("before you write X,
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
- **Done means landed on `origin/dev`, not "committed on my branch."** An agent
  finishes its own work: gates run and reported by name, an adversarial review
  passed, then rebase onto `origin/dev`, verify the fast-forward, and push. A
  branch that stops at "ready for someone else to merge" is unfinished, and the
  context needed to finish it dies with the agent that had it. The definition of
  done is:
  1. **Gates green, named.** Not a count, not "tests pass" — the specific gates
     for the touched surface, each named with its result, and any red one
     explained against its known baseline.
  2. **Adversarially reviewed.** Use the reviewer that matches the surface —
     `.cursor/agents/grammar-reviewer.md` (evidence per `const`),
     `perf-architecture-reviewer.md` (evidence per invariant),
     `semantics-reviewer.md`. A bare verdict, "tests pass", or a sampled review
     is an invalid result.
  3. **Landed.** `git fetch`, rebase or merge `origin/dev`, confirm the push is
     a fast-forward, push, then confirm `HEAD..origin/dev` is 0.
  A coordinator may sequence merges when lanes genuinely interact — but
  sequencing is an exception that must be stated with its reason, not the
  default. Defaulting to "hand it back" converts every finished lane into
  someone else's unfinished one.
- **Never push a red `dev`.** If landing would break it, say so and stop with
  the specific failure — that is the one legitimate reason not to finish.
- **On hot paths the reference class is a compiler, not an application.** Hot
  paths are `packages/core/src/ast/**` (`serialize.ts`, `provenance.ts`,
  `extend/**`), `packages/syntax/*/*-parser/src/**`, `packages/parser-shared/**`,
  and `packages/core/src/tree/**`. Idiomatic general-purpose JavaScript is not
  the bar: restarting a scan at index 0 inside a per-item loop over ordered
  data, allocating an array or string only to test `.length` or emptiness,
  per-node `WeakMap` side tables, and per-entry objects holding two integers are
  all defects here no matter how ordinary or readable they look. The bad version
  usually looks *better*, which is why it must be caught by counts rather than
  by reading. Full statement and incidents: `docs/perf/V8-ARCHITECTURE.md`
  invariant 11.
- **None of that class changes emitted bytes**, so correctness gates,
  byte-identity, and the full corpus stay green while the work is quadratic.
  Prove hot-path changes with counts — allocations, `indexOf` calls, iterations
  per render — not with timings; the timing harnesses currently cannot resolve
  small effects.
- **If a scope glob in `CLAUDE.md`, a `.cursor/rules/**` header, or a skill no
  longer resolves, fix it in the same change.** A guardrail pointed at a deleted
  directory is indistinguishable from a guardrail that passed. The `e96d1035d`
  regroup left every parser rule pointing at `packages/*-parser/**` and left
  `packages/core/src/ast/**` uncovered entirely; real invariant violations
  landed in that window.
- Before committing a parser-grammar change, run its parse-performance gate on
  the built artifact. Capture a named before/after comparison using the same
  fixture, Node runtime, warm-up, and timed samples; record the resolved parser
  and Parseman paths/versions with the result. The gate is mandatory even for a
  readability or cleanup change: grammar routing can change hot-path work
  accidentally. Treat a difference inside the documented harness noise as
  inconclusive, not a win or regression; investigate a material regression
  before committing. The parser review standard names the dialect harnesses and
  required correctness gates.
- **A before/after against your parent commit is not enough.** "Sub-noise means
  inconclusive" plus a reference point that moves every commit means a `+2%`
  change lands as noise and becomes the new baseline; twenty of those compound
  to `+49%` with every gate green. Also measure against the oldest cleanup-era
  commit you can build, record both deltas, and treat a *consistently positive
  direction* across consecutive commits as a real regression even when each
  magnitude is inside the band. Do not let the grammar cleanup slowly degrade
  parse performance. See the drift gate in
  `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md`.
- If package B depends on package A, build A first when the workspace layout requires built outputs.
- When debugging, record what was tried, what happened, and the next step in the repo’s transient state files instead of expanding permanent guidance.

## Tool-Specific Rules

Tool-specific rule systems should stay thin:

- point back to `AGENTS.md` for repo-wide goals
- keep only the workflow details unique to that tool
- avoid copying branch summaries, active stage snapshots, or large architectural explanations

When a tool-specific rule becomes stale, replace it with a pointer to the canonical source instead of refreshing a duplicate summary.
