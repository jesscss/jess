# Codebase Cleanup Tracking

## How To Use
1. Pick the next "available" item
2. Change its status to "in progress: [agent-id]"
3. Complete the work, run `cd packages/core && pnpm test` to verify no regressions
4. Commit with message: `refactor(core): cleanup [description]`
5. Change status to "done"

## Rules
- Only change status of items you're working on
- Run tests before committing
- One item at a time
- Do NOT use `as any`
- Do NOT change behavior, only clean up

---

## Unused Imports

Type-only imports (`type LocationInfo`) are erased at compile time but are still noise. These are lower priority than value imports.

### Unused `type LocationInfo` Import (batch)

These files import `type LocationInfo` but never reference it outside the import line. Can be removed from each file's import statement in a single batch.

| # | File | Status |
|---|------|--------|
| UI-1 | `packages/core/src/tree/any.ts` | available |
| UI-2 | `packages/core/src/tree/ampersand.ts` | available |
| UI-3 | `packages/core/src/tree/block.ts` | available |
| UI-4 | `packages/core/src/tree/bool.ts` | available |
| UI-5 | `packages/core/src/tree/color.ts` | available |
| UI-6 | `packages/core/src/tree/combinator.ts` | available |
| UI-7 | `packages/core/src/tree/comment.ts` | available |
| UI-8 | `packages/core/src/tree/condition.ts` | available |
| UI-9 | `packages/core/src/tree/declaration.ts` | available |
| UI-10 | `packages/core/src/tree/declaration-var.ts` | available |
| UI-11 | `packages/core/src/tree/dimension.ts` | available |
| UI-12 | `packages/core/src/tree/js-function.ts` | available |
| UI-13 | `packages/core/src/tree/log.ts` | available |
| UI-14 | `packages/core/src/tree/negative.ts` | available |
| UI-15 | `packages/core/src/tree/nil.ts` | available |
| UI-16 | `packages/core/src/tree/number.ts` | available |
| UI-17 | `packages/core/src/tree/operation.ts` | available |
| UI-18 | `packages/core/src/tree/quoted.ts` | available |
| UI-19 | `packages/core/src/tree/range.ts` | available |
| UI-20 | `packages/core/src/tree/reference.ts` | available |
| UI-21 | `packages/core/src/tree/ruleset.ts` | available |
| UI-22 | `packages/core/src/tree/selector-attr.ts` | available |
| UI-23 | `packages/core/src/tree/selector-basic.ts` | available |
| UI-24 | `packages/core/src/tree/selector-capture.ts` | available |
| UI-25 | `packages/core/src/tree/selector-interpolated.ts` | available |
| UI-26 | `packages/core/src/tree/selector-pseudo.ts` | available |
| UI-27 | `packages/core/src/tree/url.ts` | available |

**Recommendation**: Handle UI-1 through UI-27 as a single commit since they are all the same mechanical change (remove `type LocationInfo` from import).

---

## Dead Code

### DC-1: Unused variable `beforeMaterialize` in extend.ts
- **File**: `packages/core/src/tree/extend.ts`
- **Lines**: 265, 333
- **Description**: `const beforeMaterialize = resolvedSel.valueOf()` is assigned twice (once in async path, once in sync path) but the variable is never read after assignment. Both occurrences can be removed.
- **Status**: available

### DC-2: Unused regex `MULTI_LINE_TRIM` in regex.ts
- **File**: `packages/core/src/tree/util/regex.ts`
- **Line**: 2
- **Description**: `MULTI_LINE_TRIM` is exported but never imported by any file in the codebase. `LIST_ITEM_TRIM` on line 3 is still used by `list.ts`.
- **Status**: done

### DC-3: Unused functions in format.ts
- **File**: `packages/core/src/tree/util/format.ts`
- **Description**: Both `normalizeFilenameToNamespace` and `normalizeContinuationIndent` are exported but never imported or used anywhere else in the codebase. Entire file removed.
- **Status**: done

### DC-4: Unused debug trace functions in extend-trace-debug.ts
- **File**: `packages/core/src/tree/util/extend-trace-debug.ts`
- **Description**: All four exported functions (`shouldTraceExtend`, `shouldTraceExtendMd`, `getExtendTraceRunId`, `isConstructedRun`) are only referenced within the file itself and an archive copy (`archive/extend-trace-debug.ts`). No production code imports or calls any of them. Entire file removed (archive copy left in place).
- **Status**: done

### DC-5: Commented-out visitor methods across node files
- **File**: `packages/core/src/tree/at-rule.ts` (lines 663-696)
- **File**: `packages/core/src/tree/dimension.ts` (lines 335-348)
- **File**: `packages/core/src/tree/declaration-custom.ts` (lines 29-53)
- **Description**: Multiple node classes contain large blocks of commented-out `toCSS` and `toModule` methods marked with `@todo - move to visitors`. These have been commented out for a long time and add noise. Can be removed.
- **Status**: available

---

## Unused Methods/Functions

### UM-1: `getValues` in collections.ts
- **File**: `packages/core/src/tree/util/collections.ts`
- **Lines**: 68-92
- **Description**: `getValues` generator function is exported but only used within `packages/language-service/` and `packages/language-service/src/color-utils.ts` (outside core). Within `packages/core/src/`, it is never imported. If the goal is core-only cleanup, this is a candidate; however, it IS used by external packages, so removal requires updating those consumers. **Defer unless those packages are also being cleaned up.**
- **Status**: deferred (used by language-service)

### UM-2: `sessionIsStatic` in session-helpers.ts
- **File**: `packages/core/src/tree/util/session-helpers.ts`
- **Lines**: 98-104
- **Description**: Exported function only used in test file `packages/core/src/__tests__/eval-session.test.ts`. No production code calls it. May be intentionally reserved for future use (Stage 9+). Mark as low-priority.
- **Status**: available (low priority)

### UM-3: `sessionSetRuntimeState` in session-helpers.ts
- **File**: `packages/core/src/tree/util/session-helpers.ts`
- **Lines**: 383-456
- **Description**: Large exported function only used in test file `packages/core/src/__tests__/eval-session.test.ts`. No production code calls it. May be intentionally reserved for future migration stages.
- **Status**: available (low priority)

---

## Duplicate Logic

### DL-1: Duplicated extend selector resolution (async vs sync) in extend.ts
- **File**: `packages/core/src/tree/extend.ts`
- **Lines**: ~174-340
- **Description**: The `evalNode` method has nearly identical async (inside `.then()`) and sync paths for resolving the extend selector, building the parent composition, and pushing to `context.extends`. The two branches differ only in the Promise wrapping. This could be refactored to share the core logic via a helper function. **High complexity, medium risk.**
- **Status**: available

---

## Clone/Materialization Artifacts

### CM-1: `clone(true)` in at-rule.ts selector wrapping
- **File**: `packages/core/src/tree/at-rule.ts`
- **Lines**: 311 (`selector = selector.clone(true) as Selector`)
- **Description**: In the ampersand evalNode collapse-nesting path, a `clone(true)` is used to avoid mutating the parent selector in-place when stripping `pre`/`post`. With session overlays, this could potentially use `sessionPatchField` for `pre`/`post` instead. **Needs careful analysis of whether the selector is always a source node.**
- **Status**: available (needs investigation)

### CM-2: `copy(true)` calls in selector-utils.ts
- **File**: `packages/core/src/tree/util/selector-utils.ts`
- **Description**: Multiple `copy(true)` and `clone(false)` calls throughout `resolveAuthoredAmpersands`, `composeSelectorRouteWithParent`, `getParentReplacementForAmpersand`, and `localizeSelectorAgainstParent`. These create defensive copies during selector composition. Many may be necessary for correctness but should be audited to see if any can be eliminated when session overlays handle mutation isolation.
- **Status**: available (audit needed)
