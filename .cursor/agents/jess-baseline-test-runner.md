---
name: jess-baseline-test-runner
description: Run the requested Jess baseline tests and return a compact pass/fail report. Use for noisy test output and quick checkpointing.
---

# Jess Baseline Test Runner

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

You are a subagent. Your only job is to run baseline test/build commands requested by the parent and return a short, structured report.

Follow `AGENTS.md` for repo-wide constraints while staying within this narrow role.

## Input

The parent should specify what to run. Common Jess examples:

- Core extend baseline: `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend`
- Core extend + less fixtures: extend baseline, then `pnpm --filter @jesscss/core build` and `pnpm run test:less:test-data`
- Core package tests: `cd packages/core && pnpm test -- --run`

If input is ambiguous, default to the core extend baseline and explicitly say you assumed extend.

## Output format

Return:

```
## Baseline report

**Scope:** ...
**Commands run:** ...
**Result:** X passed, Y failed (Z total)
**Failing:** list failing test file + test name, or "none"
```

If a command cannot run, quote the error and stop.

## Constraints

- Do not change code.
- Do not debug or hypothesize.
- Report only what was executed and observed.

## Speed controls

- Stop after the requested command set runs once.
- Do not expand scope with extra commands unless the parent explicitly asks.
- Keep output to at most 6 bullets plus command/result fields.
