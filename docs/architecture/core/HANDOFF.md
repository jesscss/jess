# Core Architecture Handoff

> **Architecture correction — supersedes every prior “private direct-AST grammar”,
> “development-only AST seam”, or “wire it later” claim in this document and
> linked future plans. Those claims were wrong/hallucinated migration staging,
> not an approved architecture. AST v2 and the deletion work are the public
> architecture: each dialect package's primary `parse()` operation must run
> Parseman reductions directly to canonical `Stylesheet`. CST APIs remain only for
> explicit language-service/document use; no CST-to-AST bridge, host, or
> compatibility route is an acceptable interim production design.

## COLD START — read this first if you have no prior context

1. **Where you work.** Never edit the main checkout `~/git/oss/jess`; it mirrors `dev` and
   holds concurrent WIP. Create a worktree off `origin/dev`
   (`git fetch && git checkout -B <branch> origin/dev`) and state the SHA in your first report.
2. **Never** `git stash`, `git restore`, `git checkout -- .`, or `git reset --hard`. Two agents
   lost or nearly lost work to this on 2026-07-24. Commit before measuring.
3. **Build in order** before trusting any test number: `parser-shared` → parsers →
   `awaitable-pipe` → `core` → `fns` → `config` → `style-resolver` → plugins → `jess`
   (`pnpm run build:release` does the whole thing). Vitest runs against `lib/`; a stale `lib/`
   silently reports a *past* version of the repo. A stale `parser-shared` build in
   particular masks ~17 real failures — all four parsers depend on it, so it goes first.
4. **Baseline before blaming yourself.** `docs/state/PROJECT_STATE.md` holds the measured
   known-red set. Capture your own baseline as a NAMED SET of cases, never as a count you
   inherited from a doc.
5. **State a SHA with every empirical claim.** A number without a SHA is not evidence.
6. **Never** `as any`, `: any`, `@ts-ignore`, or `@ts-nocheck`.
7. **No less.js checkout may be MUTATED** — never `git checkout`, `switch`, `commit`, or
   `reset` in `~/git/oss/less.js` or `~/git/worktrees/less.js/`. Read-only access is
   sanctioned and is how the repo actually works: `~/git/oss/less.js` on branch `alpha`
   **is the v5 alpha, which is a thin wrapper over jess's own `Compiler`** and is therefore
   the v5 expected-output oracle (`REFERENCE.md:1-14`, `R1-EXTEND-HANDOFF.md:105`) — never a
   Less 4.x oracle. The **4.x** comparator is `~/git/worktrees/less.js/less-4x` (4.8.1).
   *(Corrected 2026-07-30: this rule previously read "`~/git/oss/less.js` is off-limits, use
   `~/git/worktrees/less.js/`", which forbade the repo's own documented and implemented
   workflow and contradicted `REFERENCE.md:39/50`.)* Owner merges parseman PRs; agents never do.
8. **Working on grammars, not core?** This document is the *core architecture* entry point.
   The four-grammar rewrite has its own spec —
   [`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md), start at
   its §0 — and `AGENTS.md` is the repo-wide front door for either.
9. **Correctness has no external oracle** — see `DESIGN-DECISIONS.md` §0 (E1–E7). In
   particular the Less v5 alpha package is a thin wrapper over jess's `Compiler`
   (`docs/architecture/core/LESS-V5-CONTENT-PR-PLAN.md:18`), so it can never adjudicate a
   jess-vs-`lessc` question.
10. **Touching value semantics or node names?** Both are already decided and NOT yet
    implemented, and this is **the declared top priority once the parsing-table work
    (NEXT UP steps 1–6) finishes** — read
    [`../../design/RESOLVED-SEMANTICS-AND-NAMING.md`](../../design/RESOLVED-SEMANTICS-AND-NAMING.md)
    before designing anything in that space, or you will re-derive rulings the owner has
    already made. **Part I (§1–§11)** settles math, comparison, truthiness, `null`, unit
    strictness, expression positions, and each dialect's lowering; the implementation plan
    is its §10. **Part II (§12)** settles the node set: the authoritative list is the
    **49-kind discriminated union** in `packages/core/src/ast/nodes.ts`, four kinds are
    deleted outright (§12.3), and roughly 40 of the **448** grammar `node('…')` labels are
    misspellings of a real node rather than productions (§12.4). A grammar label is NOT
    evidence that a node by that name exists. Deletions land before renames (§12.5).
    **Before touching any reference node, read §12.3a.** The eight-kind reference family
    (`VariableReference`, `PropertyReference`, `DeclarationReference`, `VarIndirect`,
    `Reference`, `DotLookup`, `BracketLookup`, `Call`) encodes scope, kind and name four
    different ways each, and a fifth copy of scope already sits on `VariableWrite`. The
    target is ONE shared lookup descriptor; adding a `lookup` or `keyKind` field to a
    reference node without it makes the duplication worse, not better.

## ACTIVE PLAN — V19 one evaluator, nesting as a write-time projection

**Authority and defect.** `DESIGN-DECISIONS.md` V19 requires evaluation and lookup to
depend only on the source stylesheet; `collapseNesting` is an output setting. The live
serializer violates that rule with two statement evaluators: `walkBody`/`flatten` for
collapsed output and `emitNestedBody` for nested output. Both dispatch declarations,
rulesets, calls, `$apply`, references, loops, conditionals, at-rules, imports, functions,
definitions, and variables. Both also own property publication, callable expansion,
control flow, trivia replay, and extend hoisting. G28's block-comment loss and #126's
`$property` lookup failure were consequences of those evaluators drifting.

### Target runtime shape

The evaluator is extracted from the existing `walkBody` path because it already owns the
more complete source-order lookup and callable semantics. Extraction does **not** make the
flattened output algorithm canonical. It separates that algorithm into a writer just as
the nested algorithm becomes a writer.

The evaluated structure is the existing canonical source node plus its existing placement
spine: `Frame` for lexical/live lookup state and `Leaf` for a statement at an evaluation
placement. `Leaf` becomes the monomorphic evaluated placement carrier, with mandatory
slots for the projection-independent result, call-level importance, `$apply` provenance,
and trivia ownership; every constructor writes the same fields in the same order. Absent
facts use `null`/`false` scalar sentinels, never fresh empty arrays or objects. The realized
`Leaf` shape count must be exactly one. This replaces the current conditional-spread
shapes rather than adding another wrapper. The fold adds no `Frame` field or constructor
and may not increase the current 14 statically named `Frame` construction signatures.
Ruleset and at-rule facts are passed to fixed-argument writer callbacks as the canonical
node, placement `Frame`, evaluated header/prelude, parent context, and source owner in that
order; they do not get a carrier object or a branch-specific argument shape.

The evaluator resolves every lookup-dependent fact before invoking a writer: declaration
values, selector interpolation, at-rule preludes, guards, import requests, callable
selection/arguments, and control-flow results. An actually asynchronous result suspends
that placement before it reaches the writer; no selected writer decides when a lookup or
value is forced. The evaluated placements are consumed as the evaluator walks, so this is
still the existing streaming spine rather than a retained evaluated AST, event array,
cloned tree, `WeakMap`, or second node model. The synchronous fast path remains synchronous
when every evaluated fact is synchronous.

One source-order evaluator owns exactly these operations:

- dispatch of every `Statement` kind;
- frame creation and live declaration/mixin/function publication;
- `recordPropertyDeclaration` and the property timeline;
- mixin, `$apply`, detached-reference, and loop placement expansion;
- `if`/`while` selection and iteration;
- import execution order and source-owner changes; and
- body/root trivia ownership.

Two write projections consume those same placements through the existing `Emit` buffer:

- the **collapsed writer** owns selector composition, parent-block partitioning, at-rule
  bubbling, flattened extend headers, and collapsed block layout;
- the **nested writer** owns authored selector headers, nesting indentation, adjacent
  nested-block coalescing, and the small extend-driven hoist projection required even when
  ordinary nesting is preserved.

`collapseNesting` selects the writer once at the serialize boundary. No evaluator,
lookup, expansion, control-flow, import, or property-timeline function may read it.

### Landable slices — one PR per slice, each based on `dev`

0. **Plan (this section).** Land the target shape, slices, and evidence contract before
   production changes.
1. **Shared lookup and leaf bookkeeping.** Introduce the projection boundary around the
   existing `Frame`/`Leaf` spine. Move declaration/comment handling, nested-property
   expansion, property-timeline publication, definition/variable publication, and body
   trivia ownership into the one evaluator. Normalize `Leaf` construction to one field
   shape and replace `pendingLeafBlockComments` with one owner-tagged nullable
   pending-comment slot on the existing render context. Its two scalar fields reuse the
   active `Leaf[]` identity and trivia-owned comment list; they are not an expando, side
   table, buffer wrapper, or fresh empty array/object per leaf. Both writers consume the
   same evaluated leaves.
   Red-to-green pins cover sibling/parent/mixin `$property` access and block-interior
   comments in both output modes.
   Add a source-level architecture ratchet that starts by naming both statement
   dispatchers and every evaluator-side output-setting read; each later slice removes
   only the entries whose responsibility it deletes, and slice 5 takes both sets to zero.
2. **Shared callable expansion.** Make mixin dispatch/selection/frame creation, body
   plugin preparation, recursion accounting, scope leakage, `$apply`, and detached
   reference calls evaluator-owned. Delete `expandNestedCall`, `expandNestedApply`, and
   `expandNestedReferenceCall` as their responsibilities move. Both writers receive the
   same expanded placements; only selector/block layout differs.
3. **Shared control flow.** Move `$for`/`each`, `if`, and `while` dispatch and frame
   creation to the evaluator. Delete `expandNestedFor`. Pin sync and async continuation
   order plus both-mode lookup visibility across iterations and chosen branches.
4. **Shared containers, imports, and hoisting.** Move ruleset/at-rule/import dispatch and
   reference-import fact publication to the evaluator. The collapsed writer keeps
   composition/bubbling/partition policy; the nested writer keeps authored nesting and
   consumes evaluator-issued extend-hoist placements. Pin selector composition, `&`,
   at-rule bubbling, import barriers, comments, and source order in both modes.
5. **Delete the second dispatcher.** Remove `emitNestedBody` and every nested-only
   evaluation helper left after slices 1–4. Select the writer once at the serialize
   boundary. The final source audit must find zero `collapseNesting`/`e.collapse` reads in
   evaluation, lookup, expansion, control-flow, and import code.

If a slice cannot preserve its named before/after byte set, stop at that slice: do not
move the discrepancy into an allowlist, fixture edit, or later cleanup PR.

### Evidence contract for every slice

Build first with `pnpm run build:release`, and record resolved package paths/versions
before interpreting test or benchmark output. The method is governed by
`docs/perf/V8-ARCHITECTURE.md`, including invariant 11's deterministic-count requirement.
Every slice then reports these numbers:

1. `npx vitest run packages/core`: total/passed/failed.
2. `pnpm --dir packages/jess run test:ratchet`: total failures and exact named-baseline
   comparison (the baseline is currently an empty named set, not merely the number zero).
3. `packages/jess/test/less/property-accessor-nested.test.ts` plus every test that
   parameterizes both `collapseNesting` values: total/passed/failed.
   Any slice that moves value, selector, or at-rule evaluation also runs a focused
   positional-equivalence fixture: the evaluated node/value source positions and
   diagnostic location must be identical in both output modes. A disposable source-span
   perturbation must make that fixture fail, so a green result proves the position path
   is observed rather than merely comparing emitted bytes.
4. The Less corpus under forced `collapseNesting:true`, captured before the slice as a
   sorted per-case manifest of CSS SHA-256 or diagnostic code, then captured after the
   slice with the identical fixture checkout/configuration. Required result: zero added,
   removed, or changed case records. `all-less.test.ts` still runs as its independent
   golden gate; matching counts alone do not satisfy this manifest comparison. The
   manifest is regression context, not proof by itself: for the responsibility moved by
   the slice, a disposable negative-control patch must change at least one named target
   record, and the corresponding focused test must fail for the intended reason.
5. Dependent suites/builds for `@jesscss/plugin-less`, `@jesscss/fns`, and
   `@jesscss/plugin-scss`: total/passed/failed where tests exist, and build exit status.
6. Extend the canonical `measure:less:hotpath` harness before the first production slice
   so it accepts explicit `collapseNesting:true` and `collapseNesting:false`, without
   changing its default fixture set. Run both modes before and after in the same
   machine/session. Report each fixture's median, RSD/signal, and delta; a delta inside
   the harness noise is inconclusive, while a regression beyond noise blocks the slice.
   Attribute the instrument with a same-commit null run; for a no-change claim, a
   disposable negative control must make the relevant mode move. Retain `b719ce11c` as
   the fixed cumulative reference so a sequence of individually sub-noise regressions
   cannot ratchet the lane slower.
7. `pnpm run verify:aggressive-cutting-review`, plus evidence-per-invariant reviews from
   `semantics-reviewer` and `perf-architecture-reviewer`. Acted-on findings belong in the
   PR body; a bare verdict is not a review.
8. Deterministic before/after hot-path counts: statement dispatchers and body loops;
   evaluator visits and writer callbacks at N and 2N for a focused mixed-statement body;
   `Leaf`/`Frame`/group allocation sites; conditional object spreads; `Map`/`Set`/`WeakMap`
   construction and side-table operations; trivia/source scan starts; and added/removed
   helper calls on one declaration, one mixin placement, and one nested-rule placement.
   The temporary counter instrumentation must be removed before commit. Also run
   `git diff --check`, report `serialize.ts` line count before/after, and count remaining
   output-setting reads in evaluation code.

Before editing a production slice, commit its counter baseline and pre-register the exact
expected delta or non-increase bound in the PR notes. The lane-wide hard gates are: two
statement dispatchers to one; evaluator-side `collapseNesting`/`e.collapse` reads to zero;
three statically authored `Leaf` shapes to one; five conditional `Leaf` field spreads to
zero; the pending-comment `WeakMap` from one construction/eight operations to zero; no new
`Frame` field, constructor, or statically named signature above the current 14; and no new
group, map, set, weak-map, scan-start, or helper-call count. For a body of N eligible
statements, one render performs exactly N evaluator visits and N writer callbacks; running
the two modes separately performs 2N of each, never two body walks in one render. Every
touched counter gets a disposable sensitivity mutation that exceeds its registered bound
and fails the counter assertion.

Slice 4 also runs and extends `packages/core/src/ast/__tests__/extend-op-budget.test.ts`.
Its existing comparison and contribution ceilings remain unchanged, and an explicit
nested-hoist placement counter is pinned for N and 2N inputs in both output modes: the 2N
count may be no greater than twice the N count plus a named constant setup cost. A
disposable per-subject rescan makes that operation-budget test fail before the slice is
accepted.

Each PR body is written for a repository reader: V19 rationale, the exact evaluator
responsibility moved, red-to-green tests, named gates and numbers, corpus manifest result,
perf medians/signal, reviewer findings acted on, line-count delta, and remaining fold
slices. No slice merges as part of this lane.

### Aggressive Cutting Self-Prosecution — V19 plan

- **New traversal:** none in this plan. The implementation must replace the two existing
  statement traversals with one; a writer callback may consume the current placement but
  may not walk the body again.
- **New node/materialization:** none. The source node + existing `Frame`/`Leaf` placement
  spine is the evaluated structure. `Leaf`'s existing allocation becomes monomorphic and
  carries the evaluated result; it is not wrapped. A retained event list, evaluated-tree
  clone, or new per-statement wrapper model is rejected.
- **Render path:** both projections write directly to the existing `Emit.chunks` buffer.
  Neither projection may materialize nodes/arrays merely to stringify them.
- **Helper/API surface:** the temporary projection seam is private to `serialize.ts` and
  must finish with fewer dispatch/expansion helpers than the two paths it replaces. Each
  slice deletes its superseded nested helper in the same PR.
- **Metadata mutations:** no new source/parent restoration, `frozen` mutation, structural
  probe, or per-node side table is planned. Slice 1 removes the existing
  `pendingLeafBlockComments` WeakMap in favor of leaf-buffer-owned state. Existing frame
  placement state remains render-local and is dropped with the render; every slice counts
  realized `Frame` and `Leaf` field shapes before and after.
- **Evidence:** targeted negative controls and behavior tests prove the moved
  responsibility is exercised; byte manifests are regression context. Timings are only
  performance sanity. Deterministic path/allocation/scan counts enforce the compiler
  architecture, and code deletion alone is not described as a speedup.

## SESSION HANDOFF — 2026-09-04 (grammar / pinned-defects / Less-gaps driver)

Ran the grammar-cleanup, pinned-defect, and Less-gap lanes while the V19
one-evaluator fold (ACTIVE PLAN above) landed slices 1-4 in parallel
(`refactor/one-evaluator-lookup-leaf`, PRs #134-136). No conflict: every grammar
fix here is parser-side only; the fold owns `serialize.ts`.

**Landed to `dev` this session** (each its own PR, byte-identity + ratchet-exact +
two blocking reviewers): Percentage->Dimension convergence #137; `@container`
gaps #138; jess pseudo leading-combinator #140; jess comment->compound #142; SCSS
star-hack #143; jess paren block #144; ledger rulings #139/#145; gap fixes
#146-#152 (D8/D1/D5/D7/D13/D6) and the Less comment-fold pair #141+#148. Also
earlier this session: fork sync, Jess 2.0.0-alpha.16 + Less 5.0.0-alpha.3 publish
(browser bundle on CDN), less-preview restyle + version-gated options, the
release-preflight dedupe #130/#131 (381s->90s), and the pinned-defect audit #128
(`docs/state/PINNED-DEFECTS-AUDIT.md`). Full defect->PR map + rulings are in that
audit's "Update — 2026-09-04" section and `GRAMMAR-DEDUP-LOG.md`'s 2026-09-04 entry.

**BLOCKED ON THE FOLD — do not re-dispatch until slice 5 lands:** the SCSS
block-comment trivia family (audit D9/D17/D21/D23/D27 + the SCSS half of D19,
ledger G26/G29). Measured 2026-09-03: declaring `blockComment` in the scss trivia
table alone DROPS block comments, because SCSS tags ~4 statement `withSourceSpan`
sites vs Less's ~41, so G28's block-interior replay has no anchor. It needs (a) an
SCSS statement-source-span lane and (b) a block-interior replay that lives in the
`serialize.ts` trivia code THIS fold is consolidating (slice 1 = "body trivia
ownership into the one evaluator"). Sequence: fold slice 5 -> SCSS statement
spans -> declare `blockComment`. See
`memory:scss-trivia-family-blocked-on-statement-spans-and-fold`.

**Owner decisions still pending** (surfaced, not decided): D22 (jess escaped-interp
`~"x$(1+1)y"` AST-shape model change), D24 (scss `&`-as-value node model). Owned/
spec-clear but unscheduled: D24a (scss `@-` namespace, G30), D18 (scss Sass module
forms), D11 (unbalanced `]` in custom props, P2, all four), D10 (top-level CDO/CDC,
near-zero value). Cleanups: scss `@media foo(bar)` stray-space render (chip), and
two grammar dedups (four `<query-in-parens>` forks; typed at-rule prelude x3).


## SESSION HANDOFF — 2026-08-17, jess dev `6d7fbe82d` (CURRENT — read first)

**CURRENT FOCUS (owner, 2026-08-17): strengthen the Less compilation story so we can
keep publishing alphas.** The v5 alpha IS jess (a thin wrapper over jess's `Compiler`),
so "publishing alphas" = jess compiling Less correctly against the owner-maintained
`.css` fixtures. Start by MEASURING the Less baseline as a named per-case set
(`packages/jess/test/less/**`; build `lib/` first — a stale `parser-shared`/`core` masks
real failures), then triage each red case (parse error vs wrong emitted CSS vs genuine
feature gap) before fixing. `packages/jess` baseline drifts — never quote an inherited
count. Standing Less-adjacent backlog rows: tasks #25 (Sass+ `math.div`/`@-use` leak),
#36 (`@extend` out of mixin bodies), #44 (less `@1foo` internal Error not SyntaxError),
#45/#46 (dialect accept/reject gaps), #59 (`//` inside `url()`).

**Landed this session (all on `origin/dev`), and the compose state:**
- **parseman 0.49.0 is PUBLISHED and jess `dev` is bumped to it** (`5df3ad779`). ⇒ **The
  "four grammars do not compose" headline in the 2026-08-09 section below is SUPERSEDED.**
  0.49.0 ships the analyzer lifts + the cross-module `buildImports` re-emit + two
  review-surfaced correctness fixes; `cssBaseRules` (a **208-rule hole-free fused css
  base**, `@jesscss/css-parser/grammar`) macro-fuses on dev. The bump is behavior-neutral
  (check:macro 0 fallbacks, parser suites 512/730/622/510, LS 4 / DC 3 baseline).
- **P28 — all four dialects' selector-tower CST converged to css's canonical names**
  (`CompoundSelector`/`ComplexSelector`/`SelectorList`/`BasicSelector`, `ComplexTail`
  inlined), byte-identical AST throughout. `DESIGN-DECISIONS.md` **P28**. Lesson:
  grammar rule/node renames ripple into the UNGATED `language-service` +
  `diagnostics-core` (they key off grammarType STRINGS) — run both suites vs baseline
  (`memory:grammar-renames-ripple-into-ungated-language-service`).
- **P29 — nested relative selectors accepted in all four dialects** (`.parent { > .child }`
  = `.parent > .child`, CSS Nesting), producing a context-scoped `RelativeSelector` (root
  `> .a` still rejected); additive (css byte-identity 6/6). `DESIGN-DECISIONS.md` **P29**.
- **Compose Phase 1 (css groundwork)** (`6d7fbe82d`): css reducer helpers hoisted to the
  importable `packages/core/src/ast/css-grammar-helpers.ts`, `@jesscss/parser-shared`
  externalized in the css build, `cssBaseRules` exported and proven to fuse on published
  0.49.0.

**Compose DEDUP — PARKED, foundation proven, NOT abandoned.** Deprioritized behind the
Less focus, resumable at any time. State: `cssBaseRules` fuses on dev; the next step is a
**per-dialect reducer-helper hoist** (scss still has ~85 module-local helpers with no
import provenance — `compose()` refuses them where `composeLeaf` did not; it needs an
`scss-grammar-helpers.ts` mirroring css's) BEFORE the compose-switch. Immediate
selector-tower deletion is only ~3–5 consts — `CompoundSelector` stays a genuine override
until css factors `simpleSelectorAtom` (piloted on branch `css-factor-selector-atom`, not
on dev). Full plan, worklist, and per-dialect classification are in
`docs/design/COMPOSE-MIGRATION-SPEC.md` — the place to resume.

---

## SESSION HANDOFF — 2026-08-09, jess `4d4954156`

**Recorded near a usage limit.** Read this section before the 2026-08-01 one below it.
Everything here is verified against `4d4954156` unless explicitly marked unverified.

### THE HEADLINE — the four grammars do not compose, the reason is documented, and the consequence was never escalated

This is the finding that reframes the grammar work. It is not new information; it is
information that was recorded in one place and never propagated to the place that
governs grammar review.

**1. The supersets became hand-maintained COPIES at a single commit.**
`59f695d4a` (2026-07-27, `refactor(parser): fold dialect grammars to host mode`) has a
**one-line message and no commit body**. It removed, from `scss-parser/src/grammar.ts`:

- `import { lessGrammar } from '@jesscss/less-parser/grammar';`
- `export const scssGrammar = compose([lessGrammar, cssAstSyntax, rules(…)])`

and replaced them with `composeLeaf` plus a standalone grammar factory. Verify with
`git show 59f695d4a -- packages/syntax/scss/scss-parser/src/grammar.ts`. From that commit
onward the three supersets are copies of the CSS grammar maintained by hand, with no code
link of any kind.

**2. The "CSS base" line is a COMMENT, not an import.** Each superset carries
`* CSS base: ../../../css/css-parser/src/grammar.ts` at grammar.ts:4 — inside a docblock:

```
packages/syntax/jess/jess-parser/src/grammar.ts:4
packages/syntax/scss/scss-parser/src/grammar.ts:4
packages/syntax/less/less-parser/src/grammar.ts:4
```

`grep "from '@jesscss/.*-parser/grammar'" packages/syntax/*/*-parser/src/grammar.ts`
returns **nothing**. No grammar imports another grammar.

**3. What IS shared is TOKEN RECOGNITION ONLY.** All four grammars terminate in a
`composeLeaf([...])` whose first element is `cssSyntax`
(`packages/parser-shared/src/recognition.ts:515`) — a table of **terminals**:
`Identifier`, `AttributeOperator`, `DoubleQuotedText`, `UrlOpen`, `HexColor`,
`UnicodeRangeToken`, the at-keywords. Exact tails:

| grammar | `composeLeaf` elements | site |
| --- | --- | --- |
| css | `cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules(…)` | `css-parser/src/grammar.ts:4288` |
| less | `cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>(…)` | `less-parser/src/grammar.ts:6805` |
| scss | `cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(…)` | `scss-parser/src/grammar.ts:6005` |
| jess | `cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(…)` | `jess-parser/src/grammar.ts:6560` |

*(Note: less's second element is `lessSyntax`, not `opaqueAtRuleRecognition` — the
"all four are identical" shorthand is wrong in that one slot.)*

**Terminals compose; productions do not.** Every defect listed below is at the
production layer, which is exactly the layer with no sharing.

**4. WHY it does not compose is already written down.**
`docs/design/GRAMMAR-REBUILD-SPEC.md:414-436`: parseman's
`src/plugin/direct-builder-static.ts` requires a composed piece's builder to be an
expression-bodied arrow, with plain-identifier parameters only, reading only its own
parameters plus 13 globals. jess's builders call **imported AST constructors** (`decl`,
`dimension`, `funcCall`) and **grammar-local helpers** — neither is in the allow-set.
Host mode is structurally incompatible with `compose()`. See also ledger row **P22** in
`DESIGN-DECISIONS.md`, which measures the blast radius (css 113 / less 208 / scss 153 /
jess 168 distinct rejected productions) and names the second, structural blocker
(`unsupported BlockStatement`).

**5. The spec then resolved the conflict by REDEFINING the requirement.** §12.0 "What
'agent-readable link' means, concretely" (`GRAMMAR-REBUILD-SPEC.md:2009`) makes the link a
**documentation** link rather than a code link, and §414-436 closed the question:
*"This conclusion is settled … do not re-propose `compose()` across artifacts without new
evidence."* That closure is why nothing escalated: the defects below each looked like an
isolated bug rather than a symptom of a missing code link.
CLOSURE-QUOTED: the sentence above is reproduced to identify the violation, not to assert
it. It was repudiated in `GRAMMAR-REBUILD-SPEC.md` and is overruled by OR-1 rule 2.

### THE OWNER HAS OVERRULED THAT — four hard rules

Owner's ruling this session, verbatim in substance:

1. **The CSS grammar defines all regular CSS.**
2. **Each downstream grammar MUST extend the CSS grammar** — import and compose it.
3. **Each may ONLY define specific overrides.** It may not define ANY shape that exists in
   css-grammar already and could have been used.
4. **It MAY NOT create a new rule merely because it is changing PARSING for that rule.**
   A `Quoted` in CSS is still a `Quoted` in every other language even though the superset
   adds interpolation to it.

Owner's stated preference for execution: **start over for each grammar — extend CSS, then
copy in the delta one rule at a time.**

**The escape hatch is the spec's own "without new evidence."** Parseman is checked out
locally at `/Users/matthew/git/oss/parseman` (verified present, with
`src/plugin/direct-builder-static.ts`), so it **can be patched and measured** rather than
treated as a fixed constraint. A lane is testing whether `direct-builder-static` can accept
imported constructors. That is the new evidence the spec's closure asks for.

> **Do not write the four rules into this document.** Another lane is landing them in
> [`../parser/GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md) and into
> **P22** in [`DESIGN-DECISIONS.md`](DESIGN-DECISIONS.md). As of `4d4954156` that landing
> has **not** happened — `GRAMMAR-REVIEW-STANDARD.md` contains no such rules yet. Those two
> documents are canonical for the rules; this section is the pointer and the rationale.

### MEASURED VIOLATIONS OF THE FOUR RULES — each with its evidence

**Rule 4, HARD FAIL — seven superset rule-name aliases for rules CSS already has.**
Rule names, not node-type strings (the node-type string `'ComplexSelector'` does still
occur in the supersets; the *rule* is spelled differently):

| superset rule | css rule | superset sites |
| --- | --- | --- |
| `Complex` | `ComplexSelector` (`css:99`) | less:281, scss:192, jess:155 |
| `ComplexTail` | (css has none — tail is folded into `ComplexSelector`) | less:280, scss:191, jess:154 |
| `Compound` | `CompoundSelector` (`css:100`) | less:279, scss:190, jess:147 |
| `Selector` | `SelectorList` (`css:200`) | less:284, scss:195, jess:157 |
| `SelectorTail` | (css has none) | less:283, scss:194, jess:156 |
| `KeyframeSelector` | `keyframeSelector` (`css:244`) | less:235, scss:176, jess:217 |
| **`LiteralQuoted`** | **`Quoted`** (`css:197`) | less:290, scss:60, jess:88 |

`LiteralQuoted` is the **archetype**. The supersets keep `Quoted` as the interpolating
form and split the plain CSS form out under a new name — which is precisely the move rule 4
forbids outright. Every superset carries BOTH `Quoted` and `LiteralQuoted`
(less:289/290, scss:59/60, jess:87/88).

**Divergences that were real defects, all found and fixed this session:**

- **`@charset` absent from css entirely** while all three supersets had it. Fixed
  `7d32a7fca` (`fix(css-parser): @charset then @import is the canonical prologue, not a
  parse error`). This is the INVERTED fork: the base was the one missing the rule.
- **`<urange>` absent from jess entirely** while css had it. Fixed `fb272dfc1`. jess had
  **no `<urange>` production at all**, so `a { b: U+0-7F }` and every `@font-face`
  carrying `unicode-range` were unparseable. *(Precision: the brief's phrasing "the corpus
  had already recorded 'Jess consumes nothing for ANY `U+` form'" does not match the file
  byte-for-byte. What the repo actually already held — per `fb272dfc1`'s own body — is
  **three entries in `test/css-superset-corpus.ts` carrying `brokenIn: ['jess']` with the
  cause stated correctly**. The substance of the claim, that the repo already knew, holds;
  the quoted string does not.)*
- **scss forked the ident-start declaration decision and produced a WRONG NODE.**
  `div:hover, span { … }` parsed as a `Declaration` named `div` that **swallowed the
  nested rule**. Fixed `b518ac388` (`fix(scss,jess): converge ident-start
  declaration-vs-nested-rule on the CSS decision`).
- **The at-rule prelude re-spelled `balanced()` inline** and lost the shared `customSlash`
  skip, so a lone `/` truncated every bracketed prelude group. Fixed `d5c8f72bb`.
- **Namespaced selectors behave three ways — STILL OPEN.** less is correct; **css
  MIS-PARSES** `svg|circle` into two segments because
  `const combinator = keywords(['||', '>', '+', '~', '|']);`
  (`packages/syntax/css/css-parser/src/grammar.ts:998`) treats `|` as a combinator; scss
  rejects it. Tracked as open item #41.

### SESSION STATE — `origin/dev` moved `a22594121` → `4d4954156`

**41 commits** (`git rev-list --count a22594121..4d4954156` = 41 — the "roughly twenty"
figure in the session brief is low). The material landings:

- **§4.7 unit ladder** — `c906c2f9e` (`an unexpressible unit changes the SPELLING, not the
  arithmetic`), strict rung and warnings; `99197fff0` fixed that the ladder had **no
  reachable site** from `$( … )`; `4d4954156` scoped `unitMode` out of `.jess` as
  Less-compat.
- **Keyword arguments in a function call** — `14760c4dd`. Foundation parse ratchet
  **100 → 115** named entry points. All three superset call-argument productions now reduce
  to ONE node, `CallArg`, at ONE construction site.
- **`@return` / `@content` / `@include` blocks** — `539684f3d`. Foundation parse
  **61 → 93 of 136**. Plus `085401677` (a block-less `@include` makes `$content()` a no-op,
  not an error), `f3b4c3fa1` / `7ace72df7` (`content` is an ordinary scoped variable, not a
  known name).
- **`$while`, `not not`, diagnostics** — `4001391b2` (`@while` becomes `$while`; the
  diagnostics become nothing at all).
- **Placeholder selectors** — `3bcbb7cd8` (emit only through extend).
- **Guard §4.2a** — `c2a760197` (`fix(core)!: a groundless relational is a NON-MATCH in
  guard position`).
- **Control-block reassignment** — `bdb314ae8`. `BindingCell` was **single-slot**; a
  self-read now resolves to N-1.
- **Bracketed lists + `[]` falsy** — `d1c69971c` (`[ … ]` is a list; printing one is grid
  line names or an error).
- **Attribute ident fusion** — `c541b51be` (an attribute selector must not fuse two ident
  tokens) — all four dialects now agree.
- **The css byte-identity oracle** — `8c5852238`, absolute and with **asserted controls**.
  This was P22's stated prerequisite and is now LANDED, so it no longer gates the
  compose conversion; parseman does.
- **The cross-dialect acceptance matrix** — `d9531097f`, one corpus over four parsers
  (`test/cross-dialect/acceptance-matrix.test.ts`).
- **The over-narrow grammar survey** — `c466b8fa3`, 154 probes
  (`docs/architecture/parser/OVER-NARROW-GRAMMAR-SURVEY.md`,
  `test/cross-dialect/over-narrow-corpus.ts`).

### METHODOLOGICAL FINDINGS — worth as much as the fixes

These are the reason the headline finding went unescalated for two weeks. Treat them as
standing warnings about the instruments, not as history.

1. **Two instruments scored everything wrong until a CONTROL caught them**, and a third
   found its real defect only because a control the brief had specified went RED. An
   instrument without an asserted negative control is not evidence. `8c5852238` is the
   pattern to copy: *"absolute and with asserted controls."*
2. **Both existing gates are structurally BLIND to wrong-node defects.** The acceptance
   matrix compares **accept/reject**; the byte-identity oracle compares **emitted bytes**.
   A wrong-but-round-trippable tree — exactly the scss `div:hover, span` defect fixed in
   `b518ac388`, where a `Declaration` swallowed a nested rule — passes **both**. Neither
   gate would have caught it. Probing the NODE is a third, missing channel.
3. **The largest known hole: the over-narrow survey asked "what node results" on only
   7 of 154 rows.** `OVER-NARROW-GRAMMAR-SURVEY.md:388-390` states it directly — extending
   prong A′ to a node-shape differential over the whole 154-probe corpus is the open work,
   *"and today only seven of 154 rows have been asked the second one."*
4. **Baselines were wrong twice, from silent causes.** (a) A stale `lib/` — vitest reads
   `lib/`, not `src/`, so an unbuilt worktree silently reports a *past* version of the
   repo. (b) A **dirty `~/git/oss/less.js`** oracle reached through a `link:` dependency; a
   clean-worktree A/B is blind to it. **Run `git -C ~/git/oss/less.js status --porcelain`
   and report its output as evidence alongside any corpus number.** *(Not run here: this
   agent is worktree-isolated and its tooling refuses a `git -C` outside the worktree.
   Unverified in this session — the requirement stands for whoever measures next.)*

### HIGHEST-SEVERITY OPEN ITEMS — recorded by name so they survive

The full list lives in the session task list, not in this repo. These five are recorded
here only so they are not lost with the conversation. **Numbers are task-list ids and are
not verifiable from the repo**; the described defects are.

- **#41 — css `|` mis-parse.** `svg|circle` splits into two segments;
  `css-parser/src/grammar.ts:998` puts `|` in the combinator keyword set. Verified above.
- **#50 — jess grammar duplicate keys make the FIRST productions UNREACHABLE.** Suspected
  cause of the `@media` / `@container` rejections. *(Duplicate-key claim not independently
  re-verified in this session.)*
- **#51 — the language service RE-PARSES selector BYTES**, a §6 keystone violation
  (the parser owns structure; core and tooling never re-derive it from bytes).
  *(Not independently re-verified in this session.)*
- **#36 — `@extend` does not propagate out of mixin bodies.** This is the real blocker
  behind #12. *(Not independently re-verified in this session.)*
- **#43 — `pseudoArgumentContent` has its own inline `balanced()` twin**, the same class of
  defect `d5c8f72bb` fixed for at-rule preludes, in a second place.
  *(Not independently re-verified in this session.)*

## SESSION HANDOFF — 2026-08-01, jess `d7ebe562e` / parseman `release/0.47.0` `cdf33f3`

**All agents were stopped mid-flight at a spend limit.** Nothing below is in progress;
every branch named is landed or explicitly held. Read this section before the older
WORK IN FLIGHT block, which predates it by a week.

### Owner decisions waiting

1. **parseman 0.47.0 is ready to merge and publish.** PR #104, all gates green
   (changelog, control-bytes, typecheck, docs 124/124, 3777 tests), **0 unresolved
   review threads**. Owner merges parseman PRs; agents never do. Publishing is
   owner-only. Until it publishes, jess cannot adopt `parseman/table` except by a
   temporary link (see below).
2. **`Quoted.value` is `readonly value: string`** (`packages/core/src/ast/nodes.ts:68`),
   so a `Quoted` node with `escaped: true` **cannot hold an interpolation**. That blocks
   the real fix for parse-time quote-dropping. Making it able to is a core AST change plus
   eval work — pinned as a defect in `jess-parser/test/discovered-constructs.test.ts`,
   not decided.
3. **G18's carve-out swaps sides under a table lowering.** It licenses unidiomatic
   *generated* code and requires hand-written source to stay idiomatic; a table has almost
   no generated code, so the licensed tricks would live in the hand-written driver. Needs a
   ruling, not an agent's judgement.
4. **G2 says "Codegen ≤ 4× source bytes."** Its noun is wrong under a table and its
   derivation (§2.3's "needs a 1.9× call-site reduction") rests on ~950 B per named call
   site. If the marginal figure holds, the gate stops discriminating between the four
   grammars rather than being passed. Per the standing perf-gate rule, that is a
   re-derivation with owner sign-off, not a silent pass.
5. **Can a `dispatch()` keep the diagnostic that an ordered `choice` gives?** See G30
   below — this blocks two conversions and, if resolved, unblocks the `parser-shared`
   at-keyword work that reaches all four dialects at once.

### ACTIVE GOAL — 2026-08-01: the table must parse `benchmark.less` in ~17.41 ms OR LOWER

Owner-set, verbatim: *"Get the table-based Parseman (0.47) to ~17.41 ms when parsing
benchmark.less (without resorting to a gazillion megabyte codegen again - do NOT sacrifice
core goals)"* and *"OBVIOUSLY 17.41ms OR LOWER... in case an LLM is stupid and is like
'oops, i successfully parsed in 8ms, better revert'."*

**Faster than codegen is a win to report, never an anomaly to revert.**

`benchmark.less`, 106,802 B, AST path: **codegen 17.41 / table 46.86 / interpreter 99.68**.
Note a second lane measured the same fixture at 22.17 / 49.72 / 111.33 — **27% apart on the
baseline**, box and harness settings. A lane is pinning a canonical protocol and a single
command; until it lands, **quote the ratio alongside any absolute** or the numbers are not
comparable.

**The constraint is as binding as the target.** The way to make a table fast is to stop it
being a table. **No per-rule code emission, no generating JS from the table, no
reintroducing inlining.** Measure artifact bytes alongside milliseconds; material growth in
the emitted table is the signal the line has been crossed. The size win is not currency.

### THE ROOT CAUSE — G5's specialisation half was never implemented

This is the single most important thing in this document. The measured gap does not
decompose into several defects. It is **one missing half of the design**, surfacing
wherever the driver touches the parse path.

Owner, verbatim: *"the entire fucking table design was to do that logic branching ONCE and
NEVER AGAIN PER NODE."*

G5 says: build the grammar reference at run start, **swap in specialised implementations
for rules and sub-rules (leafs)**, then run with no branching. The encoder was built to
*represent* the grammar faithfully. **The half that *specialises* it was not built.** So:

| analysis, already written | wired into `src/table/` |
|---|---|
| `src/compiler/scannable-run.ts` — 76,570 B | **no** |
| `src/compiler/trivia-fast-path.ts` — 11,119 B | **no** |
| `src/compiler/token-scanner.ts` + `token-alphabet.ts` — 24,338 B | **no — no consumer at all** |
| CST capture elision (`FUSED_HOST_ELIDED = mode === 'ast'`) | **no** |

**~112 KB of recognition and lowering analysis sits one import away**, while the driver pays
generic cost for every terminal, every trivia scan, and every node. `codegen.ts` imports
`token-dispatch.ts`; nothing imports `token-scanner.ts` or `token-alphabet.ts` at all.

**The test for any candidate: could this have been decided when the table was built?** If
yes it belongs in `resolveTable`/`OP_SCOPE` as a swapped-in specialised path, not in the
parse loop.

This also explains why **materialising the table into a closure tree bought only ~10%**
(measured, −9.3/−8.5/−9.9%, 20/20 wins): it changed how rows *dispatch* while leaving what
rows *do* generic. **Do not re-attempt materialisation** — it has been built and measured.

### Where the time actually is on `benchmark.less`

**The json profile misled every lane and is retired.** The 60% recognition / 29% trivia /
6% reducers split came from 12 KB of json. On `benchmark.less`:

| | table | compiled | share of gap |
|---|---:|---:|---:|
| **CST capture machinery** | **21.7%** | **~0%** | **~40%** |
| trivia | 3.1% | 4.4% | ~2% |

`OP_NODE` calls `beginCstNodeCapture` unconditionally **on the AST path**, where the
compiled artifact stamps `FUSED_HOST_ELIDED` and elides it. Second-order effect is arguably
larger: setting `_cstBuf` keeps `rollbackNeeded()` true for the whole parse, so **every
choice attempt and every repetition item allocates a 5-field mark object** that codegen does
with scalar locals. That is the per-item allocation a lane hunted on json and could not
replicate — json has almost no nodes.

**Two directions are parked with evidence, do not re-derive them:** `AGENT-EVIDENCE:` —
agent-measured, closing an agent's own proposal; no owner requirement is closed here.
- **Trivia** — the swap was *built correctly to G5* and buys **nothing**: `fastTriviaScanner`
  cannot lower `classifiedTrivia` because its arms are `label()`-wrapped. css 0 of 4, less
  0 of 8, scss 0 of 2, jess 0 of 2 lower. json's trivia is a plain regex, which is the only
  reason it profiled at 22%. Measured effect on `benchmark.less`: **−0.19 ms, noise.**
- **Terminals** — only 31–48% are scannable (less 49/142, css 26/83, scss 51/106, jess
  47/112) and **no `RegExp.exec` frame appears in the top 18** of the less table profile.
  Unproven, not disproven.

### Where the architecture stands, measured

**Correctness — met, with one qualification I over-reported.** Three-way identity
(interpreted / compiled / table) across **2,833 files** with every cap removed: css 87,
less 314, scss 2,408, jess 24. **`table-outlier` = 0 on all four.** No defect was hiding in
the 2,414 files nobody had looked at.

**The qualification:** that sweep ran on **jess's** corpora. parseman's own `examples/csv`
exposes a genuine table-outlier — `sepBy()` over a nullable item yields `[]` on empty input
where interpreter *and* codegen both yield `[""]`, so the grammar's drop-trailing-empty-row
transform never fires (5 rows vs 4). Pinned; csv is unmeasurable in the SVG comparison as a
result.

**Size — met decisively.** Per variant, whole artifact:

| | codegen raw / gzip | table raw / gzip | raw |
|---|---|---|---:|
| css | 2,276.6 KB / 315.6 | **74.2 / 15.1** | 30.7× |
| less | 2,863.0 / 406.4 | **209.3 / 33.2** | 13.7× |
| scss | 1,883.1 / 266.9 | **108.4 / 20.2** | 17.4× |
| jess | 2,015.9 / 288.4 | **119.2 / 23.3** | 16.9× |

Conservative (codegen shares ~14% across variants): **12.5×–27.4×**. Machinery only,
reducers removed from both sides: 19.7×–41.4×. Shared driver 68,738 B once. All four
dialects × four variants: **2.00 MB against 31.56 MB.**

**Load time — a large table win, and the counterweight to the parse cost.** Cold import to
parser-callable: css 65.4 → **7.4 ms**, less 83.4 → **8.0**, scss 49.4 → **7.1**, jess 54.1 →
**7.1**. V8 compile alone is **46–85×**. Codegen's cost is **43–68 ms deferred, not absent** —
lazy compilation hides it until first call, and a parser calls every rule it has.

**Crossover** — below it the table is faster overall, above it codegen is: **css 0.36 MB,
less 0.17 MB, scss 0.17 MB, jess 1.18 MB.** So the table wins one-shot and editor
workloads outright and loses sustained bulk compilation. Every millisecond off the parse
side moves the crossover right.

**The penalty does not track input size.** `gen-workload.less` at 275 KB is 4.11× while
`benchmark.less` at 107 KB is 2.69×, same dialect. It tracks **which constructs a file
exercises**. Never optimise into a single fixture.

### G1–G5, honestly

| | status |
|---|---|
| **G1** fastest in the SVG comparison | **being measured on the table for the first time.** Every prior pass — 11/11 groups, tightest 1.80× over chevrotain — had **codegen** on the parseman side. csv is unmeasurable (the `sepBy` outlier), so coverage is 9 of 11 groups |
| **G2** ≤ 4× source bytes | **met**, with wide margin |
| **G3** no factory pattern for options | **met** — options resolved at build, zero option reads on the parse path |
| **G4** one grammar, one output | **NOT met** — four `trackLines`×`hostMode` tables per dialect, differing by only **0.2–0.4%**. G5's build-at-run-start with row swaps should give one artifact plus small deltas. *(An earlier claim that AST and CST are byte-identical tables was TOY-derived and is false on all four real grammars — proven by sha256, not byte counts.)* |
| **G5** build at run start, swap, no branching | **half met** — the *option* half is honoured literally (`trackLines` swaps rows at build, zero option reads in `exec.ts`); the **leaf/node half was never built**. See THE ROOT CAUSE above |
| **G14** predictive token cursor | **never composed with G5.** The ledger records G14 as settled and separately records that nobody specified how it composes with the table. A token cursor feeding a driver is a different machine from one feeding generated code |

### Two more defects of the same class, found today

**`run()` taxes every parse 36.9% on small input.** `guardRemovedFields`
(`src/functional/run.ts:162`, called at `:337`) installs **two `Object.defineProperty`
throwing accessors on every result** — a migration aid for fields removed in **0.44.0**.
Per-instance accessor properties on a hot object, in a repo with numbered V8 invariants and
a recorded incident where a hidden-class split cost **46% of CSS parse time**. Being fixed.

**Builder call-site megamorphism.** Every builder reaches **one** `build(...)` site in the
driver — css **125** distinct builders, less 259, scss 152, jess 175 — against V8's inline
cache limit of **4**. Codegen calls each from its own monomorphic site. Materialising does
**not** fix this. ~6% of the gap.

### Enforcement — the rules exist and nothing checks them

Every defect above landed in a repo whose docs forbid it. `docs/perf/V8-ARCHITECTURE.md`
has numbered invariants; `docs/architecture/llm-quality-enforcement-design.md` is an
enforcement design that was written and never built; jess's `pnpm lint:absolute` detects the
`as any` ban, has found ~500 violations across 52 files, and **has never been gated**.

**LANDED 2026-08-01** — parseman branch `feat/invariant-gate`, `pnpm check:invariants`,
wired into CI's required `test` check, the pre-commit hook, and `pnpm test`. Rationale in
`docs/design/invariant-gate.md`. Four rules, all source-decidable, no thresholds:

- **INV-1** accessor descriptors in `Object.defineProperty` — object-*literal* getters stay
  legal, since the repo uses them for lazy materialization and banning them would be the
  false positive that gets the gate switched off
- **INV-2** a field in an exported `*Options` type read nowhere in `src/**` — starts at zero
  across 29 public option types
- **INV-3** a `src/**` module unreachable from `package.json` exports
- **INV-4** byte-identical top-level declarations across files

**It immediately caught this session's own pattern:** INV-3 flags `token-alphabet.ts` and
`token-scanner.ts` as having no consumer, and INV-1 flags `run.ts:guardRemovedFields`.

**The rejections are the substance.** The conditional-spread rule (jess's 46% incident) was
implemented and **removed**: 177 pre-existing hits, overwhelmingly cold string-assembly code,
and source carries no notion of call frequency so it cannot separate the hot case from the
idiom. Recommended instead: a two-sided count ratchet over a declared hot-module set, in the
shape of `choicecost:guard`. Also rejected with reasons: conditional property assignment
(not decidable), side-effect registration reachability (needs to know which side effects are
load-bearing — INV-3 catches its neighbour but not this), allocation/complexity invariants
(counting instruments against baselines, not lints), monomorphic node shapes (runtime-only).

12 pre-existing violations, allowlisted **by name**, and a **stale entry fails the gate** —
an exemption for a fixed violation is a licence to reintroduce it. Six are the frozen
ablation controls; six are real debt.

### Lanes in flight (2026-08-01, all on branches, nothing merged)

| branch | doing |
|---|---|
| `diag/table-penalty-attribution` | **the big one** — CST capture elision, then sweeping the whole decide-once class |
| `perf/builder-call-site` | the 125-builders-into-one-call-site megamorphism |
| `fix/run-result-guard-tax` | the per-result `defineProperty` accessors |
| `bench/benchmark-less-canonical` | one reproducible `benchmark.less` measurement + command |
| `feat/invariant-gate` | mechanising the written invariants |
| `measure/svg-margin-table` | G1 on the table, 9 of 11 groups |

**Codegen deletion is the LAST step before merge**, not now — it is the comparison baseline
while a gap remains. The pinned codegen numbers are scaffolding and get deleted with it.

### THE GOAL, and it is not what several lanes have been working to

**Owner ruling, 2026-08-01, verbatim:** *"you're not even close, and we CAN'T TELL IF WE
KEEP THIS WHOLE ARCHITECTURE YET because you haven't FINISHED it to where it's PROVEN
against all Jess grammars."* And: *"why would i accept ANY PR until you PROVE ./table
works, has acceptable speed trade-offs, and is finalized as working, and if so, all other
parsing / codegen paths are deleted and replaced with table paths."*

**The table is not a second lowering that lives alongside codegen. It replaces it.** That
is `DESIGN-DECISIONS` **G4** — *one input grammar, one compiled output* — and **G5**, the
owner's own design. Several lanes, and the orchestrator briefing them, drifted into
treating it as an opt-in prototype to be incrementally de-bugged. That is how a parallel
path becomes permanent.

**The open question is whether this architecture is worth keeping.** It cannot be answered
until the design is finished far enough to measure. Until then:

- **Nothing merges.** Green PRs that fix pieces of an unvalidated design are premature
  polish. Fixes land as branches; they are held, not merged.
- **A limitation is not a scope decision.** The 0.47.0 CHANGELOG called `balanced()`/
  `scanTo()` non-emission a documented limitation. That framing is withdrawn — it is the
  thing that makes the whole design unmeasurable, since no shipping grammar can be written
  to a module at all.
- **The deliverable is a WORKING, FAST table design — not a verdict.** *(Corrected
  2026-08-01. This section previously said the deliverable was a verdict and that an
  unfavourable number was a legitimate answer. That was wrong and the owner rejected it:
  "no. we're close enough that you have to make this right. if we're on the wrong side of
  speed, you work night and day until we fix it" — and, on scope, "with the table
  design.")* A bad number is the problem statement, not the answer. The design ships; the
  work is making it fast **within** the table architecture, not pivoting away from it. An
  approach is withdrawn only when proven **impossible** or its premise proven **false** —
  a disappointing measurement is neither.
- **When it is proven, codegen is deleted.** `src/compiler/codegen.ts` and everything that
  exists only to serve it. Not kept as a fallback.

Where it actually stands, so nobody quotes a friendlier number: the table **loses 41 of
111** all-less cases against the interpreter on identical combinators, **throws on 40 of
136** corpus files where the interpreter succeeds, **differs silently in bytes on 2 more**,
and **mis-parses jess wholesale** (5 of 6 matrix cells). `113 B/rule` and `~2.65×` are
16-rule-ladder and json figures and are not evidence about real grammars.

### NEXT UP — the ordered path to table-based jess builds, then semantics/naming

Every item below is blocking the one after it. Do them in order; each has a stated
done-condition so nobody has to guess. **Steps 1–2 are jess's; steps 3–6 are parseman's;
step 7 is jess's and is the declared top priority once 6 lands.**
The measured facts behind each are in the sections that follow.

**1. Fix the `sepBy`/`rawChildren` reducer bug. (jess, ~small, no dependencies)**
Reducers compute a trivia insert index from `children` when the index addresses
`rawChildren`. `sepBy` no longer contributes separators, so the two arrays no longer
advance in step and comments around separators are silently dropped.
*Find them:* any reducer for a `node()` containing `sepBy`/`oneOrMoreSep` that correlates
a `children` index with a `triviaLog` insert index. Also check reducers that index
`children` positionally or read `children.length` to count.
*Done when:* `comments`, `comments2`, `at-rules-keyword-comments` pass under parseman
0.47.0, and all-less is back to 110/111 with 0.47.0 macro. **This is required to adopt
0.47.0 at all — table or not — so it is the first thing regardless.**

**2. Remove the duplicate factory keys. (jess, trivial)**
`QueryValue`, `QueryTerm`, `QueryFeatureName` are each declared twice at
`packages/syntax/jess/jess-parser/src/grammar.ts:6124-6131`. esbuild warns; the macro
build does not. *Done when:* each key appears once and the jess suite is unchanged.

**3. Register the regex first-set analyzer in the `parseman/table` module graph.
(parseman, blocking everything)**
`regex()` derives its first set from an analyzer registered only in `src/index.ts`.
`dist/table/` is a separate graph that never runs that registration, so `regex()` returns
the permissive `any()` fallback and `classifiedTrivia` rejects every arm with
`"whitespace" must be non-nullable with a concrete finite first set`.
**All four dialects are dead on arrival from the published shape** — this is not a jess
problem and no jess change can work around it.
*Done when:* `tableRules(encodeTable(<any jess grammar>))` runs from the built
`dist/table` with no aliasing to source.

**4. Isolate and fix the jess mis-parse. (parseman)**
jess fails 5 of 6 matrix cells — cannot parse `.a{color:red}` under the table, with
`expected: ["routed()"]` at the value position. The interpreter control passes on the
*same live combinators*, so it is the lowering. Lowest divergent rule is
`IdentifierOrFunction` (`jess-parser/src/grammar.ts:3334`) / `KeywordValue` (`:3195`),
reached from `ValueAtom`, `Value`, `CallComponent`, `CalcSum`, `QueryValue` — 60
rule×input divergences. jess is the only dialect using
`makeWhen({ caseInsensitive: true })` (`:1665`), **but a minimal repro of
`dispatch` + `caseInsensitiveWhen` + `otherwise(node(…, routed(), …))` does not
reproduce it**, so the trigger is narrower than that and is still unknown.
*Done when:* jess passes all 6 matrix cells and the repro is named.

**5. Close the Less corpus divergence. (parseman)**
The table loses 41 all-less fixtures against the interpreter on identical combinators.
At parse level over `tests-unit/**/*.less`: 136 files, 94 identical, **40 throw** where
the interpreter succeeds, **2 differ silently in bytes**. Start with the silent pair —
`at-rules.less` 1677→1682 and `detached-rulesets.less` 1254→1743 — because a wrong tree
with no error is the worse class and the throws are louder. The throw messages
(`Unexpected Less input after a complete stylesheet`, `Missing closing brace`,
`Less arithmetic grammar lost an operator operand`) suggest more than one cause.
*Done when:* table parse-level output is byte-identical to the interpreter across all
136 files.

**6. Lower `balanced()` and `scanTo()`. (parseman) — OWNER RULING 2026-08-01: this is
NOT an acceptable limitation.** Verbatim: *"that's not acceptable, make sure everything
compiles / emits in our combinators for this table design"*. The CHANGELOG called it a
documented limitation; that framing was wrong and is withdrawn. **Every combinator must
emit.** A table design where two core combinators cannot be written to a module is not a
working design — it is precisely what makes the size claim unmeasurable. Treat this as a
correctness requirement on the lowering, not a scope decision.
Both park live combinator objects via `OP_CALL`, so **no shipping grammar can be emitted
as a module** — css/less/scss block on both, jess on `scanTo` alone. A previous
investigation established that **neither genuinely requires a live object**: `token` is
save/clear/run/restore/one-leaf; `balanced`'s `_def` is its eager interior and its
one-leaf behaviour is `token`-shaped; `scanTo`'s sentinel and skippers are grammar-graph
combinators. `scanSkip` is ambient but static per scope, so it encodes as offsets
installed by `OP_SCOPE` — **prove that rather than assuming it**, because a skip set that
resolves at an outer scope and silently empties in an inner one is the same silent shape
as the trivia bug.
Two traps recorded from the failed attempts: `balanced`'s outer node is a `token` and
`_balancedAmbient` sits on the **inner** combinator; and `balanced()` *does* detect
crossed closures (`([a)]` reports `errors=1` via `expect()`), so a read-back measuring
only consumption cannot distinguish acceptance from recovery.
*Done when:* all 16 cells emit, the emit round-trip passes for each dialect, and
per-dialect artifact bytes and parse time can finally be measured.

**Only after 6 do the numbers this whole effort exists to produce become obtainable.**
Until then `113 B/rule` and `~2.65×` remain ladder-and-json figures and must be labelled
as such.

**7. Resolved semantics and naming — TOP PRIORITY once 1–6 are done. (jess)**
**Owner ruling 2026-08-04:** when the table work finishes, this is what agents pick up
next, ahead of anything not already in flight. Spec:
[`../../design/RESOLVED-SEMANTICS-AND-NAMING.md`](../../design/RESOLVED-SEMANTICS-AND-NAMING.md).
Every ruling in it is decided and **none of it is implemented**, so it is execution, not
design — with one exception, §12.3a, which is a design task and should be done first.

**Three phases, in this order. Each one is a prerequisite for the next.**

**7a. Rename and refactor the AST nodes. (core)**
The node set is what everything downstream is stated over, so it moves first.
- **§12.3a — the reference-family lookup descriptor.** The only piece of the whole item
  that needs *design* rather than execution. Do it before any other reference-node edit;
  each deferral tempts the next change to add a sixth private copy of `scope`.
- **§12.3 rows 1–3 and 5** — delete `SpacedValue`, `Assignment`, `GeneralEnclosed`,
  `RawInline`. Independent of the descriptor and of each other.
- **§10 Phases 0–6** — Part I's semantics in core (comparison evaluates, `==`,
  trichotomous relational, truthiness, recognition). Phase 4, the collapse of
  `equalityMode` into the lowered comparison primitives, has LANDED. Phases 0–3
  and 5 are marked unblocked and do not wait on the node work.
*Done when:* the union in `packages/core/src/ast/nodes.ts` is the intended set, every
switch over it compiles, and no reference node carries a private spelling of scope or kind.

**7b. Update the parsers to produce the new nodes. (four grammars)**
Reducers currently construct the kinds 7a deletes. Every `generalEnclosed(…)`,
`assignment(…)`, `spacedValue(…)`, `varIndirect(…)` and `rawInline(…)` call site becomes
the surviving constructor, and reference-building reducers emit the descriptor.
*Done when:* all four grammars build against the new union with no adapter or shim, and
the byte-identity oracle is clean per dialect.

**7c. Slim the parsers down and rename them to the same semantics. (four grammars)**
Only now is it safe and cheap — 7a deletes kinds whose labels this phase would otherwise
have renamed.
- **§12.4** — the ~40 labels that misspell a real node (`VarDeclaration`, `NamedColor`,
  `Paren`, `Map`, `Percentage`, `SassInterpolation`, …).
- **§12.1** — collapse the precedence ladder so `CalcSum`/`CalcProduct`/`CalcValue` and
  the jess `Expression*` rungs stop reaching the CST at all, the way less's already do.
- **§12.7 and the parser-internal duplication** — `ExpressionQuoted` becomes `Quoted`;
  the `ExpressionFact` envelope stops metastasising into twin productions
  (`ExpressionDollarBrace` vs `DollarBrace` are an identical parser and reducer).
*Done when:* a grammar's `node('…')` labels either name a real kind or are honest
production names, and the four grammars are smaller than they started.

*Why the whole item waits for 1–6 rather than running beside them:* 7b and 7c move
grammar output — 7c renames `node('…')` labels in all four grammars and changes `collapse`
on the calc ladder. Neither can be gated while the table lowering is still diverging from
the interpreter (steps 4–5): a table divergence and a rename regression would be
indistinguishable. 7a is core-only and could in principle start earlier, but splitting the
item across the table work is how the reference family got duplicated in the first place.

**Rebuild the measurement harness first, before step 3.** The one that produced every
number above was throwaway (gitignored `.scratch/`) and is gone. It should be a permanent
script: parse-level table-vs-interpreter diff over the 136-file corpus, comparing
serialized CSS. The interpreter is the ideal control — same live combinators, so any
divergence is purely the lowering — and without it every step above gets re-measured by
hand. **Proposed and not answered; treat as the first task unless the owner says
otherwise.**

*Linking parseman 0.47.0 into jess before it publishes:* use a **workspace-root-relative**
`link:` in `pnpm.overrides`. An absolute path is silently mis-linked by pnpm 8.15, and
because `.claude/worktrees/*` sits inside the mirror the broken link resolves upward into
the mirror's `node_modules` and finds a *different* parseman with no error. **Print the
resolved realpath and version from every package and assert one distinct realpath before
trusting any number.**

### parseman 0.47.0 — what shipped

The table lowering (`src/table/`) ships as a **real public export** (`./table` is in
`package.json` exports) that is **not on the shipping path** — nothing outside
`src/table/` imports it, and macro / `compile()` / `compose()` do not reach it. Known
limitations are stated in the CHANGELOG: four failure-reporting divergences, a
structural-node refusal under `hostMode: 'cst'`, and no grammar using `scanTo()`/
`balanced()` can be emitted.

`113 B/rule` and `~2.65×` are **ladder-and-json figures**, never measured on a shipping
grammar. The CHANGELOG records that. Do not quote them as if they were.

### The table measured against jess — the numbers, and they are unfavourable

Run with parseman 0.47.0 linked into jess (workspace-root-relative `link:`; an absolute
path is silently mis-linked by pnpm 8.15 and resolves upward into the mirror's
`node_modules`, finding a *different* parseman with no error — **print the realpath
before trusting anything**).

| configuration | all-less |
|---|---:|
| parseman 0.46.0, macro (jess's shipping config) | **110 / 111** |
| parseman 0.47.0, macro | 107 / 111 |
| parseman 0.47.0, interpreter | 101 / 111 |
| parseman 0.47.0, **table** | **60 / 111** |

Corpus: `~/git/oss/less.js/packages/test-data`, branch `alpha`, SHA
`2f309b667df0fed192c83e1b32b4a72f045798f4`, 111 cases each side. Parse-level over
`tests-unit/**/*.less`: 136 files, 94 identical, **40 threw** where the interpreter
succeeded, **2 differ silently in bytes** (`at-rules.less` 1677→1682,
`detached-rulesets.less` 1254→1743). The silent pair is the worse class.

**Blockers, by owner:**

*Parseman-side (jess cannot fix these):*
- **`parseman/table` cannot run any classified-trivia grammar as shipped.** `regex()`
  derives its first set from a registered analyzer; the analyzer is registered only in
  `src/index.ts`, and `dist/table/` is a separate module graph that never runs that
  registration. `classifiedTrivia` then rejects every arm. **All four dialects, dead on
  arrival from the published shape.**
- `balanced()` / `scanTo()` park live combinator objects via `OP_CALL`, so no shipping
  grammar emits. css/less/scss block on both; jess on `scanTo` alone.
- The table mis-parses. jess fails 5 of 6 matrix cells (`expected: ["routed()"]` at the
  value position; lowest divergent rule `IdentifierOrFunction`
  `jess-parser/src/grammar.ts:3334`). Root cause **not isolated** — a minimal
  `dispatch` + `caseInsensitiveWhen` + `otherwise(node(…, routed(), …))` repro does not
  reproduce it.
- `buildSpecModel` **infinitely recurses on `balanced()`** — `RangeError` at default
  stack, SIGSEGV at `--stack-size=40000`. Three rules are pinned in the diagram generator
  to work around it: css `AtRulePreludeGroup`, less `AtRulePrelude` + `OpaqueAtPrelude`,
  scss `AtRootFilterPrelude`.

*Jess-side (short list — jess is not the blocker):*
- **The `sepBy`/`rawChildren` reducer bug.** Reducers compute a trivia insert index from
  `children` when it addresses `rawChildren`; once `sepBy` stopped contributing separators
  the two diverge and comments around separators are silently dropped. Costs 3 fixtures
  (`comments`, `comments2`, `at-rules-keyword-comments`). **Required to adopt 0.47.0 at
  all**, table or not.
- `QueryValue`, `QueryTerm`, `QueryFeatureName` are each declared **twice** in the jess
  factory return object (`jess-parser/src/grammar.ts:6124-6131`). esbuild warns; the macro
  build does not.

The measurement harness was throwaway (gitignored `.scratch/`) and is **gone**. The
interpreter is the right control — same live combinators, so any divergence is purely the
lowering. **Rebuilding it as a permanent script was proposed and not answered.**

### Grammar quality — the diagrams are the instrument

`docs/grammar/railroad/` (landed, `d84bb3855`): `index.html`, four dialect pages,
`complexity.html`. 788 KB, self-contained, no external assets. Generated from the same
`rules()` tree that parses, so they cannot drift from what actually parses.

The owner read them and found more actionable defects in minutes than three
byte-measurement lanes found in days. **That is the lesson: grammar quality is a
legibility property, read it directly.** A bake-off that judged three css rewrites on
artifact bytes answered a question nobody asked and is deprioritised —
*"more important fish to fry"*.

Thresholds he set: **>30 symbols**, **>10 rows**, and unique chain count. Rows are a
*decomposition* metric — a named reference is one row, an inlined alternative is its own,
so >10 rows means "this rule should be split, and here is what into".

The nine defect classes, with verified specimens:

1. **Inline instead of linked** — `ModuleDirective` (scss) inlined the quoted production
   instead of referencing `Quoted`. **Fixed.**
2. **A construct re-spelled per variant** — `Quoted` wrote the `~` prefix four times.
   **Fixed in jess; less and css carry the identical shape, untouched.**
3. **A hand-maintained exclusion list** — `atRuleKeyword`
   (`parser-shared/src/recognition.ts:315`) has **two leading `not()`s in one sequence**;
   `GenericAtRuleName` (`:302`) has three. **Not converted — see G30.**
4. **Alternatives inlined instead of named** — `ConditionalBlock` spells three
   `<AtKeyword>+<Prelude>+<body>` arms inline and `NestedConditionalBlock` spells the same
   three again. **Conversion attempted and reverted — see G30.**
5. **Trivia re-spelled inside a rule** — `ImportTail` (`css/grammar.ts:2779`) is
   `noTrivia(sequence(many(importTailWhitespace), …))`, and `ImportTailBody` installs a
   *third* table via `parser({ trivia: commentTrivia })`. **Not started.** Real count of
   hand-written whitespace: **154 lines** across the five files (less 59, parser-shared 30,
   css 28, jess 25, scss 12) — the ~114 on record was wrong.
6. **Glue rules that are not constructs** — `AtRulePreludeWhitespace`, `AtRulePreludeComma`,
   `AtRulePreludeGroup`, `AtRulePreludeQuoted` (`css/grammar.ts:2845-2863`),
   `ImportUrlUnquoted`, `DoubleQuotedText`. **Not started.**
7. **`routed()` renders as nothing** — so `PageBlock`, `Keyframes`,
   `FontFeatureValuesBlock`, `OpaqueAtRuleBlock` all appear in the diagrams without their
   at-keyword. **The diagrams are actively misleading here**; any conclusion drawn from a
   `routed()`-bearing diagram is suspect. Emitter bug, **not fixed**.
8. **Named for the body, not the construct** — the same four rules; owner proposes
   `PageAtRule` / `KeyframesAtRule` / `FontFeatureValuesAtRule` / `UnknownAtRule`. Note
   classes 7 and 8 are entangled: some may be correctly named and only *look* wrong.
9. **Context threaded as a duplicate rule family** — css has **four** `TopLevel*` rules
   (`TopLevelSelectorList`, `TopLevelComplexSelector`, `TopLevelCompoundSelector`,
   `TopLevelRuleset`), each a near-copy of its twin differing only by one reference.
   `SelectorList` and `TopLevelSelectorList` are byte-identical apart from
   `g.ComplexSelector` vs `g.TopLevelComplexSelector`. **less, scss and jess have zero
   `TopLevel*` rules.** The mechanism this wants is `withCtx`/`gate` — but `withCtx` and
   `gate` also render as nothing, so collapsing the chain would make the grammar smaller
   and the diagram *less* informative. **Parseman feature requirement: the diagrams must
   be able to show context.**

**The reconciling principle**, which resolves classes 4 and 6 looking contradictory:
*a rule should be a language construct — not a fragment of one, and not a bundle of
several.* `ConditionalBlock` is a bundle; `AtRulePreludeComma` is a fragment.

### G30 — the dispatch/diagnostics conflict, and a live bug

**Ten real Sass at-rules do not parse.** `@while`, `@content`, `@debug`, `@warn`,
`@error`, `@-use`, `@-compose`, `@-export`, `@-import`, `@-from` are named in
`scssOwnAtKeyword` but have **no production anywhere**; the exclusion removes their only
remaining route, so they are neither typed nor opaque and fail with `Unexpected SCSS
syntax.` Pinned with a fixture; ledger row **G30**. Shortening the list is *not* the fix —
those names are excluded so an evaluated directive is not emitted verbatim, and routing
`@while` to opaque would put it in the CSS output. **They need productions.**

**Why the dispatch conversions are blocked.** `ConditionalBlock` was rebuilt as a
`dispatch` — arms named, `@supports`' `interstitialTrivia` preserved, node labels
unchanged, `cst-host.ts:194` checked first (`publicGrammarType` maps both to
`QueryAtRuleBlock`, so naming arms is not a CST change). It **broke 4 css tests**, all
`expected 0 to be greater than 0`. The ordered `choice` is **load-bearing for
diagnostics**: a malformed prelude currently falls through and reports; `dispatch` commits
on the at-keyword and the error disappears. Reverted to a byte-identical tree rather than
adjust the tests. The same blocker applies to `atRuleKeyword` in `parser-shared`, where it
would reach all four dialects at once.

**No dialect overrides any `*AtKeyword` rule** — verified. By the compose-override
criterion they are enumeration for its own sake, but the `ConditionalBlock` result is
direct evidence that folding them into a dispatch is not free.

### Corrections to things previously recorded

- **`pnpm check:control-bytes` does not exist in jess.** It is a parseman gate. Several
  lanes were told to run it and had to hand-roll the scan.
- **Leading-`not()` sites: 30**, not ~18 (css 12, less 8, jess 6, scss 4). Total `not()`
  calls: css 22, less 46, scss 30, jess 17 — so the standard's "~460 vs 21" is also stale.
- **Half the "byte-identical duplicate rules" list was a false premise** — `HexColor`,
  `BlockCommentToken` and the less identifier family are shared *terminals* in
  `recognition.ts`, not rules; `Stylesheet`==`Document` is an alias key, one object.
  **Confirmed real:** css `StatementPrelude`==`AtRulePrelude` (identical bodies *and*
  reducers, only the node-type string differs) and jess
  `Expression`==`ExpressionInterpolation` (identical bodies, materially different
  reducers).
- **`bench/` in parseman had never been typechecked** — 82 errors, two real bugs. Now
  under `tsc` with zero suppressions and nothing excluded.

### Parked, in priority order

1. `balanced()` and `scanTo()` lowering — the emit round-trip for shipping grammars, then
   per-dialect bytes and timings. `notes/TABLE-DRIVER.md` in parseman carries the queue
   with the trap that sank each previous attempt.
2. Furthest-failure merging — the table reports a choice's union at its own position where
   both engines report at the furthest position reached.
3. **`css/stylesheet` showed a +23.7% median on one of five passes** in the 2026-08-01
   quiet-box `workload-perf` run against the new `a5dc9bd` anchor (load 1.87 → 1.76).
   The run **passed** — a workload fails only on a strict majority of breached passes,
   and this breached 1/5 — but the null control for that workload read only +0.7%, so it
   is not obviously instrument noise. Worth one look on a quiet machine.
4. The perf-gate waiver has **never been watched failing end to end**. Its decision logic
   is unit-tested (26 tests, 21 proving it stays red); the wiring is not observed. By this
   repo's own standard a gate nobody has watched fail is not known to work.
5. New SVG charts on a cold machine — the published charts were generated at **0.29.0**,
   eighteen releases stale. Every timing in the docs now correctly states that basis.
6. The railroad terminal-rendering fix (landed, parseman `fe32f5e`) was **demonstrated on
   an invented toy grammar**, not on jess's. The code change is real and its counts were
   replayed over the four actual pages, but the before/after that made it look verified was
   not verified. **Re-prove it on the real four.**

## WORK IN FLIGHT (as of 2026-07-24, `e34bb24b3`) — do not duplicate

These lanes have an agent or a live branch on them. Coordinate; do not start them fresh.
Delete a row the moment it lands or is abandoned.

### 2026-07-31 (late) — parseman size/perf findings, measured

**The perf red on PR #102 is a MEASUREMENT DEFECT, not a regression.** The gate
run against the reference *by itself* — zero code difference — false-failed twice
in three runs, one of them WORSE than the CI failure it was meant to explain
(self-check `expected/narrow` min +8.1…+10.0%, breached 3/3, versus CI's min
+8.6…+9.3%, breached 2/3). Over 21 passes at the tree CI measured,
`rollback/sparse` won 69.8% of pairs and never breached; `css/stylesheet` won
70.2%. Root cause: the win-rate column carries a large PER-CASE bias and the
sign test assumes it does not — `expected/narrow`'s null win rate is 25.9%
against a 25% ceiling (no margin), `rollback/none`'s is 88.9% (blind). The
ref/head alternation is balanced 6/6, so it is not that.

Consequence: **`rollback/none` at −22.5…−11.4% after the revert was an artifact,
not a speedup** — do not cite it. The `0665871` revert still stands on
`rollback/dense` min +50.2…+52.3% winning 0/12, far outside any plausible bias.
Fixes, both making the gate stricter (the gate's own doc prescribes the first):
raise `passes` 3→5, and calibrate the per-case win-rate bias. Neither landed.

**Grammar artifact size — measured on the reference pair** (parseman `58d1079`,
jess `ebb5d6ada`): a clean rebuild totals **45,471,349 B** over 16 artifacts and
reproduces the committed `lib/` bit-for-bit. Earlier figures of 45,859,971 and
45,969,003 were measured elsewhere and are superseded.

Expansion ratio, source `grammar.ts` → emitted `ast.js`:

| dialect | source | emitted | rules | expansion |
| --- | ---: | ---: | ---: | ---: |
| css | 114,299 | 3,336,637 | 176 | **29.1×** |
| less | 258,986 | 3,937,754 | 256 | 15.2× |
| scss | 158,882 | 2,006,718 | 204 | 12.6× |
| jess | 191,343 | 2,049,395 | 225 | **10.7×** |

**css has the SMALLEST source and the LARGEST expansion**, and jess already meets
the owner's `<10×` budget at 10.7× — so the budget is demonstrated, not
aspirational. css's median rule (3,975 B) is SMALLER than jess's (5,278 B); the
2× mean gap is a fat tail. **css's top 10 rules hold 53.5% of its rule bytes**
(jess's top 10: 28.4%). The work list: `DeclarationListAtRule` 230,189 B,
`StylesheetAtRule` 221,179 B, `TypedValueSequence` 214,731 B, `QueryClause`
207,294 B, `ConditionalGroupAtRule` 148,191 B, `Value` 120,238 B,
`PseudoSelector` 97,867 B, `VarFallbackBracket` 85,004 B. **Four at-rule rules =
806,853 B = 29.5% of css's rule bytes**, sitting on the at-rule prelude
structuring thread already queued at steps ②–⑥.

Naming note: `DeclarationListAtRule` names its POSITION, not a construct — there
is no "declaration list" at-rule. It and `StylesheetAtRule` are one at-rule
production filtered by position. `InnerAtRule`/`OuterAtRule` is the better pair.
Renaming buys no bytes (see below); fold it into the structuring work.

**What the 806 KB is NOT:** name-driven duplication is **0.0–0.2%** across all
four dialects, measured by emitted-body comparison (which sidesteps
`payloadKey`'s three degradation paths), plus a second pass abstracting rule
references that found nothing further. **But exact byte-identity is a poor
duplication metric** — code that is 95% the same reports as 0% — so this rules
out literal copy-paste and nothing more. Do not cite 0.0% as evidence against
duplication.

**The live candidate:** css's three at-rule bodies overlap **91–95%** pairwise
while colliding byte-identically ZERO times — same vocabulary, different
arrangement. `PseudoSelector`→`QueryClause` is 82%. Scaffolding is a ~41% floor
present in every rule, so the discriminating test is to subtract the scaffolding
families and re-run the overlap; above ~80% means real shared prelude machinery.
**That test has not been run.** Distinct at-rule rules are CORRECT — sound
parsing of specific at-rules is the point; collapsing them to one generic
at-rule would be wrong.

**Cross-artifact sharing: DEAD.** 55–59 of css's 176 rule bodies are identical
in less/scss/jess — **1.1–3.5%** of an artifact — and **zero** differ only in
gating, so "share the body, parameterise the guard" has no population. An
earlier 51% shape-overlap figure was matching scaffolding FRAGMENTS inside
functions that are not interchangeable.

**Codegen sweep status.** Round 1 commit 1 (`f82d214`, lane branch, unpushed) routes
all hand-rolled restore sites through one `emitRestore` funnel and is
**byte-identical on all 16 artifacts, first try** — so it is proven inert and
anything measured on top is attributable. The `0665871` autopsy: cause is the
arity-only dedup key (`String(pairs.length)`), which made every parameter
position polymorphic across `_cstLeaves` / `_cstRawChildren` / a hoisted local,
plus 14-argument helpers V8 will not inline. Closure capture is ruled out (it
already passed scalars) and wrapper-introduction is ruled out (the `__PURE__`
IIFE is present in a zero-helper build). **"Restores are cold" is RETRACTED** —
`codegen.ts:1050-1057` records that path running ~600×/KB with a six-store
change costing +32% on `benchmark.less`.

Untested and live: whether removing repetition that gzip already compresses at
**8.2:1** delivers real wire value. Report raw AND gzipped for every
configuration.

**`node()` typing gap.** jess's 752 `verify:types` diagnostics are ONE upstream
signature: `node<N, const Type extends string, …>` gives `Type` no default, and
TypeScript has no partial type-argument inference, so `node<Foo>('Foo', …)`
falls through to an overload where argument 0 must be a `Combinator` — emitting
the `TS2345 string → Combinator` AND, via the untyped reducer, the `TS7006`
implicit-any `children`. Patched with `= string`: jess 411→5, scss 342→4, of
which exactly one is real debt. **No literal-preserving default exists** —
proved, not assumed: defaults are filled, never inferred; a defaulted rest-tuple
errors `TS2554`; a conditional default is evaluated. Only a curried call form
(`node<N>()('X', …)`) preserves it, which changes the public surface — OWNER
DECISION. css/less typecheck clean only because they spell it `node('X', …)`.

### 2026-07-31 — orchestration state (dev at `cb8533ae7`)

Every number below came from a command that was actually run. Anything not
measured is labelled a hypothesis.

**Parseman `release/0.46.0` (PR #102, head `be6111a`) — CI run `30601765592`.**
Green: `release-gate`, `size-gate`, `choice-cost-gate`, `docs-verify`,
`check:control-bytes` (the fourth raw NUL fell in `be6111a`). Two causes remain,
and they are the only two:

1. `test-matrix`, all three node versions — **zero test failures**. It is
   exclusively `coverage:guard` against baseline `ed81612`: lines 92.92 vs
   95.91 (−2.99pp), statements 89.03 vs 92.12 (−3.09pp), functions 93.96 vs
   96.55 (−2.59pp), branches 82.16 vs 85.80 (−3.64pp), tolerance 0.5pp. The
   uncovered surface is the new CLI/diagnostics/analysis code.
2. `grammar-perf` and `workload-perf`:
   - `rollback/dense` 16 probes/val — median **+24.3% … +25.2%**, min +24.9% …
     +25.9%, won 1/12 0/12 0/12, breached 3/3
   - `rollback/medium` 4 probes/val — median +5.0% … +7.8%, breached 3/3
   - `expected/narrow` 1 opt/arm — min +11.3% … +12.3%, breached 2/3
   - `less/mixins` 59 KB — median +1.1% … +5.3%, breached 3/3
   - `expected/none` and `expected/wide` are clean.
   Also logged: `[parseman] degraded [mk-inline-missed]`, 31 sites.

   The regression scales with probe density (16 probes +24%, 4 probes +5%, 0
   probes clean), which places it on the **rollback path as a per-execution
   cost**, not a fixed startup cost.

   **CONFIRMED by bisect — this is no longer a hypothesis.** The cause is
   `0665871` (*share cold capture restores through hoisted helpers*), and it
   reproduces the whole effect alone: `--ref=0665871^ --head-ref=0665871` gives
   `rollback/dense` median **+38.7 … +48.6%**, min **+50.2 … +52.3%**, **won
   0/12, 0/12, 1/12** across 36 paired comparisons — against `won 6/12 4/12
   10/12` self-vs-self on the same box. `less/stylesheet` min moved from
   −6.9 … −4.3% to +14.2 … +28.3%. The shape is coherent with the mechanism:
   restores sit on the rollback path, so `rollback/*` moves while `expected/*`
   mostly does not, and among real workloads only speculation-heavy `less/*`
   moves while `graphql` and `json` stay flat. `15f33a6` is exonerated.

   **The commit predicted 1.4%, recorded that timing "could not resolve it on
   this box", and was landed with `--no-verify`.** The actual cost is 10–30× the
   prediction. That is the gate being bypassed, not the gate failing.

   Three options are on the table and the choice is the owner's: revert, retune
   `CR_SHARE_MIN`, or document the slowdown as a deliberate trade. A partial
   result before the lane died: `not,dispatch` already clears `less/mixins`
   (breached 0/3, won 5/12 7/12 5/12).

   **Machine caveat, load-bearing.** Self-check noise floors measured median
   **+21.1%** against a 6% threshold (grammar) and **+68.6%** against 5%
   (workload), at load 55–170. Neither gate self-breached so the verdicts stand,
   but the `median` column is not resolving anything on this box — every finding
   above rests on `min` and paired win-rate, which are the robust columns. Do
   not quote a median from this hardware as evidence.

   Per [[parseman-each-release-faster-than-last]] this is a **blocker**. Widening
   a threshold or re-baselining to go green is not an available move; the only
   outcomes are fix the cause, or document the deliberate trade for owner
   sign-off.

**Branches carrying unlanded fixes**, measured with `git rev-list --count
origin/dev..<branch>`. A serialized lander owns these — landing must not run in
parallel, since each push moves `dev`:

| branch | commits | what |
| --- | ---: | --- |
| `fix/entry-import-edge` | 3 | keeps compiled grammar tables off package-entry import graphs, + a gate on every published entry point's eager import graph — directly on the grammar-size goal |
| `fix/less-optional-trailing-semi` | 2 | final declaration in a block may omit its semicolon (4.x triage §4.1) |
| `brave-jackson-baaa2d` | 1 | jess-parser accepts CSS `calc()` arithmetic |
| `vigilant-pasteur-deb597` | 1 | model `name=value` call arguments as assignments |
| `stoic-jang-518776` | 1 | stop `@import` option keywords leaking into emitted CSS |
| `work/cst-collapse-set` | 1 | drop two CST collapse entries that can never fire |
| `perf/css-value-identroute` | 1 | route the spaced paren bridge instead of racing it — needs a controlled A/B before landing |
| `ban-json-stringify-on-ast` | 1 | lint rule banning `JSON.stringify` on AST/CST values |
| `oracle-oom-fix` | 1 | docs: why the Less byte-identity gate returned no verdict |

`cst-children-unify` (`02ae5b05a`) is **NOT** in that set. It is blocked on a
language-service STOP — 264 → 60 failing against a byte-identical CST — and must
not be landed opportunistically.

**Jess suite ratchet — measured 2026-07-31 at `212f71221` on a correctly built
tree** (`pnpm run verify:jess-suite-ratchet`):

`tests: 1021   failing: 28   baseline (gating): 2   NEW: 26   STALE: 0`

Read this before re-measuring: **the build script is `pnpm run build:release`.
There is no `pnpm build`.** Running the wrong one leaves `lib/` stale, vitest
resolves through `lib/`, and the ratchet reports a completely fabricated result —
in this case 9 failures and 2 spurious STALE entries against a true 28 and 0.
Confirm the build succeeded before trusting any number from this gate.

The 26 NEW decompose as:
- **16 × `min-max-dialect`** — NOT bugs. `packages/jess/test/min-max-dialect.test.ts:81-82`
  states that "`.jess` has no dialect fns of its own yet and takes the Less set",
  which encodes the language model the owner rejected. Stale expectations to be
  rewritten against P17, not failures to be fixed.
- **2 × `tests-unit/extend/extend.less`** (all-less + extend-exact-oracle) — long-known.
- **1 × `namespace-public-semantics`** — deterministic `resolve/name-not-found` on an
  interpolated mixin name, proven pre-existing on the dev tip by revert-and-rebuild.
  Suspected (NOT measured) to be `cb8533ae7`.
- **2 × `dialect-builtins` / `diagnostics`** — plausible fallout from `212f71221`'s
  empty-registry design; unverified.
- **2 × SCSS** (`scss-construct-support` implicit-`&` leading combinator,
  `bootstrap-corpus`). A partial lane result, unconfirmed: *"both are
  stale-inventory failures, not parser gaps — the construct now parses."*
- **2 × `jess-render`** (`$extend &` policy, RC-4 `${…}` value-atom set), plus
  `bootstrap-memory-bisect`.

Known flake class, distinct from all of the above: `merge-fallback-contract`,
`security-script-runtime` and css-parser's `macro-compiled` are **30 s-timeout
flakes on a loaded box**, not assertion failures; each passes 3/3 in isolation.
Do not enter them in the baseline.

**Eleven lanes were terminated mid-flight 2026-07-31 by a monthly spend limit,
not by failure.** Each had established something before dying; the partial
results are recorded above where they are usable. Anything a halted lane
"concluded" in its last line is UNVERIFIED and must be re-derived, not adopted.
The halted work: the two-baseline ratchet entries, the 16 stale `min-max-dialect`
expectations + `$(ceil(1.4))`, `.jess` tolerant parse errors (P18), the SCSS
pair, the three-regression triage, the grammar-diagnostics pressure sweep, the
serialized branch lander, optional-lookup grammar, the node-model audit, and one
parseman coverage lane.

### Grammar artifact size — the variant question (measured 2026-07-31)

**Total shipped generated grammar: 45,859,971 B** across 4 dialects × 4 variants,
measured on a built tree (`find . -path '*/lib/grammar/*' -name '*.js' | cat | wc -c`).

| dialect | per variant | × 4 |
| --- | ---: | ---: |
| less | 3.94–4.01 MB | 15.9 MB |
| css | 3.34–3.47 MB | 13.6 MB |
| scss | 2.01–2.07 MB | 8.2 MB |
| jess | 2.02–2.07 MB | 8.2 MB |

`less/grammar/ast.js` gzips 3.94 MB → 478 KB (8.2:1), so wire cost is far below
raw — but parse-and-compile cost tracks the raw bytes.

**The four variants come from ONE factory and differ only by two flags**
(`packages/syntax/less/less-parser/src/grammar.ts:6335-6344`): `lessGrammar`,
`lessPositionsGrammar` (`trackLines: true`), `lessCstGrammar`
(`hostMode: 'cst'`), `lessCstPositionsGrammar` (both). Every one is
`composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules({…}, lessGrammarFactory)])`
over the *same* `lessGrammarFactory`. **Two booleans cost 3× the artifact.**

`ast.js` and `ast/positions.js` differ by **62 KB, 1.6%**.

**DO NOT conclude from that 1.6% that the artifacts are 98% identical.** That
exact inference was made earlier the same day and was wrong: when content
overlap was actually measured, real dedup potential came out at **23.1% / 35.7%**,
not the 75–97% the size similarity implies. Line tracking plausibly threads
position ops through *many* rule bodies, changing each slightly, rather than
adding one 62 KB block. Re-measure content overlap before designing against it.

**Owner's design direction (2026-07-31), and it dissolves the speed-vs-size
tension:** *"what chevrotain does is actually replace function paths… so i
wonder if there's a way to compile grammars in a way where you can keep all the
speed but substitute paths for other options."*

The reason duplication was chosen is that parseman's speed comes from
monomorphic, first-set-gated, inlined compiled functions — a runtime branch or
indirection per node to select tracking would land on the hot path. But that
argues only against **runtime** dispatch. Specializing **once at module init** —
emit each rule body once with the variant-specific operations factored into a
substitutable slot, then build the specialized closure set at load — shares the
SOURCE while leaving the hot path exactly as monomorphic as it is today. The
artifact shrinks; the steady-state code does not change.

Open question for a parseman lane, and it must be answered with measurement, not
argument: is a whole duplicate table the only way to keep the macro-compiled
grammar fast? Prove or refute the init-time-substitution shape. If correct is
slower, that is a PARSEMAN bug, not a licence to ship 45.86 MB.

**A separate and independent jess-side defect — FIXED.** Each parser's default
entry used to import BOTH tables eagerly and pick one with a boolean
(`options.trackLines ? lessPositionsGrammar : lessGrammar`), with the same shape
in `src/cst.ts` across all four dialects, so every consumer paid for a table it
did not use. `parse()` is sync, so a dynamic import was never available; the
line-aware binding now lives behind its own entry instead. Each dialect ships
`.`/`./cst` bound to the offsets-only tables and `./positions`/`./cst/positions`
bound to the line-aware ones, and `trackLines` is gone from `parse`,
`parseXCst`, `CssCstParseOptions` and `SafeParseOptions`. Measured by
`pnpm verify:import-graph`: less `8,513,341 -> 4,516,264 B`, less/cst
`8,516,451 -> 4,508,691`, css `7,322,499 -> 3,893,596`, css/cst
`7,417,792 -> 3,943,681`, scss `4,628,137 -> 2,563,527`, scss/cst
`4,649,563 -> 2,576,779`, jess `4,637,659 -> 2,570,758`, jess/cst
`4,650,305 -> 2,578,357` — 23.18 MB off the eight entry graphs, with all 16
`grammar/*` graphs byte-identical as the control. The duplicate-emission
question above is untouched by this and is still open.

**Deferred by the owner, not queued:** committing each parser's EBNF/railroad
rendering as a fixture so a grammar edit that changes the accepted language
surfaces as a *syntax diff* instead of a guessed-at downstream symptom. Sound
idea, explicitly parked — do not start it.

### 2026-07-31 — I failed today. This is how, and this is the fix.

**The failure: AST v2 was a compression of the representation, and it dropped
node MEANING. That was never licensed.** v2's mandate was one unified plain-data
model, lazy materialization, `Word` eliminated. It was not a mandate to lose
semantic distinctions the legacy engine could make. Where meaning was lost, that
is a migration regression — including everywhere someone later wrote a comment
presenting the loss as a design decision.

**Two distinct defects. They are not the same failure and must not be conflated
(I did, initially):**

**(a) A builtin was declared impossible in a comment — no arrays involved.**
`isurl(@addr)` where `@addr` is `url(https://example.com/)` receives a single
value. There is no group, no array, nothing to guard against.

**(b) SEPARATELY, `isValueGroupArray` is 95 sites of dead weight.**
It appears **95 times across 25 files** in `packages/fns/src` — 8 inside
`types.ts`, the predicates file itself — and throughout the test suite, which
pins it as correct in roughly 40 places.

**It defends against nothing.** If a value is an array it is not the thing being
queried, so the answer is `false` — and `value.type === 'Color'` already returns
`false`, because an array's `.type` is `undefined`. Verified. The guard restates
an answer the comparison already gives, at every one of the 95 sites.

Open question, NOT an established fact: whether a raw array reaches the value
layer at all. `SpacedValue` and `List` are both in the `ValueNode` union at
`packages/core/src/ast/nodes.ts:454-458`, so `1px 2px` has a node
representation. Establish it by tracing; the guard's existence is not evidence
that anything ever arrives as an array.
  Evidence for (a): `packages/fns/src/less/types.ts:5` states `isurl()` "deliberately has no AST-v2
  value-domain export" because "`Url` is syntax, not a materialized Value tag"
  and reimplementing it "would require sniffing output bytes." But `Url` is a
  first-class node — `nodes.ts:89`, in the `ValueNode` union at `:454`,
  constructor at `:1073`. Its five siblings are each one line
  (`value.type === 'Color'`, `'Dimension'`, `'Quoted'`, `'Keyword'`). The
  comment reads as a ruling and is an unexamined assumption.

**The rule this violates, stated so it is not re-derived: the Less and Sass
builtins are the REQUIREMENTS SPEC for the value model, not consumers of
whatever it happens to expose.** If a function cannot be written, the node shape
is wrong and the function is merely what noticed.

**The acceptance test — a builtin is ONE EXPRESSION over `node.type` and the
node's own fields:**

```js
body: node => makeBool(node.type === 'Url')
```

Anything more is the model failing, not the function:

| symptom in a function body | what it actually means |
| --- | --- |
| a guard that restates the comparison | dead weight; delete it |
| unwrapping a group or wrapper | the dispatcher should have done it |
| re-parsing, or reading `src` text | the node should carry the fact |
| byte-sniffing | the meaning was dropped upstream |

`type-of` is the sharpest single test of the model: Sass requires it to return
exactly one of `number | string | color | list | map | bool | null | function |
arglist`. Any of those the nodes cannot distinguish is a model gap, and every
predicate sharing that distinction inherits it.

**The fix, in order:**

1. **Delete `isValueGroupArray` from all 95 sites.** It changes no outcome.
   Not blocked on anything, needs no model change. Update the ~40 test sites.
2. **Separately, establish whether a raw array reaches the value layer at all.**
   If it does, make it a `List`/`SpacedValue` node. Trace it with file:line, and
   do not infer the answer from the guard — the guard is not evidence.
3. **Sites that genuinely operate on multiple values** — `min-max`, `extract`,
   `svg-gradient`, `format` — are not guards. They read a node and walk its
   children afterwards. That is a real change to those functions and is where
   the risk sits. Handle them explicitly rather than blanket-deleting.
4. Write the four-line `isurl` and delete the comment at `types.ts:5`. Verify end
   to end on `@addr: url(https://example.com/); @cond1: boolean(isurl(@addr));`.
5. Audit every type-discriminating and structure-reading builtin against the
   one-expression bar. Each failure names a specific missing distinction,
   missing field, or lost node identity. **That list is the model's defect
   inventory.**

**Do not describe the broken shape in the type system.** Giving `params` a
vocabulary for "this argument might be a bare array" legitimises the defect. The
argument is a node, or the AST is wrong.

**A related discipline this failure shares with the rest of the day:** a comment
explaining why something is impossible is a **bug report**, not documentation.
Five separate premises recorded in this file were disproved by measurement on
2026-07-31 — the fns port backlog (absent, not unconverted), the extend bitset
(already built, rejecting 96.8% with zero wasted walks), an artifact-duplication
estimate (off ~4x), the `buildContribs` mutation blocker (stamps are pure
functions of the instruction), and the byte-identity oracle's coverage of
`css-parser` (zero). Verify a row before building on it.

### 2026-07-30 handoff — grammar statement routing and ordinary-path backtracking

The active grammar goal remains: CSS is the structural base and Less, SCSS, and
Jess are lean overlays that describe only their precise additions or overrides.
The next parser work is **not** a generic performance rewrite. It is the
statement-start railroad: remove ordinary declaration/ruleset/mixin
speculation without introducing new grammar concepts, AST facts, or CST wrapper
nodes.

**Next agent role: orchestrator, not a broad implementer.** Start from a clean
worktree at `origin/dev`; keep the main checkout available only for integration.
Delegate independent, bounded investigations to separate agents and require each
to report the exact SHA, resolved Parseman path/version, focused test names, and
whether it changed source. The three current assignments are:

1. profile the corrected PostCSS Less eval+emit workload's macro-parser share;
   do not reopen sparse trivia unless a new profile attributes material CPU to it
   (`AGENT-EVIDENCE:` — evidence-gated and conditional, not a design closure);
2. isolate the remaining `tests-unit/extend/extend.less` `ext4` selector-expansion
   mismatch with a minimal fixture and a named baseline; do not update expected
   CSS or label it caused by trivia without proof;
3. ~~after Parseman 0.44 is published, make a clean Jess dependency integration
   branch, prove the resolved package is 0.44, then run the Less comment/
   custom-property surface, macro/compose gates, and all-Less before proposing a
   range update.~~ **DONE** — `f292fdd8f` bumped the floor to `^0.44.0` (and
   `75002c4a3` has since taken it to `^0.45.0`),
   `b2f888070` migrated root trivia capture, `d22cdb54b` removed the last
   `RunResult.triviaLog` reads; `pnpm-lock.yaml:18442` resolves `parseman@0.45.0`
   and nothing else (the floor moved on again in `75002c4a3`).

The orchestrator owns merge ordering and the final `dev` gate only. It must not
combine unreviewed experimental branches, push a red `dev`, or treat a passing
parser build as proof of emitted CSS. For source changes, rebuild in dependency
order and keep behavior, macro/compose, and benchmark evidence separate.

Three guardrails govern the cleanup:

- `1517e97c5` requires a rebuilt-artifact before/after parser benchmark before
  every grammar commit. Record resolved versions, fixed corpus/surface, warmup,
  samples, and errors; treat noise as inconclusive.
- `3bb2b4225` explicitly prohibits an `IdentifierStart` fact, generic
  `Statement` node, or similar carrier wrapper. A selected existing semantic
  node (`Declaration`, `Ruleset`, `MixinCall`, or `MixinDefinition`) must own
  the retained/replayed prefix and reduce directly.
- **The drift gate (owner priority, 2026-07-30): the cleanup must not slowly
  degrade parse performance.** `1517e97c5` alone cannot catch this. It compares
  against the immediately preceding commit and calls a sub-noise result
  inconclusive, so a `+2%` commit lands as noise and *becomes the next
  reference point*; twenty of those compound to about `+49%` with every gate
  green. Every grammar commit must therefore ALSO be measured against a fixed
  older reference — a committed baseline once one exists, and until then the
  oldest cleanup-era commit that still builds — with both deltas recorded. A
  consistently positive direction across consecutive commits is a real
  regression even when each magnitude sits inside the band. Rebaselining is an
  owner decision, never an agent's. Full statement, including the
  ratio-over-absolute-ms design and why it mirrors the byte-identity baseline:
  [`../parser/GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md)
  § "The drift gate".

`66bebbc03` tried to route CSS identifier-led statements by adding exactly that
forbidden `IdentifierStartFact`/`Statement` layer. The whole change was
reverted by `914caa6f0`; do not resurrect or partially replay it. A valid
full-build interleaved A/B against the immediately preceding state measured the
candidate slower on the CSS corpus (AST about +15.6%, CST about +10.5%; three
alternating rounds, zero parse errors). This proves the candidate regressed but
does **not** attribute the regression to a particular allocation or branch
without a CPU profile. After the revert, CSS CST was faster than the July 28
baseline while CSS AST retained an unresolved small +7.5% signal; Less
comparable successful workloads were not slower. Treat that signal as a
profiling target, not a grammar conclusion.

The required no-backtracking design is:

1. A broad statement-family `choice(...)` may remain when its starts are
   first-set gated. Skipping an inapplicable arm is not rollback.
2. For Less class/id starts, parse the concrete `mixinName` prefix once into
   sibling **semantic** arms so Parseman's `sharedPrefix` replays it into the
   winning node. `(` enters the one mixin interior; after `)`, `when`/`{`
   chooses definition and `!important`/`;` chooses call. Bare `;`/
   `!important` is the bare-call arm. Selector continuations (`.a.b`,
   `.a:hover`, combinators, comma, `{`, guard) go directly to the ruleset arm.
   `.a.b()` must never enter a mixin-definition route. This removes the current
   `attempt(MixinDefinitionContinuation)` once the shared `)` is factored.
3. For identifier/interpolation starts across all dialects: no colon means
   qualified rule; colon plus trivia means declaration; only a colon glued to a
   pseudo name is ambiguous. That rare path must prove the structural route to
   its `{` before choosing qualified rule; it must never parse a declaration
   value and retry it as a selector. The old Less
   `rulesetNotDeclaration` regex preflight is debt to delete through this
   shared CSS-owned shape.
4. `dispatch(...)` is only for a consumed opener whose returned value chooses
   the family. Use `choice(...)` for a later-delimiter decision. `routed()` is
   for a selected branch to replay its already-consumed opener, not a reason to
   dispatch a bare non-decisive prefix. `attempt(...)` is exceptional and must
   stay out of ordinary valid declaration/ruleset/mixin traffic.

Current code evidence: Less still has the older `ClassIdSelectorPrefix` /
`SelectorBranchFact` / `ClassIdStatement` shape and the broad
`rulesetNotDeclaration` preflight in
`packages/syntax/less/less-parser/src/grammar.ts`; both are targets, not models.
The Less file currently has concurrent uncommitted signature-trivia work. Do
not amend, reset, or fold a routing change into that worktree state. Use a clean
worktree from `origin/dev` for the next routing implementation, then integrate
only after the owner has reviewed the interaction.

Post-revert proof already run on `914caa6f0`: CSS build; focused CSS AST/public
tests (4 files / 236 tests); `pnpm run check:macro`; and
`pnpm run verify:compose-integrity` all passed, with the macro/compose gates
showing zero interpreter fallbacks. Before a new grammar commit, rebuild in
dependency order, run the focused semantic/CST tests, macro/compose gates, and
the required interleaved A/B. Do not claim speed until both the route and its
profile evidence are real.

### 2026-07-30 handoff — sparse trivia correctness, not a CPU target

The corrected PostCSS preprocessor workload profile rules out trivia as the
current CPU target: Parseman root-trivia work accounted for 3 / 4,977 samples
(0.06%) in the restored legacy-capture run. Do not add maps, full source line
splits, or formatting streams in response to that profile. The next CPU work is
macro parsing and core evaluation/emission; see `PERF_IDEAS.md` for the measured
workload and comparator numbers.

Parseman PR #97 was `release/0.44.0-root-trivia` commit `45ce7c8`. It fixed
selected-root trivia scope exclusion (`rootCapture: 'opaque'`), keeps classified
trivia through compose/IR lowering, rejects nullable or overlapping classified
categories, and carries the document-root selection metadata rather than an
inner parser's local labels. **That release is published and INTEGRATED
(re-verified 2026-07-30 on `facb641dd`):** `f292fdd8f` bumped the floor
`0.43.0 -> 0.44.0`, `b2f888070` migrated root trivia capture, and `d22cdb54b`
dropped the last `RunResult.triviaLog` reads. `pnpm-lock.yaml:18442` has
`/parseman@0.45.0:` and no other parseman entry. The "do not claim a 0.44
integration" hold that stood here is discharged.

The current Jess batch is intentionally in progress but buildable. Less mixin
signature continuations now use the normal classified trivia scope, so a block
comment in an expanded mixin body remains a document comment rather than being
collapsed into synthetic whitespace. The renderer replays only comment runs in
the invoked callable body's retained span: it binary-searches the existing
source-ordered sparse runs once, advances a monotonic cursor while walking that
body, and writes comment strings directly. It does not create AST nodes, walk a
full trivia map, or make a performance claim. The test surface is:

- release build: green;
- Less public + mixin signature tests: 93 / 93 green;
- core provenance: 15 / 15 green;
- Jess CST public grammar: 19 / 19 green;
- all-Less: 109 / 110 fixtures; the sole red is the pre-existing
  `tests-unit/extend/extend.less` omitted `ext4` selector expansion, unchanged
  by this batch.

#### Aggressive Cutting Self-Prosecution — callable-body comment replay

- **Review-flagged diff tokens:** **[loop/traversal]** one binary search plus
  two monotonic sparse-run scans; **[array spread/materialization]** pending
  render-only comment strings preserve their authored block boundary;
  **[materialized array/object]** the cursor and pending string arrays are
  bounded render ordering state, never AST/copy/materialization state.
- **New traversal:** one binary search into `TriviaMap.commentRuns()` followed
  by a monotonic scan of runs inside a mixin body. The parser has already paid
  to retain sparse comment ranges; direct output needs their authored placement,
  and no parent/source rediscovery occurs.
- **New node/materialization:** none. Comment text is sent directly to the
  existing writer; the small pending string array is render-only ordering state,
  not an AST or copied body.
- **Render path:** no output node construction or generic trivia-map lookup.
  The path emits the existing source substring at the established block boundary.
- **Helper/API surface:** private renderer helpers only; no exported API added.
- **Metadata mutations:** none. The existing `emittedBlockTrivia` de-dup set
  remains the ownership guard for a source comment emitted through expansion.
- **Evidence:** the focused tests above prove behavior. Profiling specifically
  says this is not a speed claim; the spare-trivia CPU lane remains shelved.
### 2026-07-30 update — lint/diagnostics wrap-up for dev

The dedicated lint package and shared diagnostics lane are active but not a core
eval/render blocker. The canonical tracker is
[`../lint-roadmap.md`](../lint-roadmap.md). Current stable work from the
`codex/ast-v2-dx-fns` worktree is ready to be on `dev`: CSS CST selector atom
classification/tag surfacing (`d7e3f19a0`) plus shared `@supports`
declaration-condition diagnostics (`30b70b21b`). The latter reuses
`lint/unknown-property` and `lint/unknown-property-value` through
diagnostics-core, `@jesscss/lint`, and the language service; it also separates
`@media` feature diagnostics from nested `@supports` declaration diagnostics.

Verification run before this wrap-up: diagnostics-core tolerant CST focused
test, lint package index test, language-service engine focused test,
diagnostics-core/lint/language-service builds, `verify:diagnostic-cold-path`,
`verify:package-exports`, and `git diff --check`. No new parser grammar changes
or normal parse/eval/render hooks were added for the diagnostics batch. Next
diagnostic work should continue from the lint roadmap and avoid evaluator-backed
Less/Sass facts until the semantic facts layer exists.

### 2026-07-27 update — grammar fold complete; Less alpha guard green on parseman 0.41.0

The four parser dialects now ship from one host-mode `src/grammar.ts` each; the
old `src/ast/grammar.ts` files are deleted. The grammar/parser floor was registry
`parseman@0.41.0` on this date, resolved through `^0.41.0` ranges in the root,
`@jesscss/parser-shared`, and the four parser packages. **It has since moved four times: the floor
on `dev` is now `^0.47.1` in all 10 declarations** (`75002c4a3` took it to `^0.45.0`;
`ff685793a` took it to `^0.46.0`; the 0.46.0 bump is output-neutral and worth
−0.07% to −0.24% of artifact — see `docs/state/GRAMMAR-SIZE-FACTS.md` §2.4l).
Regenerate with
`grep -rn '"parseman"' --include=package.json . | grep -v node_modules` rather than trusting
this sentence. Evidence as of 2026-07-27:
dependency-order parser/plugin/jess builds pass, `pnpm run check:macro` and
`pnpm run verify:compose-integrity` pass with 0 interpreter fallbacks, `pnpm run
verify:less-alpha` passes, `all-less.test.ts` is 108 / 108, and
`all-less-error.test.ts` is 94 / 94 after recursive variable/property fixtures
graduated from the worker-hang skip list. The Less byte-identity oracle
is still red against the committed baseline and must be treated as a named
classification queue before any baseline update. That queue is
[`../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md`](../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md)
— classify a mover there before proposing a rebaseline.

### 2026-07-25 update — four-grammar rewrite, Stages 0–1 LANDED on `dev`

**Stage 0 (WIP salvage)** — settled. Previously-listed salvage candidates confirmed already
landed on `dev` (`a36ccc75e` sass:color + `ce4e942c1` sass:math). No novel salvage required.

**Stage 0 (packages regroup)** — LANDED on `dev` as commit `e96d1035d`. Co-located parsers
with their syntax-plugins under `packages/syntax/<lang>/<pkg>/`; editor/LSP subsystem under
`packages/editor/<pkg>/`; docs under `packages/docs/<pkg>/` (with the old `packages/docs`
renamed to `packages/docs/docs-jess`). npm package names unchanged. Updated: pnpm-workspace
(`packages/*` → `packages/**`), tsconfig.json paths + per-package tsconfig `extends`/`include`
depth, vitest.config.ts glob and css-parser entries, eslint grammar-file globs, every `scripts/`
path-string literal, per-package vitest/eslint/tsdown configs, `packages/jess`'s missing parser
devDependencies (added so the moved test corpus resolves), precommit `packageDirs()` (now walks
to the nearest owning package.json instead of the flat `^packages/[^/]+` regex), and .gitignore
ignore paths. Verified: build:release 13/13, verify:types 12/12, lint 0 errors, check:macro
5/5 (0 fallbacks), compose-integrity clean, four parser suites green, jess tests 782 pass /
13 fail (matches pre-regroup baseline 781/14), AST-identity-oracle per-file AST+CST hashes
byte-identical across the 707-file Less corpus.

**Stage 1 (parseman 0.37.0 bump)** — LANDED on `dev` as commit `6908e7b4f`, immediately
after the regroup. Atomic 10-line / 6-manifest bump. Resolved parseman path is
`node_modules/.pnpm/parseman@0.37.0/node_modules/parseman` for all six packages; lockfile
has `/parseman@0.37.0:` only (zero `parseman@0.32.0` entries). Gates on the bumped tree:
build:release 13/13, verify:types 12/12, lint 0 errors, check:macro 5/5 (0 fallbacks),
compose-integrity clean, css 242/242, less 439/439, scss 290/290, jess-parser 248/248.

**AST-identity-oracle rebaseline** (recorded in the bump commit msg): ast shipping path
byte-identical across the bump (`aggAst` unchanged). 68 of 707 corpus files moved on CST
only, from the documented scanSkip default change (parseman 0.33 — sentinels-in-comments);
the new CST aggregate (`b7c550a8...`) is the floor for every later Stage 3–6 grammar diff.

**Stage 1 perf re-measurement (the owner go/no-go on the floor)** — FASTER, not slower.
A two-sample parse-bench.mjs run (5-warmup / 15-timed samples per case) at `e96d1035d`
(parseman 0.32.0) vs `6908e7b4f` (parseman 0.37.0): every case faster on 0.37.0, none
slower; CST route 25–30% faster; noise floor ~1.4–3.6% (visible in the 0.37.0-vs-0.37.0
clean-spread). Opposite of the +8–12% Less regression that made 0.36.0 declined (§5.1);
the floor is paid. Spec updated: GRAMMAR-REBUILD-SPEC.md §0.2 / §5.0 now reflect the paid
state with the benchmark table. **Stage 2 (parseman/oracle corpus-digest gate + coverage
gate + combinator cheat-sheet) is the next work — see
[`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md) §0.**
(A `grammar-rewrite-037-plan.md` was cited here and never existed in the repo; the
spec's §0 is the staging authority.)

### 2026-07-25 update (cont.) — Stage 2.1 LANDED on `dev` (commit `a2911a491`)

**Stage 2.1 (parseman/oracle byte-identity gate)** — LANDED on `dev` as `a2911a491`.
`packages/syntax/less/less-parser/test/oracle-byte-identity.mjs` is the machine-checked
gate using the real `parseman/oracle` (`loadCorpus`/`digestCorpus`/`compareReports`/
`formatComparison`) that landed at parseman 0.37.0 (PR #85). Replaces the existing
short-hash `ast-identity-oracle.mjs` as the operative byte-identity gate for the
rewrite; that file is kept during the transition for cross-checking per-file
fingerprints. Three-way verdict: `identical` → exit 0, `moved` → exit 1,
`incomparable` → exit 2.

Committed baseline `oracle-byte-identity.baseline.json` (707-file corpus, both
shipping surfaces `ast` (parse) and `cst` (parseLessCst)):
  aggAst=d436f6e07d267ffad4bfdd06dfa363ad170b64985e1a5c6aef0fcd21d84b290a threw=119
  aggCst=48e1e9dc0b80b8acae3f9adcb723243cf66a94da288634f81863f708093c3b27 threw=0
THIS IS THE FLOOR for every Stage 3–6 grammar diff.

Reproducible: `pnpm run oracle:less:byte-identity` (rebuilds then gates against
the committed baseline); `pnpm run oracle:less:byte-identity:write` writes a
fresh report to a `.new` file for inspection.

**Stage 2.2 (coverage gate) — discovery: parseman 0.37.0's coverage surface is
NOT sufficient for jess's four dialects as composed today.** All four jess
grammars are `compose([cssGrammar, <Dialect delta>])` where `cssGrammar` is a
macro-compiled opaque artifact. `composedGrammarCoverageDefinitions` deliberately
throws on opaque artifacts ("semantic coverage needs re-lowerable composed IR;
this composition contains an opaque artifact"), and
`compiledGrammarCoverageDefinitions` returns an EMPTY definitions array for the
macro-built compose-result even when `transformMacro(..., grammarCoverage: true)`
is run. A grammar-coverage gate for jess therefore cannot use parseman's surface
off the shelf; either a non-macro build path or a jess-side per-rule collector
keyed to the grammar's public-surface keys is needed. **Stage 2.2 OPEN**, deferred
to a dedicated Stage 2.2 subtask; the byte-identity gate (Stage 2.1) is sufficient
for Stages 3–6 to proceed (every collapse commit's byte-identity verdict is what
the collapse-pivots on; coverage was a "is this dialect safe to collapse yet?"
greenfield assessment, not a collapse-pass gate).

**Stage 2.3 (combinator cheat-sheet)** — DONE and now maintained ahead of the
0.37.0 target it was written for.
[`../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`](../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md)
is cut against `parseman@0.43.0` — **one floor stale as of `facb641dd`; the repo moved to
`^0.45.0` in `75002c4a3` without the required re-cut** — and was last updated by `3bb2b4225`, the same
commit that banned statement-prefix wrapper routes — so it carries the
`choice` / `dispatch` / `routed` / `attempt` ownership rules the statement-start
railroad work is held to. Read it with `GRAMMAR-REVIEW-STANDARD.md`, not instead
of it. Re-cut it in the same change as any parseman floor bump.

| Lane | Where | State |
| --- | --- | --- |
| ~~**parseman `0.34.0` adoption + showcase survey**~~ | jess | **SUPERSEDED** — stage 1 of the four-grammar rewrite landed parseman 0.37.0 on `dev` (commit `6908e7b4f`, 2026-07-25); see the 2026-07-25 update above. |
| ~~**Gates made reasonable**~~ | jess | **LANDED `c3db7e53e` + `e34bb24b3`** — see "Gate hygiene" below. |
| ~~**fns per-dialect registry**~~ | jess | **LANDED** — `builtins/` and `builtinLessFns` deleted; registration derives from the composed dialect indexes (`less/index.ts` = `less/` + `shared/`, same for sass); per-dialect evaluators at module scope; exports map publishes `./less`, `./sass`, `./sass/{color,list,map,math,string}`, `./shared`, `./registry`, `./less/registry`, `./sass/registry`. Implements ledger C13. Specifier resolution for `#less` / `#sass/<module>` is NOT part of it — see "`#less` / `#sass` specifier resolution" below. |
| ~~**Numeric precision landing**~~ | jess + less.js fixtures | **LANDED IN FULL.** Tolerance-trim, `emitValueInterp` deleted, no-sci-notation guard, integer fast path, `literal-tag.ts` source-literal fix (`f0f005a27`) and fixture graduation had all landed by `ef173125a`; the colour holdouts closed in `f42decf7f` (`ast/color.ts` -> `formatNumber`) + `137cfa8fa` (`withAlpha` construction round). Design: [`../../design/numeric-precision-policy.md`](../../design/numeric-precision-policy.md). |
| **parseman prefix-trie choice dispatch** | parseman repo | MEASURING FIRST; may conclude "don't build". |
| **parseman docs voice sweep** | parseman repo | Removing changelog narrative from the docs. |
| **`extend-exact` state contamination** | separate session | See the KNOWN RED section below. |
| Chip sessions | jess | Stale `file-resolution.ts` claim in this file — **landed `2039165db`** (the file was deleted back in `05bfb8249`). Stale `scripts/check-macro-buildable.mjs` gate — **landed `064e3d985`**, now wired as `pnpm run check:macro`. Still open: the root `pnpm test` vitest lane (127 red files). |

## ACTIVE PRIORITY CHECKLIST — structural-rot + perf recovery

**Reconciled 2026-07-24 against `e34bb24b3`.** Every row below was re-checked against the
tree or a named commit on this pass; a row with no evidence pointer was deleted rather than
carried forward. Rows marked *unverified* state the date they were last known true.

**Process mandate:** every item is fixed via an adversarially-reviewed DESIGN change —
reviewed against [`../../perf/V8-ARCHITECTURE.md`](../../perf/V8-ARCHITECTURE.md) (the canonical
invariants, numbered 1-11 as of `facb641dd` — count them in the file, several docs still say 9; this row previously cited an `INVARIANTS.md` that does not exist in the repo),
the extend design, and the "parser owns structure"
keystone — BEFORE implementation. The review must score *structure, dispatch cost,
tree-walks, byte-re-derivation, duplication*, and "did this ignore an existing tuned
engine/design doc?" Those dimensions were added because the earlier correctness +
byte-identity + minimal-diff gates let all of P1 through.

### P0 — GUARDRAILS (prevent recurrence)

- [x] **LANDED `43eaf459f`, realigned `fdec1cd11`.** LLM quality-enforcement v1: deterministic
      teeth, the `perf-architecture-reviewer` (evidence per invariant, not a verdict), and
      advisory pins, all keyed to the canonical invariants in `docs/perf/V8-ARCHITECTURE.md`
      (numbered 1-11 at `facb641dd`; this row said 9 until the 2026-07-30 docs audit).
      Design record: `docs/architecture/llm-quality-enforcement-design.md`.
- [ ] **No serialize-then-reparse of structure** — still prose, not a lint/assertion. The one
      known live violation on the shipping `ast/` route (P1.1, `selectorAtoms`) is fixed; the
      remaining twin is in `packages/core/src/tree/`, which the hot-path gate scopes out as
      code slated for deletion.

### P1 — EVAL/RENDER (see [[eval-render-perf-roadmap]])

- [x] **1. `selectorAtoms` regex round-trip — FIXED.** The mixin-match atom path now walks the
      parsed branch/term/token structure (`pushBranchAtoms`) and only tokenizes strings the
      parser produced as bytes (`pushLeafAtoms`: a call/definition name, a namespace path
      segment, an opaque `text`, an interpolation result). A structured pseudo recurses into
      `args` instead of going through `pseudoCanonical`. Countable effect on
      `packages/jess/benchmark/benchmark.less`, one render: regex executions 10,984 → 1,350
      (-87.7%), bytes fed to the regex engine 117,449 → 13,446 (-88.6%). Emitted CSS unchanged
      across all 314 `@less/test-data` fixtures (0 diffs, identical error set).
      `packages/core/src/tree/extend/spine-extend.ts:1330` still carries an independent legacy
      twin; it is deliberately left alone (legacy `tree/`, slated for deletion, and explicitly
      out of scope for the hot-path gate).
- [x] **2. `documentHasExtend` full-tree walk — symbol is gone from `packages/core/src`**
      (verified 2026-07-24 by workspace grep). Whether a parse-time flag replaced it, or the
      detection simply moved, is *unverified*.
- [~] **3. Extend matching redesign — PARTIALLY LANDED.** `0818e9dc7` introduced the structured
      crossable `:is()` IR + dual-cursor fork matcher; `2fb2bb566` unified whole-branch matching
      into one recursive OR-fork matcher. Verified 2026-07-24: `extend/match.ts` no longer
      contains `.includes()` substring compares. The `O(1)` bitset fast-reject from
      [[feedback-extend-fast-reject-not-full-scan]] was **MEASURED AND DECLINED 2026-07-30** —
      see the closed OPEN-DEFECTS row below; the standing rule is satisfied behaviourally by
      the three-layer atom reject (`plan.ts` `mayMatch` → `emit.ts` candidate closure →
      `solve.ts` prefilter → `match.ts:116`), not by a bitset. `branchText` remains the branch
      key (`emit.ts:216/538/558/572`).
- [~] **4. Extend Set/clone allocation.** `7d976c78c` made the fold a one-pass fixpoint
      (quadratic → linear). No measurement of the remaining `SymmetricDifference`/`CloneObjectIC`
      churn has been recorded since; treat the residual as *unverified since 2026-07-22*.

### P2 — GRAMMAR STRUCTURAL ROT

Root cause: the scannerless port re-expanded the Chevrotain 7-arm grouped `rule` into flat
15–20-arm choices, then copy-pasted across dialects. CSS is the canonical base (it has
`OpaqueAtRuleBlock`).

- [x] **Wave 1 COMPLETE across all four grammars, byte-identical:** Less `ddaa70363` +
      `0350ec162`, CSS `492033a4c`, SCSS `1f4e9812c`, Jess `627c9dc10`, plus the shared-const
      follow-ups `5708ed191` / `4fbba50ee` / `d8ea99bc1` / `decd699c2`.
- [x] ~~`@`-read-once → keyword-switch dispatch~~ **SKIPPED, premise was wrong.** Parseman
      `emitFirstMatch` already first-char-gates the arms; there is no per-arm re-lex.
- [~] **Less decl-vs-ruleset speculation.** Addressed by *gating* rather than left-factoring:
      `53163def8` trivia-gates ruleset so declarations skip selector speculation, `e6782a2dc`
      gates mixin-or-ruleset dispatch past prefix re-scans. The full shared-prefix left-factor
      is still not done; it stays HIGH-risk and needs byte-identity proof across
      interp/custom-prop/`:extend`/guard/`!important`.
- [ ] **Wave 2 (gate on ast/ differential):** nested/non-nested paired families → body-param
      (SCSS 4 pairs, CSS, Less); Less adopts `OpaqueAtRuleBlock`; collapse
      `AtRuleBlock` + `AtRuleStatement` → one `AtRule` (changes AST node `type`, so NOT
      parser-only byte-identical — needs coordinated core/eval/serialize changes).

### P3 — PARSE perf (see [[less-parser-grammar-cost-roadmap]])

- [x] **Less L1 `!important` double-parse — LANDED `ca7358000`** (left-factored tail).
- [x] **Jess J1 `$var` multi-parse — LANDED `cc48f7af6`** (left-factored `$var` value atom to
      parse `VariableReference` once), with `49ac65706` / `df4436dc3` on the same seam.
- [ ] **SCSS S1/S2 — `NestedConditionalBlock` self-time.** No commit since has targeted it;
      the 15%-self figure is *unverified since 2026-07-22*. Re-measure before acting.
- [ ] **Cross-cutting allocation: monomorphic node shapes** (kill megamorphic keyed stores),
      remove `[...spread]` in hot reducers, single-value fast paths.
- [x] **First-set gating swept all four parsers** (2026-07-23 perf run, ~30 commits from
      `3aa12414d` to `44eb1237f`), and `5cc69d791` retired the local first-set regex copies
      once parseman `0.32.0` gated them natively. **Current floor is `^0.45.0`** (`75002c4a3`),
      declared in the root `package.json:39`, `packages/parser-shared/package.json:31`, and two
      declarations each in the four `packages/syntax/*/*-parser/package.json`. Regenerate the
      member list with `grep -rn '"parseman"' --include=package.json . | grep -v node_modules`;
      do not carry a count. (Re-verified 2026-07-30 on `facb641dd`; the `^0.43.0` text here was
      one floor out of date, and the `0.32.0` text before it was two.)
      **Version-lock invariant: compiled parser artifacts must never cross parseman versions**;
      regenerate every one in the same change as the bump.

### OPEN DEFECTS — each row is directly actionable (re-verified 2026-07-30 on `991b315e0`)

Durable code defects, as distinct from the transient test reds in
`docs/state/PROJECT_STATE.md`. Delete a row when it goes green; do not let one rot into
folklore.

**Line numbers rot faster than the defects do.** On the 2026-07-30 pass *every* file:line
here from the 2026-07-24 `e34bb24b3` pass had drifted, one row pointed at a file that had
since been split into another package, and one row was already fixed. Anchor a row on the
symbol name and re-locate it with `grep`; treat the line number as a hint with a date on it.

- ~~**Extend bitset fast-reject never landed.**~~ **CLOSED — MEASURED AND DECLINED 2026-07-30**
  (on `ef173125a`). The row's premise was wrong in substance: no *bitset* exists, but the
  fast-reject the standing rule demands DOES, in three layers —
  `plan.ts` `mayMatch` (inherited per-subject atom flag) → `emit.ts` candidate downward-closure
  → `solve.ts` `solveComposed` prefilter → `match.ts:116` per-branch `branchSharesAtom`.
  Nothing full-scans. Instrumented counters on `packages/jess/benchmark/benchmark.less`
  (4446 lines, 26 `:extend`, 1360 subjects/render): the emit candidate prune admits 134 of
  1360 subjects; of 5458 per-render branch comparisons **96.8% are atom-rejected**, and
  `rewriteBranchPartial` returns null **0** times — i.e. zero wasted structural walks.
  `--cpu-prof` over 50 renders, three independent runs: `computeExtends` inclusive
  8.96/9.07/9.17% of profile, but `branchSharesAtom` inclusive only **0.46/0.36/0.64%**
  (≈0.5% of render time). That is the entire cost of the reject predicate and therefore the
  hard ceiling on any bitset; the project noise floor is ±4.9%, so the change is
  unmeasurable by construction and a paired A/B could not produce a number a control
  reproduces. A bitset would also add an intern table, an overflow rule, and a fourth
  memo field on `Branch` (the `key`/`bnd` hidden-class discipline in `ir.ts:45-65`).
  A constructed adversarial fixture (1200 subjects sharing the target's first atom but never
  matching) does reach 100% wasted `rewriteBranchPartial`, worth ~2.8% of profile — the
  cure there is a strictly stronger *predicate*, not a bitset: reject unless the target's
  **plain-text** simples (NOT recursing into target `:is()` grafts, which are alternatives —
  recursing there would be a false negative) are a subset of the branch's **graft-recursive**
  atoms. That predicate already exists for the grafted-base case at `match.ts:399-411`.
  It has no counterpart in the real corpus, so it is not worth landing until one appears.
  The measured extend cost is in productive work: `runFixpoint` 3.6-3.8%, `applyInstruction`
  2.3-2.7%, `composePath` 1.2-1.5%. The one real inefficiency found: `solveComposed`
  (`solve.ts:109`) calls `buildContribs(reachable)` **per subject**, so `composePath` and
  `collectBranchAtoms` are recomputed for every instruction on every admitted subject even
  though both depend only on the instruction — ~1.1-1.5% of profile, i.e. 2-3x the bitset
  ceiling. That was a separate, better-evidenced defect than this row was, **and it has since
  been fixed (`facb641dd`) — see the next row.** Line numbers in this paragraph are as of the
  2026-07-30 investigation and predate that fix; anchor on the symbol names.
- ~~**`buildContribs` recomputed per subject** (`solve.ts:109`).~~ **CLOSED — LANDED
  2026-07-30.** The blocker named above (the `e.ext = true` / `e.hidden = true` mutation
  "relies on them being per-subject fresh") **was not real**, and the investigation is the
  result worth keeping. Both stamps are pure functions of the *instruction*
  (`e.ext` unconditional; `e.hidden` iff `inst.extenderHidden`), so a per-subject recompute
  produced identical flags every time — only the allocation was per-subject. Sharing the
  composed branches across subjects was likewise already the engine's contract, not a new
  constraint: `pushExtender` (`match.ts:190-201`) *documents* "the shared contrib branch is
  never mutated" and clones before forcing `hidden`; `ir.ts:45-51` pins the same immutability
  for the `Branch.key` memo. Audited every in-place `Branch` write under `ast/extend/`
  (`solve.ts:47/49`, `match.ts:196`, `emit.ts:178/314/453`, `compose.ts:56/213/216`,
  `ir.ts:121/184/187/190`): all land on freshly-constructed branches. `emit.ts:453` is the
  only one over a caller-supplied list, and that list is `rawOf(s) = composePath(s.path)`,
  a per-subject fresh compose that never contains a contrib. There are no `Branch`
  object-identity comparisons and no `Set<Branch>`/`Map<Branch, …>` keys anywhere
  (`emit.ts:365` is a string-array prefix loop; `sharedPrefixLen` compares plan `Level`
  arrays, not branches).
  **Fix:** a render-scoped `ContribMap` memo created in `computeExtends` and threaded
  through `solveComposed` into `buildContribs(instructions, memo?)`, which now skips
  instructions already present. Lazy, so a document whose subjects are all pruned by the
  prefilter still composes nothing. `emit.ts:875` is deliberately NOT memoized — its
  `relativizeExtender` instructions are rebuilt per subject and are genuinely not shared
  (measured: 8 of 3414 compositions).
  **Evidence (deterministic, primary).** On `benchmark.less`, `composePath` +
  `collectBranchAtoms` calls from `buildContribs` drop **3414 → 34** (26 solve-side + 8
  emit-side) — a **99.0% / 100.4x** reduction, exactly as predicted before implementing.
  Call-site split before the fix was 3406 from `solve.ts:109` (131 admitted subjects x 26
  instructions) vs 8 from `emit.ts:875`.
  **Evidence (correctness).** Output byte-identical across **all 356** rendered
  `tests-unit`/`tests-config` fixtures plus `benchmark.less`, verified by a controlled A/B
  (memo threaded vs `undefined` — the latter is provably the original code path, since plan
  instructions are never duplicated). `benchmark.less` SHA256 unchanged at
  `1f041a1bf9c8592eb21c1d7354e49a5a02d1e1a888fc5e120a90b1f85f0a0561` (122,550 bytes).
  **Timing: no claim made.** 1.1-1.5% sits below the ±4.9% noise floor, and this box ran at
  load average 48-119 throughout; a wall-clock A/B here could not distinguish the change from
  noise, so none is reported. The call-count reduction is the honest metric.
  **Regression gate:** `extend-op-budget.test.ts` gains a fourth case pinning contrib
  compositions CONSTANT as the admitted-subject count doubles (measured 1 vs 1 with the memo;
  51 and 101 without, i.e. linear in subjects). Verified to fail with the memo removed.
  **Aside — the `verify:jess-suite-ratchet` 28-vs-29 NEW discrepancy is a FLAKE, not a
  regression.** Observed both counts on the SAME tree in this session (28 on the first two
  runs, 29 on the next three). A controlled A/B with the contrib memo threaded vs removed
  produced **identical 29-entry NEW sets**, so no extend change is involved. Which entry is
  intermittent was not isolated (it needs a run that reproduces 28 while capturing the list).
  Note this worktree resolves `@less/test-data` to the SHARED `~/git/oss/less.js` checkout,
  a known cross-process flake surface.
- **`jess-parser` still text-joins selector-bearing pseudo arguments.** The
  folded grammar still has `staticSelectorText`
  (`packages/syntax/jess/jess-parser/src/grammar.ts:385` at `facb641dd`, used by nth-`of` at
  `:2599` and generic pseudo arguments at `:2729`). This is the remaining gap to
  always-structured pseudo arguments.
- **The 8-dp holdouts are gone; the value domain has ONE number policy.** Both precision rows
  that used to sit here are closed, so they are deleted rather than carried as strikethrough.
  `literal-tag.ts` never had a `round` call by the time the row was written (the denoising
  rewrite went in `f0f005a27`, 2026-07-17), and the five `round(x, 8)` calls in
  `packages/core/src/ast/color.ts` now call `formatNumber` (`f42decf7f`), pinned by
  `packages/core/src/ast/__tests__/color-precision.test.ts`. The only construction-time
  quantization left in the colour path — `withAlpha`'s `round(newAlpha, 8)` in
  `packages/fns/src/less/color-helper.ts` — went with it (`137cfa8fa`), which also closes
  SEMANTIC-INVARIANTS **S6**. Rulings V1/V4/V5 are satisfied. The remaining `round(x)` calls
  in `color.ts` (`:97` x3, `:105`) are bare integer rgb-byte quantization at output and are
  correct under V5.
- **`evalBytesInterp` never validates units.** `evalBytesInterp`
  (`packages/core/src/ast/serialize.ts:4717` at `facb641dd`) has no `validateValueGroupUnits`
  call, while the ordinary value path calls it at `:4697`. A unit error that is fatal in a
  declaration value is silently accepted inside an interpolation. Undecided which way it should
  go — it deserves its own commit and an owner ruling. The divergence is documented in code at
  `:4713`, which makes it a known-and-accepted state rather than an oversight; that does not
  settle it.
- **`--x: foo(] bar`** (arbitrary token stream in a custom property) fails in all four parsers.
  That is the current limit of the shared-surface permissiveness ruling P2.
- ~~**`packages/fns/src/less/index.ts:31` exports the wrong function.**~~ **FIXED** with the
  per-dialect registry: the index now re-exports the *named* `format` (`string-format`) and
  `formatPercent` (`%`) explicitly, and both register under the names ruling A5 gives them.
- ~~**fns port backlog** — 35 unconverted modules, 3 missing fns, no alias mechanism.~~
  **CLOSED 2026-07-30 at `ef173125a`.** Every item in the 2026-07-24 row had been overtaken:
  - **The 35 modules are gone, not unconverted.** None of the 6 named `less/` modules
    (`each`, `iif`, `isdefined`, `isruleset`, `logical`, `math-factory`) exists — core
    special-forms all of them during serialization, so `packages/fns/src/less/index.ts`
    records them as deleted dead code. `shared/math/{max,min}.ts` do not exist either
    (`min`/`max` are dialect-owned; the module pair is `sass/math/{min,max}.ts`). Measured
    at `ef173125a`: the Less index exports 83 callables and the Sass index 62, and **every
    one of the 145 is a value-domain `Fn`** — zero non-`Fn` exports on either index, so the
    registries register the whole surface.
  - **`type-of`, `str-length` and `comparable` all exist and register** —
    `sass/meta/type-of.ts`, `sass/string/globals.ts` (`strLength`) and
    `sass/math/compatible.ts` (`comparable`).
  - **The alias question is settled and implemented.** `separator`→`list-separator` was a
    real registration bug and is fixed below. `argb`→`ie-hex-str` is *not* an alias:
    `packages/fns/src/sass/NAME_ALIASES.md` records the owner ruling that the bodies diverge
    (output case) and that a fn IS its dispatch name, so each spelling gets its own body.
    Where a rename really is pure, the landed shape is a delegating `defineFunction` under
    the second name reusing the first fn's `params` — `sass/string/globals.ts`, now also
    `sass/map/globals.ts` and `sass/list/globals.ts`.
- **Renamed Sass globals were registered under their MODULE names.** *(Found and fixed
  2026-07-30, `b587617e0`.)* `registryOf()` keys on `fn.name`, so `sass/index.ts` exporting a
  module member registered the module name: the Sass global registry held bare
  `get`/`has-key`/`keys`/`values`/`merge`/`remove`/`separator` — seven names dart-sass has no
  global for — and none of `map-get`/`map-has-key`/`map-keys`/`map-values`/`map-merge`/
  `map-remove`/`list-separator` dispatched. Measured before/after on the same tree:
  `map-keys`, `map-values`, `map-merge`, `map-remove` and `list-separator` went from
  verbatim-preserved to computed; `map-get` was already reachable because the SCSS parser
  lowers it to the `$[…]` accessor. Jess-suite ratchet was byte-identical across the fix
  (37 NEW / 10 FIXED / 1 STALE both sides), so nothing else moved. `map-has-key` needed
  `dd22fef60` on top: with a two-argument call its empty rest parameter mis-bound on the
  `(ValueGroup, FnCtx)` route and the body threw, so the call was preserved verbatim while
  the three-argument nested form worked. On `dd22fef60` all seven globals dispatch.
- **Those seven globals now dispatch, but three of them diverge from dart-sass on a MISS.**
  Measured 2026-07-30 at `facb641dd` with a full workspace build, each case run through
  `Compiler.renderString(src, { extension: '.scss' })` and the same source through
  dart-sass 1.101.0 `compileString`:

  | case | jess | dart-sass 1.101.0 |
  | --- | --- | --- |
  | `map-get($m, zzz)` (miss) | **throws `Name not found`** | `""` — declaration suppressed |
  | `map-get(map-get($m, zz), b)` | **throws `Name not found`** | **throws** `$map: null is not a map` |
  | `map-has-key($m, zzz)` | `false` | `false` |
  | `map-remove($m, zzz)` | `b: { a: 1 }` | throws `(a: 1) isn't a valid CSS value` |
  | `nth($l, 9)` (out of range) | `b: nth(1 2 3, 9)` — preserved verbatim | **throws** `Invalid index 9 for a list with 3 elements` |
  | `index($l, 9)` (not found) | `b: ;` — EMPTY declaration | `""` — declaration suppressed |
  | `x { b: null }` | `b: null` | `""` |
  | `x { b: 1 null 2 }` | `b: 1 null 2` | `b: 1 2` |

  `map-has-key` is the only one already right. `map-get`/`index`/`null` all trace to the
  same root: **jess `ast/` v2 has no `null`/Nil value**, so there is nothing for a miss to
  return and nothing to trigger declaration suppression or list elision. `map-remove` and
  `nth` are a different axis (jess is more permissive where dart-sass errors) and are not
  blocked on `null`. See DESIGN-DECISIONS R11/R12 — the `map-get` lowering fix is settled in
  spelling (`$m[zzz]?`, per-step) and blocked on the miss-value/`null` language question.
- **Dead one-line shim: `packages/fns/src/sass/math/abs.ts`.** Re-exports `abs` from
  `shared/`, but `sass/math/index.ts` imports `abs` from `shared/` directly, so nothing
  reaches it. A reachability walk from all eleven index entrypoints finds it is the only
  unreferenced `.ts` module in `packages/fns/src`.
- **`extend-exact.less` flake is real cross-compile state contamination**, not test flakiness.
  **This row's pointers moved packages.** `packages/jess/src/index.ts` is now 24 lines and only
  subclasses `DefaultCompiler`; the plugin stack was extracted to `@jesscss/compiler-preset`
  (rename `09bcc9b2e`), with the reusable render engine in `@jesscss/compiler`. The two sharing
  channels at `991b315e0` are the per-stack plugin instance caches
  (`packages/compiler-preset/src/index.ts:22-23` — `jessPluginInstance` / `scssPluginInstance`,
  populated at `:39-42` / `:48-51`, plus `lessPluginResolver`) and the module-scope dialect
  evaluators registered by `@jesscss/plugin-less` / `@jesscss/plugin-scss`. The evaluators hold
  only an immutable dispatch table, so they carry no per-render state to leak; the plugin caches
  remain the live suspect. Diagnostic: a fresh `Compiler` per file isolates which channel.
  **Constraint on any fix:** a `Compiler` must stay reusable across many files. "New Compiler
  each time" is not an acceptable fix, and neither is a `reset()` that callers have to remember.
  Note that `DefaultCompilerStackImpl.dispose()` (`:64-76`) already clears both caches — whether
  it is a fix, a partial fix, or exactly the remember-to-call-it shape the constraint rejects is
  **unverified** and is an owner question, not an assumption to build on. A separate session is
  on this.

### Parked / stale branches — do not merge as-is

- **`css-sharing-inventory`** — STALE. 10 of its 30 rows now name a dialect that passes.
  Needs a §1 refresh first.
- **`wip/jess-calc-grammar`** — parked: 3 eslint `no-unsafe-type-assertion` errors, and it now
  conflicts with `dev` in the `$( … )`/calc region that `ad1bbd1bf` changed.
- **`wip/maybe-promise-2b`** — explicitly NOT FOR LANDING.
- **`fix-per-dialect-registry`** — live, see WORK IN FLIGHT. Local only; no remote tracking
  branch as of `e34bb24b3`.

### Gate hygiene — LANDED `c3db7e53e` (2026-07-24)

Gates that are red on an untouched checkout are not gates; they teach people to reach for
`--no-verify` on the ones that matter. `c3db7e53e` made green mean green. **A fresh agent
should now treat a red gate as its own change breaking something**, which was not true before.

Fixed (each was red on clean `dev`):

- `verify:types` — `less-parser`'s hand-written `SharedCssAstSyntax` was missing
  `CssAstSyntaxUnicodeRange`. One missing declaration was failing the whole 22-config gate.
- `verify:binding-lookup-hot-paths` — crashed with `spawnSync rg ENOENT` on any machine without
  ripgrep; both shell-outs are now a repo-native scan.
- `verify:node-copy-frontier` (and therefore `verify:baseline`) — the `unit.clone()` in
  `jess-plugin-js/src/runtime-worker.ts` belongs to the sandboxed Deno `@plugin` worker's OWN
  local `Unit` class, not a jess tree node. It is now an attributed allowlist entry.
- `scripts/check-macro-buildable.mjs` — repaired and wired as `pnpm run check:macro`
  (`064e3d985`).
- `verify:aggressive-cutting-review` fired on "a hot-path file changed" rather than "its
  behavior changed", so a comment-only edit was a guaranteed false positive. Cosmetic hunks are
  now stripped before the changed-surface predicate — conservatively: `@ts-`, `@__PURE__`, and
  eslint-directive comments still count as code.

**Security fix found while baselining:** `@plugin` bypassed `disableScriptModules`. The `ast/`
engine reaches `loadPlugin` directly through `prepareBodyPlugins`, so the Context import-path
check never ran and a disabled plugin still executed. The Less plugin host now refuses at the
load boundary.

**Every count-based baseline is now a NAMED SET.** A count cannot distinguish "nothing changed"
from "you fixed one and broke another" — both read as N. Converted:
`packages/jess/test/known-failures.json` + `scripts/vitest-ratchet.mjs` (jess suite failures by
test name; fails on a new failure *and* on a listed test that starts passing or disappears);
bootstrap-corpus `PARSE_PASS_FLOOR`/`EVAL_PASS_FLOOR` → named fixture sets;
conversion-construct-support floors → named construct sets; shape-stability `shapes.size >= 25`
→ a named AST node-type inventory; `verify-render-buffer-frontier` `=== 2` → two named sites
(`For` / `While`), so a swapped site cannot pass.

Do not reintroduce a count. If you need a baseline, name the members.

The `--no-verify` usage rate is **UNVERIFIED (2026-07-24)**: `--no-verify` is a git flag, not
commit content, so it leaves no trace in `git log` and cannot be recovered from this repo. Do
not repeat a specific ratio as if it were measured here.

### Model correction — COMPLETE

- [x] SCSS nested-property → `Collection` (`b3976867e`).
- [x] `AnonymousMixin` added, value blocks content-classified, AST `DetachedRuleset` node
      DELETED (`b7f413d08`). LESSON: a CST grammar rule is not an AST node — keep the CST
      `DetachedRuleset` rule name; renaming it dangled `compose()` and a stale build masked it.
      Compose-integrity regression guards were added. See [[collection-vs-detached-ruleset-model]].

### Landed since this checklist was last reconciled (2026-07-22 → 2026-07-24)

Recorded so the next reader does not re-derive it from the log:

- **Pseudo-argument consolidation (2026-07-23).** Shared, `g`-free `cssAstPseudoSyntax`
  recognition artifact (`89917ce8f`), all four parsers migrated (`00778bac1`, `a6760c89e`,
  `d974aede3`), divergences unified (`e4b46ac45`), `of S` restricted to `:nth-child` per
  Selectors-4 §6.6.2 (`c6c0ea567`). Designs: `PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`,
  `PSEUDO-ARGUMENT-ALWAYS-STRUCTURE-DESIGN.md`. **Residual:** `jess-parser` still joins
  selector-bearing pseudo arguments through `staticSelectorText`
  (`packages/syntax/jess/jess-parser/src/grammar.ts:385`) — the remaining gap to
  [[parser-pseudo-args-always-structured]].
- **Structured pseudo-selectors, structure-only** (`c5f327ee7`, `dc6040d5e`, `5f95ac6d4`,
  `7e3cf042b`) with serialization relocated from grammar to core (`d0d77d22c`).
- **`;` is a declaration-list SEPARATOR, not a terminator** — `ef697892d` (jess),
  `ff7349969` (css/less/scss), `86d6143e2` (jess variable assignment is a declaration for this
  purpose), pinned by `20b01b0db`. Ruling: DESIGN-DECISIONS P11.
- **Stylesheet-defined functions in `.jess`** (`1ba17a77d`), documented by `741e6209c`;
  block auto-termination ruling: DESIGN-DECISIONS P12.
- **`.jess` `&` parent selector landed** (`9ac4d0bee`, design `cd7fc9c39` /
  `JESS-PARENT-SELECTOR-DESIGN.md`, rulings P9/P10).
- **`$( … )` stops emitting parens and a chained call stays in its frame** (`ad1bbd1bf`).
- **Root parentless `&` resolves to empty in the extend projection** (`e1d6396b4`).
- **MaybePromise/awaitable lane** extended to guards (`e79f0e434`), at-rule preludes
  (`72e6efd51`), mixin dispatch + mixin index (`19223650f`), nested selector header + shell
  probe (`a447bca1d`). `161fe9709` removed the blocking `@plugin` FIFO channel — a BEHAVIOUR
  CHANGE: `@plugin` values now travel the awaitable lane and a value reaching a position that
  cannot suspend fails loudly with `eval/async-in-sync-position`.
- **Sass+ support matrix published** (`3202ff246`,
  `packages/docs/docs-content/docs/shared/04-guides/02-coming-from-sass/00-support-matrix.mdx`
  — path updated for the `e96d1035d` packages regroup), and
  `c06dd4d7a` stopped advertising a `jess convert` command that does not exist.
- **Bootstrap Sass corpus ratchet + SCSS construct inventory** (`bde2e982e`);
  **conversion construct-support inventory + equivalence-harness design** (`c028a7c76`,
  `docs/design/JESS-EQUIVALENCE-HARNESS.md`).
- **Value-position `Collection` serializes instead of folding to empty bytes** (`ba8743b0e`),
  and **SCSS nested-property flatten is shared by both emitters** (`e63c82031`). Rulings:
  DESIGN-DECISIONS C11 / C12.
- **Docs reorg** (`0806ccdbb`, `3098275f5`): `docs/future/` is gone; the tree is
  `docs/{architecture,design,state,process,perf,releases}`. `.cursor/` holds tool config only.
  The decision ledger is `DESIGN-DECISIONS.md` in this directory.
- **Semantics governance** (`c5a58a1e7`, `95fd726ec`): `docs/architecture/SEMANTIC-INVARIANTS.md`
  (evidence-per-item, each entry carrying a STATUS) plus `.cursor/agents/semantics-reviewer.md`.
- **Numeric-precision policy DESIGN** (`9624e532b`, `4797ae218`, `ddd0883e4`,
  `docs/design/numeric-precision-policy.md`). Design only — see WORK IN FLIGHT.
- **Per-function Less/Sass dialect classification audit** (`1d253ce9c`, `1164ddd15`,
  `docs/state/fns-dialect-classification-audit.md`).
- **One Node engine floor across every published package** (`e7a7cc037`): all 19 publishable
  packages declare `"node": "^20.19.0 || >=22.18.0"`. `bf7286753` dropped the CI `lts/-3` leg;
  `93e1aa49d` backed out two files that sweep had picked up.

## Current target

Keep AST v2 as the canonical public representation. Parseman grammar reductions
create exact `Stylesheet` data directly through each dialect's public `parse()`
operation; core has no parser construction host, action registry, bridge,
source reparse, or compatibility path.

### Aggressive-cutting note — typed Less import query tail

`@import url("…") (min-width: @var)` now carries the existing typed
`Block(Operation(':', …), delimiter: 'paren')` tail from the Less grammar. The serializer reuses
its existing query-prelude byte emitter at the three import-tail boundaries
(planner request, loader request, and CSS-terminal output), so it preserves
query delimiters while evaluating the variable. No node, array, traversal,
resolver, Context capability, or public API is added; ordinary opaque/import
interpolation tails retain their existing byte path. This is behavior evidence,
not a performance claim; parser/public-render tests cover the new fact.

### Active delivery order

The immediate delivery target is a feature-complete **Less alpha** on that
public architecture. Do not spend the active implementation capacity on new
SCSS or Jess syntax/evaluator slices while the public Less route still lacks
required execution semantics. The other direct parsers remain canonical work,
but Less import execution, evaluator wiring, retained Context/plugin dispatch,
and corpus parity come first; resume the remaining dialect integration only
after those Less-alpha gates are genuinely green.

### Less corpus truthfulness gate

`packages/jess/test/less/all-less.test.ts` registers its expected-failure cases in the
`expectedFailureFixtures` map at `:178`; only a subset is selected by the current alpha fixture
glob and filters. **Do not carry a count from this paragraph.** Three numbers have been in
flight here at once — this section said 32 registered / 21 selected / 108 cases (2026-07-24),
`less-v5-corpus-inventory.md:30` says 26 registered, and the map actually holds **27** entries
at `facb641dd`. The lane size has also moved: the 2026-07-30 re-measurement below records
`all-less` at **109/110**, superseding the `108/108` recorded here and at the Less-alpha gate
section. Regenerate the registry membership from the map itself and the lane size from
`pnpm run test:less:test-data`, and record the external less.js checkout SHA with it (see
"The Less corpus authority is an external mutable checkout" below) — a corpus number without
that SHA is unfalsifiable. The harness passes
when a named fixture still fails, so none is passing-parity proof. The owner
decision for the first alpha is to classify—not drain or hide—them. The
reproducible selection accounting, exact active cases, inactive registry
entries, symptoms, scope, and follow-up rule are in
[`../../state/less-v5-corpus-inventory.md`](../../state/less-v5-corpus-inventory.md); the
readiness tracker and release notes must link that inventory. In particular, a
missing mixin remains an error; only an ordinary function call with an optional
function reference may fall back to a CSS `Call` when lookup misses.

### `callWithContext` deletion prerequisite

The legacy tree call path has been audited rather than treated as an implicit
compatibility seam. `packages/core/src/tree/call.ts` reaches
`callWithContext` from exactly five dynamic-function paths:
`evalOptionalFallbackOutput`, `evalPlainDynamicFunction`,
`evalMetadataDynamicFunction`, `renderDynamicFunctionOutput`, and the ordinary
`evalFromStateInFrame` extended-function branch. These are all legacy-tree
execution routes. The ordinary branch keeps two distinct rules: a
`No matching mixins` failure is a hard missing-mixin error (apart from selector
capture), while a selected function's invocation failure may preserve the
authored call only under its optional/silent-fail policy and
`functionMode !== 'error'`.

`packages/core/src/define-function.ts` shows why this cannot be replaced by a
wrapper: `callWithContext` unwraps and clones legacy `List`/`Node` arguments,
runs legacy preprocessors, resolves positional/record/hybrid overloads,
evaluates non-lazy nodes through `Context`, supplies `FunctionThis` (`context`,
`caller`, `args`, `rawArgs`), performs legacy `instanceof` validation and
conversion, and finally invokes either `_internal` or a Context-bound function.
That contract is the bridge deletion target, not a public runtime model.

The replacement is the existing AST-v2 value seam. A canonical `Fn` is called
with `(List, FnCtx)` by `buildEvaluator`/`value-dispatch`; `ParamSpec.type`,
defaults, rest, and explicit lazy thunks provide typed binding, while direct
Sass/Jess embeddings may use named records. `FnCtx` carries only resolved modes,
the value-to-string hook, and optional IO; it does not expose `Context`, legacy
nodes, callers, or source re-evaluation. Unknown function names remain authored
calls without a warning; failures from a function that actually resolved are
handled by `functionMode` (preserve + warning versus error). The plugin adapter
populates this same `Fn` registry/host, so Context remains the session and
plugin/import dispatcher rather than a function-body ABI.

The deletion gate is therefore concrete: migrate every production consumer of
the old contract (currently the Less `rgb`/`hsl`/`rgba`/`hsla`/`each` paths and
the Sass compatibility/map functions), then migrate their direct tests from
`RuntimeFunction`/`callWithContext` to typed `Value`/`ValueGroup` and registry calls.
Only after the consumer/test search is empty may `tree/call.ts`,
`define-function.ts`, and their old conversion exports be removed; no adapter,
alias, or tree-to-AST bridge is allowed as an intermediate state.

### Alpha packaging blocker: generated legacy declarations

The alpha tarball audit found a packaging surface issue, not a reason to
delete declaration files blindly. `@jesscss/core` now exposes only the curated
root API plus `./value` and `./ast`; `src/index.ts` intentionally does not export
the old tree classes. `tsconfig.build.json` separately emits declarations and
maps for every `src/**/*.ts`, so unexported `lib/tree/**` helpers are generated
artifacts but must remain until no reachable declaration refers to them.

`@jesscss/fns` was broader and inconsistent: its `./*` export map claimed every
generated `lib/*.d.ts/js/cjs` subpath while `tsdown.config.ts` emitted only the
`index` and `builtins` runtime entries, so declaration-only paths were published
and advertised without a matching runtime file. **Resolved:** the wildcard stays
removed and the documented subpaths are now GENERATED — `./less`, `./sass`,
`./sass/{color,list,map,math,string}`, `./shared`, `./registry`,
`./less/registry`, `./sass/registry`, each with a real tsdown entry. `plugin-js`
continues to treat all `@jesscss/fns/*` paths as trusted; that is a sandbox
boundary, not a package-subpath justification.

**Bounded package cut (2026-07-22; superseded 2026-07-24).** The first safe
export correction removed the `@jesscss/fns` `./*` wildcard, when the only
consumers were the root `@jesscss/fns` import and `@jesscss/fns/builtins`. That
is no longer the shape — see the paragraph above for the published subpaths. The
historical record: a workspace consumer search found no production or test
consumer importing a Less/Sass/shared/util subpath, the fns build emitted runtime
entries only for `index` and `builtins`, and the former
`.js`/`.cjs` files do not exist. The README and Sass export-structure note now
state that those folders are source ownership boundaries, not published
entrypoints. `plugin-js`'s filesystem trust rule remains a separate sandbox
boundary for resolved built-in files and is not used to justify package
subpaths. The core root tree barrel has since been cut from the public root
surface. The remaining deletion lane is internal: `Context`, the legacy fns
implementation, and compat consumers still import tree classes directly, so
those migrations remain the next required slice.

The minimal cut sequence is:

**A.** Finish the remaining legacy `@jesscss/fns` Less/Sass function and test
migrations to root `@jesscss/core` semantic values; rewrite or intentionally retire the
production `packages/jess-plugin-js/src/bridge.ts`, which still transports
legacy `Any`/`Color`/`Dimension`/`List`/`Rules` values.

**B.** Delete `define-function.ts`, `conversions.ts`, and their root exports
after the consumer search is empty.

**C.** Migrate `Context` and `jess`/plugins off `TreeContext`, legacy
`Node`/`Rules` state, spine/visitor fields, and tree-only utilities while
retaining the AST-v2 `DocumentContext`, plugin host, and import dispatch.

**D.** Keep the already-narrowed `core/src/index.ts` root surface narrow; remove
any remaining explicit legacy utility exports only after the consumer search is
empty. The public root should expose only stable Context/plugin/error, canonical
AST execution, and semantic value/fn seams.

**E.** Remove the now-unreachable tree runtime and legacy tests/visitor ABI.

**F.** Tighten declaration builds to the public entry closure and replace the
`fns` wildcard with explicit, runtime-backed subpath exports. Verify packed
install imports and type resolution before alpha publication.

**No-op consumer audit (2026-07-22).** A bounded audit of the remaining
`@jesscss/core` imports in `packages/fns` found no honest pure cut to land
without first resolving function-owner semantics. The remaining consumers are
clustered as follows:

- Less color functions (`contrast`, `fade*`, HSL adjusters, `shade`/`tint`,
  `color`, and constructors) still depend on legacy `Color` source-format and
  raw-channel metadata, `Context`, or the legacy `mix` contract. Their
  canonical `builtins/` counterparts are comparison evidence, not an approved
  destination or compatibility alias.
- Less structural/context functions (`each`, `isruleset`, `iif`/logical,
  format/replace, data-URI/image/SVG helpers) consume `Node`/`Rules`,
  lazy-thunk, or Context/IO capabilities and require their own behavior
  migrations.
- Sass map/list/string functions consume legacy `Collection`, `Declaration`,
  `Any`, and Context contracts. They need typed map/list semantics and direct
  tests before tree imports can be removed.
- Shared `math/max` and `math/min` still use legacy `Node.compare`; Less's
  canonical `min-max` policy and Sass's unit/error behavior have not been
  proven identical, so they must not be ported by assumption.
- `less/types` mixes value predicates with legacy `isurl`; a partial rewrite
  would leave the same root-tree consumer and would not advance the deletion
  gate.

**Decided (2026-07-24, ledger C13).** The ownership question above is settled in
favour of the dialect owner: each converted `builtins/` implementation was moved
INTO `less/`, replacing the legacy tree-node twin of the same name, and
`builtins/` is deleted. **Nothing legacy remains** (re-verified 2026-07-30 at
`ef173125a`): both dialect indexes export value-domain `Fn`s exclusively — 83 in
Less, 62 in Sass, zero non-`Fn` exports — so there is no "not registered until
converted" residue left. See the closed fns-port-backlog row above. Cutting the
tree barrel is now gated on `packages/core`, not on `packages/fns`.

### `plugin-js` bridge disposition

The `packages/jess-plugin-js/src/bridge.ts` audit does not identify another
parser/compiler AST bridge. It is the external Deno-process transport for the
legacy Less JavaScript runtime ABI: host-side legacy `Any`, `Color`,
`Dimension`, `List`, `Quoted`, `Sequence`, `Rules`, and `Declaration` values
are encoded as tagged JSON, while `runtime-worker.ts` decodes them into its
own `less.tree` classes (`Dimension`, `Color`, `Quoted`, `Keyword`,
`Anonymous`, `Value`, `Expression`, and `DetachedRuleset`).

That ABI is observable and tested by
`packages/jess-plugin-js/test/plugin-js-security.test.ts` (the
`less.tree`/`less.dimension`/`less.value` `instanceof` and legacy `@plugin`
cases), by `packages/jess/test/less/wall8-repro.test.ts`, and by the
`plugin-js` README's typed-bridge guarantee. The AST-v2 semantic value API is
not a 1:1 replacement: it has structural `Dimension`/`Color`/`Quoted`/
`Keyword`/`List`/`Block`/`Bool`/`Nil`, but no Less-compatible
`Anonymous`-vs-`Keyword` class identity,
`Sequence`/Expression value, detached Rules/Declaration map, or class identity;
it also carries different color source-format metadata. Substituting those
shapes now would silently break external modules and Less map/plugin behavior.

Do not add a dual canonical/legacy branch and do not delete this transport in
the alpha. Its future cut requires an owner-approved canonical cross-process
protocol covering raw/anonymous values, sequence/layout facts, detached
rules/map semantics, and color source metadata; a new worker API and facade;
migration of the bridge tests, README, legacy plugin fixtures, and callers; and
only then removal of the legacy Less facade plus all core-tree imports from
`bridge.ts`. Until that protocol is approved and proven, this is a legitimate
external runtime compatibility seam, not evidence that the public parser or
compiler still uses a tree-to-AST bridge.

## Active orchestrator goal

Drive the public AST-v2 cutover, Less alpha readiness, Parseman release,
performance recovery, and Jess alpha preparation to verified completion. This
section is the authoritative full-scope companion to the compact task goal.

- All public CSS, Less, SCSS, and Jess `parse()` routes must reduce Parseman
  grammar directly to canonical AST-v2 `Stylesheet`; `Reference` is the typed,
  recursive public reference chain. No bridge, builder/parse host, action
  registry, source reparse, scanner/regex recognizer, compatibility parser, or
  fallback/shim may return.
- Less is the immediate feature-completeness priority. Close real parser,
  evaluator, import, plugin, and corpus gaps through the public route; prove
  the first external prerelease as exactly `less@5.0.0-alpha.1`, including
  built-artifact `lessc` and clean packed-install tests.
- CLI ownership is explicit: only the external `less` package provides the
  Less-compatible `lessc` command. The `jess` package provides only `jess` and
  must not claim Less CLI compatibility through a second bin or alias.
- Node support is a rolling policy, not a permanently pinned release number.
  **Corrected `e7a7cc037` (2026-07-24); re-measured 2026-07-30 on `facb641dd`:** all 22
  publishable packages (31 workspace packages, 9 `private`) declare the same
  `"node": "^20.19.0 || >=22.18.0"` — three LTS lines (20, 22, 24), matching parseman. The
  range is where the toolchain already stops (oxc-parser, oxlint and vite each require exactly
  it), and the gaps are load-bearing: 20.0–20.18 and 22.0–22.11 cannot install the oxc family.
  Node 18 was never real — it cannot run oxc, vite or vitest, so the old `>=18` floor could not
  be exercised by our own suite. **`.github/workflows/` was NOT updated** (pushing it needs the
  `workflow` OAuth scope, which the client did not hold): `less-alpha-readiness.yml` still
  sweeps `lts/*` through `lts/-3` (today 24/22/20/18), and the other three workflows pin the
  floating `lts/*` alias, so CI never exercises the declared floor. Recommended fix is explicit
  `['20.19.0', '24']`. This is an OPEN follow-up.
- Context remains the one render/session/cache/diagnostic/plugin/import
  coordinator. Retain its plugin-based source, parser, module, path, and
  import dispatch topology while changing carried documents to `Stylesheet`;
  do not replace it with a second loader or resolver.
- Finish public Jess syntax integration through `jess-parser` and
  `plugin-jess`. CSS is a Context-parsed/inlined document route, not a Jess CSS
  compiler merely because a CSS plugin exists. Delete only machinery proven
  unreachable after direct-route coverage; do not manufacture deletion work.
- **Corrected 2026-07-31:** this previously read "targets published Parseman
  `0.41.x`" with a `0.41.1` dispatch aggregate-elision follow-up. Parseman
  `0.45.0` is published and `0.46.0` is in flight as PR #102; the `0.41.x` text
  was ten releases stale. The adoption rule is unchanged and still binding:
  adopt a parseman version in Jess only after owner publication, registry
  install, macro/compose proof, and matched parser measurements. Normal
  compiler/plugin/CLI parses never enable coverage or trace.
- Treat current direct-Less parsing performance as a release concern. Establish
  reproducible generated-bundle/hash baselines and investigate AST allocation,
  grammar choice/backtracking, metadata/trivia/provenance, emitted
  `composeLeaf()` shape, and historical feature equivalence independently.
  Optimize only with semantic/output proof and matched parse plus end-to-end
  measurements; never restore legacy architecture for speed.
- Finish the external Less alpha release decision. The direct Jess runtime
  closure consumed by Less is published and queryable at `2.0.0-alpha.11`; the
  Less PR branch consumes that exact registry set, locally passes the alpha
  package gates, and has green PR #19 CI on the `.11` bump. The remaining
  decision is owner merge/publish authorization for Less. Future Jess
  alpha snapshots should use `pnpm run release:alpha:update-from-dev` from a
  clean `alpha` worktree; do not ordinary-merge/rebase shared alpha history or
  publish before every gate passes.

### The user-facing statement of alpha readiness lives OUTSIDE this repo

`~/git/oss/less.js/CHANGELOG.md`, section `v5.0.0-alpha.1 (unreleased)` (@ `2f309b66`), is
the only place the project publicly declares what alpha.1 does and does not do. **Nothing in
`docs/` cited it before 2026-07-30** (verified by grep), which is a routing gap: it is the
text users read, and it is a statement of *jess's own* status, because the v5 alpha package is
a thin wrapper over jess's `Compiler` — not an independent source.

It declares SUPPORTED: `less.render()`, `renderFile()`, `lessc`, variables, arithmetic, mixin
calls, sibling file imports, nested-rule output. It declares WORK-IN-PROGRESS: legacy plugin
execution, file-manager and pre/post-processor hooks, source maps, URL rewriting options,
compressed-output parity, browser compilation (explicitly excluded from alpha.1), and "the
remaining long-tail Less 4 fixture corpus". It sets a quality bar: unsupported syntax must
fail with filename, line, column, and source context rather than raw parser offsets.

Cross-checked 2026-07-30 against this repo, that WIP list is **consistent** with jess's own
records rather than contradicting them — source maps are the queued "Final-pass output
positions / sourcemaps" item below; browser compilation has
`docs/architecture/less-v5-browser-build-spec.md`; plugin/pre-processor/URL-rewriting fixtures
are registered in `all-less.test.ts`'s `expectedFailureFixtures`. Keep it that way: **when a
lane closes one of those seven items, update that CHANGELOG section in the same change**, and
when it opens a new gap, add it there. Do not let this repo's status diverge from the text
users actually read.

### Current Less v5 alpha readiness evidence

Use [`docs/state/less-v5-alpha-readiness.md`](../../state/less-v5-alpha-readiness.md)
as the current source of truth. As of 2026-07-28, the external Less branch has
the desired direct compiler/plugin dependency shape, consumes the published
`2.0.0-alpha.11` Jess runtime closure, passes local alpha package gates, and has
green PR-head CI. Do not publish Less until the owner authorizes the Less release
flow.

#### Less compatibility continuation point — 2026-08-25

- The clean landed boundary is `0b8b1d8c3`. In addition to the prior selector-
  capture and raw Less-grammar math-state work, typed Less `UrlValue` provenance
  now survives variables, mixin/default forwarding, URL-bearing groups, and
  spread expansion, so `isurl()` follows the typed value rather than its emitted
  bytes. No owner-maintained `.css` fixture changed. The executable lane remains
  `all-less.test.ts`; the derived
  release-facing partition is
  [`docs/state/less-v5-corpus-inventory.md`](../../state/less-v5-corpus-inventory.md).
- Owner ruling, 2026-08-22: selector-list capture does not imply automatic rule
  distribution. Less `each()` and Sass `@each` already lower to the shared core
  `For` node and remain the explicit rule-multiplication forms. The final
  `parse-interpolation` captured-parent stanza is therefore an intended
  non-collapsed-output divergence, not an unfinished implicit-distribution
  feature. A future Sass-style selector operation may reuse internal selector
  algebra, but must not introduce a second global distribution surface.
- A follow-up prototype for the residual A7 `(reference)` nested-selector case
  was intentionally not landed. It recovered visible suffixes by scanning
  flattened selector bytes for `&` and eagerly constructing `P^A` Cartesian
  branches. Adversarial semantics review showed that `[title="&"]` is a false
  structural parent match; performance review showed that the eager product is
  unbounded and can hang or exhaust memory. Resume from `origin/dev`, not from
  that prototype. Any renewed attempt first needs a parser/AST-owned structural
  parent occurrence and compact selector composition that preserves reference
  visibility without materializing the Cartesian product.
- The feature triage was re-audited from the public built compiler on 2026-08-25.
  Its assignment-argument, import-option, and container-`style()` rows were
  already fixed; compile-time import media postludes are a settled §12.3b
  rejection, not a missing wrapper. The remaining compact `prop:fn(@var)` row is
  real, but the same source also fails in the owner alpha parser. Jess's
  standalone declaration grammar accepts it; only body routing fails because a
  selector-first functional-pseudo dispatch commits at the bare variable. Do
  not widen pseudo syntax or add a regex/lookahead scan through the function
  body. It needs a left-factored declaration/ruleset route or an explicit owner/
  Parseman routing decision.
- No production change, fixture expectation, scratch patch, or extra worktree is
  part of this continuation point. Remaining active expected failures stay
  enumerated in the corpus inventory and can be taken as independent future
  compatibility batches. That inventory also records the reproduced, unlanded
  final-multiline-function-argument parser gap; it is a future focused batch,
  not retained patch state.

## Router

| Work | Read first |
| --- | --- |
| Direct parser AST construction and legacy-builder deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) |
| Parser recognition, interpolation, and scanner cleanup | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) |
| Feature/eval closure | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) |
| **"Is Less 4.x feature X implemented?"** — feature-by-feature triage derived from Less 4.8.1 itself, each row a measurement against `lessc` 4.8.1 run directly and re-measured before use. Records off-corpus gaps and their current resolutions, and corrects stale WIP classifications in the alpha CHANGELOG | [`LESS-4X-FEATURE-TRIAGE.md`](./LESS-4X-FEATURE-TRIAGE.md) |
| Eval/render allocation, lookup, and traversal cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) |
| Deleting `packages/core/src/tree/` — public-surface inventory, `Context` decomposition, value-boundary options, extraction order | [`TREE-CUTOVER-SURFACE.md`](./TREE-CUTOVER-SURFACE.md) |
| **The four-grammar rewrite** — the eight-to-four physical fold is complete; continue the spec/naming/documentation and current Parseman cleanup on the four surviving host-mode grammars. Start at its §0 | [`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md) |
| The per-`const` grammar review checklist and the naming law (item 14) | [`../parser/GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md) |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) |
| Owner semantic/architecture questions and rulings | [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md) — the canonical OPEN/SETTLED decision ledger |
| Less 4.x builtin-function coverage — all 92 registry names call-verified against 4.8.1, plus the `functionMode: 'preserve'` blind spot that makes an arity rejection indistinguishable from an unknown CSS function | [`../../state/less-4x-function-triage.md`](../../state/less-4x-function-triage.md) |
| Non-engine surface carrying size/complexity cost | [`NON-ENGINE-BLOAT-INVENTORY.md`](./NON-ENGINE-BLOAT-INVENTORY.md) |
| Lazy value materialization / memoization | [`VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md`](./VALUE-MATERIALIZATION-MEMOIZATION-DESIGN.md) |
| Static-import preparation | [`STATIC-IMPORT-PREP-DESIGN.md`](./STATIC-IMPORT-PREP-DESIGN.md) |
| The `--noCheck` typecheck burn-down (open: **2** package.json files at `facb641dd` —
`packages/syntax/scss/scss-parser/package.json:59` and
`packages/syntax/jess/jess-parser/package.json:59`; the `15` here was 7.5x too high) | [`TYPECHECK-BURNDOWN.md`](./TYPECHECK-BURNDOWN.md) |
| Benchmark extend shapes adjudicated against real Less 4.6.7 | [`BENCHMARK-EXTEND-EVIDENCE.md`](./BENCHMARK-EXTEND-EVIDENCE.md) |
| **"What is this file in `architecture/core/` and is it still current?"** | [`README.md`](./README.md) — the directory index, and the record of the 2026-07-30 archive pass |

### Router — grammar cleanup (`docs/architecture/parser/`)

Every doc in that directory, so nothing gets rediscovered. The two rows above
(`GRAMMAR-REBUILD-SPEC.md` = what to do, `GRAMMAR-REVIEW-STANDARD.md` = how each
`const` is judged) still come first; these are the rest of the surface.

**Live — read before touching a grammar file:**

| Work | Read |
| --- | --- |
| Which combinator states which ownership boundary — `choice` vs `dispatch` vs `routed` vs `attempt`, first-set gating, the current idiom set. Its own header still says it is cut against `parseman@0.43.0`, which is one floor stale — the
repo is on `^0.45.0` (`75002c4a3`) and the doc's own rule is to re-cut it in the same change as
a floor bump. Last updated by the wrapper-route ban `3bb2b4225` | [`../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`](../parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md) |
| Sequencing the `css → less → scss → jess` cleanup, and why it is ordered that way. Orchestration decision, not a replacement for the spec | [`../parser/GRAMMAR-SEQUENCE-ORCHESTRATION.md`](../parser/GRAMMAR-SEQUENCE-ORCHESTRATION.md) |
| The remaining named quality cleanup in the Less grammar after its fold — the working list for Less-side routing work | [`../parser/LESS-FOLD-HOTSPOT-REPORT.md`](../parser/LESS-FOLD-HOTSPOT-REPORT.md) |
| The red `oracle:less:byte-identity` movers, classified by entry class. Classify here **before** proposing any baseline update | [`../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md`](../parser/LESS-ORACLE-MOVER-CLASSIFICATION.md) |
| Where a grammar timing row goes. A row counts only if the parser was rebuilt from the measured commit and the macro/compose gates prove no interpreter fallback — the `1517e97c5` perf gate writes here | [`../parser/PARSEMAN-BENCHMARK-LEDGER.md`](../parser/PARSEMAN-BENCHMARK-LEDGER.md) |
| Parseman behaviours reproduced in this repo rather than read off a changelog. Titled 0.32.0 and **version-specific by construction** — re-verify every claim against the current floor before relying on it | [`../parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](../parser/PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md) |
| The parse-perf research queue, per-item and separately measured | [`../../perf/PARSER_OPTIMIZATION_SPEC.md`](../../perf/PARSER_OPTIMIZATION_SPEC.md) |

**Historical evidence — do not let an old problem statement override the current plan:**

| Record | Read |
| --- | --- |
| Why the CSS AST grammar was ~2.3× its CST twin — the Stage 3 pattern proof the fold was built on | [`../parser/CSS-FOLD-DIAGNOSIS.md`](../parser/CSS-FOLD-DIAGNOSIS.md) |
| Stage 3 Phase A rename mapping (verdict: output-neutral, no mapping needed) | [`../parser/CSS-FOLD-PHASE-A-MAPPING.md`](../parser/CSS-FOLD-PHASE-A-MAPPING.md) |
| Stage 3 Phase B discovery notes, kept so the next dispatch does not re-pay the discovery cost | [`../parser/CSS-FOLD-PHASE-B-PARTIAL-FINDINGS.md`](../parser/CSS-FOLD-PHASE-B-PARTIAL-FINDINGS.md) |
| The 2026-07-17 dialect-architecture + error-coverage program. The physical re-base has landed; current status moved to `GRAMMAR-SEQUENCE-ORCHESTRATION.md` | [`../parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`](../parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md) |

Reviewer agents for this work: `.cursor/agents/grammar-reviewer.md` (evidence per
`const`; a bare verdict, "tests pass", or a sampled review is an invalid result)
and `.cursor/agents/perf-architecture-reviewer.md` (evidence per invariant).

The detailed future plans remain active for their grammar, feature/eval,
scanner-cleanup, and performance content. Their former bridge/host sections are
historical evidence only.

## Non-negotiable rules

- Grammar owns recognition and construction. Do not add a parser host, action
  registry, bridge, compatibility alias, source reparse, or fallback path.
- Parser recognition uses Parseman grammar combinators only. Imports and
  interpolation are typed first-parse facts.
- Preserve one canonical tree; do not normalize cloning, materialization,
  rediscovery, or error allocation in hot paths.
- Public operations use stable names such as `parse`, `build`, and `render`.

## Settled delimiter-container model

AST-v2 uses one `Block` value wrapper for delimiter-bearing values. `Block`
stores `inner`, `delimiter: 'paren' | 'square'`, and the existing optional
`escaped` fact for Less `~(...)`. It is deliberately transparent to typed
evaluation, participates in Less math-mode evaluation when the delimiter is
`paren`, and renders square-delimited values as authored bracketed lists. There
is no separate `Bracket` node and no `List.bracketed` field.

Where the grammar emits a public syntax `List`, it and the materialized value
`List` share the canonical payload shape: `value` plus an explicit separator
fact (`',' | '/'`). They never expose the former
`items`/`separators` pair or recover a separator from joined bytes. Ordinary
adjacent declaration/value terms are instead the raw recursive `ValueSlot`
array itself; there is no `SpacedValue` or `List(sep: ' ')` wrapper for that
case. Parsers may attach the exact authored boundary runs—spaces, comments,
line breaks, and indentation—to that array in the out-of-band provenance table,
so the semantic array stays plain while serialization remains trivia-aware:
comments and authored line breaks survive, while the renderer may normalize
continuation indentation to the surrounding output depth.
`SpacedValue` remains only where a non-value/prelude compatibility shape still
has an independent semantic reason to exist.

The legacy tree proves the same delimiter fact: its `Paren` carries
`delimiter: 'paren' | 'square'`, and Sass list functions preserve/read it for
`is-bracketed`, `append`, `join`, and `set-nth`. AST-v2 now carries that fact in
the canonical `Block` wrapper under `@jesscss/core/ast`; the root package does
not re-export it under the colliding legacy-tree name. Curly statement/ruleset
bodies remain outside this `ValueNode` design.

## Completion gates

Run focused parser/core tests first. Run the parser-runtime boundary verifier
when recognition changes. For eval/render/lookup/traversal/copying changes, run
`pnpm run verify:aggressive-cutting-review` before commit. Final integration
requires fresh builds, core tests, the Jess AST-v2 production-route ratchet,
and the Less corpus.

### Verified alpha squash policy (2026-07-22)

The `alpha` and `dev` branches share a common ancestor but independently added
the same source paths. A disposable rehearsal confirmed that
`git merge --squash dev` from `alpha` creates a broad add/add conflict set;
these are history-topology conflicts, not a semantic queue to resolve by hand.
Do not ordinary-merge or rebase `dev` into `alpha`.

For the refresh, first fetch `origin/dev`, create a recovery ref such as
`git branch alpha-pre-refresh alpha`, and work in an isolated `alpha`
worktree. Import the exact pushed source tree with a two-tree patch
(`git diff --binary alpha-pre-refresh..origin/dev` and `git apply --index`), then run
`node scripts/release/restore-alpha-package-versions.mjs --from alpha-pre-refresh --stage`
followed by `node scripts/release/record-alpha-source-provenance.mjs --stage`.
The required `--stage` makes that tool restore and stage only each
`packages/*/package.json` `.version` field from the
recovery ref; it must not restore whole manifest files. The alpha snapshot takes
all current `dev` manifest fields (including runtime/peer/dev dependencies,
exports, and publish configuration) and retains only recovery alpha versions
until the registry-aware release step selects the next version. `pnpm-lock.yaml`
is unchanged. Keep `dev`'s root quality gates (`verify:types` and bounded
production lint) and its newer HANDOFF/readiness/release evidence; reconcile
the alpha release note from final gate evidence instead of restoring the older
alpha docs wholesale.

### Less-alpha gate status (re-measured 2026-07-24 on `e34bb24b3`)

Measured in a clean worktree after `pnpm install --frozen-lockfile` + `pnpm run build:release`.
These are the numbers, not a narrative:

- `pnpm run verify:types` — **GREEN. 25 build configs at `facb641dd`** (the gate prints its own
  count; the `22/22` recorded here on 2026-07-24 is stale, and `PROJECT_STATE.md` repeated it).
  It was RED with one `less-parser`
  diagnostic (missing `CssAstSyntaxUnicodeRange`, introduced by `c1782031e`) from `13725f894`
  through `93e1aa49d`; `c3db7e53e` fixed it. `release:alpha:preflight` is no longer blocked here.
- `pnpm run test:less:test-data` — **108/108 on 2026-07-24; superseded by 109/110 measured
  2026-07-30**, see "That debt is now zero" below (`all-less.test.ts` is the only
  fixture-backed Less integration authority). Note what that number now means: `e34bb24b3` registered
  `css-3.less` and `variable-advanced.less` in `expectedFailureFixtures`, so the harness
  *asserts they fail*. See below.
- `pnpm --filter jess test` — not re-measured on `e34bb24b3`. Its failures are now a named set
  in `packages/jess/test/known-failures.json`, enforced by `scripts/vitest-ratchet.mjs`; read
  that file rather than any count in a doc. (Invocation note: `pnpm --filter jess test --run`
  fails with `Unknown option: 'run'` — pass it through as `-- --run`.)

#### The Less corpus authority is an external mutable checkout

`test:less:test-data` reads its fixtures through the root `package.json:11` dependency
`"@less/test-data": "link:../less.js/packages/test-data"`. **That specifier is RELATIVE, so
which corpus you measure against depends on where your jess checkout sits** (verified
2026-07-30):

- from the main checkout `~/git/oss/jess`, it resolves to
  `~/git/oss/less.js/packages/test-data` — a git checkout, currently branch `alpha` @
  `2f309b66`, whose state you can record as a SHA;
- from a worktree under `~/git/worktrees/`, it resolves to
  `~/git/worktrees/less.js/packages/test-data`, which **is not a git repository** (`git
  rev-parse` fails there), so its state cannot be recorded as a SHA at all.

The two trees were byte-identical on 2026-07-30 (`diff -rq` reported zero differences), but
nothing pins that, and a corpus number carries no meaning without naming which of the two you
resolved. State the resolved absolute path in every report, not just a count.

On 2026-07-24 the numeric-precision lane graduated four fixtures there
(`dded69cc`, "test-data: v5 numeric-precision expectations, 4.x snapshotted to legacy/"), so the
corpus encodes the *intended* v5 numbers while the jess-side change has not landed. That briefly
made the suite 106/108 with no jess-side change at all.

`e34bb24b3` resolved it the right way: both fixtures are now NAMED expected failures rather than
a bare red. Because that map *asserts* the failure, landing the precision fix will trip the entry
and demand its own deletion — the debt is visible and can only move toward zero.

**That debt is now zero (re-measured 2026-07-30 against jess `ef173125a` + less.js
`2f309b66`).** Both fixtures PASS: `tests-unit/css-3/css-3.less` emits
`rotate(-0.0000000001deg)` and `tests-unit/variables/variable-advanced.less` emits
`add-px-2: 393.3527559px`, matching the graduated `.css`. The table that used to list them is
deleted. `all-less` is 109/110 (80/81 unit + 30/30 config), the single red being the documented
`tests-unit/extend/extend.less`.

A third fixture, `import-remote.less`, is network-dependent and deliberately left gating; it is
documented in `known-failures.json` so the next reader does not mistake it for a regression. It
passed in this run (network available), which is exactly why it is documented.

Consequence a fresh agent must internalize: **a Less-corpus number is only meaningful together
with the less.js checkout state.** Record both SHAs, or the count is unfalsifiable.

~~The graduation commit states the landed constant as `1e-10` while the policy doc says
`1e-12`.~~ **RECONCILED — verified 2026-07-30 on `facb641dd`.** `numeric-precision-policy.md:6`
now opens with the owner ruling ("adopted job 1 with a relative tolerance of **`1e-10`**, not
the `1e-12` this document recommended"), and §7 "Job 1, concretely" (`:459-468`) is explicitly
labelled OVERRULED with "What actually landed: tolerance `1e-10`, gate 10". Code agrees:
`packages/core/src/ast/format-number.ts:28` `const TOLERANCE = 1e-10`.

The public Less route reaches canonical AST-v2 evaluation and serialization for direct and
imported documents: the Less plugin calls the public direct parser, Context carries its
`Stylesheet`, parser/source identity, typed builtin evaluator, and resolved dialect options,
and Jess serializes that document without a tree bridge or copied execution-option bag. The
Less test harness loads the macro-compiled public parser artifact, not Parseman grammar
source, and the Less-alpha command builds that parser/plugin pair before running integration
tests.

The corpus's marked expected-failure cases remain known Less-parity limitations, not
release-gate failures; the harness passes when a named fixture still fails, so none of them is
passing-parity proof.

## Context and plugin dispatch invariant

`Context` remains the canonical per-render coordination and state object. It
keeps options, diagnostics, caches, per-file state, eval/render frames, and the
installed plugin chain. Its import and parse methods are not duplicate
resolvers: `_getPath` dispatches active-plugin `expandImport`/`resolve`, then
resolver and locator plugins; `getTree` dispatches plugin `getSource` and
`safeParse`; `parseString` dispatches the selected parser plugin; `getModule`
dispatches the selected/lazily loaded module plugin.

AST cutover changes the document type carried through those same calls from
legacy `Rules` to canonical AST `Stylesheet` (or an explicit canonical document
result). It preserves Context diagnostics, cache, session, plugin ordering, and
visitor/lifecycle coordination. It does not introduce a separate loader,
resolver callback, or replacement dispatch topology.

Normalize the retained parser-plugin contract while doing so: today
`findParserPlugin` accepts either `parse` or `safeParse`, while `getTree`
requires `safeParse` and `parseString` requires `parse`. The AST result contract
must make that distinction explicit or adapt one form to the other through the
same Context dispatcher; it must not add a second parse path.

Candidates for removal are only:

- `Rules`-specific result types, caches, root assignment, and legacy-tree
  adaptation inside the retained Context methods;
- `StyleImport`/legacy `Rules` placement and evaluation behavior after a
  canonical AST consumer preserves its tested semantics through Context;
- a path proven to bypass the Context-to-plugin chain. The known instance of
  that category — the independent `node:fs` fallback in the former
  `packages/fns/src/util/file-resolution.ts` — was already removed (see the
  reachability audit below); no such bypass is currently known to remain.

`Context.readBinary` and JSON decoding in `getModule` are current explicit
core byte/module capabilities after plugin resolution, not evidence that
`_getPath`, `getTree`, `resolveImportPath`, `parseString`, or `getModule` should
be deleted. Decide their long-term capability ownership deliberately.

### Reachability audit (2026-07-21; spot re-verified 2026-07-24)

Re-checked on this pass: `packages/core/src/visitor/` does not exist; a workspace grep for
`BuilderHost`/`ParseHost` in `packages/*/src` returns nothing; and
`node scripts/verify-parser-runtime-boundary.mjs --require-clean` reports
`0 tracked temporary sites (0 exact ledger sites)`. The remaining claims below are as of
2026-07-21 and were *not* re-verified.


The direct-production call graph was audited before any bridge/tree deletion.
`packages/jess/src/index.ts` enters through `Context.parseString` or
`Context.getTree`, and AST serialization uses the retained Context methods
`loadImport`, `readBinary`, `withDocument`, `withSourceOwner`, and
`rememberDocumentBody`. These are the plugin/session/source-identity topology;
they are not parser or filesystem bridges and remain required.

No production `BuilderHost`, `ParseHost`, action registry, or parser-host
dispatch symbol remains in the parser packages or core. Parseman `BuildHost`
references are confined to the explicit CSS CST/document-language-service
builder API. Do not invent a replacement host to remove that name.

The old core `Visitor`/`Node.accept()` ABI is also no longer reachable: a
workspace search found no production or test consumer after the
`jess-plugin-less-compat` bridge cutover. Core no longer exports
`visitor/index.ts`, and `tree/Node` no longer carries the Less-style
`accept()`/`ABORT`/`REMOVE` machinery. This is distinct from the retained
Context-owned emit hook, which is a separate internal render lifecycle seam and
does not expose legacy per-node visitor dispatch. The separate
`packages/jess/src/visitor/index.ts` identity wrapper was likewise unimported,
unexported, and deleted; it was not a second valid visitor implementation.

The AST serializer's `withSourceOwner` seam no longer carries its dead
`legacyBody` fallback into `Context.withDocumentBody`. The public AST route
always supplies the real `Context.withSourceOwner` capability; the fallback
accepted a context-shaped object that could not implement the typed source-owner
operation and was not reachable from the public compiler/plugin route. The
Context `withDocumentBody` method remains valid for its direct document-body
provenance tests and is not removed or repurposed by this cleanup.

The public core barrel still exports the legacy tree corpus, and the root
`@jesscss/fns` barrel still exposes `packages/fns/src/less/*`; Context, the
legacy function barrel, compat type declarations, and visitor/language-service
consumers still import those classes. Root-tree export removal therefore has
concrete prerequisites: migrate or quarantine those consumers and isolate the
legacy Context execution state. The direct AST renderer itself does not read
`Context.root`, `treeRoot`, `rulesContext`, or `evaldTrees`.

The internal source formerly under
`packages/jess-plugin-less-compat/src/transform/` and `src/nodes/` was proven
unreachable from the package's only public entry point: the built package
exports only the native AST-v2 `LessCompatPlugin`, and its bundle contained no
`toLessNode`, `fromLessPluginReturnValue`, visitor, or transform symbols. The
dead transform/node adapters and their unreferenced helper/type/runtime files
were removed in the alpha.9 cleanup; the package-root native `Fn` API remains.
Likewise,
`packages/fns/src/util/file-resolution.ts` — an independent `node:fs`
`existsSync`/`readFileSync` walk over `opts.searchPaths` that stood alongside
`Context.readBinary` — was deleted in `05bfb8249` ("refactor(fns): use typed
Less image values", 2026-07-22). Its `less/*` image callers moved onto the typed
function IO capability, so path resolution now stays in Context: `ctx.io.readFile`
(wired in `packages/jess/src/index.ts` to `Context.readBinary`) resolves through
the same plugin file manager the import subsystem uses. `packages/fns/src/`
contains no `node:fs` import outside tests. The legacy `packages/fns/src/less/*`
barrel still awaits migration/quarantine on its own terms (above); that is no
longer a prerequisite for this file. The parser-runtime boundary audit is green (zero tracked temporary
scanner/reparse sites); remaining string scans in AST serialization are
evaluation/output semantics, not source recognition.

The aggressive-cutting verifier now treats the coordinated
`ValueSlot`/`List`/`Block` and callable-contract cutover as an explicit
seven-file `semantic-runtime` evidence lane. That lane requires named semantic
cases, focused behavior/build commands, and a current benchmark/output baseline
with `performanceClaim: "none"`; it does not pretend this feature-changing work
is a neutral optimization. Precise/conservative/removal contracts remain
required for any actual cutting or performance claim.

## Direct-root cutover order

The parser work has one real composition gate: a leaf dialect grammar must be
able to macro-fuse imported, recognition-only shared syntax while retaining its
own local direct-constructor reductions. It must not serialize local builders,
relax direct-builder capture validation, or create a reusable builder artifact.
That leaf-only fusion proves that imported recognition-only property/keyword
terminals fuse into local direct AST reductions with their token values intact.
It is incomplete public-parser implementation, not a private architecture or
completion claim. Continue in this dependency order:

1. Complete all four parser families (CSS, Less, SCSS, Jess) as direct AST v2
   `Stylesheet` parsers.
2. Update each plugin to consume its parser's `Stylesheet` while preserving the
   existing Context-to-plugin dispatch topology and plugin-specific semantics.
3. Update the Jess package integration/render route to use those AST-consuming
   plugins, then delete only legacy tree-specific realization such as
   `StyleImport` and any proven duplicate filesystem/module implementation.

### Canonical loop model

The public AST-v2 `For` contract is defined by the documented Jess
`$for (… of …)` syntax—not by Less `each()`. It is a flexible iteration protocol
in the spirit of JavaScript `for…of`: the source kind (list, collection/map,
range, or a later iterable value) determines the useful entry shape presented to
the authored binding pattern. Its bindings, source-dependent iterable behavior,
and source-order semantics must be named and shaped as Jess concepts. In
particular, do not preserve `valueName`, `keyName`, or `indexName` as the public
canonical node vocabulary merely because legacy Less `each()` used them.

Less `each()` is a compatibility input dialect. The Less parser lowers it into
compatible Jess-shaped loop helpers/patterns at its own boundary; it does not
make Less callback/key/index fields a core AST API. A general `For` rewrite must
preserve the public Jess header contract: `[$key, $value]` means key/value in
that order; the source kind supplies the entry shape. The current legacy tree
instead fills tuple slots positionally as value, key, counter for both comma and
bracket forms. That is a legacy implementation discrepancy to repair during the
general `For` rewrite, not an ambiguity in the public language and not a reason
to expose Less callback/key/index fields. Pin the remaining source-specific
entry shapes against public examples before direct Jess and SCSS parser tests.
Do not mis-lower SCSS tuple bindings to Less map-key/list-index roles while that
work is in progress.

`Context._getPath`, `getTree`, `resolveImportPath`, `parseString`, and module
loading are retained coordination/capability seams. In step 2, migrate only the
parser/document result path (`getTree`, `parseString`, plugin parse contracts,
and document caches) from legacy `Rules` to AST `Stylesheet`. Retain resolution and
raw-byte/JSON/module capabilities unchanged unless a later dedicated audit
decides their ownership; do not replace or delete the dispatch path while parser
closure is still in progress.

## Current parser-closure status

All four dialect packages now expose their stable public `parse()` operation as
a direct Parseman-to-`Stylesheet` route; explicitly named CST/document APIs remain
for language-service consumers. The direct grammars are still incomplete, so no
dialect has completed feature-complete parser closure. The public CSS/Less/SCSS/
Jess plugin adapters now call those direct parser operations and return the
canonical `Stylesheet` through Context; that integration is verified below but
does not claim parser or evaluator feature completion. The reductions below are
incomplete implementation toward that public route, not a second architecture
or a completion milestone.

- CSS public `parse()` directly returns `Stylesheet`. The current verified
  closure includes structured selectors and selector-to-block comment trivia,
  declaration-component comments and `!important` trivia, shared exponent
  numbers, `calc()` modulo, balanced query
  functions, conditional blocks, `@page`/margin boxes,
  `@font-feature-values`, typed static `@supports` conditions, generic opaque blocks, `@document`, nested `@scope`,
  and top-versus-nested known-block bodies. The direct public route is checked
  against the existing positive and error CSS fixture corpus. Literal CSS `@import` is now a
  top-level-only `AtRuleStatement`, never an import-resolution fact. Structured
  declaration values now carry scoped function and `var()` fallback components,
  including balanced nested component blocks; malformed or crossed delimiters
  remain rejected by grammar. Valid block comments between `url` and its opening
  delimiter lower to the existing `Url`; malformed URL payloads remain strict.
  This is a bounded value/import slice, not CSS
  feature completion: selector/value closure and corpus differential remain.
- SCSS public `parse()` directly returns `Stylesheet`. Its verified direct
  slices include static selector/comment/conditional structure, ordinary
  structural interpolated simple selectors, structural
  interpolation, complex selectors with typed combinators, static
  attributes/placeholders, selector-valued pseudo arguments, and bounded static
  non-selector pseudo arguments, interpolated
  declaration names, declaration merge modifiers, exact static `@extend`, descriptor-only `@font-face`,
  `@counter-style`, `@property` (including a typed `--custom-property` header),
  static root/nested CSS `@starting-style` and `@layer` blocks with grammar-owned
  static headers,
  root-only static CSS `@charset`, `@namespace`, and `@layer` statements through
  the existing `AtRuleStatement` fact (with Sass `//` comments remaining
  non-emitting trivia),
  static CSS `@scope` blocks through the existing `AtRuleBlock` fact, including
  their existing root, conditional, and declaration-capable nested placements,
  finite CSS `@page` plus margin-box blocks with static headers and
  declaration/comment-only bodies,
  finite `@font-feature-values` blocks with grammar-owned static `Any` headers,
  finite feature sub-blocks, and declaration/comment-only descriptor bodies,
  static CSS `@document`/`@-moz-document` blocks with recursive frame-one bodies,
  quoted/URL `@import` targets (including structural `#{…}` segments within
  quoted targets, quoted `url(...)` targets, and empty `url()` targets), static option lists, a
  bounded typed CSS-emitting `layer`-then-declaration-`supports(...)`-then-
  static media-query tail, an optional
  final variable-declaration semicolon, and unquoted interpolated
  declaration URLs as existing `Url(Interpolation)` facts; unquoted interpolated
  import URLs remain explicitly rejected. It also includes static `@for` endpoints with grammar-owned
  arithmetic,
  static custom-property tokens in typed value positions as existing `Keyword`
  facts (without changing Sass custom-property declaration semantics),
  typed static `@supports` conditions, and static CSS keyframes (including vendor headers, quoted escaped static
  names, typed selector lists, and conditional placement). The additional `@if`
  slice admits literal booleans plus static typed comparisons (`==`, `!=`,
  `>=`, `<=`, `>`, `<`) and grouped boolean structure, including its existing
  reachability inside mixin, `@each`, and `@for` bodies. Its selected bodies
  retain existing variable declarations, mixin definitions/calls, `@each`, and
  `@for` statements in authored order; a selected mixin is available to a later
  sibling through the shared source-order `If` publication model. This does not
  claim Sass bare truthiness, function predicates, comma/list conditions, or
  full Sass scope semantics.
  `@extend !optional` remains rejected until its diagnostic
  semantics have a typed AST field. SCSS media/container
  range queries need ownership redesign rather than flattening into
  `SpacedValue`; `SpacedValue` itself remains an existing undecided
  representation. Static SCSS module directives are a top-level document-prefix
  grammar and use parser-owned classification of unescaped literal paths:
  `@use "sass:name"` rewrites to `ModuleImport` / `@-use
  "#sass/name"`; clear script-module paths (including JSON) become
  `ModuleImport`; stylesheet paths become `StyleImport` / `@-compose`; and
  `@forward` is the existing `StyleImport` with `forward: true`, rendered as
  `@-export`. This is construction only: retained Context/plugin coordination
  still resolves, loads, caches, and evaluates the resulting import facts.
  Escaped or dynamic targets, plus `with`, `show`/`hide`, or prefix
  configuration, remain rejected until their typed/decoded representation exists.
- Less public `parse()` directly returns `Stylesheet`, including its direct
  static mixin subset with literal-pattern/rest parameters, named arguments,
  typed logical guards, corresponding ruleset guards, and typed indirect
  variable (`@@name`) references. Its verified current closure also admits
  escaped ordinary declaration/property identifiers, ordinary `PropertyReference`
  and the current internal `MapAccessor` values
  (pending the owner-reviewed public access-node rename), non-emitting `//` line comments, full
  direct statement bodies in detached-ruleset and `each()` forms (including
  existing typed keyframes and flat static mixin-call iterables/bindings), and
  inline `:extend(...)` rules with the same canonical statement body as an
  ordinary ruleset while retaining authored `ExtendInstruction` placement,
  `*[selector-list]` capture delimiters around its explicit static
  selector-list family (checked against ordinary selectors for that static
  subset; dynamic selector content is rejected only in capture),
  properties, a terminal declaration without a final semicolon, typed static
  `@supports` conditions, static CSS keyframes, lone typed interpolation
  preludes for `@media`, `@supports`, and `@keyframes`, and exact opaque
  UnicodeRange value/list leaves that remain outside arithmetic. Bare dynamic URL
  values and Less `@import url(...)` targets retain existing `Url(Interpolation)`
  facts. A lone `@{…}` import tail is likewise a typed `Interpolation`; mixed static/
  dynamic tails remain rejected until their segment model exists. Parser
  construction does not resolve any import fact. Generic at-rule headers
  remain static-only. Those are grammar-owned AST
  construction slices; named CSS colors and `transparent` lower through shared
  recognition to existing typed `Color` values while ordinary identifiers and
  `currentColor` remain non-color keywords. Less
  grammar/evaluation parity remains incomplete.
- Jess public `parse()` directly returns `Stylesheet`, including static
  selectors, semantic `$[…]` selector templates, documented `$for`
  list/range/key-value collection bindings, static unresolved typed
  `StyleImport`/`ModuleImport` facts for documented `@-` imports, and static
  first-class `Apply` facts for documented static ruleset-only selector lists.
  Documented `$ >` named mixin
  arguments lower directly to existing `CallArg { name, value }` facts; they do
  not add a dialect-local call node or binding path. Documented zero-argument
  variable-held callable statements lower directly to existing `VariableCall`
  facts; argument-bearing variable calls remain held until their typed
  argument/binding model exists. CSS `url()` values
  and documented `$[…]` declaration names lower structurally through existing
  `Url` and `Declaration.name: Interpolation` facts rather than raw source text,
  (including structured `$[…]` path segments in ordinary values and CSS
  `@import` targets) as canonical `Url` nodes, typed static `@supports` conditions, media/container
  range-query facts, `@property --name` descriptor blocks, static CSS keyframes,
  and modern CSS slash-separated function components. Existing variable-led
  call expressions remain available within those components; the slash itself
  is not bare Jess arithmetic. The documented lone `@media $(name) { ... }`
  form is a typed interpolation prelude and remains block-only; it does not
  widen generic headers or `@container`.
  Static CSS at-rules are
  carried directly by the existing canonical
  at-rule facts, including terminal static generic CSS opaque blocks through a
  shared recognition-only Parseman artifact. Jess collection literals lower to the canonical
  `Collection` node, not a CST-shaped map or opaque source fallback (current folded grammar:
  `packages/syntax/jess/jess-parser/src/grammar.ts:87` `Collection: Combinator<Collection>`,
  defined at `:3063`; the `DirectJessCollection` name this row used no longer exists). This
  sentence previously named the AST `DetachedRuleset` node, which `b7f413d08` DELETED in
  favour of the `Collection` / `AnonymousMixin` split — see
  [[collection-vs-detached-ruleset-model]]. Block-bodied lambdas reduce to `AnonymousMixin`
  (`grammar.ts:42` `BlockLambda: Combinator<AnonymousMixin>`). Dynamic
  `$apply` targets remain rejected until `Apply` has a typed dynamic-selector
  model; static `$apply` constructs one `Apply` fact at root, rule, selected
  `$if`, mixin-definition, and `$for` body positions. `Apply` is a core
  ruleset-only, whole-selector, merge-all operation; it is not a dialect render
  policy or an ordinary `MixinCall`. R3 now
  gives `$` live/current and `$^` scoped/final references explicit
  AST lookup facts; normal declarations write both stores, while `?:` and `:=`
  retain their selected lookup/write behavior. `$[$name]` is a live/live
  dynamic variable reference; Less `@@name` remains scoped/scoped. Selected
  `$if` branch declarations now enter both stores only after branch selection;
  they are not globally precollected. Selected `$if` branch mixin definitions
  publish only when the normal source-order walker reaches their definition;
  false-arm definitions stay invisible and publication is activation-local.
  Direct `$if` conditions also carry the existing strict `not`/`and`/`or` guard
  tree, including both adjacent and spaced comparisons; mixin-only guard forms
  remain excluded. Existing direct `MixinCall`, `VariableCall`, `$apply`, and
  `$for` statements execute through the ordinary selected-body walker; typed Jess
  style/module imports are emitted as facts while their plugin-owned loading and
  resolution remains a separate follow-up. The remaining
  documented Jess direct-route blockers are canonical AST/evaluator model work,
  not parser-host, Context, or import-resolution work: `$while` has no canonical
  AST/evaluation model; member/dynamic references and module calls need the
  owner-reviewed access/call model; and
  `@-compose` modifiers/configuration plus anonymous mixin/function forms need
  typed source-fact/callable models. Do not paper over any of those forms with
  raw source, a legacy tree, or a parser-side resolver. Do not migrate plugins or
  Context results back onto a legacy tree route. Keep the existing direct
  `Stylesheet` plugin/render route while completing the remaining dialect-specific
  grammar and evaluator coverage.

For the approved parser-only slices above: new node materialization is only
parser-owned canonical AST construction; no eval/render traversal, resolver,
loader, bridge, or new runtime parse path was added. Verification proves
grammar parity and construction only, never speed.

### Audited model gates before further direct-parser admission

These are real AST/evaluator requirements discovered from the current public
grammars. They are not permission to add a raw fallback, a parser-side resolver,
or a legacy-tree port.

- CSS/Less/SCSS/Jess general-enclosed `@supports` conditions (for example
  `selector(.x)` and `(future condition)`) now use the inert, grammar-owned
  `GeneralEnclosed { form: 'function' | 'paren', name, content: Interpolation }`
  fact. `Interpolation` is the publishable public noun (the former `Interp`
  name has no compatibility alias). Its recursive Parseman content admits only
  literal structured bytes and the dialect's explicit interpolation syntax; it
  is not `FunctionCall`, `Block`, `Any`, or a parser-local raw fallback. For
  Jess, "the dialect's explicit interpolation syntax" is `${…}` and only `${…}`
  — `$(…)` is a value-position expression, not interpolation, so it is rejected
  in the general-enclosed body and in every `(…)`/`[…]`/`{…}` nested inside it
  (`DirectJessGeneralTemplate`). A quoted string in that body is an ordinary
  Jess string and keeps `$(…)`, via the mirrored
  `DirectJessGeneralQuotedTemplate` chain. See DESIGN-DECISIONS P16. The
  serializer keeps a `GeneralEnclosed` segment structurally protected while it
  normalizes surrounding supports syntax, including when authored content has
  private-use Unicode bytes.
- Less static `~"…"` / `~'…'` uses the existing `Quoted.escaped` fact in
  ordinary values, URLs, import targets, guards, generic static at-rule
  headers, and keyframe names; ordinary quoted backslashes do not set that
  flag. Interpolated escaped strings and `~(…)` remain model gates until the
  direct grammar emits the existing `Interpolation`/`Block` facts and the
  serializer proves their authored output; this is an integration/evidence
  gap, not a limitation of the AST-v2 value model.
  Escaped literals remain excluded from direct `@supports` and query values:
  Less preserves literal `~"…"` spelling in a direct supports condition, while
  the existing escaped `Quoted` serializer emits inner bytes. Do not widen
  either context without a supports/query-specific representation and output
  proof.
- Less attributes with `@{…}` in their name or value now form one complete
  `SimpleSelector.interp: Interpolation` token. The grammar preserves brackets,
  static namespaces, operators, quotes, and modifiers as literal parts and
  retains each variable interpolation in source order. Dynamic namespaces,
  pseudos, and extend headers remain excluded; this is selector-token structure,
  not a generic raw-selector fallback.
- SCSS nested-property outer and leaf names now accept the already-supported
  structural `#{…}` property interpolation and lower directly to ordered
  `Declaration.name` facts, inserting exactly one prefix hyphen. An own value's
  trailing `!important` stays only on that own declaration; generated leaf
  declarations retain their own priority. The body remains declaration-only:
  comments, variables, control flow, recursive nested properties, and
  `@extend` are still held for a truthful delayed-prefix placement model.
- Complete SCSS condition semantics need shared semantic `Boolean` and `Null`
  values and an explicit false/null-only truth predicate distinct from the
  existing Less exact-true predicate. Do not map a Sass comma list to `or`, and
  do not silently reuse Less comparison semantics for Sass operators. Public
  value-node approval and a comparison-policy audit are pending.
- Deferred Less `&:extend(...)` needs `ExtendStatement` retained at its authored
  placement plus a render-local placement plan. `ExtendInstruction` remains the
  correct rule-attached data. The existing static preplan sees only direct rules,
  so direct grammar admission without that execution work would silently no-op.
  Public-name approval is pending.
- SCSS `@use`/`@forward` configuration needs typed config entries and typed
  forward prefix/filter facts. An escaped or dynamic target cannot truthfully be
  classified as `ModuleImport` or `StyleImport` before evaluation; a deferred
  import fact and matching Jess lowering require an owner-reviewed public model.
- SCSS `@at-root` needs a core output-placement statement, not an
  `AtRuleBlock` or synthetic `Rule`. The pending candidate is
  `AtRoot { target: default | selector | filter, body }`, where filter records
  `with`/`without` plus typed names. It retains lexical binding scope while
  selecting an output-placement ancestry; no literal `@at-root` may reach CSS.
  Exact filter vocabulary and selector-anchor behavior require owner approval
  before parser or serializer work.
- Variable-held calls use `VariableCall { target: VariableReference, args:
  CallArg[] }`, replacing `DetachedCall` without an alias. The current Jess and
  Less grammar admits only their existing zero-argument spellings; the node can
  retain arguments, but grammar work must not invent their syntax. `$`/`$^`
  lookup mode remains on the `VariableReference`; named/spread wrapper-argument
  semantics are held until they are defined against a variable holding an
  already-invoked `MixinCall`.
- Non-terminal semicolonless bare Less calls are not a harmless extension of
  the existing `FunctionCall` statement fact: depending on the following
  tokens, Less treats them as a sequence of statements or as a selector prefix.
  The public direct route admits semicolon-terminated calls and one terminal
  call before a block/document boundary; it must not guess at the remaining
  forms or absorb them as raw text. Their complete grammar/eval model remains
  a later direct-parser gap.
- Jess collection access needs a typed `MemberReference` model distinct from
  Less `MapAccessor` and bare `PropertyReference`. All `$[…]` interpolation is
  semantically ambient member access—`$[foo]` variable-member, `$['foo']`
  property-member, `$[$name]` computed variable-member—but the current direct
  AST still encodes those three base-less forms separately as
  `VariableReference`, `PropertyReference`, and `VarIndirect` inside an
  `Interpolation`. The new model must consolidate those partial encodings and
  add left-associated explicit-target access: dot/declaration names,
  variable-member bracket names, property-member quoted names, zero-based
  signed indexes, and computed bracket keys remain distinct typed access forms;
  every `$`/`$^` lookup mode stays on its own `VariableReference`. This records
  syntax, not a decision to port Less:
  `MapAccessor` has one-based indexing, Less variable/property namespaces, and
  a raw-byte fallback, all invalid for Jess. Existing R7 controls dot-member
  ambiguity (the surface must yield exactly one variable/property declaration;
  multiple candidates within either kind or across kinds is an error). A terminal
  `?` converts any member-chain lookup miss to Nil; the enclosing node's ordinary
  Nil-collapse semantics decide the output. JS own-export policy and final
  node/field names require owner approval before parser or evaluator work.
  `$while` is not currently a documented Jess feature; do not
  port its legacy block-frame behavior without first defining its public
  control-flow contract.
- Jess static generic CSS opaque at-rule blocks have an existing terminal
  `OpaqueAtRuleBlock` model. The earlier claim that Parseman cannot macro-fuse
  their structural capture was wrong: imported recognition-only `scanTo` and
  `balanced` artifacts fuse correctly. The failed attempt imported CSS's terminal
  AST-builder grammar instead of a recognition-only artifact. Extract the opaque
  header/body capture into `parser-shared`, then fuse it into Jess's local
  reduction. Do not replace that work with runtime grammar composition, a
  scanner, regex recognition, or source reparse.

### Queued after public parser closure

- Parseman needs a compile-time grammar-family abstraction for the case where
  two direct productions share the same combinator structure but substitute
  different recursive entry rules. A TypeScript helper that calls `node`,
  `sequence`, or `parser` is rejected because it hides that structure from
  macro fusion (`composeLeaf() must macro-fuse; runtime composition is
  forbidden`). Jess selector capture therefore keeps its static and
  interpolation-capable selector families explicit; do not work around this
  with a host, scanner, post-parse validation, or runtime combinator factory.
  A Parseman feature must preserve first sets, recursive rule identity, and
  macro-compiled output while allowing this parameterization.
- Generate and publish a complete Parseman railroad-diagram reference for CSS,
  Less, SCSS, and Jess in the public Docusaurus site (`packages/docs`). This
  must run from each finished public grammar (including reachable rules and
  documented terminals), be regenerated in CI or an explicit docs command, and
  link from the parser-language docs. Do not generate diagrams from today's
  incomplete direct-AST grammars or present them as the language reference.
- Design dialect-to-Jess compiled conversion around opt-in observed
  compilation facts: resolved import/file provenance and actual function-call
  outcomes determine Jess-relative paths and `@-from`/`@-use` dependencies.
  See [`DIALECT-TO-JESS-COMPILED-CONVERSION.md`](../../design/DIALECT-TO-JESS-COMPILED-CONVERSION.md).
  It must not re-resolve/reparse source or replace Context/plugin dispatch.
- **Final-pass output positions / sourcemaps:** replace mutable global absolute
  cursor accounting with a `trackPositions`-only composable output-fragment
  lane. Fragments retain local node-boundary markers beside string leaves;
  charset/import hoists and adjacent-block reopening move or append fragment
  references, async values resolve their slot before flattening, and one final
  linear pass produces CSS plus public absolute offsets. Reject repeated
  partial joins/counts, offset rewriting after reorder, and per-character
  objects. Preserve the current plain `string[]` maps-off path exactly. Before
  adoption, prove byte identity plus final offsets for hoisted charset/CSS
  imports, reopened adjacent rules, empty-block rollback, async replacement,
  repeated mixin placement, and imported-document origins; measure maps-off
  regression and tracked-fragment allocation against matched baselines.

## Aggressive-cutting gate policy and standing design rules

> The ~3,300 lines of per-pass self-prosecution records that used to follow were deleted on
> 2026-07-24. Each was a per-commit evidence block already preserved in `git log`, and every
> one described work that has landed. Only the durable rules below, plus the single CURRENT
> pass block at the end of this section, survive.
>
> **How to use this section:** `scripts/verify-aggressive-cutting-review.mjs` reads the LAST
> `## Aggressive Cutting Self-Prosecution` heading in this file and requires the eleven
> labelled fields in its most recent `- Latest pass:` entry. REPLACE that block with your
> pass; do not append a new one and leave the old one behind. Historical passes belong in the
> commit message, not here.

### Gate policy

Alpha readiness uses the staged patch gate and its focused evidence, not the
historical `origin/dev..HEAD` inventory; the aggregate mode was deleted because
it had no bounded owner or remediation. Runtime cost cuts require exact
owner contracts and measurements; semantic/parser/frontend/public changes
require behavior/build/boundary evidence without fabricated performance claims.

### Queued design audit: final-pass output positions

- **This docs pass:** no runtime traversal, node, allocation, API, or metadata
  mutation was added. The queue rejects the current `Emit.off` model because
  async placeholders and output rewrites can make eagerly stored absolute
  offsets stale.
- **Required future shape:** a cold, `trackPositions`-only fragment/marker
  lane; final flattening is the sole absolute-offset calculation. The normal
  render path must remain the existing direct `string[]` emission without
  fragment objects, marker arrays, source-map work, or a second render walk.
- **Evidence requirement:** behavior tests must cover every reorder/rollback
  path and async replacement before positions become public evidence; only a
  matched benchmark/allocation comparison may claim the maps-off path remains
  neutral.

### Rejected nested Less `@media` conjunction assumption (2026-07-21)

Commit `81e2f7ffc` assumed nested singleton `@media` groups should be emitted
as sibling groups with conjoined qualifiers. The upstream Less corpus disproved
that assumption: `at-rules-bubbling`, `at-rules-targeted`, and
`extend-chaining` require the existing nested output. The implementation and
its focused expectations were reverted. Do not reintroduce renderer-side media
conjunction without a corpus-backed semantic specification that covers those
cases.

### Addendum: canonical AST source-span provenance (semantic diagnostics)

`ast/provenance.ts` is a deliberately narrow parser-to-diagnostic fact channel.
Parseman reductions attach only their exact source spans to a session-independent
`WeakMap`; normal evaluation and rendering do not read it. The serializer reads
the fact only while constructing a diagnostic, where a source offset is required
to render the correct code frame. The process-global symbol is required because
parser packages load the `@jesscss/core/ast` bundle while the compiler serializer
loads the core root bundle; those are separate bundled module identities and
must share the same parser-authored table.

- **Behavior evidence:** `ast/__tests__/provenance.test.ts` proves that the
  side table preserves node shape. The public Jess render diagnostic test and
  a built-package Compiler route both report `$[path]` at source column 13,
  proving that the parser-written span reaches root-bundle serialization.
- **Fact flow:** Parseman reduction → `withSourceSpan` → `WeakMap` →
  diagnostic-only `sourceSpanOf`; no source walk, reparse, node mutation, copy,
  or render-time collection occurs.
- **Cost/gate status:** no speed or neutrality claim. The existing `WeakMap`
  write is semantic parser work for diagnostics, and its lookup is cold error
  handling; this entry does not assert a global aggressive-cutting gate pass.

### Dialect function conversion (registration LANDED 2026-07-24; per-fn conversion continues)

The July 21 audit found 72 same-named files in `packages/fns/src/less/` and
`src/builtins/` — different implementations, not interchangeable copies.
`builtins/` was comparison evidence, never a destination architecture, and it is
now DELETED: each converted value-domain implementation was collapsed into its
dialect owner in `less/`, replacing the legacy twin, and registration DERIVES
from the composed dialect index rather than a hand-maintained assembly array.
Each dialect registers only its own index — no merged registry, no cross-dialect
fallback. That closed the live correctness bug in which `.scss` was served
Less's built-ins.

The remaining queue is behavior-complete conversion of the still-legacy modules
in the existing dialect-owned files (`shared/`, `less/`, and `sass/`): port one
small function in place to an AST-v2 `Fn` and prove parity. Adding it to the
dialect index is what registers it. No wrapper, alias, reduced behavior, or
permanent legacy holdout is permitted.
Relative color is a separate first semantic batch: direct AST retains its
structured clause, but full `calc(r + 40)` needs a typed call-level channel
evaluation design before a behavior-preserving port.

The public-entrypoint cutover is DONE: `packages/fns/src/index.ts` exposes the
dialect namespaces plus the registry helpers, `less/index.ts` and `sass/index.ts`
are the composed dialect indexes (own folder + the `shared/` entries that dialect
has), and `builtins.ts` is deleted. The corresponding tree-based tests (`Context`, `callWithContext`,
tree constructors, and `instanceof` assertions) must move to typed direct-call
or compiler-route tests; their byte/output expectations remain oracle evidence.
The package wildcard export means legacy subpaths also need an intentional public
export cutover, rather than disappearing by accident. This is active work, not a
completion claim.

**Settled F5 relative-color and fallback boundary:** CSS-shaped literal
`rgb`/`rgba`/`hsl`/`hsla` calls with three or more argument slots are
un-operated bare Calls: they emit authored bytes and are not invoked unless a
consumer demands their value (an enclosing operation or a Less/variable
argument is such demand). Modern space/slash and relative syntax uses a nested
structured slot and follows the same arity rule. Less's one-/two-slot overloads
are not part of this lazy boundary: they dispatch through the selected Less
callable, so recognized forms such as `rgba(#5F59)` canonicalize and malformed
numeric arities reach the normal call-level `functionMode` policy. Therefore
unsupported relative-color syntax does not throw while its CSS-shaped Call
remains un-operated. On demand, the selected implementation may reject; the
evaluator's existing `functionMode` policy—not an individual function—then
decides whether to preserve the authored call or propagate the error. A
function must never manufacture a fallback call node. Preserve this F5 demand
gate when the builtin registry moves out of `builtins/`; it is distinct from
lazy parameters and from `functionMode`. No broad relative-color port is
approved by this statement.

**Settled callable capability boundary:** direct callable invocation supports
typed positional values plus typed named-record assignment (including mixed
calls) for Sass and Jess. The evaluator/registry route continues to pass a
typed positional `List`; Less is positional-only for the current alpha and may
add hybrid records later only with an explicit Less syntax/evaluator decision.
This is a callable capability boundary, not a claim that every dialect parser
accepts named arguments.

**Settled typed-list ownership and callable shape:** list recovery and numeric
indexed access are core Jess value capabilities, not Less-owned helpers. Core
owns exact separator/bracket-aware value structure, zero-based value access, and
the universal `defineFunction`/`Fn` callable contract. Core does not normalize
indices or impose one-based language semantics.
Less, Sass, and future libraries register that same callable shape and provide
declared semantic policy data (for example unit compatibility,
bracketedness/separator defaults, rounding, or map behavior); they do not get
separate function APIs or helper contracts. The AST-v2 cutover therefore audits
and ports Sass list functions too; the legacy Sass list APIs are not a protected
exception or a reason to retain legacy tree values. Every remaining legacy list
dependency must either be replaced with the core capability or be explicitly
shown to encode declared policy data rather than a second runtime model.

**Value-list separator invariant:** a semicolon is a statement/declaration
delimiter, not an AST-v2 value-list separator. When syntax places a semicolon
between values outside the rules level, the parser reduction lowers it to the
canonical comma-separated `List` fact. The typed value model therefore carries
only explicit comma/slash `List` boundaries; raw recursive arrays carry
ordinary space adjacency, and no semicolon or undecided separator fact exists.

**Value-list index invariant:** core JS access is zero-based and does no numeric
normalization. Less `extract` and Sass `list.nth`/`set-nth` each implement their
own one-based conversion, truncation/flooring, non-finite, negative, and bounds
rules inside the universal callable contract. A shared core accessor must not
silently choose one language’s policy.

## Collapsed nesting source-order invariant

When nesting collapses, the renderer emits nested rules in authored source
order. A parent declaration after a nested rule belongs after that collapsed
child, in a later parent block. Regrouping it ahead of the child to coalesce the
parent selector is a semantic bug because it changes CSS cascade order.

| Case | Authored order | Prior Jess / historical Less 4 output | Intended authoritative output | Reason |
| --- | --- | --- | --- | --- |
| `property-accessors` `.block_2` | `color: red; .two { … }; color: blue;` | One `.block_2` block with `red` and `blue`, then `.block_2 .two`. | `.block_2(red)`, then `.block_2 .two`, then `.block_2(blue)`. | The later `color` must not cross the child selector; the corrected Less-alpha golden is the source-order oracle. |
| `mixins-important` `.class` | Each `.mixin(n)` expands `border/boxer; .inner { test }; border-width`. | All parent `.class` declarations grouped first, followed by all `.class .inner` rules. | Alternating parent-leading block, `.class .inner`, parent-trailing block for every expansion. | Mixin expansion is authored body order; regrouping across `.inner` changes cascade order. Less 4 is comparison evidence only. |

The direct core regression is `rule-placement-direct-acceptance.test.ts`:
`before; .child { inside }; after;` must emit parent-before, child, parent-after.
The linked Less test-data fixtures are the public regression surface. No
collapsed-nesting output may select a smaller selector grouping over this
invariant.

### Imported callable namespace continuation

An executed import records its direct `MixinDef` and `Rule` facts in a new,
source-ordered render-frame callable stream. Namespaced path descent consumes
that stream, while ordinary bare-call lookup continues to use the frame's
existing mixin index. This lets an imported namespace contribution and a later
local namespace contribution both participate in a typed call-result accessor
such as `#theme.dark.navbar.colors()` followed by `@theme-colors[secondary]`;
the selected member retains the call-level `!important` fact. No import
resolver, parser replay, source reconstruction, or compatibility path is
involved.

## Archived Aggressive Cutting Self-Prosecution

- Latest pass: scoped-caret parser syntax slice on 2026-07-29. Jess source now
  spells scoped/final variable lookup as `$^foo`, with expression-only `^foo`
  for Less math lowering. SCSS math remains `$($foo + 1)` because SCSS `$foo`
  is the variable token and avoids declaration-lookup ambiguity.
- Architecture surface: changed intentionally at the parser syntax and
  documentation boundary. The only core runtime edit is the undefined
  scoped-variable diagnostic text, replacing the retired `$$foo` spelling with
  `$^foo`.
- Separation/duplication: reduced by removing the old `$$` fallback language
  from conversion and public docs. Less conversion now has one canonical scoped
  read spelling; SCSS keeps its separate variable spelling.
- Cumulative node weight: unchanged. No AST node type, CST label family,
  materialization route, render wrapper, parser replay, or runtime dispatch host
  was added.
- New traversal: none.
- New node/materialization: none. The changed `ReferenceError` line is an
  existing exceptional failure site and does not create a new node, copied rule,
  wrapper `Rules`, side table, source metadata mutation, or render materialized
  array.
- Render path: unchanged for successful renders. The diagnostic-only string
  update changes the spelling reported for an undefined scoped variable from
  retired `$$foo` to `$^foo`.
- Helper/API surface: one grammar atom was added for expression-only `^foo`;
  no exported API, helper layer, parser host, or runtime resolver fallback was
  added.
- Metadata mutations: none.
- Behavior evidence: `pnpm --filter @jesscss/jess-parser test --
  ast-grammar.test.ts -t "live/scoped|arithmetic expression-only|calls
  as|declaration-member"` passed; `pnpm --filter @jesscss/jess-parser test --
  cst-public.test.ts` passed; `pnpm --filter jess test --
  conversion-construct-support.test.ts` passed; the registered
  `ast-semantic-runtime-cutover` behavior command passed 128/128 tests.
- Build evidence: `pnpm --filter @jesscss/jess-parser build`, `pnpm --filter
  @jesscss/core build`, `pnpm --filter @jesscss/awaitable-pipe build`, and
  `pnpm --filter @jesscss/fns build` passed in dependency order.
- Boundary evidence: public docs now describe `$foo` as live/current, `$^foo`
  as scoped/final, `^foo` as expression-only, Less `@foo + 1` lowering as
  `$(^foo + 1)`, and SCSS `$foo + 1` lowering as `$($foo + 1)`.
- Evidence: behavior, build, macro, compose-integrity, and aggressive-cutting
  contract evidence is recorded in the bullets and JSON audit record in this
  latest pass.
- Verdict: accepted. This is a parser/source-spelling correction with no
  performance claim and no added successful render/eval hot-path machinery.
- Review-flagged diff tokens: [node construction] the current diff touches an
  existing exceptional `ReferenceError` allocation only to correct its diagnostic
  spelling from retired `$$foo` to `$^foo`; this is not routine control flow,
  not a new allocation site, and not a successful render/eval path.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "This slice changes a serializer diagnostic spelling that belongs to the coordinated AST-v2 runtime owner, but it does not claim a neutral refactor, cost cut, or speed result. The semantic point is source spelling correctness: undefined scoped variables should mention `$^foo`, matching the parser and docs.",
    "dangerTokensJustification": "The only danger token is [node construction] at an existing exceptional `ReferenceError` site. The change edits the error message text from retired `$$foo` to `$^foo`; it adds no traversal, allocation site, branch, render array, parser replay, or normal lookup fallback.",
    "behaviorEvidence": "`pnpm --filter @jesscss/core test -- --run src/ast/__tests__/value-define-function.test.ts src/ast/__tests__/value-list.test.ts src/ast/__tests__/plugin-direct-body-scope.test.ts src/ast/__tests__/extend-direct-acceptance.test.ts src/ast/__tests__/extend-preflight-contract.test.ts src/ast/__tests__/value-operate-units.test.ts src/tree/__tests__/declaration.test.ts src/tree/__tests__/declaration-merge.test.ts` passed 128/128.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the diagnostic spelling change.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  }
]
```

- C16 scoped-function lookup slice on 2026-07-27: AST serialize frames now keep
  `fns` as a strictly local function-family registry and add `fnScope` /
  `fnScopeVersion` only as a render-local nearest-registered-frame cache. Empty
  ordinary frames still allocate no function map; registering scoped plugin
  functions increments the render-local version and retargets that frame to
  itself so child caches cannot silently miss late parent registrations.
- New traversal for this slice: `nearestFnScope` walks parent frames only on the
  scoped-function path (`e.anyScopedFns === true`) and only until it reaches a
  cached registered function frame. That replaces repeated per-call scans across
  empty frames; it does not touch the no-plugin/built-in-only value hot path.
- New node/materialization for this slice: none. The change adds two optional
  render-frame metadata fields and one tiny cache-state interface; it creates no
  AST nodes, no copied rules, and no shared registry with variables,
  declarations, or mixins.
- Behavior evidence for this slice:
  `pnpm --filter @jesscss/core build && pnpm --filter @jesscss/fns build &&
  pnpm --filter @jesscss/core test -- src/ast/__tests__/plugin-direct-body-scope.test.ts --run --reporter=dot`
  passed 8/8 after rebuilding in dependency order. The focused test verifies
  nearest registered function caching, case-insensitive lookup, no empty-frame
  local map allocation, and cache invalidation when an intermediate parent gains
  a scoped function.
- Review evidence for this slice: `pnpm run verify:aggressive-cutting-review`
  passed. The command reports the broad active diff's existing danger-token
  inventory; this slice accounts for its added parent walk and optional frame
  metadata above.
- C17 module-cache slice on 2026-07-28: `Context.getModule(...)` now mirrors
  stylesheet import and executable `@plugin` module loading by caching the
  in-flight/successful ordinary module result for the current source context,
  source plugin, authored specifier, and import type. The cache prevents a
  script/JSON module from being resolved and loaded twice during one compile
  context while preserving failure retry behavior.
- New traversal/node/materialization for this slice: none beyond the existing
  `_getPath`/plugin import work that a cache miss already performs. The added
  `Map` is `Context`-local compile-cycle state; it stores the same
  `{ module, triedPaths, resolvedPath }` result already returned to callers and
  introduces no AST node, render array, parser replay, or cross-compile global
  registry.
- Behavior evidence for this slice:
  `pnpm --filter @jesscss/core test -- test/context-module.test.ts --run --globals --reporter=dot`
  passed 9/9, including a regression that proves two calls for the same script
  module return the same result object after one resolver pass, one lazy script
  importer load, and one module import. `pnpm --filter @jesscss/core test --
  src/ast/__tests__/import-at-rule.test.ts --run --globals --reporter=dot`
  passed 37/37, preserving executable `@plugin` module cache behavior.
- Review/build evidence for this slice: `pnpm --filter @jesscss/core build`,
  `pnpm run verify:aggressive-cutting-review`, `pnpm run verify:less-alpha`,
  `pnpm run check:macro`, and `pnpm run verify:compose-integrity` passed. No
  measured performance claim is made.
- Latest pass: AST extend IR naming normalization on 2026-07-29.
- Architecture surface: private extend-solver IR naming changed intentionally.
  The existing lowered selector facts are now spelled `SelectorPart`,
  `segments`, `combinator`, and `Compound.value`. The public canonical selector
  AST remains the flat selector-term/combinator sequence; the lowered
  `{ combinator, compound }` shape stays private to the extend matcher and is
  not a visitor or parser-output precedent.
- Separation/duplication: improved slightly. The private IR no longer carries
  separate shorthand vocabulary (`Seg`/`segs`/`comb`/`simples`) that conflicts
  with the canonical AST naming rules. The exported `ComplexSelectorPart` alias
  is gone; public AST types speak directly in `SelectorTerm | Combinator`.
- Cumulative node weight: neutral. No AST node, selector wrapper, side table,
  runtime validator, or compatibility alias was added or removed.
- New traversal: none. Existing extend loops were renamed in place; no planner
  pass, matcher pass, selector scan, parser replay, or diagnostics crawl was
  added.
- New node/materialization: none. Existing arrays, spreads, and object literals
  in the extend solver retain their current ownership and are only renamed.
- Render path: unchanged. The serializer still constructs the same private
  extend IR after selector interpolation and emits the same CSS; no output
  policy or fallback path changed.
- Helper/API surface: no public helper was added. The public
  `ComplexSelectorPart` alias was removed from the AST barrel surface; the
  remaining `SelectorPart` type is private to `ast/extend`.
- Metadata mutations: none. Existing `key` and `bnd` provenance fields keep
  their behavior; this pass adds no parent/source/frozen/trivia mutation.
- Behavior evidence: `pnpm --filter @jesscss/core test -- --run src/ast`
  passed 38/38 files and 342/342 tests after the rename.
- Build evidence: `pnpm --filter @jesscss/core build` passed after the final
  public-alias cleanup; `pnpm run verify:types` passed 25/25 configs.
- Boundary evidence: `pnpm run verify:types` proved removing the exported
  `ComplexSelectorPart` alias does not break workspace consumers; the public
  AST shape remains inline `SelectorTerm | Combinator`.
- Evidence: behavior, build, type, and boundary evidence are listed above. No
  measured performance claim is made.
- Review-flagged diff tokens: [loop/traversal], [array helper], [array
  spread/materialization], and [materialized array/object] are existing extend
  solver loops/arrays/objects renamed in place; no new loop, allocation family,
  spread path, or materialized selector wrapper was introduced.
- Verdict: accepted as a neutral private naming cleanup with no speed claim and
  no canonical AST shape change.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "This pass changes naming inside the existing AST-v2 extend owner rather than introducing a new optimization boundary. The private solver still performs the same composition, matching, interpolation resolution, and fixpoint solve work; the patch removes misleading public/internal names without claiming cost neutrality or speed.",
    "dangerTokensJustification": "The flagged loops, maps, spreads, arrays, and object literals are existing extend solver work with renamed fields/types. No planner pass, matcher pass, selector traversal, allocation family, render policy, public selector wrapper, or runtime validation was added.",
    "behaviorEvidence": "pnpm --filter @jesscss/core test -- --run src/ast passed 38 files / 342 tests.",
    "buildEvidence": "pnpm --filter @jesscss/core build passed after the final public-alias cleanup; pnpm run verify:types passed 25/25 configs.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": [
      "Context-plugin-source-parser-dispatch",
      "emit-walk-context-output-option",
      "Ruleset-interpolated-selector-boundary",
      "selector-match-string-and-node-combinators",
      "extend-index-tagged-graft-atoms",
      "Sequence-subclass-preserving-evaluation",
      "callable-output-root-property-guard",
      "serializer-at-rule-and-selector-surface"
    ],
    "why": "This slice relocates generic helper imports used by Context and extend-index to their new core util paths. The Context/plugin dispatcher, extend-index tagged IR behavior, selector matching, callable output, and serializer contracts are unchanged; this is ownership cleanup without a speed or semantic expansion claim.",
    "dangerTokensJustification": "The diff rewrites import specifiers and moves existing helper modules. It adds no parser host, alternate evaluator, resolver, output policy, AST materialization route, render-output array path, traversal, or runtime validation.",
    "behaviorEvidence": "Focused bitset and dimension behavior passed: `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run` (61/61).",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the helper relocation.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "cases": [
      "declaration-sync-and-async-render-result",
      "declaration-merge-source-span-exclusion",
      "default-guard-owned-value",
      "bitset-inversion-and-disjointness",
      "string-and-node-combinator-recognition",
      "selector-list-singleton-collapse",
      "selector-list-array-or-node-inheritance",
      "parser-delivered-selector-array-ampersand",
      "selector-array-ruleset-callable-registration",
      "selector-array-key-set-analysis",
      "selector-compose-cache-node-boundary",
      "ordered-registration-context-restoration",
      "property-merge-container-scope",
      "mixin-invisible-sync-render-and-registration-result",
      "extend-record-selector-surface",
      "extend-root-composition-selector-surface",
      "extend-walk-composed-match-selector-surface"
    ],
    "why": "This slice relocates the generic bitset and numeric operator helpers from legacy tree util paths to core util paths, then repoints their existing legacy tree consumers. The helper behavior and selector/extend contracts are unchanged; this is ownership cleanup for the retained legacy-tree drain, not a speed, neutrality, or semantic expansion claim.",
    "dangerTokensJustification": "The diff moves existing helper modules and rewrites import specifiers. It adds no traversal, no object allocation, no parser replay, no materialization cache, no selector matching branch, no output policy, and no new runtime validation.",
    "behaviorEvidence": "Focused bitset and dimension behavior passed: `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run` (61/61).",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the helper relocation.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-visitor-abi-removal",
    "verdict": "accepted",
    "costDelta": "neutral",
    "why": "This import-only slice touches `node-base.ts` solely because its `Operator` type import now points at the core util helper. It does not restore or alter the removed visitor ABI, add a dispatch method, allocate a facade, or change node behavior.",
    "byteIdentity": {
      "fixture": "benchmark.less",
      "collapseNesting": true,
      "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6",
      "outputBytes": 122390
    }
  },
  {
    "id": "bounded-core-tree-lint-guards",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the five bounded core tree helper owners listed by bounded-core-tree-lint-guards",
    "cases": [
      "List raw NodeArrayItem normalization",
      "canonical node-array prefix guard",
      "root node validation narrowing",
      "callable candidate record narrowing",
      "extend helper lint-safe syntax"
    ],
    "why": "This slice changes `List` only to import the shared `Operator` type from its new core util path. The List normalization and validation behavior named by the bounded lint-guard contract is untouched; this is a dependency-path cleanup, not a performance or semantic behavior change.",
    "dangerTokensJustification": "The touched List hunk is an import-specifier rewrite. It adds no branch, traversal, allocation, validation helper, parser replay, or render path.",
    "behaviorEvidence": "Focused dimension operator coverage passed as part of `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run`.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the import rewrite.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  }
]
```
- Latest pass: Less alpha parser/error integration state on 2026-07-27. The working diff includes
  the one-grammar parser fold, Parseman 0.41 grammar cleanup, parser-owned diagnostics, trivia
  extraction work, and the recursive reference error fix that graduated the Less recursion fixtures
  out of the worker-hang skip list.
- Architecture surface: changed intentionally. CSS/Less/SCSS/Jess parser packages now build AST and
  CST from one host-mode grammar source; Less parser owns parse diagnostic facts; the Less plugin
  forwards parser diagnostics as a thin wrapper; core eval now reports recursive variable/property
  references through the normalized Jess error surface.
- Separation/duplication: reduced. The duplicate `src/ast/grammar.ts` files are deleted; dialect
  plugins should not duplicate parser error normalization; comments are treated as trivia facts
  rather than value/comment AST children in the active Less cleanup lane.
- Cumulative node weight: reduced in parser source by the eight-to-four grammar fold and ordinary
  value-comment removal. The recursive-reference patch adds no AST node type or persistent runtime
  field; it adds one diagnostic code/factory and cold structural checks for recursive reference
  failures.
- New traversal: bounded and cold. Recursive variable/property detection only walks frame stacks
  after a normal lookup miss, plus a declaration-activation structural value walk for same-name
  direct references with no earlier fallback. Grammar/trivia walks are parser/source-boundary work,
  not render-tree rescans.
- New node/materialization: no runtime AST materialization is added by the recursive-reference fix.
  Parser grammar changes intentionally remove duplicated grammar files and ordinary comment value
  nodes; generated parser artifacts and tests account for parser package materialization separately.
- Render path: changed for error quality only. Recursive `@var`/`$prop` now throws
  `eval/recursive-reference` instead of hanging or silently accepting; successful fallback to an
  earlier binding remains allowed. No CSS byte-identity or speed claim is made here.
- Helper/API surface: public error codes/diagnostic helpers gained
  `eval/recursive-reference`; Less parser safe-parse diagnostics are parser-owned and forwarded by
  the plugin. Parseman 0.41 grammar APIs are consumed by parser packages through their package
  dependency floor.
- Metadata mutations: parser provenance/trivia metadata is intentionally source-indexed. The
  recursive-reference fix adds no parent/source mutation and reads source spans only to locate the
  thrown diagnostic.
- Behavior evidence: `pnpm --filter jess test -- test/less/reference-public-semantics.test.ts --run --globals --reporter=dot` passed 15/15, including recursive variable/property diagnostics and legal same-scope fallback references; `pnpm --filter jess test -- test/less/all-less-error.test.ts --run --globals --reporter=dot` passed 94/94 after removing the recursive-worker skip list.
- Build evidence: `pnpm --filter @jesscss/core build` passed after the recursive-reference changes; prior parser/plugin verification for this integration state includes less-parser and plugin-less builds from the active slices.
- Boundary evidence: public Jess render errors expose the normalized `eval/recursive-reference` code/phase/reason; Less plugin safe-parse forwards less-parser diagnostics rather than wrapping them with plugin-local parser classes.
- Review-flagged diff tokens: [loop/traversal] bounded frame/value walks for recursive miss detection plus parser/trivia integration loops; [array helper] parser/test/trivia helpers and value-structure probes outside render output construction; [array spread/materialization] existing diagnostic/plugin/parser object spread and test setup in the broad dirty diff; [generator] trivia range iterators in parser provenance work, not core eval recursion; [node construction] diagnostic `JessError` creation and parser/test fixtures; [parent/source mutation] diagnostic location reads and source-span/trivia plumbing, while the recursive-reference patch performs diagnostic span reads only; [side map/set] existing/provenance trivia maps plus temporary test/parser maps, while recursive-reference state stays on the existing exclusion set; [routine error control] real diagnostics and plugin/parser failure boundaries, not expected hot-path control flow; [materialized array/object] parser/test fixtures and bounded diagnostic/value traversal scratch outside persistent render materialization.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "This integration changes parser-owned facts, recursive reference diagnostics, and trivia/provenance surfaces in the coordinated AST-v2 evaluator/parser cutover. It is semantic error-quality and grammar consolidation work, so the record makes no neutrality, speed, or cost-cutting claim.",
    "dangerTokensJustification": "The flagged loops, maps, spreads, throws, and arrays belong to bounded parser/trivia integration, diagnostic construction, or cold recursive-miss checks. The recursive-reference path runs after a failed normal lookup or during declaration activation validation, and successful render references keep the existing resolver path.",
    "behaviorEvidence": "Focused public reference semantics passed 15/15 and Less error corpus passed 94/94 with recursive-variable/property fixtures unskipped.",
    "buildEvidence": "pnpm --filter @jesscss/core build passed after the recursive-reference changes.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": [
      "Context-plugin-source-parser-dispatch",
      "emit-walk-context-output-option",
      "Ruleset-interpolated-selector-boundary",
      "selector-match-string-and-node-combinators",
      "extend-index-tagged-graft-atoms",
      "Sequence-subclass-preserving-evaluation",
      "callable-output-root-property-guard",
      "serializer-at-rule-and-selector-surface"
    ],
    "why": "This slice changes the Context/evaluator ownership boundary so dialect plugins register their immutable evaluator through Context instead of callers mutating a public evaluator field. It is semantic ownership and package-surface cleanup, not an optimization or neutrality claim.",
    "dangerTokensJustification": "The flagged Context/plugin/serializer tokens are API-boundary and diagnostic/runtime integration work: Context stores one private evaluator reference, serialize reads that accessor, and plugin setContext methods register the dialect evaluator. It adds no parser host, alternate evaluator, resolver, output policy, AST materialization route, or render-output array path.",
    "behaviorEvidence": "The focused semantic-runtime command `pnpm --filter @jesscss/core test -- --run` passed: 203 files, 3219 tests, 9 skipped, 2 todo. Plugin-level evaluator registration was separately exercised by plugin Less/SCSS tests and verify:less-alpha in the active Less facade slice.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the Context evaluator registration change.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the fifteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, and extend owners listed by legacy-tree-strict-contract-drain",
    "cases": [
      "declaration-sync-and-async-render-result",
      "declaration-merge-source-span-exclusion",
      "default-guard-owned-value",
      "bitset-inversion-and-disjointness",
      "string-and-node-combinator-recognition",
      "selector-list-singleton-collapse",
      "selector-list-array-or-node-inheritance",
      "parser-delivered-selector-array-ampersand",
      "selector-array-ruleset-callable-registration",
      "selector-array-key-set-analysis",
      "selector-compose-cache-node-boundary",
      "ordered-registration-context-restoration",
      "property-merge-container-scope",
      "mixin-invisible-sync-render-and-registration-result",
      "extend-record-selector-surface",
      "extend-root-composition-selector-surface",
      "extend-walk-composed-match-selector-surface"
    ],
    "why": "This slice relocates the generic bitset and numeric operator helpers from legacy tree util paths to core util paths, then repoints their existing legacy tree consumers. The helper behavior and selector/extend contracts are unchanged; this is ownership cleanup for the retained legacy-tree drain, not a speed, neutrality, or semantic expansion claim.",
    "dangerTokensJustification": "The diff moves existing helper modules and rewrites import specifiers. It adds no traversal, no object allocation, no parser replay, no materialization cache, no selector matching branch, no output policy, and no new runtime validation.",
    "behaviorEvidence": "Focused bitset and dimension behavior passed: `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run` (61/61).",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the helper relocation.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "legacy-tree-visitor-abi-removal",
    "verdict": "accepted",
    "costDelta": "neutral",
    "why": "This import-only slice touches `node-base.ts` solely because its `Operator` type import now points at the core util helper. It does not restore or alter the removed visitor ABI, add a dispatch method, allocate a facade, or change node behavior.",
    "byteIdentity": {
      "fixture": "benchmark.less",
      "collapseNesting": true,
      "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6",
      "outputBytes": 122390
    }
  },
  {
    "id": "bounded-core-tree-lint-guards",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the five bounded core tree helper owners listed by bounded-core-tree-lint-guards",
    "cases": [
      "List raw NodeArrayItem normalization",
      "canonical node-array prefix guard",
      "root node validation narrowing",
      "callable candidate record narrowing",
      "extend helper lint-safe syntax"
    ],
    "why": "This slice changes `List` only to import the shared `Operator` type from its new core util path. The List normalization and validation behavior named by the bounded lint-guard contract is untouched; this is a dependency-path cleanup, not a performance or semantic behavior change.",
    "dangerTokensJustification": "The touched List hunk is an import-specifier rewrite. It adds no branch, traversal, allocation, validation helper, parser replay, or render path.",
    "behaviorEvidence": "Focused dimension operator coverage passed as part of `pnpm --filter @jesscss/core test bitset.test.ts bitset-disjoint.test.ts dimension.test.ts -- --run`.",
    "buildEvidence": "`pnpm --filter @jesscss/core build` passed after the import rewrite.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "ast-value-guard-equality-modes",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": [
      "less-unitless-dimension",
      "sass-quoted-keyword",
      "exact-structural-distinction"
    ],
    "why": "This slice settles on the existing Jess `Any` name for Less e() raw-byte results. The value-domain shape is `Any.bytes`; parsed AST opaque leaves remain `Any.src`. The equality branch lets raw Any bytes participate in the same emitted-byte comparison path as escaped string bytes. It is semantic value-domain correctness, not an optimization or cost-neutrality claim.",
    "dangerTokensJustification": "The flagged diagnostic object spreads are existing error-construction shape inside root call rejection, not new normal successful render allocation. The equality branch adds one scalar type check to an already mode-gated comparison path and introduces no collection, traversal, parser replay, or node materialization loop.",
    "behaviorEvidence": "Focused e() and Less public error tests passed, including root e() output and plugin scalar root-call rejection without eval/async-in-sync-position.",
    "buildEvidence": "pnpm --filter @jesscss/core build, pnpm --filter @jesscss/fns build, and pnpm run verify:less-alpha passed after the Any value-domain change.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "ast-value-guard-negate-result",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": [
      "incomparable-remains-undefined",
      "negative-and-positive-reverse",
      "equality-remains-zero"
    ],
    "why": "This slice removes the old internal value-object alias spelling in favor of `Value`. The guard negation logic is unchanged; the touched file still owns the same closed comparison-result inversion contract.",
    "dangerTokensJustification": "The diff changes type annotations and comments only in this area. It adds no comparison branch, traversal, allocation, parser replay, or materialization path.",
    "behaviorEvidence": "Focused value tests passed: `pnpm --filter @jesscss/core test -- value-define-function.test.ts value-operate-compare.test.ts value-operate-units.test.ts --run` (25/25).",
    "buildEvidence": "`pnpm --filter @jesscss/core build`, `pnpm --filter @jesscss/fns build`, and `pnpm run verify:types` passed after the alias removal.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  },
  {
    "id": "ast-value-operate-preserve-calc",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": [
      "preserve-percentage-product",
      "loose-percentage-product",
      "explicit-calc-composition"
    ],
    "why": "This slice removes the old internal value-object alias spelling in favor of `Value`. The preserve-mode calc arithmetic policy is unchanged; the touched file still owns the same semantic result-construction boundary.",
    "dangerTokensJustification": "The diff changes type annotations and comments only in this area. It adds no arithmetic branch, traversal, allocation, parser replay, or materialization path.",
    "behaviorEvidence": "Focused value tests passed: `pnpm --filter @jesscss/core test -- value-define-function.test.ts value-operate-compare.test.ts value-operate-units.test.ts --run` (25/25).",
    "buildEvidence": "`pnpm --filter @jesscss/core build`, `pnpm --filter @jesscss/fns build`, and `pnpm run verify:types` passed after the alias removal.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 44.031520500000056,
      "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781",
      "outputBytes": 122534
    }
  }
]
```
- Evidence: `pnpm --filter @jesscss/core build` — GREEN; `pnpm --filter @jesscss/core test -- --run` — GREEN, 203 files / 3219 tests / 9 skipped / 2 todo; `pnpm --filter jess test -- test/less/reference-public-semantics.test.ts --run --globals --reporter=dot` — GREEN, 15/15; `pnpm --filter jess test -- test/less/all-less-error.test.ts --run --globals --reporter=dot` — GREEN, 94/94. No performance claim is made or implied.
- Verdict: accepted as semantic parser/error-quality integration evidence for the current dirty
  worktree; still requires slice commits and normal parser macro/compose/oracle gates before merge.

## Aggressive Cutting Self-Prosecution

- Latest pass: 2026-09-03 V19 slice 4 shared container evaluation. This folds ruleset
  guards and extend-hoist placement, at-rule prelude evaluation and activation, and
  stylesheet-import execution into shared evaluator entries while retaining the two
  existing streaming writers; it makes no speed claim.
- Architecture surface: `serialize.ts` rulesets, block at-rules, stylesheet imports,
  ordinary rule activation frames, nested extend hoist queues, and the collapsed/nested
  writer boundary. Parser grammar, canonical node schemas, public package APIs, selector
  composition policy, at-rule bubbling policy, and output-option ownership are unchanged.
- Separation/duplication: `expandRule`, `expandAtRuleBlock`, and `expandStyleImport` are
  the projection-neutral entries. `emitNestedRule`, `emitNestedRuleGuarded`, and
  `emitNestedAtRuleBlock` are deleted. `activateRuleFrame` creates/reuses the ordinary
  ruleset activation for either writer. The nested writer receives evaluator-issued
  hoists; the collapsed writer retains composition, bubbling, and partition policy.
- Cumulative node weight: canonical AST/CST nodes, `Frame`, `EvalCtx`, `Emit`, and
  `BindingCell` gain zero fields. Static `Map` constructions fall 57 to 56; `Set` and
  `WeakMap` stay 34 and 5. All transient facts remain on existing short-lived `Frame`,
  `Emit`, placement-map, and writer-local queue lifetimes. No new context field, identity
  table, or parallel state model is introduced; `WeakMap` remains a last resort, unused
  by this fold.
- New traversal: no AST/source traversal. The shared entries evaluate the existing rule
  guard, at-rule prelude, and import request once. Nested hoisting performs one existing
  projection-plan lookup and one queue append per crossing source rule. N=8 and N=16
  produce exactly 8 and 16 `astExtend.emit.nestedHoistPlacements`; a disposable
  per-subject rescan raised N=8 to 72 and failed the operation-budget test.
- New node/materialization: zero AST/CST nodes, retained evaluated trees, projection
  wrappers, new group arrays, Maps, Sets, WeakMaps, or per-entry event objects. Sharing
  ordinary ruleset and at-rule activation removes two statically authored `Frame`
  construction sites, 27 to 25.
- Render path: both projections still stream into `Emit.chunks`. Ruleset guard and hoist
  decisions precede a direct writer call; at-rule prelude resolution and body-frame
  creation precede a direct resolved-writer call. `walkBody` retains collapsed layout;
  `emitNestedBody` retains authored nesting and consumes the same evaluated entries.
- Helper/API surface: private serializer machinery only. Named functions fall 417 to
  415, raw arrow sites 579 to 577, `mapMaybe` sites 126 to 124, and `.then` stays 105.
  The entries use fixed positional arguments to avoid a projection carrier, callback
  adapter, closure, retained event list, or helper-call ladder.
- Metadata mutations: only existing render-local placement state mutates. Rule activation
  is recorded in `Frame.rulePlacements`; import facts retain their existing frame/source-
  order publication; nested hoists append to the already-owned writer queue. Canonical
  source nodes, public results, parser trivia, and shared source facts remain immutable.
- Review-flagged diff tokens: [conditional writer] direct branches select the existing
  writers after shared evaluation; [positional parameters] existing writer facts are
  passed without a carrier allocation; [loop/traversal] no new production loop and the
  N/2N hoist counter is exactly linear; [side map] one `Map` construction is removed and
  no Map, Set, WeakMap, Frame field, or context table is added; [routine error control]
  no Error allocation or exception is added for ordinary control flow; [source scan/
  reparse] none.
- Behavior evidence: focused container/import/extend tests pass 88/88. Exact both-mode
  diagnostic positions include an at-rule prelude lookup at line 1, column 20; a
  disposable one-byte source-span shift changed both projections to column 21 and failed
  the test. Existing selector composition, ampersand, bubbling, import barrier/order,
  reference visibility, block-comment, property-accessor, async continuation, and plugin
  scope tests remain green. The source ratchet rejects restored nested container/import
  evaluators, an extra collapse read, or helper/collection growth.
- Build evidence: dependency-ordered `pnpm run build:release` passes. Root core passes
  200 files / 3,199 tests / 8 skipped / 2 todo. Jess ratchet passes 1,425 tests with zero
  current, gating-baseline, or flaky-baseline failures; normal all-less passes 112/112.
  The forced-collapse before/after manifests contain the same 111 named records and are
  byte-identical with SHA-256
  `ab837140229078bfd56a5ab47fe07dc26ceaf34b339f68e8adab67da4ec5499c`.
  Selected both-mode/property suites pass 74/74. Dependents pass plugin-less 14/14,
  fns 718/718, and plugin-scss 2/2. Guardrails, aggressive-cutting, touched-added-line
  lint, and diff-check pass. Shape stability retains the inherited result: its
  monomorphic AST and all CST assertions pass while the stale AST corpus inventory and
  `SpacedValue` allowlist checks remain red. Static counts are `serialize.ts` 16,988 to
  16,958 lines, Map 57 to 56, Set 34 to 34, WeakMap 5 to 5, Frame sites 27 to 25,
  Leaf groups 9 to 9, and evaluator-side `e.collapse` reads 2 to 1.
- Performance evidence: the standard 100-iteration x 5-round harness used Node 24.11.1
  and Less test data 5.0.0-alpha.3 at `3af87fc0` in one session. A paired late pass has
  collapsed before/after medians (ms) functions 4.112/4.344, import-reference
  6.886/6.660, mixins-guards 4.456/4.277, extend-chaining 1.114/1.065, media 1.551/1.418;
  nested 3.661/3.739, 6.456/6.279, 4.452/4.238, 1.033/1.015, 1.506/1.449. The sole
  positive collapsed delta is contradicted by an +8.3% same-commit null movement;
  nested's +2.1% functions delta is unstable. The harness cannot attribute a regression,
  so no speed or neutrality claim is made.
- Boundary evidence: no public type/export changes. Exact-head semantics and performance
  reviews must approve their complete invariant sets against this current self-
  prosecution before landing.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "SETTLED V19 makes evaluation and lookup functions of the source stylesheet, independent of nesting output. Slice 4 deletes nested-only rule guard and at-rule prelude evaluators and gives both projections shared ruleset, at-rule, import, activation-frame, and hoist-placement entries.",
    "dangerTokensJustification": "Projection choice is an allocation-free branch after shared evaluation and calls the existing writer directly. Existing Frame, Emit, placement-map, and writer-local queue lifetimes own all transient facts. No Map, Set, WeakMap, Frame field, context table, writer callback, carrier, retained event list, source scan, or reparse is added. N/2N instrumentation measured exactly one nested hoist placement per crossing source rule.",
    "behaviorEvidence": "Focused container/import/extend suites pass 88/88. Both-mode at-rule diagnostic positions and nested-hoist N/2N budgets have demonstrated negative controls; the source ratchet rejects restored nested evaluators, an extra collapse read, or helper/collection growth.",
    "buildEvidence": "Dependency-order build passes. Core passes 3199 tests; Jess ratchet passes 1425 with empty current/gating/flaky failure sets; all-less passes 112/112; the 111-record forced-collapse manifests are byte-identical; selected both-mode Jess tests pass 74/74; dependents pass 14/14, 718/718, and 2/2. Guardrails, aggressive-cutting, touched-added-line lint, and diff-check pass. Shape stability retains the inherited result: monomorphic AST and all CST assertions pass while the stale AST inventory/SpacedValue allowlist checks remain red. Static counts: lines 16988 to 16958, named functions 417 to 415, arrows 579 to 577, Map 57 to 56, Set 34 unchanged, WeakMap 5 unchanged, Frame sites 27 to 25, and collapse reads 2 to 1. Same-session hot-path timings are reported separately and carry no speed claim.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 48.22547899999972,
      "outputSha256": "2b8d9abf3c103a6de7a0a5d66b3a448bcaef8c1818eff753de52d25a23b98f7d",
      "outputBytes": 122568
    }
  }
]
```
- Verdict: accepted as the smallest V19 container evaluator fold after the current
  self-prosecution, both-mode behavior pins, deterministic linear hoist counter, and
  same-session timing evidence. Timing is explicitly inconclusive and supports no speed
  or neutrality claim.

- Previous pass: 2026-09-03 V19 slice 1 shared lookup and leaf bookkeeping. This
  is the first evaluator-fold slice and a correctness correction with no speed claim.
- Architecture surface: `serialize.ts` declaration/comment evaluation, property
  publication, callable-body trivia ownership, the existing render `Emit` context,
  focused both-mode tests, forced-corpus manifest support, and the maintained Less
  hot-path harness. Parser grammar, AST/CST schemas, public package APIs, and output
  configuration policy are unchanged.
- Separation/duplication: `evaluateLeafStatement` and `evaluateSilentStatement` now
  own facts previously repeated in the collapsed and nested dispatchers. Every Leaf
  uses the same field order; the shared evaluator constructs its Leaf directly to avoid
  an added helper rung, while writer-only sites use `evaluatedLeaf`. The two dispatchers
  remain only for later V19 slices.
- Cumulative node weight: canonical AST/CST nodes and Frames gain zero fields.
  Transient Leaves change from branch-dependent two-to-five-field shapes to one fixed
  five-field shape. Every render-local Emit gains two nullable scalar fields for the
  pending comment list and its exact `Leaf[]` owner.
- New traversal: no source or AST traversal. Three bounded positive-comment emission
  loops write the already-owned trailing comment list at document-root, direct at-rule,
  and direct bubble boundaries; each performs one iteration per emitted comment.
  Existing body walks call the shared evaluator once for each eligible
  declaration/comment. Temporary instrumentation measured N=4 as 4 evaluator visits/4
  writer callbacks, 2N=8 as 8/8, and two separate N projections as 8/8 total. A
  disposable doubled visit made the assertion fail at 4 rather than 2.
- New node/materialization: zero AST/CST nodes, retained evaluated trees, wrappers,
  group arrays, Maps, Sets, or per-entry objects. WeakMap constructions fall 7 to 6;
  the deleted comment side table and conditional Leaf clones are replaced by two
  scalar context slots that reuse existing buffer/list identities.
- Render path: both projections still stream to the canonical `Emit.chunks` buffer.
  Root, direct at-rule, bubble, collapsed, and nested flushes consume only trivia owned
  by their exact leaf buffer. Capture-only `each(.mixin())` expansion saves, clears, and
  restores the two scalars rather than allocating isolated side storage.
- Helper/API surface: private serializer helpers only. Statically named functions stay
  421 to 421 and arrow sites fall 585 to 584. A simple declaration calls
  `evaluateLeafStatement`, constructs its fixed Leaf directly, and deletes the prior
  local placement plus attachment-helper calls: net zero evaluator/writer helper rungs.
  Ordinary mixin and nested-rule placement also add zero net helper rungs.
- Metadata mutations: only the two render-local pending-trivia scalars mutate. Canonical
  source nodes, Frames, source ownership, parser trivia, and public results are untouched.
- Review-flagged diff tokens: [side map] the per-buffer WeakMap is deleted; [object shape]
  Leaf becomes one monomorphic five-field shape and Emit gains two fixed nullable slots;
  [array/materialization] existing active `Leaf[]` and trivia-owned comment arrays are
  reused; [loop/traversal] three positive-comment loops consume only the already-owned
  list, once per emitted comment, with no source or AST scan; [helper-call] zero net rungs
  for a declaration, ordinary mixin, and nested-rule placement; [routine error control]
  `forItemsFromMixinCall` catches only an exceptional synchronous expansion failure to
  restore outer transient ownership, while success, misses, and async success remain on
  their direct existing paths; [source scan/reparse] none.
- Evidence: focused property/comment/trivia review passes 25/25; the expanded both-mode
  selection passes 66 with 5 todo; normal all-less passes 112/112; forced-collapse
  before/after manifests have 111 records and identical SHA-256
  `ab837140229078bfd56a5ab47fe07dc26ceaf34b339f68e8adab67da4ec5499c` with zero
  changed names. Jess ratchet passes 1,421 tests with zero current, gating-baseline, or
  flaky-baseline failures. Dependents pass plugin-less 14/14, fns 718/718, and
  plugin-scss 2/2.
- Behavior evidence: both modes now publish the same declaration/property facts and
  retain callable trivia at nested, root, and at-rule buffer boundaries. Two focused
  comment-only cases intentionally correct collapsed output that previously dropped the
  comment; the maintained forced-collapse corpus remains byte-identical. Capture-only
  iterable trivia remains discarded and cannot leak into the caller. A disposable
  removal of the shared property-publication calls made all four focused accessor cases
  fail in both modes and changed the forced-corpus `functions`, `property-accessors`, and
  `property-targeted` records; restoring the calls returned those gates to green.
- Build evidence: dependency-ordered `pnpm run build:release` and the final core build
  pass. The required root `npx vitest run packages/core` gate is green: 199 files
  passed / 1 skipped and 3,189 tests passed / 9 skipped / 2 todo. The package-local
  full core run is also green: 209 files and 3,253 tests passed / 8 skipped / 2 todo.
  Static counts are `serialize.ts` 17,013 to 17,089 lines, Map 58 to 58, Set 34 to 34,
  WeakMap 7 to 6, Leaf-group sites 9 to 9, conditional Leaf spreads 5 to 0, and
  evaluator-side `e.collapse` reads 2 to 2 for this first slice. A disposable seventh
  `new WeakMap` made the source ratchet fail at 7 versus 6 before it was removed.
- Boundary evidence: no public type/export changes. Semantics review approves all eight
  invariants under SETTLED V19 and G28. Performance review approves invariants 1-11 and
  incidents R1-R8 structurally after owner-lifetime and corpus-provenance findings were
  fixed; final approval is tied to this evidence block and the aggressive-cutting gate.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "SETTLED V19 makes evaluation and lookup functions of the source stylesheet, independent of nesting output. Slice 1 centralizes leaf facts and trivia ownership while retaining the existing streaming spine and two writers.",
    "dangerTokensJustification": "One fixed Leaf field order and two fixed Emit scalars replace five conditional field spreads, a WeakMap side table, its eight operations, and comment-associated Leaf cloning. The shared evaluator constructs its Leaf directly, leaving declaration, mixin, and nested-rule placement at zero net added helper rungs. N/2N probes measured exactly one evaluator visit and writer callback per eligible statement. The only new try/catch restores transient state after a real exceptional synchronous failure.",
    "behaviorEvidence": "Focused both-mode tests, full core, Jess ratchet, normal all-less, and dependent suites pass. The forced-collapse 111-record manifest is byte-identical before/after; two focused collapsed comment omissions are intentionally corrected outside that corpus.",
    "buildEvidence": "Dependency-ordered build:release passes. Static counts are named functions 421 unchanged, arrows 585 to 584, Map 58 unchanged, Set 34 unchanged, WeakMap 7 to 6, groups 9 unchanged, and conditional Leaf spreads 5 to 0. Same-session Node 24.11.1 hot-path timings are inconclusive: same-commit null drift reaches -19.9%/+9.5%; a disposable shared-evaluator control moves functions from 4.33/4.13 ms to 18.34/18.19 ms in collapsed/nested modes.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 47.37,
      "outputSha256": "2b8d9abf3c103a6de7a0a5d66b3a448bcaef8c1818eff753de52d25a23b98f7d",
      "outputBytes": 122568
    }
  }
]
```
- Verdict: accepted as the smallest V19 leaf/fact fold after the owner-tag lifetime,
  exceptional restore, and benchmark corpus-provenance findings were addressed. No
  speed or neutrality claim is made; timing remains explicitly inconclusive.

- Previous pass: 2026-08-26 document-root static import fact publication under
  OPEN N10. This is a Less compatibility correction with no speed claim.
- Architecture surface: the existing AST-v2 static import planner and lexical
  import emitter in `serialize.ts`, the opaque `PreparedImports` token, focused
  import tests, the N10 ledger row, and Less corpus classification. Grammar,
  parser artifacts, AST/CST schemas, Context resolution, canonical output
  buffers, and owner-maintained CSS fixtures are unchanged.
- Separation/duplication: one private `publishImportedDocumentFacts` owner now
  replaces the duplicated planner/emitter classification loops. Planning still
  publishes direct facts into its isolated evaluation frame, and the same graph
  walk publishes those facts into the render root before output evaluation.
  Lexical emission skips that exact occurrence's already-published facts but
  remains the sole owner of the imported body and CSS. Imports nested inside an
  at-rule body retain their nested lexical frame and do not take the root edge.
- New traversal: no import-graph, document, or AST traversal is added. Across
  admitted import occurrences `M`, distinct root-propagated `StyleImport`
  identities `D`, and lexical executions `L`, exact direct-statement work is
  `sum(M_i * S_i)` in the existing planner, plus `sum(D_i * S_i)` for first-visit
  root publication, plus `sum(unmarked_i * S_i)` for lexical publication. The
  render performs one occurrence claim for each root occurrence, one fact claim
  for each of the `sum(D_i * F_i)` callable/value/ruleset facts, and one scalar/
  Set membership check at each lexical execution. A direct authored `(multiple)`
  occurrence with its own node identity remains `2S`; one nested import node
  executed `M` times through a multiple parent is `(M + 1)S`, because its first
  visit prepublishes once and every lexical execution sees the same marker.
  There is no restart-at-zero nested loop, source scan, reparse, sort, filter, or
  second graph walk.
- New node/materialization: zero AST/CST nodes, wrappers, copies, source strings,
  arrays, tuples, WeakMaps, or per-entry objects. Every `Emit` gains one fixed
  nullable `prepublishedImportFacts` pointer, preserving its single construction
  shape. The first render-local identity is stored directly. A strong
  `Set<Statement>` is allocated only when a second distinct occurrence/fact
  identity exists, is shared across that render, and is dropped wholesale at
  render completion. A fact-free imported document stores only its occurrence
  identity and allocates no collection. Each `PreparedImports` result is one
  escaping closure plus its captured environment over the existing document map,
  instead of an inspectable graph object. A prepared render performs one O(1)
  private reader call and one monomorphic token invocation; a render without a
  prepared token performs neither. The same callable token crosses the package's
  ESM/CJS format boundary without a global registry key or named payload field.
- Render path: imported bodies and CSS still write once through the canonical
  output buffer at each authored splice. `(multiple)` bodies still repeat;
  `(reference)` bodies remain output-hidden. Only lookup-map/array publication
  moves earlier. No value is materialized merely to stringify or classify.
- Helper/API surface: the shared publication helper deletes the parallel lexical
  implementation. Two private scalar/Set identity helpers make the ownership
  test explicit. The exported alpha `PlannedImportDocument` record is removed;
  `PreparedImports` is now a nominally branded reusable token. The brand is
  private in the generated declaration, while the concrete callable reader and
  mutable map remain private to the serializer. This is API opacity, not a
  cryptographic boundary: untyped JavaScript can violate any TypeScript contract.
  No global registry key, compatibility alias, or public fallback is retained.
- Metadata mutations: canonical Stylesheets and Statements are untouched. The
  render-local Frame receives the same mixin/declaration/ruleset facts it
  previously received at lexical import execution. The prepared graph is never
  annotated with a render Frame, so concurrent renders cannot overwrite each
  other's ownership marker. Only the render-local scalar/Set and existing Frame
  lookup collections mutate.
- Review-flagged diff tokens: [loop/traversal] the shared direct-statement loop
  replaces two prior copies and retains the exact direct-authored `2S` total;
  repeated canonical occurrences follow the `M*S + S` count above; [side set] one
  positive-feature render-local Set after the second distinct identity, with a
  scalar first-identity fast path; [object shape] one fixed nullable Emit slot;
  [token materialization] one escaping closure plus its captured environment per
  prepared result replaces the prior one-property carrier object, and one O(1)
  reader invocation occurs per prepared render; the no-prepared lane performs
  zero reader work; [node/materialization] none;
  [source scan/reparse] none; [behavior] OPEN N10 makes later document-root import
  facts available before output while bodies remain lexical.
- Evidence: focused core import coverage passes 61/61 and focused public import
  coverage passes 3/3 after dependency-ordered core/Jess builds. Exact tests pin
  transitive later-import mixin/variable access in both output modes, root
  ruleset-as-mixin lookup, reference-before-import visibility, concurrent reuse
  of one prepared token, `(multiple)` fact dedupe with repeated body output, and
  the negative boundary that keeps an at-rule import out of the document root
  while making it visible to following statements inside that at-rule.
  Full core passes 213 files / 3372 tests / 9 skipped / 2 todo; the combined
  all-less and all-less-error gate passes 208/208; the AST-v2 production ratchet
  passes 4/4; release build, macro compilation with zero interpreter fallbacks,
  compose-integrity, aggressive-cutting, package exports, the blocking public
  type consumer, guardrails, render/materialization/binding/diagnostic frontiers,
  and diff-check pass. The node-copy frontier remains inherited-red on
  `packages/core/src/util/bitset.ts`'s existing `super.clone()` site. Shape
  stability remains inherited-red on the stale AST type inventory/`SpacedValue`
  allowlist while its monomorphic-node assertion and all CST checks pass. A clean
  `origin/dev` worktree reproduces the same seven unrelated broad Jess test
  failures; this diff adds none. The committed-candidate
  `measure:less:hotpath` run is unavailable before timing because the maintained
  functions fixture still rejects numeric-leading `@1`; no benchmark speed or
  neutrality claim is made.
- Verdict: accepted after exact semantic, performance-architecture, API/reuse,
  and test-sensitivity review. The implementation is the smallest render-local
  N10 ownership edge found; it deliberately rejects a shared-plan Frame pointer,
  per-entry wrapper objects, an always-allocated dedupe collection, and a public
  or globally keyed prepared-import graph.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "OPEN N10 changes when the canonical AST-v2 import owner publishes direct lookup facts: the document-root static graph becomes visible before output evaluation, while imported bodies and CSS remain lexical. This is semantic compatibility work, not a neutral refactor or optimization claim.",
    "dangerTokensJustification": "For a direct authored import identity the existing planner scan plus first-visit root publication remain 2S and lexical publication is skipped. More generally the exact work is planner sum(M_i*S_i) + first root-publication sum(D_i*S_i) + lexical sum(unmarked_i*S_i), with M_root occurrence claims, sum(D_i*F_i) fact claims, and L lexical membership checks. A canonical nested import executed M times is (M+1)S, not 2MS. The first render-local identity is scalar and only a second distinct occurrence or fact allocates one strong render-local Set. No AST/CST node, source string, array, WeakMap, per-entry tuple, reparse, graph traversal, or parallel output path is added.",
    "behaviorEvidence": "Focused core import coverage passes 61/61 and focused public import coverage passes 3/3. The cases cover both output modes, a transitive later import, variable and mixin facts, root ruleset-as-mixin lookup, reference-before-import visibility, concurrent prepared-plan reuse, repeated `(multiple)` bodies with one canonical fact publication, and the negative/positive boundary for a nested at-rule import.",
    "buildEvidence": "Release build passes. Full core passes 3372 tests; combined all-less/all-less-error passes 208/208; AST-v2 production ratchet passes 4/4; macro and compose-integrity report zero interpreter fallbacks; aggressive-cutting, package exports, public type consumer, guardrails, render/materialization/binding/diagnostic frontiers, and diff-check pass. Node-copy and AST shape-inventory checks retain their named inherited reds; monomorphic-node and CST shape checks pass. Committed-candidate measure:less:hotpath is unavailable before timing on the inherited numeric-leading @1 fixture rejection, so no speed claim is made. Exact semantic, performance-architecture, API/reuse, and test-sensitivity reviews approve.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 53.41333350000002,
      "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85",
      "outputBytes": 122320
    }
  },
  {
    "id": "ast-extend-import-preflight",
    "verdict": "accepted",
    "performanceClaim": "none",
    "why": "A loaded typed document remains the earliest authoritative source for imported extend placements and document-root lookup facts. Publishing those facts during the existing source-order graph visit is necessary because the root evaluator must see them before output begins; they cannot be carried before import resolution loads the canonical document.",
    "dangerTokensJustification": "The no-import/no-extend false path still returns before collection or allocation. The feature path retains the existing import graph and extend collectors. A direct authored import retains two direct-statement scans; repeated canonical occurrences use one first-visit root publication plus the existing per-occurrence planner scan, while lexical execution pays only one identity membership check. The added ownership is scalar-first with one strong Set after a second distinct identity. It creates no source scan, reparse, AST copy, per-entry tuple, WeakMap, or output buffer.",
    "behaviorEvidence": "The extend preflight contract retains one false-path call with zero collector/overlay/loop counters and one imported-loop feature path with two concrete loop placements and two overlay subjects. Focused import tests add transitive N10 fact visibility without changing those extend-plan facts.",
    "buildEvidence": "The focused extend-preflight test, release build, full core, combined Less corpora, macro/compose, ratchet, aggressive-cutting, package/type/guardrail, and applicable frontier gates pass. The named inherited node-copy and AST inventory reds are unchanged by this diff.",
    "falsePath": {
      "fixture": "extend-preflight-contract:no-extend",
      "counters": {
        "calls": 1,
        "collectorCalls": 0,
        "overlaySubjects": 0,
        "overlayInstructions": 0,
        "loopPlacements": 0
      }
    },
    "featurePath": {
      "fixture": "extend-preflight-contract:imported-loop",
      "counters": {
        "importsVisited": 1,
        "loopPlacements": 2,
        "overlaySubjects": 2
      }
    },
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "parse-render",
      "currentMedianMs": 45.6,
      "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85",
      "outputBytes": 122320
    }
  }
]
```
- Previous pass: 2026-08-26 reference-import nested pseudo visibility. SETTLED
  A7 and X3 require a visible extender to cross a structurally compacted parent
  selector arm without exposing its hidden reference siblings. This is a semantic
  repair with no speed claim.
- Architecture surface: AST-v2 extend composition, match/rewrite provenance,
  reference-import emission evidence, and Less expected-failure classification.
  Grammar, parser artifacts, canonical AST/CST schemas, Context/import resolution,
  output buffers, package exports, and owner-maintained CSS fixtures are unchanged.
- Separation/duplication: the existing parent-token `:is()` remains the sole
  selector-list compaction. A proven exact `&` Simple in a fused compound now
  preserves that parent token as the existing structured graft instead of
  serializing it into an opaque text simple. Opaque text containing an ampersand,
  including `[title="&"]`, retains the prior text path and is never promoted to
  selector structure.
  The existing graft matcher remains the sole extend matcher; no selector-list
  distributor, second propagation pass, byte scanner, or serializer-side matcher
  is added.
- Cumulative node weight: unchanged. No AST/CST node is copied or mutated. The
  change is confined to render-local Branch/Simple IR already required by an
  extend-bearing document.
- New traversal: every admitted composed level performs one `hidden` scalar
  check; only an extend-bearing hidden subject stamps one branch visibility bit
  per branch at that level (exactly `sum(B_i)` stores across the composed
  levels) while those alternatives remain structural. A fused
  single-compound ampersand checks the small parent compound for an existing graft
  before choosing typed substitution; text-only parents retain their prior string
  substitution. A successful hidden-graft rewrite compacts its returned arm array
  once in place with exactly `A` arm inspections and `V` visible-arm stores. Work
  is `O(sum(B_i) + S + A)`, with no Cartesian branch product or restart-at-zero
  loop.
- New node/materialization: the extend-free gate still returns before composition.
  Text-only and multi-segment parents allocate no new carrier. A typed
  single-compound parent transfers the immutable semantic graft Simple pointers
  that the old path flattened into one temporary selector string; no recursive
  Branch/segment/value clone is needed. Hidden-arm filtering reuses the matcher
  result array in place and allocates no filter array, map, set, tuple, or side
  table. Collapsing a sole visible single-segment arm likewise transfers its
  immutable Simple pointers from the fresh matcher result before that result is
  discarded. Visible branches retain the prior exact-length `.map` construction;
  only the hidden feature lane uses a variable-length compaction buffer.
- Render path: a hidden parent list such as `.hidden, .target` still compacts to
  one `:is()` internally. Extending `.target` with `.visible` through nested
  `&:hover` now emits only `.visible:hover`; hidden siblings remain absent.
  Authored structured pseudos remain intact, pinned by
  `.visible:is(.enabled, .focused)`. Both collapse modes emit identical exact
  bytes for the focused reference case.
- Helper/API surface: one private `structuredParentValue` predicate helper and
  one optional internal `composePath` visibility argument. No public package API,
  compatibility alias, fallback resolver, or general distribution function is
  introduced.
- Metadata mutations: only the pre-existing optional `Branch.hidden` bit on
  render-local extend IR is stored earlier in hidden composition. Canonical nodes,
  source spans, trivia, parents, and imported documents are untouched.
- Review-flagged diff tokens: [loop/traversal] one hidden-level branch-stamp loop,
  one fused-parent structured-simple scan, and one success-only in-place visible-arm
  compaction; [array spread/materialization] none; [array helper] none on the new
  path; [side map/set] none; [node construction] no AST/CST nodes and only required
  render-IR Simple objects; [materialized array/object] the
  pre-existing composed-segment value array is still built once and receives typed
  Simple pointers instead of one opaque text simple on the matched graft lane;
  [source scan/reparse] none; [behavior] SETTLED A7
  reference visibility now crosses the existing X3 `:is()` graft without implicit
  selector-list distribution.
- Evidence: the dependency-order release build passes; focused
  import/amp/extend/op-budget coverage
  passes 75/75; focused reference corpus selection passes 3/3; full core passes
  212 files / 3,368 tests / 9 skipped / 2 todo; full all-less passes 112/112.
  The real `import-reference.less` output now contains both top-level and nested
  `.visible:hover`, and the exact diff no longer contains the classified trailing
  pseudo loss. The same two-mode assertion proves `[title="&"]` stays hidden and
  does not become `[title=".visible"]`. Targeted ESLint has zero errors and only inherited extend-file
  warnings; the AST-v2 production ratchet passes 4/4; `check:macro` reports zero
  interpreter fallbacks for all four grammars; `verify:compose-integrity`,
  `verify:aggressive-cutting-review`, `check:guardrails`, and `git diff --check`
  pass. Matched committed-build `import-reference.less` runs used 20 warmups and
  45 samples: parent `692df4241` emitted 1,476 bytes at SHA-256
  `cc2a155ec10b96ad2a78719fb74e68ed68c88bacc36c68c3491dad128e415750`
  with a 6.401 ms median; final production candidate `e61bb055b` emitted the corrected 1,378 bytes
  at SHA-256 `c9215746b5c726287ee79e85626a27018f70756659836afce8e0d46791dba60a`
  with a 6.305 ms median on the immediate repeat. Its first same-commit run was
  8.214 ms despite identical output and counters, demonstrating that this harness
  cannot attribute the wall-clock spread to the diff. Planning/preflight counters are identical
  (`subjects=94`, `instructions=2`, `overlaySubjects=90`, zero overlay
  instructions/loop placements); branch comparisons rise 66 -> 73 because the
  formerly dropped nested pseudo is now matched. The timing delta is below the
  harness noise band and is not a speed claim.
- Verdict: accepted as the smallest typed A7/X3 correction with
  `performanceClaim: none`. Exact-range semantic review approves invariants 1-8
  and S1-S8 with no ledger action; exact-range performance review approves V8
  invariants 1-11 and R1-R7 with the deterministic counts above. The broad
  `verify:node-copy-frontier` and AST shape inventories remain inherited red on
  the unrelated `bitset.ts` clone and stale corpus/`SpacedValue` allowlist;
  monomorphic AST node shapes and every CST shape assertion pass.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "SETTLED A7 requires a visible extender to surface the matched branch of a hidden reference selector, and SETTLED X3 makes the existing structured :is() graft the canonical partial-match boundary. Preserving that graft through fused ampersand composition fixes the missing nested pseudo without a distribution surface.",
    "dangerTokensJustification": "The extend-free gate is unchanged. Only an exact structural & Simple may retain the typed parent graft; opaque text such as [title=\"&\"] stays on the prior string path. The admitted path performs bounded structural loops over composed levels, one parent compound, and one successful graft result; it reuses the matcher result array, creates no AST node, side table, predicate string, source scan, reparse, Cartesian product, or second matcher.",
    "behaviorEvidence": "Focused core coverage passes 75/75, the reference corpus selection passes 3/3, full core passes 3368 tests, all-less passes 112/112, and the AST-v2 production ratchet passes 4/4. Exact collapse-mode assertions retain authored :is() conditions, exclude hidden selector-list siblings, and prove opaque [title=\"&\"] text is not promoted to selector structure. Matched import-reference builds keep plan/preflight counts identical; comparisons rise 66 to 73 because the corrected nested pseudo now enters matching.",
    "buildEvidence": "The dependency-order release build, zero-fallback check:macro, verify:compose-integrity, verify:aggressive-cutting-review, check:guardrails, and git diff --check pass. Exact-range semantic invariants 1-8/S1-S8 and performance invariants 1-11/R1-R7 reviews approve with no blocker. The unrelated bitset clone and stale AST shape inventory remain inherited red; monomorphic node and CST shape assertions pass.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 53.41333350000002,
      "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85",
      "outputBytes": 122320
    }
  }
]
```

- Latest pass: 2026-08-25 entry-dialect defaults and public Context API cut. This
  preserves the existing session-owned option policy while tightening the alpha
  surface; it is not an emitted CSS change or speed claim.
- Architecture surface: parser-plugin success results, canonical
  `DocumentContext` registration, Context source-owner option-pointer switching,
  and Less/SCSS plugin activation. AST/CST nodes, parser grammars, import
  admission, selector composition, output writing, and owner-maintained fixtures
  are unchanged.
- Separation/duplication: a successful parser result may carry its plugin's
  resolved dialect defaults. Context accepts only the entry parser's fact, folds
  constructor options over it once for the session, freezes that flat policy
  object, and gives every canonical document the same pointer. Imported parsers
  cannot reconfigure the session. This preserves the old first-plugin
  `setOption` ownership without live mutation. The
  former Context option-version scalar, hidden document version slot, stale-cache
  checks, and lazy refresh route are deleted.
- Cumulative node weight: AST/CST node factories and node fields change by zero.
  Every Context loses one numeric version field and every canonical
  `DocumentContext` loses one hidden numeric symbol slot. A Less plugin replaces
  six public scalar option fields with one private pointer to one five-field
  document-default object; SCSS replaces one public scalar with one private
  pointer to one one-field object. A successful Less/SCSS parse result carries
  that existing pointer without copying the object.
- New traversal: none. The first canonical-document registration performs one
  existing `resolveOptions` field fold; later documents reuse that pointer.
  Source re-entry is two pointer stores on entry and
  two on restoration. No document walk, option-key enumeration, source scan,
  parser replay, value traversal, or restart-at-zero loop is added.
- New node/materialization: no node, Rules wrapper, source string, Map, Set,
  WeakMap, Error, or per-entry carrier. Each dialect plugin allocates one small
  frozen document-default object at plugin construction. Successful parse results
  retain one readonly pointer to it. Entry registration constructs exactly one
  frozen compile-folded `ResolvedOptions` object for the session; later
  `DocumentContext` instances retain that pointer. There is no discarded
  constructor-default or per-import policy object. This
  replaces the first Less activation's five sequential
  `setOption` calls and five replacement `ResolvedOptions` objects (SCSS: one),
  plus all version-refresh replacement objects.
- Render path: unchanged. Evaluators continue to read one flat
  `context.options.X` field; this pass changes how the resolved pointer is owned,
  not how values or CSS are materialized.
- Helper/API surface: public `Context.setOption` is deleted. The private option
  version symbol, version getter/setter, activation refresher, and restoration
  refresher are also deleted. `ISafeParseResult` gains one optional declarative
  `dialectDefaults` fact; exported `LessPlugin` and `ScssPlugin` lose their
  mutable-looking public resolved-option fields. Resolved compile-option keys on
  `Context.opts` resolved keys and the `Context.options` view are now readonly;
  each resolved object is frozen, so JavaScript callers also cannot mutate
  active document policy behind Context's source-owner switching. The public
  type no longer advertises a
  mutation that cannot refresh `Context.options`. The implementation-only
  `DocumentContext` constructor and `DocumentContextOptions` type are removed
  from the package root rather than exposing the new one-resolve construction
  seam. No compatibility alias or shim remains.
- Metadata mutations: parser plugins attach `dialectDefaults` only to successful
  result records. The shared plugin-lifetime fact is frozen and readonly, so one
  result cannot mutate later parse defaults. Context copies no plugin option
  object and mutates no AST node; it accepts the first successful result's fact
  as the session fallback and ignores later imported defaults. Source entry/exit
  only saves and restores
  `_documentContext` and `options`.
- Review-flagged diff tokens: [loop/traversal] none; [array
  spread/materialization] none on the new ownership route; [materialized object]
  one frozen plugin-lifetime defaults object per Less/SCSS plugin and one
  frozen compile-folded options object per Context session, plus one
  `Object.freeze` on each pre-existing legacy-tree/Context option resolution;
  [side map/set] none;
  [node construction/copy] none; [source scan/reparse] none; [routine Error]
  none; [public API] one mutator, seven public plugin option fields, and two
  implementation-only document-context exports deleted; one declarative
  parse-result fact added.
- Evidence: focused Context source-owner/option switching, core numeric operation,
  Less plugin normalization/defaults, SCSS parser defaults, compiler reuse,
  strict-preset, strict-unit, and Jess/Less operation suites pass. The Context
  test pins compile-over-entry-dialect precedence, imported-source policy
  stability, and runtime absence of `setOption`.
- Behavior evidence: focused core tests pass 89/89; Less plugin tests pass 14/14;
  SCSS plugin tests pass 2/2; focused public compiler/option tests pass 74/74.
- Build evidence: core, Less plugin, and SCSS plugin builds pass in dependency
  order, and `pnpm run verify:package-exports` passes.
- Boundary evidence: fresh core declarations contain no `Context.setOption`;
  `ISafeParseResult.dialectDefaults` is the sole new readonly typed handoff,
  `DocumentContext` construction is absent from the package root, and generated
  Less/SCSS declarations expose no removed scalar compatibility fields.
- Performance evidence: no speed claim. Deterministic deletion counts above are
  the evidence; timing is not used to convert this ownership/API cut into a
  performance claim.
- Hot-path cost contracts:
```json
[
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": ["Context-plugin-source-parser-dispatch", "emit-walk-context-output-option", "Ruleset-interpolated-selector-boundary", "selector-match-string-and-node-combinators", "extend-index-tagged-graft-atoms", "Sequence-subclass-preserving-evaluation", "callable-output-root-property-guard", "serializer-at-rule-and-selector-surface"],
    "why": "The entry dialect's defaults establish the existing session-owned fallback policy; explicit constructor options still win. Carrying that typed fact on the successful parser result removes live Context mutation without allowing imported parsers to reconfigure evaluator or output policy.",
    "dangerTokensJustification": "The pass deletes public Context.setOption, the package-root DocumentContext construction surface, one Context version field, one hidden DocumentContext version slot, three refresh helpers, and the Less/SCSS live-mutation ladders. Each dialect plugin constructs one frozen defaults object once and successful parse results retain its readonly pointer; Context accepts the entry result, performs one fixed-field resolve for the session, freezes that sole policy object, and shares it with every internal DocumentContext. Imported defaults do not trigger another resolve. The pre-existing Context/legacy-tree resolve sites also freeze their one flat result so the public readonly view is enforced at runtime. Source re-entry uses direct resolved-pointer stores with no version comparison, replacement options object, collection, traversal, source scan, node materialization, output buffer, compatibility shim, or speed claim.",
    "behaviorEvidence": "Focused Context, numeric operation, Less/SCSS plugin, compiler reuse, strict option, and public operation tests pass; compile-over-entry precedence, imported-source stability, immutable runtime views, and absence of the mutator are pinned.",
    "buildEvidence": "Core, Less plugin, and SCSS plugin builds plus package-export verification pass; full release/corpus/frontier evidence is recorded before landing.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 14.573459, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  }
]
```
- Verdict: accepted provisionally as a machinery/API deletion; full release,
  corpus, contract gates, and adversarial reviews remain required before landing.

- Prior landed pass: 2026-08-25 imported reference-mixin body trivia ownership.
  This is a bounded emitted-CSS correction under SETTLED A7, G28, and N6, not a
  speed or neutrality claim.
- Architecture surface: canonical AST-v2 Context source identity, callable-body
  trivia replay, and the collapsed/nested leaf writers. Parser grammar, AST/CST
  nodes and spans, import resolution/admission, selector composition, plugin
  result semantics, legacy-tree rendering, and owner-maintained CSS fixtures are
  unchanged. Delayed source-reading plugin capabilities and failures now
  deliberately re-enter the imported call site's source owner; `markImportant`
  remains a render-local sink mutation and needs no source switch.
- Separation/duplication: each parsed canonical document already owns one
  `TriviaMap`. `rememberDocumentContext` reads that existing side-table fact
  once and retains its pointer in one private-symbol slot attached only to the
  canonical document's existing `DocumentContext`; legacy `TreeContext`
  instances gain no duplicate slot. The
  class declaration is unchanged, and the core-internal accessor is not
  re-exported from the package root.
  The existing render `Frame.sourceOwner` pointer remains the only per-activation
  provenance carrier; no leaf field or parallel owner map is added. A selected
  callable enters its recorded source owner before constructing the existing
  sparse body cursor, and a grouped leaf re-enters only when its frame owner
  differs from Context's active document. Contiguous leaves with one imported
  owner re-enter once as a run. Uniform merge groups re-enter once; a mixed-source
  merge captures and emits each contiguous owner run under that owner while
  preserving one logical accumulator. The existing admission scan retains its
  no-merge early exit; an admitted merge then performs one owner-classification
  pass and exits on the first mismatch. Exact declaration-tail runs remain owned
  by the canonical leaf/merge writer, while the callable cursor owns true
  before/between/tail body runs. Comment-only bodies enter their owner before
  reading trivia and remain solely owned by the existing empty-body queue.
- New traversal: the collapsed emitter's existing monotonic callable-body
  cursor is reused by the nested emitter. It performs one binary seek into the
  existing sparse comment table and visits each comment-bearing run inside the
  selected body at most once. Mixed-source merge capture and emission each make
  one monotonic pass over their existing leaf group and group contiguous owners
  without restarting. The only new output loop writes the already-sliced trailing
  comment strings once. There is no new document/tree walk, source scan, parser
  replay, restart-at-zero scan, selector walk, or value-group traversal. Merge
  members use the comment table's exact indexed run and comment bounds; the
  pre-existing compatibility source fallback remains confined to the ordinary
  declaration writer.
- Complexity and ordinary lane: only a canonical AST `DocumentContext` gains one
  fixed trivia pointer; exported class
  declarations and legacy `TreeContext` instances are unchanged. Remembering a
  canonical document adds exactly one `triviaMapOf(document)` lookup and no
  collection. Each ordinary collapsed
  or nested leaf adds local reads of `frame.sourceOwner` and `e.context`, followed
  by null/context-identity checks; identity-equal leaves call the prior writer
  directly. Each ordinary source-owner activation adds one document-identity
  comparison and now calls its work directly, without re-setting identical
  Context options or allocating a closure. Only a genuine cross-document
  mismatch performs `instanceof`, one trivia-identity comparison, direct saved
  pointer swaps for the already-resolved document options/source identity/trivia,
  and callback wrappers around the existing Context source-owner callback.
  Entry registration constructs one frozen compile-folded `ResolvedOptions`
  object and shares it with every `DocumentContext` in the session. Parser
  plugins carry dialect defaults on successful parse results; Context accepts
  the entry fact and ignores later imported defaults. Ordinary source re-entry swaps
  the already-resolved pointer and allocates no replacement `ResolvedOptions`
  object.
  Collapsed and nested buffers coalesce consecutive mismatched leaves,
  so that cost is once per contiguous owner run rather than once per declaration.
  A uniform merge retains that one-run cost. A mixed-source merge reuses the
  existing group-length name array, name-to-member `Map`, and per-name index
  arrays; the existing merge-admission scan is followed by one admitted-group
  owner-classification pass, then one name-capture and one emission pass. Each
  foreign contiguous name/output run re-enters once, and an anchored merged value
  re-enters each contiguous member-owner run once while preserving evaluation
  at the existing last-member anchor. Identity-equal member runs call the
  indexed append helper directly; only genuine mismatches allocate a
  source-owner callback.
- New node/materialization: no AST/CST node, copied body, wrapper Rules, source
  string, per-leaf carrier, Map, Set, WeakMap, or Error on the ordinary and
  uniform-source lanes. Each canonical AST `DocumentContext` object gains one
  hidden fixed slot; its public declaration and every legacy-tree instance are
  unchanged. Entry registration allocates one compile-folded frozen
  `ResolvedOptions` for the session; each canonical-document registration adds the
  `{ value: trivia }` descriptor used to attach the hidden trivia pointer; these
  are cold once-per-document facts, not source-re-entry allocations. The
  mixed-source merge uses the same name array, merge `Map`, and
  member-index arrays already required by merge folding, without another
  per-member carrier. A nested selected statement-bearing callable whose body
  actually intersects a comment run allocates the same three-field
  `BodyTriviaReplay` record already used by the collapsed emitter. Empty tables
  reject before body-span materialization or per-statement span reads. Comment
  arrays remain lazy, are transferred directly into pending ownership without a
  pass-through clone, and exist only when a block comment becomes output. One
  module-once frozen empty array replaces the former fresh empty array returned
  by every pending-comment miss; empty nested flushes also skip indentation
  construction. Cross-document owner runs and delayed legacy-plugin capability
  calls exceptionally allocate callback closures; no closure is added to
  identity-equal leaf output.
- Render path: comments are sliced only when they become required output and are
  written through the canonical chunk buffer. Declaration values stay on the
  existing typed writer. No array/node/string is constructed merely to classify
  a comment; exact parser-owned source offsets and document-owned comment columns
  decide whether the leaf or body cursor owns a run and delimit its output text.
- Helper/API surface: one private `withTrivia` helper factors the exact save,
  async-finally, and restore behavior formerly embedded in `withDocumentTrivia`;
  it also lets source-owner re-entry restore the same render pointer. The nested
  emitter accepts one private optional `BodyTriviaReplay` argument. One
  core-internal `documentTriviaOf` accessor reads a non-exported-symbol slot;
  `@jesscss/core`'s public `DocumentContext` declaration and package entrypoints
  gain no field, export alias, compatibility facade, option, or node type.
- Metadata mutations: canonical AST/CST nodes, source spans, body spans, trivia
  tables, parents, and roots are never mutated. The private document-trivia slot
  is defined once when a canonical document enters Context. On a
  cross-document callback, `e.trivia`
  is restored in both sync, async, and throwing exits. Existing
  `EmittedTrivia` bits remain the single per-render ownership guard.
- Review-flagged diff tokens: [loop/traversal] one trailing semantic-comment
  output loop plus the existing sparse monotonic cursor on the newly admitted
  nested selected-body lane, the existing merge-admission scan followed by one
  admitted-group owner scan, and two
  mixed-source merge passes; [materialized
  object/array] one fixed canonical-document source pointer, one cold body cursor,
  lazy semantic comment arrays, one module empty singleton, and mismatch-only
  callback closures; [side map/set] only the merge
  lane's existing name-to-member map is present;
  [node construction/copy] none; [source scan/reparse] none; [routine Error]
  none; [public API] none—the source fact is hidden behind a module-private
  symbol and a core-internal relative import.
- Behavior evidence: the public reference-mixin fixture passes in both
  `collapseNesting` modes and pins a declaration-tail comment inline plus a
  trailing selected-body comment as its own line, an imported comment-only body,
  and inline comments on imported and caller members of one mixed-source merge.
  Async legacy-plugin probes pin imported URL rebasing, delayed built-in function
  dispatch, every replayed logger record's attribution, outer-function
  `currentFileInfo` after an async raw argument, rejection file/line attribution,
  and caller-source restoration across worker round-trips. Focused block-comment
  and Less function controls pass 37 active tests with 21 pre-existing todo; the
  filtered owner `import-reference.less` expected-failure lane passes and its
  exact remaining diff contains the pulled body comment. The dependency-order
  release build; full core suite (212 files / 3364 tests / 9 skipped / 2 todo);
  all-less (111/111); all-less-error (96/96); AST-v2 production ratchet (4/4);
  package exports; macro compilation with zero interpreter fallbacks;
  compose-integrity; materialization-frontier; render-buffer-frontier;
  guardrails; aggressive-cutting contract; and `git diff --check` pass.
  `verify:shape-stability` retains its inherited two stale AST-inventory failures
  (`BracketLookup`, `ImportAtRule`, `SpacedValue`, `VarIndirect`, and
  `VariableReference` versus current `Lookup`, `LookupStep`, `Sequence`, and
  `StyleImport`); CST shape inventory and the AST monomorphic-shape assertion pass,
  and this batch changes no AST/CST factory or node shape. The owner fixture's
  lost trailing `:hover` is recorded separately as an existing selector-composition
  defect, not misclassified as settled `:is()` compaction or distribution.
- Performance evidence: no speed claim. Deterministic operation/allocation
  counts above are load-bearing. The committed-state
  `measure:less:hotpath` sanity run is UNVERIFIED / inherited red: it exits
  before timing on the upstream Less `functions.less` numeric-leading `@1`
  diagnostic, the same pre-timing failure recorded for clean `origin/dev`.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "SETTLED A7 makes a reference-imported callable visible only when selected, SETTLED G28 requires both emitters to replay block-interior comments, and SETTLED N6 keeps authored comments and spacing in parser-owned side-table provenance. The selected body therefore reuses its document's existing TriviaMap rather than copying nodes or deriving placement from bytes.",
    "dangerTokensJustification": "The existing sourceOwner pointer selects one existing document trivia table. One sparse cursor consumes each admitted body run monotonically; exact statement-end offsets leave declaration-tail comments to the indexed leaf or merge writer. Empty tables reject before span reads/materialization, pending comment arrays transfer ownership without cloning, empty flushes reuse one singleton and skip indentation, and contiguous cross-document leaves re-enter Context once per owner run using already-resolved option pointers. Entry registration has one compile-folded session ResolvedOptions object and each canonical document adds one hidden-trivia property descriptor; ordinary source re-entry allocates no replacement options object. A mixed-source merge retains the existing early-exit admission scan, then classifies the admitted group's owners in one pass with an immediate mismatch exit; it reuses its existing name array/map/member indexes and makes one name-capture plus one emission pass. Anchored values re-enter only mismatched contiguous member-owner runs, use indexed comment bounds, and preserve evaluation order. Delayed source-reading legacy-plugin capabilities and failures capture and re-enter that same owner when the worker calls back. No AST copy, source-delimiter rescan, reparse, new per-member carrier, Error control lane, or speed claim is introduced.",
    "behaviorEvidence": "Focused public reference-mixin, block-interior-comment, and function controls pass, including both output modes, comment-only and mixed-source merge bodies, delayed variable/built-in/logger success, async-raw-argument currentFileInfo, rejection file/line attribution, and caller restoration; filtered import-reference remains an expected failure only for separately classified residuals.",
    "buildEvidence": "Dependency-order build:release; full core (212 files / 3364 tests); all-less (111/111); all-less-error (96/96); AST-v2 production ratchet (4/4); package exports; macro zero-fallback; compose-integrity; materialization-frontier; render-buffer-frontier; guardrails; aggressive-cutting; and git diff --check pass. Shape stability is inherited red only on the stale AST inventory; CST inventory and AST monomorphic-shape assertion pass. The committed-state Less hot-path sanity harness is unverified because candidate and clean origin/dev fail before timing on the inherited numeric-leading @1 diagnostic; no timing conclusion is drawn.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 14.573459, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": ["Context-plugin-source-parser-dispatch", "emit-walk-context-output-option", "Ruleset-interpolated-selector-boundary", "selector-match-string-and-node-combinators", "extend-index-tagged-graft-atoms", "Sequence-subclass-preserving-evaluation", "callable-output-root-property-guard", "serializer-at-rule-and-selector-surface"],
    "why": "A deferred callable already restores its parser/plugin/file DocumentContext. Retaining that same document's parser-owned trivia pointer in a private slot makes comment provenance follow the established source-owner boundary without changing resolution, loading, options, selector policy, emitted value semantics, or the public Context declaration.",
    "dangerTokensJustification": "One hidden readonly trivia pointer is populated only when a canonical document context is remembered; the public class declaration and legacy TreeContext shape remain unchanged. Entry registration creates the sole compile-folded session options object and every DocumentContext shares it. Parser plugins carry frozen dialect defaults on successful parse results, Context accepts the entry fact once, and ordinary source re-entry swaps matching Context option/source pointers plus the render trivia pointer. No live option mutation, version refresh, ordinary source-reentry replacement options object, new Context collection, import walk, parser host, node materialization, selector traversal, or output buffer is introduced.",
    "behaviorEvidence": "Both output modes preserve imported statement-bearing, comment-only, mixed-source merge-inline, and trailing comments exactly; delayed plugin variable/built-in/logger success, async-raw-argument currentFileInfo, rejection file/line attribution, and caller restoration are pinned; focused import and comment controls pass.",
    "buildEvidence": "Dependency-order build:release and package-export verification pass, together with the full correctness/corpus/frontier/contract gates in the companion record.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 14.573459, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  }
]
```
- Verdict: accepted as the bounded A7/G28/N6 correction. The named full gates
  pass, and the invariant-by-invariant semantic, performance-architecture, and
  API reviews report no blockers.

- Prior landed pass: 2026-08-25 imported CSS-terminal document-prelude planning.
  This is a bounded output-placement correction under OPEN ledger row N9, not a
  speed or neutrality claim.
- Architecture surface: canonical AST-v2 import planning and statement output
  only. The Less grammar's N7 `AtRuleStatement` / `StyleImport` split, Context
  loading, compile-time document execution, AST/CST node shapes, package exports,
  and parser sources are unchanged.
- Separation/duplication: the existing one-pass `planImportedFacts`
  import-graph owner also carries each admitted document-root CSS terminal while
  it already visits the loaded typed document. There is no second import-graph
  traversal. The carried fact is the canonical statement, its typed target, the
  planner lexical frame, and the driver-owned `withinDocument` callback; output
  does not classify a suffix, reload a document, re-evaluate a target, scan
  source, or reparse bytes. Compile-time documents still execute later at their
  authored lexical splice.
- New traversal: the existing source-ordered statement loop gains one
  `AtRuleStatement` branch only when Context-owned CSS placement is active. The
  new output loop follows integer indexes through five parallel arrays once and
  writes their typed statements through the canonical buffer before the body
  walk. Contiguous terminals authored by one loaded document share one
  source-scope callback. The ordinary no-import / no-extend bypass retains the
  existing direct-root scan and allocates no plan.
- Complexity/order: ordinary and immediately loaded imports append one aligned
  flat-array row in the planner's existing O(statements + imports) walk. A
  genuinely unresolved typed import adds one null row at its lexical position;
  its one later retry appends through the same plan and relinks scalar integer
  indexes in O(1), so later imports never need a sort, splice-array copy, path
  vector, per-deferred segment object, or restart-at-zero scan. At-rule-contained imports receive no root collector.
  Reference imports receive no output collector. The planner mirrors render's
  established occurrence admission: only optionless imports consume import-once
  identity, while option-bearing and transitive `(multiple)` occurrences remain
  independent.
- New node/materialization: no AST/CST node, node copy, wrapper `Rules`, public
  materialization, or source metadata. An admitted collector allocates one fixed
  plan object with `head`/`tail` and five nullable array slots. Those five arrays
  are allocated together only at the first unique output terminal or deferred
  placeholder; each unique terminal adds one scalar/reference cell to each
  array, with no per-terminal record object. A duplicate adds only its canonical
  node identity to the lazy render-local `Set<AtRuleStatement>` and adds no plan
  row. A second distinct key within one document occurrence lazily allocates one
  key Set. A deferred import exceptionally adds one all-null row and one lazy
  anchor array beside the already-existing deferred-import array; scalar local
  indexes relink any later result. If it resolves to no terminal, the returned
  output plan is null and no output walk runs. The existing import-once identity
  Set remains the optionless admission owner; reference and other option-bearing
  occurrences do not consume it.
- Deleted work: `cssImportKey` no longer scans target text with two RegExp tests,
  slices a tail array, or builds `some`/`map` callback carriers. The parser-owned
  statement classification is authoritative; one indexed type-only validation
  pass precedes one indexed static-key build, so a mixed typed tail returns
  without partial string materialization.
  A typed/dynamic tail that cannot supply that static key is still hoisted from
  parser classification and remains a distinct occurrence; keyability never
  controls placement.
- Render path: `emitPlannedCssImports` writes the original typed statement
  through `emitAtRuleStatementRaw` and the canonical chunk buffer. Its source
  callback preserves each imported file's rootpath/rewrite scope. The existing
  identity Set makes the later lexical statement dispatcher silent, including
  duplicate and `(multiple)` placements; no node or array is resolved merely to
  stringify.
- Helper/API surface: two private helpers are added. `appendCssImportPlan` is the
  sole owner of flat-column alignment and integer relinking;
  `emitPlannedCssImports` is the sole planned-output writer. They replace neither
  a public operation nor the fallback root-only writer; the latter remains the
  zero-import fast path. The private planner/result names now reflect the
  broadened import-fact owner. No public type, option, method, export, or
  compatibility alias is added.
- Metadata mutations: none on AST/CST/source/provenance. Only the plan's
  `head`/`tail`, flat `next` integers, aligned array cells, and the existing
  hoisted-identity Set mutate. A deferred placeholder is an all-null row in the
  same arrays rather than a second object shape.
- Review-flagged diff tokens: [loop/traversal] one branch in the existing import
  walk plus one integer-link output walk; [materialized object/array] one admitted
  plan, five lazy parallel arrays, one cell per array per unique terminal, and
  the rare deferred anchor array above—no per-terminal or per-deferred segment object; [side
  set] one existing output identity Set plus a per-document duplicate Set only
  from the second distinct key; [callback] one driver-required source callback
  per contiguous document run; [byte scan/reparse] deleted suffix regexes and no
  replacement target scan; [node construction/copy] none; [routine Error] none
  added.
- Behavior evidence: focused core import coverage passes 57/57, including exact
  lexical prelude order, authoring source transform, per-document dedupe,
  import-once, option-bearing occurrence alignment, `(multiple)`, `(reference)`,
  nested at-rule retention, and deferred insertion. The real `static-urls` fixture now places both imported CSS terminals
  first and retains only the separately ruled multiline-value spelling residual.
  The dependency-order release build, full core suite (212 files, 3363 tests),
  all-less (111/111), all-less-error (96/96), AST-v2 production ratchet (4/4),
  macro compilation with zero interpreter fallbacks, compose-integrity,
  materialization-frontier, render-buffer-frontier, guardrails, and the
  aggressive-cutting contract gate all pass. `verify:shape-stability` remains
  red on the inherited stale AST inventory (`BracketLookup`, `ImportAtRule`,
  `SpacedValue`, `VarIndirect`, and `VariableReference`); its CST inventory and
  monomorphic node-shape checks pass, and this batch changes no node factory or
  node shape. The final semantics review of `d53902409..f595c0cf1` reports all
  eight semantic invariants and incidents S1-S8 clean, with N9 deliberately
  remaining OPEN for owner settlement. The final performance-architecture
  review of `d53902409..9d3268218` reports V8 invariants 1-11 and regression
  checks R1-R7 clean, with the calibrated timing result retained as UNVERIFIED
  rather than evidence for or against speed.
- Performance evidence: no speed claim; wall-clock attribution is UNVERIFIED.
  Fixed-build A/B compared final code candidate `f595c0cf1` with parent
  `d53902409` under Node 24.11.1, using identical
  `benchmark.less` bytes and output (122320 bytes, SHA-256
  `dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85`).
  Forty-five interleaved pairs after twenty warmups measured parse+render at
  40.6351 ms versus 37.1588 ms (+9.36%, 3/45 wins) and render-only at 14.5735 ms
  versus 13.5659 ms (+7.43%, 16/45 wins). Those apparent regressions are not
  attributable to the diff: a same-commit null calibration with byte-identical
  `f595c0cf1` core artifacts (SHA-256 `40c0c5c9bb83af56…` in both roots) produced
  a larger reversed root bias—parse+render 38.1467 versus 41.5314 ms (-8.15%,
  42/45 wins) and render 14.5854 versus 15.4843 ms (-5.81%, 30/45 wins). The
  cross-worktree instrument therefore cannot resolve this change in either
  direction; deterministic operation/allocation counts are load-bearing. The
  fixture's ordinary and reference compile-time imports resolve to empty
  documents, so it exercises admission and the empty-plan lane, never terminal
  rows or the output traversal.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "OPEN N9 records the candidate that parser-classified document-root CSS terminals from executed non-reference Less imports join the output prelude while compile-time documents retain lexical execution.",
    "dangerTokensJustification": "The existing import walk carries unique terminals in five lazy parallel arrays with integer next links and no per-terminal record objects; duplicates add only their node identity to the lazy output-suppression Set. Planner admission mirrors render: only optionless imports consume the existing import-once identity, while option-bearing and transitive multiple occurrences remain independent. Output consumes the integer chain once through the canonical buffer. The no-feature bypass is unchanged, deferred insertion relinks scalar indexes in O(1) without a segment object, and target suffix regexes plus tail slice/map/some materialization are deleted. No second import traversal, AST copy, byte reclassification, WeakMap, Error control lane, or speed claim is introduced.",
    "behaviorEvidence": "Focused core import coverage passes 57/57; the owner static-urls case now has only its intentional multiline-value residual.",
    "buildEvidence": "Dependency-order release build; full core (212 files / 3363 tests); all-less (111/111); all-less-error (96/96); AST-v2 production ratchet (4/4); macro compilation with zero fallbacks; compose-integrity; materialization-frontier; render-buffer-frontier; guardrails; aggressive-cutting contract; and git diff --check pass. Invariant-by-invariant semantic and performance-architecture reviews report no blockers. Shape stability remains red only on the inherited stale AST type inventory; CST inventory and the monomorphic node-shape check pass.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 14.573459, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  },
  {
    "id": "ast-extend-import-preflight",
    "verdict": "accepted",
    "performanceClaim": "none",
    "why": "The loaded typed document remains the earliest authoritative source for imported extend placements and now also carries parser-classified CSS terminals during that same graph visit.",
    "dangerTokensJustification": "The false path still returns before collection. The admitted path adds one typed AtRuleStatement branch and flat-array rows for unique output terminals without a second graph walk or per-terminal object; existing extend collectors, overlays, and loop-placement tokens are unchanged.",
    "behaviorEvidence": "Focused import/preflight coverage passes, including no-extend imported bodies, reference visibility, source-order terminals, and deferred insertion.",
    "buildEvidence": "Dependency-order release build and the named correctness/frontier gates in the companion contract pass; focused import coverage is 57/57.",
    "falsePath": {"fixture": "extend-preflight-contract:no-extend", "counters": {"calls": 1, "collectorCalls": 0, "overlaySubjects": 0, "overlayInstructions": 0, "loopPlacements": 0}},
    "featurePath": {"fixture": "extend-preflight-contract:imported-loop", "counters": {"importsVisited": 1, "loopPlacements": 2, "overlaySubjects": 2}},
    "baseline": {"fixture": "benchmark.less", "phase": "parse-render", "currentMedianMs": 40.635125, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  }
]
```
- Verdict: accepted as an OPEN N9 candidate for landing. The invariant-by-
  invariant semantic and performance-architecture reviews report no blockers,
  and the named build, correctness, frontier, corpus, contract, and diff gates
  are complete. N9 remains OPEN pending owner settlement.

- Prior landed pass: 2026-08-25 typed URL value projection and Less `isurl()`.
  This is a bounded compatibility correction under OPEN ledger row V15, not a
  speed or neutrality claim.
- Architecture surface: canonical AST-v2 typed evaluation, the shared public
  value-domain union, eager mixin binding/dispatch, Less function and guard type
  predicates, and Sass `type-of`'s exhaustive shared-value switch. No grammar,
  parser node, Context, URL-transform policy, import path, source metadata, or
  legacy-tree path changes.
- Separation/duplication: the parser already owns `Url`. `evalTyped` projects
  that exact node to `{ type: 'Url', bytes }` after the existing `evalValue`
  transform. Ordinary emission stays on the prior string path. Both predicate
  owners read the same discriminant; no consumer name enables transport and no
  byte scan, lowercase, regex, split, or reparse decides URL-ness.
- Mixin transport: Less requires eager byte snapshots, so selected activations
  keep a sparse snapshot-to-`ValueGroup` fact only when a parameter carries a
  URL or a structural group containing one. The existing dispatch binding pass
  creates candidate-local snapshots, guard evaluation reads them through the
  canonical `evalTyped(Any)` path, rejected candidates delete them, and selected
  candidates transfer them to the activation frame. Namespace admission probes,
  transparent shells, nested calls, defaults, rest args, and `@arguments` use
  the same ownership protocol. The legacy unguarded comment-only prequeue
  consumes the already-selected dispatch result instead of running a preliminary
  `bindArgs` pass; guarded bodies retain their existing normal expansion route.
  No AST node is mutated.
- Ordinary-lane cost: an ordinary declaration URL is unchanged and allocates no
  new value object. A call with no spread retains the existing `call.args.some`
  fast exit, then argument substitution performs one URL-eligibility pass over
  each source: direct lists/sequences are walked structurally and variable roots
  are resolved/walked without evaluation. A URL-ineligible spread performs that
  same eligibility walk, then the old caller-byte evaluation and top-level byte
  split;
  it does not materialize a typed group. Every `Selection` has one fixed nullable
  `boundSourceKeys` field; ordinary values still bind as the same `Any`
  snapshots. `evalTyped(Any)` checks the activation's optional URL map and then
  the fixed nullable render-context map before ordinary materialization. Guard
  and default overlays do not copy that map or change their `Frame` shapes.
- URL-bearing dispatch cost: argument substitution retains the first positive
  non-spread source directly in the exceptional carrier and allocates a Set only
  for a second distinct source. Spread snapshots already use their exceptional
  Map and do not enter that Set. Candidate binding uses direct identity plus the
  optional Set lookup rather than repeating the structural walk per overload.
  A tracked dispatch allocates one tracker object with five closures and one
  selection-index array. Each URL-bearing candidate allocates the semantic
  `UrlValue`/group already required by typed evaluation, one candidate-local Any
  snapshot, one render-map entry, and (on first fact) one key array. A selected
  activation allocates one local Map; losing entries are deleted synchronously
  and the render Map is dropped when empty. No WeakMap or Error is added.
- Defaults and forwarding: a URL-capable computed/default source is evaluated
  once through `evalTypedSlot`; a negative result becomes the ordinary eager Any,
  while a URL-bearing result is stored beside that same snapshot. A dispatch
  with no URL-bearing authored argument creates its default-key Map only after a
  default actually evaluates URL-bearing. Forwarding reuses the activation fact,
  so rootpath/custom transformation is not applied again.
- Conservative computed lane: `FunctionCall`, `IfValue`, and `Reference` are
  URL-capable because a registered function or selected branch may return a
  public `UrlValue`. A runtime-negative occurrence therefore still allocates the
  exceptional carrier/tracker/selection-index; an additional-source Set starts
  only at a second distinct source. It evaluates once through the typed
  lane before collapsing to the ordinary eager `Any` snapshot. This is an
  explicit compatibility cost, not an ordinary-lane fast-path claim; the named
  mixin A/B and deterministic occurrence counts below measure it.
- Spread cost/shape: URL-ineligible spreads retain the old byte split. A URL-positive
  spread is typed once, then structural comma/space items become the positional
  snapshots the old splitter already created. A slash group also retains `/` as
  its own untagged positional snapshot. The exceptional spread carrier owns one
  snapshot-to-ValueGroup Map; overload candidates deliberately receive distinct
  snapshots so rejection cleanup cannot delete another candidate's fact.
- Cumulative/API weight: canonical AST/CST shapes are unchanged. The public
  alpha `Value`/`Kind` unions gain `UrlValue`/`'Url'` through both core exports;
  `makeUrlValue` stays private. `Selection` gains one fixed nullable pointer,
  `EvalCtx` one fixed nullable render Map, and `Frame` one optional activation
  Map. The Less index adds one `defineFunction`; no entrypoint or compatibility
  alias is added.
- Helper/API inventory: `hasMixinUrlSource` owns the pre-evaluation structural
  gate; `mayResolveMixinUrl` owns the cheaper default-source gate;
  `valueGroupHasUrl` inspects one evaluated group; `resolveMixinUrlBoundSource`
  and `snapshotMixinUrlValue` create the eager snapshot/fact pair;
  `boundSourceTracker`, `takeMixinUrlBindings`,
  `discardSelectedBoundSources`, `cleanupDefaultMixinUrls`, and
  `finishDefaultMixinUrls` own candidate lifetime and deterministic cleanup;
  `expandSpreadArgs`, `evalTypedSpread`, `pushTypedSpread`, and
  `pushTypedSpreadItem` own exceptional structural splatting; the named
  exceptional carrier interfaces distinguish URL-bearing prepared calls from
  ordinary `MixinCall`; and `queueCommentOnlySelectedBodies` consumes dispatch
  output without rebinding. `DefaultResolver` now returns the already-required
  eager `CallValue`; internal `isValueSlot` is reused across core files but is
  not package-exported. Each helper maps to one recognition, projection,
  lifetime, or cleanup stage; none is a compatibility alias.
- Materialization classification: `UrlValue`/URL-bearing `ValueGroup` and the
  activation Map are semantic retained state for the selected call; the nullable
  `EvalCtx` Map is render-lifetime ownership; source Sets, trackers, selection
  key arrays, default-key Maps, and spread carriers are dispatch-lifetime state;
  typed negative results and losing snapshots are transient and synchronously
  discarded. Avoided materialization includes AST copies, byte-derived URL
  nodes, WeakMaps, Error control values, comment-only rebindings, and overlay
  Frame maps.
- Metadata/render paths: no source span, root index, AST/CST node, or provenance
  table is written. `Selection.boundSourceKeys` and `EvalCtx.mixinUrlBindings`
  are fixed fields; only selected activation Frames receive the optional map.
  Ordinary declarations still render through the existing URL/string writer;
  only typed consumers of an eager mixin snapshot consult the sparse fact.
- Review-flagged diff tokens: [semantic value] one typed UrlValue; [recursive
  walks] URL-source preflight and post-evaluation ValueGroup inspection, gated to
  mixin/spread/default transport; [collections] exceptional Set, render/local
  Maps, candidate key arrays, and named carriers detailed above; [loops] spread
  item projection and deterministic rejected-key cleanup; [shape] fixed
  Selection/EvalCtx fields plus optional cold Frame field; [byte classification]
  none; [second transform/evaluation] none in dispatch, including comment-only
  bodies, which reuse the selected bindings.
- Evidence: focused core guard coverage 4/4; focused Less/Sass function coverage
  10/10; public Less function coverage 24 active / 21 pre-existing todo; Less
  corpus 111/111. Public cases pin direct/variable/control predicates, guards,
  computed/default values, comma/space/slash spread, rest, whole-list
  `extract()`, forwarding, `@arguments`, namespace/nested activations, and one
  rootpath application. Dependency-order core/fns/Less-plugin/jess builds pass;
  targeted changed-surface lint has zero errors; the whole serializer still
  reports eight inherited lint errors outside this diff.
  Full suite and adversarial review evidence will replace this focused evidence.
- Deterministic mixin workload: `scripts/fixtures/less-hotpath/isurl-mixin.less`
  executes 600 one-argument `.exercise()` calls: 200 plain aliases that never
  create a URL carrier, 200 conservative `if(...)` sources that create the
  single-source carrier/tracker but evaluate URL-negative, and 200 URL aliases
  that create one typed snapshot/fact. Because every call has only one positive
  source, the new additional-source Set allocation count is exactly zero. The
  workload also executes the 200-step recursion that generates those calls; its
  numeric argument is URL-negative.
- Fixed-build A/B (Node 24.11.1, Parseman 0.49.0, both roots resolved to their
  own `packages/**/lib` artifacts; 20 warmups / 45 alternating pairs): canonical
  `benchmark.less` parse-render 37.0692 ms before / 36.9627 ms after (-0.29%,
  20/45 wins) and render 14.9462 / 14.7488 ms (-1.32%, 24/45 wins), byte-identical
  at 122,320 bytes / `dbf75658…`. Targeted `isurl-mixin.less` parse-render 9.8258 /
  10.0116 ms (+1.89%, 14/45 wins, inside the documented noise band) and render
  9.3541 / 9.2808 ms (-0.78%, 33/45 wins), byte-identical at 58 bytes /
  `ebc5c4a4…`. Timings are confirmation-only; the allocation/occurrence counts
  above are the load-bearing cost evidence.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "OPEN V15 records that parser-owned URL syntax remains a URL at every typed consumer while byte-shaped lookalikes do not. Ordinary URL output and transforms retain their owner; eager mixin snapshots use sparse candidate-owned typed facts because their bytes cannot reconstruct URL item types.",
    "dangerTokensJustification": "Ordinary declaration URLs are unchanged. Mixin argument substitution adds one structural URL-eligibility pass; URL-ineligible spreads then retain the old byte route. URL-bearing dispatch retains its first source directly and allocates an additional-source Set only from the second distinct source, plus the explicitly inventoried tracker/closures, Maps, key arrays, carriers, ValueGroups and candidate Any snapshots; rejected entries are synchronously deleted. The named 600-call workload allocates zero additional-source Sets and records the conservative negative lane. There is no raw-source scan, reparse, byte classification, WeakMap, Error control flow, AST copy, repeated per-candidate structural scan, or second URL transform.",
    "behaviorEvidence": "Focused core guard coverage 4/4, Less/Sass direct coverage 10/10, public Less functions 24 active/21 todo, and all-less 111/111. Public exact tests cover guards, computed/default, list/forward/@arguments, namespace/nested, comma/space/slash spread, transform-once behavior, and inherited guarded comment-only output.",
    "buildEvidence": "Dependency-order @jesscss/core, @jesscss/fns, @jesscss/plugin-less and jess builds pass; targeted changed-surface lint has zero errors and git diff --check passes.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 14.748791, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  }
]
```
- Verdict: accepted and landed as `0b8b1d8c3`; no speed claim. Final evidence:
  core 212 files passed / 1 skipped (3,360 tests passed / 9 skipped / 2 todo),
  public Less functions 24 active / 21 todo, all-less 111/111, production
  ratchet 4/4, aggressive cutting, `check:macro`, and compose-integrity green.
  Semantics, performance-architecture, and API-surface reviews approved the
  exact landed commit. `verify:shape-stability` remained red only on the known
  stale broad AST inventory/`SpacedValue` allowlist; its monomorphic-shape and
  CST checks passed.

- Continuation audit: 2026-08-25 Less compatibility inventory refresh. This
  follow-up changes documentation only: no production, parser, AST, fixture,
  expected-failure, or package surface is modified.
- New traversal: none. The compact declaration/ruleset experiment was read-only
  and rejected precisely because the available speculative routes would add a
  duplicate full parse or a source scan.
- New node/materialization: none. No array, object, node, placement wrapper, or
  metadata carrier is added.
- Render path: unchanged; the refresh records existing public built-compiler
  behavior and settled import policy only.
- Helper/API surface: none added or removed. Metadata mutations: none.
- Evidence: public built-artifact probes rechecked assignment arguments, import
  options, container `style()`/`scroll-state()` queries, and the compact
  declaration failure; exact focused tests already pin the three resolved
  constructs. `git diff --check`, guardrails, and the aggressive-cutting review
  gate are the required checks for this docs-only continuation.
- Performance: shelved/not measured because the diff has no runtime code.

- Prior landed pass: 2026-08-22 Less CSS-import boundary-trivia retention. This is a
  lexical-position correctness correction for the preceding N8 candidate, not a
  performance result and not a new output-resource policy.
- Architecture surface: the Less root-document import route, Parseman's sparse
  root-trivia index, the existing identity-keyed `ValueLayout` provenance store,
  and canonical AST-v2 `AtRuleStatement` serialization. Parseman still
  classifies comments as trivia; no comment node, raw trivia-log decoder,
  import-specific parser, resolver path, or second parse is added.
- Separation/duplication: the ordinary `ImportStatement` reducer keeps its
  original three-argument children/fields/span ABI and uses that already-built
  span plus the already-captured tail-field span. It writes statement start/end
  and typed-tail start into three fixed private symbol-keyed Smi slots on the
  existing `AtRuleStatement`; public `_s`/`_e` provenance remains `NO_SPAN`.
  After Parseman returns, the existing `TriviaMap` adapter answers at most four
  exact offset lookups per root CSS import: after the keyword, before the typed
  tail, before the semicolon, and before the right operand of the one structured
  Less import-query feature. There is no catch-all interior-gap classification,
  direct sparse-row decode, or second trivia representation.
- Cumulative node weight: every `AtRuleStatement` factory result now owns the
  same three private Smi symbol slots, avoiding conditional hidden classes at an
  estimated 24 bytes per statement. A direct graph count for `benchmark.less`
  finds 15,112 typed nodes / 21,035 total objects (including 4,930 arrays), but
  only three `AtRuleStatement`s and no imports, so the measured structural
  increment there is three fixed statements / approximately 72 bytes. Public
  string-key enumeration, JSON shape, and source provenance are unchanged. Rare retained trivia
  still rides as a non-enumerable symbol on a cloned separator array stored by
  the one existing `ValueLayout` `WeakMap`; no AST child or public field is added.
- New traversal: a parse with no selected comment has no `rootTrivia` result and
  exits before the root-rule walk. A comment-bearing document performs one flat
  root-rule pass; non-at-rules cost one type comparison, ordinary at-rule
  statements read the fixed import-start sentinel, and only its non-`NO_SPAN`
  parser-owned CSS-import marker enters the exact `TriviaMap.lookup` calls at
  offsets. The adapter's successful lookup binary-searches Parseman's sparse
  rows and returns one canonical `Trivia` range; the existing later comment-table
  build reuses that `Trivia` identity. Render-time exact boundaries use one
  binary seek into the source-ordered `CommentTable`, examine only equal-start
  duplicates, and walk only that run's precomputed block-comment bounds plus
  adjacent whitespace. There is no restart at index zero, recursive document
  walk, source classifier, parse replay, or second target/tail evaluation.
- New node/materialization: no AST/CST node, captured raw-child array, parser
  state clone, boundary source scan, or source copy. Every at-rule statement's
  existing object literal grows three fixed scalar properties. A successful
  exact Parseman boundary lookup transiently materializes its adapter gap object
  and closures; `TriviaMap` canonicalizes the resulting range object for later
  use. Each retained outer import boundary allocates one fixed record, one cloned
  separator array, and the descriptor used to attach the non-enumerable symbol
  in the existing layout `WeakMap`. A structured-inner boundary allocates that
  trio on its typed `Operation`; when it is the import's only retained boundary,
  a second all-null boundary record, cloned layout, property descriptor, and
  existing-`WeakMap` entry select typed emission without taxing ordinary imports
  with a second lookup. No second side table,
  map, set, or render carrier is added.
- Render path: a CSS import without retained boundary comments keeps the existing
  whole-statement authored replay. A comment-bearing import writes the original
  at-keyword, exact parser-owned leading/inner/trailing trivia, the typed target
  (including the existing root-path transform), its typed tail, and the semicolon
  once. URL-form imports use the same boundary ownership while retaining their
  existing typed URL transform; direct quotes retain the N8 candidate's import
  transform. Mixed gaps emit block comments and adjacent whitespace, omit Less
  line comments, and mark the exact complete run in the same pass so later
  replay cannot duplicate it. The one typed `(name: @value)` import tail keeps
  an exact inner comment boundary through a specialized typed writer. The
  canonical media/container query evaluator itself is unchanged; a manually
  emitted import's typed colon tail performs one existing-store WeakMap lookup,
  whether that lookup hits retained inner trivia or falls back. A typed
  CSS import without a retained outer boundary pays one existing-store
  `WeakMap.get`; non-import at-rules perform no boundary lookup. Compile-time
  imports retain their prior paths, and nested CSS imports carry unused fixed
  offsets but never enter the root projection.
- Helper/API surface: one bounded parser projection, one private exact-gap
  chunk writer shared by outer and structured-inner boundaries, the `ValueBoundaryTrivia`
  read/write pair, and fixed import-offset readers/writers exported through the
  existing `@jesscss/core/ast` subpath for the parser/core boundary.
  `withValueBoundaryTrivia` clones a caller's readonly separator array before
  attaching metadata, so frozen public inputs remain valid. These additive alpha
  exports add no node method, visitor, output option, Context/resolver hook, or
  package entrypoint.
- Metadata mutations: every at-rule statement factory initializes three private
  symbol slots; a CSS import performs three same-map Smi stores for tail/start/end
  and never changes its public source slots. Only a cloned rare separator array gets a
  non-enumerable global-symbol property before entering the existing process-
  global identity store; parents, roots, placements, and frozen caller state are
  unchanged.
- Review-flagged diff tokens: [loop/traversal] one comment-gated flat root pass,
  one exact-range binary seek plus equal-start checks per retained boundary, and
  block-bound/adjacent-whitespace loops; [array helper] outer and structured
  boundaries write one `src.slice` per selected block comment directly through
  the canonical output buffer; [side
  table] reuse of the one existing process-global `ValueLayout` WeakMap, not a
  new table; [metadata mutation] one non-enumerable symbol on a rare separator
  cloned array plus three retained fixed private Smi slots on every factory-built
  at-rule statement; [materialized array/object] one boundary record,
  cloned separator array, and property descriptor only for a comment-bearing
  import or structured inner boundary; [node construction] the existing
  `AtRuleStatement` allocation gains three fixed scalar properties at its sole
  factory; [public API] bounded import-offset/provenance operations exported from
  the existing AST subpath; [behavior] quoted and URL-form import comments stay
  attached to the hoisted import with and without root-path rewriting, and a
  structured tail's interior comment remains inside that tail.
- Evidence: focused core provenance coverage passes 16/16; the Less public parser
  suite passes 104/104; focused Jess import-media coverage passes 14/14 and pins
  quoted, URL-form, target-only, mixed block/line, no-rewrite, and rootpath exact
  bytes. Parent-versus-current parser medians on `benchmark.less` under Node
  25.9.0 / Parseman 0.49.0 are AST 23.5998 -> 22.9819 ms (-2.62%) and CST
  30.4728 -> 30.2115 ms (-0.86%). The timing harness is confirmation-only and
  lacks a same-commit null control, so the observation is inconclusive and no
  speed or regression claim is made. The first buildable
  fold-era anchor is `15f5b9266` (Parseman 0.41.0), at AST 19.5766 ms / CST
  14.5749 ms; the current 17.40% / 107.28% long-range gap is inherited and
  material. The nominal earlier fold commit `59f695d4a`
  is not a valid anchor because its fresh artifacts import missing core exports.
  No owner-maintained CSS fixture changed. `verify:shape-stability` remains red
  identically at exact parent `4887a70b8` and current: its stale AST corpus-type
  inventory and `SpacedValue` allowlist fail, while the monomorphic-node-shape
  assertion and all five CST assertions pass. A direct V8 probe additionally
  proves populated and ordinary `AtRuleStatement`s share one map and the same
  eight own keys. Full named gates and reviews follow.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "SETTLED G24 keeps comments in trivia, SETTLED N7 owns the parser-classified direct quoted CSS-terminal import as an AtRuleStatement, and OPEN N8 records the existing root-path candidate. This batch retains that import's classified boundary trivia through root hoisting without adding comment nodes or changing the output-resource rule.",
    "dangerTokensJustification": "Comment-free parses return before the new flat root-rule pass. Comment-bearing parses query only exact parser-owned import offsets through the existing TriviaMap; a successful lookup may transiently materialize Parseman's adapter gap object, then reuses the canonical Trivia identity. Retained outer boundaries allocate one fixed record, cloned separator array, descriptor, and entry in the existing ValueLayout WeakMap. A structured-inner boundary allocates the same four facts on its Operation plus, only when no outer boundary exists, a second all-null prelude record, cloned layout, descriptor, and existing-WeakMap entry; this avoids a second WeakMap lookup on ordinary imports. One shared chunk writer slices each selected block comment directly into the canonical output buffer. Every AtRuleStatement has one fixed three-Smi private layout (three instances/about 72 bytes on benchmark.less), avoiding conditional shapes. Render ownership uses one binary seek per retained boundary and scans only equal-start runs plus precomputed block bounds; there is no packed-log decode, temporary aggregate string, restart-at-zero scan, recursive walk, source reparse, AST copy, or second side table.",
    "behaviorEvidence": "Core provenance passes 16/16, the Less public parser suite passes 104/104, and focused Jess import-media coverage passes 14/14 with exact quoted, URL-form, target-only, mixed-comment, structured-tail, inner-only, no-rewrite, and rootpath bytes. The comment-free parser test proves private offsets do not leak through sourceSpanOf. Exact-parent and current oracle runs over 751 entries produce identical AST aggregate df48aacbe43b97bf946e3edc64f8b45f6c560193ca29080f689538c10fe6f209 (122 throws) and CST aggregate 3e47129d72ddb16163374100e63b4436ea7afba80930dd7d88aa41c1d3b45f06 (0 throws): zero batch movers. The committed-baseline oracle remains red identically at the parent and current commit, so this batch does not rebaseline inherited drift.",
    "buildEvidence": "The dependency-order build:release passes. Full core passes 212 files / 3359 tests / 9 skipped / 2 todo; all-less passes 111/111; all-less-error passes 96/96; the AST-v2 production ratchet passes 4/4. check:macro reports zero interpreter fallbacks for all four parsers; verify:compose-integrity, verify:aggressive-cutting-review, verify:materialization-frontier, verify:render-buffer-frontier, verify:package-exports, and check:guardrails pass. Required grammar, performance, and semantics reviews approve with evidence per invariant. verify:shape-stability remains red identically at exact parent and current on its stale AST corpus inventory and SpacedValue allowlist; its monomorphic-node-shape assertion and all five CST assertions pass, and a direct V8 probe proves ordinary and populated AtRuleStatement instances share one map.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 45.1, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  }
]
```
- Verdict: implementation corrected through adversarial review; refreshed
  exact-parent oracle, parser performance, and full named batch gates are recorded.
  Required grammar, performance, and semantics reviews approve the exact current
  tree with evidence per invariant. This does not settle N8 and makes no speed or
  neutrality claim.

- Prior landed pass: 2026-08-22 Less A7 `(reference)` import visibility through
  extend, including hidden selector ancestry and at-rule containment. This is a
  compatibility correction, not a performance result.
- Architecture surface: canonical AST-v2 import preflight, extend IR/fixpoint,
  and flat serializer only. Parser-owned Ruleset/AtRuleBlock structure remains
  authoritative; no CSS text is scanned or reparsed and no fixture CSS changes.
- Separation/duplication: each hidden planner subject carries its nearest typed
  `PlanReferenceAtRule` occurrence (`node`, parent occurrence, placement token).
  This preserves both `AtRule > For` and `For > AtRule` without canonical-node
  ownership Maps. Extend projection records visible containers in the matching
  static or concrete-placement projection. Emission consumes those facts; it
  does not rediscover ancestry from bytes or introduce a second matcher.
- Cumulative node weight: unchanged. No AST/CST node, canonical selector,
  declaration, or imported document is copied. Visibility remains render-local
  planner state.
- New traversal: subject collection records every hidden rule, including `$for`
  bodies without an imported `:extend()` because a visible external extender may
  target them. For each hidden subject that gains a visible branch, parent
  Ruleset/AtRuleBlock occurrences are marked in their own placement projection
  until an already-marked ancestor. Emission walks only Ruleset, visible
  AtRuleBlock, and concrete `$for` structure; all direct leaves, calls, control
  blocks, modules, and opaque output remain hidden. Preflight's typed `ForItem[]`
  and placement tokens are queued by execution occurrence and reused by emission,
  so the iterable is evaluated once even when one canonical loop node is reused.
- New node/materialization: reference imports lazily allocate one hidden-rule Set
  plus one small occurrence record per visited hidden at-rule placement and one
  source-order queue record per planned canonical-loop occurrence. A
  successful pull lazily allocates rule-ancestor/at-rule Sets only in the static
  or concrete-placement projection that needs them. The ordinary no-reference
  overlay and projections retain fixed nullable slots and allocate none of these
  collections. Whole-branch dedup still allocates one presence index;
  its Set became a Map to retain the existing survivor and promote hidden to
  visible without adding a duplicate branch. Promotion clones that one render-IR
  branch rather than mutating a prior fixpoint list. The Map is filled by a loop,
  not tuple-array materialization.
- Render path: hidden imported rules and at-rule leaves remain output-silent.
  A visible extend projection emits only visible branches; a hidden selector
  ancestor contributes composition context but none of its own declarations.
  Mixed hidden/visible siblings never compact into one `:is()` branch. A
  byte-identical self-extend changes visibility even when selector text does not.
  Loaded `(inline)` bytes and CSS-import fallbacks remain suppressed only while
  nested in a reference import; an ordinary top-level driver-declined import keeps
  its established CSS fallback. Reference-document trivia advances its cursor
  without emitting; trivia inside a surfaced rule body remains visible.
- Helper/API surface: private reference-ancestor body/loop walkers and private
  visibility predicates only. `PlanOverlay`/`ExtendResults` gain internal nullable
  typed collections; no package export or public API changes.
- Metadata mutations: none on canonical nodes. Branch visibility is the existing
  extend-IR bit; promoting an identical survivor replaces its render-local branch
  with a visible clone. Imported AST parents/source spans are untouched.
- Review-flagged diff tokens: [loop/traversal] hidden-loop preflight collection,
  placement-owned stop-on-seen ancestor marking, and a cold structural emission
  walk; [side map/set] one reference-only hidden Set, occurrence records, the
  existing placement WeakMap, and success-only per-projection visibility Sets;
  [materialization] one cached typed `ForItem[]` per planned loop, no AST node/body/canonical
  selector copy, one rare render-IR visibility clone, and no per-entry tuple
  arrays in the dedup Map; [materialized array/object] placement projections and
  occurrence records exist only on the admitted reference/extend lane; [node
  construction] new Maps/Sets/records are lazy and render-local; [routine error
  control] the structural loop wrapper's `try/catch` only restores indentation
  before rethrowing an exceptional failure; [array spread/materialization] the three changed
  selector-option arrays preserve the existing ordinary replacement shape and
  omit the matched hidden seed only on the reference lane; [behavior] hidden reference
  rules become visible only through A7 extend projection, with direct leaves,
  hidden siblings, root trivia, and inline bytes pinned output-silent.
- Evidence: focused import/extend/preflight/op-budget tests pass 102/102 after a
  fresh core build; the full core suite passes 212 files / 3357 tests / 9 skipped
  / 2 todo. The
  real owner-maintained `import-reference.less` now emits direct and nested
  at-rule-contained pulls (including `.nestedToo .class`) and no hidden sibling;
  focused tests additionally pin a hidden loop with no own extend, direct hidden
  leaves/calls, source-order reuse of one canonical loop, two interpolated
  placements where only one becomes visible, hidden root trivia, retained pulled
  body trivia, and explicit `collapseNesting:true`;
  its remaining expected-failure diff is independently classified v5 `:is()`
  selector compaction, explicit nested output, comment replay, and invalid-inline
  indentation. The Less corpus passes 111/111, the AST-v2 production ratchet
  passes 4/4, macro and compose-integrity both report zero interpreter
  fallbacks, and the aggressive-cutting, semantics, and performance reviews
  pass with evidence against their full invariant sets.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "SETTLED A7 requires reference-imported rules to stay hidden until a visible extend or mixin pulls them. Typed planner facts carry branch visibility and structural ancestry so serializer output can retain only the necessary containers without parsing selector or import bytes again.",
    "dangerTokensJustification": "All new collections are lazy and reference-import-only; ordinary overlays/projections retain fixed null slots. Occurrence-owned ancestor walks stop within each placement, the cold body walk admits only typed preflight constructs, cached ForItem facts prevent a second iterable evaluation, and branch dedup fills one Map directly without pair arrays. No AST copy, source scan, reparse, error-control lane, or timing claim is introduced.",
    "behaviorEvidence": "The registry-owned semantic-runtime command passes 130/130; focused import/extend/preflight/op-budget coverage passes 102/102, full core passes 3357 tests, and the real import-reference fixture emits direct and nested A7 pulls while hidden siblings/root trivia remain absent. The repaired AST operation-count smoke records 94 subjects, 2 instructions, 66 branch comparisons, and 90 imported overlay subjects.",
    "buildEvidence": "The dependency-order build:release passes. Full core passes 3357 tests; all-less passes 111/111; the AST-v2 production ratchet passes 4/4; check:macro and verify:compose-integrity report zero interpreter fallbacks; verify:aggressive-cutting-review, verify:materialization-frontier, verify:render-buffer-frontier, and check:guardrails pass.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 45.6, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  },
  {
    "id": "ast-extend-import-preflight",
    "verdict": "accepted",
    "performanceClaim": "none",
    "why": "A Context-loaded import is the first authoritative typed source for hidden reference selectors and concrete loop placements; these facts cannot be carried before resolution, and without this source-order preflight the root extend plan would be complete before imported subjects were known.",
    "dangerTokensJustification": "The false path enters preflight once and performs zero collector, overlay, instruction, or loop-placement work. The feature path walks the loaded typed body once; reference-only Sets/occurrence records are lazy, ancestry is placement-owned, and cached typed loop items are reused by emission. No source scan, reparse, AST copy, tuple array, or speed claim is introduced.",
    "falsePath": {"fixture": "extend-preflight-contract:no-extend", "counters": {"calls": 1, "collectorCalls": 0, "overlaySubjects": 0, "overlayInstructions": 0, "loopPlacements": 0}},
    "featurePath": {"fixture": "extend-preflight-contract:imported-loop", "counters": {"importsVisited": 1, "loopPlacements": 2, "overlaySubjects": 2}},
    "baseline": {"fixture": "benchmark.less", "phase": "parse-render", "currentMedianMs": 45.6, "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85", "outputBytes": 122320}
  }
]
```
- Verdict: accepted A7 compatibility batch; no speed or neutrality claim.
  The named full gates and both required invariant-by-invariant reviews pass.

- Prior landed pass: 2026-08-22 Less common `@plugin` ABI fixed-parameter typed-list
  carry. This is an A9 compatibility correction, not a performance result.
- Architecture surface: canonical AST-v2 mixin binding and raw plugin argument
  projection only. Ordinary mixin bindings retain their established eager Less
  byte snapshots; a selected legacy raw plugin may recover a self-contained,
  parser-owned typed list/sequence that entered a fixed parameter through a
  direct variable lookup. Rest parameters and computed/reference-bearing source
  expressions remain outside this bounded carry. No parser, resolver, Context,
  node kind, or package entrypoint changes.
- Separation/duplication: the existing `isTypedCallValue` policy in
  `mixin-dispatch.ts` is renamed from its guard-specific private name and reused by
  the serializer. Typed-list classification remains structural and has one owner;
  no emitted-byte sniff, string split, reparse, or second value classifier is added.
- Cumulative node weight: unchanged. Canonical `List`, nested adjacency arrays,
  `Keyword`, and `Dimension` nodes are reused by identity. No AST node or typed
  value is copied to retain plugin provenance.
- New traversal: after a raw plugin host has registered a scoped function, one
  optional resolver runs inside `bindArgs`'s existing fixed-parameter pass. The
  first occurrence of a typed root is classified structurally once; the same
  render-local map caches positive and negative decisions, so transitive
  placements do not re-walk list members. Candidate-local snapshot keys and
  candidate-local negative classification keys are retained only through guard
  selection, then one bounded cleanup pass deletes rejected keys; canonical
  caller/definition root classifications remain until render end. A plugin first
  prepared inside the selected mixin uses a separate deprecated cold fallback only
  when no scoped plugin existed for the in-binding tracker at dispatch time: after
  preparation changes the function-scope version,
  it builds one last-write-wins named index and one prior-parameter index, then
  advances monotonically through that selected definition's fixed parameters and
  authored positional arguments to associate the already-bound snapshots in
  O(A+P). It evaluates no value a second time, uses final-occurrence named
  semantics, and declines spread/rest and computed/reference-bearing sources.
  The ordinary no-plugin lane supplies no tracker and executes the original
  prefilter allocation site.
- New node/materialization: the ordinary eager `Any` parameter snapshot remains
  the same one binding object. One render-local `Map<Binding, Binding | null>` is
  allocated lazily after a scoped raw function exists and a direct variable source
  is bound. It holds root classification entries and selected snapshot-to-root
  entries. The registered-plugin lane allocates one tracker object per dispatch
  and a key array only for a candidate that creates a positive snapshot entry;
  nonviable and guard-rejected arrays are released immediately after their entries
  are deleted. `bindArgs`'s existing named-argument map is reused on the registered
  lane; the selected-body cold fallback allocates its two linear indexes and copies
  no AST or typed value.
- Render path: dispatch passes the already spread-expanded/closure-substituted call
  to the one binding owner. `pluginRawArgument` performs one identity lookup after
  resolving the plugin call's variable argument; misses take the prior path. Flat,
  nested, and scratch emission share the same monomorphic map slot. Candidate
  objects keep their original three-field shape; a plugin-only parallel key array
  owns cleanup by candidate order, including a negative classification whose key
  is an earlier bound snapshot. The two output
  implementations both run the selected-body fallback only when the in-binding
  tracker was absent and that body's plugin preparation changes function scope.
  That fallback replays bounded typed
  placement facts but neither evaluates the bound value again nor invokes a plugin
  twice. No output pass or fallback renderer is introduced.
- Helper/API surface: optional internal `BoundSourceResolver` and
  `BoundSourceTracker` contracts, private root/source/cold-capture helpers, and one
  internal module export (`isTypedCallValue`) replace no public API. The package
  root and published declarations expose no new operation.
- Metadata mutations: every `EvalCtx`/`Emit` constructor initializes the
  `pluginRawBindings` slot to `null` in the same field order; the slot changes value
  without a hidden-class transition and is threaded through `scratchEmit`. The map
  is dropped wholesale with the render and is not a `WeakMap` or persistent graph.
- Review-flagged diff tokens: [side map/set] one lazy render-local identity and
  classification map on the already-gated scoped raw-plugin lane;
  [loop/traversal] candidate-key cleanup plus the selected-body fixed-parameter,
  argument, and prior-parameter loops described above; no source-byte scan or typed
  root re-walk after caching; [node construction] one lazy `new Map()` plus the
  pre-existing eager `Any` snapshot, with no AST/plugin-value construction;
  [materialized array/object] one registered-plugin tracker, one plugin-only
  order-indexed key array, lazy positive-key arrays, and two selected-body cold
  indexes, while eligible default lookups build the same one overlay frame the
  ordinary default resolver would have built and bypass that resolver;
  [helper] private source/tracker/cold-capture helpers; [behavior] Bootstrap's
  `breakpoint-min` now receives `tree.Value` list structure through imported,
  fixed defaulted/explicit, and transitive variable-lookup bindings, including a
  plugin first declared inside the selected mixin.
- Evidence: the focused compatibility test covers separate imported variable and
  mixin files; distinct defaulted, explicit positional, and explicit named outer
  bindings; a second fixed-parameter mixin pass-through; both
  `collapseNesting` modes; and the absence of an emitted `breakpoint-min(`
  fallback. A second test runs both output modes for a plugin first declared in
  the selected mixin and pins final-duplicate-named provenance with distinct map
  values, positional consumption across a literal-pattern overload, and two
  definitions selected by one initially untracked dispatch. The real Bootstrap
  fixture renders past `breakpoint-min`; its
  remaining expected failure is a non-plugin CSS diff. The binding-owner test
  observes exactly three resolver events for three fixed slots—in positional,
  defaulted, then named parameter order—with each event seeing the already-bound
  prefix. That test pins the registered-plugin in-binding lane; the selected-body
  capture lane is pinned separately by the body-declared-plugin regression.
- Behavior evidence: `plugin-diagnostics.test.ts` passed 12/12; focused core mixin
  suites passed 36/36; full Less corpus passed 111/111, including
  `mixins-guards.less` and the real Bootstrap fixture.
- Build evidence: dependency-ordered `pnpm run build:release` passed; core and Jess
  TypeScript build checks passed.
- Boundary evidence: full `@jesscss/core` passed 212 files / 3347 tests with 9
  skipped and 2 todo; `test:jess-ast-v2-ratchet` passed 4/4; `check:macro`
  reported 0 interpreter fallbacks for all five compiled packages; compose-integrity
  completed its clean rebuild with no grammar degradation.
- Semantics review: approved against all eight invariants and the full incident
  catalogue under SETTLED rows A9, C2, C7, and O1. No fixture CSS changed and no
  ledger action remains.
- Performance review: approved against all eleven V8 invariants and regression
  incidents R1-R7. The deterministic allocation, cleanup, and O(A+P) operation
  counts support the bounded implementation; the benchmark supplies no speed or
  neutrality claim, so `performanceClaim` remains `none`.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": [
      "ValueSlot-array-evaluation-and-authored-layout",
      "List-value-separator-and-Block-delimiter-facts",
      "reference-index-and-For-array-access",
      "Less-lazy-color-call-demand-boundary",
      "defineFunction-typed-positional-named-and-lazy-binding",
      "mixin-dispatch-ValueSlot-argument-resolution",
      "ValueLayout-provenance-side-table",
      "preserve-mode-calc-result-composition",
      "extend-composition-plan-and-fixpoint-solve",
      "Less-eager-bare-slash-precedence-and-parens-division",
      "recursive-ValueGroup-final-unit-validation",
      "async-declaration-dedup-output-order"
    ],
    "why": "A9 requires a selected legacy raw plugin to receive a self-contained parser-owned typed list/sequence that crossed fixed eager mixin parameters through direct variable lookups, while guards and normal output must keep their established byte snapshots. Rest parameters and computed/reference-bearing sources remain outside this bounded carry. This is a semantic compatibility correction with real sparse provenance state, not a neutral refactor, cost cut, or speed claim.",
    "dangerTokensJustification": "The ordinary no-plugin lane supplies no provenance tracker and uses the original three-field candidate shape and prefilter allocation site. After a scoped raw function exists, the resolver runs inside the existing fixed-parameter binding pass, caches each typed-root classification in one monomorphic render-local map, and uses a plugin-only candidate-order key array to delete snapshot and candidate-local negative-classification entries for nonviable or guard-rejected candidates; canonical caller/definition root classifications remain render-local. Only when that tracker was absent at dispatch and a selected body first registers a plugin, an O(A+P) fixed-parameter placement replay uses last-write-wins named and prior-parameter indexes; it performs no second value evaluation, source-byte scan, AST copy, second plugin call, or persistent cache, and explicitly declines spread/rest and computed sources.",
    "behaviorEvidence": "Focused plugin ABI coverage passed 12/12, including both output modes and final-duplicate-named body-plugin provenance; focused core mixin coverage passed 36/36, the full core suite passed 3347 tests, and the owner-maintained Less corpus passed 111/111 including real Bootstrap and mixins-guards.",
    "buildEvidence": "The dependency-ordered build:release, core TypeScript build, macro no-fallback gate, compose-integrity clean rebuild, and AST-v2 production ratchet all passed.",
    "baseline": {
      "fixture": "benchmark.less",
      "phase": "render",
      "currentMedianMs": 53.41333350000002,
      "outputSha256": "dbf75658b339ba3f17ce5847471bfbce575a2124d8651b6a0aa12e207df15e85",
      "outputBytes": 122320
    }
  }
]
```
- Verdict: accepted as a bounded A9 common-plugin ABI correction with
  `performanceClaim: none`; the required semantics and performance reviews both
  approved the final code, tests, and documentation with no remaining blocker.

- Latest pass: 2026-07-30 callable-body comment replay and classified Less
  mixin-signature trivia. This is a correctness batch, not a performance pass.
- Architecture surface: private Less grammar trivia scope, parser provenance,
  and AST serializer output ordering. No public AST field, node family, parser
  host, or package API is added.
- Separation/duplication: a mixin continuation uses the existing classified
  document trivia rather than a local catch-all whitespace label. The renderer
  reuses `TriviaMap.commentRuns()` instead of inventing a source scanner or a
  second full-gap map.
- Cumulative node weight: none. Canonical AST bodies remain unchanged and no
  comments become semantic child nodes.
- New traversal: one binary search finds the first sparse comment run inside a
  called body; two monotonic cursors consume only runs before successive body
  statements and its tail. This is necessary because mixin expansion moves
  output placement while source comments remain document-owned provenance.
- New node/materialization: no nodes or body copies. Pending comment strings
  are render-only boundary state until the existing writer outputs them.
- Render path: direct writer output from existing comment runs; no general
  trivia lookup, line split, full-source scan, or AST rewalk is added.
- Helper/API surface: private serializer helpers only; no public method or type
  is added.
- Metadata mutations: none. The existing emitted-comment set continues to
  de-duplicate a source run across expansion paths.
- Review-flagged diff tokens: [loop/traversal] one binary search and two
  bounded monotonic sparse-run scans; [array spread/materialization] pending
  comment strings carry authored block order only; [materialized array/object]
  cursor and pending arrays are transient render state, not AST materialization.
- Evidence: release build passed; Less public + mixin signature tests 93/93,
  core provenance 15/15, and Jess CST public grammar 19/19 passed. Macro and
  compose-integrity gates both passed with zero interpreter fallbacks. The
  all-Less corpus remains 109/110; its only red case is the known unrelated
  `tests-unit/extend/extend.less` selector expansion mismatch.
- Behavior evidence: the Less parser tests assert the comment is attached to
  document trivia and rendered after mixin expansion; provenance verifies a
  compact Parseman view cannot hide later comment gaps.
- Build evidence: `pnpm run build:release` completed after rebuilding parser
  dependencies before core and Jess.
- Boundary evidence: the Less public parse and Jess CST tests exercise both
  canonical AST output and public CST grammar paths; macro/compose gates prove
  the shipped macro parsers did not fall back to the interpreter.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "This callable-body comment replay preserves the established parser-to-provenance-to-writer ownership while mixin expansion changes output placement. It is a semantic correctness repair: no output node, source scanner, generic root-gap map, or benchmark speed claim is introduced.",
    "dangerTokensJustification": "One binary search and two monotonic cursors consume only pre-existing sparse comment ranges in the invoked body. Pending comment strings are transient render ordering state, not copied AST state; they are written through the existing serializer and never materialize a generic trivia structure.",
    "behaviorEvidence": "Focused Less public/mixin signature tests passed 93/93 and core provenance passed 15/15; each asserts attachment and emitted comment placement.",
    "buildEvidence": "pnpm run build:release passed, rebuilding parser-shared and parser artifacts before core and jess.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 45.57, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```
- Verdict: accepted as an in-progress correctness batch. This pass makes no speed
  claim. *(The "Parseman 0.44 is on its own PR branch; Jess remains on registry
  0.43" caveat recorded here has since been discharged: 0.44 was published and
  integrated in `f292fdd8f` / `b2f888070` / `d22cdb54b`.)*

- Latest pass: 2026-07-30 custom-property comment-trivia alignment. Less,
  SCSS, and Jess custom-property parts and nested groups now consume block
  comments as trivia, leaving semantic value text comment-free. The core
  provenance adapter now recognizes a legacy composed Parseman edge case: an
  index can advertise comment labels yet expose no concrete comment-kind entry.
  Only an empty labeled result falls through to the already-owned source-gap
  detector, restoring comment replay rather than treating missing packed labels
  as proof that no comments exist.
- Architecture surface: parser trivia classification and core provenance-backed
  serializer replay. No public AST field, AST node family, CSS value semantics,
  parser host, or plugin API is added.
- Separation/duplication: removes SCSS/Jess semantic comment arms so all three
  compiled overlays share Less's custom-property shape. One local labeled
  terminal classifies consumed trivia; the core branch reuses the existing gap
  detector instead of adding a second comment scanner.
- Cumulative node weight: reduced in SCSS/Jess custom values because comments no
  longer enter semantic child arrays. The parser records existing source spans;
  no node field, factory, or public collection is introduced.
- New traversal: none in normal operation. The existing cold `commentRuns()`
  fallback reads source gaps only when a legacy labeled index has zero actual
  comment ranges; nonempty labeled ranges retain the sparse packed-index path.
- New node/materialization: none. `withSourceSpan` stores existing source-span
  provenance for a custom value so the existing renderer can replay trivia; it
  does not construct or copy an AST node.
- Render path: the existing comment replay path reads the custom value span and
  document trivia ranges. It restores authored comments around value text and
  nested groups without adding comment bytes to the AST.
- Helper/API surface: no new public or parser helper. The provenance change is
  one private empty-result guard; grammar-local terminals are recognition facts,
  not exported syntax nodes.
- Metadata mutations: existing source-span and document-trivia side tables are
  populated at parse time as before. No parent, source-root, or node metadata is
  mutated during evaluation or rendering.
- Review-flagged diff tokens: [array helper] none; [array spread/materialization]
  none; [loop/traversal] no new loop; [node construction] none; [side map/set]
  none. The only runtime condition routes an empty legacy label result to the
  pre-existing source-gap query on a cold render/provenance path.
- Evidence: fresh dependency-order builds passed for core, Less parser, SCSS
  parser, and Jess parser. Focused provenance tests passed 15/15; focused custom
  property suites passed Less 31/31, SCSS 30/30, and Jess 31/31.
- Behavior evidence: each parser test asserts comment-free semantic values,
  exact source-trivia ranges, and rendered replay at outer, paren, square, and
  curly positions; the core test exercises advertised-but-empty legacy labels.
- Build evidence: `pnpm --filter @jesscss/core build`, `pnpm --filter
  @jesscss/less-parser build`, `pnpm --filter @jesscss/scss-parser build`, and
  `pnpm --filter @jesscss/jess-parser build` passed in dependency order.
- Boundary evidence: AST and public serialized CSS assertions cover the parser
  boundary; the pending macro and compose gates verify both host modes after
  this bounded source change.
- Verdict: accepted as a semantic parser/provenance repair with no performance
  claim. The fallback handles malformed legacy label metadata only; it is not a
  new general comment-collection strategy.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "This is a semantic parser/provenance repair: custom-property comments must be trivia in every compiled overlay and must replay from the existing source/document provenance path. The legacy empty-label fallback restores that contract when composed Parseman metadata omits a concrete comment entry; it makes no neutrality or speed claim.",
    "dangerTokensJustification": "The changed provenance condition adds neither a traversal, node, side map, scanner, nor general materialization route. It reaches the already-existing source-gap detector only after the packed labeled result is demonstrably empty; normal labeled comment ranges keep the existing sparse path.",
    "behaviorEvidence": "Focused core provenance tests passed 15/15; Less, SCSS, and Jess custom-property suites passed 31/31, 30/30, and 31/31 with AST, trivia-range, and rendered-comment assertions.",
    "buildEvidence": "Dependency-order builds passed for @jesscss/core, @jesscss/less-parser, @jesscss/scss-parser, and @jesscss/jess-parser.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```

- Latest pass: 2026-07-30 root-trivia map elimination. Renderer comment replay
  now consumes the source-ordered comment ranges it actually needs instead of
  materializing every root whitespace gap through Parseman 0.43's generic map.
  The pending Parseman 0.44 selected-root mode is marked explicitly so its marker
  entries continue to use its owned-gap query rather than being mistaken for full
  ranges.
- Architecture surface: parser-owned trivia provenance and AST serializer comment
  replay only; no grammar, AST public field, output CSS, or plugin API changes.
- Separation/duplication: deletes root-map construction for a comment-only render
  request. Legacy labeled logs stream one contiguous comment-bearing range at a
  time; sparse selected-root indexes remain the sole owner of their complete ranges.
- Cumulative node weight: reduced. The generic Parseman map, per-gap objects, and
  entry-index arrays are no longer reached by the Bootstrap render; only the small
  comment-range array and renderer's existing emitted-comment set remain.
- New traversal: one parser-bound linear pass over the already-packed legacy root
  trivia entries groups contiguous ranges and retains only comment-bearing ones;
  one render-time binary search finds a comment range at a requested boundary. No
  source scan, AST descendant walk, or general root-gap enumeration is added.
- New node/materialization: none. The new `TriviaRange[]` is transient parse
  provenance data, not an AST node or public collection; it replaces the much
  larger generic root-gap object/map materialization.
- Render path: direct comment lookup now binary-searches the cached source-ordered
  comment runs. Leading comment emission reads the first run, so normal authored
  content at offset zero cannot trigger a general root lookup.
- Helper/API surface: two private helpers only—`labeledCommentRangesFromEntries`
  and `commentTriviaAfter`; parser compatibility is structural and adds no public
  Jess API.
- SUPERSEDED by the parseman 0.44 migration. `labeledCommentRangesFromEntries`
  and the `rootCaptureMode` discriminator are gone: 0.44 root capture is always
  sparse selected-kind rows, whose entry spans name markers inside an owned
  range and are therefore not renderable gap ranges. The legacy all-entries
  grouping loop this batch added had no remaining producer, so `commentRuns()`
  now goes through `gapsWithKind()` alone. The cost this batch was cutting is
  cut further upstream instead: whitespace no longer produces a root entry at
  all, because only comment categories are selected.
- Metadata mutations: unchanged. Existing canonical trivia ranges remain interned
  by source range; no AST/source/parent metadata is added or mutated.
- Review-flagged diff tokens: [loop/traversal] one packed-entry grouping loop and
  one binary search replace generic all-gap construction; [materialized array/object]
  the temporary selected-comment range array replaces maps, gap objects, and entry
  index arrays for every whitespace run.
- Evidence: provenance and imported-leading-comment tests passed 54/54 after a
  fresh core build. On the exact 288,434-byte upstream PostCSS Bootstrap Less
  workload, two 61-sample interleaved runs measured Jess at 38.32 ms and 37.74 ms
  versus Less 4.8.1 at 26.85 ms and 26.68 ms; output assertions passed.
- Verdict: accepted as a measured root-trivia cost cut. Jess remains behind Less,
  so this is an active performance batch, not completion.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "Comment replay needs only ordered comment-bearing root ranges. Streaming those ranges from Parseman's packed labels and searching the cached sparse result removes generic whitespace-gap map construction without changing the canonical Stylesheet or emitted CSS contract.",
    "dangerTokensJustification": "The entry pass reads each already-recorded root trivia item once and retains only ranges containing a labeled comment. The binary search reads that small cached range list; neither path walks AST descendants, scans source, creates nodes, or materializes a generic root-gap map.",
    "behaviorEvidence": "Core provenance and imported-leading-comment tests passed 54/54, including labeled legacy fallback, sparse-index boundaries, and comment rendering at an import site.",
    "buildEvidence": "pnpm --filter @jesscss/core build passed before the exact upstream PostCSS eval-and-emit measurement.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```

- Latest pass: 2026-07-30 compiler source-fact ownership, function-dispatch,
  and warning-event cost cut. The first slice removes eager
  suppressed-function diagnostics, deletes the routine preserved-function
  warning lane, gates scoped function lookup by registered name, and makes
  surviving code frames file-indexed. The follow-up stores admitted
  compiler-originated warnings as columnar scalar rows, deferring public
  diagnostic materialization and line/frame reads to the display/result boundary.
- Architecture surface: core evaluator/serializer/context/error diagnostic
  paths, the compiler result/report boundary, benchmark evidence, and a PR gate.
  No parser, AST shape, output CSS, import, or plugin ABI is changed.
- Separation/duplication: removed duplicate lexical function resolution and
  duplicate source derivation. One `scopedFunctionNames` owner admits a lexical
  lookup; one file-owned line-start index owns offset and frame reads.
- Cumulative node weight: unchanged. No AST node fields or node factories were
  added; scoped-function facts remain optional render-frame state.
- New traversal: bounded only. A scoped name may walk parent frames that own
  registered functions; all other calls bypass it. Source replay searches are
  bounded to their existing AST spans rather than a file prefix/suffix.
- New node/materialization: none on the successful compile path. The line index
  is an off-node, lazy per-file `WeakMap` fact; admitted warnings live as parallel
  scalar arrays and construct public diagnostic objects only when reporting or
  returning a result requires them.
- Render path: ordinary function calls now dispatch directly to the flat
  registry unless their name is registered lexically. A registered function
  declining CSS-compatible arguments preserves authored bytes silently;
  silenced/capped compiler warnings do no template or frame work, retained
  warnings do no diagnostic-object work, and frame display slices indexed lines.
- Helper/API surface: `ValueEvaluator.call()` accepts an optional
  already-resolved scoped `Fn`, preserving the legacy `FnScope` input for direct
  consumers without forcing the serializer to allocate it. The transitional
  unresolved-function warning callback and code were deleted. `Context` keeps
  the existing `warnings` array-facing result API while adding a count-only
  internal reporting path and a node-attributed warning event entry point.
- Metadata mutations: only render-local `scopedFunctionNames` and existing
  frame nearest-function cache invalidation are updated during plugin loading;
  no AST/provenance mutation is introduced.
- Review-flagged diff tokens: [loop/traversal] the source-index build and
  span-bounded searches replace repeated whole-file work; [side map/set] one
  `WeakMap` caches immutable file facts and one name `Set` prevents scope walks;
  [routine error control] none on the successful path; [array helper] indexed
  frame output allocates only the returned one-to-three-line diagnostic record;
  [array spread/materialization] call-site attribution remains exclusively on
  genuine admitted diagnostic paths; [node construction] the
  name `Set` is built when functions are registered, not per call; [parent/source
  mutation] the detector matches location/source *reads*, while this pass mutates
  neither AST parents nor source provenance; [materialized array/object] a
  file-owned line-start array replaces every rejected-call whole-source line array;
  [materialized array/object] the new column arrays replace the prior JessError →
  WarningDiagnostic pair, while parser/plugin boundary objects are copied once;
  [side map/set] no new map is introduced by the collector.
- Behavior evidence: focused warning/function tests passed 29/29, including a
  silenced or repeated `warnAtNode()` that performs no template work and a public
  diagnostic array that remains unmaterialized until requested. The complete core
  suite passes 206 files / 3,261 tests (9 skipped, 2 todo). Jess Less
  `function-mode.test.ts` and `plugin-diagnostics.test.ts` pass 13/13, including
  a preserved plugin failure that remains visibly diagnosed at the result boundary.
- Build evidence: `pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit`
  and `pnpm --filter @jesscss/core build` pass on this worktree.
- Boundary evidence: `JessError` remains a plain diagnostic value (not an
  `Error` subclass); parser/public output contracts are unchanged. The existing
  `test/diagnostics.test.ts` `instanceof Error` assertion is inconsistent with
  both HEAD and the unmodified `JessError` class, so it is recorded as a
  pre-existing test-contract defect rather than fixed by adding stack capture.
- Hot-path cost contracts:
```json
[
  {
    "id": "ast-semantic-runtime-cutover",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
    "cases": ["ValueSlot-array-evaluation-and-authored-layout", "List-value-separator-and-Block-delimiter-facts", "reference-index-and-For-array-access", "Less-lazy-color-call-demand-boundary", "defineFunction-typed-positional-named-and-lazy-binding", "mixin-dispatch-ValueSlot-argument-resolution", "ValueLayout-provenance-side-table", "preserve-mode-calc-result-composition", "extend-composition-plan-and-fixpoint-solve", "Less-eager-bare-slash-precedence-and-parens-division", "recursive-ValueGroup-final-unit-validation", "async-declaration-dedup-output-order"],
    "why": "The serializer and value-evaluator changes preserve the established optional-CSS-call and scoped-function semantics while deleting the rejected-call warning lane. The separately recorded CPU profile is evidence for the active performance investigation, not a claim that this semantic-runtime record proves an A/B speed result.",
    "dangerTokensJustification": "The source index and lexical name set are render-local facts with explicit ownership. They replace repeated rejected-call scans and scope probing; neither introduces AST materialization, parser replay, an alternate evaluator, or successful-path diagnostic allocation.",
    "behaviorEvidence": "Focused core tests passed 30/30, including silent declined-call preservation, strict functionMode behavior, and direct scoped-function dispatch; the diagnostic integration test mismatch is documented separately as pre-existing.",
    "buildEvidence": "pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit and pnpm --filter @jesscss/core build passed.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  },
  {
    "id": "core-context-emit-selector-contract",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
    "cases": ["Context-plugin-source-parser-dispatch", "emit-walk-context-output-option", "Ruleset-interpolated-selector-boundary", "selector-match-string-and-node-combinators", "extend-index-tagged-graft-atoms", "Sequence-subclass-preserving-evaluation", "callable-output-root-property-guard", "serializer-at-rule-and-selector-surface"],
    "why": "Context warning admission now precedes diagnostic normalization without changing plugin/source/import behavior, selector behavior, or output policy. Declined registered calls no longer enter the warning collector at all; this semantic-runtime record does not assert a benchmark A/B result.",
    "dangerTokensJustification": "The Context change keeps policy accounting ahead of normalization and removes one former producer. It adds no resolver, parser host, AST materialization route, output array path, traversal, or runtime validation and keeps ordinary emitted CSS untouched.",
    "behaviorEvidence": "Focused warning-policy tests passed 30/30 and declined registered calls preserve bytes without warnings.",
    "buildEvidence": "pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit and pnpm --filter @jesscss/core build passed.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  },
  {
    "id": "ast-evaluator-function-call-boundary",
    "verdict": "accepted",
    "performanceClaim": "none",
    "cases": ["unresolved-optional-function-call", "registered-sync-call-failure", "registered-async-call-failure"],
    "why": "The evaluator accepts an already-resolved scoped callable from the serializer so one lexical lookup is authoritative. Optional CSS calls still preserve authored bytes, and selected callable failures continue through the established synchronous/asynchronous recovery policy rather than becoming lookup misses.",
    "dangerTokensJustification": "The added optional parameter removes a duplicate scope lookup from the selected-call path. It neither allocates an Error nor changes async recovery, registry lookup semantics, output serialization, or the normal optional-call miss result.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "verdict": "accepted",
    "performanceClaim": "none",
    "owner": "the sixteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, call, and extend owners listed by legacy-tree-strict-contract-drain",
    "cases": ["declaration-sync-and-async-render-result", "declaration-merge-source-span-exclusion", "default-guard-owned-value", "bitset-inversion-and-disjointness", "string-and-node-combinator-recognition", "selector-list-singleton-collapse", "selector-list-array-or-node-inheritance", "parser-delivered-selector-array-ampersand", "selector-array-ruleset-callable-registration", "selector-array-key-set-analysis", "function-call-silent-preserve", "selector-compose-cache-node-boundary", "ordered-registration-context-restoration", "property-merge-container-scope", "mixin-invisible-sync-render-and-registration-result", "extend-record-selector-surface", "extend-root-composition-selector-surface", "extend-walk-composed-match-selector-surface"],
    "why": "The retained legacy Call path now agrees with canonical AST-v2 function policy: a registered function that declines CSS-compatible arguments preserves the authored call silently, while explicit error mode still throws. It is a semantic compatibility correction during the tree drain, not a performance or neutrality claim.",
    "dangerTokensJustification": "The change deletes a warning construction helper and its three calls. It adds no traversal, allocation, parser replay, alternate evaluator, output policy, or runtime validation; successful preserve output remains the existing fallback call syntax.",
    "behaviorEvidence": "Focused core function-boundary and warning-policy tests passed 30/30; Jess Less function-mode fixtures passed with silent default preservation and strict error-mode failures.",
    "buildEvidence": "pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit and pnpm --filter @jesscss/core build passed.",
    "baseline": {"fixture": "benchmark.less", "phase": "render", "currentMedianMs": 44.031520500000056, "outputSha256": "4bf785413d5a150de1ba680a07b405b9e21c50facd1672b6d9a9bd36e2308781", "outputBytes": 122534}
  }
]
```
- Evidence: strict `pnpm exec tsc -p packages/core/tsconfig.build.json --noEmit`,
  `pnpm run verify:diagnostic-cold-path`, focused warning/function tests (29/29),
  and the complete core suite (206 files / 3,261 tests) pass. `pnpm --filter
  @jesscss/core build` and the targeted Jess plugin/function suite (13/13) pass.
  Exact upstream PostCSS workload:
  288,434-byte Less input, Bootstrap SHA
  `4a50207b956a4ab943640ee993118b554a34e96a23261cfe58b9aa1807a7849b`,
  paired post-collector run: Jess Less median 47.46 ms versus Less 4.8.1 at
  29.02 ms (10 warmups/30 interleaved samples); the 7,181-sample CPU profile
  has no line-location/frame-split bucket.
- Verdict: accepted as a measured cost cut. The PostCSS workload still has
  Jess Less behind Less and PostCSS, so this is one committed batch in the
  active performance goal, not completion.

> **Docs-audit note (2026-07-30, `facb641dd`).** A byte-identical duplicate of the LIVE
> pass above was appended at the end of this section and has been deleted. Three further
> `- Latest pass:` blocks (custom-property comment-trivia alignment, root-trivia map
> elimination, compiler source-fact ownership) remain below the live one, in violation of this
> section's own rule at the top: "REPLACE that block with your pass; do not append a new one
> and leave the old one behind." `scripts/verify-aggressive-cutting-review.mjs:2568-2573`
> takes the last live self-prosecution heading and then the FIRST
> `- Latest pass:` after it, so only the live block is gated — the trailing blocks are
> ungated text. They are left in place because superseding them was not verified on this
> pass; the next author to run the gate should move them to their commit messages.
