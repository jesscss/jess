# Update Debug State

Remind the user and yourself to update project state so the next session (or a new agent) can continue without losing context. This applies to **any** debugging area (extend, mixins, parser, etc.), not just extend.

## What to update

1. **`.cursor/PROJECT_STATE.md`** — Current debugging focus:
   - **Area** (if it changed): e.g. extend, mixins, parser.
   - **Relevant plan file** (if any): keep this minimal; prefer Cursor-native rules + canonical package docs.
   - **Last passing baseline** (if known).
   - **Last thing we tried:** hypothesis, change, result (pass/fail or error).
   - **Next step:** concrete next action so the next session can continue.

2. **Area-specific plan file** (only if one is currently active and you changed status or priorities):
   - For extend, prefer `PROJECT_STATE.md` plus the canonical pointers:
     - `.cursor/rules/subtrees/core__extend.mdc`
     - `packages/core/src/tree/util/EXTEND_RULES.md`
     - `packages/core/src/tree/util/__tests__/EXTEND_TEST_INDEX.md`
   - For other areas: create a plan file only when the repo starts tracking that area as active work.

## Prompt the user

After updating (or if you cannot update because of missing info), tell the user:

- "State updated in .cursor/PROJECT_STATE.md (and [plan file] if applicable). Next session: read those files and [next step]."
- Or: "I couldn't fill in [X]; please add it. Then next session: read state and …"

This keeps debugging continuous across sessions and avoids repeating failed attempts.
