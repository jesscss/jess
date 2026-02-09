# Daily Changes & Improvements

This file is updated daily with the most recent changes and improvements made to the codebase.

**Note**: Most recent changes are always at the top. Add new entries with the current date (e.g., `## 2025-Dec-9`) at the top of this file. Make sure we query a live date service to get current date.

## 2026-Feb-09 (doc hygiene pass)

### Canonicalize + archive dev docs
- `packages/jess-plugin-less-compat/`: kept `README.md`, added `DESIGN.md`, and moved historical analysis/plan markdowns into `packages/jess-plugin-less-compat/_archive/` (dated snapshots).
- `/docs` (non-Docusaurus): archived obviously-stale notes (`container.md`, `nesting.md`, `theme.md`) into `docs/_archive/` (dated snapshots). Kept extend-related architecture docs in place.
- `packages/fns/src/sass/`: added `SASS_DOCS.md` as a lightweight index to the existing Sass-porting docs.
- Additional cleanup:
  - `docs/`: archived legacy brainstorming/docs (`ideas*`, `mixins.md`, `variables.md`, `migrating-to-jess.md`, `language-service.md`, etc.) and replaced `docs/README.md`/`docs/NOTES.md` with short pointers.
  - `packages/parser/`: moved parser debugging analyses into `packages/parser/_archive/` and added `PARSER_DOCS.md`.
  - `packages/core/`: moved one-off analyses into `packages/core/_archive/` and removed a duplicate copy under `src/tree/util/__tests__/`.

## 2026-Feb-01 (implicit ampersand serialization + nested extend skip)

### Implicit ampersands must stay invisible
- **ensureSelectorVisible** (extend-roots.ts and ruleset.ts): Do **not** add `F_VISIBLE` to nodes that have `F_IMPLICIT_AMPERSAND`, and do **not** recurse into them. So serialization never surfaces the ampersand’s stored `:is(...)` and nested output stays short (`.a, .c` not `:is(.b, .a) .a`).
- **Extend-roots skip logic**: When the extend target is a selector list (e.g. `.a, .b, .c`), skip updating a ruleset if it has an ancestor that is also in the match set (so nested `.a, .c` under `.c,.a,.effected` is not replaced with a materialized `:is()` form). Implemented as `hasAncestorInSet()`: walk up `ruleset.parent` and treat as “in set” when `rs === anc` or when selector `valueOf()` matches (to handle clone vs original). Also: only apply “skip prepended sibling” when `ruleset !== extendOwner` so the ruleset that contains the extend is still updated.
- **Helpers**: `rulesetContainsExtend`, `extendOwnerFromNode`, `isDescendantOf`, `selectorIsNestedWithImplicitAmpersand` (used in skip conditions).
- **Status**: extend-less-fixtures test 2 (extend-exact) still fails: output is `:is(.b, .a) .a, :is(.b, .a) .c` instead of `.a, .c`. So either the skip is not firing (e.g. parent chain or set membership differs at processExtends time) or the wrong ruleset is being updated/serialized. Tests 4 and 5 still fail (extend-selector, extend.less); test 5 shows extra `.cc` in inner block.

## 2026-Feb-01 (extend: correct fix — no sourceNode; ampersand rule)

### Correct fix for nested ruleset extend output (Less extend-selector replace case)

- **Wrong approach (removed):** Using `sourceNode` on the selector to store an "own" selector for nested header serialization. That was a workaround; serialization must not special-case nesting or use sourceNode for the header.
- **Correct rule:** Do **not** flatten / make visible the ampersand in the **extend target** (the ruleset's selector). **Do** flatten the invisible ampersand in **extendWith** when applying only when it does **not** match the inherited (ruleset frame) ampersand.
- **Changes made:** getHeaderString no longer uses sourceNode; extend-roots sourceNode logic removed; extend.ts appends extendWith with same & when list item has implicit ampersand and own part matches find.
- **Test expectation:** "extends selectors inside nested rulesets" expects inner block `.replace, .rep_ace, .c` (Less). Test still fails until fix is fully applied. See EXTEND_FAILURES_ASK_OR_UPDATE.md §4a.

## 2026-Feb-01 (extend .aa .dd / .ff)

### extend.less: .ff missing from `.dd, .ee` block (new bug, separate from inner .bb)

- **Observed**: Expected `.dd, .ee, .ff { background: red; }` under `.aa,.cc`; actual `.dd, .ee { ... }` (missing `.ff`). So `.ff:extend(.dd,.bb all)` is not adding `.ff` to the ruleset that has selector `.aa .dd` (then `.dd,.ee` after partial extend).
- **Trace added**: In `extend-roots.ts`, Phase 1 and Phase 2 logging when singleTarget `.dd` and selectorWithExtend `.ff` (e.g. `aa_dd_ff_phase1_apply_enter`, `phase1_skip`, `phase1_try_result`, `phase2_entry`, `phase2_skip`, `phase2_try_result`) to see if the ruleset is considered and why it might be skipped.
- **extend.ts / extend-helpers.ts changes (for exact extend last-compound)**:
  - **Exact extend on complex selector**: Allow when find matches the **last** compound (e.g. `.aa .dd` for find `.dd`) and reject only when same-nested (e.g. `.bb .bb`). Helpers: `isSameNestedExactSelector`, `complexSelectorLastCompoundEquals`; `isNonAllWholeSelectorItemMatch` now returns true for that case.
  - **isPartialMatch exception**: When exact extend and last compound equals find and not same-nested, do not reject on `location.isPartialMatch`.
  - **Complex exact reject**: Only reject when `!lastEquals || sameNested` (and find SimpleSelector or BasicSelector).
  - **BasicSelector**: Treated like SimpleSelector in exact-extend checks and in extend-helpers fast path 2 (simple-to-simple match).
  - **Last-component block**: When exact extend, `location.path.length === 1`, target ComplexSelector, last component equals find, return `createExtendedSelectorList([target, withExtend], target)` (SelectorList `.aa .dd`, `.aa .ff`) so full-mode list merge adds `.ff`.
- **Status**: extend.less still fails (`.ff` still missing). Forced path and trace in extendSelectorList suggest we may not be calling tryExtendSelector for this ruleset when processing `.dd:.ff`, or findExtendableLocations returns no match for `.aa .dd` + `.dd`; root cause not yet pinned. Inner `.bb` fix (rejectedExactExtendByRuleset) is unchanged and debug-extend-bb-inner test passes.

## 2026-Feb-03

### Extend trace: parsed vs constructed (extend-chaining)

- **Goal**: Determine why extend-chaining was said to be "only fixed for constructed AST" — log AST, registries, extend roots, search, options.
- **Changes**:
  - `extend-trace-debug.ts`: `shouldTraceExtend()` now true when `runId === 'constructed'` or path includes `extend-chaining`; added `isConstructedRun()`.
  - `debug-log.ts`: `getDebugLogPath()`, support `DEBUG_LOG_DIR`; log path is monorepo-root `.cursor/debug.log` or `DEBUG_LOG_PATH`.
  - `extend-roots.ts`: At start of `processExtends()` log `processExtends_enter` with `runId`, `collapseNesting`, `allRootsCount`, `rootSummaries` (per-root: `serializeTypes` head, `registryIndexSize`, `registryPendingSize`, `registryKeys`), `extendsCount`, `extendsSummary`.
- **Findings from trace** (parsed extend-chaining.less, with core built):
  - **collapseNesting:true**: `.ma:extend(.md)` runs with extendRoot = inner `Rules` (valueLen:1, firstType:Rules). rootsToSearch includes the wrapper (valueLen:3, firstType:Ruleset); search finds `.md` there (foundCount:1); filter keeps it (sameOrDescendantRootCount:1); tryExtend succeeds (changed:true). So the parsed case **does** find and apply the extend.
  - **Registries**: At processExtends_enter, doc root has `registryIndexSize:0`, `registryPendingSize:30`; @media roots have pending 2 or 1. Index is filled on first `.find()` (lazy).
  - **all-less.test.ts** (including extend-chaining.less CSS assertion): **31 passed**.
  - **Failing test**: `extend-chaining-ast-compare.test.ts` — "serializes AST from Jess parsing extend-chaining.less (post-eval)" snapshot mismatch: selector list order differs (e.g. `.d`/`.e` and `.x`/`.z` order). So the remaining failure is **selector order in serialized AST**, not the extend merge itself.

### Debugging orchestration (rules, commands, skills, subagents)

- **Goal**: Make Cursor/LLMs more effective at debugging and preserve context across sessions (extend bugs have been stuck for weeks).
- **Plan doc**: `.cursor/DEBUGGING_ORCHESTRATION.md` — problem statement, research (Cursor docs, LLM debugging best practices), and full implementation plan.
- **Project memory**: `.cursor/PROJECT_STATE.md` — package dependency graph, build order, key test commands, current extend baseline section (update as debugging progresses). Read at start of debugging; update after progress or at end of session.
- **New rule**: `.cursor/rules/debugging-state.mdc` — read/update state files; short sessions; log what was tried; use `/debug-extend`, `/run-extend-baseline`, `/update-debug-state`.
- **Commands**: `.cursor/commands/` — `start-debugging.md`, `run-baseline.md`, `update-debug-state.md` (generic for any area).
- **Skill**: `.cursor/skills/systematic-debugging/SKILL.md` — observe → hypothesize → trace → verify → fix → update state; anti-patterns.
- **Subagent**: `.cursor/agents/debug-verifier.md` — run extend baseline and return short pass/fail report.
- **Usage**: Start with `/start-debugging` (optionally specify area, e.g. "for extend"); use `/run-baseline` for a clean report; use `/update-debug-state` before ending session. Next session: "Read .cursor/PROJECT_STATE.md and continue."
- **Generalization**: Commands and state are generic for any debugging area (extend, mixins, parser, etc.). Removed `/debug-extend` and `/run-extend-baseline`; replaced with `/start-debugging` and `/run-baseline`. PROJECT_STATE section 4 is "Current debugging focus" with area, plan file, last tried, next step. Extend is one example; other areas can add plan files as needed.

## 2026-Feb-01

### extend-roots.test.ts baseline (pre-existing vs regressions)

- **Check**: Whether the 6 failing extend-roots tests are older or caused by the processExtends filter (collapseNesting fixes).
- **Committed baseline**: Reverting `extend-roots.ts` to HEAD fails all 20 extend-roots tests with `setExtendOrderMap is not a function` (refactor removed that call; committed file is out of sync).
- **Minimal filter (no collapseNesting conditions)**: 8 failed, 12 passed.
- **Full filter (with collapseNesting conditions)**: 6 failed, 14 passed.
- **Conclusion**: The 6 failing extend-roots tests are **pre-existing** in the refactored code. Our filter additions **fix 2** of the previous 8 failures (@import / accessible-roots merges). The remaining 6 (compose boundaries, extendNotAccessible warnings, “only accessible selector”, anonymous layers, “children roots are accessible if mutable”) are due to other code (compose/warning/accessible-roots logic), not the processExtends filter.

### @media extend (extend-chaining) – core registration fix

- **Problem**: Extends inside `@media` (e.g. `.ma:extend(.a,.b,...)`) were not finding root-level targets; "Extend targets not found" and missing merged selectors in output.
- **Root cause**: The document root `Rules` was not always pushed onto `extendRootStack` before root-level rulesets ran `preEval`, so `.a`, `.b`, etc. registered with no extend root and were invisible to extend processing.
- **Fix (in `packages/core/src/tree/rules.ts`)**: Ensure the root is registered and pushed before `_multiPassPreEval`: set `context.root = rules` when we're top-level (`!rules.parent` and stack empty), when we're the eval root (only Rules on stack), and when getTree set root to original but we're processing a clone; register root if needed and push when stack is empty so children see the root during preEval.
- **Core tests**: `extend-eval-integration.test.ts` passes (including @media extend and SelectorList target cases). Jess `extend-chaining.less` test may still fail depending on test runner resolving core from source vs built lib.

### Building core before jess tests

- Jess tests do **not** build core before running. Root vitest resolves `@jesscss/core` to `packages/core/lib/` (mainFields). After changing core, run `pnpm --filter @jesscss/core build` before running jess tests so they see updated code.

## 2026-Jan-21

### Language Service & Extension Development

- **Cross-file navigation**: Implemented go-to-definition and find-references for variables and mixins across imported files
- **Dynamic diagnostic severity**: Undefined variables are errors when `@use` (SCSS) or `@from`/`@compose` (Less) present, warnings otherwise
- **Semantic token fixes**: Fixed variable reference coloring with AST-based detection
- **Hierarchical document symbols**: Implemented hierarchical structure matching VS Code's CSS extension

### Jess language service pivot (LSP + extension)

- **Pivoted tracking from `vscode-css-languageservice` fork into this monorepo**: added package-local docs and a project tracker at `packages/language-service/TRACKER.md`.
- **Created initial package placeholders** for the new architecture:
  - `packages/language-service/` (engine + thin LSP wrapper)
  - `packages/extension/` (VS Code/Cursor extension)
  - `packages/language-service-tests/` (golden/parity test harness)

## 2026-Jan-18

### Catch-up (Jan 10–17)

- **Extend processing overhaul**: major refactors across `extend.ts`, `util/extend.ts`, `util/extend-roots.ts`, `find-extendable-locations.ts`, plus new/shared helpers (`extend-helpers.ts`) and selector/registry utilities.
- **Extend test coverage**: added/expanded suites around selector algorithm correctness, combinator handling, simplified cases, duplicate validation, where-selector behavior, and process/integration coverage (including some debug-focused tests).
- **Less compatibility plugin work**: large expansion of `jess-plugin-less-compat` (node wrappers, transforms `from-less`/`to-less`/`proxy`, plugin-manager + multiple integration tests, and supporting docs/analysis notes).
- **Diagnostics & errors/warnings**: refactored error/warning structure, added safe-parse coverage, improved diagnostics output/logging, and added deprecation processing + tests.
- **Detached rulesets + recursion**: substantial progress toward correct detached ruleset behavior and recursion handling, with new helpers/tests.
- **Config / styles-config**: extended `packages/config` options/types/tests and updated `jess` config wiring.
- **Serialization/parser fixes (ongoing)**: additional CSS/LESS parser + serialization adjustments alongside the earlier whitespace fix already noted on Jan 9.

## 2026-Jan-09

- Use `:=` for "set existing"? (don't shadow)

## 2025-Dec-16

Okay, LLMs find it impossible to reason about recursive rendering of hoisted rules, I'll
need to re-write it myself.

## 2025-Dec-11

- More mixin debugging. I think my plan now for handling recursion is this:

1. When a call node starts evaluation, add the call's sourceNode to call stack (in context).
2. When a reference starts / ends, add to reference stack (in context).
3. When a mixin match is found, evaluate it.
4. If the call with the same sourceNode is called (with same stringified params?), detect a recursion and throw an error.
5. Error is bubbled up to mixin rules evaluation, and that is removed as a candidate.
6. In the case of static rules / ruleset, mark the current frames. If the last frame of the candidate matches the current frame stack, remove as a candidate.

So that we don't error too early, we might need to parse differently, because the call has to know if rules are going to be just used for lookup,
or if rules are going to be a target for the next reference. Maybe we can do this with the call stack? Or maybe actually in the rules.ts. It's adding the rules as a child of another rules that's the only problem... but by then, its
too late, because the mixin will have returned multiple matches potentially...

So maybe all we can do is the error thrown at the call level.

## 2025-Dec-10

### Mixin Lookup Debugging

- **Fixed Set destructuring issue**: Discovered that Sets can be destructured directly in JavaScript (no need for `Array.from()`). Reverted unnecessary conversion in `_indexSelectorStart`.
- **Added debug logging**: Added extensive debug logging to trace mixin registration and lookup:
  - `MixinRegistry.find`: Logs what keys are being looked up, what's in the registry, and traversal through parent chain
  - `Reference.evalNode`: Logs mixin-ruleset lookups and results
  - `getFunctionFromMixins`: Logs when parent is set on Rules returned from mixin calls
- **Identified parent chain issue**: Discovered that Rules returned from mixin calls need to have their parent set to the original mixin definition context (not the calling context) for lookups to work correctly. In Less, mixins resolve lookups from the mixin definition context, not the caller context.
- **Fixed parent preservation**: Modified `getFunctionFromMixins` to:
  - Set `newRules.parent` to the original mixin's Rules parent (where the mixin was defined)
  - Store `_originalParent` flag to identify mixin results
  - Skip `adopt()` call for mixin results in `applyResult` to preserve the parent chain
  - Added fallback to use `candidate.rulesParent` if direct parent lookup fails
- **Created mixin lookup scope test**: Created `mixin-lookup-scope.test.ts` to test Less behavior for variable and mixin lookups from mixin definition vs caller context (for future reference).

### Current Issue

- **Parent chain not working in all cases**: Some lookups still show `rulesIndex=undefined` with no parent, preventing traversal to find mixins. The parent IS being set correctly in `getFunctionFromMixins` (confirmed via debug logs showing `rulesIndex=0`), but some Rules instances used for lookups don't have their parent set or it's being lost somewhere in the evaluation chain.
- **Next steps**: Need to investigate why some Rules instances lose their parent - possibly during `rules.eval()` or when Rules are returned from mixin function calls and integrated into the parent Rules.

## 2025-Dec-9

### New extend syntax

- Resolved to use `$extend ns|.selector`. ChatGPT convinced me. Default value is `all`. We can do Less's default behavior (exact) with something like `$extend .selector !exact`
- `@-compose` is protected from extends by default, unless we add `(mutable)`
- Add `@-export` instead of `@forward`, to export / include everything but not make the API / vars locally available.


### Extend Processing Fixes
- **Fixed extend processing logic in `rules.ts`**: Corrected the order of parameters when calling `tryExtendSelector`. The extend was finding the wrong ruleset - it should find rulesets matching the selector that has the extend (e.g., `.child`), not the target (e.g., `.base`).
- **Created `rules-extend.test.ts`**: Comprehensive test suite for extend functionality within a single file, covering:
  - Basic extend
  - Multiple extends
  - Partial extend (all flag)
  - Complex selectors (compound, pseudo-classes)
- **Fixed cloning/registration issue**: Modified `import-style.ts` to clone Rules before evaluation instead of after, ensuring registries are populated on the cloned Rules. This fixes extend lookup issues when using cached evaluated Rules.

### Ruleset Registration Improvements
- **Fixed `_hasStaticName` for Ruleset nodes**: Now correctly identifies ruleset selectors as static after `preEval`, even if the ruleset node itself is dynamic.
- **Fixed `context.treeRoot` restoration**: Preserves `context.treeRoot` when `saved.treeRoot` is `undefined`, preventing extends from being lost during context restoration.

### Ongoing Work
- Debugging extend across import boundaries - specifically the "sibling import" test case where extends need to find rulesets from imported files.

