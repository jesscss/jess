# Update Debug State

Remind the user and yourself to update project state so the next session (or a new agent) can continue without losing context. This applies to **any** debugging area (extend, mixins, parser, etc.), not just extend.

## What to update

1. **`.cursor/PROJECT_STATE.md`** — Section 4 (Current debugging focus):
   - **Area** (if it changed): e.g. extend, mixins, parser.
   - **Relevant plan file** (if any): e.g. EXTEND_DEBUG_PLAN.md for extend.
   - **Last passing baseline** (if known).
   - **Last thing we tried:** hypothesis, change, result (pass/fail or error).
   - **Next step:** concrete next action so the next session can continue.

2. **Area-specific plan file** (if one exists and you changed status or priorities):
   - For extend: `.cursor/EXTEND_DEBUG_PLAN.md` — failing tests table, order of attack.
   - For other areas: create or update a plan file in `.cursor/` if the project starts tracking that area the same way.

3. **`.cursor/changes.md`** (if there was a significant fix or discovery):
   - Add a short entry at the top with today's date (see main rules).

## Prompt the user

After updating (or if you cannot update because of missing info), tell the user:

- "State updated in .cursor/PROJECT_STATE.md (and [plan file] if applicable). Next session: read those files and [next step]."
- Or: "I couldn't fill in [X]; please add it. Then next session: read state and …"

This keeps debugging continuous across sessions and avoids repeating failed attempts.
