# Node Copy Reduction — Handoff

## Open This First

This is the live queue for the eval/render/copy refactor. Keep it short enough
that the next agent can read it at startup and act without replaying weeks of
completed work.

Use [README.md](./README.md) for architecture rules. Use this file for current
truth, the immediate pop queue, and verification.

## Current Truth

- Top priority remains complete single-pass eval/render with the smallest
  honest node-creation shape. Regression audits support that goal; they do not
  replace it.
- Public CSS output APIs use awaited eval/render. `safeCompile(...)` remains
  the explicit tree-surface compatibility/debug API.
- Public `preEval()` and the old `preEvaluated` flag are gone. Registration
  setup is explicit through `prepareRegistration()` and
  `registrationPrepared`.
- The compiler render phase writes through `Rules.render(...)` into a flat
  buffer. `renderNodeToBuffer(...)`, `renderNodeToWriter(...)`, and
  `renderNodeToString(...)` are internal/test bridges only.
- Base `Node.render(context)` is direct source serialization. Nodes with
  context-dependent output choose local evaluated output and serialize through
  `renderSource(...)` / `renderOutput(...)` or native container syntax.
- The old generic output bridges are gone:
  `renderEvalOutput(...)`, `writeRootAwareEvalOutput(...)`,
  `renderChosenOutput(...)`, `renderSourceOutput(...)`, and
  `renderResolvedOutput(...)`.
- `$if`, `$for`, and `$while` avoid materializing control-wrapper output before
  buffer render. `$for` and `$while` stream iterations through direct
  `Rules.render(...)` calls and carry loop mutation through live `ScopeFrame`
  state.
- Context shadow state is intentional runtime state:
  `ScopeFrame.liveSlotsByName`, `ScopeFrame.fallbackFrame`, and
  `Context.rulesContext` remain part of the target model.
- The node-copy frontier is clean for deep copy/clone and ordinary production
  `.copy()` outside infrastructure. New copy/clone/inherit sites must prove a
  real ownership boundary.
- The current selector-collapse fix proves the mutation-helper rule: when
  `CompoundSelector` or `ComplexSelector` collapses to one surviving source
  child, output must own that child before inheriting container metadata.
  Calling `inherit(...)` on the canonical source child is a source-tree
  mutation bug.
- Metadata-backed JS functions still keep exactly one owned raw/callback arg
  surface because `this.rawArgs` is mutable user-code API. Plain positional JS
  calls pass args directly.
- At-rule direct unevaluated render compatibility is documented, not deleted:
  the remaining derived at-rule surface isolates dynamic name/prelude
  evaluation, body registration/eval mutation, root-only frame clearing, and
  nested extend-root registration from the canonical source at-rule. The next
  at-rule work must split those responsibilities before removing the surface.
- At-rule prelude-only direct render is split for leaf at-rules: dynamic leaf
  names/preludes now evaluate into local render state for direct and buffer
  render without invoking `AtRule.eval(...)`. `resolve(...)` still returns an
  owned at-rule node, and body/root-hoist at-rules stay on the existing
  isolation surface.
- Full immediate-queue pass is current. Broad queue items were reduced to the
  next concrete deletion/proof targets: at-rule direct render must split its
  state by responsibility; mixin output wrappers still carry real
  scope/visibility/fallback fields; content-node and rules-like dynamic calls
  still need a non-`Call` state record before the copied surface can go away;
  direct unevaluated `Rules.render(...)` is still a compatibility fragment
  path; generated selector ownership must next attack one placement; mutation
  helper work should target one hot eval/render path at a time.
- Remaining broad typecheck red is separate typed-node structural debt. Do not
  let it displace runtime node-creation reduction unless it directly unlocks a
  copy/materialization deletion.

## Remaining Node-Creation Surfaces

| Surface                             | Current shape                                                                                                                                                                         | Next proof                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Rules.render(...)` source roots    | Public compile renders already evaluated roots. Direct unevaluated `Rules.render(...)` still derives before eval for compatibility/direct node tests.                                 | Keep the compatibility path isolated; prove any narrowing preserves fragment separators, registration prep, and source parentage.         |
| `AtRule.render(...)`                | Reuses evaluated/prepared/static at-rule surfaces when available. Dynamic leaf render uses local name/prelude state; direct dynamic body/root-hoist render still derives before eval. | Split body/root-hoist/extend-root state before deleting the remaining surface.                                                            |
| `Ruleset.render(...)`               | Reuses evaluated/prepared ruleset surfaces. Unevaluated rulesets still prepare/eval an isolated surface; nil-selector output delegates to body render.                                | Prove which generated selector/body surfaces are semantic and which are serializer carriers.                                              |
| `Declaration.render(...)`           | Prepares/evals one isolated declaration surface for assignment/name/value/important mutation.                                                                                         | Keep source isolation unless a concrete side-state model replaces preparation mutation.                                                   |
| Function/mixin args                 | Plain JS calls pass direct args. Metadata calls keep one owned `rawArgs` surface.                                                                                                     | Keep guarding the split; do not add another copied source-call surface.                                                                   |
| Generated selector/output ownership | Extend, `:is(...)`, pseudo args, framed ampersands, selector collapse, and ruleset headers still create owned placement surfaces in focused cases.                                    | Keep unless new parentage/visibility/output tests prove a specific placement is carrier-only.                                             |
| Mutation helpers                    | `inherit(...)`, `set(...)`, `derive*`, and shallow wrappers still exist as local ownership tools.                                                                                     | Remove or narrow helper use where a side-state record or direct render output can carry the same semantics without mutating source nodes. |

## Node-Creation Hotspots

Run `pnpm run audit:node-creation` before and after a node-creation reduction
checkpoint. The script ranks likely runtime surfaces; it is not a gate.

Current top files by static surface count:

1. `packages/core/src/tree/rules.ts`
2. `packages/core/src/tree/call.ts`
3. `packages/core/src/tree/declaration.ts`
4. `packages/core/src/tree/dimension.ts`
5. `packages/core/src/tree/import-style.ts`
6. `packages/core/src/tree/at-rule.ts`
7. `packages/core/src/tree/reference.ts`
8. `packages/core/src/tree/ampersand.ts`
9. `packages/core/src/tree/ruleset.ts`

Current top surface kinds: `new` node construction, `with*` output surfaces,
`derive*` / `.derive(...)` surfaces, and `copyWithReusableLeaves(...)`.
Latest audit: `new-node: 297`, `derive: 43`, `with-surface: 40`,
`copy-leaves: 35`, `clone-leaves: 2`, module-context count `360`.

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. When the top item
is completed, remove it and add or promote enough work to keep the queue full.
If an item is too broad, replace it with the smallest honest next checkpoint
and move the broader theme to the backlog.

1. **At-rule body/root-hoist state proof.**

   - Goal: prove which body/root-hoist facts block removing the full
     direct-render at-rule surface after prelude state is separated.
   - Required proof: body registration/eval mutation, root-only frame clearing,
     nested extend-root registration, and source body parentage.

2. **Mixin output-slot visibility field extraction.**

   - Goal: pick the wrapper `rulesVisibility` / `isMixinOutput` pair and prove
     whether it can move into output-slot state before replacing the wrapper.
   - Required proof: untargeted lookup guard, targeted mixin-output lookup,
     repeated placement render, and source body parentage.

3. **Dynamic call content-node state record proof.**

   - Goal: introduce or prove the smallest non-`Call` state needed to evaluate
     dynamic calls with `contentNode` without adopting source children.
   - Required proof: content-node render, resolve, source content parentage,
     source evaluated-state, metadata/rawArgs guard, and optional fallback
     behavior.

4. **Rules-like variable call state record proof.**

   - Goal: replace the remaining copied `Call` surface for rules-like variable
     calls with a state record carrying preserve-rules-like lookup and caller
     fallback without reparenting the source name.
   - Required proof: non-leaky/leaky detached ruleset call tests, render,
     resolve, source name/content parentage, source evaluated-state, and caller
     fallback guards.

5. **Rules direct-render fragment compatibility proof.**

   - Goal: isolate the exact fragment/newline/registration reason direct
     unevaluated `Rules.render(...)` still derives, then delete or document the
     compatibility surface.
   - Required proof: compiler render enters with evaluated roots, direct node
     render preserves fragment separators, static `Rules.resolve(...)` stays
     source-native, and source children keep canonical parentage/eval state.

6. **Selector pseudo-argument placement proof.**

   - Goal: choose pseudo-argument generated selector output as the next
     placement after collapse ownership and prove whether its owned surface is
     semantic or removable.
   - Required proof: `:is(...)` / unknown pseudo args, source selector
     parentage, extend matching or visibility behavior, and direct/buffer
     render parity.

7. **Mutation-helper hot path proof.**

   - Goal: pick one hot eval/render path using `inherit(...)`, `set(...)`, or a
     derived wrapper and prove whether helper use is an ownership boundary or
     replaceable mutation.
   - Required proof: source parentage/eval-state guard plus focused output
     coverage for the selected path.

8. **At-rule leaf resolve state follow-up.**
   - Goal: decide whether dynamic leaf `AtRule.resolve(...)` can use a smaller
     owned leaf output/state path than `deriveAtRule(value, sourceValue)`.
   - Required proof: resolved node contract, source name/prelude parentage,
     no source eval-state mutation, and static/import leaf output parity.

## Backlog

- **Mutation-helper reduction.** Audit `inherit(...)`, `set(...)`,
  `derive*`, and shallow wrapper construction in hot eval/render paths. The
  goal is not to ban them as APIs; it is to stop relying on helper-driven
  mutation as the normal eval/render strategy.
- **Generated selector state.** Replace placement-owned selector wrappers only
  when a small side-state record can preserve source parentage, visibility,
  extend metadata, selector-bit library, hoist/root placement, and composed
  header cache without becoming AST v2.
- **Mixin output slots.** Replace generated mixin `Rules` wrappers only when a
  slot record can carry source body, evaluated placement children, scope frame,
  visibility/reference gates, rule index, and caller fallback.
- **Dynamic call state.** Replace remaining copied dynamic-call surfaces with a
  state record that preserves evaluated/fallback name, evaluated args/content,
  owned raw args when required, caller pointer, and parent/source safety.
- **Typed node structural frontier.** Continue splitting `tsc --noEmit`
  failures by node-family shape when it directly helps runtime cleanup.

## Verification

Use the nearest focused test while iterating. Before claiming a handoff-level
status change, run:

```sh
pnpm run verify:node-copy-frontier
pnpm run verify:render-buffer-frontier
pnpm run verify:materialization-frontier
pnpm run verify:package-exports
pnpm run verify:baseline -- --changed
```

Use the full baseline when a change touches root gates, package metadata,
shared verifier scripts, or broad render/eval contracts:

```sh
pnpm run verify:baseline
```

## Checkpoint Rule

A checkpoint is one coherent code or docs change with verification. If a seam
is too large, finish the smallest honest slice that leaves the repo and this
handoff more truthful than before.

For each checkpoint:

1. Read relevant source and focused tests before editing.
2. Make the smallest behavior-preserving change.
3. Run focused proof first.
4. Run the nearest broader verification.
5. Update this handoff if current truth or the immediate queue changed.
6. Commit and push when clean.

## Stop Conditions

Stop and ask before inventing semantics when:

- a fixture conflicts with documented Jess behavior;
- a wrapper seems removable but carries scope, import/reference, selector
  placement, or delayed-output state;
- a red appears only in `packages/jess/test/less/all-less.test.ts` and there is
  no focused parser/core repro yet;
- fixing a frontier requires broad new helper families instead of deleting or
  narrowing existing machinery.

## Do Not Resurrect

- checked-in task registries or unattended task loops
- stage trackers that mostly describe absent machinery
- broad "current dirty diff" notes copied from an old session
- long completed-work narratives in this file
- fixture-expectation changes that are not tied to an explicit Jess behavior
  decision
