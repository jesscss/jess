# Node Session Status

This is the concrete per-node inventory. It tracks two dimensions:

1. **Session contract** — are reads/writes session-aware? (`complete` / `partial` / `pending` / `leaf`)
2. **Instance root** — is the node wired into the instance-root model? (`wired` / `associated` / `not yet`)

A node is only fully done when both dimensions are complete.

## Status Legend

### Session contract

| Status | Meaning |
| --- | --- |
| `complete` | All active reads/writes use session helpers. Canonical fields are not mutated during eval. Has proof tests. |
| `partial` | Some paths are session-aware, but some still mutate canonical or lack proof. |
| `pending` | Not yet audited or migrated. |
| `leaf` | Scalar/opaque value node. No session-backed write surface needed. |
| `inherited` | Inherits session behavior from parent class. |

### Instance root

| Status | Meaning |
| --- | --- |
| `wired` | Instance roots are created and active in the eval path for this node. |
| `associated` | Output carries `_instanceRoot` but cloning is not yet replaced with shadowing. |
| `not yet` | Instance root work has not reached this node's eval path. |
| `n/a` | Not applicable (leaf nodes, inherited). |

## Core Containers And Eval Nodes

| Node | Session | Instance Root | Notes |
| --- | --- | --- | --- |
| `Declaration` | `partial` | not yet | Active eval/serialization reads and field writes for `name` / `value` / `important` now use session helpers. Caller-side mutation paths still need to be finished. |
| `VarDeclaration` | `inherited` | not yet | Inherits `Declaration` field behavior. Remaining mixin-param binding work is in callers, not in the node class itself. |
| `CustomDeclaration` | `inherited` | n/a | Inherits `Declaration`; custom eval wrapper only toggles `context.inCustom`. |
| `Ruleset` | `complete` | not yet | `selector` / `rules` / `guard` / extend-managed selector fields are session-aware on active eval/render paths. |
| `Rules` | `partial` | associated | Non-reset sessions have child-array overlays and session-backed reads/writes through major preEval/eval/coalescing loops. Instance roots are created per mixin candidate and associated with output. Reset-session structural work still relies on cloned working trees. |
| `RawRules` | `complete` | not yet | Serializer reads session child overlay. Has both behavior and immutability proofs. |
| `AtRule` | `complete` | not yet | Render and eval read `name` / `prelude` / `rules` through session-aware view. |
| `Mixin` | `complete` | associated | Render reads for `name` / `params` / `guard` / `rules` are session-aware. Output carries `_instanceRoot` per candidate. Remaining work is caller-side invocation. |
| `Call` | `complete` | associated | Render reads for `name` / `args` / `contentNode` are session-aware. Now dispatches mixins directly via `evalMixinDirect()`. Output carries `_instanceRoot`. |
| `Func` | `complete` | not yet | Render reads for `name` / `params` / `body` are session-aware. `evalCall()` reads through session view. |
| `StyleImport` | `complete` | wired | Instance root created per import placement in evalNode. Session-aware path resolution, `with`/`set` injection, and returned-tree finalization. |
| `Expression` | `complete` | not yet | Render/read path for `value` is session-aware. Clone preserves session-patched value. |
| `Operation` | `complete` | not yet | Render and eval read `left` / `right` through session-aware view. |
| `Condition` | `complete` | not yet | Render, eval, and clone read `left` / `operator` / `right` / `negate` through session-aware view. |
| `Sequence` | `complete` | not yet | Render, eval, clone, and `operate()` use session-aware `value[]` path. |
| `List` | `complete` | not yet | Render/read path for `value[]` is session-aware. `operate()` consumes session-patched items. |
| `Range` | `complete` | not yet | Render and eval read `start` / `end` / `step` through session-aware view. |
| `Reference` | `complete` | not yet | Render and eval read `target` / `key` through session-aware view. Ancestor walks use `sessionGetParent`. |
| `Interpolated` | `complete` | not yet | Render and eval read `source` / `replacements` through session-aware view. |
| `ImportJs` | `complete` | not yet | Render and eval read `path` / `imports` through session-aware view. |
| `If` / `For` / control | `complete` | not yet | All control nodes read fields through session-aware view. Loop results use `sessionGetChildren`. |
| `Block` | `complete` | not yet | Render and eval read `value` through session-aware view. |
| `Negative` | `complete` | not yet | Render and eval read `value` through session-aware view. |
| `Rest` | `complete` | not yet | Serialization reads `value` through session-aware view. |
| `Extend` | `complete` | not yet | Clone and evalNode use session-aware getters for `selector` / `target` / `namespace` / `flag`. |
| `ExtendList` | `complete` | not yet | `toTrimmedString()` reads `value` through session layer. |
| `Paren` | `partial` | not yet | Wrapper render/read path for `value` is session-aware. |
| `Quoted` | `partial` | not yet | Render/read path for `value` is session-aware. |
| `Url` | `partial` | not yet | Render/read path for `value` is session-aware. |

## Selector Nodes

| Node | Session | Instance Root | Notes |
| --- | --- | --- | --- |
| `BasicSelector` | `leaf` | n/a | Scalar selector token. |
| `AttributeSelector` | `complete` | not yet | Render and eval read `name` / `value` through session-aware view. |
| `InterpolatedSelector` | `complete` | not yet | Render and eval read wrapped interpolated value through session-aware view. |
| `Ampersand` | `complete` | not yet | `valueOf(context?)` and `getResolvedSelector(context?)` read session-patched parent selector. |
| `PseudoSelector` | `complete` | not yet | Render and eval read `name` / `arg` through session-aware view. |
| `CompoundSelector` | `complete` | not yet | Render and eval read `value[]` through session-aware view. |
| `ComplexSelector` | `complete` | not yet | Render and eval read `value[]` through session-aware view. `getKeySet(context)` composes session-specific key set. |
| `SelectorList` | `complete` | not yet | Render and eval read `value[]` through session-aware view. |
| `SelectorCapture` | `complete` | not yet | Render and eval read `value` through session-aware path. `preEval()` replacement is session-backed. |

## Leaf / Opaque Value Nodes

| Node | Session | Instance Root | Notes |
| --- | --- | --- | --- |
| `Any` | `leaf` | n/a | Scalar token node. |
| `Bool` | `leaf` | n/a | Scalar token node. |
| `Color` | `leaf` | n/a | Scalar value node. |
| `Comment` | `leaf` | n/a | Opaque token/comment node. |
| `Combinator` | `leaf` | n/a | Scalar selector token node. |
| `DefaultGuard` | `leaf` | n/a | Scalar control marker. |
| `Dimension` | `leaf` | n/a | Numeric value object. |
| `JsArray` | `leaf` | n/a | Opaque JS payload node. |
| `JsObject` | `leaf` | n/a | Opaque JS payload node. |
| `JsFunction` | `leaf` | n/a | Opaque JS function payload node. |
| `JsExpression` | `leaf` | n/a | Opaque string payload plus eval hook. |
| `Nil` | `leaf` | n/a | Sentinel value node. |
| `Num` | `leaf` | n/a | Numeric scalar node. |

## What "Complete" Means End-to-End

A node is fully complete when:

1. **Session**: all active reads/writes use session helpers (`complete`)
2. **Instance root**: eval path creates instance roots, output carries `_instanceRoot` (`wired` or `associated`)
3. **Clone-free**: no internal `clone()` / `copy()` / `materialize()` in that node's eval path — isolation is purely via instance root shadowing

The goal is to remove the entire cloning architecture in favor of instance roots. Internal cloning should not exist in a complete node's eval path.

The only place materialization is allowed is at the **final output boundary** — when Jess serializes the evaluated tree to CSS or hands off a standalone object graph that outlives the session.

### Edge cases where a clone might survive

If any of these turn out to add more complexity via shadowing than a simple clone, they should be documented here with a reason:

| Case | Status | Notes |
| --- | --- | --- |
| Extend selector rewriting | not yet evaluated | Extend structurally mutates selectors (adds new alternatives). Shadow-based extend may require tracking per-selector shadow arrays. Needs investigation. |
| `@arguments` construction | not yet evaluated | Currently deep-copies arg nodes into a Sequence. Could shadow instead, but the args are frozen copies already — may not be worth the complexity. |

If a case is kept as a clone, it must be documented here with a concrete reason. "It was easier" is not a reason.

### Current status

- Most nodes are session-`complete` (the bridge work)
- `StyleImport` is the only `wired` node
- `Rules`, `Mixin`, `Call` have instance root `associated` (output carries `_instanceRoot` but clone not yet replaced)
- Clone-free eval is the next frontier (see [mixin-direct-invocation.md](./mixin-direct-invocation.md))
- No node has reached full end-to-end complete yet
