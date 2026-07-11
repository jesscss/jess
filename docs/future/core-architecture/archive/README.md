# Core-architecture archive

Design / plan / readout / audit docs whose work has **LANDED** on `dev`. Moved here
(full content preserved, git history intact via `git mv`) to keep the active
core-architecture footprint lean — the entry point `../HANDOFF.md` and the live boards
(`../CUTOVER-STATUS.md`, `../CUTOVER-CHECKLIST.md`) no longer compete with shipped design
docs for a fresh session's context.

Nothing here is stale-in-content — each is the correct record of how a landed piece works.
Read one when you need the *why/how* behind a shipped mechanism.

| Doc | What it designed | Landed as |
| --- | --- | --- |
| `APPEND-LAYER-SCOPE-FOLD-DESIGN.md` | `@layer` / `@scope` / ampersand-append spine folds | `SPINE_ELIGIBLE_AT_RULES` in `emit-walk.ts` (`0c72e21bf`, `a7982e3a2`, + append fold) |
| `EXTEND-4A-DESIGN.md` | expanded-mode crossing/hoist block-relocation for extend | `spine-extend.ts` / `emit-walk.ts`; self-marked LANDED (all-less 91→92) |
| `EXTEND-INDEX-DESIGN.md` | closed term-rewriting IR for extend (per-call engine) | `tree/extend/extend-index.ts` + `plan/solve/emit.ts` |
| `EXTEND-GLOBAL-FLOW-DESIGN.md` | global extend flow (PLAN / SOLVE / EMIT, scope model) | `tree/extend/` pipeline; superseded/merged by `../UNIFIED-EVAL-EMIT-DESIGN.md` |
| `SPINE-CONDITIONAL-DECLS-DESIGN.md` | spine `?:` / `setDefined` / `nearestOuter` fold (owner-input) | `95a25ec2a` (root `?:`+same-scope setDefined), `f2e650b77`/`b63871e61` (nearestOuter); live gates tracked in `../CUTOVER-STATUS.md` |
| `P4-TERMINAL-SINK-DESIGN.md` | callable-terminal / mixin surface-sink unification | `resolveSpineMixinCall` / `spineMixinSurfaceSink` across `emit-walk.ts`, `callable-*.ts` |
| `LESS-INTEGRATION.md` | driving the Jess `.less` (all-less) suite to green | `feature/parseman` integration work on `dev` |
| `OVERNIGHT-READOUT.md` | 2026-07-08 morning-triage readout | point-in-time status snapshot |
| `BRANCH-WORKTREE-AUDIT.md` | 2026-07-09 branch/worktree cleanup ruling | one-time audit (166 local + 44 remote branches deleted) |
| `FOCII.md` | per-focus goal menu / routing | consolidated into `../CORE-CLEANUP.md`; kept for routing/guardrail history |

The living/active docs stay in the parent dir: `HANDOFF.md` (entry point),
`CUTOVER-STATUS.md`, `CUTOVER-CHECKLIST.md`, `UNIFIED-EVAL-EMIT-DESIGN.md` (current spec),
`STRINGS-OVER-NODES.md`, `ASSIGNABLE-CONTROL-NODES-PLAN.md`, `CORE-CLEANUP.md`,
`AGGRESSIVE-CUTTING-REVIEW.md`.
