# tree2 build-host actions

Boundary-clean construction **actions** for the tree2-emitting Less parser. Each
module maps one node **family**'s grammar `type`s to tree2 node constructors,
driving the SAME parseman grammar as the legacy parser through a different
`build(type, …)` host (`../dispatch-host.ts`). No legacy `../tree` AST is built
and no bridge walk runs — the host constructs tree2 nodes directly during the
parse. Each family is gated **byte-identical** against the bridge (the oracle)
during the transition (`serialize(direct) === serialize(bridge)`).

## Layout

- **`<family>.ts`** — one module per node family (e.g. `ruleset.ts`,
  `value.ts`, `selector.ts`), each exporting a
  self-describing `<FAMILY>_ACTIONS: BuildAction[]` (one entry per grammar `type`
  it constructs). One module per family so parallel family agents never share a
  file — the only shared edit is one append line in `index.ts`.
- **`../host-context.ts`** — the `BuildAction` / `BuildArgs` / `BuildContext`
  contract plus the source-slice / declaration / selector helpers every family
  reuses (ported from the POC host; mirror the bridge's `slice` / `rawDeclValue`
  derivations).
- **`index.ts`** — the single assembly point (`ACTION_LIST`). `dispatch-host.ts`
  turns it into the dispatch Map (one monomorphic lookup per `build`).

## Adding a family (the 3-line recipe)

1. Create `actions/<family>.ts` exporting `export const <FAMILY>_ACTIONS: BuildAction[] = […]`.
2. `import { <FAMILY>_ACTIONS } from './<family>.js';` in `index.ts`.
3. Append `...<FAMILY>_ACTIONS` to `ACTION_LIST`.

Then add `actions/__tests__/<family>-host-byte-identity.test.ts` gating
`serialize(direct) === serialize(bridge)` for the family's shapes (extend the POC
differential — reuse `parseToAst` + the bridge oracle). `ACTION_LIST` is
append-only, so the additions git-auto-merge and no agent touches another's
module.

## Actions must be TOTAL

parseman calls `build` on **backtracked** branches (e.g. `color: red` is built as
a `PseudoSelector`/`CompoundSelector` before backtracking to `Declaration`), so an
action must **never throw** on a shape that will be discarded — return a valid
node (or let an unregistered type fall through to the inert placeholder, which is
filtered out of every real body). Keep actions cheap: both hosts pay the
speculative build equally, so it is not a regression, but a throw on a doomed
branch would break an otherwise-valid parse.

## The ponytail ladder

The bridge (`../bridge.ts`) already re-derives every supported shape from the
legacy tree — it is the ready-made **reference** for each family's construction
logic (selector assembly, value/operation/call structure, interpolation). Reuse
its decisions (and the `../tree2` constructors it calls), but emit tree2
**directly** from the grammar's `build` children — do not route through the legacy
tree. The non-negotiable floor: byte-identity vs the bridge, the module boundary
(no `../tree` import), and total actions are never cut for brevity.
