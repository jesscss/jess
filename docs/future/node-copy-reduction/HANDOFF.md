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
  render without invoking `AtRule.eval(...)`. Dynamic leaf `resolve(...)` now
  uses an explicit leaf-only owned result instead of the generic at-rule
  derive surface. Body/root-hoist at-rules stay on the existing isolation
  surface.
- A `MixinOutputSlot` type now exists as an explicit compatibility record on
  generated mixin-output `Rules` wrappers. Slot-aware helpers cover
  `isMixinOutput` / visibility checks in `Rules`, `Reference`, serializer
  gating, and registry child-search. Registry lookup keeps entry visibility,
  node visibility, optional candidates, and targeted mixin-output access as
  distinct helper concepts; do not collapse them back into one coalesced
  visibility check.
- The broad proof queue has been processed. Current conclusions:
  at-rule bodies/root-hoist still need explicit state before the full surface
  can be deleted; mixin output wrappers are the current output-slot stand-in;
  remaining dynamic-call fallback paths need a non-`Call` state record;
  direct unevaluated `Rules.render(...)` is a compatibility fragment path;
  generated selector ownership is semantic until a placement-state record
  carries visibility/extend/composed-header facts; mutation-helper cleanup
  should attack one hot path at a time.
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
Latest audit: `new-node: 298`, `derive: 42`, `with-surface: 40`,
`copy-leaves: 35`, `clone-leaves: 2`, module-context count `361`.

## Completed Queue Pass

- At-rule body/root-hoist proof is done. Focused coverage now includes direct
  and buffer render for a dynamic body while proving the canonical prelude/body
  remain parented to the source at-rule and unevaluated. Existing root-only
  frame-clearing and nested extend-root tests remain the semantic blockers for
  deleting the body/root-hoist surface.
- Mixin output-slot proof is done. Existing tests cover repeated placement,
  leaky/targeted lookup behavior, no source body reparenting, and no source
  `Rules` root clone. The wrapper is still carrying real placement state, so
  the next step is extracting an explicit slot record, not moving source body
  children into another tree.
- Dynamic call content/rules-like proof is done. Plain CSS content render is
  already direct; metadata calls already use one owned raw-args surface; the
  remaining fallback path is `deriveResolveSurface()` because a `Call` node
  adopts name/args/content children. Replace that with a call-eval state
  record.
- Rules fragment proof is done. Direct unevaluated `Rules.render(...)` remains
  a compatibility body-fragment path; public compiler output enters through an
  evaluated root and flat buffer.
- Selector pseudo proof is done. `:is(...)` and unknown pseudo args have source
  serializer, parser-shape, direct render, buffer render, and extend matching
  coverage. Generated pseudo placement still needs owned/stateful output.
- Mutation-helper proof is done. The collapsed selector source-child bug
  establishes the rule: never `inherit(...)` onto a canonical child. Each
  remaining helper deletion needs focused parentage/eval-state output proof.
- Leaf at-rule resolve proof is done. Dynamic leaf render is local; dynamic
  leaf `resolve(...)` still returns an owned `AtRule` node to preserve the
  public resolve contract without reparenting source name/prelude children.
- Dynamic leaf at-rule resolve narrowing is done. The remaining at-rule derive
  surface is body/root-hoist direct render and dynamic body resolve.
- Initial mixin-output slot extraction is done. The helpers cover the simple
  rules/reference/serializer gates and now include the separate registry
  visibility concepts needed for child search.
- Registry slot-aware lookup extraction is done. The registry path now uses
  helpers that preserve entry-vs-node visibility, public-vs-optional
  candidate handling, targeted mixin-output lookup, and compound-prefix
  reference behavior.
- Mixin-output wrappers now carry an explicit `mixinOutputSlot` record. The
  wrapper remains the compatibility carrier, but read helpers prefer slot
  state so the next work can move more facts off ad hoc node options.

## Immediate Queue

This is a pop queue. Keep at least seven concrete items here. When the top item
is completed, remove it and add or promote enough work to keep the queue full.
If an item is too broad, replace it with the smallest honest next checkpoint
and move the broader theme to the backlog.

1. **Introduce `AtRuleBodyState`.**

   - Goal: replace the direct-render derived at-rule surface with an explicit
     state object for evaluated prelude, evaluated body, hoist flag, frames,
     root-only frame clearing, and extend-root registrations.
   - Required proof: dynamic body render, root-only keyframes under a parent
     ruleset, nested extend roots, direct/buffer parity, and source body
     parentage/eval-state.

2. **Introduce `CallEvalState` for dynamic fallback calls.**

   - Goal: replace `deriveResolveSurface().eval(context)` in render/resolve
     with a state record carrying evaluated/fallback name, args/content,
     caller pointer, mark-important flag, and optional-fallback metadata.
   - Required proof: content-node render/resolve, optional fallback, metadata
     rawArgs isolation, source name/args/content parentage, and rules-like
     variable calls.

3. **Split rules-like variable call lookup from `Call` ownership.**

   - Goal: move `preserveRulesLike` and caller fallback state into
     `CallEvalState` so a copied `Reference`/`Call` is not the lookup carrier.
   - Required proof: leaky/non-leaky detached ruleset calls, render/resolve
     parity, and source name eval-state.

4. **Narrow direct unevaluated `Rules.render(...)`.**

   - Goal: decide whether the compatibility fragment path can prepare/evaluate
     into local output state rather than `derive().eval(context)`.
   - Required proof: fragment separator trimming, flat-buffer separators,
     registration-prepared roots, static resolve identity, and source child
     parentage.

5. **Prototype generated pseudo placement state.**

   - Goal: choose generated `:is(...)` pseudo arguments as the first selector
     placement state record, carrying evaluated argument output, visibility,
     extend metadata, and composed-header cache without reparenting source
     selector children.
   - Required proof: generated `:is(...)`, unknown pseudo args, extend
     matching, source serializers, and direct/buffer render parity.

6. **Delete one hot-path mutation-helper use.**

   - Goal: pick a single `inherit(...)`, `set(...)`, or `derive*` site from
     the node-creation audit and replace it with local render/eval state or a
     proven owned result.
   - Required proof: source parentage/eval-state guard plus focused output
     coverage for that exact path.

7. **Split `AtRuleBodyState` registration from render state.**

   - Goal: after `AtRuleBodyState` exists, separate body registration/extend
     root bookkeeping from final render placement so the state object does not
     become a second at-rule AST.
   - Required proof: nested extend roots, layer names, root-only frame
     clearing, and direct/buffer render parity.

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
