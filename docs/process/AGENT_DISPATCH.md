# Agent Dispatch Contract (Jess)

This file defines how to pick agents with minimal context overhead.

All dispatched agents should follow `AGENTS.md` for repo-wide goals and constraints.

## Precedence

1. If repo-level and user-level behavior disagrees, repo-level wins in this repo.
2. If no repo-level specialist applies, use user-level agents.

Agent names below are marked **[repo]** when the definition lives in
`.cursor/agents/` and **[user]** when it lives in `~/.cursor/agents/`.

## Quick pick (task -> agent)

| Task shape | Primary agent | Scope | Tier |
|---|---|---|---|
| "Run baseline and report pass/fail" in Jess | `jess-baseline-test-runner` | repo | faster tier |
| "Implement planned Jess change" | `jess-change-implementer` | repo | inherited/default tier |
| "Understand one Jess package deeply (read-only)" | `jess-package-analyst` | repo | inherited/default tier |
| "Map package/domain quickly" in Jess | `cartographer` | repo | faster tier |
| "Map package/domain quickly" outside Jess | `codebase-mapper` | user | faster tier |
| "Run verification matrix only" in Jess | `verifier` | repo | faster tier |
| "Run verification matrix only" outside Jess | `verification-runner` | user | faster tier |
| "Run the tests the parent names, report only" | `debug-verifier` | repo | faster tier |
| "Deep dive one package before editing it" | `package-expert` | repo | inherited/default tier |
| "Implement an approved change under repo guardrails" | `implementer` | repo | inherited/default tier |

### Review agents (evidence per item — a bare verdict is an invalid result)

Per `CLAUDE.md`, these are mandatory before landing changes in their domains.

| Need | Agent | Scope | Tier |
|---|---|---|---|
| Review a change to any of the eight `*-parser/src/grammar.ts` files | `grammar-reviewer` | repo | inherited/default tier |
| Review a change to core tree/eval/render, grammar/parser, or extend/selector for perf | `perf-architecture-reviewer` | repo | inherited/default tier |
| Review anything that changes emitted CSS | `semantics-reviewer` | repo | inherited/default tier |

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

| Need | Agent | Scope | Tier |
|---|---|---|---|
| Run Jess baseline tests and report only | `jess-baseline-test-runner` | repo | faster tier |
| Run a parent-specified test baseline and report only | `debug-verifier` | repo | faster tier |
| Minimal package-scoped verification matrix in Jess | `verifier` | repo | faster tier |
| Implement approved Jess change under repo guardrails | `jess-change-implementer` | repo | inherited/default tier |
| Implement a specified change under existing rules | `implementer` | repo | inherited/default tier |
| Deep read-only package orientation in Jess | `jess-package-analyst` | repo | inherited/default tier |
| Deep dive one package's architecture and conventions (read-only) | `package-expert` | repo | inherited/default tier |
| Map a Jess package/domain with evidence + suggested rule globs | `cartographer` | repo | faster tier |
| Grammar-file review, evidence per `const` | `grammar-reviewer` | repo | inherited/default tier |
| Perf-architecture review, evidence per invariant | `perf-architecture-reviewer` | repo | inherited/default tier |
| Semantics review, evidence per invariant | `semantics-reviewer` | repo | inherited/default tier |
| Generic baseline test runner across repos | `baseline-test-runner` | user | faster tier |
| Generic verification matrix runner | `verification-runner` | user | faster tier |
| Generic package/domain mapping | `codebase-mapper` | user | faster tier |

Per the precedence rule above, prefer the repo-level agent in this repo; the
three user-level generics are fallbacks for work outside Jess.

## Do not use when

| Agent | Do not use when |
|---|---|
| `jess-baseline-test-runner` | You need root-cause analysis or code changes (use implementer/debug workflow instead). |
| `jess-change-implementer` | Task is read-only discovery/mapping (use analyst/mapper instead). |
| `jess-package-analyst` | Scope spans multiple packages or requires edits (use mapper/implementer flow). |
| `debug-verifier` | You need root-cause analysis, hypotheses, or code changes. |
| `verifier` | You need deep debugging rather than a pass/fail matrix. |
| `implementer` | No plan is approved yet, or the task is read-only discovery. |
| `package-expert` | Scope spans multiple packages, or you need to make edits. |
| `cartographer` | You already know exact files to edit and can proceed directly. |
| `grammar-reviewer` / `perf-architecture-reviewer` / `semantics-reviewer` | Never skip these for their domains — but do not use them to *make* the change; they are read-only reviewers. |
| `baseline-test-runner` (user) | A repo-specific baseline adapter exists and should control defaults. |
| `verification-runner` (user) | You need broad exploration or architecture reasoning rather than command verification; or you are in Jess, where `verifier` applies. |
| `codebase-mapper` (user) | You already know exact files to edit; or you are in Jess, where `cartographer` applies. |

## Speed controls

| Agent | Stop condition | Output budget |
|---|---|---|
| `jess-baseline-test-runner` | Stop after requested command set completes once. | <=6 bullets plus commands run/result. |
| `debug-verifier` | Stop after requested command set completes once. | <=6 bullets plus commands run/result. |
| `baseline-test-runner` (user) | Stop after requested command set completes once. | <=6 bullets plus commands run/result. |
| `verifier` | Stop after minimal matrix completes (no exploratory expansion). | <=8 bullets with failing cases only. |
| `verification-runner` (user) | Stop after minimal matrix completes (no exploratory expansion). | <=8 bullets with failing cases only. |
| `cartographer` | Stop after core map fields are confirmed or after 2 no-new-info iterations. | <=10 bullets across summary/entrypoints/scripts/tests/hotspots. |
| `codebase-mapper` (user) | Stop after core map fields are confirmed or after 2 no-new-info iterations. | <=10 bullets across summary/entrypoints/scripts/tests/hotspots. |
| `jess-package-analyst` | Stop after package entrypoints + key tests + conventions are established. | <=12 bullets total across required sections. |
| `package-expert` | Stop once the parent can make safe changes in the package. | <=12 bullets total across required sections. |
| `grammar-reviewer` / `perf-architecture-reviewer` / `semantics-reviewer` | Never stop early: the review is complete only when every `const` / invariant has a row. | One row per `const` or per invariant — a sampled review is invalid. |

## Promotion rule (repo -> user)

Promote an agent to `~/.cursor/agents` only if all are true:

1. No Jess-specific paths/scripts/rules are required.
2. Behavior is useful across at least two repos.
3. It does not rely on repo-only assumptions for fallback behavior.

If mixed, split into:
- generic user-level core, and
- Jess-specific repo adapter.
