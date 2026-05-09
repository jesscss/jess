# Run Baseline

Run the test baseline for the **current debugging focus** and report results. Do not change code or state unless the user explicitly asks. This command is generic: the "baseline" is determined by the area (extend, core, jess, etc.).

## 1. Determine the area

Use in order of precedence:

- What the user said after the command (e.g. "/run-baseline for extend" or "/run-baseline extend").
- `.cursor/PROJECT_STATE.md` current-focus "Area".
- If unclear, run the **extend** baseline (most documented) or ask the user.

## 2. Run the right tests

From repo root. See PROJECT_STATE §3 for the canonical list. Examples:

| Area   | Command |
|--------|--------|
| extend | `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend` |
| extend + jess | Then: `pnpm --filter @jesscss/core build` and `pnpm run test:less:test-data` (report extend-related fixture failures if any) |
| core   | `cd packages/core && pnpm test -- --run` (or path user/state specifies) |
| jess   | `pnpm --filter @jesscss/core build` then `pnpm run test:less:test-data` |

Report: total run, passed, failed; for each failure give test file and test name (or error message).

## 3. No changes

This command only runs tests and reports. Do not edit code or state files unless the user explicitly asks.
