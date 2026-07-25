# `/docs` — developer documentation

User-facing documentation lives in the Docusaurus sites under `packages/docs`
and `packages/docs-content`. This directory is for **dev-facing** material only,
sorted by what kind of claim each document makes.

| Directory | What belongs here |
| --- | --- |
| [`architecture/`](./architecture/) | How the system works **now**. Core engine (`architecture/core/`), parsers (`architecture/parser/`), extend (`architecture/extend/`). If the repo does not have it, it does not go here. |
| [`design/`](./design/) | Proposals and specs for work that is **not built yet**. When a design lands, move it to `architecture/` and rewrite it in the present tense. |
| [`state/`](./state/) | Transient state expected to churn: `PROJECT_STATE.md`, backlogs, readiness trackers, investigations. Always date-stamp a measurement. |
| [`process/`](./process/) | How we work: agent dispatch, releasing, skill ports. |
| [`perf/`](./perf/) | Hot-path invariants and optimization specs. |
| [`releases/`](./releases/) | Per-release notes. |

Start here:

- [`architecture/core/HANDOFF.md`](./architecture/core/HANDOFF.md) — the active
  entry point for core architecture and eval/render work.
- [`architecture/core/DESIGN-DECISIONS.md`](./architecture/core/DESIGN-DECISIONS.md)
  — the canonical OPEN/SETTLED owner decision ledger.
- [`state/PROJECT_STATE.md`](./state/PROJECT_STATE.md) — the measured known-red
  baseline and current debugging focus.
- [`perf/V8-ARCHITECTURE.md`](./perf/V8-ARCHITECTURE.md) — the 9 hot-path
  invariants and the regression-fixture catalogue.

The one rule that keeps this directory useful: **a document that describes
machinery the repo does not have belongs in `design/` or in git history, never in
`architecture/`.** Older brainstorming and abandoned trackers were removed from
the working tree; use git history for archaeology.
