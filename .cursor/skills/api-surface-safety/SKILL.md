---
name: api-surface-safety
description: Use when changing exports, entrypoints, or shared types across packages. Ensures public API stability, correct ESM/CJS surface, and cross-package build/test validation.
---

# API surface safety (monorepo)

Use this skill when edits might affect consumers in other packages (or external users).

## When to use

- Editing `package.json` `exports`, `main`, `types`, or `files`.
- Editing a package’s `src/index.ts` (or other exported entrypoints).
- Refactoring shared types or moving files that are imported across packages.

## Workflow

1. **Identify the API boundary**
   - Determine whether the symbol is exported publicly (check package `exports` + `src/index.ts`).

2. **Keep exports consistent**
   - If a package uses `exports` mapping to `lib/` and `source` to `src/`, preserve that convention unless there’s a deliberate policy change.

3. **Respect ESM runtime specifiers**
   - This repo’s linting expects runtime-correct ESM specifiers (e.g. relative imports include `.js` in TS source).

4. **Verify downstream consumers**
   - If package A changed and package B consumes it, build A first then run B’s relevant tests.
   - Prefer `pnpm --filter <pkg> build/test` for targeted validation.

5. **Avoid type escapes**
   - Do not use `as any` to “make types work”; fix types at the boundary.

