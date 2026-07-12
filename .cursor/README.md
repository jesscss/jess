## Jess Cursor Context System

This repo uses a **path-scoped Cursor context system** so day-to-day work does not require any “invoke the system” prompt. Cursor automatically loads the right guidance based on the files you edit.

### How it’s structured

- **Rules** (`.cursor/rules/**`)
  - **Global always-on guardrails**:
    - `.cursor/rules/00-global.mdc` (evidence-first, no guessing, no “invoke system”)
    - `.cursor/rules/20-quality-bar.mdc` (AST invariants, type safety, safe instrumentation)
    - `.cursor/rules/30-tests.mdc` (Vitest discipline, `syncLog`, monorepo script execution)
  - **Domain rules** (`.cursor/rules/domains/*.mdc`): loaded by `globs` for areas like core/parsers/CLI/tooling/docs.
  - **Package rules** (`.cursor/rules/packages/*.mdc`): per-package notes (scripts, entrypoints, test layout).
  - **Subtree rules** (`.cursor/rules/subtrees/*.mdc`): narrow hotspot guidance (e.g. core extend).

- **Skills** (`.cursor/skills/**/SKILL.md`)
  - Workflow-heavy procedures selected by description (debugging, fixture-driven work, API safety, perf sanity).

- **Agents** (`.cursor/agents/*.md`)
  - Project-specific specialists (`jess-baseline-test-runner`, `jess-change-implementer`, `jess-package-analyst`).

- **Commands** (`.cursor/commands/*.md`)
  - Explicit workflows (bootstrap/regenerate/map/verify). These exist for intentional operations, not daily work.

### Agent ownership (user vs repo)

| Layer | Location | Purpose | Versioned |
|-----|-----|-----|-----|
| User-level | `~/.cursor/agents` | Personal orchestration defaults reusable across projects | No |
| Repo-level | `.cursor/agents` | Jess-specific specialists with repo precedence on disagreements | Yes |

- Keep both layers.
- Prefer user-level agents for cross-repo orchestration patterns.
- Keep repo-level agents for project semantics and workflows that should be consistent in-team.
- When user-level and repo-level guidance disagrees, use repo-level behavior in this repo.

### Agent dispatch contract

- Use `.cursor/AGENT_DISPATCH.md` as the source of truth for:
  - when to use each agent,
  - model-tier defaults (faster tier vs inherited/default tier),
  - promotion rules (user-level reusable vs repo-only specialization).

### Persistent state (“project memory”)

- `.cursor/PROJECT_STATE.md` is intentionally small: package/build shape,
  verification commands, and the current debugging focus only when one is
  actively open.
- Area plans should stay small and current. Prefer package docs and scoped rules
  over long root-level status files.

### The auto-inference contract (what should happen in practice)

When you say something like:

- “Fix this parsing bug in core”
- “Add a transform pass to AST”
- “Update CLI output formatting”

…the assistant should:

- Load the correct **rules automatically** via path globs.
- Pull in relevant **skills** when the task shape matches (debugging, fixtures, API changes, perf-sensitive edits).
- Use **subagents** when helpful (mapping, verification, perf sanity), not as mandatory “roles”.
- Ask questions **only after** minimal evidence-gathering, and only for information the repo cannot provide.

### Context loading order (minimal-by-default)

1. Always-applied guardrails (`00-global`, `20-quality-bar`, `30-tests`).
2. Path-based package/domain/subtree rules for touched files.
3. Task-matched skills (debugging, fixture-driven, API surface, perf, verification).
4. Optional agents/commands only when task shape needs decomposition or explicit workflow.

### Notes

The active guidance surface is canonical and minimal: global guardrails (`00-global`, `20-quality-bar`, `30-tests`) plus scoped domain/package/subtree rules.
