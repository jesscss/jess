# Jess → Cursor Context System (Bootstrap Notes)

This file records **what we found** in this repo’s existing Cursor context system and **how we’re evolving it** into an auto-loading (glob-scoped) rules/skills/agents/commands layout.

It exists to prevent “context drift” over time and to make regeneration/refactors safe.

## What already existed (repo evidence)

- **Rules** (historical baseline before current consolidation):
  - broad always-on guidance for global behavior, tests/scripts, and quality constraints
- **Commands**:
  - `.cursor/commands/start-debugging.md`
  - `.cursor/commands/run-baseline.md`
  - `.cursor/commands/update-debug-state.md`
- **Skill**:
  - `.cursor/skills/systematic-debugging/SKILL.md`
- **Subagent**:
  - `.cursor/agents/jess-baseline-test-runner.md`
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

## Agent ownership model

- **User-level agents** (`~/.cursor/agents`): personal orchestration defaults and reusable cross-repo helpers.
- **Repo-level agents** (`.cursor/agents`): project-specific specialists that encode Jess workflows and should stay versioned with the repo.
- Keep both layers; do not remove `.cursor/agents` unless a file is a true duplicate by role and behavior.

## Context loading order

1. Always-applied guardrails (`00-global`, `20-quality-bar`, `30-tests`).
2. Glob-scoped domain/package/subtree rules for the files being touched.
3. Skill loading by task description (debugging, fixtures, API safety, perf, verification).
4. Optional agent/command invocation when decomposition or explicit workflow is needed.

## Merge strategy (keep vs replace vs scope)

- **Keep**: compact state and orchestration docs (`PROJECT_STATE.md`,
  `DEBUGGING_ORCHESTRATION.md`). Area plans should stay small and should be
  archived when they stop describing active work.
- **Keep**: existing commands and repo-specific Jess agents.
- **Promote/split**:
  - Promote generic agents to `~/.cursor/agents` (for example `verification-runner`, `codebase-mapper`).
  - Keep only Jess-specific adapters in `.cursor/agents` (for example `jess-baseline-test-runner`).
- **Keep**: `systematic-debugging` skill (it’s already broadly applicable).
- **Supersede with new layout**:
  - Create new `.cursor/rules/00-global.mdc`, `20-quality-bar.mdc`, `30-tests.mdc`.
  - Add domain/package/subtree rules under `.cursor/rules/{domains,packages,subtrees}/`.
- **De-duplicate**:
  - Legacy duplicated rules are removed.
  - Their substance lives in canonical rules (`00-global.mdc`, `20-quality-bar.mdc`, `30-tests.mdc`) plus scoped domain/package/subtree rules.

## Known unknowns (tracked for later questions)

- `packages/less-parser/vitest.config.ts` imports `../../vitest.config.js`, but repo has `vitest.config.ts` (no `.js` found).
- Prettier config not found; ESLint stylistic rules exist — unclear whether “ESLint as formatter” is the standard.
- `packages/patch-css` contains a Jest reference (`test:tofix`) — unclear if legacy support is intentional.
