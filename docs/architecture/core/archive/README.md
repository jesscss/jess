# Core-architecture archive

Design / plan / readout / audit docs whose work has **LANDED**, whose queue is
**drained**, or whose status snapshot has been superseded. Moved here with full
content preserved and git history intact to keep the active core-architecture
footprint lean. The entry point is `../HANDOFF.md`; the bounded live queue is
`../CORE-CLEANUP.md`.

Nothing here is stale-in-content — each is the correct record of how a landed piece works.
Read one when you need the *why/how* behind a shipped mechanism.

| Doc | What it designed | Landed as |
| --- | --- | --- |
| `APPEND-LAYER-SCOPE-FOLD-DESIGN.md` | `@layer` / `@scope` / ampersand-append spine folds | `SPINE_ELIGIBLE_AT_RULES` in `emit-walk.ts` (`0c72e21bf`, `a7982e3a2`, + append fold) |
| `EXTEND-4A-DESIGN.md` | expanded-mode crossing/hoist block-relocation for extend | `spine-extend.ts` / `emit-walk.ts`; self-marked LANDED (all-less 91→92) |
| `EXTEND-INDEX-DESIGN.md` | closed term-rewriting IR for extend (per-call engine) | `tree/extend/extend-index.ts` + `plan/solve/emit.ts` |
| `EXTEND-GLOBAL-FLOW-DESIGN.md` | global extend flow (PLAN / SOLVE / EMIT, scope model) | `tree/extend/` pipeline; superseded/merged by `../UNIFIED-EVAL-EMIT-DESIGN.md` |
| `SPINE-CONDITIONAL-DECLS-DESIGN.md` | spine `?:` / `setDefined` / `nearestOuter` fold (owner-input) | `95a25ec2a` (root `?:`+same-scope setDefined), `f2e650b77`/`b63871e61` (nearestOuter); current gates are in `../HANDOFF.md` |
| `P4-TERMINAL-SINK-DESIGN.md` | callable-terminal / mixin surface-sink unification | `resolveSpineMixinCall` / `spineMixinSurfaceSink` across `emit-walk.ts`, `callable-*.ts` |
| `LESS-INTEGRATION.md` | driving the Jess `.less` (all-less) suite to green | `feature/parseman` integration work on `dev` |
| `OVERNIGHT-READOUT.md` | 2026-07-08 morning-triage readout | point-in-time status snapshot |
| `BRANCH-WORKTREE-AUDIT.md` | 2026-07-09 branch/worktree cleanup ruling | one-time audit (166 local + 44 remote branches deleted) |
| `FOCII.md` | per-focus goal menu / routing | consolidated into `../CORE-CLEANUP.md`; kept for routing/guardrail history |
| `CUTOVER-STATUS-2026-07-18.md` | single-eval-emit status snapshot | superseded by the current target and gates in `../HANDOFF.md` |
| `CUTOVER-CHECKLIST-2026-07-18.md` | staged P0–P5 cutover checklist | superseded as an active plan by AST-v2 canonicalization; retained without changing decisions |
| `HANDOFF-history-2026-07-18.md` | former large router, session chronology, and rejected-proof log | compact live router is `../HANDOFF.md` |
| `CORE-CLEANUP-history-2026-07-18.md` | former cleanup scales, measurements, and audit chronicle | bounded live queue is `../CORE-CLEANUP.md` |

The living docs stay in the parent directory: `HANDOFF.md` (entry point),
`CORE-CLEANUP.md` (live queue), `AST-REORG-EXECUTION.md` (canonicalization lane),
`UNIFIED-EVAL-EMIT-DESIGN.md` (design reference), `STRINGS-OVER-NODES.md`,
`ASSIGNABLE-CONTROL-NODES-PLAN.md`, and `AGGRESSIVE-CUTTING-REVIEW.md`.
