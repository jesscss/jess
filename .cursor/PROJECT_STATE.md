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
- **Relevant plan file (if any):** Keep this minimal. Prefer Cursor-native pointers (e.g. `.cursor/rules/subtrees/core__extend.mdc`) and canonical package docs.
- **Last passing baseline:** (What was green before we started? e.g. "All core extend tests passed except …" or "N/A")
- **Last thing we tried:** (Hypothesis, change, result — pass/fail or error.)
- **Next step:** (Concrete next action so the next session can continue without re-guessing.)

**Example (extend):** Area = extend. Pointers: `.cursor/rules/subtrees/core__extend.mdc`, `packages/core/src/tree/util/EXTEND_RULES.md`, `packages/core/src/tree/util/__tests__/EXTEND_TEST_INDEX.md`. Core extend: 9 files, 4 failing tests. Next step: e.g. "Narrow to extend-eval-integration 'nested & extend all' with .only and trace."

**Extend – implicit ampersand / extend-exact (2025-02-07):**

- **Area:** extend (ampersand boundary; nested rulesets serializing `:is(parent)` instead of staying implicit).
- **Fix in place:** In `extend.ts`, `checkAmpersandCrossingDuringExtension` has an early block: when the selector is a **SelectorList with length > 1** and **selectorIsEntirelyImplicitAmpersandLeading** (every item is ComplexSelector starting with implicit Ampersand + combinator), we get the first ampersand, replace with resolved, and if find matches we return `crossed: true` so the parent carries the extend. This fixes the **second level** (`.b, .a` under `.c, .a, .effected` no longer becomes `:is(.c, .a, .effected) .b, .a`). Clearfix 1a/1b pass.
- **Still failing:** extend-less-fixtures test 2 (extend-exact): the **innermost** block (`.a, .c`) still outputs `:is(.b, .a) .a, :is(.b, .a) .c` instead of `.a, .c`.
- **Trace (DEBUG_AMPERSAND_CROSSING=1, .cursor/debug.log):** For find `.a`, middle and innermost get `selectorIsEntirelyImplicitAmpersandLeading: true` and we early-return crossed (so we throw and do not extend). For find `.b`, middle and innermost get `selectorIsEntirelyImplicitAmpersandLeading: false` — so when we check with `.b`, the selector’s first component is **not** an Ampersand (likely already `:is(...)` from a prior extend). So the iteration order or which ruleset gets extended first is such that by the time we check with `.b`, the selector has already been extended; treating leading `:is()` as “implicit” was tried but made output worse (nested `:is(:is(...))`).
- **Trace done (2025-02-07):** Added earlyReturn_crossed and extend_applied_phase1. Log: for find=.b we apply to middle and innermost; tryExtendSelector matches .b in the **middle** segment of full path → we replace with extended parent. **Root cause:** we apply when target matches anywhere (incl. ancestor). Less: only extend when match is in ruleset own (leaf) segment.
- **Next step:** Only apply when match is in ruleset own segment (e.g. tryExtendSelector reports match location, or restrict to rightmost segment).

---

## 5. Session discipline (for Cursor/agent)

- **Before** starting a debugging task: read this file and any **relevant plan file** for the area (e.g. EXTEND_DEBUG_PLAN for extend).
- **During** debugging: one hypothesis at a time; run tests after small changes; use `syncLog()` only (no `console.log`, no `JSON.stringify` on nodes).
- **After** a few attempts or at end of session: **update** section 4 (and the area’s plan file if it exists): what was tried, result, next step. Then the next session can continue without losing context.
