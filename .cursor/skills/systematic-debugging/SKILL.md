---
name: systematic-debugging
description: Use a strict observe-hypothesize-trace-verify-fix loop when debugging; avoid random changes and context loss. Use when the user is debugging, investigating a failure, or fixing a bug.
---

# Systematic Debugging

Use this skill when debugging failing tests, runtime errors, or unexpected behavior. It keeps the agent from guessing, repeating failed attempts, or losing context across sessions.

## When to use

- User says they're debugging, investigating a failure, or fixing a bug.
- A test or build is failing and the user wants help finding the cause.
- The task involves "extend", "core tests", or "all-less" and may span multiple packages.

## Steps (do not skip)

1. **Observe** — What exactly is happening vs what should happen? (Output, error message, assertion failure.) Write it down or confirm with the user.
2. **Hypothesize** — One concrete hypothesis about root cause (e.g. "selector X is not registered because …"). One hypothesis at a time.
3. **Trace** — Follow the real execution path in code: which functions run, what values variables have. Use `syncLog()` with primitive values only (no `console.log`, no `JSON.stringify` on nodes). See project rules for instrumentation limits.
4. **Verify** — Run the minimal test that would confirm or refute the hypothesis (e.g. add `it.only()` to one test, run it). If the result doesn't match the hypothesis, revise the hypothesis and repeat from step 2.
5. **Fix** — Make the smallest change that addresses the root cause. Run the test again. Then run the full relevant suite to check for regressions.
6. **Update state** — Update `.cursor/PROJECT_STATE.md` section 4 (and any area-specific plan file, e.g. EXTEND_DEBUG_PLAN for extend) with: what you tried, result, next step. Remove any `.only` before committing.

## Anti-patterns (do not do)

- **Random changes** — Trying multiple unrelated edits hoping one works.
- **No trace** — Assuming which code path runs or what a variable is without logging or reading the code path.
- **Long session without state update** — Debugging for a long time without writing "what we tried" and "next step" into PROJECT_STATE section 4 (and the area’s plan file if any).
- **Skipping build** — Changing `packages/core` and running jess tests without `pnpm --filter @jesscss/core build` first.
- **Logging wrong things** — Using `console.log` (suppressed in Vitest), or `JSON.stringify` on AST/parser nodes (circular refs, frame state). Use `syncLog()` and only primitive values.

## Project-specific

- **Package scripts:** Run tests/builds from the package directory or with `pnpm --filter @jesscss/<pkg>`. See `.cursor/rules/package-scripts.mdc`.
- **State and commands:** Read `.cursor/PROJECT_STATE.md` at the start (and any area-specific plan, e.g. EXTEND_DEBUG_PLAN for extend). Use `/start-debugging` to begin, `/run-baseline` to get a clean pass/fail report, `/update-debug-state` at end of session.
- **Isolation:** Use `it.only()` or `describe.only()` to focus one test; remove before commit. See `.cursor/rules/test-debugging.mdc`.

## References

- Full plan: `.cursor/DEBUGGING_ORCHESTRATION.md`
- State and session discipline: `.cursor/rules/debugging-state.mdc`
