# Bootstrap Jess Cursor Context

Use this when you want to (re)generate the `.cursor/` context system after repo changes (new packages, new hotspots, new conventions).

## Principles

- Prefer **auto-loading rules** via `globs` over “tell the user to invoke a system”.
- Keep **rules short** (guardrails + local conventions).
- Put heavy workflows into **skills** (selected by description).
- Use **agents** only as optional specialists (cartography, verification, perf sanity).

## Workflow

1. **Scan existing Cursor artifacts**
   - Inventory `.cursor/rules/**`, `.cursor/skills/**`, `.cursor/agents/**`, `.cursor/commands/**`.
   - Decide **keep vs supersede**; avoid duplicate always-apply rules.

2. **Repo cartography**
   - Confirm workspace tool (`pnpm-workspace.yaml`, root `package.json`).
   - Enumerate packages (`packages/*/package.json`).
   - Identify test/build/lint configs and where tests live (`vitest.config.ts`, per-package configs, `**/__tests__/**`, `**/*.test.ts`).

3. **Domain + hotspot mapping**
   - Identify core fan-in directories and perf-sensitive areas (e.g. parsers, extend).

4. **Update rules**
   - Global rules: `.cursor/rules/00-global.mdc`, `20-quality-bar.mdc`, `30-tests.mdc`
   - Domain rules: `.cursor/rules/domains/*.mdc`
   - Package rules: `.cursor/rules/packages/*.mdc`
   - Subtree hotspot rules: `.cursor/rules/subtrees/*.mdc`

5. **Update skills / agents / commands**
   - Skills: `.cursor/skills/**/SKILL.md`
   - Agents: `.cursor/agents/*.md`
   - Commands: `.cursor/commands/*.md`

6. **Validation**
   - Ensure frontmatter is correct and globs match real paths.
   - Ensure no docs/rules instruct the user to “invoke the system”.

