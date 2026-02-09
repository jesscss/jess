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

## Core phases (do not skip)

1. **Phase 1 (Root cause investigation)** — Reproduce the problem, gather evidence, inspect recent diffs, and log what is actually happening vs what should happen.
2. **Phase 2 (Pattern analysis)** — Find similar working code; compare differences, dependencies, and assumptions before touching code.
3. **Phase 3 (Hypothesis + test)** — Form a single, testable hypothesis and verify it with the **smallest** possible change. If it fails, revise and repeat.
4. **Phase 4 (Implementation)** — Fix only the confirmed root cause, create/keep a failing test, re-run the focused test, and then run the broader suite.
5. **Update state** — Record progress (`.cursor/PROJECT_STATE.md` §4 or area plan), remove `.only` filters, and document next steps.

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
