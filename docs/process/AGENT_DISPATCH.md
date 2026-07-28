# Agent Dispatch Contract (Jess)

This file defines how to pick agents with minimal context overhead.

All dispatched agents should follow `AGENTS.md` for repo-wide goals and constraints.

## Precedence

1. If repo-level and user-level behavior disagrees, repo-level wins in this repo.
2. If no repo-level specialist applies, use user-level agents.

## Quick pick (task -> agent)

| Task shape | Primary agent | Tier |
|---|---|---|
| "Run baseline and report pass/fail" in Jess | `jess-baseline-test-runner` | faster tier |
| "Implement planned Jess change" | `jess-change-implementer` | inherited/default tier |
| "Map package/domain quickly" | `codebase-mapper` | faster tier |
| "Run verification matrix only" | `verification-runner` | faster tier |
| "Understand one Jess package deeply (read-only)" | `jess-package-analyst` | inherited/default tier |

## Model tier defaults

- Use a **faster tier** for quick, bounded tasks:
  - codebase mapping
  - focused verification runs
  - baseline pass/fail snapshots
- Default runners/mappers to faster tier unless deep reasoning is explicitly required.
- Use **inherited/default tier** for deeper tasks:
  - multi-file implementation
  - architecture-heavy reasoning
  - complex debugging

## Agent selection (project + user)

| Need | Agent | Tier |
|---|---|---|
| Run Jess baseline tests and report only | `jess-baseline-test-runner` | faster tier |
| Implement approved Jess change under repo guardrails | `jess-change-implementer` | inherited/default tier |
| Deep read-only package orientation in Jess | `jess-package-analyst` | inherited/default tier |
| Generic baseline test runner across repos | `baseline-test-runner` | faster tier |
| Generic verification matrix runner | `verification-runner` | faster tier |
| Generic package/domain mapping | `codebase-mapper` | faster tier |

## Do not use when

| Agent | Do not use when |
|---|---|
| `jess-baseline-test-runner` | You need root-cause analysis or code changes (use implementer/debug workflow instead). |
| `jess-change-implementer` | Task is read-only discovery/mapping (use analyst/mapper instead). |
| `jess-package-analyst` | Scope spans multiple packages or requires edits (use mapper/implementer flow). |
| `baseline-test-runner` | A repo-specific baseline adapter exists and should control defaults. |
| `verification-runner` | You need broad exploration or architecture reasoning rather than command verification. |
| `codebase-mapper` | You already know exact files to edit and can proceed directly. |

## Speed controls

| Agent | Stop condition | Output budget |
|---|---|---|
| `jess-baseline-test-runner` | Stop after requested command set completes once. | <=6 bullets plus commands run/result. |
| `baseline-test-runner` | Stop after requested command set completes once. | <=6 bullets plus commands run/result. |
| `verification-runner` | Stop after minimal matrix completes (no exploratory expansion). | <=8 bullets with failing cases only. |
| `codebase-mapper` | Stop after core map fields are confirmed or after 2 no-new-info iterations. | <=10 bullets across summary/entrypoints/scripts/tests/hotspots. |
| `jess-package-analyst` | Stop after package entrypoints + key tests + conventions are established. | <=12 bullets total across required sections. |

## Promotion rule (repo -> user)

Promote an agent to `~/.cursor/agents` only if all are true:

1. No Jess-specific paths/scripts/rules are required.
2. Behavior is useful across at least two repos.
3. It does not rely on repo-only assumptions for fallback behavior.

If mixed, split into:
- generic user-level core, and
- Jess-specific repo adapter.
