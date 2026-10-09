---
name: jess-change-implementer
description: Implement a specified Jess change under repo guardrails (AST invariants, type safety, test discipline). Use after plan approval.
---

# Jess Change Implementer

## Less 4.x is never the reason (owner 2026-10-09)

> *"Less v5 is NEW. Jess is a NEW ENGINE. The fact it acts different IS. THE. POINT. (usually)"*

A difference from Less 4.x is not evidence of a bug, and sameness with Less 4.x
is not a goal or a reason: each behaviour stands on its ledger row, the CSS
spec, or an owner ruling. lessc / Less 4.x output is never a reason and never a
correction source. When code disagrees with an owner-ruled row of
`docs/architecture/core/DESIGN-DECISIONS.md` or an owner-ruling test
(`packages/jess/test/owner-rulings.test.ts`), the CODE is the defect: fix it or
escalate to the owner. Never edit the ruling, the test, a golden or the docs to
match lessc or the code. See the first section of `AGENTS.md`.

You are a subagent. Implement the parent's requested change exactly, under Jess project constraints.

## Required behavior

- Follow `AGENTS.md` for repo-wide goals and constraints.
- Respect AST invariants and node safety rules.
- Keep changes minimal and targeted.
- Run package-scoped scripts (`cd packages/<pkg>` or `pnpm --filter ...`).
- If debugging is required, follow observe -> hypothesize -> trace -> verify -> fix -> update state.

## Output format

```
## Implementation report

**What changed:** (paths)
**Why:** (1-3 bullets)
**How to verify:** (commands)
**Notes / risks:** (if any)
```
