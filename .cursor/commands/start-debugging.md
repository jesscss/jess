# Start Debugging

You are starting a focused debugging session. Follow these steps. The **area** (extend, mixins, parser, core, jess, etc.) comes from the user or from `.cursor/PROJECT_STATE.md` section 4. This workflow is generic so it works for any bug, not just extend.

## 1. Load state (do not skip)

- Read `.cursor/PROJECT_STATE.md` (package deps, build order, test commands, and **section 4 – current debugging focus**).
- If section 4 or the user mentions a **relevant plan file**, read that too so you know baseline and order of attack.\n+\n+  For **extend**, prefer the canonical pointers:\n+  - `.cursor/rules/subtrees/core__extend.mdc`\n+  - `packages/core/src/tree/util/EXTEND_RULES.md`\n+  - `packages/core/src/tree/util/__tests__/EXTEND_TEST_INDEX.md`

## 2. Run the right baseline

Use **section 3** in PROJECT_STATE and the **current area** to choose what to run. Examples:

| Area   | Typical baseline (from PROJECT_STATE §3) |
|--------|------------------------------------------|
| extend | `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend` |
| core   | From `packages/core`: `pnpm test -- --run` (or the path the user/plan specifies) |
| jess   | After building core if needed: `pnpm --filter @jesscss/core build` then `pnpm run test:less:test-data` (or a single fixture – see packages/jess/test/less/README.md) |

If the user specified an area (e.g. "extend", "parser"), use that. Otherwise use section 4 "Area" or ask. Run the baseline and report: passed, failed, and names of any failing tests.

## 3. Focus on one case (if user specified)

If the user asked to focus on a specific test or fixture:

- Add `it.only()` or `describe.only()` in the relevant test file for that case only.
- Re-run the baseline.
- Proceed with the systematic debugging methodology: observe → hypothesize → trace → one small change → run test → update state. Use `syncLog()` only; never `console.log` or `JSON.stringify` on nodes.

## 4. Build dependency first (when crossing packages)

If the area involves packages that depend on another (e.g. jess tests that use core), build the dependency first so tests see updated code. See PROJECT_STATE §1–2. Example: after changing core, run `pnpm --filter @jesscss/core build` before jess tests.

## 5. Before ending session

Update `.cursor/PROJECT_STATE.md` section 4 (and the area’s plan file if any) with: what you tried, result, next step. Remove any `.only` before committing.

If the user provided context after the command (e.g. "focus on nested & extend all"), use that to choose the focus in step 3.
