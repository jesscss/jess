# Jess → Cursor Context System (Bootstrap Notes)

This file records **what we found** in this repo’s existing Cursor context system and **how we’re evolving it** into an auto-loading (glob-scoped) rules/skills/agents/commands layout.

It exists to prevent “context drift” over time and to make regeneration/refactors safe.

## What already existed (repo evidence)

- **Rules** (all always-on at time of bootstrap):
  - `.cursor/rules/main.mdc`
  - `.cursor/rules/package-scripts.mdc`
  - `.cursor/rules/test-debugging.mdc`
  - `.cursor/rules/debugging-state.mdc`
  - `.cursor/rules/project-standards/RULE.mdc`
- **Commands**:
  - `.cursor/commands/start-debugging.md`
  - `.cursor/commands/run-baseline.md`
  - `.cursor/commands/update-debug-state.md`
- **Skill**:
  - `.cursor/skills/systematic-debugging/SKILL.md`
- **Subagent**:
  - `.cursor/agents/debug-verifier.md`
- **Persistent state / plans**:
  - `.cursor/PROJECT_STATE.md`
  - `.cursor/DEBUGGING_ORCHESTRATION.md`
  - extend-specific notes should generally live in canonical package docs (e.g. `packages/core/src/tree/util/EXTEND_RULES.md`) and Cursor-native hotspot rules (`.cursor/rules/subtrees/core__extend.mdc`)

## Why we’re changing structure

The repo already had strong guardrails, but most rules were **alwaysApply**. That makes guidance “sticky” even when editing unrelated areas, and it forces the system to grow in one global blob.

The new system goal is:

- **Rules**: short guardrails, primarily **glob-scoped** so they auto-load by area.
- **Skills**: workflow-heavy, reusable procedures selected by description.
- **Agents**: optional specialists for decomposition (cartography, verification, perf sanity).
- **Commands**: explicit workflows for regeneration/mapping/verification (not day-to-day use).

## Merge strategy (keep vs replace vs scope)

- **Keep**: state & orchestration docs (`PROJECT_STATE.md`, `DEBUGGING_ORCHESTRATION.md`, extend plans).
- **Keep**: existing commands and `debug-verifier` agent (they remain useful and generic).
- **Keep**: `systematic-debugging` skill (it’s already broadly applicable).
- **Supersede with new layout**:
  - Create new `.cursor/rules/00-global.mdc`, `20-quality-bar.mdc`, `30-tests.mdc`.
  - Add domain/package/subtree rules under `.cursor/rules/{domains,packages,subtrees}/`.
- **De-duplicate**:
  - The original always-apply rules are converted to **`.cursor/**`-scoped “legacy” rules** so they don’t double-apply during normal code editing.
  - Their *substance* is preserved in the new global rules (or appropriate domain rules).

## Known unknowns (tracked for later questions)

- `packages/less-parser/vitest.config.ts` imports `../../vitest.config.js`, but repo has `vitest.config.ts` (no `.js` found).
- Prettier config not found; ESLint stylistic rules exist — unclear whether “ESLint as formatter” is the standard.
- `packages/patch-css` contains a Jest reference (`test:tofix`) — unclear if legacy support is intentional.

