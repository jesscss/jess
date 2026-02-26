---
name: subagent-review
description: Keep reviews light by running quick spec and quality checks after each task before claiming completion.
---

# Subagent Review Checklist

Use this skill when you’re wrapping up a discrete task (bug fix, feature, doc cleanup). It does **not** spawn subagents, but it reminds you to run the *minimal* spec and quality verifications that an independent reviewer would otherwise do.

## When to apply

- You’ve just finished coding/testing a change and are about to say “this task is done” or “tests/build pass.”
- You want to mimic the two-stage review (spec + quality) described by `superpowers/subagent-driven-development` without spinning up parallel agents.

## Mini two-stage review

1. **Spec sanity check** – Re-read the requirements/plan for this task. Ask: “Does the behavior still match the plan?” Run or re-run the focused test, reproduce the edge case, or verify the command that proves the spec.
2. **Quality check** – Run `git status`, lint, or formatting checks relevant to the touched files. Scan the diff for clarity, remove boilerplate comments, and double-check there are no stray `console.log` calls or `.only`.
3. **Document review outcome** – Record the commands run and their pass/fail status (e.g., `pnpm test -- --run ... (0 failures)`, `git status -sb (clean)`). Mention both the spec check and quality scan before claiming completion.

## Anti-patterns

- Skipping `git status` / diff review because “I remember it was clean.”
- Claiming success without explicitly noting both a spec-focused check and a quick quality check.
- Relying on mental review alone—write down the commands you ran so you can cite them later.

## Project context

- Use the skill in tandem with `systematic-debugging` (if applicable) and `verification-before-completion`.
- The “spec check” command is often the focused Vitest suite for extend/core tasks; quality check is usually `git status -sb` + lint (per `.cursor/rules/30-tests.mdc`).
