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
  - Optional specialists for decomposition (cartography, verification, implementation, deep package dive).

- **Commands** (`.cursor/commands/*.md`)
  - Explicit workflows (bootstrap/regenerate/map/verify). These exist for intentional operations, not daily work.

### Persistent state (“project memory”)

- `.cursor/PROJECT_STATE.md` is the shared memory for package graph/build order/test baselines/current debugging focus.
- `.cursor/DEBUGGING_ORCHESTRATION.md` explains the debugging system design.
- Area plans (e.g. extend) live in `.cursor/` alongside the state.

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

### Notes

Some older always-apply rules were intentionally scoped to `.cursor/**` to avoid duplicated guidance; see `.cursor/CONTEXT_BOOTSTRAP.md` for the merge strategy.

