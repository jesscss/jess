# Project State (Memory for Cursor / LLMs)

**Purpose:** So Cursor and any new chat/session know: package layout, who depends on whom, build order, current test baseline, and where we are on known bugs. **Read this at the start of a debugging or build-related task. Update it when you make progress or change state.**

---

## 1. Package dependency graph (from package.json)

**Leaf packages (no workspace deps):**

- `@jesscss/awaitable-pipe`
- `@jesscss/shared` (packages/_shared)
- `@jesscss/patch-css`
- `@jesscss/style-resolver`
- `@jesscss/config`

**Core layer (deps only on leaves):**

- `@jesscss/core` → awaitable-pipe
- `@jesscss/css-parser` → core, shared
- `@jesscss/less-parser` → core, css-parser, shared
- `@jesscss/scss-parser` → core, css-parser
- `@jesscss/fns` → core, awaitable-pipe

**Upper layer:**

- `@jesscss/parser` → core, css-parser, less-parser, scss-parser
- `@jesscss/jess-plugin` → core, parser
- `@jesscss/plugin-node-modules` → core
- `@jesscss/jess-plugin-less` → core, fns, less-parser, style-resolver
- `@jesscss/jess-plugin-scss` → core, scss-parser, style-resolver
- `@jesscss/jess-plugin-less-compat` → core, less-parser, plugin-node-modules
- `@jesscss/language-service` → core, css-parser, fns, less-parser, scss-parser, style-resolver, shared
- `@jesscss/vscode-extension` → language-service
- `@jesscss/jess` (cli/app) → core, patch-css, plugin-less, plugin-node-modules, plugin-less-compat, shared

**Rule:** If you change package A and run tests in package B that depends on A, **build A first** so B sees updated code (e.g. `pnpm --filter @jesscss/core build` before jess tests).

---

## 2. Build order (for “build everything” or “build before testing”)

Suggested order (dependencies first):

1. awaitable-pipe, shared, patch-css, style-resolver, config
2. core
3. css-parser, fns
4. less-parser, scss-parser
5. parser, plugin-node-modules, jess-plugin-less, jess-plugin-scss, jess-plugin-less-compat, language-service
6. jess-plugin, vscode, jess

**Practical:** Most often you only need to build what you changed and its dependents. For extend work: **core** is the main package; **jess** tests resolve `@jesscss/core` to `packages/core/lib/`, so after changing core run:

```bash
pnpm --filter @jesscss/core build
```

Then run jess tests from repo root or jess package.

---

## 3. Key test commands

Use these for `/run-baseline` and `/start-debugging`; add rows as you add new areas.

| What | Where to run | Command |
|------|----------------|--------|
| Core extend tests | repo root or packages/core | `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend` |
| All-less (Less fixtures) | repo root | `pnpm run test:less:test-data` (build core first if core changed) |
| Single less fixture | repo root | See packages/jess/test/less/README.md (e.g. --test-file) |

**Isolation:** Use `it.only()` or `describe.only()` in the relevant test file to focus one case. Remove `.only` before committing.

---

## 4. Current debugging focus (update as you go)

Use this section for **any** debugging area (extend, mixins, parser, language-service, etc.). Update it so the next session knows where we are.

- **Area:** (e.g. extend, mixins, parser, fns, language-service)
- **Relevant plan file (if any):** (e.g. `.cursor/EXTEND_DEBUG_PLAN.md` for extend; add others as needed)
- **Last passing baseline:** (What was green before we started? e.g. "All core extend tests passed except …" or "N/A")
- **Last thing we tried:** (Hypothesis, change, result — pass/fail or error.)
- **Next step:** (Concrete next action so the next session can continue without re-guessing.)

**Example (extend):** Area = extend. Plan = `.cursor/EXTEND_DEBUG_PLAN.md`. Core extend: 9 files, 4 failing tests (see that file). Next step: e.g. "Narrow to extend-eval-integration 'nested & extend all' with .only and trace."

---

## 5. Session discipline (for Cursor/agent)

- **Before** starting a debugging task: read this file and any **relevant plan file** for the area (e.g. EXTEND_DEBUG_PLAN for extend).
- **During** debugging: one hypothesis at a time; run tests after small changes; use `syncLog()` only (no `console.log`, no `JSON.stringify` on nodes).
- **After** a few attempts or at end of session: **update** section 4 (and the area’s plan file if it exists): what was tried, result, next step. Then the next session can continue without losing context.
