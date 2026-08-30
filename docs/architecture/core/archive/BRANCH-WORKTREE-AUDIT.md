# Branch & Worktree Audit

**Date:** 2026-07-09  
**Canonical head at audit time:** `origin/dev` @ `3afa400e3` (advanced from `95a25ec2a` during the audit).  
**Authorized by:** owner (explicit cleanup/deletion mandate).

This catalog rules definitively on every jess branch and worktree so future sessions act instead of guess. Verdicts: **(A)** stale pointer — content already on `dev` (branch is a strict ancestor of `dev`, zero unique commits); **(B)** dead sprawl — old experiment / auto-worker / superseded spike with no unique value on the current trajectory; **(C)** unique un-merged value — worth rolling in; **(D)** protected / in-use.

## Summary

- Local branches deleted: **166** (81 category-A, 85 category-B).
- Remote branches deleted: **44** (18 category-A ancestors, 24 codex sprawl, 2 explicitly-superseded: `work/cutover`, `fix/property-in-root`).
- Worktrees removed: **0** — every worktree is either the current session, a live background session, dirty, or holds a branch still present; all left intact per protection rules.
- **Category-C roll-in candidates: effectively none.** No non-ancestor branch carries unique product code not already on `dev`. One marginal dependency-pin note below (`fix/parseman-0.18.2`).

## Category-C roll-in candidates

No branch carries unique un-merged product code. The perf-experiment lineage (`dev-tree-swap`, `jess-dev`, `feature/jess-performance-evidence`, the `*-20260619` "Cut X" frontier, `perf/ref-*`) was A/B-measured as no-speedup and is superseded by the cutover architecture now on `dev` — kept on the remote for reference, not recommended for roll-in.

One marginal note, kept (not deleted) on the remote:

- **`origin/fix/parseman-0.18.2`** (tip `4350afad1`) — bumps the `parseman` dependency pin `^0.16.0 -> ^0.18.2` across package.json files. `dev` still pins `^0.16.0` (local dev uses an uncommitted `link:` override). **Roll-in:** trivial to redo on `dev` once parseman `0.18.2` is published — re-apply the one-line pin bump rather than merging the branch.

## Worktrees

| Path | Branch | State | Verdict |
|---|---|---|---|
| `/Users/matthew/git/oss/jess` | `feature/less-v5-alpha-readiness` | clean | protected (main checkout) |
| `/Users/matthew/git/worktrees/jess-branch-analysis` | `docs/branch-consolidation-analysis` | clean | keep (docs branch, in-use signal) |
| `/Users/matthew/git/worktrees/jess-caseB` | `cutover/interp-import-caseB` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-cst-fix` | `work/cst-core-free-fix` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-cutover-p1` | `(detached 3b75c4dbf)` | clean | keep (ambiguous detached) |
| `/Users/matthew/git/worktrees/jess-dev` | `jess-dev` | DIRTY (4) | keep — needs owner eyes (uncommitted) |
| `/Users/matthew/git/worktrees/jess-dev-cst` | `dev` | clean | protected (dev) |
| `/Users/matthew/git/worktrees/jess-extend-cov` | `work/extend-coverage-tests` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-extend-prod` | `work/extend-production` | DIRTY (1) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-extend-wirein-staged` | `work/extend-wirein-staged` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-import-edge` | `work/import-edge-modes` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-import-spec` | `work/import-spec-routing` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-merge-across` | `work/merge-across-fold` | clean | PROTECTED (live gate-8 session) |
| `/Users/matthew/git/worktrees/jess-nested-mixin` | `work/nested-container-mixin` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-p4-plan` | `work/p4-deletion-plan` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-parser-build` | `feature/jess-parser-build` | DIRTY (2) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-parser-core-free-cst` | `feature/parser-core-free-cst` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-perf-baseline-dev` | `(detached f279938d2)` | DIRTY (2) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-perf-loopmeasure` | `perf/reprofile` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-perf-refnuke` | `perf/ref-nuke` | DIRTY (1) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-perf-w1` | `perf/slim-rules-flags` | DIRTY (1) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-perf-walk` | `(detached dc2a1e462)` | current session | PROTECTED (this session) |
| `/Users/matthew/git/worktrees/jess-readmes` | `work/parser-readmes` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-ref-import` | `cutover/reference-import` | DIRTY (1) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-root-fold` | `cutover/root-merge-cond` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-root-fold-gates` | `cutover/root-fold-gates` | DIRTY (2) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess-test-audit` | `audit/core-test-slim` | clean | keep (docs/audit branch) |
| `/Users/matthew/git/worktrees/jess-trivia-audit` | `work/trivia-audit` | clean | keep (branch present) |
| `/Users/matthew/git/worktrees/jess-trivia-cleanup` | `work/grammar-trivia-cleanup` | DIRTY (4) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess/ecstatic-colden-ec0455` | `ecstatic-colden-ec0455` | clean | keep (agent worktree) |
| `/Users/matthew/git/worktrees/jess/exciting-feistel-e710b4` | `exciting-feistel-e710b4` | DIRTY (2) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess/friendly-dhawan-ceadd1` | `friendly-dhawan-ceadd1` | DIRTY (2) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess/hopeful-thompson-191cb2` | `hopeful-thompson-191cb2` | DIRTY (2) | keep — needs owner eyes |
| `/Users/matthew/git/worktrees/jess/lucid-nightingale-f7e027` | `(detached ffe8aaa06)` | clean | keep (agent worktree) |

> Note: no worktree was removed. All branches that were checked out in a worktree were treated as in-use and kept (a checked-out branch also cannot be deleted). Dirty worktrees are flagged for owner review.

## DELETED (recoverable) — local branches

Recover any with `git branch <name> <hash>`.

### Category A — stale pointers (were strict ancestors of `dev`)

| Branch | Tip | Subject |
|---|---|---|
| `backup/parseman-preperf` | `d69efd090` | merge(less/bootstrap2): capture special-char detached ruleset as raw Quoted (bootstrap parses fully) |
| `codex-auto-worker/less-at-rules-comments-20260422-113144` | `fc27b0ed1` | Fix Less at-rule prelude comment rendering |
| `codex-auto-worker/less-comments-20260422-124515` | `2f389547c` | feat: compile task registry from docs and less failures |
| `codex-auto-worker/less-comments-comments2-20260422-125639` | `2f389547c` | feat: compile task registry from docs and less failures |
| `codex-auto-worker/less-comments-declaration-comment-spacing-20260422-135008` | `c2bc3d8bb` | Fix Less declaration comment spacing |
| `codex-auto-worker/less-comments-invisible-node-trivia-20260422-140316` | `a21d899e2` | Preserve comments before invisible Less vars |
| `codex-auto-worker/less-comments-selector-comment-trivia-20260422-141731` | `398e56759` | tasks: refresh generated registry |
| `codex-auto-worker/runtime-db-bootstrap-20260420-190025` | `4ac81eb26` | fix: harden durable auto-loop execution flow |
| `codex-auto-worker/runtime-db-bootstrap-20260420-234924` | `5e3abd2ff` | fix: validate worker submissions from durable root |
| `codex-auto-worker/runtime-db-bootstrap-20260421-172442` | `9e67a0fb7` | fix: honor runtime terminal status in operator tasks |
| `codex-auto-worker/runtime-db-bootstrap-20260422-110211` | `1b7ed6c41` | Add isolated-worktree Less Vitest config |
| `codex/durable-task-memory` | `bdea380b1` | tasks: split selector comment parity work |
| `codex/track3-less-compat-adapters` | `1ccbc54dd` | refactor: preserve comment trivia in collapsed output |
| `cutover/ximport-transitive-extend` | `434105d6e` | docs(cutover): extend-through-import (plain transitive) → Landed |
| `dev-antlr` | `489e498c5` | Adding the DefaultErrorStrategy |
| `dev-backup-pre-squash` | `613a06366` | Update scss/less parsers and scss plugin |
| `dev-data-value-conversion` | `f5b05b5e8` | fix: repair stale _value reference in ComplexSelector.valueOf |
| `dev-freeze` | `9419b1a2d` | Current WIP |
| `dev-rewrite` | `c36b526d5` | API tweak |
| `dev-rewrite-rescue-20260119-131038` | `c36b526d5` | API tweak |
| `dev-save-recursive-parser` | `4589e8ae6` | Merge branch 'dev-data-value-conversion' into dev |
| `dev-temp` | `c57de8330` | Lots of mixin fixes |
| `feat/mixin-fold` | `e2b88fbff` | feat(core): MIXIN fold #6 — intermediate-scope closure folds; lift the narrow gate |
| `feature/jess-aggressive-cut-simplify` | `f36e8c392` | Preserve callable source-child ownership |
| `feature/jess-doc-archive-cleanup` | `e3c42c014` | Prune abandoned architecture docs |
| `feature/jess-measurement-audit-20260619` | `3e871385a` | Merge remote-tracking branch 'origin/dev' into feature/jess-performance-evidence |
| `feature/jess-performance-experiment-a` | `a2cd0de0d` | Trim hot render and node checks |
| `feature/jess-performance-experiment-b` | `c203e7990` | Slim source ancestry and lookup normalization |
| `feature/jess-performance-experiment-b-isnode` | `a2cd0de0d` | Trim hot render and node checks |
| `feature/jess-performance-experiment-c` | `c203e7990` | Slim source ancestry and lookup normalization |
| `feature/jess-performance-experiment-c-codex` | `e7b9aa22e` | Speed selector key lookup dispatch |
| `feature/jess-performance-experiment-d` | `c203e7990` | Slim source ancestry and lookup normalization |
| `feature/jess-performance-experiment-d-node-shape` | `a2cd0de0d` | Trim hot render and node checks |
| `feature/jess-performance-experiment-e` | `f36e8c392` | Preserve callable source-child ownership |
| `feature/jess-performance-experiment-f` | `f36e8c392` | Preserve callable source-child ownership |
| `feature/jess-performance-experiment-g` | `155a20cc8` | Make performance work queue-driven |
| `feature/jess-reference-lookup-cutting` | `3e871385a` | Merge remote-tracking branch 'origin/dev' into feature/jess-performance-evidence |
| `feature/jess-reference-lookup-cutting-2` | `3e871385a` | Merge remote-tracking branch 'origin/dev' into feature/jess-performance-evidence |
| `feature/jess-scope-lookup-experiment` | `0d25b777f` | Merge remote-tracking branch 'origin/dev' into feature/jess-scope-lookup-experiment |
| `feature/parseman-typefixes` | `d48c18e2f` | fix: reduce commit-gated TypeScript errors to zero |
| `feature/parser-rule-ast-audit-20260619` | `3e871385a` | Merge remote-tracking branch 'origin/dev' into feature/jess-performance-evidence |
| `feature/reference-direct-lookup-child-entry` | `3e871385a` | Merge remote-tracking branch 'origin/dev' into feature/jess-performance-evidence |
| `feature/reference-eval-wrapper-collapse` | `3e871385a` | Merge remote-tracking branch 'origin/dev' into feature/jess-performance-evidence |
| `feature/scanner-first-parser-docs` | `ebba441c7` | Parse attached Less extends in scanner AST |
| `fix/reference-extend-render-unlock` | `b80cc5579` | fix(core): render-unlock a spine extend TARGET in a (reference) body (false-green fix) |
| `fsdispatch-verify` | `12559afa6` | merge(less/important-collection): emit !important on Collection-valued declarations (serialize guard dropped genuine flag) |
| `import/reference-render-model` | `c9cb47e07` | Finalize import parity and wire less-compat via fixture compile plugins. |
| `investigate/detached-rulesets-regression` | `db2478055` | Fix Less each regressions without global reorder. |
| `investigate/parse-perf` | `4f1315173` | refactor(jess-parser): flatten nested single-sequence in refIndex/DollarInterp |
| `less/at-rule-serialize` | `926b9ba13` | docs(less-integration): dialect is PER-FILE (own vocabulary), not per-compile; imported Less-4 partials stay compat; only global strict:true forces all files strict |
| `no-allstar` | `05728d7b5` | Node mutation fixes |
| `overlay-lookup-refactor` | `e68caf3a0` | refactor(scss-parser): move extend handling back into parser context |
| `perf/core-residuals` | `02337863c` | perf: optimize canReuseLeaf to use isSourceFree flag check instead of field read |
| `perf/drop-subnode-spans` | `468747cc7` | perf(core): drop per-sub-component span arrays; comments via node-span scan |
| `perf/dry-ownrules` | `7b0998231` | perf: consolidate ownRules() implementations into shared copyNodesForOwnership() utility |
| `perf/fastv8-sweep` | `a652e89c7` | perf(core): remove V8-hostile descriptor/defineProperties patterns |
| `perf/grammar-thinning` | `be826ec02` | fix(jess-parser): SelectorCapture interior needs rw trivia (regression from wrapper-thinning) |
| `perf/kill-dead-cst` | `cc9888e29` | perf(core): delete dead provenance CST plumbing (cstState/cstChildren) |
| `perf/provenance-inline` | `2b39c8072` | perf(core): inline source-span provenance onto Node, kill PROV WeakMap |
| `perf/slim-frozen` | `afcffa0e4` | perf(core): move Node.frozen into F_FROZEN flag bit, drop per-instance field |
| `perf/slim-pseudo` | `7593cb53e` | perf(core): SLIM #4 — make PseudoSelector.generatedPseudoPlacementOverride lazy |
| `perf/slim-selector` | `f3a3c0219` | perf(core): SLIM #2 — drop dead Selector.isSelector field |
| `perf/w1-single-writer` | `64ad43933` | perf(serialize): reuse shared writer via mark/getSince/restore for convertible fragment sites |
| `perf/w2-refresh` | `b629d5af4` | perf(print): make OutputWriter.refreshPositions incremental |
| `slim-rules-lookup-a94fa075` | `458e7dae2` | perf(core): remove dead Ruleset.frames field (~12k instances) |
| `work/amp-seam` | `e6aa4482b` | feat(core): parallel index-driven extend DISCOVERY prototype + differential reference |
| `work/cutover-p1` | `3b75c4dbf` | docs(cutover): M8 interpolated-name fold ✅ (V4/R2 verified non-features); tip 5869859ad |
| `work/dupfull` | `9405044f1` | perf(core): Phase D slice 1 — delete AtRule.frames, walk supplies hoist ancestry |
| `work/extend-corpus` | `02bc409a7` | docs(core): WITHDRAW extend gate 1 — invalid-input artifact, not a real rule |
| `work/extend-graft` | `b502b1cfb` | docs(flag-walk): Phase D log — slice-1 DONE, slice-2 WON'T-DO (intrinsic eval), next candidate |
| `work/extend-index` | `7d7e4d706` | docs(core): design spec — extend as a closed term-rewriting system over a selector IR |
| `work/import-residuals` | `fa525e055` | docs(cutover): IMPORT residuals design pass — 4 sequencing specs + nested-linking fold logged |
| `work/interpolated-name-fold` | `5869859ad` | feat(core): fold M8 — interpolated-selector ruleset as a mixin-call target onto the spine |
| `work/investigate-eval-clones` | `bc77ab11a` | Merge: fix explicit calc() composed-with-operation mis-serialization |
| `work/mixin-merge-fold` | `b4e45b1bd` | fix(core): gate merge-across-mixin off the spine (byte-identical to eval; close a mis-fold) |
| `work/p4-terminal-rework` | `cb19de6bc` | feat(core/spine): FOLD C — non-recursive nested-call-in-body folds (mixin #1); recursion gap sequenced |
| `work/phaseD-ancestor-2` | `49856a157` | feat(core): extend-index own-construction engine (delegation off) + tree/extend/ home |
| `work/phaseD-hoist` | `9405044f1` | perf(core): Phase D slice 1 — delete AtRule.frames, walk supplies hoist ancestry |
| `work/phaseD-render-ancestor` | `205fea9c4` | Merge remote-tracking branch 'origin/dev' into perf/walk-collapse |
| `work/rules-budget` | `cc431b17e` | docs(core): RULES/RULESET class-unique field budget audit (≤5) |
| `worktree-agent-a94fa075f9dbf0033` | `c36b526d5` | API tweak |

### Category B — dead sprawl / superseded experiments

| Branch | Tip | Subject |
|---|---|---|
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-20-tests-unit-selectors-selectors-less--20260419-194417` | `19b588c84` | docs: clarify selectors parity blocker |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-24-tests-unit-operations-operations-advanced-less--20260419-195248` | `a7304b21d` | docs: clarify operations advanced task is already aligned |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-27-tests-unit-import-import-reference-less--20260419-195810` | `8e320e449` | docs: mark import-reference as mixed needs-human |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-34-tests-unit-import-import-remote-less--20260419-200426` | `1ada6972f` | docs: mark import-remote queue item as already verified |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-38-tests-unit-media-media-less--20260419-201009` | `a18b403d4` | docs: reclassify media less parity task |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-43-tests-unit-mixins-guards-default-func-mixins-guards-default-func-less--20260419-201843` | `3d7b8c078` | docs: mark mixins default guard fixture green |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-44-tests-unit-mixins-guards-mixins-guards-less--20260419-202523` | `ba473d6d0` | docs: mark mixins guards recovery status |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-45-tests-unit-mixins-interpolated-mixins-interpolated-less--20260419-203201` | `082592dd8` | docs: clarify mixins-interpolated parity stop |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-50-tests-unit-property-accessors-property-accessors-less--20260419-203858` | `57545f85e` | docs: clarify property accessor handoff ambiguity |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-56-tests-unit-rulesets-rulesets-less--20260419-204433` | `a86347018` | docs: refresh rulesets fixture status |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-61-tests-unit-functions-functions-less--20260419-204815` | `cec5f06ca` | fix: clarify deferred auto-loop tasks |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-78-tests-unit-ie-filters-ie-filters-less--20260419-205033` | `202a26b70` | docs: mark ie-filters task as stale |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-79-tests-unit-nesting-nesting-less--20260419-205417` | `d2001ab41` | docs: retire nesting handoff regression note |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-81-tests-unit-extend-chaining-extend-chaining-less--20260419-205940` | `76ad6fc04` | test: refresh extend-chaining tracking |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-82-tests-unit-extend-nest-extend-nest-less--20260419-210454` | `c19b4c761` | test: sync extend-nest proof with current fixture |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-83-tests-unit-extend-selector-extend-selector-less--20260419-211148` | `13c82d718` | docs: record extend-selector recovery |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-84-tests-unit-extend-extend-less--20260419-211829` | `ba8727819` | docs: classify extend.less as rebaseline |
| `codex-auto-worker/less-color-functions-rgba-20260422-122618` | `d7925f720` | Fix Less rgba fixture parity |
| `codex-auto-worker/less-tests-unit-at-rules-at-rules-less-20260420-084743` | `172a4c6db` | fix: harden auto-loop acceptance |
| `codex-auto-worker/less-tests-unit-at-rules-bubbling-at-rules-bubbling-less-20260420-083217` | `20bcd4564` | docs: record at-rules-bubbling warning ambiguity |
| `codex-auto-worker/less-tests-unit-at-rules-keyword-comments-at-rules-keyword-comments-less-20260420-083649` | `259d60ddf` | fix: preserve at-rule keyword comments |
| `codex-auto-worker/runtime-db-bootstrap-20260420-184340` | `f1b6ac68b` | feat: bootstrap durable task runtime db |
| `codex-auto-worker/runtime-db-bootstrap-20260420-185039` | `5307b2251` | fix: align runtime task status semantics |
| `codex-auto-worker/runtime-db-bootstrap-20260420-185559` | `b2d75fcd5` | fix: align runtime state effective task status |
| `codex-auto-worker/runtime-db-bootstrap-20260420-205251` | `8462aabfc` | fix: align runtime needs-human status with task schema |
| `codex-auto-worker/runtime-db-bootstrap-20260420-235117` | `d4dfcd253` | fix: bootstrap runtime-backed operator status |
| `codex-auto-worker/runtime-db-bootstrap-20260421-074849` | `16aea082a` | fix: avoid bootstrapping runtime db on status |
| `codex-auto-worker/runtime-db-bootstrap-20260421-085112` | `134601e7c` | fix: align runtime task status with leases |
| `codex-auto-worker/runtime-db-bootstrap-20260421-091555` | `87578b173` | fix: adopt compatible unversioned runtime dbs |
| `codex-auto-worker/runtime-db-bootstrap-20260421-093256` | `c69bead08` | Harden runtime DB bootstrap validation |
| `codex-auto-worker/runtime-db-bootstrap-20260421-125626` | `cb31cd8db` | fix: validate runtime db table shapes |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-113-1-track-1b-1c-completion-shared-tree-convergence-plus-eval-render-merge--20260419-160840` | `4402c887b` | docs: clarify remaining track 1b and 1c work |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-117-2-serializer-backtracking-buffered-render-track-5-the-audit-shows-20260419-161135` | `f91fe43da` | docs: classify track 5 as needs-human gate |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-131-3-clone-copy-materialization-pressure-node-clone-node-copy--20260419-161535` | `4e5b8cb82` | docs: narrow clone debt task status |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-134-4-remaining-generic-registry-query-overhead-in-rules-registries-the-20260419-162002` | `950375487` | docs: narrow registry overhead planning bucket |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-20-tests-unit-selectors-selectors-less--20260419-162239` | `3077184df` | feat: add codex auto loop scripts |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-24-tests-unit-operations-operations-advanced-less--20260419-164709` | `1272ba2eb` | docs: clarify operations-advanced proof coverage |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-27-tests-unit-import-import-reference-less--20260419-165412` | `04364989f` | docs: mark import-reference fixture as mixed red |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-34-tests-unit-import-import-remote-less--20260419-170214` | `3077184df` | feat: add codex auto loop scripts |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-38-tests-unit-media-media-less--20260419-170718` | `2ce6703e4` | docs: mark media less as intentional rebaseline |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-43-tests-unit-mixins-guards-default-func-mixins-guards-default-func-less--20260419-171219` | `415cb4e00` | docs: mark mixins default guard fixture recovered |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-44-tests-unit-mixins-guards-mixins-guards-less--20260419-172054` | `e1af6b787` | docs: mark mixins guards recovery status |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-45-tests-unit-mixins-interpolated-mixins-interpolated-less--20260419-172626` | `e43f8781c` | docs: reclassify mixins-interpolated drift |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-50-tests-unit-property-accessors-property-accessors-less--20260419-173522` | `76f3e7feb` | docs: mark property accessors rebaseline |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-56-tests-unit-rulesets-rulesets-less--20260419-174351` | `11911f1e5` | docs: mark rulesets rebaseline |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-61-tests-unit-functions-functions-less--20260419-175625` | `26c87ffa6` | test: align functions less expectations with alpha fixture |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-78-tests-unit-ie-filters-ie-filters-less--20260419-180249` | `85b21529c` | docs: classify ie-filters as removed less fixture |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-79-tests-unit-nesting-nesting-less--20260419-180708` | `89796c846` | docs: retire nesting handoff regression note |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-81-tests-unit-extend-chaining-extend-chaining-less--20260419-181348` | `8a6de2de3` | test: refresh extend-chaining tracking |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-82-tests-unit-extend-nest-extend-nest-less--20260419-182439` | `efeb008bd` | docs: classify extend-nest as fixture drift |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-83-tests-unit-extend-selector-extend-selector-less--20260419-183143` | `e863d5c34` | docs: mark extend-selector parity recovered |
| `codex/auto-less-recovery/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-84-tests-unit-extend-extend-less--20260419-183914` | `a4c6087a0` | docs: classify extend.less as rebaseline |
| `codex/auto-less-recovery/smoke-auto-loop-smoke-20260419-150207` | `41993ab53` | fix: clarify auto-loop dependency-blocked all-less smoke |
| `codex/auto-less-recovery/smoke-auto-loop-smoke-20260419-154753` | `596c7ba80` | fix: use a safe codex auto worker branch prefix |
| `codex/auto-loop` | `172a4c6db` | fix: harden auto-loop acceptance |
| `dev-chevrotain-allstar` | `43e3893a6` | Improve logs |
| `dev-squashed` | `2a9153c2b` | feat: Create runtime objects |
| `dev-tree-swap` | `c9f469de5` | StyleImport: drop remaining two clone(true) sites |
| `feature/call-arg-copy-frontier-20260619` | `133f0102d` | Wrap parser examination handoff |
| `feature/callable-collection-frontier-20260619` | `133f0102d` | Wrap parser examination handoff |
| `feature/chevrotain-cache-investigation` | `75c51f032` | Add Less parser phase profiler |
| `feature/core-arch-agent-a` | `652a8524c` | Merge origin/dev into feature/core-arch-agent-a |
| `feature/core-arch-agent-b` | `064b59502` | Merge remote-tracking branch 'origin/dev' into feature/core-arch-agent-b |
| `feature/core-arch-agent-c` | `c957cd73d` | Merge remote-tracking branch 'origin/dev' into feature/core-arch-agent-c |
| `feature/direct-decl-child-entry-scan` | `4dc3e81db` | Cut reference lookup result wrappers |
| `feature/hot-helper-metadata-audit-20260619` | `42cca3f60` | Cut Less value production OR allocation |
| `feature/jess-performance-evidence` | `a373a6bc2` | Cut reference and callable binding copies |
| `feature/jess-performance-evidence-validation-20260619` | `133f0102d` | Wrap parser examination handoff |
| `feature/jess-render-materialization-cut-20260619` | `42cca3f60` | Cut Less value production OR allocation |
| `feature/parser-production-machinery-cut` | `8369a2e42` | Experiment with direct Less value dispatch |
| `feature/parser-tokenizer-cutting` | `0c8c959a7` | Cut parser value token conversion closures |
| `feature/reference-callable-cutting-20260619` | `42cca3f60` | Cut Less value production OR allocation |
| `feature/reference-callable-direct-cut-20260619` | `2fa2f1c64` | Cut reference lookup strategy cache |
| `feature/reference-direct-lookup-cut-20260619` | `66518e649` | Cut callable lookup closure scaffolding |
| `feature/reference-nonstatic-decl-copy-frontier-20260619` | `133f0102d` | Wrap parser examination handoff |
| `feature/render-materialization-frontier-20260619` | `133f0102d` | Wrap parser examination handoff |
| `feature/render-preview-duplicate-declaration-cut-20260619` | `2fa2f1c64` | Cut reference lookup strategy cache |
| `feature/visitor-selector-traversal-audit-20260619` | `2fa2f1c64` | Cut reference lookup strategy cache |
| `fix/parseman-0.18.2` | `4350afad1` | chore(deps): bump parseman ^0.16.0 -> ^0.18.2 |
| `fix/property-in-root` | `f4e6e00a7` | fix(core): error on detached-ruleset-as-property-value + valid-length hex only |
| `lucid-nightingale-f7e027` | `ffe8aaa06` | fix(extend): materialize string-backed selector in extend-not-accessible probe |
| `perf/loop-measure` | `9f5592205` | docs(perf): SLIM NODES audit — ranked node-shape slimming plan |
| `perf/ref-specialization-regressed-backup` | `dd1ac54a2` | perf(parsers): route Reference construction through createReference |
| `work/cutover` | `77dbd49a2` | test(core): RATCHET harness locking the single-eval-emit cutover gains |
| `work/srp-b1s` | `68343c2b3` | spike(core): B1s per-frame-lookup seam — REFUTED (flag-gated shadow validator) |

## DELETED (recoverable) — remote branches (`origin/*`)

Recover any with `git push origin <hash>:refs/heads/<name>`.

| Branch | Tip | Subject |
|---|---|---|
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-20-tests-unit-selectors-selectors-less--20260419-193031` | `ed8007e43` | docs: narrow selectors handoff status |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-20-tests-unit-selectors-selectors-less--20260419-194417` | `19b588c84` | docs: clarify selectors parity blocker |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-24-tests-unit-operations-operations-advanced-less--20260419-195248` | `a7304b21d` | docs: clarify operations advanced task is already aligned |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-27-tests-unit-import-import-reference-less--20260419-195810` | `8e320e449` | docs: mark import-reference as mixed needs-human |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-34-tests-unit-import-import-remote-less--20260419-200426` | `1ada6972f` | docs: mark import-remote queue item as already verified |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-38-tests-unit-media-media-less--20260419-201009` | `a18b403d4` | docs: reclassify media less parity task |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-43-tests-unit-mixins-guards-default-func-mixins-guards-default-func-less--20260419-201843` | `cec5f06ca` | fix: clarify deferred auto-loop tasks |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-44-tests-unit-mixins-guards-mixins-guards-less--20260419-202523` | `ba473d6d0` | docs: mark mixins guards recovery status |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-45-tests-unit-mixins-interpolated-mixins-interpolated-less--20260419-203201` | `082592dd8` | docs: clarify mixins-interpolated parity stop |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-50-tests-unit-property-accessors-property-accessors-less--20260419-203858` | `57545f85e` | docs: clarify property accessor handoff ambiguity |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-78-tests-unit-ie-filters-ie-filters-less--20260419-205033` | `202a26b70` | docs: mark ie-filters task as stale |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-79-tests-unit-nesting-nesting-less--20260419-205417` | `d2001ab41` | docs: retire nesting handoff regression note |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-81-tests-unit-extend-chaining-extend-chaining-less--20260419-205940` | `76ad6fc04` | test: refresh extend-chaining tracking |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-82-tests-unit-extend-nest-extend-nest-less--20260419-210454` | `cec5f06ca` | fix: clarify deferred auto-loop tasks |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-83-tests-unit-extend-selector-extend-selector-less--20260419-211148` | `13c82d718` | docs: record extend-selector recovery |
| `codex-auto-worker/doc-docs-future-performance-2026-04-13-registry-redesign-handoff-md-84-tests-unit-extend-extend-less--20260419-211829` | `cec5f06ca` | fix: clarify deferred auto-loop tasks |
| `codex-auto-worker/less-at-rules-comments-20260422-113144` | `fc27b0ed1` | Fix Less at-rule prelude comment rendering |
| `codex-auto-worker/less-comments-declaration-comment-spacing-20260422-135008` | `c2bc3d8bb` | Fix Less declaration comment spacing |
| `codex-auto-worker/less-comments-invisible-node-trivia-20260422-140316` | `a21d899e2` | Preserve comments before invisible Less vars |
| `codex-auto-worker/less-tests-unit-at-rules-bubbling-at-rules-bubbling-less-20260420-083217` | `20bcd4564` | docs: record at-rules-bubbling warning ambiguity |
| `codex-auto-worker/less-tests-unit-at-rules-keyword-comments-at-rules-keyword-comments-less-20260420-083649` | `259d60ddf` | fix: preserve at-rule keyword comments |
| `codex-auto-worker/runtime-db-bootstrap-20260421-085112` | `134601e7c` | fix: align runtime task status with leases |
| `codex-auto-worker/runtime-db-bootstrap-20260421-091555` | `87578b173` | fix: adopt compatible unversioned runtime dbs |
| `codex-auto-worker/runtime-db-bootstrap-20260421-093256` | `c69bead08` | Harden runtime DB bootstrap validation |
| `codex-auto-worker/runtime-db-bootstrap-20260421-125626` | `cb31cd8db` | fix: validate runtime db table shapes |
| `codex-auto-worker/runtime-db-bootstrap-20260421-172442` | `9e67a0fb7` | fix: honor runtime terminal status in operator tasks |
| `codex-auto-worker/runtime-db-bootstrap-20260422-110211` | `1b7ed6c41` | Add isolated-worktree Less Vitest config |
| `codex/auto-less-recovery` | `172a4c6db` | fix: harden auto-loop acceptance |
| `codex/auto-less-recovery-worker/smoke-auto-loop-smoke-20260419-154753` | `596c7ba80` | fix: use a safe codex auto worker branch prefix |
| `codex/auto-loop` | `172a4c6db` | fix: harden auto-loop acceptance |
| `codex/durable-task-memory` | `bdea380b1` | tasks: split selector comment parity work |
| `codex/track3-less-compat-adapters` | `1ccbc54dd` | refactor: preserve comment trivia in collapsed output |
| `cutover/reference-import` | `82bf54d81` | feat(core): fold extend-into-reference-import onto the spine |
| `dev-antlr` | `489e498c5` | Adding the DefaultErrorStrategy |
| `dev-data-value-conversion` | `f5b05b5e8` | fix: repair stale _value reference in ComplexSelector.valueOf |
| `dev-freeze` | `9419b1a2d` | Current WIP |
| `feature/fns` | `71e8569f7` | Improve documentation |
| `feature/jess-parser-build` | `fe1977905` | chore(parsers): pin parseman ^0.16.0 (parser build requires it) |
| `feature/jess-scope-lookup-experiment` | `0d25b777f` | Merge remote-tracking branch 'origin/dev' into feature/jess-scope-lookup-experiment |
| `feature/scanner-first-parser-docs` | `ebba441c7` | Parse attached Less extends in scanner AST |
| `fix/property-in-root` | `f4e6e00a7` | fix(core): error on detached-ruleset-as-property-value + valid-length hex only |
| `import/reference-render-model` | `c9cb47e07` | Finalize import parity and wire less-compat via fixture compile plugins. |
| `work/cutover` | `77dbd49a2` | test(core): RATCHET harness locking the single-eval-emit cutover gains |
| `work/cutover-p1` | `3b75c4dbf` | docs(cutover): M8 interpolated-name fold ✅ (V4/R2 verified non-features); tip 5869859ad |

## Kept remote branches (not deleted)

- **Protected:** `dev`, `alpha`, `main`, `feature/less-v5-alpha-readiness`.
- **GitHub-managed** (leave for the platform): `circleci`, `circleci-project-setup`, all `dependabot/*`.
- **Superseded perf experiments, documented not deleted** (A/B-measured no-speedup; kept for reference): `dev-tree-swap`, `jess-dev`, `feature/jess-performance-evidence`, `feature/parser-production-machinery-cut`, `feature/parser-tokenizer-cutting`, `feature/chevrotain-cache-investigation`, `feature/flatten-visitor`, `dev-chevrotain-allstar`, `perf/grammar-thinning`.
- **Marginal dep-pin:** `fix/parseman-0.18.2` (see Category-C note).
