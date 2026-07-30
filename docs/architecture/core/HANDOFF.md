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
7. `~/git/oss/less.js` is off-limits. Use `~/git/worktrees/less.js/` read-only, and only for an
   explicitly authorized fixture graduation. Owner merges parseman PRs; agents never do.
8. **Working on grammars, not core?** This document is the *core architecture* entry point.
   The four-grammar rewrite has its own spec —
   [`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md), start at
   its §0 — and `AGENTS.md` is the repo-wide front door for either.
9. **Correctness has no external oracle** — see `DESIGN-DECISIONS.md` §0 (E1–E7). In
   particular the Less v5 alpha package is a thin wrapper over jess's `Compiler`
   (`docs/architecture/core/LESS-V5-CONTENT-PR-PLAN.md:18`), so it can never adjudicate a
   jess-vs-`lessc` question.

## WORK IN FLIGHT (as of 2026-07-24, `e34bb24b3`) — do not duplicate

These lanes have an agent or a live branch on them. Coordinate; do not start them fresh.
Delete a row the moment it lands or is abandoned.

### 2026-07-27 update — grammar fold complete; Less alpha guard green on parseman 0.41.0

The four parser dialects now ship from one host-mode `src/grammar.ts` each; the
old `src/ast/grammar.ts` files are deleted. The active grammar/parser floor is
registry `parseman@0.41.0`, resolved through `^0.41.0` ranges in the root,
`@jesscss/parser-shared`, and the four parser packages. Current evidence:
dependency-order parser/plugin/jess builds pass, `pnpm run check:macro` and
`pnpm run verify:compose-integrity` pass with 0 interpreter fallbacks, `pnpm run
verify:less-alpha` passes, `all-less.test.ts` is 108 / 108, and
`all-less-error.test.ts` is 94 / 94 after recursive variable/property fixtures
graduated from the worker-hang skip list. The Less byte-identity oracle
is still red against the committed baseline and must be treated as a named
classification queue before any baseline update.

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
gate + combinator cheat-sheet) is the next work — see `grammar-rewrite-037-plan.md`.**

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

**Stage 2.3 (combinator cheat-sheet at 0.37.0)** — OPEN. The original Unit 1
cheat-sheet was authored against parseman 0.32.0. Now that the bumped tree is
the authoring target it should be re-cut against 0.37.0 with the new idioms
(`peek`, `word(caseInsensitive)`, `oneOrMoreSep`, `{min,max}`, `trailing`,
`gate()` rename of `guard()`, `gating:'error'` with an `accept` allowlist,
`analyzeDuplication`/`analyzeGatingRules` on the pre-`compose()` map). It does
not block the Stage 3 collapse work; it lands alongside as a doc-only commit.

| Lane | Where | State |
| --- | --- | --- |
| ~~**parseman `0.34.0` adoption + showcase survey**~~ | jess | **SUPERSEDED** — stage 1 of the four-grammar rewrite landed parseman 0.37.0 on `dev` (commit `6908e7b4f`, 2026-07-25); see the 2026-07-25 update above. |
| ~~**Gates made reasonable**~~ | jess | **LANDED `c3db7e53e` + `e34bb24b3`** — see "Gate hygiene" below. |
| ~~**fns per-dialect registry**~~ | jess | **LANDED** — `builtins/` and `builtinLessFns` deleted; registration derives from the composed dialect indexes (`less/index.ts` = `less/` + `shared/`, same for sass); per-dialect evaluators at module scope; exports map publishes `./less`, `./sass`, `./sass/{color,list,map,math,string}`, `./shared`, `./registry`, `./less/registry`, `./sass/registry`. Implements ledger C13. Specifier resolution for `#less` / `#sass/<module>` is NOT part of it — see "`#less` / `#sass` specifier resolution" below. |
| **Numeric precision landing** | jess + less.js fixtures | Tolerance-trim, delete `emitValueInterp`, no-sci-notation guard, `ast/color.ts:118` alpha, integer fast path, `literal-tag.ts:104` fix, fixture graduation. Design: [`../../design/numeric-precision-policy.md`](../../design/numeric-precision-policy.md) — **nothing in it had landed as of `e34bb24b3`**. |
| **parseman prefix-trie choice dispatch** | parseman repo | MEASURING FIRST; may conclude "don't build". |
| **parseman docs voice sweep** | parseman repo | Removing changelog narrative from the docs. |
| **`extend-exact` state contamination** | separate session | See the KNOWN RED section below. |
| Chip sessions | jess | Stale `file-resolution.ts` claim in this file — **landed `2039165db`** (the file was deleted back in `05bfb8249`). Stale `scripts/check-macro-buildable.mjs` gate — **landed `064e3d985`**, now wired as `pnpm run check:macro`. Still open: the root `pnpm test` vitest lane (127 red files). |

## ACTIVE PRIORITY CHECKLIST — structural-rot + perf recovery

**Reconciled 2026-07-24 against `e34bb24b3`.** Every row below was re-checked against the
tree or a named commit on this pass; a row with no evidence pointer was deleted rather than
carried forward. Rows marked *unverified* state the date they were last known true.

**Process mandate:** every item is fixed via an adversarially-reviewed DESIGN change —
reviewed against `INVARIANTS.md`, the extend design, and the "parser owns structure"
keystone — BEFORE implementation. The review must score *structure, dispatch cost,
tree-walks, byte-re-derivation, duplication*, and "did this ignore an existing tuned
engine/design doc?" Those dimensions were added because the earlier correctness +
byte-identity + minimal-diff gates let all of P1 through.

### P0 — GUARDRAILS (prevent recurrence)

- [x] **LANDED `43eaf459f`, realigned `fdec1cd11`.** LLM quality-enforcement v1: deterministic
      teeth, the `perf-architecture-reviewer` (evidence per invariant, not a verdict), and
      advisory pins, all keyed to the canonical 9 invariants in `docs/perf/V8-ARCHITECTURE.md`.
      Design record: `docs/architecture/llm-quality-enforcement-design.md`.
- [ ] **No serialize-then-reparse of structure** — still prose, not a lint/assertion. The one
      known live violation is P1.1 below.

### P1 — EVAL/RENDER (see [[eval-render-perf-roadmap]])

- [ ] **1. `selectorAtoms` regex round-trip — STILL OPEN.** Verified 2026-07-24:
      `packages/core/src/ast/serialize.ts:1268` still serializes a *structured* compound to
      text and regex-tokenizes it back into atoms, un-memoized, at six call sites
      (`:1287/1291/1303/1307/1345/1379`). `packages/core/src/tree/extend/spine-extend.ts:1241`
      carries the legacy twin. Direct "parser owns structure" violation; read atoms off the
      parsed node.
- [x] **2. `documentHasExtend` full-tree walk — symbol is gone from `packages/core/src`**
      (verified 2026-07-24 by workspace grep). Whether a parse-time flag replaced it, or the
      detection simply moved, is *unverified*.
- [~] **3. Extend matching redesign — PARTIALLY LANDED.** `0818e9dc7` introduced the structured
      crossable `:is()` IR + dual-cursor fork matcher; `2fb2bb566` unified whole-branch matching
      into one recursive OR-fork matcher. Verified 2026-07-24: `extend/match.ts` no longer
      contains `.includes()` substring compares. NOT yet landed: the `O(1)` bitset fast-reject
      from [[feedback-extend-fast-reject-not-full-scan]] — no bitset exists in
      `packages/core/src/ast/extend/`; `solve.ts:25` documents only an `all`-rewrite skip as the
      fixpoint's fast-reject. `branchText` remains the branch key (`emit.ts:216/538/558/572`).
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
      once parseman `0.32.0` gated them natively. Workspace is on parseman `0.32.0`
      (`3b9e5a237`; re-verified 2026-07-24 in `packages/*/package.json`). The `0.34.0` bump is
      in flight — see WORK IN FLIGHT. **Version-lock invariant: compiled parser artifacts must
      never cross parseman versions**; regenerate every one in the same change as the bump.

### OPEN DEFECTS — each row is directly actionable (verified 2026-07-24 on `e34bb24b3`)

Durable code defects, as distinct from the transient test reds in
`docs/state/PROJECT_STATE.md`. Every file:line below was re-checked on this pass. Delete a row
when it goes green; do not let one rot into folklore.

- **Arity checking is dead on the evaluator route.** `packages/core/src/ast/value-dispatch.ts:212`
  builds the positional argument array with `definition.params.map(...)`, so any input beyond
  the declared parameter count is silently dropped before `bindDirect` ever sees it. The
  `too many arguments` throw at `:171` therefore cannot fire from an evaluator call:
  `length(a,b,c)` returns `1` instead of an arity error. Affects every fn in every dialect.
- **P1.1 — serialize-then-reparse of structure.** `packages/core/src/ast/serialize.ts:1268`
  (`selectorAtoms`) serializes a structured compound to text and regex-tokenizes it back,
  un-memoized, at six call sites. Direct "parser owns structure" (C2) violation. The legacy
  twin lives at `packages/core/src/tree/extend/spine-extend.ts:1241`.
- **Extend bitset fast-reject never landed.** `packages/core/src/ast/extend/` contains
  `compose/conflict/emit/ir/match/plan/solve` and no bitset of any spelling.
- **`jess-parser` still text-joins selector-bearing pseudo arguments.** The
  folded grammar still has `staticSelectorText`
  (`packages/syntax/jess/jess-parser/src/grammar.ts:394`, used by nth-`of` and
  generic pseudo arguments). This is the remaining gap to always-structured
  pseudo arguments.
- **`literal-tag.ts:104`** applies the old 8-dp floor to un-operated SOURCE literals
  (`dimensionFromFields` does `round(number, 8)` before the verbatim-spelling logic), so
  `0.00000000123456789` denoises to `0`. Contradicts ruling V1.
- **`packages/core/src/ast/color.ts` retains five `round(x, 8)` calls** at `:118` (alpha
  percent), `:137` (`%` channels), `:149` (hue), `:150`/`:151` (S/L) — the last 8-dp holdouts.
  (The coordinator's inventory said "4 sites"; it is 4 *concepts*, 5 calls.)
- **`evalBytesInterp` never validates units.** `packages/core/src/ast/serialize.ts:3717`
  has no `validateValueGroupUnits` call, while the ordinary value path calls it at `:3706`. A
  unit error that is fatal in a declaration value is silently accepted inside an interpolation.
  Undecided which way it should go — it deserves its own commit and an owner ruling.
- **`--x: foo(] bar`** (arbitrary token stream in a custom property) fails in all four parsers.
  That is the current limit of the shared-surface permissiveness ruling P2.
- ~~**`packages/fns/src/less/index.ts:31` exports the wrong function.**~~ **FIXED** with the
  per-dialect registry: the index now re-exports the *named* `format` (`string-format`) and
  `formatPercent` (`%`) explicitly, and both register under the names ruling A5 gives them.
- **fns port backlog.** 35 modules under `packages/fns/src` still import from `@jesscss/core`
  root (legacy tree nodes): 6 in `less/` (`each`, `iif`, `isdefined`, `isruleset`, `logical`,
  `math-factory`), 27 in `sass/`, and `shared/math/{max,min}`. They stay on the module surface
  but are not value-domain `Fn`s, so the dialect index does not register them — converting one
  in place is what registers it. `type-of`, `str-length`, and `comparable` still do not exist
  anywhere in `packages/fns/src`. There is still no alias mechanism (`separator`→
  `list-separator`, `argb`→`ie-hex-str`). The dormant `builtins/{abs,ceil,floor}.ts` that would
  have corrupted Less through `normalizeAngle` are DELETED; an audit of the landed tree finds
  zero dormant value-domain fns (92 definitions on disk, 100 registered entries — the 8
  `shared/` fns register in both dialects).
- **`extend-exact.less` flake is real cross-compile state contamination**, not test flakiness.
  Two sharing channels: the per-`Compiler` plugin instance caches
  (`packages/jess/src/index.ts:482-485`, plus the `jessPluginInstance` / `scssPluginInstance`
  singletons at `:491`/`:492`) and the module-scope dialect evaluators registered by
  `@jesscss/plugin-less` / `@jesscss/plugin-scss`. The evaluators hold only an immutable
  dispatch table, so they carry no per-render state to leak; the plugin caches remain the
  live suspect. Diagnostic: a fresh `Compiler`
  per file isolates which channel. **Constraint on any fix:** a `Compiler` must stay reusable
  across many files. "New Compiler each time" is not an acceptable fix, and neither is a
  `reset()` that callers have to remember. A separate session is on this.

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
  (`packages/syntax/jess/jess-parser/src/grammar.ts:394`) — the remaining gap to
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
  `packages/docs-content/docs/shared/04-guides/02-coming-from-sass/00-support-matrix.mdx`), and
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
  packages declare `"node": "^20.19.0 || >=22.12.0"`. `bf7286753` dropped the CI `lts/-3` leg;
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

`packages/jess/test/less/all-less.test.ts` has 32 registered expected-failure
cases, but only 21 are selected by the current alpha fixture glob and filters.
The public alpha lane runs 108 cases (measured 2026-07-24: `test:less:test-data` reports
108/108). Of these, 21 are active expected-failure checks and the rest are ordinary
byte-identical checks; the 107/86 split recorded on 2026-07-22 is superseded. The harness passes
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
`builtins/` is deleted. What remains legacy is listed in the fns port backlog
above; those modules keep their place on the dialect module surface and are
simply not registered until converted in place. The tree barrel is still not cut
— the legacy modules above still import it.

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
  **Corrected `e7a7cc037` (2026-07-24):** all 19 publishable packages now declare the same
  `"node": "^20.19.0 || >=22.12.0"` — three LTS lines (20, 22, 24), matching parseman. The
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
- Current grammar/parser work targets published Parseman `0.41.x`. The active
  follow-up is the Parseman `0.41.1` dispatch aggregate-elision candidate; adopt
  it in Jess only after owner publication, registry install, macro/compose
  proof, and matched parser measurements. Normal compiler/plugin/CLI parses
  never enable coverage or trace.
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

### Current Less v5 alpha readiness evidence

Use [`docs/state/less-v5-alpha-readiness.md`](../../state/less-v5-alpha-readiness.md)
as the current source of truth. As of 2026-07-28, the external Less branch has
the desired direct compiler/plugin dependency shape, consumes the published
`2.0.0-alpha.11` Jess runtime closure, passes local alpha package gates, and has
green PR-head CI. Do not publish Less until the owner authorizes the Less release
flow.

## Router

| Work | Read first |
| --- | --- |
| Direct parser AST construction and legacy-builder deletion | [`AST-REORG-EXECUTION.md`](./AST-REORG-EXECUTION.md) |
| Parser recognition, interpolation, and scanner cleanup | [`GRAMMAR-RELOCATION-DESIGN.md`](./GRAMMAR-RELOCATION-DESIGN.md) |
| Feature/eval closure | [`AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md`](./AST-FEATURE-COMPLETENESS-AND-ENGINE-CUTOVER.md) |
| Eval/render allocation, lookup, and traversal cuts | [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) |
| Deleting `packages/core/src/tree/` — public-surface inventory, `Context` decomposition, value-boundary options, extraction order | [`TREE-CUTOVER-SURFACE.md`](./TREE-CUTOVER-SURFACE.md) |
| **The four-grammar rewrite** — the eight-to-four physical fold is complete; continue the spec/naming/documentation and current Parseman cleanup on the four surviving host-mode grammars. Start at its §0 | [`../../design/GRAMMAR-REBUILD-SPEC.md`](../../design/GRAMMAR-REBUILD-SPEC.md) |
| The per-`const` grammar review checklist and the naming law (item 14) | [`../parser/GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md) |
| Patch-shape review | [`AGGRESSIVE-CUTTING-REVIEW.md`](./AGGRESSIVE-CUTTING-REVIEW.md) |
| Owner semantic/architecture questions and rulings | [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md) — the canonical OPEN/SETTLED decision ledger |

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

- `pnpm run verify:types` — **GREEN, 22/22 configs.** It was RED with one `less-parser`
  diagnostic (missing `CssAstSyntaxUnicodeRange`, introduced by `c1782031e`) from `13725f894`
  through `93e1aa49d`; `c3db7e53e` fixed it. `release:alpha:preflight` is no longer blocked here.
- `pnpm run test:less:test-data` — **108/108** (`all-less.test.ts`, the only fixture-backed
  Less integration authority). Note what that number now means: `e34bb24b3` registered
  `css-3.less` and `variable-advanced.less` in `expectedFailureFixtures`, so the harness
  *asserts they fail*. See below.
- `pnpm --filter jess test` — not re-measured on `e34bb24b3`. Its failures are now a named set
  in `packages/jess/test/known-failures.json`, enforced by `scripts/vitest-ratchet.mjs`; read
  that file rather than any count in a doc. (Invocation note: `pnpm --filter jess test --run`
  fails with `Unknown option: 'run'` — pass it through as `-- --run`.)

#### The Less corpus authority is an external mutable checkout

`test:less:test-data` reads its fixtures from `~/git/oss/less.js/packages/test-data`, a checkout
this repo does not pin. On 2026-07-24 the numeric-precision lane graduated four fixtures there
(`dded69cc`, "test-data: v5 numeric-precision expectations, 4.x snapshotted to legacy/"), so the
corpus encodes the *intended* v5 numbers while the jess-side change has not landed. That briefly
made the suite 106/108 with no jess-side change at all.

`e34bb24b3` resolved it the right way: both fixtures are now NAMED expected failures rather than
a bare red. Because that map *asserts* the failure, landing the precision fix will trip the entry
and demand its own deletion — the debt is visible and can only move toward zero.

| Fixture | Expected (v5, graduated) | Current jess output | Root cause |
| --- | --- | --- | --- |
| `tests-unit/css-3/css-3.less` | `rotate(-0.0000000001deg)` | `rotate(0deg)` | `literal-tag.ts:104` applies the 8-dp floor to un-operated SOURCE literals |
| `tests-unit/variables/variable-advanced.less` | `add-px-2: 393.3527559px` | `393.35275591px` | 8-dp floor instead of the tolerance trim |

A third fixture, `import-remote.less`, is network-dependent and deliberately left gating; it is
documented in `known-failures.json` so the next reader does not mistake it for a regression. It
passed in this run (network available), which is exactly why it is documented.

Consequence a fresh agent must internalize: **a Less-corpus number is only meaningful together
with the less.js checkout state.** Record both SHAs, or the count is unfalsifiable.

The graduation commit states the landed constant as a **relative tolerance of `1e-10`**, while
`docs/design/numeric-precision-policy.md` §"Job 1, concretely" still says `1e-12`. One of them
is stale; the precision lane owns reconciling them.

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
  `packages/syntax/jess/jess-parser/src/grammar.ts:78`
  `DirectJessCollection: Combinator<Collection>`). This
  sentence previously named the AST `DetachedRuleset` node, which `b7f413d08` DELETED in
  favour of the `Collection` / `AnonymousMixin` split — see
  [[collection-vs-detached-ruleset-model]]. Block-bodied lambdas reduce to `AnonymousMixin`
  (`grammar.ts:981`). Dynamic
  `$apply` targets remain rejected until `Apply` has a typed dynamic-selector
  model; static `$apply` constructs one `Apply` fact at root, rule, selected
  `$if`, mixin-definition, and `$for` body positions. `Apply` is a core
  ruleset-only, whole-selector, merge-all operation; it is not a dialect render
  policy or an ordinary `MixinCall`. R3 now
  gives `$` live/current and `$$` scoped/final references explicit
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
  retain arguments, but grammar work must not invent their syntax. `$`/`$$`
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
  every `$`/`$$` lookup mode stays on its own `VariableReference`. This records
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

## Aggressive Cutting Self-Prosecution

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
