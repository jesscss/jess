# Node Session Status

This is the concrete per-node inventory. It tracks two dimensions:

1. **Session contract** — are reads/writes session-aware? (`complete` / `partial` / `pending` / `leaf`)
2. **Clone-free** — does this node's eval path avoid internal cloning? (`complete` / `has-clones` / `n/a`)

A node is fully done when both dimensions are complete.

Since all session helpers resolve `instanceRoot → node._instanceRoot → session → canonical`, every session-complete node automatically works under instance roots. The remaining work is eliminating clones in the few nodes that create them.

## Status Legend

### Session contract

| Status | Meaning |
| --- | --- |
| `complete` | All active reads/writes use session helpers. Canonical fields are not mutated during eval. Has proof tests. |
| `partial` | Some paths are session-aware, but some still mutate canonical or lack proof. |
| `leaf` | Scalar/opaque value node. No session-backed write surface needed. |
| `inherited` | Inherits session behavior from parent class. |

### Clone-free

| Status | Meaning |
| --- | --- |
| `complete` | No internal `clone()` / `copy()` / `materialize()` in this node's eval path. |
| `has-clones` | This node's eval path still creates clones that should be replaced with instance root shadowing. |
| `n/a` | Node doesn't clone (reads/writes only). Automatically works under instance roots via session helpers. |

## Core Containers And Eval Nodes

| Node | Session | Clone-free | Notes |
| --- | --- | --- | --- |
| `Declaration` | `partial` | n/a | Active eval/serialization reads use session helpers. Caller-side mutation paths still need finishing. |
| `VarDeclaration` | `inherited` | n/a | Inherits `Declaration` field behavior. |
| `CustomDeclaration` | `inherited` | n/a | Inherits `Declaration`. |
| `Ruleset` | `complete` | n/a | All fields session-aware on active eval/render paths. |
| `Rules` | `partial` | has-clones | Session child-array overlays landed. `getFunctionFromMixins` still deep-clones mixin bodies and param wrappers per call. `preEval` still clones for reset-session. |
| `RawRules` | `complete` | n/a | Serializer reads session child overlay. |
| `AtRule` | `complete` | n/a | Render and eval read through session-aware view. |
| `Mixin` | `complete` | n/a | Render reads session-aware. Remaining work is in callers (Rules/Call), not this node. |
| `Call` | `complete` | has-clones | Session-aware reads. Direct dispatch via `evalMixinDirect()`. But internally delegates to `getFunctionFromMixins` which deep-clones. Also clones for Collection/detached rulesets. |
| `Func` | `complete` | has-clones | Session-aware reads. `evalCall()` creates temporary mixin wrapper. Uses same clone machinery as Call. |
| `StyleImport` | `complete` | has-clones | Instance root created per import placement. Still uses `cloneLookupSafeShallowWrapper` for compose re-eval and `cloneDetachedMaterializedWrapper` for output. |
| `Expression` | `complete` | n/a | Session-aware reads. Clone preserves session-patched value. |
| `Operation` | `complete` | n/a | Session-aware reads for `left` / `right`. |
| `Condition` | `complete` | n/a | Session-aware reads for all fields. |
| `Sequence` | `complete` | n/a | Session-aware `value[]` path. |
| `List` | `complete` | n/a | Session-aware `value[]` path. |
| `Range` | `complete` | n/a | Session-aware reads. |
| `Reference` | `complete` | n/a | Session-aware reads. Ancestor walks use `sessionGetParent`. |
| `Interpolated` | `complete` | n/a | Session-aware reads. |
| `ImportJs` | `complete` | n/a | Session-aware reads. |
| `If` / `For` / control | `complete` | n/a | All fields session-aware. Loop results use `sessionGetChildren`. |
| `Block` | `complete` | n/a | Session-aware reads. |
| `Negative` | `complete` | n/a | Session-aware reads. |
| `Rest` | `complete` | n/a | Session-aware reads. |
| `Extend` | `complete` | has-clones | Session-aware getters for all fields. But extend selector rewriting still uses structural copies. |
| `ExtendList` | `complete` | n/a | Session-aware reads. |
| `Paren` | `partial` | n/a | Render/read path session-aware. |
| `Quoted` | `partial` | n/a | Render/read path session-aware. |
| `Url` | `partial` | n/a | Render/read path session-aware. |

## Selector Nodes

| Node | Session | Clone-free | Notes |
| --- | --- | --- | --- |
| `BasicSelector` | `leaf` | n/a | Scalar selector token. |
| `AttributeSelector` | `complete` | n/a | Session-aware reads. |
| `InterpolatedSelector` | `complete` | n/a | Session-aware reads. |
| `Ampersand` | `complete` | n/a | Session-aware reads. |
| `PseudoSelector` | `complete` | n/a | Session-aware reads. |
| `CompoundSelector` | `complete` | n/a | Session-aware reads. |
| `ComplexSelector` | `complete` | n/a | Session-aware reads. `getKeySet(context)` composes session-specific key set. |
| `SelectorList` | `complete` | n/a | Session-aware reads. |
| `SelectorCapture` | `complete` | n/a | Session-aware reads. |

## Leaf / Opaque Value Nodes

| Node | Session | Clone-free | Notes |
| --- | --- | --- | --- |
| `Any` | `leaf` | n/a | |
| `Bool` | `leaf` | n/a | |
| `Color` | `leaf` | n/a | |
| `Comment` | `leaf` | n/a | |
| `Combinator` | `leaf` | n/a | |
| `DefaultGuard` | `leaf` | n/a | |
| `Dimension` | `leaf` | n/a | |
| `JsArray` | `leaf` | n/a | |
| `JsObject` | `leaf` | n/a | |
| `JsFunction` | `leaf` | n/a | |
| `JsExpression` | `leaf` | n/a | |
| `Nil` | `leaf` | n/a | |
| `Num` | `leaf` | n/a | |

## Nodes With Remaining Clones

These are the only nodes that still have `has-clones`. Everything else is done or n/a.

| Node | Clone sites | What needs to happen |
| --- | --- | --- |
| `Rules` | `getFunctionFromMixins`: body `clone(true)` per mixin call, `outerRules.clone(true)` in evaluateCandidateOutput, `cloneDetachedUnlockWrapper` for detached rulesets. `preEval`: `clone(false)` for reset-session. | Shallow clone attempt (body `clone(true)` → `cloneLookupSafeShallowWrapper`) causes 3 regressions because eval-time writes on shared children still bypass instance roots. Remaining direct mutations that need session/IR routing: parent chain writes during child iteration, registry population, `inherit()` calls. Eval state methods (`_isEvaluated`, etc.) are now IR-aware. See [mixin-direct-invocation.md](./mixin-direct-invocation.md). |
| `Call` | `getFunctionFromMixins` (via Rules), Collection `clone(true)` for detached rulesets. | Follows from Rules clone elimination. Collection path is simpler — one clone site. |
| `Func` | Uses mixin machinery — `evalCall` creates temp Mixin wrapper. | Follows from Rules clone elimination. |
| `StyleImport` | `cloneLookupSafeShallowWrapper` for compose re-eval, shallow clone in `getFinalRules`. | Replace shallow wrapper with instance root parent shadow. |
| `Extend` | `materializeImplicitAmpersands`, `copy(true)` in extend-core selector rewriting. | Extend mutates selectors structurally. Needs investigation — may be a legitimate edge case. |

## Edge Cases Where Clone Might Survive

| Case | Status | Notes |
| --- | --- | --- |
| Extend selector rewriting | not yet evaluated | Extend structurally mutates selectors (adds new alternatives). Shadow-based extend may require tracking per-selector shadow arrays. Needs investigation. |
| `@arguments` construction | not yet evaluated | Currently deep-copies arg nodes into a Sequence. Could shadow instead, but the args are frozen copies already — may not be worth the complexity. |

If a case is kept as a clone, it must be documented here with a concrete reason. "It was easier" is not a reason.

## What "Complete" Means End-to-End

A node is fully complete when:

1. **Session**: all active reads/writes use session helpers (`complete`)
2. **Clone-free**: no internal `clone()` / `copy()` / `materialize()` in that node's eval path (`complete` or `n/a`)

The goal is to remove the entire cloning architecture in favor of instance roots. Materialization only at the final CSS output boundary.
