# `/docs` — developer documentation

User-facing documentation lives in the Docusaurus sites under `packages/docs/docs-jess`,
`packages/docs/docs-less`, and the shared content in `packages/docs/docs-content`. This directory is for **dev-facing** material only,
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
- [`perf/V8-ARCHITECTURE.md`](./perf/V8-ARCHITECTURE.md) — the numbered hot-path invariants
  (1-11 at `74b9fcb4d`) and the regression-fixture catalogue.
- [`architecture/parser/GRAMMAR-REVIEW-STANDARD.md`](./architecture/parser/GRAMMAR-REVIEW-STANDARD.md)
  — the standing brief for the four grammar files (one host-mode `src/grammar.ts`
  per dialect since the eight-to-four fold): the per-`const` checklist, the hard
  constraints, and the definition of done. `HANDOFF.md`'s grammar-cleanup Router
  covers the rest of `architecture/parser/`.
- [`architecture/core/README.md`](./architecture/core/README.md) — index of the
  47 files in `architecture/core/` (63 before the `0dbfc89f0` archive pass),
  classified by last-touched date and inbound
  references, with the archive candidates named.

The one rule that keeps this directory useful: **a document that describes
machinery the repo does not have belongs in `design/` or in git history, never in
`architecture/`.** Older brainstorming and abandoned trackers were removed from
the working tree; use git history for archaeology.
