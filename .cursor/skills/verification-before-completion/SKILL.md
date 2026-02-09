---
name: verification-before-completion
description: Run and read the verification command every time before claiming success. Use when you are about to report a fix, tests/builds passing, or task completion.
---

# Verification Before Completion

This skill enforces the “proof before claim” rule from `obra/superpowers/verification-before-completion`.
Always run the relevant verification command, read its output, and cite the result before saying “done,” “tests pass,” “build succeeded,” or “task complete.”

## When to use

- You just made code changes and are about to say “that fixes it,” “tests pass,” or “ready to commit.”
- You are about to close a task, generate a PR, or report success to the user.
- You ran any script (tests, lint, build, e2e) that governs correctness.
- You rely on another agent or command output to assert behavior.

## Steps (apply every time before claiming success)

1. **Identify the proof command** – e.g., `pnpm test -- --run src/tree/util/__tests__/extend`, `pnpm --filter @jesscss/core build`, `pnpm lint`, `git status -sb`, or `pnpm test --run <suite>`.
2. **Run it fresh** – don’t assume past output; run the full command that proves your claim.
3. **Read the entire output** – note exit code and any failures/fixes.
4. **Verify** – if the output contradicts your claim, describe the failure; do not claim success. If it confirms success, explicitly mention the command + its clean output.
5. **Then claim success** – e.g., “`pnpm test ...` (0 failures) confirms the fix.”

## Anti-patterns (do not do)

- Saying “tests pass” without rerunning them after the latest change.
- Claiming “build passes” while only running lint or heuristic checks.
- Trusting another agent’s “success” message without independently verifying (re-run the relevant command yourself).
- Declaring “done” right before running verification; always run verification first.
- Reporting “all good” when the verification command is still running or hasn’t been run yet.

## Project notes

- Tests/builds must run from the package directory or via `pnpm --filter <pkg>` per `.cursor/rules/package-scripts.mdc`.
- Vitest is the test runner; use `pnpm test -- --run` as the verification command for unit suites.
- Running command examples:
  - Core extend baseline: `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend`
  - Less fixtures: `pnpm --filter @jesscss/core build` then `pnpm run test:less:test-data`
  - Parser docs unaffected by these commands, but remember to re-run relevant packages when touching them.
- Always read the command output; mention “exit 0 / 0 failures” before claiming success.

## Reference

- Inspired by `obra/superpowers/verification-before-completion` ([Skill](https://skills.sh/obra/superpowers/verification-before-completion)).
